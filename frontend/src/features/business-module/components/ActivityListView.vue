<!--
  ActivityListView.vue
  =====================
  「项目推进活动计划」表格视图 + 推进结果记录（阶段 7.0 + 重构）。

  需求：
    1. 表格列出所有活动（标题 / 计划日 / 客户主负责人 / 状态 / 推进结果摘要）
    2. 每条活动可点开抽屉记录推进结果（输入 / 实际推进时间 / 取得成果 / 遗留课题）
    3. 推进结果以 markdown 形式存到 content + payloadJson 中
    4. 新建 / 删除 / 标记完成
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        项目推进活动计划（{{ items.length }}）
      </h2>
      <button
        class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
        @click="showCreate = true"
      >
        + 新建活动
      </button>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>

    <div v-if="items.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无活动。点击右上角新建。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">活动名称</th>
            <th class="w-28 py-2">计划日</th>
            <th class="w-32 py-2">客户主负责人</th>
            <th class="w-20 py-2">实际推进</th>
            <th class="w-16 py-2">状态</th>
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
            <td class="py-2 text-slate-600">{{ payloadOf(it).planDate || "—" }}</td>
            <td class="py-2 text-slate-600">{{ payloadOf(it).clientContactName || "—" }}</td>
            <td class="py-2 text-slate-600">
              <span v-if="resultOf(it).actualDate">{{ resultOf(it).actualDate }}</span>
              <span v-else class="text-slate-400">—</span>
            </td>
            <td class="py-2">
              <span :class="statusClass(it.status)">{{ statusLabel(it.status) }}</span>
            </td>
            <td class="py-2 text-right pr-2">
              <el-button link type="primary" size="small" @click="openResult(it)">推进结果</el-button>
              <el-button link type="success" size="small" :disabled="it.status === 'adopted'" @click="onAdopt(it.id)">完成</el-button>
              <el-button link type="danger" size="small" @click="onDelete(it.id)">删</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新建对话框 -->
    <el-dialog
      v-model="showCreate"
      title="新建活动"
      width="480px"
      :close-on-click-modal="false"
    >
      <form class="flex flex-col gap-3" @submit.prevent="onCreate">
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          活动名称 *
          <el-input v-model="form.title" required maxlength="200" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          计划日期
          <el-input v-model="form.planDate" type="date" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          客户主负责人
          <el-input v-model="form.clientContactName" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          活动内容
          <el-input v-model="form.content" type="textarea" :rows="3" />
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" @click="onCreate">创建</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 推进结果抽屉 -->
    <el-drawer
      v-model="drawerOpen"
      :title="drawerTitle"
      direction="rtl"
      size="640px"
      :close-on-click-modal="false"
    >
      <div v-if="drawerItem" class="flex h-full flex-col gap-3 px-1">
        <div class="rounded border border-border bg-surface-alt/40 p-3 text-xs text-slate-600">
          <div class="font-medium text-slate-700">{{ drawerItem.title }}</div>
          <div class="mt-1 grid grid-cols-2 gap-2">
            <div>计划日：{{ payloadOf(drawerItem).planDate || "—" }}</div>
            <div>主负责人：{{ payloadOf(drawerItem).clientContactName || "—" }}</div>
          </div>
        </div>

        <label class="flex flex-col gap-1 text-xs text-slate-600">
          实际推进时间 *
          <el-input v-model="resultForm.actualDate" type="date" />
        </label>

        <label class="flex flex-col gap-1 text-xs text-slate-600">
          取得成果（Markdown）
          <div class="mt-1 h-64 overflow-hidden rounded border border-border">
            <MarkdownEditor v-model="resultForm.outcomes" placeholder="取得的成果…" />
          </div>
        </label>

        <label class="flex flex-col gap-1 text-xs text-slate-600">
          遗留课题（Markdown）
          <div class="mt-1 h-64 overflow-hidden rounded border border-border">
            <MarkdownEditor v-model="resultForm.issues" placeholder="遗留课题 / 待跟进事项…" />
          </div>
        </label>

        <p v-if="drawerError" class="text-xs text-red-300">{{ drawerError }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <el-button @click="drawerOpen = false">取消</el-button>
          <el-button type="primary" :loading="drawerSaving" @click="onSaveResult">保存推进结果</el-button>
        </div>
      </div>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useBusinessModuleStore } from "../stores/business-module.store.ts";
import type { BusinessModuleItemDTO } from "@shared/types/dto/business-module.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();
const store = useBusinessModuleStore();
const items = computed(() => store.getList(props.projectId, "activity"));

interface ActivityPayload {
  planDate?: string;
  clientContactName?: string;
}
interface ActivityResultPayload {
  actualDate?: string;
  outcomes?: string;     // markdown
  issues?: string;       // markdown
}

const showCreate = ref(false);
const form = reactive({
  title: "",
  planDate: "",
  clientContactName: "",
  content: "",
});

const drawerOpen = ref(false);
const drawerItem = ref<BusinessModuleItemDTO | null>(null);
const drawerSaving = ref(false);
const drawerError = ref<string | null>(null);
const resultForm = reactive<{
  actualDate: string;
  outcomes: string;
  issues: string;
}>({
  actualDate: "",
  outcomes: "",
  issues: "",
});

const drawerTitle = computed(() =>
  drawerItem.value ? `推进结果 · ${drawerItem.value.title}` : "推进结果",
);

function payloadOf(it: BusinessModuleItemDTO): ActivityPayload {
  try { return JSON.parse(it.payloadJson || "{}") as ActivityPayload; }
  catch { return {}; }
}

function resultOf(it: BusinessModuleItemDTO): ActivityResultPayload {
  try { return JSON.parse(it.payloadJson || "{}") as ActivityResultPayload; }
  catch { return {}; }
}

function statusLabel(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "已完成";
  if (s === "unadopted") return "已搁置";
  return "计划中";
}

function statusClass(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-emerald-700";
  if (s === "unadopted") return "rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-500";
  return "rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700";
}

async function onCreate(): Promise<void> {
  if (!form.title.trim()) return;
  const payload: ActivityPayload = {
    planDate: form.planDate || undefined,
    clientContactName: form.clientContactName || undefined,
  };
  await store.createItem(props.projectId, "activity", {
    title: form.title.trim(),
    content: form.content,
    payloadJson: JSON.stringify(payload),
  });
  showCreate.value = false;
  form.title = "";
  form.planDate = "";
  form.clientContactName = "";
  form.content = "";
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
  await store.deleteItem(id, props.projectId, "activity");
}

async function onAdopt(id: string): Promise<void> {
  await store.adopt(id, props.projectId, "activity");
}

function openResult(it: BusinessModuleItemDTO): void {
  drawerItem.value = it;
  const p = resultOf(it);
  resultForm.actualDate = p.actualDate ?? "";
  resultForm.outcomes = p.outcomes ?? "";
  resultForm.issues = p.issues ?? "";
  drawerError.value = null;
  drawerOpen.value = true;
}

async function onSaveResult(): Promise<void> {
  const it = drawerItem.value;
  if (!it) return;
  if (!resultForm.actualDate) {
    drawerError.value = "请填写实际推进时间";
    return;
  }
  drawerSaving.value = true;
  drawerError.value = null;
  try {
    // 合并原 payload + 新 result
    const basePayload: ActivityResultPayload = resultOf(it);
    const merged: ActivityResultPayload = {
      ...basePayload,
      actualDate: resultForm.actualDate,
      outcomes: resultForm.outcomes,
      issues: resultForm.issues,
    };
    await store.updateItem(it.id, props.projectId, "activity", {
      payloadJson: JSON.stringify(merged),
    });
    drawerOpen.value = false;
  } catch (e) {
    drawerError.value = e instanceof Error ? e.message : String(e);
  } finally {
    drawerSaving.value = false;
  }
}

onMounted(() => {
  void store.loadList(props.projectId, "activity");
});
</script>