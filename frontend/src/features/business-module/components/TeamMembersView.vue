<!--
  TeamMembersView.vue
  ===================
  团队成员视图（阶段 7.4e 重构）。
  单页（无 tab 切换）；表格列出所有属性。
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        团队成员（{{ members.length }}）
      </h2>
      <el-button size="small" @click="openCreate">+ 新增团队成员</el-button>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <div v-if="members.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无团队成员。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">姓名</th>
            <th class="w-44 py-2">邮箱</th>
            <th class="w-28 py-2">电话</th>
            <th class="w-24 py-2 text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in members"
            :key="m.id"
            class="border-b border-border/60 hover:bg-surface-alt/40"
          >
            <td class="py-2 pl-2 font-medium text-slate-900">{{ m.name }}</td>
            <td class="py-2 text-slate-600">
              <a v-if="m.email" :href="`mailto:${m.email}`" class="text-accent hover:underline">{{ m.email }}</a>
              <span v-else>—</span>
            </td>
            <td class="py-2 text-slate-600">{{ m.phone || "—" }}</td>
            <td class="py-2 text-right pr-2">
              <el-button link type="primary" size="small" @click="openEdit(m)">编辑</el-button>
              <el-button link type="danger" size="small" @click="remove(m.id)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <el-dialog
      :model-value="modal !== null"
      :title="modalTitle"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && closeModal()"
    >
      <template v-if="modal">
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            姓名 *
            <el-input v-model="modal.name" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            邮箱
            <el-input v-model="modal.email" placeholder="name@example.com" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            电话
            <el-input v-model="modal.phone" placeholder="13800000000" />
          </label>
          <p v-if="modalError" class="text-xs text-red-300">{{ modalError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="closeModal">取消</el-button>
          <el-button type="primary" :loading="modalSaving" @click="submitModal">{{ modalSaving ? "保存中…" : "保存" }}</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { teamMembersApi } from "@frontend/features/project/api/team-members.api.ts";
import type { TeamMemberDTO } from "@shared/types/dto/project.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{
  projectId: string;
  initialMembers?: readonly TeamMemberDTO[];
}>();

const emit = defineEmits<{ (e: "updated"): void }>();

const members = ref<TeamMemberDTO[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

interface ModalState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  email: string;
  phone: string;
}

const modal = ref<ModalState | null>(null);
const modalError = ref<string | null>(null);
const modalSaving = ref(false);

const modalTitle = computed(() =>
  !modal.value ? "" : (modal.value.mode === "create" ? "新增团队成员" : "编辑团队成员"),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const r = await teamMembersApi.list(props.projectId);
    members.value = r.items;
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  modal.value = { mode: "create", name: "", email: "", phone: "" };
  modalError.value = null;
}

function openEdit(m: TeamMemberDTO): void {
  modal.value = {
    mode: "edit",
    id: m.id,
    name: m.name,
    email: m.email ?? "",
    phone: m.phone ?? "",
  };
  modalError.value = null;
}

function closeModal(): void {
  modal.value = null;
  modalError.value = null;
}

async function submitModal(): Promise<void> {
  const m = modal.value;
  if (!m) return;
  if (!m.name.trim()) {
    modalError.value = "姓名为必填";
    return;
  }
  modalSaving.value = true;
  modalError.value = null;
  try {
    const payload: { name: string; email?: string; phone?: string } = {
      name: m.name.trim(),
      ...(m.email ? { email: m.email } : {}),
      ...(m.phone ? { phone: m.phone } : {}),
    };
    if (m.mode === "create") {
      await teamMembersApi.create(props.projectId, payload);
    } else if (m.id) {
      await teamMembersApi.update(props.projectId, m.id, payload);
    }
    await load();
    closeModal();
    emit("updated");
  } catch (e) {
    modalError.value = errMsg(e);
  } finally {
    modalSaving.value = false;
  }
}

async function remove(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认删除该团队成员？", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await teamMembersApi.delete(props.projectId, id);
    await load();
    emit("updated");
  } catch (e) {
    error.value = errMsg(e);
  }
}

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error ? e.message : String(e);
}

watch(() => props.projectId, () => {
  void load();
});

onMounted(() => {
  if (props.initialMembers && props.initialMembers.length > 0) {
    members.value = [...props.initialMembers];
  }
  void load();
});
</script>