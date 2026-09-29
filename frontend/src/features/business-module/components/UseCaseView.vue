<!--
  UseCaseView.vue
  ===============
  核心系统用例便签贴照片墙（mac 风格便签 + 照片墙布局）。

  形态：
    - 顶部：新建便签按钮（不需要输入名称，便签内联编辑）
    - 主体：masonry / flex-wrap 网格，每张便签一种背景色（基于 id 哈希）
    - 便签内容：标题 + 业务规则 + Markdown 详细描述（双击卡片打开 markdown 编辑）
-->
<template>
  <section class="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">核心系统用例（{{ items.length }}）</h2>
      <el-button size="small" @click="openCreate">新建便签</el-button>
    </header>

    <p v-if="store.useCaseError" class="text-xs text-red-300">{{ store.useCaseError }}</p>

    <div v-if="items.length === 0" class="rounded border border-dashed border-border bg-white/30 p-6 text-center text-xs text-slate-500">
      暂无便签。点击右上角新建第一张便签。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <div class="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
        <div
          v-for="it in items"
          :key="it.id"
          class="mb-3 break-inside-avoid"
        >
          <div
            class="group relative cursor-text rounded-md border border-black/5 p-3 text-xs shadow-sm transition hover:shadow-md"
            :class="noteBgClass(it.id)"
            @click="openEdit(it)"
          >
            <div class="flex items-start justify-between gap-2">
              <code v-if="it.caseId" class="rounded bg-black/10 px-1 text-[10px] text-black/60">{{ it.caseId }}</code>
              <button
                class="rounded px-1 text-black/40 hover:bg-black/10 hover:text-rose-600"
                title="删除"
                @click.stop="onDelete(it.id)"
              >×</button>
            </div>
            <h3 class="mt-1 text-sm font-semibold text-black/85">{{ it.title || "（未命名）" }}</h3>
            <p
              v-if="it.businessRules"
              class="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-black/75"
            >{{ it.businessRules }}</p>
            <p
              v-if="it.detail"
              class="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-[10px] text-black/55"
            >{{ it.detail }}</p>
            <div class="absolute bottom-1 right-2 text-[9px] text-black/30 opacity-0 group-hover:opacity-100">
              点击编辑
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <el-dialog
      :model-value="editing !== null"
      :title="editing && editing.id ? '编辑用例' : '新建用例'"
      width="720px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && cancelEdit()"
    >
      <template v-if="editing">
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            标题 *
            <el-input v-model="editing.title" placeholder="订单创建" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            用例编号
            <el-input v-model="editing.caseId" placeholder="UC-001" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            业务规则
            <el-input v-model="editing.businessRules" type="textarea" :rows="3" placeholder="需校验用户实名..." />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            详细描述（Markdown）
            <div class="mt-1 h-72 overflow-hidden rounded border border-border">
              <MarkdownEditor
                v-model="editing.detail"
                :fill-height="false"
                placeholder="前置 / 步骤 / 后置..."
              />
            </div>
          </label>
        </div>
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
import type { UseCaseDTO } from "../api/structured-modules.api.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

const items = computed<UseCaseDTO[]>(() => store.useCasesByProject.get(props.projectId) ?? []);
const editing = ref<UseCaseDTO | null>(null);
const saving = ref(false);

onMounted(() => void store.loadUseCases(props.projectId));

/** mac 便签背景色板（7 种） */
const NOTE_COLORS = [
  "bg-yellow-100",      // 经典黄
  "bg-pink-100",        // 粉
  "bg-blue-100",        // 蓝
  "bg-green-100",       // 绿
  "bg-purple-100",      // 紫
  "bg-orange-100",      // 橙
  "bg-slate-100",       // 灰
];

/** 基于 id 哈希选一个稳定的颜色 */
function noteBgClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return NOTE_COLORS[Math.abs(hash) % NOTE_COLORS.length] ?? "bg-yellow-100";
}

function openCreate(): void {
  editing.value = {
    id: "",
    projectId: props.projectId,
    title: "",
    detail: "",
    caseId: "",
    businessRules: "",
    createdAt: "",
    updatedAt: "",
  };
}

function openEdit(it: UseCaseDTO): void {
  editing.value = { ...it };
}

function cancelEdit(): void {
  editing.value = null;
}

async function onSave(): Promise<void> {
  const ed = editing.value;
  if (!ed) return;
  if (!ed.title.trim()) {
    ElMessage.error("请输入标题");
    return;
  }
  saving.value = true;
  try {
    if (ed.id.length > 0) {
      await store.updateUseCase(props.projectId, ed.id, {
        title: ed.title,
        detail: ed.detail,
        caseId: ed.caseId,
        businessRules: ed.businessRules,
      });
    } else {
      await store.createUseCase(props.projectId, {
        title: ed.title,
        detail: ed.detail,
        caseId: ed.caseId,
        businessRules: ed.businessRules,
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
  await store.deleteUseCase(props.projectId, id);
}
</script>