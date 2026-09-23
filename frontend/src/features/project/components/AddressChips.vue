<!--
  AddressChips.vue
  ===============
  邮件地址 chip 列表（阶段 7.4e）。

  形态：每个地址渲染成 chip，hover 显示删除按钮；
  底部 input 输入邮箱按 Enter 添加，自动校验格式。
-->
<template>
  <div class="flex flex-wrap items-center gap-1 rounded border border-border bg-canvas px-2 py-1">
    <span
      v-for="(a, i) in modelValue"
      :key="`${a.email}-${i}`"
      class="flex items-center gap-1 rounded bg-surface-alt px-2 py-0.5 text-xs"
    >
      <span class="text-slate-700">{{ a.name || a.email }}</span>
      <span v-if="a.name" class="text-slate-500">&lt;{{ a.email }}&gt;</span>
      <button
        v-if="!disabled"
        class="text-slate-500 hover:text-red-300"
        @click="remove(i)"
      >×</button>
    </span>
    <input
      v-model="draft"
      type="email"
      :placeholder="placeholder"
      :disabled="disabled"
      class="min-w-[120px] flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-600"
      @keydown.enter.prevent="commit"
      @keydown.delete="onBackspace"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { EmailAddress } from "../api/email.api.ts";

const props = defineProps<{
  modelValue: EmailAddress[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: EmailAddress[]): void;
}>();

const draft = ref("");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function commit(): void {
  const v = draft.value.trim();
  if (v.length === 0) return;
  // 允许 "张三 <a@b.com>" 形式
  const m = v.match(/^(.*?)\s*<([^>]+)>$/);
  let name = "";
  let email = v;
  if (m && m[2]) {
    name = m[1].trim().replace(/^["']|["']$/g, "");
    email = m[2].trim();
  }
  if (!EMAIL_RE.test(email)) {
    draft.value = "";
    return;
  }
  emit("update:modelValue", [...props.modelValue, { name, email }]);
  draft.value = "";
}

function remove(i: number): void {
  const next = [...props.modelValue];
  next.splice(i, 1);
  emit("update:modelValue", next);
}

function onBackspace(e: KeyboardEvent): void {
  if (draft.value.length === 0 && props.modelValue.length > 0) {
    e.preventDefault();
    remove(props.modelValue.length - 1);
  }
}
</script>