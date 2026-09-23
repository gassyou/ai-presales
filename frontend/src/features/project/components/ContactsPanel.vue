<!--
  ContactsPanel.vue
  =================
  项目联系人 / 团队成员管理卡（阶段 7.4e）。

  形态：
    - tab 切换：联系人 / 团队成员
    - 联系人列表：每行 name / title / email / phone / 主联系人徽章 / 编辑 / 删除
    - 团队成员列表：每行 name / email / phone / 编辑 / 删除
    - 行内「新建」按钮 + 表单弹层（避免与主列表视觉冲突）
-->
<template>
  <section class="flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex gap-1">
        <button
          :class="tab === 'contacts'
            ? 'bg-accent/20 text-accent'
            : 'text-slate-600 hover:bg-surface-alt'"
          class="rounded px-3 py-1 text-xs"
          @click="setTab('contacts')"
        >联系人（{{ contacts.length }}）</button>
        <button
          :class="tab === 'team'
            ? 'bg-accent/20 text-accent'
            : 'text-slate-600 hover:bg-surface-alt'"
          class="rounded px-3 py-1 text-xs"
          @click="setTab('team')"
        >团队成员（{{ members.length }}）</button>
      </div>
      <button
        class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
        @click="openCreate"
      >+ 新增{{ tab === "contacts" ? "联系人" : "团队成员" }}</button>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <!-- contacts list -->
    <ul v-if="tab === 'contacts'" class="space-y-1.5 text-xs">
      <li
        v-for="c in contacts"
        :key="c.id"
        class="flex items-center gap-2 rounded border border-border bg-white/30 px-2 py-1.5"
      >
        <span class="text-slate-900">{{ c.name }}</span>
        <span v-if="c.title" class="text-slate-500">({{ c.title }})</span>
        <span v-if="c.email" class="text-slate-500">· {{ c.email }}</span>
        <span v-if="c.phone" class="text-slate-500">· {{ c.phone }}</span>
        <span v-if="c.isPrimary" class="rounded bg-accent/20 px-1 text-accent">主联系人</span>
        <div class="ml-auto flex gap-1">
          <button
            v-if="!c.isPrimary"
            class="rounded border border-border px-1.5 py-0.5 text-slate-600 hover:bg-surface-alt"
            @click="setPrimary(c.id)"
          >设为主联系人</button>
          <button
            class="rounded border border-border px-1.5 py-0.5 text-slate-600 hover:bg-surface-alt"
            @click="openEditContact(c)"
          >编辑</button>
          <button
            class="rounded border border-red-900/50 px-1.5 py-0.5 text-red-300 hover:bg-red-900/30"
            @click="removeContact(c.id)"
          >删除</button>
        </div>
      </li>
      <li
        v-if="contacts.length === 0 && !loading"
        class="rounded border border-dashed border-border bg-white/30 p-3 text-center text-slate-500"
      >暂无联系人</li>
    </ul>

    <!-- team list -->
    <ul v-else class="space-y-1.5 text-xs">
      <li
        v-for="m in members"
        :key="m.id"
        class="flex items-center gap-2 rounded border border-border bg-white/30 px-2 py-1.5"
      >
        <span class="text-slate-900">{{ m.name }}</span>
        <span v-if="m.email" class="text-slate-500">· {{ m.email }}</span>
        <span v-if="m.phone" class="text-slate-500">· {{ m.phone }}</span>
        <div class="ml-auto flex gap-1">
          <button
            class="rounded border border-border px-1.5 py-0.5 text-slate-600 hover:bg-surface-alt"
            @click="openEditMember(m)"
          >编辑</button>
          <button
            class="rounded border border-red-900/50 px-1.5 py-0.5 text-red-300 hover:bg-red-900/30"
            @click="removeMember(m.id)"
          >删除</button>
        </div>
      </li>
      <li
        v-if="members.length === 0 && !loading"
        class="rounded border border-dashed border-border bg-white/30 p-3 text-center text-slate-500"
      >暂无团队成员</li>
    </ul>

    <!-- create/edit modal -->
    <div
      v-if="modal"
      class="fixed inset-0 z-40 flex items-center justify-center bg-canvas/70 p-4"
      @click.self="closeModal"
    >
      <div class="flex w-full max-w-md flex-col gap-3 rounded border border-border bg-white p-4">
        <h3 class="text-sm font-medium text-slate-800">{{ modalTitle }}</h3>
        <label class="text-xs text-slate-600">
          姓名 *
          <input
            v-model="modal.name"
            class="mt-1 w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-slate-800"
            placeholder="姓名"
          />
        </label>
        <label v-if="tab === 'contacts'" class="text-xs text-slate-600">
          职位
          <input
            v-model="modal.title"
            class="mt-1 w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-slate-800"
            placeholder="CTO / 业务负责人…"
          />
        </label>
        <label class="text-xs text-slate-600">
          邮箱
          <input
            v-model="modal.email"
            class="mt-1 w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-slate-800"
            placeholder="name@example.com"
          />
        </label>
        <label class="text-xs text-slate-600">
          电话
          <input
            v-model="modal.phone"
            class="mt-1 w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-slate-800"
            placeholder="13800000000"
          />
        </label>
        <label v-if="tab === 'contacts'" class="flex items-center gap-2 text-xs text-slate-600">
          <input v-model="modal.isPrimary" type="checkbox" />
          设为主联系人
        </label>
        <p v-if="modalError" class="text-xs text-red-300">{{ modalError }}</p>
        <div class="flex justify-end gap-2">
          <button
            class="rounded border border-border px-3 py-1 text-xs text-slate-700 hover:bg-surface-alt"
            @click="closeModal"
          >取消</button>
          <button
            class="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10"
            :disabled="modalSaving"
            @click="submitModal"
          >{{ modalSaving ? "保存中…" : "保存" }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { contactsApi } from "../api/contacts.api.ts";
import { teamMembersApi } from "../api/team-members.api.ts";
import type { ProjectContactDTO, TeamMemberDTO } from "@shared/types/dto/project.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{
  projectId: string;
  /** 父组件传入的 contacts 列表（来自 project GET，避免重复拉取） */
  initialContacts?: readonly ProjectContactDTO[];
  initialMembers?: readonly TeamMemberDTO[];
}>();

const emit = defineEmits<{
  (e: "updated"): void;
}>();

const tab = ref<"contacts" | "team">("contacts");
const contacts = ref<ProjectContactDTO[]>([]);
const members = ref<TeamMemberDTO[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

interface ModalState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

const modal = ref<ModalState | null>(null);
const modalError = ref<string | null>(null);
const modalSaving = ref(false);

const modalTitle = computed(() => {
  if (!modal.value) return "";
  const target = tab.value === "contacts" ? "联系人" : "团队成员";
  return modal.value.mode === "create" ? `新增${target}` : `编辑${target}`;
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [c, m] = await Promise.all([
      contactsApi.list(props.projectId),
      teamMembersApi.list(props.projectId),
    ]);
    contacts.value = c.items;
    members.value = m.items;
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

function setTab(t: "contacts" | "team"): void {
  tab.value = t;
}

function openCreate(): void {
  modal.value = {
    mode: "create",
    name: "",
    title: "",
    email: "",
    phone: "",
    isPrimary: false,
  };
  modalError.value = null;
}

function openEditContact(c: ProjectContactDTO): void {
  tab.value = "contacts";
  modal.value = {
    mode: "edit",
    id: c.id,
    name: c.name,
    title: c.title ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    isPrimary: c.isPrimary,
  };
  modalError.value = null;
}

function openEditMember(m: TeamMemberDTO): void {
  tab.value = "team";
  modal.value = {
    mode: "edit",
    id: m.id,
    name: m.name,
    title: "",
    email: m.email ?? "",
    phone: m.phone ?? "",
    isPrimary: false,
  };
  modalError.value = null;
}

function closeModal(): void {
  modal.value = null;
  modalError.value = null;
}

async function submitModal(): Promise<void> {
  if (!modal.value) return;
  const m = modal.value;
  if (m.name.trim().length === 0) {
    modalError.value = "姓名为必填";
    return;
  }
  modalSaving.value = true;
  modalError.value = null;
  try {
    if (tab.value === "contacts") {
      const payload: {
        name: string; title?: string; email?: string; phone?: string; isPrimary?: boolean;
      } = {
        name: m.name.trim(),
        ...(m.title ? { title: m.title } : {}),
        ...(m.email ? { email: m.email } : {}),
        ...(m.phone ? { phone: m.phone } : {}),
        isPrimary: m.isPrimary,
      };
      if (m.mode === "create") {
        await contactsApi.create(props.projectId, payload);
      } else if (m.id) {
        await contactsApi.update(props.projectId, m.id, payload);
      }
    } else {
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

async function setPrimary(id: string): Promise<void> {
  try {
    await contactsApi.update(props.projectId, id, { isPrimary: true });
    await load();
    emit("updated");
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function removeContact(id: string): Promise<void> {
  if (!confirm("确认删除该联系人？")) return;
  try {
    await contactsApi.delete(props.projectId, id);
    await load();
    emit("updated");
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function removeMember(id: string): Promise<void> {
  if (!confirm("确认删除该团队成员？")) return;
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
  // 优先用父组件传入的 initial*；省一次拉取
  if (props.initialContacts && props.initialContacts.length > 0) {
    contacts.value = [...props.initialContacts];
  }
  if (props.initialMembers && props.initialMembers.length > 0) {
    members.value = [...props.initialMembers];
  }
  void load();
});
</script>