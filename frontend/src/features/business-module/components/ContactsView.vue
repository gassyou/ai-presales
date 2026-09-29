<!--
  ContactsView.vue
  ================
  客户联系人视图（阶段 7.4e 重构）。
  单页（无 tab 切换）；表格列出所有属性。
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        客户联系人（{{ contacts.length }}）
      </h2>
      <el-button size="small" @click="openCreate">+ 新增联系人</el-button>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <div v-if="contacts.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无联系人。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">姓名</th>
            <th class="w-24 py-2">职位</th>
            <th class="w-44 py-2">邮箱</th>
            <th class="w-28 py-2">电话</th>
            <!-- 阶段 B4：移除「主联系人」列（用户要求；保留 isPrimary 字段供后台逻辑，不显示） -->
            <th class="w-32 py-2 text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in contacts"
            :key="c.id"
            class="border-b border-border/60 hover:bg-surface-alt/40"
          >
            <td class="py-2 pl-2 font-medium text-slate-900">{{ c.name }}</td>
            <td class="py-2 text-slate-600">{{ c.title || "—" }}</td>
            <td class="py-2 text-slate-600">
              <a v-if="c.email" :href="`mailto:${c.email}`" class="text-accent hover:underline">{{ c.email }}</a>
              <span v-else>—</span>
            </td>
            <td class="py-2 text-slate-600">{{ c.phone || "—" }}</td>
            <td class="py-2 text-right pr-2">
              <!-- 阶段 B4：移除「设为主联系人」按钮（用户要求：列+按钮一起删） -->
              <el-button link type="primary" size="small" @click="openEdit(c)">编辑</el-button>
              <el-button link type="danger" size="small" @click="remove(c.id)">删除</el-button>
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
            职位
            <el-input v-model="modal.title" placeholder="CTO / 业务负责人…" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            邮箱
            <el-input v-model="modal.email" placeholder="name@example.com" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-600">
            电话
            <el-input v-model="modal.phone" placeholder="13800000000" />
          </label>
          <!-- 阶段 B4：移除「设为主联系人」checkbox（用户要求：列+按钮+新增窗口 checkbox 一起删） -->
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
import { contactsApi } from "@frontend/features/project/api/contacts.api.ts";
import type { ProjectContactDTO } from "@shared/types/dto/project.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{
  projectId: string;
  initialContacts?: readonly ProjectContactDTO[];
}>();

const emit = defineEmits<{ (e: "updated"): void }>();

const contacts = ref<ProjectContactDTO[]>([]);
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

const modalTitle = computed(() =>
  !modal.value ? "" : (modal.value.mode === "create" ? "新增联系人" : "编辑联系人"),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const r = await contactsApi.list(props.projectId);
    contacts.value = r.items;
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  modal.value = { mode: "create", name: "", title: "", email: "", phone: "", isPrimary: false };
  modalError.value = null;
}

function openEdit(c: ProjectContactDTO): void {
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
    const payload: { name: string; title?: string; email?: string; phone?: string; isPrimary?: boolean } = {
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

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error ? e.message : String(e);
}

watch(() => props.projectId, () => {
  void load();
});

onMounted(() => {
  if (props.initialContacts && props.initialContacts.length > 0) {
    contacts.value = [...props.initialContacts];
  }
  void load();
});
</script>