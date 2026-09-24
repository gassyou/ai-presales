<!--
  CustomPagesView.vue
  =====================
  项目自定义页面容器（阶段 7.4d）。

 形态：
    - 顶部：标题 + inline 新建输入框（input + 创建按钮）
    - 主体：v-for 渲染 CustomPageEditor；空态引导文案

  数据：直接调 businessModuleApi，不走 store（与 MarkdownModuleView 一致）。
-->
<template>
  <section class="flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">自定义页面</h2>
      <div class="flex flex-wrap items-center gap-2">
        <el-input
          v-model="newTitle"
          size="small"
          placeholder="页面名称…"
          :disabled="creating"
          @keydown.enter="onCreate"
        />
        <el-button
          size="small"
          :disabled="creating || newTitle.trim().length === 0"
          @click="onCreate"
        >{{ creating ? "创建中…" : "+ 新建页面" }}</el-button>
      </div>
    </header>

    <p v-if="loadError" class="text-xs text-red-300">{{ loadError }}</p>

    <p
      v-if="!loading && items.length === 0"
      class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500"
    >还没有自定义页面。在上方输入名称后按回车或「+ 新建页面」开始创建。</p>

    <CustomPageEditor
      v-for="it in items"
      :key="it.id"
      :project-id="projectId"
      :item-id="it.id"
      :title="it.title"
      @deleted="onItemDeleted"
      @updated="onItemUpdated"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { businessModuleApi } from "../api/business-module.api.ts";
import type { BusinessModuleItemDTO } from "@shared/types/dto/business-module.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import CustomPageEditor from "./CustomPageEditor.vue";

const props = defineProps<{
  projectId: string;
}>();

const items = ref<BusinessModuleItemDTO[]>([]);
const newTitle = ref("");
const creating = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const r = await businessModuleApi.list(props.projectId, "custom");
    // 按 updatedAt 倒序，最新的在最上面
    items.value = [...r.items].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (e) {
    loadError.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  try {
    const it = await businessModuleApi.create(props.projectId, "custom", {
      title,
      content: "",
    });
    items.value = [it, ...items.value];
    newTitle.value = "";
  } catch (e) {
    loadError.value = errMsg(e);
  } finally {
    creating.value = false;
  }
}

function onItemDeleted(itemId: string): void {
  items.value = items.value.filter((it) => it.id !== itemId);
}

function onItemUpdated(updated: BusinessModuleItemDTO): void {
  const idx = items.value.findIndex((it) => it.id === updated.id);
  if (idx >= 0) {
    const next = [...items.value];
    next[idx] = updated;
    items.value = next;
  }
}

watch(() => props.projectId, () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>