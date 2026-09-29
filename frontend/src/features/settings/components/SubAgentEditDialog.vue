<!--
  SubAgentEditDialog.vue
  =======================
  用户 sub-agent 新增 / 编辑对话框（阶段 13 / PR #3）。

  设计：
    - 仿 ProjectCreateDialog 模式（el-dialog + el-form + 手写校验 + displayError）
    - submitting / error 由父组件传入（避免双源真理）
    - spec prop undefined = 新增模式；否则编辑模式（name disabled）
    - 字段：
        name          新增时必填，正则 /^[a-z][a-z0-9_-]{2,63}$/；编辑模式只读
        displayName   必填，max 120
        description   选填
        systemPrompt  必填，textarea，max 16000；header 显示字数
        toolNames     多选下拉，候选 = props.tools（注意：当前前端用 KNOWN_TOOLS 静态列表）
        profileHint   下拉，候选 = props.llmProfileNames + "(默认)"；空 = 不指定
-->
<template>
  <el-dialog
    :model-value="true"
    :title="dialogTitle"
    width="640"
    :close-on-click-modal="!isSubmitting"
    :show-close="!isSubmitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top" @submit.prevent>
      <el-form-item label="名称" required>
        <el-input
          v-model="form.name"
          :disabled="isEdit || isSubmitting"
          placeholder="例如 my_researcher（小写字母 + 数字 / 下划线 / 连字符，2-63 字符）"
        />
      </el-form-item>

      <el-form-item label="显示名" required>
        <el-input
          v-model="form.displayName"
          maxlength="120"
          show-word-limit
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="描述">
        <el-input
          v-model="form.description"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="可用工具" required>
        <el-select
          v-model="form.toolNames"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择 sub-agent 可用的工具"
          class="!w-full"
          :disabled="isSubmitting"
        >
          <el-option v-for="t in toolOptions" :key="t" :label="t" :value="t" />
        </el-select>
      </el-form-item>

      <el-form-item label="LLM profile hint（留空走默认）">
        <el-select
          v-model="form.profileHint"
          allow-create
          clearable
          placeholder="（默认）"
          class="!w-full"
          :disabled="isSubmitting"
        >
          <el-option
            v-for="p in llmProfileOptions"
            :key="p"
            :label="p"
            :value="p"
          />
        </el-select>
      </el-form-item>

      <el-form-item required>
        <template #label>
          <span>系统提示词（{{ form.systemPrompt.length }} / 16000 字）</span>
        </template>
        <el-input
          v-model="form.systemPrompt"
          type="textarea"
          :rows="8"
          :maxlength="16000"
          show-word-limit
          class="!font-mono"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-alert
        v-if="displayError"
        :title="displayError"
        type="error"
        :closable="false"
        show-icon
      />
    </el-form>

    <template #footer>
      <el-button :disabled="isSubmitting" @click="emit('close')">取消</el-button>
      <el-button
        type="primary"
        :loading="isSubmitting"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        {{ isSubmitting ? "保存中…" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  CreateUserSubAgentInput,
  UpdateUserSubAgentInput,
} from "@shared/types/dto/sub-agent.ts";
// SubAgentSpecDTO 用 settings.api 的本地形状（含 displayName / toolNames / profileHint），
// 与 shared 的 DTO 形状（tools / modelHint / type / builtIn）不同。
import type { SubAgentSpecDTO } from "../api/settings.api.ts";

type SubmitInput =
  | { mode: "create"; input: CreateUserSubAgentInput }
  | { mode: "update"; name: string; input: UpdateUserSubAgentInput };

const props = defineProps<{
  /** 编辑模式时传入；undefined = 新增模式 */
  spec?: SubAgentSpecDTO;
  /** 可选工具列表（toolName） */
  toolOptions: readonly string[];
  /** LLM profile 名称列表（用于 profileHint 下拉） */
  llmProfileOptions?: readonly string[];
  submitting?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", payload: SubmitInput): void;
}>();

interface FormState {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  toolNames: string[];
  profileHint: string;
}

function buildForm(spec?: SubAgentSpecDTO): FormState {
  if (!spec) {
    return {
      name: "",
      displayName: "",
      description: "",
      systemPrompt: "",
      toolNames: [],
      profileHint: "",
    };
  }
  return {
    name: spec.name,
    displayName: spec.displayName ?? "",
    description: spec.description ?? "",
    systemPrompt: spec.systemPrompt ?? "",
    toolNames: [...spec.toolNames],
    profileHint: spec.profileHint ?? "",
  };
}

const form = reactive<FormState>(buildForm(props.spec));
const localError = ref<string | null>(null);
const isSubmitting = computed(() => props.submitting ?? false);
const displayError = computed(() => props.error ?? localError.value);
const isEdit = computed(() => props.spec !== undefined);

const dialogTitle = computed(() => isEdit.value ? "编辑 sub-agent" : "新增 sub-agent");

watch(
    () => props.spec,
    (s) => Object.assign(form, buildForm(s)),
);

const NAME_REGEX = /^[a-z][a-z0-9_-]{2,63}$/;

const canSubmit = computed(() => {
  if (isSubmitting.value) return false;
  if (!NAME_REGEX.test(form.name.trim())) return false;
  if (!form.displayName.trim()) return false;
  if (!form.systemPrompt.trim()) return false;
  if (form.toolNames.length === 0) return false;
  return true;
});

function onSubmit(): void {
  if (isSubmitting.value) return;
  localError.value = null;

  const name = form.name.trim();
  const displayName = form.displayName.trim();
  const systemPrompt = form.systemPrompt.trim();

  if (!NAME_REGEX.test(name)) {
    localError.value = "名称需匹配 ^[a-z][a-z0-9_-]{2,63}$";
    return;
  }
  if (!displayName) {
    localError.value = "请填写显示名";
    return;
  }
  if (!systemPrompt) {
    localError.value = "请填写系统提示词";
    return;
  }
  if (form.toolNames.length === 0) {
    localError.value = "至少选择一个工具";
    return;
  }

  const profileHint = form.profileHint.trim() || undefined;

  if (isEdit.value) {
    // 编辑时不传 name / type（后端锁定）
    const input: UpdateUserSubAgentInput = {
      displayName,
      description: form.description.trim(),
      systemPrompt,
      toolNames: [...form.toolNames],
    };
    if (profileHint !== undefined) input.profileHint = profileHint;
    emit("submit", { mode: "update", name: form.name, input });
  } else {
    const input: CreateUserSubAgentInput = {
      name,
      displayName,
      description: form.description.trim(),
      systemPrompt,
      toolNames: [...form.toolNames],
    };
    if (profileHint !== undefined) input.profileHint = profileHint;
    emit("submit", { mode: "create", input });
  }
}
</script>