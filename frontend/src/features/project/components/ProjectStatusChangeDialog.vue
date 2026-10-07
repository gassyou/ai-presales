<!--
  ProjectStatusChangeDialog.vue
  =============================
  项目状态变更对话框（阶段 13 / PR #1；task20 扩展中标/未中标/暂停）。

  设计：
    - 接受 target 参数渲染不同表单（中标 / 未中标 / 暂停）
    - 模板沿用 ProjectEditDialog 的模式（el-dialog + el-form + 手写校验 + displayError）
    - 不持有 submitting 状态，由父组件控制（避免双源真理）
    - 字段布局：
        target = "中标"    → 中标日期（默认今天）+ 最佳实践（必填 200 字）
        target = "未中标"  → 未中标日期（默认今天）+ 原因（必填 200 字）+ 复盘要点（必填 200 字）
        target = "暂停"    → 暂停日期（默认今天）+ 暂停原因（必填 200 字）

  从"暂停"恢复到"提案中"走专用端点，不在 target 对话框列表里。

  Props / Emit：
    - props.project          当前项目（用于 header 展示）
    - props.target           目标状态
    - props.submitting?      父组件控制提交中状态
    - props.error?           父组件传入的网络错误（展示给用户）
    - emit("close")          关闭 dialog
    - emit("submit", input)  校验通过，提交 input（ChangeProjectStatusInput）
-->
<template>
  <el-dialog
    :model-value="true"
    :title="dialogTitle"
    width="560"
    :close-on-click-modal="!isSubmitting"
    :show-close="!isSubmitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top" @submit.prevent>
      <!-- 中标：日期 + 最佳实践 -->
      <template v-if="target === '中标'">
        <el-form-item label="中标日期" required>
          <el-date-picker
            v-model="form.wonDate"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择中标日期"
            class="!w-full"
            :disabled="isSubmitting"
          />
        </el-form-item>
        <el-form-item label="最佳实践（中标要点）" required>
          <el-input
            v-model="form.bestPractice"
            type="textarea"
            :rows="4"
            :maxlength="200"
            show-word-limit
            placeholder="总结本次中标的关键要素，便于后续复盘"
            :disabled="isSubmitting"
          />
        </el-form-item>
      </template>

      <!-- 未中标：日期 + 原因 + 复盘 -->
      <template v-else-if="target === '未中标'">
        <el-form-item label="未中标日期" required>
          <el-date-picker
            v-model="form.lostDate"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择未中标日期"
            class="!w-full"
            :disabled="isSubmitting"
          />
        </el-form-item>
        <el-form-item label="未中标原因" required>
          <el-input
            v-model="form.lostReason"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-word-limit
            placeholder="说明未中标的核心原因"
            :disabled="isSubmitting"
          />
        </el-form-item>
        <el-form-item label="复盘要点（下次改进）" required>
          <el-input
            v-model="form.improvementNote"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-word-limit
            placeholder="本次失分点 + 下次如何改进"
            :disabled="isSubmitting"
          />
        </el-form-item>
      </template>

      <!-- 暂停：日期 + 原因 -->
      <template v-else-if="target === '暂停'">
        <el-form-item label="暂停日期" required>
          <el-date-picker
            v-model="form.pausedDate"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择暂停日期"
            class="!w-full"
            :disabled="isSubmitting"
          />
        </el-form-item>
        <el-form-item label="暂停原因" required>
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-word-limit
            placeholder="说明暂停的原因"
            :disabled="isSubmitting"
          />
        </el-form-item>
      </template>

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
        {{ isSubmitting ? "提交中…" : confirmLabel }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  ChangeProjectStatusInput,
  ProjectDTO,
  ProjectStatusValue,
} from "@shared/types/dto/project.ts";

const props = defineProps<{
  project: ProjectDTO;
  target: ProjectStatusValue;
  submitting?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", input: ChangeProjectStatusInput): void;
}>();

interface FormState {
  wonDate: string;
  bestPractice: string;
  lostDate: string;
  lostReason: string;
  improvementNote: string;
  reason: string;
  pausedDate: string;
}

/** 默认日期：当前本地时间，YYYY-MM-DDTHH:mm:ss（el-date-picker value-format） */
function nowLocalIso(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildForm(): FormState {
  return {
    wonDate: nowLocalIso(),
    bestPractice: "",
    lostDate: nowLocalIso(),
    lostReason: "",
    improvementNote: "",
    reason: "",
    pausedDate: nowLocalIso(),
  };
}

const form = reactive<FormState>(buildForm());
const localError = ref<string | null>(null);
const isSubmitting = computed(() => props.submitting ?? false);
const displayError = computed(() => props.error ?? localError.value);

// target 切换时重置表单
watch(
  () => props.target,
  () => {
    Object.assign(form, buildForm());
    localError.value = null;
  },
);

// —— 文案映射 ——
const dialogTitle = computed(() => {
  switch (props.target) {
    case "中标": return "项目中标";
    case "未中标": return "项目未中标";
    case "暂停": return "暂停项目";
    default: return `变更项目状态为「${props.target}」`;
  }
});

const confirmLabel = computed(() => {
  switch (props.target) {
    case "中标": return "确认中标";
    case "未中标": return "确认未中标";
    case "暂停": return "确认暂停";
    default: return "确认变更";
  }
});

// —— 校验 ——
const canSubmit = computed(() => {
  if (isSubmitting.value) return false;
  switch (props.target) {
    case "中标":
      return form.wonDate.length > 0 && form.bestPractice.trim().length > 0;
    case "未中标":
      return form.lostDate.length > 0 &&
        form.lostReason.trim().length > 0 &&
        form.improvementNote.trim().length > 0;
    case "暂停":
      return form.pausedDate.length > 0 && form.reason.trim().length > 0;
    default:
      return false;
  }
});

function onSubmit(): void {
  if (isSubmitting.value) return;
  localError.value = null;

  const input: ChangeProjectStatusInput = { target: props.target };

  switch (props.target) {
    case "中标": {
      if (!form.wonDate) { localError.value = "请选择中标日期"; return; }
      const bp = form.bestPractice.trim();
      if (!bp) { localError.value = "请填写最佳实践"; return; }
      input.wonDate = form.wonDate;
      input.bestPractice = bp;
      break;
    }
    case "未中标": {
      if (!form.lostDate) { localError.value = "请选择未中标日期"; return; }
      const reason = form.lostReason.trim();
      const note = form.improvementNote.trim();
      if (!reason) { localError.value = "请填写未中标原因"; return; }
      if (!note) { localError.value = "请填写复盘要点"; return; }
      input.lostDate = form.lostDate;
      input.lostReason = reason;
      input.improvementNote = note;
      break;
    }
    case "暂停": {
      if (!form.pausedDate) { localError.value = "请选择暂停日期"; return; }
      const r = form.reason.trim();
      if (!r) { localError.value = "请填写暂停原因"; return; }
      input.pausedDate = form.pausedDate;
      input.reason = r;
      break;
    }
    default:
      localError.value = `不支持的目标状态：${props.target}`;
      return;
  }

  emit("submit", input);
}
</script>