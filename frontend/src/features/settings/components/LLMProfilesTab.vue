<!--
  LLMProfilesTab.vue —— 阶段 7.4h + Element Plus 迁移

  LLM profile 列表编辑：增 / 删 / 改默认 / 改字段 / 一次性保存。
  - apiKey 默认 type=password，提供"显示/隐藏"切换；保存后清空输入框
  - 校验：profile name 唯一、provider ∈ {anthropic, openai}、
    temperature ∈ [0,2]、maxTokens ≥ 1；后端会兜底校验
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">模型配置 (LLM profiles)</h2>
      <div class="flex gap-2">
        <el-button @click="addProfile">+ 新增 profile</el-button>
        <el-button
          type="primary"
          :disabled="!dirty || saving"
          :loading="saving"
          @click="onSave"
        >
          {{ saving ? "保存中…" : "保存" }}
        </el-button>
      </div>
    </header>

    <el-alert v-if="store.error" :title="store.error" type="error" :closable="false" show-icon />
    <el-alert v-if="conflictMsg" :title="conflictMsg" type="warning" :closable="false" show-icon />

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="(p, idx) in form.profiles"
        :key="p.name || idx"
        class="rounded border border-border p-3"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <el-input
            v-model="p.name"
            placeholder="profile 名 (字母开头，字母数字_-)"
            size="small"
            class="!w-64"
          />
          <div class="flex items-center gap-2 text-xs text-slate-600">
            <el-radio
              :model-value="form.defaultProfile === p.name"
              :disabled="!p.name"
              @change="onSetDefault(p.name)"
            >
              默认
            </el-radio>
            <el-button
              link
              type="danger"
              :disabled="form.profiles.length <= 1"
              @click="removeProfile(idx)"
            >删除</el-button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <el-form-item label-position="top" label="供应商（Provider）" class="!mb-2">
            <el-select v-model="p.provider" size="small">
              <el-option label="anthropic" value="anthropic" />
              <el-option label="openai" value="openai" />
            </el-select>
          </el-form-item>

          <el-form-item label-position="top" label="基础地址（Base URL，可省）" class="!mb-2">
            <el-input v-model="p.baseUrl" placeholder="https://api.example.com" size="small" />
          </el-form-item>

          <el-form-item label-position="top" label="模型（Model）" class="!mb-2">
            <el-input v-model="p.model" placeholder="claude-sonnet-4.5 / gpt-4o" size="small" />
          </el-form-item>

          <el-form-item label-position="top" label="API 密钥（API Key）" class="!mb-2">
            <div class="flex gap-1">
              <el-input
                v-model="p.apiKey"
                :type="showKeys[p.name] ? 'text' : 'password'"
                placeholder="sk-..."
                size="small"
                show-password
              />
              <el-button size="small" @click="toggleShow(p.name)">
                {{ showKeys[p.name] ? "隐藏" : "显示" }}
              </el-button>
            </div>
          </el-form-item>

          <el-form-item label-position="top" label="温度（Temperature，0-2）" class="!mb-2">
            <el-input-number
              v-model="p.temperature"
              :min="0"
              :max="2"
              :step="0.1"
              size="small"
              controls-position="right"
            />
          </el-form-item>

          <el-form-item label-position="top" label="最大 Token 数（Max tokens）" class="!mb-2">
            <el-input-number
              v-model="p.maxTokens"
              :min="1"
              :step="1"
              size="small"
              controls-position="right"
            />
          </el-form-item>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.store.ts";
import type { LLMProfileConfigDTO } from "../api/settings.api.ts";

const store = useSettingsStore();

const form = ref<{ defaultProfile: string; profiles: LLMProfileConfigDTO[] } | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictMsg = ref<string | null>(null);
const showKeys = ref<Record<string, boolean>>({});

function syncFromStore(): void {
  const snap = store.llmProfiles;
  if (!snap) {
    form.value = null;
    return;
  }
  form.value = {
    defaultProfile: snap.defaultProfile,
    profiles: snap.profiles.map((p) => ({
      name: p.name,
      provider: p.provider,
      ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
      apiKey: p.apiKey,
      model: p.model,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
    })),
  };
  dirty.value = false;
  conflictMsg.value = null;
  // 保存后默认隐藏所有 key
  for (const p of form.value.profiles) showKeys.value[p.name] = false;
}

watch(() => store.llmProfiles, syncFromStore, { immediate: true });

function addProfile(): void {
  if (!form.value) return;
  const idx = form.value.profiles.length + 1;
  form.value.profiles.push({
    name: `profile-${idx}`,
    provider: "anthropic",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: 8192,
  });
  dirty.value = true;
}

function removeProfile(idx: number): void {
  if (!form.value) return;
  if (form.value.profiles.length <= 1) return;
  const removed = form.value.profiles.splice(idx, 1)[0];
  if (form.value.defaultProfile === removed.name) {
    form.value.defaultProfile = form.value.profiles[0]?.name ?? "";
  }
  dirty.value = true;
}

function onSetDefault(name: string): void {
  if (!form.value) return;
  form.value.defaultProfile = name;
  dirty.value = true;
}

function toggleShow(name: string): void {
  showKeys.value[name] = !showKeys.value[name];
}

const validationError = computed<string | null>(() => {
  if (!form.value) return null;
  if (form.value.profiles.length === 0) return "至少保留 1 个 profile";
  const seen = new Set<string>();
  for (const p of form.value.profiles) {
    if (!p.name) return "profile 名不能为空";
    if (seen.has(p.name)) return `profile 名重复: ${p.name}`;
    seen.add(p.name);
    if (!p.apiKey) return `${p.name}: apiKey 不能为空`;
    if (!p.model) return `${p.name}: model 不能为空`;
    if (p.temperature < 0 || p.temperature > 2) return `${p.name}: temperature ∈ [0,2]`;
    if (p.maxTokens < 1) return `${p.name}: maxTokens ≥ 1`;
  }
  if (!form.value.profiles.find((p) => p.name === form.value!.defaultProfile)) {
    return "默认 profile 必须存在";
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
  const r = await store.saveLLMProfiles({
    defaultProfile: form.value.defaultProfile,
    profiles: form.value.profiles.map((p) => ({
      name: p.name,
      provider: p.provider,
      ...(p.baseUrl !== undefined && p.baseUrl !== "" ? { baseUrl: p.baseUrl } : {}),
      apiKey: p.apiKey,
      model: p.model,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
    })),
  });
  saving.value = false;
  if (r.ok) {
    dirty.value = false;
    // 保存后清空 API key 输入框（避免明文常驻 DOM）
    if (form.value) {
      for (const p of form.value.profiles) {
        p.apiKey = "";
      }
    }
  } else if (r.conflict) {
    conflictMsg.value = "数据已被其他会话修改，请刷新后重试";
    await store.loadLLMProfiles();
  }
}

// 标记 dirty：监听 form 变化
watch(form, () => {
  dirty.value = true;
}, { deep: true });
</script>