<!--
  MailAccountsTab.vue —— 阶段 7.4h

  邮件账号列表编辑：增 / 删 / 改默认 / 改字段 / 一次性保存。
  - 多账号时必须有一个 isDefault（后端兜底校验）
  - password 字段默认隐藏；显示/隐藏按钮
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">邮件发送账号 (SMTP)</h2>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="addAccount">+ 新增账号</button>
        <button class="btn-primary" :disabled="!dirty || saving" @click="onSave">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>
    <p v-if="validationError" class="text-xs text-amber-700">{{ validationError }}</p>
    <p v-if="conflictMsg" class="text-xs text-amber-700">{{ conflictMsg }}</p>

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else-if="form.accounts.length === 0" class="text-xs text-slate-600">
      尚未配置任何邮件账号；点击"+ 新增账号"开始。
    </div>
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="(a, idx) in form.accounts"
        :key="a.id || idx"
        class="rounded border border-border p-3"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <input
            v-model="a.displayName"
            placeholder="显示名（例：公司主邮箱）"
            class="flex-1 rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
          />
          <div class="flex items-center gap-2 text-xs text-slate-600">
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                :checked="a.isDefault"
                @change="onSetDefault(a.id)"
              />
              <span>默认</span>
            </label>
            <button
              class="text-red-400 hover:text-red-300"
              @click="removeAccount(idx)"
            >删除</button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>SMTP Host</span>
            <input
              v-model="a.host"
              placeholder="smtp.example.com"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>Port</span>
            <input
              v-model.number="a.port"
              type="number"
              min="1"
              max="65535"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>SSL</span>
            <select
              v-model="a.ssl"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            >
              <option value="tls">tls（连接时）</option>
              <option value="starttls">starttls（EHLO 后升级）</option>
              <option value="none">none（明文）</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>用户名</span>
            <input
              v-model="a.username"
              placeholder="user@example.com"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>密码</span>
            <div class="flex gap-1">
              <input
                :type="showPw[a.id] ? 'text' : 'password'"
                v-model="a.password"
                placeholder="••••••"
                class="flex-1 rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
              />
              <button
                class="rounded bg-surface-sunken px-2 text-xs text-slate-700 hover:bg-slate-600"
                @click="togglePw(a.id)"
              >
                {{ showPw[a.id] ? "隐藏" : "显示" }}
              </button>
            </div>
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            <span>From 地址（email 或 "Name {{'<'}}a@b{{'>'}}"）</span>
            <input
              v-model="a.fromAddress"
              placeholder="user@example.com"
              class="rounded bg-surface-alt px-2 py-1 text-xs text-slate-800"
            />
          </label>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.store.ts";
import type { MailAccountDTO } from "../api/settings.api.ts";

const store = useSettingsStore();

const form = ref<{ accounts: MailAccountDTO[] } | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictMsg = ref<string | null>(null);
const showPw = ref<Record<string, boolean>>({});

function syncFromStore(): void {
  // snap 为 null（后端无 setting 行）也用空数组渲染，让用户能直接"新增账号"
  const snap = store.mailAccounts;
  form.value = {
    accounts: (snap?.accounts ?? []).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      host: a.host,
      port: a.port,
      username: a.username,
      password: a.password,
      fromAddress: a.fromAddress,
      ssl: a.ssl,
      isDefault: a.isDefault,
    })),
  };
  dirty.value = false;
  conflictMsg.value = null;
  for (const a of form.value.accounts) showPw.value[a.id] = false;
}

watch(() => store.mailAccounts, syncFromStore, { immediate: true });

function newId(): string {
  // 简单 UUID v4 —— 后端不会 trust，仅做本地 key
  return crypto.randomUUID();
}

function addAccount(): void {
  if (!form.value) return;
  form.value.accounts.push({
    id: newId(),
    displayName: "",
    host: "",
    port: 465,
    username: "",
    password: "",
    fromAddress: "",
    ssl: "tls",
    isDefault: form.value.accounts.length === 0,
  });
  dirty.value = true;
}

function removeAccount(idx: number): void {
  if (!form.value) return;
  const removed = form.value.accounts.splice(idx, 1)[0];
  // 删除后：若无 default，自动选第一个
  if (removed.isDefault && form.value.accounts.length > 0) {
    form.value.accounts[0].isDefault = true;
  }
  dirty.value = true;
}

function onSetDefault(id: string): void {
  if (!form.value) return;
  for (const a of form.value.accounts) {
    a.isDefault = a.id === id;
  }
  dirty.value = true;
}

function togglePw(id: string): void {
  showPw.value[id] = !showPw.value[id];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validationError = computed<string | null>(() => {
  if (!form.value) return null;
  const ids = new Set<string>();
  for (const a of form.value.accounts) {
    if (!a.id) return "账号 ID 缺失";
    if (ids.has(a.id)) return "账号 ID 重复";
    ids.add(a.id);
    if (!a.host) return `${a.displayName || a.id}: host 不能为空`;
    if (!a.username) return `${a.displayName || a.id}: username 不能为空`;
    if (!a.fromAddress) return `${a.displayName || a.id}: fromAddress 不能为空`;
    // 接受 "Name <addr>" 格式
    const m = a.fromAddress.match(/<([^>]+)>$/);
    const addr = m ? m[1] : a.fromAddress;
    if (!EMAIL_RE.test(addr ?? "")) return `${a.displayName || a.id}: fromAddress 不是合法 email`;
    if (a.port < 1 || a.port > 65535) return `${a.displayName || a.id}: port ∈ [1,65535]`;
  }
  if (form.value.accounts.length > 1) {
    const def = form.value.accounts.filter((a) => a.isDefault);
    if (def.length === 0) return "多账号时必须设置默认账号";
    if (def.length > 1) return "只能有一个默认账号";
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
  const r = await store.saveMailAccounts({
    accounts: form.value.accounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      host: a.host,
      port: a.port,
      username: a.username,
      password: a.password,
      fromAddress: a.fromAddress,
      ssl: a.ssl,
      isDefault: a.isDefault,
    })),
  });
  saving.value = false;
  if (r.ok) {
    dirty.value = false;
    // 保存后清空密码
    if (form.value) for (const a of form.value.accounts) a.password = "";
  } else if (r.conflict) {
    conflictMsg.value = "数据已被其他会话修改，请刷新后重试";
    await store.loadMailAccounts();
  }
}

watch(form, () => {
  dirty.value = true;
}, { deep: true });
</script>