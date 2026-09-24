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
        <el-radio-group v-model="tab" size="small">
          <el-radio-button value="contacts">联系人（{{ contacts.length }}）</el-radio-button>
          <el-radio-button value="team">团队成员（{{ members.length }}）</el-radio-button>
        </el-radio-group>
      </div>
      <el-button size="small" @click="openCreate">+ 新增{{ tab === "contacts" ? "联系人" : "团队成员" }}</el-button>
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
          <el-button
            v-if="!c.isPrimary"
            size="small"
            @click="setPrimary(c.id)"
          >设为主联系人</el-button>
          <el-button size="small" @click="openEditContact(c)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="removeContact(c.id)">删除</el-button>
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
          <el-button size="small" @click="openEditMember(m)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="removeMember(m.id)">删除</el-button>
        </div>
      </li>
      <li
        v-if="members.length === 0 && !loading"
        class="rounded border border-dashed border-border bg-white/30 p-3 text-center text-slate-500"
      >暂无团队成员</li>
    </ul>

    <!-- create/edit modal -->
    <el-dialog
      :model-value="modal !== null"
      :title="modalTitle"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v) => !v && closeModal()"
    >
      <template v-if="modal">
        <div class="flex w-full flex-col gap-3">
          <label class="text-xs text-slate-600">
            姓名 *
            <el-input v-model="modal.name" placeholder="姓名" class="mt-1" />
          </label>
          <label v-if="tab === 'contacts'" class="text-xs text-slate-600">
            职位
            <el-input v-model="modal.title" placeholder="CTO / 业务负责人…" class="mt-1" />
          </label>
          <label class="text-xs text-slate-600">
            邮箱
            <el-input v-model="modal.email" placeholder="name@example.com" class="mt-1" />
          </label>
          <label class="text-xs text-slate-600">
            电话
            <el-input v-model="modal.phone" placeholder="13800000000" class="mt-1" />
          </label>
          <label v-if="tab === 'contacts'" class="flex items-center gap-2 text-xs text-slate-600">
            <el-checkbox v-model="modal.isPrimary">设为主联系人</el-checkbox>
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
  try {
    await ElMessageBox.confirm("确认删除该联系人？", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await contactsApi.delete(props.projectId, id);
    await load();
    emit("updated");
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function removeMember(id: string): Promise<void> {
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