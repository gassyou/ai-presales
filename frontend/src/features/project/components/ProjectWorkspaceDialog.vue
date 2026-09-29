<!--
  ProjectWorkspaceDialog.vue
  ==========================
  项目工作区路径编辑对话框（阶段 13 / PR #2）。

  设计：
    - 仿 ProjectEditDialog 的模式（el-dialog + el-form + 手写校验 + displayError）
    - submitting 由父组件控制（避免双源真理）
    - 默认值 = ~/Desktop/<项目编号>（前端拿项目编号拼一下，纯展示用，不当真后端做）
    - 字段：
        workspacePath（文本输入）
      底部辅助按钮：
        「使用默认（桌面 + 项目编号）」 → 填默认值
        「清空」                           → 清空输入框（提交时传 null，回退到默认）
-->
<template>
  <el-dialog
    :model-value="true"
    title="编辑工作区路径"
    width="560"
    :close-on-click-modal="!isSubmitting"
    :show-close="!isSubmitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top" @submit.prevent>
      <el-form-item label="工作区路径" required>
        <el-input
          v-model="form.workspacePath"
          placeholder="例如 /Users/me/Projects/foo 或 C:\Users\me\Projects\foo"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <el-button size="small" :disabled="isSubmitting" @click="useDefault">
          使用默认（桌面 + 项目编号）
        </el-button>
        <el-button
          size="small"
          plain
          :disabled="isSubmitting"
          @click="clearPath"
        >
          清空
        </el-button>
        <span class="text-slate-500">
          当前默认：<code class="rounded bg-surface-alt px-1.5 py-0.5">{{ defaultHint }}</code>
        </span>
      </div>

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
import type { ProjectDTO } from "@shared/types/dto/project.ts";

const props = defineProps<{
  project: ProjectDTO;
  submitting?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", input: { workspacePath: string | null }): void;
}>();

interface FormState {
  workspacePath: string;
}

function buildForm(p: ProjectDTO): FormState {
  return { workspacePath: p.workspacePath ?? "" };
}

const form = reactive<FormState>(buildForm(props.project));
const localError = ref<string | null>(null);
const isSubmitting = computed(() => props.submitting ?? false);
const displayError = computed(() => props.error ?? localError.value);

// 纯前端默认值提示（不调后端解析，避免 UI 启动一次网络往返）
const defaultHint = computed(() => `~/Desktop/${props.project.code}`);

// project prop 变化时同步
watch(
  () => props.project,
  (p) => Object.assign(form, buildForm(p)),
);

const absolutePathPattern = /^\/|^[A-Za-z]:[\\/]/;

const canSubmit = computed(() => !isSubmitting.value);

function useDefault(): void {
  form.workspacePath = defaultHint.value;
  localError.value = null;
}

function clearPath(): void {
  form.workspacePath = "";
  localError.value = null;
}

function onSubmit(): void {
  if (isSubmitting.value) return;
  localError.value = null;

  const raw = form.workspacePath.trim();
  if (raw.length === 0) {
    // 空字符串视同"清空"——后端会按 null 走 fallback
    emit("submit", { workspacePath: null });
    return;
  }
  if (!absolutePathPattern.test(raw)) {
    localError.value = "请输入绝对路径（以 / 开头，或 Windows 盘符如 C:\\）";
    return;
  }

  emit("submit", { workspacePath: raw });
}
</script>
