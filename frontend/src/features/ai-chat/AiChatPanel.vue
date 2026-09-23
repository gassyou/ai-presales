<!--
  AiChatPanel.vue
  ===============
  AI 对话面板：消息列表 + 输入框 + profile 切换 + 停止。
  阶段 4：SSE 流式。
  阶段 5：sub-agent 选择器；tool_call/tool_result 渲染为 ToolCallCard。
  阶段 6.0f：项目绑定徽章；@ 项目名 自动补全；mention 高亮渲染。
-->
<template>
  <section class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-medium text-slate-900">AI 对话框</h2>
        <span
          v-if="store.currentProject"
          class="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-emerald-700"
          :title="`项目 ${store.currentProject.code}`"
        >
          绑定：{{ store.currentProject.code }}
        </span>
        <span v-else class="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-500">
          全局对话
        </span>
      </div>
      <div class="flex items-center gap-2">
        <SubAgentPicker
          :model-value="store.subAgentName"
          @update:model-value="store.setSubAgent"
        />
        <select
          v-model="profile"
          class="rounded border border-border bg-white px-2 py-1 text-xs"
          @change="onProfileChange"
        >
          <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
        </select>
        <button
          v-if="store.currentProject"
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="store.setCurrentProject(null)"
        >
          解绑
        </button>
        <button
          class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="store.clear"
        >
          清空
        </button>
      </div>
    </header>

    <div ref="scrollRef" class="flex-1 space-y-2 px-4 py-3 overflow-y-auto">
      <div v-if="store.messages.length === 0" class="text-center text-xs text-slate-500">
        <p v-if="store.currentProject">
          当前项目 <code>{{ store.currentProject.code }}</code>。<br />
          输入 <code>@</code> 可引用其他项目。
        </p>
        <p v-else>试着问点什么。例："请帮我总结一个 ERP 升级提案的概要"。</p>
      </div>
      <MessageBubble v-for="m in store.messages" :key="m.id" :message="m" />

      <div v-if="store.loading" class="flex justify-start">
        <div class="max-w-[85%] rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-600">
          AI 思考中…
        </div>
      </div>
    </div>

    <div v-if="store.error" class="border-t border-red-800 bg-red-900/20 px-4 py-2 text-xs text-red-300">
      {{ store.error }}
    </div>

    <form
      class="relative flex items-end gap-2 border-t border-border px-4 py-3"
      @submit.prevent="onSend"
    >
      <textarea
        ref="inputRef"
        v-model="input"
        rows="2"
        placeholder="输入消息，Shift+Enter 换行，Enter 发送；输入 @ 引用其他项目"
        class="flex-1 resize-none rounded border border-border bg-white px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        @input="onInputChange"
        @keydown="onKeyDown"
        @keydown.enter.exact.prevent="onSend"
      />
      <button
        v-if="!store.loading"
        type="submit"
        class="btn-primary"
        :disabled="input.length === 0"
      >
        发送
      </button>
      <button
        v-else
        type="button"
        class="rounded border border-border px-3 py-1.5 text-sm text-slate-800 hover:bg-surface-alt"
        @click="store.stop"
      >
        停止
      </button>

      <MentionAutocomplete
        :visible="mentionState.visible"
        :query="mentionState.query"
        :candidates="mentionState.candidates"
        :position="mentionState.position"
        :active-index="mentionState.activeIndex"
        @select="onMentionPick"
        @dismiss="closeMention"
      />
    </form>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from "vue";
import { useAiChatStore } from "./stores/ai-chat.store.ts";
import MessageBubble from "./MessageBubble.vue";
import SubAgentPicker from "@frontend/features/sub-agent/SubAgentPicker.vue";
import MentionAutocomplete from "./MentionAutocomplete.vue";
import { extractMentionTokens } from "@frontend/shared/utils/mention-parser.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";

const store = useAiChatStore();
const input = ref("");
const scrollRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

const profiles = ["fast", "deep", "local"];
const profile = ref(store.profile);

// @ 候选弹窗状态
const mentionState = reactive({
  visible: false,
  query: "",
  position: { top: 0, left: 0 },
  candidates: [] as ProjectDTO[],
  activeIndex: 0,
  /** 当前弹窗对应的 token 起止位置 [start, end)，便于替换 */
  range: { start: 0, end: 0 } as { start: number; end: number },
});

function onSend(): void {
  if (mentionState.visible) closeMention();
  const v = input.value;
  if (v.length === 0) return;
  input.value = "";
  void store.send(v);
}

function onProfileChange(): void {
  store.setProfile(profile.value);
}

/** 输入框变化时检测是否在 @xxx 中 */
function onInputChange(): void {
  const text = input.value;
  const cursorPos = inputRef.value?.selectionStart ?? text.length;
  // 向前找最近的 @
  const before = text.slice(0, cursorPos);
  const atIdx = before.lastIndexOf("@");
  if (atIdx < 0) {
    closeMention();
    return;
  }
  const after = before.slice(atIdx + 1);
  // 不允许有空白（mention token 字符白名单连续）
  if (/\s/.test(after)) {
    closeMention();
    return;
  }
  // 当前输入的 token
  const partial = after;
  // 候选：在 mentionCandidates 里匹配 name/code 前缀（不分大小写）
  const q = partial.toLowerCase();
  const candidates = store.mentionCandidates.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.code.toLowerCase().includes(q)
  ).slice(0, 8);
  if (candidates.length === 0) {
    closeMention();
    return;
  }
  // 计算弹窗位置（粗略：textarea 下方）
  const rect = inputRef.value?.getBoundingClientRect();
  mentionState.position = rect
    ? { top: rect.height + 4, left: 0 }
    : { top: 0, left: 0 };
  mentionState.query = partial;
  mentionState.candidates = candidates;
  mentionState.activeIndex = 0;
  mentionState.range = { start: atIdx, end: cursorPos };
  mentionState.visible = true;
}

function onKeyDown(e: KeyboardEvent): void {
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
  // 替换 [range.start, range.end) 为 @<p.code>，再补一个空格方便继续输入
  const before = input.value.slice(0, mentionState.range.start);
  const after = input.value.slice(mentionState.range.end);
  input.value = `${before}@${p.code} ${after}`;
  closeMention();
  // 重新聚焦
  nextTick(() => {
    if (inputRef.value) {
      const cursor = before.length + 1 + p.code.length + 1; // 在空格后
      inputRef.value.focus();
      inputRef.value.setSelectionRange(cursor, cursor);
    }
  });
}

function closeMention(): void {
  mentionState.visible = false;
  mentionState.candidates = [];
  mentionState.activeIndex = 0;
}

watch(
  () => store.messages.length,
  () => {
    void nextTick(() => {
      if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    });
  },
);

watch(
  () => input.value,
  () => {
    // 整段输入变化时也更新 mention 候选（兜底）
    if (!mentionState.visible) onInputChange();
  },
);

onMounted(() => {
  void scrollRef;
  // 当前已知 mentions（只用来反馈，不阻塞）
  void extractMentionTokens;
});
</script>