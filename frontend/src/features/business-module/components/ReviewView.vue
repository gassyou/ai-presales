<!--
  ReviewView.vue
  ==============
  方案 Review 多维评估（markdown 编辑，阶段 7.4a 重构）。

  形态：
    - 顶部：总分大圆环 + 加权平均
    - 主体：表格（dimension / score / weight / 评语摘要）+ 行内编辑
    - 抽屉式编辑器：含 markdown 内容
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-medium text-slate-700">方案 Review 评估</h2>
      <div class="flex items-center gap-3">
        <div class="flex flex-col items-center">
          <span class="text-[10px] text-slate-600">加权总分</span>
          <span class="text-xl font-semibold text-accent">
            {{ summary ? summary.totalScore.toFixed(1) : "0.0" }}
          </span>
          <span class="text-[10px] text-slate-500">/ 10 · 共 {{ summary?.itemCount ?? 0 }} 项</span>
        </div>
        <button
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          @click="openCreate"
        >添加评估项</button>
      </div>
    </header>

    <p v-if="store.reviewError" class="text-xs text-red-300">{{ store.reviewError }}</p>

    <div v-if="items.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无评估项。点击「添加评估项」开始多维度评分。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">维度</th>
            <th class="w-24 py-2">评分</th>
            <th class="w-20 py-2">权重</th>
            <th class="py-2">评语摘要</th>
            <th class="w-20 py-2 text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in items"
            :key="it.id"
            class="border-b border-border/60 align-top hover:bg-surface-alt/40"
          >
            <td class="py-2 pl-2 text-slate-800">{{ it.dimension }}</td>
            <td class="py-2">
              <div class="flex items-center gap-1">
                <span class="font-mono text-accent">{{ it.score.toFixed(1) }}</span>
                <div class="h-1 w-12 rounded bg-surface-alt">
                  <div class="h-1 rounded bg-accent" :style="{ width: `${(it.score / 10) * 100}%` }" />
                </div>
              </div>
            </td>
            <td class="py-2 font-mono text-slate-600">{{ it.weight.toFixed(2) }}</td>
            <td class="py-2 text-slate-600 line-clamp-1 max-w-[300px]" :title="it.comment">
              {{ it.comment || "—" }}
            </td>
            <td class="py-2 text-right pr-2">
              <el-button link type="primary" size="small" @click="openEdit(it)">编辑</el-button>
              <el-button link type="danger" size="small" @click="onDelete(it.id)">删</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑抽屉：含 markdown 评语 -->
    <el-drawer
      :model-value="editing !== null"
      :title="editing && editing.id ? `编辑评估项 · ${editing.dimension || ''}` : '添加评估项'"
      direction="rtl"
      size="760px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && cancelEdit()"
    >
      <template v-if="editing">
        <div class="flex h-full flex-col gap-3 px-1">
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              维度（业务价值/技术可行性/...）*
              <el-input v-model="editing.dimension" placeholder="业务价值" />
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              标题（内部标识）
              <el-input v-model="editing.title" />
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              评分（0-10）
              <el-input-number v-model="editing.score" :min="0" :max="10" :step="0.5" />
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              权重（0-1）
              <el-input-number v-model="editing.weight" :min="0" :max="1" :step="0.1" />
            </label>
          </div>

          <label class="flex flex-col gap-1 text-xs text-slate-600">
            评语（Markdown）
            <div class="mt-1 flex-1 overflow-hidden rounded border border-border">
              <MarkdownEditor v-model="editing.comment" placeholder="评语 / 改进建议…" />
            </div>
          </label>

          <div class="flex justify-end gap-2 pt-2">
            <el-button @click="cancelEdit">取消</el-button>
            <el-button type="primary" :loading="saving" @click="onSave">{{ saving ? "保存中…" : "保存" }}</el-button>
          </div>
        </div>
      </template>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStructuredModulesStore } from "../stores/structured-modules.store.ts";
import type { ReviewDTO } from "../api/structured-modules.api.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

interface EditableReview {
  id: string;
  projectId: string;
  title: string;
  dimension: string;
  score: number;
  weight: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

const items = computed<ReviewDTO[]>(() => store.reviewsByProject.get(props.projectId) ?? []);
const summary = computed(() => store.reviewSummaryByProject.get(props.projectId));
const editing = ref<EditableReview | null>(null);
const saving = ref(false);

onMounted(() => void store.loadReviews(props.projectId));

function openCreate(): void {
  editing.value = {
    id: "",
    projectId: props.projectId,
    title: "",
    dimension: "",
    score: 5,
    weight: 1,
    comment: "",
    createdAt: "",
    updatedAt: "",
  };
}

function openEdit(it: ReviewDTO): void {
  editing.value = { ...it, comment: it.comment ?? "" };
}

function cancelEdit(): void {
  editing.value = null;
}

async function onSave(): Promise<void> {
  const ed = editing.value;
  if (!ed) return;
  if (!ed.dimension.trim()) {
    ElMessage.error("请输入维度");
    return;
  }
  saving.value = true;
  try {
    if (ed.id.length > 0) {
      await store.updateReview(props.projectId, ed.id, {
        title: ed.title,
        dimension: ed.dimension,
        score: ed.score,
        weight: ed.weight,
        comment: ed.comment,
      });
    } else {
      await store.createReview(props.projectId, {
        title: ed.title || ed.dimension,
        dimension: ed.dimension,
        score: ed.score,
        weight: ed.weight,
        comment: ed.comment,
      });
    }
    editing.value = null;
  } finally {
    saving.value = false;
  }
}

async function onDelete(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认删除？", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await store.deleteReview(props.projectId, id);
}
</script>