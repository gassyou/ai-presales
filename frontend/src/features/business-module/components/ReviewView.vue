<!--
  ReviewView.vue
  ==============
  方案 Review 多维评估（阶段 7.4a）。

  形态：
    - 顶部：总分大圆环 + 加权平均
    - 主体：表格（dimension / score / weight / comment）+ 行内编辑
    - 底部：新建按钮
-->
<template>
  <section class="card flex flex-col gap-3">
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

    <div v-if="items.length === 0" class="rounded border border-border bg-white/50 p-4 text-xs text-slate-600">
      暂无评估项。点击「添加评估项」开始多维度评分。
    </div>

    <table v-else class="w-full text-xs">
      <thead class="text-left text-slate-600">
        <tr class="border-b border-border">
          <th class="py-1">维度</th>
          <th class="w-24 py-1">评分</th>
          <th class="w-20 py-1">权重</th>
          <th class="py-1">评语</th>
          <th class="w-16 py-1"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" class="border-b border-border/60 align-top">
          <td class="py-2 text-slate-800">{{ it.dimension }}</td>
          <td class="py-2">
            <div class="flex items-center gap-1">
              <span class="font-mono text-accent">{{ it.score.toFixed(1) }}</span>
              <div class="h-1 w-12 rounded bg-surface-alt">
                <div
                  class="h-1 rounded bg-accent"
                  :style="{ width: `${(it.score / 10) * 100}%` }"
                />
              </div>
            </div>
          </td>
          <td class="py-2 font-mono text-slate-600">{{ it.weight.toFixed(2) }}</td>
          <td class="py-2 text-slate-600 line-clamp-2 max-w-[300px]">{{ it.comment || "—" }}</td>
          <td class="py-2 text-right">
            <el-button link type="primary" size="small" @click="openEdit(it)">编辑</el-button>
            <el-button link type="danger" size="small" @click="onDelete(it.id)">删</el-button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 编辑抽屉 -->
    <el-dialog
      :model-value="editing !== null"
      :title="editing && editing.id ? '编辑评估项' : '添加评估项'"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && cancelEdit()"
    >
      <template v-if="editing">
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">维度（业务价值/技术可行性/...）</span>
          <el-input v-model="editing.dimension" placeholder="业务价值" class="mt-1" />
        </label>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">标题（内部标识）</span>
          <el-input v-model="editing.title" class="mt-1" />
        </label>
        <div class="mb-2 grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs text-slate-600">评分（0-10）</span>
            <el-input-number v-model="editing.score" :min="0" :max="10" :step="0.5" class="mt-1" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-600">权重（0-1）</span>
            <el-input-number v-model="editing.weight" :min="0" :max="1" :step="0.1" class="mt-1" />
          </label>
        </div>
        <label class="mb-3 block">
          <span class="text-xs text-slate-600">评语</span>
          <el-input v-model="editing.comment" type="textarea" :rows="3" class="mt-1" />
        </label>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="cancelEdit">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">{{ saving ? "保存中…" : "保存" }}</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStructuredModulesStore } from "../stores/structured-modules.store.ts";
import type { ReviewDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

const items = computed<ReviewDTO[]>(() => store.reviewsByProject.get(props.projectId) ?? []);
const summary = computed(() => store.reviewSummaryByProject.get(props.projectId));
const editing = ref<ReviewDTO | null>(null);
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
  editing.value = { ...it };
}

function cancelEdit(): void {
  editing.value = null;
}

async function onSave(): Promise<void> {
  const ed = editing.value;
  if (!ed) return;
  saving.value = true;
  try {
    if (ed.id) {
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