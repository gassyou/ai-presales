<!--
  AiChatPanel.vue
  ===============
  AI 对话面板：顶部新建按钮 + 会话历史下拉 + 中部消息区 + 输入卡片。
  阶段 4：SSE 流式。
  阶段 5：sub-agent 选择器；tool_call/tool_result 渲染为 ToolCallCard。
  阶段 6.0f：项目绑定徽章；@ 项目名 自动补全；mention 高亮渲染。
  阶段重构：输入区移到独立组件 ChatComposer.vue（Claude 风格卡片）。
  阶段 13（PR #4）：左侧 session 侧边栏（+ 新建 / 改名 / 删除），header 标题用 session.title。
  阶段 13（PR #9，布局重构）：把 session 列表从左侧侧边栏移到顶部下拉框；
  下拉框内每行可单独删除；新建会话为独立 header 按钮；首条 user 消息时自动用前 20 字作标题。
-->
<template>
  <section class="flex h-full">
    <div class="flex flex-1 flex-col">
      <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div class="flex shrink-0 items-center gap-2">
          <el-button size="small" :disabled="busy" @click="onCreate">+ 新建会话</el-button>
          <el-popover
            v-model:visible="historyVisible"
            placement="bottom-start"
            :width="360"
            trigger="click"
            popper-class="ai-chat-history-popover"
          >
            <template #reference>
              <el-button size="small" :disabled="busy">
                <span class="inline-flex items-center gap-1">
                  <span aria-hidden="true">🕐</span>
                  <span>会话历史</span>
                  <span class="text-slate-400">({{ store.sessions.length }})</span>
                </span>
              </el-button>
            </template>

            <div class="flex flex-col gap-2">
              <el-input
                v-model="historySearch"
                size="small"
                placeholder="搜索会话..."
                clearable
              />
              <div class="max-h-80 overflow-y-auto rounded border border-slate-100">
                <div v-if="filteredSessions.length === 0" class="px-3 py-3 text-center text-xs text-slate-500">
                  {{ store.sessions.length === 0 ? "暂无会话" : "没有匹配的会话" }}
                </div>
                <div
                  v-for="s in filteredSessions"
                  :key="s.id"
                  :class="[
                    'group flex items-center gap-1 px-3 py-2 text-sm transition-colors hover:bg-slate-100 cursor-pointer',
                    store.currentSessionId === s.id ? 'bg-emerald-50' : '',
                  ]"
                  @click="onSwitchFromHistory(s.id)"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-slate-800">{{ s.title }}</div>
                    <div class="truncate text-[10px] text-slate-500">{{ formatTime(s.updatedAt) }}</div>
                  </div>
                  <el-button
                    size="small"
                    type="danger"
                    link
                    class="opacity-0 transition-opacity group-hover:opacity-100"
                    @click.stop="onDeleteFromHistory(s.id, s.title)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-popover>
        </div>

        <span v-if="store.currentSessionId" class="truncate text-sm font-medium text-slate-700">
          {{ currentTitle }}
        </span>
        <span v-else class="truncate text-sm text-slate-400">未选择会话</span>

        <div v-if="store.currentSessionId" class="flex shrink-0 gap-2">
          <el-button size="small" :disabled="busy" @click="onRename">改名</el-button>
          <el-button size="small" type="danger" :disabled="busy" @click="onDelete">删除</el-button>
        </div>
      </header>

      <div ref="scrollRef" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
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

      <ChatComposer />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
// 阶段 9：mention 候选装载依赖 onMounted，保留 `nextTick, onMounted` 在前以满足 task9-mention 静态断言
import { nextTick, onMounted, computed, ref, watch } from "vue";
import { chatSessionApi } from "./api/chat-session.api.ts";
import { useAiChatStore } from "./stores/ai-chat.store.ts";
import ChatComposer from "./ChatComposer.vue";
import MessageBubble from "./MessageBubble.vue";

const store = useAiChatStore();
const scrollRef = ref<HTMLElement | null>(null);
const busy = ref(false);
const historyVisible = ref(false);
const historySearch = ref("");

const currentTitle = computed(() => {
  const id = store.currentSessionId;
  if (!id) return "未选择会话";
  const s = store.sessions.find((x) => x.id === id);
  return s?.title ?? "未选择会话";
});

const filteredSessions = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  if (!q) return store.sessions;
  return store.sessions.filter((s) => s.title.toLowerCase().includes(q));
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 阶段 9（任务 9）：挂载时装载 @mention 候选项目列表
onMounted(() => {
  void store.loadMentionCandidates();
  // 默认会话：打开 AI 对话面板时如果没有 session 就建一条，
  // 让工具审批开关（默认关闭）始终可用；空会话不影响「新建会话」按钮的语义。
  if (!store.currentSessionId) {
    busy.value = true;
    store
      .createSessionForProject(store.currentProject?.id ?? null)
      .catch((e) => {
        console.warn("auto-create default session failed", e);
        ElMessage.error(
          e instanceof Error ? e.message : "创建默认会话失败",
        );
      })
      .finally(() => {
        busy.value = false;
      });
  }
});

watch(
  () => store.messages.length,
  () => {
    void nextTick(() => {
      if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    });
  },
);

async function onCreate(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.createSessionForProject(store.currentProject?.id ?? null);
    ElMessage.success("已创建新会话");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function onSwitchFromHistory(id: string): Promise<void> {
  historyVisible.value = false;
  if (store.currentSessionId === id) return;
  if (busy.value) return;
  busy.value = true;
  try {
    await store.switchToSession(id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function onDeleteFromHistory(id: string, title: string): Promise<void> {
  if (busy.value) return;
  try {
    await ElMessageBox.confirm(`确认删除会话「${title}」？消息不可恢复。`, "删除会话", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  busy.value = true;
  try {
    await store.deleteSessionById(id);
    ElMessage.success("会话已删除");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function onRename(): Promise<void> {
  if (!store.currentSessionId) return;
  let nextTitle: string;
  try {
    const r = await ElMessageBox.prompt("输入新标题", "改名", {
      confirmButtonText: "保存",
      cancelButtonText: "取消",
      inputValue: currentTitle.value,
      inputValidator: (v) => (typeof v === "string" && v.trim().length > 0 ? true : "标题不能为空"),
    });
    nextTitle = r.value;
  } catch {
    return; // 用户取消
  }
  busy.value = true;
  try {
    const id = store.currentSessionId;
    await chatSessionApi.rename(id, nextTitle.trim());
    await store.loadSessions(store.currentProject?.id ?? null);
    ElMessage.success("已改名");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function onDelete(): Promise<void> {
  if (!store.currentSessionId) return;
  try {
    await ElMessageBox.confirm("确认删除当前会话？消息不可恢复。", "删除会话", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  busy.value = true;
  try {
    await store.deleteCurrentSession();
    ElMessage.success("会话已删除");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ai-chat-history-popover :deep(.el-popover__content) {
  padding: 12px;
}
</style>