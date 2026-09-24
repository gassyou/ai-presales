<!--
  ChatComposer.vue
  ================
  AI 对话输入卡片（Claude 风）

  布局：
    ┌──────────────────────────────────────────────────────┐
    │  [多行 textarea，自动扩展高度]                          │
    │ ─────────────────────────────────────────────────────│
    │  ⊕   📎                       [Profile ▾]      ⬆    │
    └──────────────────────────────────────────────────────┘

  - textarea 自动扩展高度（1-5 行）
  - 底栏左侧：⊕ 添加（占位）、📎 附件（占位）
  - 底栏右侧：profile 下拉（fast/deep/local）+ 发送按钮
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
        rows="1"
        :placeholder="placeholder"
        class="block w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
        style="min-height: 28px; max-height: 168px"
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
    </div>

    <div class="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
      <div class="flex items-center gap-1 text-slate-500">
        <el-button link size="small" title="添加（占位）" class="!text-slate-500">
          <span class="text-base leading-none">⊕</span>
        </el-button>
        <el-button link size="small" title="附件（占位）" class="!text-slate-500">
          <span class="text-base leading-none">📎</span>
        </el-button>
      </div>

      <div class="flex items-center gap-1">
        <el-select
          :model-value="store.profile"
          size="small"
          style="width: 110px"
          @change="store.setProfile"
        >
          <el-option v-for="p in profiles" :key="p" :label="`⚡ ${p}`" :value="p" />
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
          <span class="text-base leading-none">⬆</span>
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
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useAiChatStore } from "./stores/ai-chat.store.ts";
import MentionAutocomplete from "./MentionAutocomplete.vue";
import type { ProjectDTO } from "@shared/types/dto/project.ts";

const store = useAiChatStore();
const input = ref("");
const inputRef = ref<HTMLTextAreaElement | null>(null);

const profiles = ["fast", "deep", "local"];

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

function autosize(): void {
  const ta = inputRef.value;
  if (!ta) return;
  ta.style.height = "auto";
  // 限制最大高度 168px（约 5-6 行）；超出后内部滚动
  ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
}

function onSend(): void {
  if (mentionState.visible) closeMention();
  const v = input.value;
  if (v.length === 0) return;
  input.value = "";
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

function onKeyDown(e: Event | KeyboardEvent): void {
  if (!mentionState.visible) return;
  if (!(e instanceof KeyboardEvent)) return;
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