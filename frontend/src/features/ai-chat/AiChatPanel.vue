<!--
  AiChatPanel.vue
  ===============
  AI 对话面板：左侧 session 列表 + 右侧消息列表 + 输入卡片。
  阶段 4：SSE 流式。
  阶段 5：sub-agent 选择器；tool_call/tool_result 渲染为 ToolCallCard。
  阶段 6.0f：项目绑定徽章；@ 项目名 自动补全；mention 高亮渲染。
  阶段重构：输入区移到独立组件 ChatComposer.vue（Claude 风格卡片）。
  阶段 13（PR #4）：左侧 session 侧边栏（+ 新建 / 改名 / 删除），header 标题用 session.title。
-->
<template>
  <section class="flex h-full">
    <!-- 左侧：会话侧边栏 -->
    <aside class="flex w-56 shrink-0 flex-col border-r border-border bg-slate-50">
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <span class="text-xs font-semibold uppercase text-slate-500">会话</span>
        <el-button size="small" :disabled="busy" @click="onCreate">+ 新建</el-button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <button
          v-for="s in store.sessions"
          :key="s.id"
          :class="[
            'block w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100',
            store.currentSessionId === s.id
              ? 'border-l-2 border-emerald-500 bg-emerald-50'
              : 'border-l-2 border-transparent',
          ]"
          @click="onSwitch(s.id)"
        >
          <div class="truncate font-medium text-slate-800">{{ s.title }}</div>
          <div class="truncate text-[10px] text-slate-500">{{ formatTime(s.updatedAt) }}</div>
        </button>
        <div v-if="store.sessions.length === 0" class="px-3 py-2 text-xs text-slate-500">
          暂无会话
        </div>
      </div>
    </aside>

    <!-- 右侧：消息 + 输入 -->
    <div class="flex flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-border px-4 py-2">
        <span class="truncate text-sm font-medium text-slate-700">{{ currentTitle }}</span>
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

const currentTitle = computed(() => {
  const id = store.currentSessionId;
  if (!id) return "未选择会话";
  const s = store.sessions.find((x) => x.id === id);
  return s?.title ?? "未选择会话";
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

async function onSwitch(id: string): Promise<void> {
  if (busy.value) return;
  if (store.currentSessionId === id) return;
  busy.value = true;
  try {
    await store.switchToSession(id);
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