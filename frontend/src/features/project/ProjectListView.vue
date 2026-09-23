<!--
  ProjectListView.vue
  ===================
  项目列表页：搜索 + 新建 + 卡片网格。
-->
<template>
  <section class="mx-auto flex h-full max-w-7xl flex-col gap-4 p-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">项目列表</h1>
        <p class="text-xs text-slate-500">
          共 {{ store.total }} 个案件
          <span v-if="store.loading" class="ml-2 text-slate-600">加载中…</span>
        </p>
      </div>
      <button class="btn-primary" @click="openCreate">+ 新建项目</button>
    </header>

    <div class="flex items-center gap-2">
      <input
        v-model="search"
        type="search"
        placeholder="搜索项目名称 / 客户 / 编号…"
        class="w-72 rounded border border-border bg-white/60 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        @input="onSearch"
      />
      <select
        v-model="statusFilter"
        class="rounded border border-border bg-white/60 px-2 py-1.5 text-sm"
        @change="onFilter"
      >
        <option value="">全部状态</option>
        <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <div v-if="store.error" class="rounded border border-red-700 bg-red-900/20 px-4 py-2 text-sm text-red-300">
      加载失败：{{ store.error }}
    </div>

    <div v-if="store.items.length === 0 && !store.loading" class="card text-center text-sm text-slate-500">
      还没有项目。点击右上角"+ 新建项目"开始。
    </div>

    <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <ProjectCard
        v-for="p in store.items"
        :key="p.id"
        :project="p"
        :can-delete="true"
        @delete="onDelete"
        @select="onSelect"
      />
    </div>
  </section>

  <ProjectCreateDialog
    v-if="creating"
    @close="creating = false"
    @submit="onCreateSubmit"
  />
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "./stores/project.store.ts";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectCreateDialog from "./components/ProjectCreateDialog.vue";
import { useAiChatStore } from "@frontend/features/ai-chat/stores/ai-chat.store.ts";
import type { ProjectStatusValue } from "@shared/types/dto/project.ts";

const store = useProjectStore();
const aiStore = useAiChatStore();
const router = useRouter();

const search = ref("");
const statusFilter = ref<"" | ProjectStatusValue>("");
const creating = ref(false);
const statuses: ProjectStatusValue[] = ["新建", "提案中", "暂停", "中标", "未中标"];

let searchDebounce: number | null = null;

function onSearch(): void {
  if (searchDebounce !== null) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const s: ProjectStatusValue | undefined = statusFilter.value === "" ? undefined : statusFilter.value;
    store.load({ search: search.value || undefined, status: s });
  }, 250) as unknown as number;
}

function onFilter(): void {
  const s: ProjectStatusValue | undefined = statusFilter.value === "" ? undefined : statusFilter.value;
  store.load({ search: search.value || undefined, status: s });
}

function openCreate(): void {
  creating.value = true;
}

async function onCreateSubmit(input: { name: string; clientName: string }): Promise<void> {
  try {
    await store.create(input);
    creating.value = false;
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

function onSelect(id: string): void {
  // 阶段 6.0f：跳到 ProjectDetailView，并在 store 里先轻量记 id
  aiStore.setCurrentProjectId(id);
  void router.push({ name: "project-detail", params: { id } });
}

async function onDelete(id: string): Promise<void> {
  if (!confirm("确认删除该项目？此操作不可恢复。")) return;
  try {
    await store.remove(id);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

onMounted(() => {
  store.load();
});
</script>