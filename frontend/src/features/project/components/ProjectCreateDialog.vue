<!--
  ProjectCreateDialog.vue
  =======================
  新建项目对话框。极简表单：名称 + 客户名。
-->
<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
    @click.self="emit('close')"
  >
    <form
      class="w-96 space-y-3 rounded border border-border bg-white p-5"
      @submit.prevent="onSubmit"
    >
      <h2 class="text-base font-medium text-slate-900">新建项目</h2>

      <label class="block text-sm">
        <span class="mb-1 block text-xs text-slate-600">项目名称 *</span>
        <input
          v-model.trim="name"
          required
          maxlength="120"
          class="w-full rounded border border-border bg-canvas px-2 py-1.5 focus:border-accent focus:outline-none"
          placeholder="ERP 升级提案"
        />
      </label>

      <label class="block text-sm">
        <span class="mb-1 block text-xs text-slate-600">客户名称 *</span>
        <input
          v-model.trim="clientName"
          required
          maxlength="120"
          class="w-full rounded border border-border bg-canvas px-2 py-1.5 focus:border-accent focus:outline-none"
          placeholder="ACME 集团"
        />
      </label>

      <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn-ghost" @click="emit('close')">取消</button>
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? "创建中…" : "创建" }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", input: { name: string; clientName: string }): void;
}>();

const name = ref("");
const clientName = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  error.value = null;
  if (!name.value) {
    error.value = "请输入项目名称";
    return;
  }
  if (!clientName.value) {
    error.value = "请输入客户名称";
    return;
  }
  submitting.value = true;
  try {
    emit("submit", { name: name.value, clientName: clientName.value });
  } finally {
    submitting.value = false;
  }
}
</script>