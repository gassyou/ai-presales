<!--
  CustomPagesView.vue
  =====================
  浏览器式 tab 编辑器（阶段 7.4d + 重构）。

  形态：
    - 顶部 tab 栏：每个页签 = 一张「标签」
      · 左：标签名（双击可重命名）
      · 右：× 关闭按钮（至少保留 1 个 tab）
      · 末尾：+ 按钮新增 tab
    - 主体：当前选中 tab 对应的 MarkdownEditor（Bytemd）
    - 缺省至少有 1 个空白 tab
-->
<template>
  <section class="flex h-full min-h-0 flex-col">
    <!-- tab 栏 -->
    <div class="flex shrink-0 items-end gap-1 border-b border-border bg-surface-alt/30 px-1 pt-2">
      <div
        v-for="t in tabs"
        :key="t.id"
        class="group flex max-w-[200px] cursor-pointer items-center gap-1 rounded-t border border-b-0 px-3 py-1.5 text-xs transition"
        :class="t.id === activeId
          ? 'border-accent bg-white text-slate-900'
          : 'border-border bg-surface-alt text-slate-600 hover:text-slate-800'"
        @click="activeId = t.id"
      >
        <input
          v-if="renamingId === t.id"
          ref="renameInput"
          v-model="renameDraft"
          class="w-28 rounded border border-accent bg-white px-1 text-xs outline-none"
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.esc="cancelRename"
          @click.stop
        />
        <span
          v-else
          class="truncate"
          :title="t.title"
          @dblclick.stop="startRename(t)"
        >{{ t.title || "未命名" }}</span>
        <button
          type="button"
          class="ml-1 shrink-0 rounded px-1 text-[14px] leading-none text-slate-500 hover:bg-rose-100 hover:text-rose-600"
          :disabled="tabs.length === 1"
          :title="tabs.length === 1 ? '至少保留一个页签' : '关闭'"
          @click.stop="onClose(t.id)"
        >×</button>
      </div>
      <button
        type="button"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-border bg-white text-slate-600 hover:border-accent hover:text-accent"
        title="新增页签"
        @click="onNewTab"
      >+</button>
    </div>

    <p v-if="loadError" class="px-3 pt-2 text-xs text-red-300">{{ loadError }}</p>

    <!-- 当前 tab 内容 -->
    <div class="flex-1 min-h-0 overflow-hidden p-3">
      <div v-if="activeTab" class="flex h-full min-h-0 flex-col">
        <MarkdownEditor
          v-model="draft"
          :placeholder="`编辑 ${activeTab.title || '未命名'}…`"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { businessModuleApi } from "../api/business-module.api.ts";
import type { BusinessModuleItemDTO } from "@shared/types/dto/business-module.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();

interface Tab {
  id: string;          // 真实业务 id（已保存）或 client-side 的临时 id
  title: string;
  content: string;
  /** true = 还没创建到后端（仅前端 tab），需要保存 */
  dirty: boolean;
  /** 已有 id 但内容变化未保存 */
  pending: boolean;
}

const tabs = ref<Tab[]>([]);
const activeId = ref<string>("");
const draft = ref<string>("");
const loadError = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameDraft = ref<string>("");
const renameInput = ref<HTMLInputElement | null>(null);

const activeTab = computed<Tab | null>(
  () => tabs.value.find((t) => t.id === activeId.value) ?? null,
);

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

/** 用后端返回的 item 转 Tab */
function itemToTab(it: BusinessModuleItemDTO): Tab {
  return { id: it.id, title: it.title, content: it.content, dirty: false, pending: false };
}

async function load(): Promise<void> {
  loadError.value = null;
  try {
    const r = await businessModuleApi.list(props.projectId, "custom");
    const items = [...r.items].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (items.length === 0) {
      // 空态：自动给一个空白 tab（不立即创建到后端，等用户输入标题/内容再决定保存）
      tabs.value = [newTab("新页面")];
      activeId.value = tabs.value[0].id;
      draft.value = "";
    } else {
      tabs.value = items.map(itemToTab);
      activeId.value = tabs.value[0].id;
      draft.value = tabs.value[0].content;
    }
  } catch (e) {
    loadError.value = errMsg(e);
  }
}

/** 创建一个未保存到后端的 tab（仅前端） */
function newTab(title: string): Tab {
  return {
    id: `tmp-${crypto.randomUUID()}`,
    title,
    content: "",
    dirty: true,    // 首次创建即 dirty，等用户改名/写内容触发首次保存
    pending: true,
  };
}

/** 新增 tab（+ 按钮） */
async function onNewTab(): Promise<void> {
  // 若当前是 dirty 且尚未落库，先 flush 再开新 tab
  await flushActive();
  const t = newTab(`新页面 ${tabs.value.length + 1}`);
  tabs.value.push(t);
  activeId.value = t.id;
  draft.value = "";
}

/** 重命名 tab */
function startRename(t: Tab): void {
  renamingId.value = t.id;
  renameDraft.value = t.title;
  void nextTick(() => renameInput.value?.focus());
}

function cancelRename(): void {
  renamingId.value = null;
  renameDraft.value = "";
}

async function commitRename(): Promise<void> {
  const id = renamingId.value;
  renamingId.value = null;
  if (!id) return;
  const t = tabs.value.find((x) => x.id === id);
  if (!t) return;
  const next = renameDraft.value.trim();
  if (!next || next === t.title) return;
  t.title = next;
  await persist(t);
}

/** 关闭 tab */
async function onClose(id: string): Promise<void> {
  if (tabs.value.length === 1) return;
  // 若有未保存内容，提示
  const t = tabs.value.find((x) => x.id === id);
  if (!t) return;
  if (t.pending) {
    try {
      await ElMessageBox.confirm(`关闭「${t.title || "未命名"}」将丢弃未保存的内容，确认？`, "提示", {
        type: "warning",
        confirmButtonText: "确认关闭",
        cancelButtonText: "取消",
      });
    } catch {
      return;
    }
    tabs.value = tabs.value.filter((x) => x.id !== id);
    if (activeId.value === id) {
      const first = tabs.value[0];
      if (first) {
        activeId.value = first.id;
        draft.value = first.content;
      }
    }
    return;
  }
  // 已保存的：直接关闭 + 删后端
  try {
    await businessModuleApi.delete(id);
  } catch (e) {
    loadError.value = errMsg(e);
    return;
  }
  tabs.value = tabs.value.filter((x) => x.id !== id);
  if (activeId.value === id) {
    const first = tabs.value[0];
    if (first) {
      activeId.value = first.id;
      draft.value = first.content;
    }
  }
}

/** 保存单个 tab 到后端 */
async function persist(t: Tab): Promise<void> {
  try {
    if (t.id.startsWith("tmp-")) {
      // 首次创建
      const it = await businessModuleApi.create(props.projectId, "custom", {
        title: t.title || "未命名",
        content: t.content,
      });
      // 替换 tmp id 为真 id
      const idx = tabs.value.findIndex((x) => x.id === t.id);
      if (idx >= 0) {
        tabs.value[idx] = {
          id: it.id,
          title: it.title,
          content: it.content,
          dirty: false,
          pending: false,
        };
        if (activeId.value === t.id) activeId.value = it.id;
      }
    } else {
      await businessModuleApi.update(t.id, {
        title: t.title,
        content: t.content,
      });
      t.dirty = false;
      t.pending = false;
    }
  } catch (e) {
    loadError.value = errMsg(e);
  }
}

/** 把当前 tab 的最新内容写入 draft，再根据 dirty 状态决定是否 flush */
let saveTimer: number | null = null;
function scheduleFlush(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const t = activeTab.value;
    if (!t) return;
    t.content = draft.value;
    t.dirty = true;
    t.pending = true;
    if (!t.id.startsWith("tmp-") && t.content !== "") {
      // 已存在的：800ms debounce 后 PUT
      try {
        await businessModuleApi.update(t.id, {
          title: t.title,
          content: t.content,
        });
        t.dirty = false;
        t.pending = false;
      } catch (e) {
        loadError.value = errMsg(e);
      }
    }
  }, 800) as unknown as number;
}

/** 立即刷新当前 tab（用于关闭/新建前确保不丢内容） */
async function flushActive(): Promise<void> {
  const t = activeTab.value;
  if (!t) return;
  t.content = draft.value;
  if (t.id.startsWith("tmp-")) {
    if (t.title.trim().length === 0 && t.content.trim().length === 0) return;
    await persist(t);
  } else if (t.dirty) {
    await persist(t);
  }
}

// draft 变化 → schedule flush
watch(draft, () => {
  scheduleFlush();
});

// 切换 tab → 把当前 draft 落回 tab；新 tab 的 draft 同步
watch(activeId, async () => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  await flushActive();
  const t = activeTab.value;
  draft.value = t?.content ?? "";
});

watch(() => props.projectId, async () => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  await load();
});

onMounted(() => {
  void load();
});
</script>