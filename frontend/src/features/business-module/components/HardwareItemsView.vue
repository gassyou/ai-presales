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
    <el-button
      size="small"
      @click="openAddDialog"
    >+ 新增硬件</el-button>
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
  <el-dialog
    v-model="showAddDialog"
    title="新增硬件"
    width="520px"
    :close-on-click-modal="false"
  >
    <div class="grid grid-cols-2 gap-3">
      <label class="block text-xs text-slate-700">
        <span>类别</span>
        <el-input v-model="draft.category" placeholder="服务器 / 网络 / 存储" class="mt-1" />
      </label>
      <label class="block text-xs text-slate-700">
        <span>设备</span>
        <el-input v-model="draft.device" class="mt-1" />
      </label>
      <label class="col-span-2 block text-xs text-slate-700">
        <span>规格 / 型号</span>
        <el-input v-model="draft.spec" class="mt-1" />
      </label>
      <label class="block text-xs text-slate-700">
        <span>数量</span>
        <el-input-number v-model="draft.qty" :min="1" :step="1" class="mt-1" />
      </label>
      <label class="block text-xs text-slate-700">
        <span>单价（元）</span>
        <el-input-number v-model="draft.unitPrice" :min="0" :step="0.01" class="mt-1" />
      </label>
      <label class="col-span-2 block text-xs text-slate-700">
        <span>备注</span>
        <el-input v-model="draft.remarks" class="mt-1" />
      </label>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!canSubmit" @click="onCreate">保存</el-button>
      </div>
    </template>
  </el-dialog>
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
  try {
    await ElMessageBox.confirm("确认删除该硬件项？", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await store.remove(props.projectId, id);
}
</script>