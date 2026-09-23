<!--
  UseCaseView.vue
  ===============
  核心系统用例列表 + 编辑（阶段 7.4a）。

  形态：
    - 顶部：新建按钮（标题 / 用例编号 / 业务规则）
    - 主体：表格（caseId / 标题 / 业务规则摘要）+ 行内编辑 + 删除
    - 详细描述（detail）抽屉式 textarea
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">核心系统用例</h2>
      <button
        class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
        @click="openCreate"
      >新建用例</button>
    </header>

    <p v-if="store.useCaseError" class="text-xs text-red-300">{{ store.useCaseError }}</p>

    <div v-if="items.length === 0" class="rounded border border-border bg-white/50 p-4 text-xs text-slate-600">
      暂无用例。点击右上角「新建用例」开始。
    </div>

    <table v-else class="w-full text-xs">
      <thead class="text-left text-slate-600">
        <tr class="border-b border-border">
          <th class="w-24 py-1">用例编号</th>
          <th class="py-1">标题</th>
          <th class="py-1">业务规则</th>
          <th class="w-16 py-1"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" class="border-b border-border/60 align-top">
          <td class="py-2 font-mono text-accent">{{ it.caseId || "—" }}</td>
          <td class="py-2 text-slate-800">{{ it.title }}</td>
          <td class="py-2 text-slate-600 line-clamp-2 max-w-[260px]">
            {{ it.businessRules || "—" }}
          </td>
          <td class="py-2 text-right">
            <button class="text-accent hover:underline" @click="openEdit(it)">编辑</button>
            <button class="ml-2 text-red-400 hover:underline" @click="onDelete(it.id)">删</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 编辑抽屉 -->
    <div
      v-if="editing"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4"
      @click.self="cancelEdit"
    >
      <div class="w-full max-w-xl rounded border border-border bg-white p-4 shadow-xl">
        <h3 class="mb-3 text-sm font-medium text-slate-800">
          {{ editing.id ? "编辑用例" : "新建用例" }}
        </h3>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">标题</span>
          <input
            v-model="editing.title"
            class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800"
            placeholder="订单创建"
          />
        </label>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">用例编号</span>
          <input
            v-model="editing.caseId"
            class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800"
            placeholder="UC-001"
          />
        </label>
        <label class="mb-2 block">
          <span class="text-xs text-slate-600">业务规则</span>
          <textarea
            v-model="editing.businessRules"
            rows="3"
            class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800"
            placeholder="需校验用户实名..."
          />
        </label>
        <label class="mb-3 block">
          <span class="text-xs text-slate-600">详细描述（Markdown）</span>
          <textarea
            v-model="editing.detail"
            rows="6"
            class="mt-1 w-full rounded border border-border bg-surface-alt p-2 font-mono text-xs text-slate-800"
            placeholder="前置 / 步骤 / 后置..."
          />
        </label>
        <div class="flex justify-end gap-2">
          <button class="rounded border border-border px-3 py-1 text-xs text-slate-700 hover:bg-surface-alt" @click="cancelEdit">取消</button>
          <button
            class="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10"
            :disabled="saving"
            @click="onSave"
          >{{ saving ? "保存中…" : "保存" }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStructuredModulesStore } from "../stores/structured-modules.store.ts";
import type { UseCaseDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useStructuredModulesStore();

const items = computed<UseCaseDTO[]>(() => store.useCasesByProject.get(props.projectId) ?? []);
const editing = ref<UseCaseDTO | null>(null);
const saving = ref(false);

onMounted(() => void store.loadUseCases(props.projectId));

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
  saving.value = true;
  try {
    if (ed.id) {
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
  if (!confirm("确认删除？")) return;
  await store.deleteUseCase(props.projectId, id);
}
</script>