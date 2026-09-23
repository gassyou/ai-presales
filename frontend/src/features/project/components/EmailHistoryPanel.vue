<!--
  EmailHistoryPanel.vue
  ====================
  邮件发送历史（阶段 7.4e）。

  形态：表格 + 点击行弹只读详情。
  列：主题 / 收件人 / 状态 / sent_at / 附件数 / 操作（删除仅 draft）
-->
<template>
  <section class="flex flex-col gap-2">
    <header class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-slate-800">邮件历史（{{ emails.length }}）</h3>
      <button
        v-if="emails.length > 0"
        class="rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
        @click="reload"
      >刷新</button>
    </header>

    <p v-if="error" class="rounded border border-red-900 bg-red-900/30 px-2 py-1 text-xs text-red-300">
      {{ error }}
    </p>

    <div v-if="loading && emails.length === 0" class="text-xs text-slate-500">加载中…</div>

    <table v-else-if="emails.length > 0" class="w-full text-xs">
      <thead class="text-slate-600">
        <tr class="border-b border-border text-left">
          <th class="px-2 py-1">主题</th>
          <th class="px-2 py-1">收件人</th>
          <th class="px-2 py-1">状态</th>
          <th class="px-2 py-1">时间</th>
          <th class="px-2 py-1 text-right">附件</th>
          <th class="px-2 py-1 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="e in emails"
          :key="e.id"
          class="cursor-pointer border-b border-border/50 hover:bg-surface-alt/30"
          @click="view(e)"
        >
          <td class="max-w-[180px] truncate px-2 py-1 text-slate-800" :title="e.subject">{{ e.subject || "（无主题）" }}</td>
          <td class="px-2 py-1 text-slate-600">
            {{ e.to.slice(0, 2).map((a) => a.name || a.email).join(", ") }}
            <span v-if="e.to.length > 2" class="text-slate-500">+{{ e.to.length - 2 }}</span>
          </td>
          <td class="px-2 py-1">
            <span
              :class="e.status === 'sent'
                ? 'rounded bg-accent-soft px-1 text-emerald-700'
                : e.status === 'failed'
                ? 'rounded bg-red-900/40 px-1 text-red-300'
                : 'rounded bg-surface-sunken px-1 text-slate-700'"
            >{{ STATUS_LABEL[e.status] }}</span>
          </td>
          <td class="px-2 py-1 text-slate-500">{{ formatTime(e.sentAt ?? e.updatedAt) }}</td>
          <td class="px-2 py-1 text-right text-slate-600">{{ e.attachmentCount ?? "—" }}</td>
          <td class="px-2 py-1 text-right">
            <button
              v-if="e.status === 'draft'"
              class="rounded border border-red-900/50 px-1.5 py-0.5 text-red-300 hover:bg-red-900/30"
              @click.stop="remove(e.id)"
            >删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p
      v-else
      class="rounded border border-dashed border-border bg-white/30 p-3 text-center text-xs text-slate-500"
    >暂无邮件。点右上「发送邮件」按钮起草第一封。</p>

    <EmailViewDialog
      v-if="viewing"
      :project-id="projectId"
      :email="viewing"
      :attachments="viewAttachments"
      :loading-attachments="loadingAttachments"
      @close="closeView"
      @downloaded="reload"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { emailApi, type EmailDTO, type EmailAttachmentDTO } from "../api/email.api.ts";
import { http, ApiError } from "@frontend/shared/api/http-client.ts";
import EmailViewDialog from "./EmailViewDialog.vue";

/** EmailDTO + 客户端补的 attachmentCount 字段 */
type EmailRow = EmailDTO & { attachmentCount?: number };

const props = defineProps<{
  projectId: string;
}>();

const STATUS_LABEL: Record<EmailDTO["status"], string> = {
  draft: "草稿",
  sent: "已发送",
  failed: "失败",
};

const emails = ref<EmailRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const viewing = ref<EmailDTO | null>(null);
const viewAttachments = ref<EmailAttachmentDTO[]>([]);
const loadingAttachments = ref(false);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const r = await emailApi.list(props.projectId);
    // 每个邮件附 attachmentCount（轻度并发拉取）
    const counts = await Promise.all(r.items.map(async (e) => {
      try {
        const att = await emailApi.listAttachments(props.projectId, e.id);
        return { id: e.id, count: att.items.length };
      } catch {
        return { id: e.id, count: 0 };
      }
    }));
    const map = new Map(counts.map((c) => [c.id, c.count]));
    emails.value = r.items.map((e) => ({ ...e, attachmentCount: map.get(e.id) ?? 0 }));
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function view(e: EmailRow): Promise<void> {
  viewing.value = e;
  viewAttachments.value = [];
  loadingAttachments.value = true;
  try {
    const r = await emailApi.listAttachments(props.projectId, e.id);
    viewAttachments.value = r.items;
  } catch (err) {
    error.value = errMsg(err);
  } finally {
    loadingAttachments.value = false;
  }
}

function closeView(): void {
  viewing.value = null;
  viewAttachments.value = [];
}

async function remove(id: string): Promise<void> {
  if (!confirm("删除该草稿？")) return;
  // 后端 DELETE 端点：DELETE /api/projects/:id/emails/:emailId
  try {
    await http.del<{ ok: true }>(`/api/projects/${props.projectId}/emails/${id}`);
    await reload();
  } catch (e) {
    error.value = errMsg(e);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error ? e.message : String(e);
}

watch(() => props.projectId, () => { void reload(); });
onMounted(() => { void reload(); });
</script>