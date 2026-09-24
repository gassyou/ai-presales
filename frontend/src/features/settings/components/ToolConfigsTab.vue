<!--
  ToolConfigsTab.vue —— 阶段 7.4h

  5 个内置工具的运行时配置（key/value 表单）。
  配置 schema 由各 tool 的 configure() 字段决定 —— 这里暴露已知 knobs：
    - list_files: defaultMax, defaultRecursive
    - read_file: defaultMaxBytes, hardMaxBytes
    - search_knowledge: defaultTopK
    - current_datetime: （无 knob；保留空表单）
    - read_module: defaultMaxTokens
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">AI 工具配置</h2>
      <el-button
        type="primary"
        :disabled="!dirty || saving"
        :loading="saving"
        @click="onSave"
      >
        {{ saving ? "保存中…" : "保存" }}
      </el-button>
    </header>

    <el-alert v-if="store.error" :title="store.error" type="error" :closable="false" show-icon />
    <el-alert v-if="validationError" :title="validationError" type="warning" :closable="false" show-icon />
    <el-alert v-if="conflictMsg" :title="conflictMsg" type="warning" :closable="false" show-icon />

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="flex flex-col gap-3">
      <div
        v-for="t in TOOL_SCHEMAS"
        :key="t.name"
        class="rounded border border-border p-3"
      >
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-baseline gap-2">
            <h3 class="text-sm font-medium text-slate-800">{{ t.label }}</h3>
            <code class="text-xs text-slate-500">{{ t.name }}</code>
          </div>
        </div>
        <p class="mb-2 text-xs text-slate-500">{{ t.description }}</p>

        <div v-if="t.fields.length === 0" class="text-xs text-slate-500">
          无可配置项
        </div>
        <div v-else class="flex flex-col gap-2">
          <div
            v-for="f in t.fields"
            :key="f.key"
            class="flex flex-col gap-1 text-xs text-slate-600"
          >
            <div class="flex items-baseline justify-between">
              <span>{{ f.label }}</span>
              <code class="text-slate-600">{{ f.key }}</code>
            </div>
            <el-input-number
              v-if="f.type === 'number'"
              :model-value="form[t.name][f.key] as number"
              :min="f.min"
              :max="f.max"
              :step="f.step ?? 1"
              size="small"
              controls-position="right"
              @update:model-value="(v) => (form![t.name][f.key] = v as number)"
            />
            <el-switch
              v-else-if="f.type === 'boolean'"
              :model-value="form[t.name][f.key] as boolean"
              @update:model-value="(v) => (form![t.name][f.key] = v as boolean)"
            />
            <el-input
              v-else
              :model-value="form[t.name][f.key] as string"
              size="small"
              @update:model-value="(v) => (form![t.name][f.key] = v as string)"
            />
            <span class="text-slate-600">{{ f.hint }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.store.ts";

const store = useSettingsStore();

interface FieldSpec {
  key: string;
  label: string;
  type: "number" | "boolean" | "string";
  min?: number;
  max?: number;
  step?: number;
  hint: string;
}

interface ToolSchema {
  name: string;
  label: string;
  description: string;
  fields: FieldSpec[];
}

const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "list_files",
    label: "List Files",
    description: "列出目录下的文件",
    fields: [
      { key: "defaultMax", label: "默认最大条目数", type: "number", min: 1, max: 1000, hint: "不传 max 参数时的兜底值" },
      { key: "defaultRecursive", label: "默认递归", type: "boolean", hint: "不传 recursive 时的兜底值" },
    ],
  },
  {
    name: "read_file",
    label: "Read File",
    description: "读取文件内容",
    fields: [
      { key: "defaultMaxBytes", label: "默认最大字节", type: "number", min: 1, step: 1024, hint: "不传 maxBytes 时的兜底值" },
      { key: "hardMaxBytes", label: "硬上限（拒绝超过）", type: "number", min: 1, step: 1024, hint: "超出即报错" },
    ],
  },
  {
    name: "search_knowledge",
    label: "Search Knowledge",
    description: "知识库语义检索",
    fields: [
      { key: "defaultTopK", label: "默认 TopK", type: "number", min: 1, max: 50, hint: "不传 topK 时的兜底值" },
    ],
  },
  {
    name: "current_datetime",
    label: "Current Datetime",
    description: "返回当前日期时间",
    fields: [
      { key: "defaultTimezone", label: "默认时区", type: "string", hint: "IANA 时区名（可省）" },
    ],
  },
  {
    name: "read_module",
    label: "Read Module",
    description: "读取项目业务模块",
    fields: [
      { key: "defaultMaxTokens", label: "默认最大 token", type: "number", min: 1, step: 100, hint: "不传 maxTokens 时的兜底值" },
    ],
  },
];

type FormShape = Record<string, Record<string, unknown>>;

const form = ref<FormShape | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictMsg = ref<string | null>(null);

function syncFromStore(): void {
  // 即便后端从未写入过该 setting（snap = null），也渲染空表单，
  // 让用户能直接添加第一个配置；不卡在"加载中…"
  const snap = store.toolConfigs;
  const next: FormShape = {};
  for (const t of TOOL_SCHEMAS) {
    const existing = (snap?.configs[t.name] ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const f of t.fields) {
      const v = existing[f.key];
      merged[f.key] = v ?? (f.type === "boolean" ? false : f.type === "number" ? 0 : "");
    }
    next[t.name] = merged;
  }
  form.value = next;
  dirty.value = false;
  conflictMsg.value = null;
}

watch(() => store.toolConfigs, syncFromStore, { immediate: true });

const validationError = computed<string | null>(() => {
  if (!form.value) return null;
  for (const t of TOOL_SCHEMAS) {
    for (const f of t.fields) {
      const v = form.value[t.name][f.key];
      if (f.type === "number") {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) return `${t.name}.${f.key} 必须是数字`;
        if (f.min !== undefined && n < f.min) return `${t.name}.${f.key} < ${f.min}`;
        if (f.max !== undefined && n > f.max) return `${t.name}.${f.key} > ${f.max}`;
      }
    }
  }
  return null;
});

async function onSave(): Promise<void> {
  if (!form.value) return;
  if (validationError.value) {
    conflictMsg.value = validationError.value;
    return;
  }
  saving.value = true;
  conflictMsg.value = null;
  // 移除空字符串（让后端走默认值）
  const configs: Record<string, Record<string, unknown>> = {};
  for (const t of TOOL_SCHEMAS) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form.value[t.name])) {
      if (v === "" || v === undefined || v === null) continue;
      out[k] = v;
    }
    configs[t.name] = out;
  }
  const r = await store.saveToolConfigs({ configs });
  saving.value = false;
  if (r.ok) {
    dirty.value = false;
  } else if (r.conflict) {
    conflictMsg.value = "数据已被其他会话修改，请刷新后重试";
    await store.loadToolConfigs();
  }
}

watch(form, () => {
  dirty.value = true;
}, { deep: true });
</script>