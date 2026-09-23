<!--
  SubAgentPicker.vue
  ==================
  AI 对话框顶部下拉：选择当前 sub-agent。
  默认 "（无）" = 直接调 chat，不走 sub-agent。
-->
<template>
  <select
    v-model="model"
    class="rounded border border-border bg-white px-2 py-1 text-xs text-slate-800 focus:border-accent focus:outline-none"
    :disabled="loading"
  >
    <option value="">（不使用 sub-agent）</option>
    <option v-for="a in agents" :key="a.name" :value="a.name">
      {{ a.displayName }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useSubAgentStore } from "./stores/sub-agent.store.ts";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();

const store = useSubAgentStore();
const loading = computed(() => !store.loaded && store.error === null);

const model = ref(props.modelValue ?? "");
watch(model, (v) => emit("update:modelValue", v));
watch(() => props.modelValue, (v) => {
  if (v !== model.value) model.value = v;
});

const agents = computed(() => store.items);

onMounted(() => {
  void store.load();
});
</script>