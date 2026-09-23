<!--
  AgentSpecsTab.vue —— 阶段 7.4h

  Sub-agent spec 列表编辑：displayName / description / systemPrompt / toolNames / profileHint。
  - toolNames 多选：内置 5 个工具 + 其他可输入
  - profileHint 下拉（可选值 = 所有 LLM profile name + "default"）
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">Sub-agent 配置</h2>
      <button class="btn-primary" :disabled="!dirty || saving" @click="onSave">
        {{ saving ? "保存中…" : "保存" }}
      </button>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>
    <p v-if="validationError" class="text-xs text-amber-700">{{ validationError }}</p>
    <p v-if="conflictMsg" class="text-xs text-amber-700">{{ conflictMsg }}</p>

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="flex flex-col gap-3">
      <div
        v-for="(s, idx) in form.specs"
        :key="s.name || idx"
        class="rounded border border-border p-3"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="flex items-baseline gap-2">
            <code class="text-xs text-slate-500">{{ s.name }}</code>
            <input
              v-model="s.displayName"
              placeholder="显示名"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </div>
        </div>

        <label class="mb-2 flex flex-col gap-1 text-xs text-slate-600">
          <span>描述</span>
          <input
            v-model="s.description"
            class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
          />
        </label>

        <label class="mb-2 flex flex-col gap-1 text-xs text-slate-600">
          <span>可用工具（逗号分隔）</span>
          <input
            :value="s.toolNames.join(', ')"
            placeholder="list_files, read_file, ..."
            class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            @input="onToolsInput(s, ($event.target as HTMLInputElement).value)"
          />
          <span class="text-slate-600">已知工具：{{ knownToolsText }}</span>
        </label>

        <label class="mb-2 flex flex-col gap-1 text-xs text-slate-600">
          <span>Profile hint（默认 LLM profile 名）</span>
          <input
            v-model="s.profileHint"
            placeholder="default / fast / deep"
            class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-slate-600">
          <span>系统提示词（{{ s.systemPrompt.length }} 字）</span>
          <textarea
            v-model="s.systemPrompt"
            rows="6"
            class="rounded bg-surface-alt px-2 py-1 font-mono text-xs text-slate-800"
          ></textarea>
        </label>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.store.ts";
import type { SubAgentSpecDTO } from "../api/settings.api.ts";

const store = useSettingsStore();

const KNOWN_TOOLS = [
  "current_datetime",
  "list_files",
  "read_file",
  "search_knowledge",
  "read_module",
];
const knownToolsText = KNOWN_TOOLS.join(", ");

const form = ref<{ specs: SubAgentSpecDTO[] } | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictMsg = ref<string | null>(null);

function syncFromStore(): void {
  const snap = store.agentSpecs;
  if (!snap) {
    form.value = null;
    return;
  }
  form.value = {
    specs: Object.values(snap.specs).map((s) => ({
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      systemPrompt: s.systemPrompt,
      toolNames: [...s.toolNames],
      ...(s.profileHint !== undefined ? { profileHint: s.profileHint } : {}),
    })),
  };
  dirty.value = false;
  conflictMsg.value = null;
}

watch(() => store.agentSpecs, syncFromStore, { immediate: true });

function onToolsInput(s: SubAgentSpecDTO, raw: string): void {
  s.toolNames = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

const validationError = computed<string | null>(() => {
  if (!form.value) return null;
  const seen = new Set<string>();
  for (const s of form.value.specs) {
    if (!s.name) return "name 不能为空";
    if (seen.has(s.name)) return `name 重复: ${s.name}`;
    seen.add(s.name);
    if (!s.systemPrompt || s.systemPrompt.trim().length === 0) {
      return `${s.name}: systemPrompt 不能为空`;
    }
    // toolNames 校验（后端会再次校验 ⊆ ToolRegistry）
    for (const t of s.toolNames) {
      if (!KNOWN_TOOLS.includes(t)) {
        return `${s.name}: 未知工具 "${t}"；已知: ${KNOWN_TOOLS.join(", ")}`;
      }
    }
  }
  return null;
});

async function onSave(): Promise<void> {
  if (!form.value) return;
  if (validationError.value) {
    conflictMsg.value = validationError.value;
    return;
  }
  saving.value = true;
  conflictMsg.value = null;
  const specsMap: Record<string, SubAgentSpecDTO> = {};
  for (const s of form.value.specs) {
    specsMap[s.name] = {
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      systemPrompt: s.systemPrompt,
      toolNames: s.toolNames,
      ...(s.profileHint !== undefined && s.profileHint !== "" ? { profileHint: s.profileHint } : {}),
    };
  }
  const r = await store.saveAgentSpecs({ specs: specsMap });
  saving.value = false;
  if (r.ok) {
    dirty.value = false;
  } else if (r.conflict) {
    conflictMsg.value = "数据已被其他会话修改，请刷新后重试";
    await store.loadAgentSpecs();
  }
}

watch(form, () => {
  dirty.value = true;
}, { deep: true });
</script>