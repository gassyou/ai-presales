<!--
  ActivityListView.vue
  =====================
  「项目推进活动计划」列表页（阶段 7.0；首个落地模块）

  需求文档「项目详情下面包括以下内容 → 1. 项目推进活动计划管理页面」：
    1. 可以创建新活动，填写：活动名称、活动内容、计划日期、客户主负责人
    2. 列表展示所有活动，显示状态
    3. 可以删除活动
    4. 每个活动可以记录实施情况（实施日 / 已达成 / 客户课题 / 下次计划）
    5. 可在 AI 对话框中以自然语言登记实施情况

  阶段 7.0 实现 1-3 + 4 的最简版（实施情况作为 markdown 文本填在 content 字段）。
  AI 自然语言登记作为后续阶段 7.x。

  形态：通用 BusinessModule 服务承载（kind="activity"），结构化数据存 payloadJson；
  content 字段用于实施情况记录的 markdown 文本。
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
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

    <ul v-if="items.length > 0" class="space-y-2">
      <li
        v-for="it in items"
        :key="it.id"
        class="flex items-start justify-between gap-3 rounded border border-border bg-white/40 p-3 text-xs"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-slate-900">{{ it.title }}</span>
            <span :class="statusClass(it.status)">
              {{ statusLabel(it.status) }}
            </span>
          </div>
          <div v-if="payloadOf(it).planDate" class="text-slate-500">
            计划日：{{ payloadOf(it).planDate }}
          </div>
          <div v-if="payloadOf(it).clientContactName" class="text-slate-500">
            客户主负责人：{{ payloadOf(it).clientContactName }}
          </div>
          <div v-if="it.content" class="mt-1 whitespace-pre-wrap text-slate-700">
            {{ it.content }}
          </div>
        </div>
        <div class="flex shrink-0 flex-col gap-1">
          <button
            class="rounded border border-border px-2 py-0.5 text-slate-600 hover:bg-surface-alt"
            @click="onDelete(it.id)"
          >
            删除
          </button>
          <button
            v-if="it.status !== 'adopted'"
            class="rounded border border-accent px-2 py-0.5 text-emerald-700 hover:bg-accent-soft"
            @click="onAdopt(it.id)"
          >
            标记完成
          </button>
        </div>
      </li>
    </ul>

    <p v-else class="text-xs text-slate-500">暂无活动。点击右上角新建。</p>

    <!-- 新建对话框 -->
    <div
      v-if="showCreate"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
      @click.self="showCreate = false"
    >
      <form
        class="card flex w-full max-w-md flex-col gap-3"
        @submit.prevent="onCreate"
      >
        <h3 class="text-sm font-medium text-slate-800">新建活动</h3>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          活动名称
          <input
            v-model="form.title"
            required
            maxlength="200"
            class="rounded border border-border bg-white px-2 py-1 text-slate-800"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          计划日期
          <input
            v-model="form.planDate"
            type="date"
            class="rounded border border-border bg-white px-2 py-1 text-slate-800"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          客户主负责人
          <input
            v-model="form.clientContactName"
            class="rounded border border-border bg-white px-2 py-1 text-slate-800"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          活动内容
          <textarea
            v-model="form.content"
            rows="3"
            class="rounded border border-border bg-white px-2 py-1 text-slate-800"
          />
        </label>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded border border-border px-3 py-1 text-xs text-slate-600 hover:bg-surface-alt"
            @click="showCreate = false"
          >
            取消
          </button>
          <button
            type="submit"
            class="rounded border border-accent/50 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20"
          >
            创建
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useBusinessModuleStore } from "../stores/business-module.store.ts";
import type { BusinessModuleItemDTO } from "@shared/types/dto/business-module.ts";

const props = defineProps<{ projectId: string }>();
const store = useBusinessModuleStore();
const items = computed(() => store.getList(props.projectId, "activity"));
const showCreate = ref(false);
const form = reactive({
  title: "",
  planDate: "",
  clientContactName: "",
  content: "",
});

interface ActivityPayload {
  planDate?: string;
  clientContactName?: string;
}

function payloadOf(it: BusinessModuleItemDTO): ActivityPayload {
  try {
    return JSON.parse(it.payloadJson || "{}") as ActivityPayload;
  } catch {
    return {};
  }
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
  const payload: ActivityPayload = {
    planDate: form.planDate || undefined,
    clientContactName: form.clientContactName || undefined,
  };
  await store.createItem(props.projectId, "activity", {
    title: form.title,
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
  if (!confirm("确认删除？")) return;
  await store.deleteItem(id, props.projectId, "activity");
}

async function onAdopt(id: string): Promise<void> {
  await store.adopt(id, props.projectId, "activity");
}

onMounted(() => {
  void store.loadList(props.projectId, "activity");
});
</script>
