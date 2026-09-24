<!--
  DeliverableView.vue
  ===================
  交付物列表 + 看板式状态管理（阶段 7.4a）。

  形态：
    - 顶部：新建按钮
    - 主体：分组列表（按 status）；点击状态快速切换
    - 行：title / type / owner / dueDate / status 徽章 + 删
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">交付物清单</h2>
      <el-button size="small" @click="openCreate">新建交付物</el-button>
    </header>

    <p v-if="store.deliverableError" class="text-xs text-red-300">{{ store.deliverableError }}</p>

    <div v-if="items.length === 0" class="rounded border border-border bg-white/50 p-4 text-xs text-slate-600">
      暂无交付物。
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="it in items"
        :key="it.id"
        class="rounded border border-border bg-white/40 p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1">
            <h3 class="text-sm font-medium text-slate-800">{{ it.title }}</h3>
            <p class="mt-1 text-[11px] text-slate-600">
              <span>{{ it.type || "未分类" }}</span>
              <span v-if="it.owner" class="ml-2">👤 {{ it.owner }}</span>
              <span v-if="it.dueDate" class="ml-2">📅 {{ it.dueDate }}</span>
            </p>
          </div>
          <el-select
            :model-value="it.status"
            size="small"
            @update:model-value="(v) => onStatusChange(it.id, v as DeliverableStatus)"
          >
            <el-option value="not_started" label="未开始" />
            <el-option value="in_progress" label="进行中" />
            <el-option value="completed" label="已完成" />
            <el-option value="cancelled" label="已取消" />
          </el-select>
        </div>
        <div class="mt-2 flex items-center justify-between text-[11px]">
          <span :class="statusClass(it.status)">{{ statusLabel(it.status) }}</span>
          <div class="flex gap-2">
            <el-button link type="primary" size="small" @click="openEdit(it)">编辑</el-button>
            <el-button link type="danger" size="small" @click="onDelete(it.id)">删</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <el-dialog
      :model-value="editing !== null"
      :title="editing && editing.id ? '编辑交付物' : '新建交付物'"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && cancelEdit()"
    >
      <template v-if="editing">
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">名称</span>
          <el-input v-model="editing.title" class="mt-1" />
        </label>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">类型</span>
          <el-select v-model="editing.type" class="mt-1">
            <el-option label="文档" value="文档" />
            <el-option label="软件" value="软件" />
            <el-option label="服务" value="服务" />
            <el-option label="培训" value="培训" />
          </el-select>
        </label>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">负责人</span>
          <el-input v-model="editing.owner" class="mt-1" />
        </label>
        <label class="mb-3 block">
          <span class="text-xs text-slate-600">交付日期</span>
          <el-input v-model="editing.dueDate" type="date" class="mt-1" />
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
import type { DeliverableDTO, DeliverableStatus } from "../api/structured-modules.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

const items = computed<DeliverableDTO[]>(() => store.deliverablesByProject.get(props.projectId) ?? []);
const editing = ref<DeliverableDTO | null>(null);
const saving = ref(false);

onMounted(() => void store.loadDeliverables(props.projectId));

function openCreate(): void {
  editing.value = {
    id: "",
    projectId: props.projectId,
    title: "",
    type: "文档",
    owner: "",
    dueDate: "",
    status: "not_started",
    createdAt: "",
    updatedAt: "",
  };
}

function openEdit(it: DeliverableDTO): void {
  editing.value = {
    ...it,
    owner: it.owner ?? "",
    dueDate: it.dueDate ?? "",
  };
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
      await store.updateDeliverable(props.projectId, ed.id, {
        title: ed.title,
        type: ed.type,
        owner: ed.owner,
        dueDate: ed.dueDate,
      });
    } else {
      await store.createDeliverable(props.projectId, {
        title: ed.title,
        type: ed.type,
        owner: ed.owner,
        dueDate: ed.dueDate,
        status: ed.status,
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
  await store.deleteDeliverable(props.projectId, id);
}

async function onStatusChange(id: string, status: DeliverableStatus): Promise<void> {
  await store.setDeliverableStatus(props.projectId, id, status);
}

function statusClass(s: DeliverableStatus): string {
  return {
    not_started: "rounded bg-surface-sunken/40 px-1.5 py-0.5 text-slate-700",
    in_progress: "rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-700",
    completed: "rounded bg-accent-soft px-1.5 py-0.5 text-emerald-700",
    cancelled: "rounded bg-surface-sunken/40 px-1.5 py-0.5 text-slate-600 line-through",
  }[s];
}

function statusLabel(s: DeliverableStatus): string {
  return {
    not_started: "未开始",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
  }[s];
}
</script>