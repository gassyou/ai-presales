<!--
  EmailViewDialog.vue
  ==================
  邮件只读查看弹窗（阶段 7.4e + Element Plus 迁移）。

  形态：半屏 modal + 元数据条 + TO/CC + 正文 + 附件列表（可下载）。
-->
<template>
  <el-dialog
    :model-value="true"
    :title="email.subject || '（无主题）'"
    width="640"
    @update:model-value="(v) => !v && emit('close')"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1 text-xs text-slate-600">
        <div>
          <span class="text-slate-500">收件人：</span>
          <span>{{ email.to.map((a) => a.name ? `${a.name} <${a.email}>` : a.email).join(", ") }}</span>
        </div>
        <div v-if="email.cc.length > 0">
          <span class="text-slate-500">抄送：</span>
          <span>{{ email.cc.map((a) => a.name ? `${a.name} <${a.email}>` : a.email).join(", ") }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-slate-500">状态：</span>
          <el-tag :type="statusTagType" size="small" effect="light">{{ statusLabel }}</el-tag>
          <span v-if="email.sentAt" class="text-slate-500">· 发送于 {{ formatTime(email.sentAt) }}</span>
        </div>
      </div>

      <pre class="max-h-96 overflow-auto rounded border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-slate-800">{{ email.body }}</pre>

      <div class="flex flex-col gap-1 border-t border-border pt-2 text-xs">
        <span class="text-slate-600">附件（{{ attachments.length }}）</span>
        <div v-if="loadingAttachments" class="text-slate-500">加载中…</div>
        <ul v-else-if="attachments.length > 0" class="flex flex-wrap gap-2">
          <li
            v-for="a in attachments"
            :key="a.id"
            class="flex items-center gap-1 rounded border border-border bg-canvas px-2 py-1"
          >
            <span class="text-slate-700">{{ a.filename }}</span>
            <span class="text-slate-500">{{ formatSize(a.size) }}</span>
            <el-button size="small" link @click="download(a)">下载</el-button>
          </li>
        </ul>
        <div v-else class="text-slate-500">无附件</div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { EmailDTO, EmailAttachmentDTO } from "../api/email.api.ts";
import { emailApi } from "../api/email.api.ts";

const props = defineProps<{
  projectId: string;
  email: EmailDTO;
  attachments: readonly EmailAttachmentDTO[];
  loadingAttachments: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "downloaded"): void;
}>();

const STATUS_LABEL: Record<EmailDTO["status"], string> = {
  draft: "草稿",
  sent: "已发送",
  failed: "失败",
};

const statusLabel = computed(() => STATUS_LABEL[props.email.status]);
const statusTagType = computed<"info" | "success" | "danger">(() => {
  switch (props.email.status) {
    case "sent": return "success";
    case "failed": return "danger";
    default: return "info";
  }
});

async function download(a: EmailAttachmentDTO): Promise<void> {
  await emailApi.downloadAttachment(props.projectId, props.email.id, a.id, a.filename);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}
</script>