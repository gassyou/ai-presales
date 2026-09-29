<!--
  ChatComposer.vue
  ================
  AI 对话输入卡片（Claude 风）

  布局：
    ┌──────────────────────────────────────────────────────┐
    │  [多行 textarea，自动扩展高度]                          │
    │ ─────────────────────────────────────────────────────│
    │  [+]                    [Profile ▾]      [发送]      │
    └──────────────────────────────────────────────────────┘

  - textarea 自动扩展高度（1-5 行）
  - 底栏左侧：[+] 添加（实际触发文件选择，PR #7）；附件改由 / 命令 + skill 提供
  - 底栏右侧：profile 下拉（来自 llm-profiles store）+ 发送按钮
  - 加载中显示"停止"按钮替换发送按钮
  - @ mention 弹窗仍然支持
-->
<template>
  <form
    class="mx-3 mb-3 mt-1 rounded-xl border border-border bg-white shadow-card"
    @submit.prevent="onSend"
  >
    <div class="relative px-3 pt-2">
      <textarea
        ref="inputRef"
        v-model="input"
        rows="3"
        :placeholder="placeholder"
        class="block w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
        style="min-height: 84px; max-height: 168px"
        @input="onInput"
        @keydown="onKeyDown"
        @keydown.enter.exact.prevent="onSend"
      />
      <MentionAutocomplete
        :visible="mentionState.visible"
        :query="mentionState.query"
        :candidates="mentionState.candidates"
        :position="mentionState.position"
        :active-index="mentionState.activeIndex"
        @select="onMentionPick"
        @dismiss="closeMention"
      />
      <div
        v-if="slashState.visible"
        class="absolute z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-md border border-border bg-white shadow-lg"
        :style="{ left: '12px', top: '88px' }"
      >
        <div
          v-for="(item, idx) in slashState.items"
          :key="item.label"
          :class="[
            'flex cursor-pointer flex-col px-3 py-1.5 text-xs',
            idx === slashState.activeIndex
              ? 'bg-emerald-50 text-slate-900'
              : 'text-slate-700 hover:bg-slate-50',
          ]"
          @mousedown.prevent="onSlashPick(item)"
        >
          <span class="font-medium">{{ item.label }}</span>
          <span class="text-[10px] text-slate-500">{{ item.description }}</span>
        </div>
        <div v-if="slashState.items.length === 0" class="px-3 py-2 text-xs text-slate-500">
          （没有可用 skill —— 后端未注册）
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
      <!-- 阶段 13（PR #7）：[+] 按钮触发 hidden <input type="file">；选完 → 上传 → 写入 session 历史 -->
      <div class="flex items-center gap-1 text-slate-500">
        <el-button
          link
          size="small"
          :disabled="store.loading"
          :title="store.currentSessionId ? '添加附件' : '请先选择会话'"
          class="!text-slate-500"
          @click="onPickFileClick"
        >
          <el-icon><Plus /></el-icon>
        </el-button>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="hidden"
          @change="onFilesPicked"
        />
      </div>

      <div class="flex items-center gap-1">
        <!-- 阶段 13（PR #8）：会话级"全部自动批准工具"开关（移到模型下拉框左边） -->
        Auto:
        <el-switch
          v-if="store.currentSessionId"
          :model-value="store.autoApprove"
          size="small"
          inline-prompt
          :title="store.autoApprove
            ? '当前会话：所有工具自动执行（关掉恢复逐个审批）'
            : '当前会话：每个需审批的工具会问你（开启后全部自动执行）'"
          @update:model-value="(v) => onAutoApproveChange(!!v)"
        >
          <template #active-content>
            <span class="flex items-center gap-1"><el-icon><Unlock /></el-icon></span>
          </template>
          <template #inactive-content>
            <span class="flex items-center gap-1"><el-icon><Lock /></el-icon></span>
          </template>
        </el-switch>

        <!-- 阶段 13（PR #6）：profile 下拉数据源改为 llm-profiles store（来自系统设置）；
             删除 sub-agent picker 与 tools 切换（默认 agent 模式） -->
        <el-select
          :model-value="store.profile"
          size="small"
          style="width: 150px"
          :loading="llmStore.loading"
          @change="onProfileChange"
        >
          <el-option
            v-for="p in llmStore.items"
            :key="p.id"
            :label="`${p.label}`"
            :value="p.id"
          />
        </el-select>

        <el-button
          v-if="!store.loading"
          type="primary"
          size="small"
          circle
          :disabled="input.length === 0"
          title="发送"
          @click="onSend"
        >
          <el-icon><Top /></el-icon>
        </el-button>
        <el-button
          v-else
          size="small"
          circle
          title="停止"
          @click="store.stop"
        >
          <span class="text-base leading-none">■</span>
        </el-button>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, reactive, watch } from "vue";
import { ElMessage } from "element-plus";
import { Lock, Plus, Top, Unlock } from "@element-plus/icons-vue";
import { useAiChatStore } from "./stores/ai-chat.store.ts";
import MentionAutocomplete from "./MentionAutocomplete.vue";
import { useSkillStore } from "@frontend/features/skill/stores/skill.store.ts";
import { useLlmProfilesStore } from "@frontend/features/settings/stores/llm-profiles.store.ts";
import { chatAttachmentApi } from "./api/ai-chat.api.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";

const store = useAiChatStore();
const skillStore = useSkillStore();
const llmStore = useLlmProfilesStore();
const input = ref("");
const inputRef = ref<HTMLTextAreaElement | null>(null);

// 阶段 13（PR #6）：profile 默认值优先用 default profile，否则取首项；
// 老的硬编码 ["fast","deep","local"] 彻底废弃。
function resolveDefaultProfile(): string {
  if (llmStore.defaultProfile) return llmStore.defaultProfile;
  const first = llmStore.items[0]?.id;
  return first ?? "";
}

// 当 store.profile 与当前可用 profile 不匹配 → 自动纠偏
watch(
  () => llmStore.items,
  (items) => {
    if (items.length === 0) return;
    const valid = items.some((p) => p.id === store.profile);
    if (!valid) {
      const next = resolveDefaultProfile();
      if (next) store.setProfile(next);
    }
  },
  { immediate: true },
);

function onProfileChange(id: string): void {
  store.setProfile(id);
}

// 阶段 13（PR #8）：切换会话级"全部自动批准工具"开关。
// store.setAutoApprove 内部乐观更新 + 远端 PATCH + 失败回滚。
function onAutoApproveChange(on: boolean): void {
  void store.setAutoApprove(on);
}

const placeholder = computed(() => {
  if (store.currentProject) {
    return `向 AI 提问（绑定项目 ${store.currentProject.code}）；Shift+Enter 换行，Enter 发送；输入 @ 引用其他项目`;
  }
  return "向 AI 提问；Shift+Enter 换行，Enter 发送；输入 @ 引用项目";
});

// @ 候选弹窗状态
const mentionState = reactive({
  visible: false,
  query: "",
  position: { top: 0, left: 0 },
  candidates: [] as ProjectDTO[],
  activeIndex: 0,
  range: { start: 0, end: 0 } as { start: number; end: number },
});

// 阶段 13（PR #5）：slash 弹窗状态 —— 输入框内容以 "/" 开头（且无空格）时弹出
interface SlashEntry {
  label: string;
  description: string;
  insert: string; // 选中后插入到 textarea 的字符串
}
const slashState = reactive({
  visible: false,
  items: [] as SlashEntry[],
  activeIndex: 0,
});

// 阶段 13（PR #5）：挂载时预加载 skill 列表，避免首次 "/" 弹空白
// 阶段 13（PR #6）：同时拉 llm profiles，profile select 不再硬编码
onMounted(() => {
  void skillStore.load();
  void llmStore.load();
});

function autosize(): void {
  const ta = inputRef.value;
  if (!ta) return;
  ta.style.height = "auto";
  // 限制最大高度 168px（约 5-6 行）；超出后内部滚动
  ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
}

function onSend(): void {
  if (mentionState.visible) closeMention();
  if (slashState.visible) closeSlash();
  const v = input.value;
  if (v.length === 0) return;
  input.value = "";
  // 阶段 13（PR #5）：/skill <name> [extra] 直调 —— 不走 LLM
  const skillRe = /^\/skill\s+(\w+)(?:\s+([\s\S]+))?$/;
  const m = v.match(skillRe);
  if (m) {
    const name = m[1];
    const extra = (m[2] ?? "").trim();
    let args: Record<string, unknown> = {};
    if (extra) {
      try {
        const parsed = JSON.parse(extra);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          args = { message: extra };
        }
      } catch {
        args = { message: extra };
      }
    }
    void store.executeSkill(name, args);
    nextTick(autosize);
    return;
  }
  void store.send(v);
  // 重置 textarea 高度
  nextTick(autosize);
}

/** 输入变化时：autosize + 检测是否在 @xxx 中 */
function onInput(): void {
  autosize();
  const text = input.value;
  const ta = inputRef.value;
  const cursorPos = ta?.selectionStart ?? text.length;
  const before = text.slice(0, cursorPos);
  // 阶段 13（PR #5）：slash popover 检测 —— 以 "/" 开头的整行（无白空格）→ 弹
  if (slashState.visible || (text.startsWith("/") && !/\s/.test(text))) {
    refreshSlashEntries();
    slashState.visible = slashState.items.length > 0;
  } else {
    slashState.visible = false;
  }
  const atIdx = before.lastIndexOf("@");
  if (atIdx < 0) {
    closeMention();
    return;
  }
  const after = before.slice(atIdx + 1);
  if (/\s/.test(after)) {
    closeMention();
    return;
  }
  const partial = after;
  const q = partial.toLowerCase();
  const candidates = store.mentionCandidates.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.code.toLowerCase().includes(q)
  ).slice(0, 8);
  if (candidates.length === 0) {
    closeMention();
    return;
  }
  const rect = ta?.getBoundingClientRect();
  mentionState.position = rect
    ? { top: rect.height + 4, left: 0 }
    : { top: 0, left: 0 };
  mentionState.query = partial;
  mentionState.candidates = candidates;
  mentionState.activeIndex = 0;
  mentionState.range = { start: atIdx, end: cursorPos };
  mentionState.visible = true;
}

function refreshSlashEntries(): void {
  const items: SlashEntry[] = [
    { label: "/help", description: "列出可用命令 + skill", insert: "/help " },
    { label: "/attach <url>", description: "附加一个链接到本条消息", insert: "/attach " },
  ];
  for (const s of skillStore.items) {
    items.push({
      label: `/${s.name}`,
      description: s.description.split("\n")[0] ?? s.description,
      insert: `/${s.name} `,
    });
  }
  slashState.items = items;
  if (slashState.activeIndex >= items.length) slashState.activeIndex = 0;
}

function onSlashPick(entry: SlashEntry): void {
  input.value = entry.insert;
  slashState.visible = false;
  nextTick(() => {
    const ta = inputRef.value;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(entry.insert.length, entry.insert.length);
      autosize();
    }
  });
}

function closeSlash(): void {
  slashState.visible = false;
  slashState.activeIndex = 0;
}

// 阶段 13（PR #7）：[+] 按钮 → file picker → 上传到当前 session
const fileInputRef = ref<HTMLInputElement | null>(null);
function onPickFileClick(): void {
  if (!store.currentSessionId) {
    ElMessage.warning("请先选择会话");
    return;
  }
  fileInputRef.value?.click();
}
async function onFilesPicked(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement | null;
  const files = target?.files;
  if (!files || files.length === 0) return;
  const sid = store.currentSessionId;
  if (!sid) return;
  // 顺序上传，简单稳妥（base64 内联，不并发）
  for (const f of Array.from(files)) {
    try {
      const buf = await f.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const dto = await chatAttachmentApi.upload({
        sessionId: sid,
        fileName: f.name,
        mimeType: f.type || "application/octet-stream",
        contentBase64: base64,
      });
      // 上传后端已自动 appendMessage；触发消息列表刷新
      await store.refreshMessages(sid);
      ElMessage.success(`附件 ${dto.fileName} 上传完成`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      ElMessage.error(`附件 ${f.name} 上传失败：${msg}`);
    }
  }
  if (target) target.value = "";
}
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function onKeyDown(e: Event | KeyboardEvent): void {
  if (!(e instanceof KeyboardEvent)) return;
  // 阶段 13（PR #5）：slash popover 优先级高于 @ mention
  if (slashState.visible) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashState.activeIndex = (slashState.activeIndex + 1) % slashState.items.length;
      return;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      slashState.activeIndex =
        (slashState.activeIndex - 1 + slashState.items.length) % slashState.items.length;
      return;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = slashState.items[slashState.activeIndex];
      if (pick) onSlashPick(pick);
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSlash();
      return;
    }
  }
  if (!mentionState.visible) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionState.activeIndex = (mentionState.activeIndex + 1) % mentionState.candidates.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionState.activeIndex =
      (mentionState.activeIndex - 1 + mentionState.candidates.length) % mentionState.candidates.length;
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    const pick = mentionState.candidates[mentionState.activeIndex];
    if (pick) onMentionPick(pick);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeMention();
  }
}

function onMentionPick(p: ProjectDTO): void {
  const before = input.value.slice(0, mentionState.range.start);
  const after = input.value.slice(mentionState.range.end);
  input.value = `${before}@${p.code} ${after}`;
  closeMention();
  nextTick(() => {
    const ta = inputRef.value;
    if (ta) {
      const cursor = before.length + 1 + p.code.length + 1;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
      autosize();
    }
  });
}

function closeMention(): void {
  mentionState.visible = false;
  mentionState.candidates = [];
  mentionState.activeIndex = 0;
}

watch(
  () => input.value,
  () => {
    if (!mentionState.visible) onInput();
  },
);
</script>