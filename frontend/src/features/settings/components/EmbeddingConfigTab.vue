<!--
  EmbeddingConfigTab.vue —— 阶段 7.7

  Embedding provider 单例配置（与 LLMProfilesTab 多 profile 不同）。
  - 字段：provider (下拉) / baseUrl / apiKey / model / dimension / textType (dashscope)
  - apiKey 默认 type=password，提供"显示/隐藏"切换；保存后清空输入框
  - provider 切换时自动隐藏/显示对应字段
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">向量模型配置 (Embedding)</h2>
      <div class="flex gap-2">
        <button class="btn-primary" :disabled="!dirty || saving" @click="onSave">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>
    <p v-if="conflictMsg" class="text-xs text-amber-700">{{ conflictMsg }}</p>

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="flex flex-col gap-2">
      <div class="rounded border border-border p-3">
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>Provider</span>
            <select
              v-model="form.provider"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
              @change="onProviderChange"
            >
              <option value="openai">openai</option>
              <option value="ollama">ollama</option>
              <option value="dashscope">dashscope</option>
              <option value="mock">mock（占位，不产生真实向量）</option>
            </select>
          </label>

          <label
            v-if="form.provider !== 'mock'"
            class="flex flex-col gap-1 text-xs text-slate-600"
          >
            <span>Model</span>
            <input
              v-model="form.model"
              :placeholder="modelPlaceholder"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>

          <label
            v-if="form.provider !== 'mock'"
            class="flex flex-col gap-1 text-xs text-slate-600"
          >
            <span>Dimension</span>
            <input
              v-model.number="form.dimension"
              type="number"
              min="0"
              max="4096"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>

          <label
            v-if="form.provider === 'openai' || form.provider === 'ollama'"
            class="flex flex-col gap-1 text-xs text-slate-600 md:col-span-2"
          >
            <span>Base URL</span>
            <input
              v-model="form.baseUrl"
              :placeholder="baseUrlPlaceholder"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>

          <label
            v-if="form.provider === 'openai' || form.provider === 'dashscope'"
            class="flex flex-col gap-1 text-xs text-slate-600"
          >
            <span>API Key</span>
            <div class="flex gap-1">
              <input
                v-model="form.apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-..."
                class="flex-1 rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
              />
              <button
                class="rounded bg-surface-sunken px-2 py-1 text-xs text-slate-700 hover:bg-slate-600"
                @click="showKey = !showKey"
              >
                {{ showKey ? "隐藏" : "显示" }}
              </button>
            </div>
          </label>

          <label
            v-if="form.provider === 'dashscope'"
            class="flex flex-col gap-1 text-xs text-slate-600"
          >
            <span>Text Type</span>
            <select
              v-model="form.textType"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            >
              <option value="document">document</option>
              <option value="query">query</option>
            </select>
          </label>
        </div>
      </div>

      <p class="text-xs text-slate-500">
        provider 决定向量检索的可用性；mock 仅用于本地开发，不会产生真实向量（影响 RAG 检索质量）。
        如更换 provider，请到 Knowledge 页面重建索引。
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.store.ts";
import type { EmbeddingConfigSettingDTO, EmbeddingProviderName } from "../api/settings.api.ts";

const store = useSettingsStore();

const form = ref<EmbeddingConfigSettingDTO | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictMsg = ref<string | null>(null);
const showKey = ref(false);

const modelPlaceholder = computed(() => {
  switch (form.value?.provider) {
    case "openai": return "text-embedding-3-small / text-embedding-3-large";
    case "ollama": return "nomic-embed-text / mxbai-embed-large";
    case "dashscope": return "text-embedding-v2 / text-embedding-v3";
    default: return "";
  }
});

const baseUrlPlaceholder = computed(() => {
  switch (form.value?.provider) {
    case "openai": return "https://api.openai.com/v1";
    case "ollama": return "http://localhost:11434";
    default: return "";
  }
});

function syncFromStore(): void {
  const snap = store.embedding;
  if (!snap) {
    form.value = null;
    return;
  }
  form.value = {
    provider: snap.provider,
    baseUrl: snap.baseUrl ?? "",
    apiKey: snap.apiKey ?? "",
    model: snap.model,
    dimension: snap.dimension,
    textType: snap.textType,
  };
  dirty.value = false;
  conflictMsg.value = null;
  showKey.value = false;
}

watch(() => store.embedding, syncFromStore, { immediate: true });

function onProviderChange(): void {
  // provider 切换：清掉字段（避免遗留 / 自动填默认）
  if (!form.value) return;
  if (form.value.provider === "mock") {
    form.value.baseUrl = "";
    form.value.apiKey = "";
    form.value.model = "mock-embed";
    form.value.dimension = 0;
    delete form.value.textType;
  } else {
    form.value.baseUrl = "";
    form.value.apiKey = "";
    form.value.model = "";
    form.value.dimension = 1536;
  }
  dirty.value = true;
}

const validationError = computed<string | null>(() => {
  if (!form.value) return null;
  const p = form.value.provider;
  if (p === "openai") {
    if (!form.value.apiKey) return "openai provider 需要 API key";
    if (!form.value.model) return "model 不能为空";
  } else if (p === "ollama") {
    if (!form.value.baseUrl) return "ollama provider 需要 baseUrl（如 http://localhost:11434）";
    if (!form.value.model) return "model 不能为空";
  } else if (p === "dashscope") {
    if (!form.value.apiKey) return "dashscope provider 需要 API key";
    if (!form.value.model) return "model 不能为空";
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
  const body: EmbeddingConfigSettingDTO = {
    provider: form.value.provider as EmbeddingProviderName,
    ...(form.value.baseUrl !== undefined && form.value.baseUrl !== "" ? { baseUrl: form.value.baseUrl } : {}),
    ...(form.value.apiKey !== undefined && form.value.apiKey !== "" ? { apiKey: form.value.apiKey } : {}),
    model: form.value.model,
    dimension: form.value.dimension,
    ...(form.value.provider === "dashscope" && form.value.textType ? { textType: form.value.textType } : {}),
  };
  const r = await store.saveEmbeddingConfig(body);
  saving.value = false;
  if (r.ok) {
    dirty.value = false;
    // 保存后清空 apiKey 输入框（避免明文常驻 DOM）
    if (form.value) {
      form.value.apiKey = "";
    }
  } else if (r.conflict) {
    conflictMsg.value = "数据已被其他会话修改，请刷新后重试";
    await store.loadEmbeddingConfig();
  }
}

// 标记 dirty：监听 form 变化
watch(form, () => {
  dirty.value = true;
}, { deep: true });
</script>