<!--
  HardwareItemsView.vue
  =====================
  硬件设备清单容器（阶段 7.4f）。
  - 顶部 header + 新增按钮
  - 嵌入 HardwareItemsTable（可编辑）
  - 挂载时自动 load
-->
<template>
  <header class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-slate-800">硬件清单</h2>
      <p class="text-xs text-slate-600">每行一类硬件；数量 × 单价 = 小计（实时计算）</p>
    </div>
    <button
      class="rounded bg-sky-700/60 px-3 py-1 text-xs text-sky-100 hover:bg-sky-700"
      @click="openAddDialog"
    >+ 新增硬件</button>
  </header>

  <div v-if="store.error" class="rounded border border-rose-700 bg-rose-50 px-3 py-2 text-xs text-rose-700">
    {{ store.error }}
  </div>

  <HardwareItemsTable
    :items="store.getItems(projectId)"
    :editable="true"
    @update="onUpdate"
    @delete="onDelete"
  />

  <!-- 新增弹窗 -->
  <div
    v-if="showAddDialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40"
    @click.self="showAddDialog = false"
  >
    <div class="w-[480px] rounded-lg border border-border bg-white p-5 shadow-xl">
      <h3 class="mb-3 text-sm font-semibold text-slate-900">新增硬件</h3>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-xs text-slate-700">
          <span>类别</span>
          <input v-model="draft.category" type="text" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" placeholder="服务器 / 网络 / 存储" />
        </label>
        <label class="block text-xs text-slate-700">
          <span>设备</span>
          <input v-model="draft.device" type="text" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" />
        </label>
        <label class="col-span-2 block text-xs text-slate-700">
          <span>规格 / 型号</span>
          <input v-model="draft.spec" type="text" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" />
        </label>
        <label class="block text-xs text-slate-700">
          <span>数量</span>
          <input v-model.number="draft.qty" type="number" min="1" step="1" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" />
        </label>
        <label class="block text-xs text-slate-700">
          <span>单价（元）</span>
          <input v-model.number="draft.unitPrice" type="number" min="0" step="0.01" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" />
        </label>
        <label class="col-span-2 block text-xs text-slate-700">
          <span>备注</span>
          <input v-model="draft.remarks" type="text" class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm" />
        </label>
      </div>
      <div class="mt-4 flex justify-end gap-2 text-xs">
        <button
          class="rounded bg-surface-sunken px-3 py-1 text-slate-800 hover:bg-slate-600"
          @click="showAddDialog = false"
        >取消</button>
        <button
          class="rounded bg-sky-700 px-3 py-1 text-sky-100 hover:bg-sky-600 disabled:opacity-50"
          :disabled="!canSubmit"
          @click="onCreate"
        >保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, reactive, computed } from "vue";
import HardwareItemsTable from "./HardwareItemsTable.vue";
import { useHardwareItemsStore } from "../stores/hardware-items.store.ts";
import type { HardwareItemInput } from "../api/hardware-items.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useHardwareItemsStore();

const showAddDialog = ref(false);
const draft = reactive<HardwareItemInput>({
  category: "",
  device: "",
  spec: "",
  qty: 1,
  unitPrice: 0,
  remarks: "",
});

const canSubmit = computed(() =>
  draft.device.trim().length > 0 &&
  Number.isInteger(draft.qty) && draft.qty >= 1 &&
  draft.unitPrice >= 0
);

onMounted(async () => {
  await store.load(props.projectId);
});

function openAddDialog() {
  draft.category = "";
  draft.device = "";
  draft.spec = "";
  draft.qty = 1;
  draft.unitPrice = 0;
  draft.remarks = "";
  showAddDialog.value = true;
}

async function onCreate() {
  const r = await store.create(props.projectId, { ...draft });
  if (r) showAddDialog.value = false;
}

async function onUpdate(id: string, patch: Partial<HardwareItemInput>) {
  await store.update(props.projectId, id, patch);
}

async function onDelete(id: string) {
  if (!confirm("确认删除该硬件项？")) return;
  await store.remove(props.projectId, id);
}
</script>