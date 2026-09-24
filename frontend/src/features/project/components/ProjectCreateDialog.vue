<!--
  ProjectCreateDialog.vue
  =======================
  新建项目对话框（Element Plus 版）。
-->
<template>
  <el-dialog
    :model-value="true"
    title="新建项目"
    width="420"
    :close-on-click-modal="!submitting"
    :show-close="!submitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top">
      <el-form-item label="项目名称" required>
        <el-input
          v-model="form.name"
          placeholder="ERP 升级提案"
          maxlength="120"
          show-word-limit
          :disabled="submitting"
        />
      </el-form-item>
      <el-form-item label="客户名称" required>
        <el-input
          v-model="form.clientName"
          placeholder="ACME 集团"
          maxlength="120"
          show-word-limit
          :disabled="submitting"
        />
      </el-form-item>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />
    </el-form>
    <template #footer>
      <el-button :disabled="submitting" @click="emit('close')">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="!form.name.trim() || !form.clientName.trim()"
        @click="onSubmit"
      >
        {{ submitting ? "创建中…" : "创建" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", input: { name: string; clientName: string }): void;
}>();

const form = reactive({ name: "", clientName: "" });
const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  error.value = null;
  if (!form.name.trim()) {
    error.value = "请输入项目名称";
    return;
  }
  if (!form.clientName.trim()) {
    error.value = "请输入客户名称";
    return;
  }
  submitting.value = true;
  try {
    emit("submit", { name: form.name.trim(), clientName: form.clientName.trim() });
  } finally {
    submitting.value = false;
  }
}
</script>