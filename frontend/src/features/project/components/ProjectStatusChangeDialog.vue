<!--
  ProjectStatusChangeDialog.vue
  =============================
  项目状态变更对话框（阶段 13 / PR #1）。

  设计：
    - 接受 target 参数渲染不同表单（中止 / 暂停 / 后续扩展）
    - 模板沿用 ProjectEditDialog 的模式（el-dialog + el-form + 手写校验 + displayError）
    - 不持有 submitting 状态，由父组件控制（避免双源真理）
    - 字段布局：
        target = "中止"   → 日期 + 原因（必填）
        target = "暂停"   → 原因（必填）
        其他 target       → 原因（必填，扩展位）

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
    width="520"
    :close-on-click-modal="!isSubmitting"
    :show-close="!isSubmitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top" @submit.prevent>
      <el-form-item v-if="target === '中止'" label="中止日期" required>
        <el-date-picker
          v-model="form.pausedDate"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          placeholder="选择中止日期"
          class="!w-full"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item :label="reasonLabel" required>
        <el-input
          v-model="form.stopReason"
          type="textarea"
          :rows="3"
          :maxlength="500"
          show-word-limit
          :placeholder="reasonPlaceholder"
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
  pausedDate: string;
  stopReason: string;
}

function buildForm(): FormState {
  return { pausedDate: "", stopReason: "" };
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
  if (props.target === "中止") return "中止项目";
  if (props.target === "暂停") return "暂停项目";
  return `变更项目状态为「${props.target}」`;
});

const reasonLabel = computed(() => {
  if (props.target === "中止") return "中止原因";
  if (props.target === "暂停") return "暂停原因";
  return "变更原因";
});

const reasonPlaceholder = computed(() => {
  if (props.target === "中止") return "说明中止的原因，便于后续复盘";
  if (props.target === "暂停") return "说明暂停的原因";
  return "说明变更原因";
});

const confirmLabel = computed(() => {
  if (props.target === "中止") return "确认中止";
  if (props.target === "暂停") return "确认暂停";
  return "确认变更";
});

// —— 校验 ——
const canSubmit = computed(() => {
  if (isSubmitting.value) return false;
  if (!form.stopReason.trim()) return false;
  if (props.target === "中止" && !form.pausedDate) return false;
  return true;
});

function onSubmit(): void {
  if (isSubmitting.value) return;
  localError.value = null;

  const stopReason = form.stopReason.trim();
  if (!stopReason) {
    localError.value = "请填写原因";
    return;
  }
  if (props.target === "中止" && !form.pausedDate) {
    localError.value = "请选择中止日期";
    return;
  }

  const input: ChangeProjectStatusInput = {
    target: props.target,
    stopReason,
  };
  if (props.target === "中止" && form.pausedDate) {
    input.pausedDate = form.pausedDate;
  }
  // 兼容旧 reason 字段（"暂停"等场景后端接受 reason）
  if (props.target !== "中止") {
    input.reason = stopReason;
  }

  emit("submit", input);
}
</script>
