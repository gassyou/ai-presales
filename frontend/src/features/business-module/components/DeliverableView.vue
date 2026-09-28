<!--
  DeliverableView.vue
  ===================
  交付物清单（markdown 编辑，阶段 7.4a 重构）。

  形态：表格 + markdown 编辑（每个交付物一个 markdown 文档）
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">交付物清单</h2>
      <el-button size="small" @click="openCreate">新建交付物</el-button>
    </header>

    <p v-if="store.deliverableError" class="text-xs text-red-300">{{ store.deliverableError }}</p>

    <div v-if="items.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无交付物。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">名称</th>
            <th class="w-20 py-2">类型</th>
            <th class="w-20 py-2">负责人</th>
            <th class="w-24 py-2">交付日期</th>
            <th class="w-20 py-2">状态</th>
            <th class="w-20 py-2 text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in items"
            :key="it.id"
            class="border-b border-border/60 hover:bg-surface-alt/40"
          >
            <td class="py-2 pl-2 font-medium text-slate-900">{{ it.title }}</td>
            <td class="py-2 text-slate-600">{{ it.type || "未分类" }}</td>
            <td class="py-2 text-slate-600">{{ it.owner || "—" }}</td>
            <td class="py-2 text-slate-600">{{ it.dueDate || "—" }}</td>
            <td class="py-2">
              <span :class="statusClass(it.status)">{{ statusLabel(it.status) }}</span>
            </td>
            <td class="py-2 text-right pr-2">
              <el-button link type="primary" size="small" @click="openEdit(it)">编辑</el-button>
              <el-button link type="danger" size="small" @click="onDelete(it.id)">删</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑抽屉：含 markdown 内容 -->
    <el-drawer
      :model-value="editing !== null"
      :title="editing && editing.id ? `编辑交付物 · ${editing.title || ''}` : '新建交付物'"
      direction="rtl"
      size="760px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && cancelEdit()"
    >
      <template v-if="editing">
        <div class="flex h-full flex-col gap-3 px-1">
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              名称 *
              <el-input v-model="editing.title" />
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              类型
              <el-select v-model="editing.type">
                <el-option label="文档" value="文档" />
                <el-option label="软件" value="软件" />
                <el-option label="服务" value="服务" />
                <el-option label="培训" value="培训" />
              </el-select>
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              负责人
              <el-input v-model="editing.owner" />
            </label>
            <label class="flex flex-col gap-1 text-xs text-slate-600">
              交付日期
              <el-input v-model="editing.dueDate" type="date" />
            </label>
          </div>

          <label class="flex flex-col gap-1 text-xs text-slate-600">
            详细说明（Markdown）
            <div class="mt-1 flex-1 overflow-hidden rounded border border-border">
              <MarkdownEditor v-model="editing.detail" placeholder="交付物说明 / 验收标准 / 备注…" />
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
import type { DeliverableDTO, DeliverableStatus } from "../api/structured-modules.api.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

interface EditableDeliverable {
  id: string;
  projectId: string;
  title: string;
  type: string;
  owner: string;
  dueDate: string;
  status: DeliverableStatus;
  detail: string;        // markdown body
  createdAt: string;
  updatedAt: string;
}

const items = computed<DeliverableDTO[]>(() => store.deliverablesByProject.get(props.projectId) ?? []);
const editing = ref<EditableDeliverable | null>(null);
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
    detail: "",
    createdAt: "",
    updatedAt: "",
  };
}

function openEdit(it: DeliverableDTO): void {
  editing.value = {
    ...it,
    owner: it.owner ?? "",
    dueDate: it.dueDate ?? "",
    detail: (it as DeliverableDTO & { detail?: string }).detail ?? "",
  };
}

function cancelEdit(): void {
  editing.value = null;
}

async function onSave(): Promise<void> {
  const ed = editing.value;
  if (!ed) return;
  if (!ed.title.trim()) {
    ElMessage.error("请输入名称");
    return;
  }
  saving.value = true;
  try {
    if (ed.id.length > 0) {
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