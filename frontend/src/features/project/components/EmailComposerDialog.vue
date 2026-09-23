<!--
  EmailComposerDialog.vue
  =======================
  邮件撰写弹窗（阶段 7.4e）。

  形态：
    - 半屏 modal（覆盖 80% 高度，保留工作台上下文）
    - 顶部：主题 input
    - TO/CC：可增删的可编辑标签条（chip 式）
    - 正文 textarea（等宽字体）
    - 附件列表 + 文件选择器
    - 底部：AI 起草 / 保存草稿 / 发送 三按钮

  数据流：
    1. 「AI 起草」：用 business-email-writer sub-agent 流式追加到 body
    2. 「保存草稿」：upsert（按是否有 emailId 走 create 或 update）
    3. 「发送」：create → uploadAttachments → send
-->
<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4"
    @click.self="onClose"
  >
    <div class="flex h-[80vh] w-full max-w-3xl flex-col gap-3 rounded border border-border bg-white p-4">
      <header class="flex items-center justify-between border-b border-border pb-2">
        <h3 class="text-sm font-medium text-slate-800">
          发送邮件 — 项目 {{ projectId.slice(0, 8) }}
        </h3>
        <button
          class="rounded text-slate-600 hover:bg-surface-alt hover:text-slate-800 px-2"
          @click="onClose"
        >关闭</button>
      </header>

      <p v-if="error" class="rounded border border-red-900 bg-red-900/30 px-3 py-1 text-xs text-red-300">
        {{ error }}
      </p>

      <label class="text-xs text-slate-600">
        主题
        <input
          v-model="subject"
          class="mt-1 w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-slate-800"
          placeholder="邮件主题（≤ 20 字）"
          :disabled="sending"
        />
      </label>

      <div class="text-xs text-slate-600">
        收件人 (TO)
        <AddressChips
          v-model="to"
          class="mt-1"
          :disabled="sending"
          placeholder="按 Enter 添加邮箱…"
        />
      </div>

      <div class="text-xs text-slate-600">
        抄送 (CC)
        <AddressChips
          v-model="cc"
          class="mt-1"
          :disabled="sending"
          placeholder="按 Enter 添加邮箱…"
        />
      </div>

      <div class="flex min-h-0 flex-1 flex-col text-xs text-slate-600">
        <div class="mb-1 flex items-center justify-between">
          <span>正文</span>
          <button
            class="rounded border border-accent/50 px-2 py-0.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
            :disabled="aiRunning || sending"
            @click="onAiDraft"
          >{{ aiRunning ? "起草中…" : "AI 起草" }}</button>
        </div>
        <textarea
          v-model="body"
          class="min-h-0 flex-1 rounded border border-border bg-canvas p-2 font-mono text-xs text-slate-800"
          placeholder="邮件正文…"
          :disabled="sending"
        />
      </div>

      <!-- 附件 -->
      <div class="flex flex-col gap-2 text-xs text-slate-600">
        <div class="flex items-center justify-between">
          <span>附件（{{ attachments.length }}）</span>
          <label class="cursor-pointer rounded border border-border px-2 py-0.5 text-slate-700 hover:bg-surface-alt">
            + 添加附件
            <input
              type="file"
              multiple
              class="hidden"
              :disabled="sending"
              @change="onPickFiles"
            />
          </label>
        </div>
        <ul v-if="attachments.length > 0" class="flex flex-wrap gap-1">
          <li
            v-for="a in attachments"
            :key="a.localId"
            class="flex items-center gap-1 rounded border border-border bg-canvas px-1.5 py-0.5 text-[11px]"
          >
            <span>{{ a.filename }}</span>
            <span class="text-slate-500">{{ formatSize(a.size) }}</span>
            <button
              v-if="!sending"
              class="text-red-300 hover:text-red-100"
              @click="removeLocalAttachment(a.localId)"
            >×</button>
          </li>
        </ul>
      </div>

      <footer class="flex items-center justify-between border-t border-border pt-2">
        <span class="text-[11px] text-slate-500">
          {{ sending ? "处理中…" : emailId ? `草稿 ${emailId.slice(0, 8)}…` : "尚未保存" }}
        </span>
        <div class="flex gap-2">
          <button
            class="rounded border border-border px-3 py-1 text-xs text-slate-700 hover:bg-surface-alt"
            :disabled="sending"
            @click="onSaveDraft"
          >保存草稿</button>
          <button
            class="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
            :disabled="sending || !subject.trim()"
            @click="onSend"
          >{{ sending ? "发送中…" : "发送" }}</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { emailApi, type EmailAddress } from "../api/email.api.ts";
import { subAgentApi } from "@frontend/features/sub-agent/api/sub-agent.api.ts";
import { useEmailComposerStore } from "../stores/email-composer.store.ts";
import { projectApi } from "../api/project.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import AddressChips from "./AddressChips.vue";

const store = useEmailComposerStore();
const projectId = computed(() => store.projectId ?? "");
const open = computed(() => store.open);

const subject = ref("");
const body = ref("");
const to = ref<EmailAddress[]>([]);
const cc = ref<EmailAddress[]>([]);

interface LocalAttachment {
  localId: string;
  filename: string;
  mime: string;
  size: number;
  file: File;
}

const attachments = ref<LocalAttachment[]>([]);
const emailId = ref<string | null>(null);
const error = ref<string | null>(null);
const sending = ref(false);
const aiRunning = ref(false);

watch(open, async (isOpen) => {
  if (isOpen) {
    await loadDefaults();
  } else {
    resetState();
  }
});

onMounted(async () => {
  if (open.value) await loadDefaults();
});

async function loadDefaults(): Promise<void> {
  error.value = null;
  subject.value = "";
  body.value = "";
  emailId.value = null;
  attachments.value = [];
  try {
    // 默认收件人 = 主联系人；抄送 = 团队成员
    const proj = await projectApi.get(projectId.value);
    const primary = proj.contacts.find((c) => c.isPrimary) ?? proj.contacts[0];
    to.value = primary ? [{ name: primary.name, email: primary.email ?? "" }] : [];
    cc.value = proj.teamMembers
      .filter((m) => m.email)
      .map((m) => ({ name: m.name, email: m.email ?? "" }));
  } catch (e) {
    // 不阻断弹窗
    console.warn("load project for email defaults failed", e);
  }
}

function resetState(): void {
  subject.value = "";
  body.value = "";
  to.value = [];
  cc.value = [];
  attachments.value = [];
  emailId.value = null;
  error.value = null;
}

function onClose(): void {
  if (sending.value) return;
  store.close();
}

function onPickFiles(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (!target.files) return;
  for (const f of Array.from(target.files)) {
    attachments.value.push({
      localId: crypto.randomUUID(),
      filename: f.name,
      mime: f.type || "application/octet-stream",
      size: f.size,
      file: f,
    });
  }
  target.value = "";
}

function removeLocalAttachment(localId: string): void {
  attachments.value = attachments.value.filter((a) => a.localId !== localId);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function onAiDraft(): Promise<void> {
  aiRunning.value = true;
  body.value = "";
  try {
    const input = subject.value.trim().length > 0
      ? `主题：${subject.value.trim()}\n请按商务风格起草邮件正文（3~5 段）`
      : "请按商务风格起草一封给客户的邮件正文（3~5 段；先写占位主题）";
    let draft = "";
    for await (const ev of subAgentApi.invoke("business-email-writer", {
      input,
      projectId: projectId.value,
    })) {
      if (ev.type === "chunk") draft += ev.delta;
      else if (ev.type === "error") {
        error.value = `${ev.code}: ${ev.message}`;
        return;
      }
    }
    body.value = draft;
    // 尝试从正文首行解析主题（"主题：xxxx"）
    const m = draft.match(/^主题[:：]\s*(.+?)$/m);
    if (m && subject.value.trim().length === 0) subject.value = m[1].trim().slice(0, 80);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    aiRunning.value = false;
  }
}

async function ensureDraft(): Promise<string | null> {
  const payload = {
    subject: subject.value,
    body: body.value,
    to: to.value,
    cc: cc.value,
  };
  if (emailId.value) {
    const r = await emailApi.update(projectId.value, emailId.value, payload);
    emailId.value = r.id;
    return r.id;
  }
  const r = await emailApi.create(projectId.value, payload);
  emailId.value = r.id;
  return r.id;
}

async function onSaveDraft(): Promise<void> {
  sending.value = true;
  error.value = null;
  try {
    await ensureDraft();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    sending.value = false;
  }
}

async function onSend(): Promise<void> {
  if (to.value.length === 0) {
    error.value = "至少需要一个收件人";
    return;
  }
  sending.value = true;
  error.value = null;
  try {
    const id = await ensureDraft();
    if (!id) throw new Error("draft id missing");
    // 上传附件
    for (const a of attachments.value) {
      await emailApi.uploadAttachment(projectId.value, id, a.file);
    }
    await emailApi.send(projectId.value, id);
    store.close();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    sending.value = false;
  }
}

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error ? e.message : String(e);
}
</script>