<!--
  ProjectEditDialog.vue
  =====================
  编辑项目元信息对话框（Element Plus 版）。

  字段：
    - name           项目名称（必填）
    - clientName     客户名称（必填）
    - clientWebsite  客户网站
    - clientIntro    客户简介
    - projectIntro   项目简介
    - startDate      开始时间
    - endDate        结束时间

  日期字段用 el-date-picker value-format="YYYY-MM-DDTHH:mm:ss"，
  与后端 IsoDateTime 类型一致。

  提交流程：
    - 前端做必填 + 日期顺序校验，失败时直接在 dialog 内展示错误
      并阻止 emit submit。
    - 通过校验后 emit submit(UpdateProjectInput)；父组件负责调 API。
    - 父组件在调用过程中通过 props.submitting 控制按钮 loading。
    - 父组件产生的网络错误经 props.error 传回展示。
-->
<template>
  <el-dialog
    :model-value="true"
    title="编辑项目信息"
    width="560"
    :close-on-click-modal="!isSubmitting"
    :show-close="!isSubmitting"
    @update:model-value="(v) => !v && emit('close')"
  >
    <el-form :model="form" label-position="top" @submit.prevent>
      <el-form-item label="项目名称" required>
        <el-input
          v-model="form.name"
          placeholder="ERP 升级提案"
          maxlength="120"
          show-word-limit
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="客户名称" required>
        <el-input
          v-model="form.clientName"
          placeholder="ACME 集团"
          maxlength="120"
          show-word-limit
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="客户网站">
        <el-input
          v-model="form.clientWebsite"
          placeholder="https://www.example.com"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="起止日期">
        <div class="flex w-full items-center gap-2">
          <el-date-picker
            v-model="form.startDate"
            type="date"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="开始日期"
            class="!flex-1"
            :disabled="isSubmitting"
          />
          <span class="text-slate-400">~</span>
          <el-date-picker
            v-model="form.endDate"
            type="date"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="结束日期"
            class="!flex-1"
            :disabled="isSubmitting"
          />
        </div>
      </el-form-item>

      <el-form-item label="客户简介">
        <el-input
          v-model="form.clientIntro"
          type="textarea"
          :rows="3"
          :maxlength="2000"
          show-word-limit
          placeholder="客户背景、规模、行业等信息"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-form-item label="项目简介">
        <el-input
          v-model="form.projectIntro"
          type="textarea"
          :rows="3"
          :maxlength="2000"
          show-word-limit
          placeholder="项目目标、范围、关键节点"
          :disabled="isSubmitting"
        />
      </el-form-item>

      <el-alert
        v-if="displayError"
        :title="displayError"
        type="error"
        :closable="false"
        show-icon
      />
    </el-form>
    <template #footer>
      <el-button :disabled="isSubmitting" @click="emit('close')">取消</el-button>
      <el-button
        type="primary"
        :loading="isSubmitting"
        :disabled="!form.name.trim() || !form.clientName.trim()"
        @click="onSubmit"
      >
        {{ isSubmitting ? "保存中…" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { ProjectDTO, UpdateProjectInput } from "@shared/types/dto/project.ts";

const props = defineProps<{
  project: ProjectDTO;
  submitting?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", input: UpdateProjectInput): void;
}>();

interface FormState {
  name: string;
  clientName: string;
  clientWebsite: string;
  startDate: string;
  endDate: string;
  clientIntro: string;
  projectIntro: string;
}

function buildForm(p: ProjectDTO): FormState {
  return {
    name: p.name ?? "",
    clientName: p.clientName ?? "",
    clientWebsite: p.clientWebsite ?? "",
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    clientIntro: p.clientIntro ?? "",
    projectIntro: p.projectIntro ?? "",
  };
}

const form = reactive<FormState>(buildForm(props.project));
const localError = ref<string | null>(null);
const isSubmitting = computed(() => props.submitting ?? false);
const displayError = computed(() => props.error ?? localError.value);

// project prop 变化时重新同步表单（如父组件换了项目）
watch(
  () => props.project,
  (p) => {
    Object.assign(form, buildForm(p));
    localError.value = null;
  },
);

/** 点击保存 —— 前端校验失败时本地展示并阻止 emit；成功则 emit submit。 */
function onSubmit(): void {
  if (isSubmitting.value) return;
  localError.value = null;
  const name = form.name.trim();
  const clientName = form.clientName.trim();
  if (!name) {
    localError.value = "请输入项目名称";
    return;
  }
  if (!clientName) {
    localError.value = "请输入客户名称";
    return;
  }
  if (form.startDate && form.endDate) {
    const s = new Date(form.startDate).getTime();
    const e = new Date(form.endDate).getTime();
    if (!isNaN(s) && !isNaN(e) && e < s) {
      localError.value = "结束日期不能早于开始日期";
      return;
    }
  }

  const input: UpdateProjectInput = {
    name,
    clientName,
    clientWebsite: form.clientWebsite.trim() ? form.clientWebsite.trim() : null,
    clientIntro: form.clientIntro.trim() ? form.clientIntro.trim() : null,
    projectIntro: form.projectIntro.trim() ? form.projectIntro.trim() : null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
  };

  emit("submit", input);
}
</script>