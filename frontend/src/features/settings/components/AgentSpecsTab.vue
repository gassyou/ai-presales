<!--
  AgentSpecsTab.vue —— 阶段 7.4h + 阶段 13（PR #3）

  Sub-agent spec 管理：实时 CRUD（取消批量编辑）。
  - 顶部 "+ 新增用户 sub-agent" 按钮
  - 下方按"系统 sub-agent" / "用户 sub-agent"两组展示
  - 每张 system 卡片只读（"内置不可编辑"）
  - 每张 user 卡片右侧"编辑 / 删除"两个按钮
        删除 → ElMessageBox.confirm 二次确认
        编辑 → 弹 SubAgentEditDialog
  - 整页"保存"按钮已删除（实时同步）
-->
<template>
  <section class="flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">Sub-agent 配置</h2>
      <el-button type="primary" @click="openCreate">
        + 新增用户 sub-agent
      </el-button>
    </header>

    <el-alert
      v-if="store.error"
      :title="store.error"
      type="error"
      :closable="false"
      show-icon
    />

    <div v-if="!snap" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="flex flex-col gap-4">
      <!-- 系统 sub-agent -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
          系统 sub-agent（{{ systemSpecs.length }}，只读）
        </h3>
        <div v-if="systemSpecs.length === 0" class="text-xs text-slate-500">
          （暂无）
        </div>
        <div v-else class="flex flex-col gap-2">
          <article
            v-for="s in systemSpecs"
            :key="s.name"
            class="rounded border border-border bg-slate-50 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-base">{{ s.displayName || s.name }}</span>
                  <code class="text-xs text-slate-500">{{ s.name }}</code>
                </div>
                <p v-if="s.description" class="text-xs text-slate-600">{{ s.description }}</p>
                <div class="mt-1 flex flex-wrap gap-1">
                  <el-tag
                    v-for="t in s.toolNames"
                    :key="t"
                    size="small"
                    type="info"
                    effect="plain"
                  >{{ t }}</el-tag>
                </div>
                <div v-if="s.profileHint" class="mt-1 text-xs text-slate-500">
                  profile: <code>{{ s.profileHint }}</code>
                </div>
              </div>
              <span class="shrink-0 text-xs text-slate-400">内置不可编辑</span>
            </div>
          </article>
        </div>
      </section>

      <!-- 用户 sub-agent -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
          用户 sub-agent（{{ userSpecs.length }}）
        </h3>
        <div v-if="userSpecs.length === 0" class="text-xs text-slate-500">
          （暂无。点击右上角"+ 新增用户 sub-agent"创建。）
        </div>
        <div v-else class="flex flex-col gap-2">
          <article
            v-for="s in userSpecs"
            :key="s.name"
            class="rounded border border-border bg-white p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-base">{{ s.displayName || s.name }}</span>
                  <code class="text-xs text-slate-500">{{ s.name }}</code>
                </div>
                <p v-if="s.description" class="text-xs text-slate-600">{{ s.description }}</p>
                <div class="mt-1 flex flex-wrap gap-1">
                  <el-tag
                    v-for="t in s.toolNames"
                    :key="t"
                    size="small"
                    type="info"
                    effect="plain"
                  >{{ t }}</el-tag>
                </div>
                <div v-if="s.profileHint" class="mt-1 text-xs text-slate-500">
                  profile: <code>{{ s.profileHint }}</code>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <el-button
                  size="small"
                  :loading="busyName === s.name && dialogMode === 'update'"
                  @click="openEdit(s)"
                >编辑</el-button>
                <el-button
                  size="small"
                  type="danger"
                  :loading="busyName === s.name && dialogMode === 'delete'"
                  @click="onDelete(s)"
                >删除</el-button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <SubAgentEditDialog
      v-if="dialogOpen"
      :spec="editing"
      :tool-options="KNOWN_TOOLS"
      :llm-profile-options="llmProfileNames"
      :submitting="busyName !== null"
      :error="dialogError"
      @close="closeDialog"
      @submit="onSubmit"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
// ElMessage / ElMessageBox 由 frontend/src/types/auto-imports.d.ts 全局声明
import { useSettingsStore } from "../stores/settings.store.ts";
import type { SubAgentSpecDTO } from "../api/settings.api.ts";
import SubAgentEditDialog from "./SubAgentEditDialog.vue";
import type {
  CreateUserSubAgentInput,
  UpdateUserSubAgentInput,
} from "@shared/types/dto/sub-agent.ts";

const store = useSettingsStore();

// 阶段 13（PR #3）：与原有 AgentSpecsTab 的已知工具列表保持一致
const KNOWN_TOOLS = [
  "current_datetime",
  "list_files",
  "read_file",
  "search_knowledge",
  "read_module",
];

const snap = computed(() => store.agentSpecs);
const llmProfileNames = computed<string[]>(() => {
  const p = store.llmProfiles;
  if (!p) return [];
  return p.profiles.map((x) => x.name);
});

const systemSpecs = computed<SubAgentSpecDTO[]>(() => {
  if (!snap.value) return [];
  return Object.values(snap.value.specs)
    .filter((s) => s.type === "system")
    .sort((a, b) => a.name.localeCompare(b.name));
});

const userSpecs = computed<SubAgentSpecDTO[]>(() => {
  if (!snap.value) return [];
  return Object.values(snap.value.specs)
    .filter((s) => s.type === "user")
    .sort((a, b) => a.name.localeCompare(b.name));
});

// ---- dialog 状态 ----

const dialogOpen = ref(false);
const dialogMode = ref<"create" | "update" | "delete">("create");
const editing = ref<SubAgentSpecDTO | undefined>(undefined);
const busyName = ref<string | null>(null);
const dialogError = ref<string | null>(null);

function openCreate(): void {
  editing.value = undefined;
  dialogMode.value = "create";
  dialogError.value = null;
  dialogOpen.value = true;
}

function openEdit(spec: SubAgentSpecDTO): void {
  editing.value = spec;
  dialogMode.value = "update";
  dialogError.value = null;
  dialogOpen.value = true;
}

function closeDialog(): void {
  dialogOpen.value = false;
  editing.value = undefined;
  busyName.value = null;
  dialogError.value = null;
}

async function onSubmit(payload:
  | { mode: "create"; input: CreateUserSubAgentInput }
  | { mode: "update"; name: string; input: UpdateUserSubAgentInput }
): Promise<void> {
  if (payload.mode === "create") {
    busyName.value = "__new__";
    const r = await store.createAgentSpec(payload.input);
    busyName.value = null;
    if (r.ok) {
      ElMessage.success("sub-agent 已创建");
      closeDialog();
    } else {
      dialogError.value = r.error;
    }
  } else {
    busyName.value = payload.name;
    const r = await store.updateAgentSpec(payload.name, payload.input);
    busyName.value = null;
    if (r.ok) {
      ElMessage.success("sub-agent 已更新");
      closeDialog();
    } else {
      dialogError.value = r.error;
    }
  }
}

async function onDelete(spec: SubAgentSpecDTO): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除用户 sub-agent "${spec.displayName || spec.name}"？此操作不可恢复。`,
      "删除 sub-agent",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return; // 用户取消
  }
  dialogMode.value = "delete";
  busyName.value = spec.name;
  const r = await store.removeAgentSpec(spec.name);
  busyName.value = null;
  if (r.ok) {
    ElMessage.success("sub-agent 已删除");
  } else {
    ElMessage.error(r.error);
  }
}
</script>