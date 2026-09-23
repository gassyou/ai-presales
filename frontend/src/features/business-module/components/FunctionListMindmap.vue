<!--
  FunctionListMindmap.vue
  ========================
  功能清单脑图视图（阶段 7.4i —— 改用 vue3-mindmap）。
  - 左侧脑图：按 category → module → function 三级嵌套
  - 右侧详情：点击脑图叶子后高亮 + 详情卡片（CP/范围内/工时/金额）
  - 只读视图（不直接编辑脑图结构，CP/在范围内仍可在详情卡片里调）
-->
<template>
  <div class="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <!-- 左侧：脑图 -->
    <div class="h-[60vh] overflow-hidden rounded border border-border bg-white/30">
      <mindmap
        v-model="tree"
        :zoom="true"
        :center-btn="true"
        :fit-btn="true"
        locale="zh"
        @click-item="onClickItem"
      />
    </div>

    <!-- 右侧：详情 -->
    <div class="overflow-auto rounded border border-border bg-white/40 p-3 text-xs">
      <template v-if="!selectedDto">
        <p class="text-slate-500">点击脑图中的功能节点查看详情。</p>
        <ul v-if="props.items.length > 0" class="mt-3 space-y-1">
          <li
            v-for="it in props.items.slice(0, 12)"
            :key="it.id"
            class="cursor-pointer rounded px-2 py-1 hover:bg-surface-alt/50"
            @click="selectByDtoId(it.id)"
          >
            <span class="text-slate-700">{{ it.name }}</span>
            <span class="ml-1 text-slate-500">{{ it.category }} / {{ it.module }}</span>
          </li>
          <li v-if="props.items.length > 12" class="text-[10px] text-slate-500">
            ……共 {{ props.items.length }} 项
          </li>
        </ul>
      </template>
      <template v-else>
        <div class="flex flex-col gap-2">
          <div class="border-b border-border pb-2">
            <div class="text-[11px] uppercase tracking-wide text-slate-500">
              {{ selectedDto.category }} / {{ selectedDto.module }}
            </div>
            <div class="mt-0.5 font-medium text-slate-900">{{ selectedDto.name }}</div>
            <div v-if="selectedDto.detail" class="mt-1 text-slate-600">
              {{ selectedDto.detail }}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-slate-600">CP</span>
              <select
                :value="selectedDto.cp"
                class="rounded border border-border bg-white px-2 py-1 text-slate-800"
                @change="onCpChange"
              >
                <option :value="0">—</option>
                <option v-for="cp in CP_VALUES" :key="cp" :value="cp">{{ cp }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-slate-600">项目范围内</span>
              <label class="mt-1 inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedDto.inScope"
                  @change="emit('toggleScope', selectedDto)"
                />
                <span :class="selectedDto.inScope ? 'text-emerald-400' : 'text-slate-500'">
                  {{ selectedDto.inScope ? "是" : "否" }}
                </span>
              </label>
            </label>
          </div>

          <div class="grid grid-cols-2 gap-2 border-t border-border pt-2 text-slate-700">
            <div>
              <div class="text-[10px] uppercase tracking-wide text-slate-500">工时</div>
              <div class="font-medium">{{ selectedDto.effortHours.toFixed(1) }} h</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-slate-500">金额</div>
              <div class="font-medium">
                ¥{{ Math.round(selectedDto.amount).toLocaleString() }}
              </div>
            </div>
          </div>

          <div v-if="selectedDto.remarks" class="border-t border-border pt-2 text-slate-600">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">备注</div>
            <div class="mt-1 whitespace-pre-wrap">{{ selectedDto.remarks }}</div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Mindmap from "vue3-mindmap";
import "vue3-mindmap/dist/style.css";
import {
  CP_VALUES,
  type FunctionListDTO,
} from "../api/structured-modules.api.ts";
import {
  functionsToV3,
  type Vue3MindmapNode,
} from "../composables/useMindmapAdapter.ts";

const props = defineProps<{ items: FunctionListDTO[] }>();
const emit = defineEmits<{
  (e: "toggleScope", it: FunctionListDTO): void;
  (e: "changeCp", it: FunctionListDTO, cp: number): void;
}>();

// 适配器：扁平 FunctionListDTO[] → 树 + 反查表
const adapterResult = computed(() => functionsToV3(props.items));
const tree = ref<Vue3MindmapNode[]>(adapterResult.value.tree);
const byLeafId = computed(() => adapterResult.value.byLeafId);

// props.items 变化时同步
watch(
  () => props.items,
  () => {
    tree.value = functionsToV3(props.items).tree;
    selectedLeafId.value = null;
  },
  { deep: true },
);

// 当前选中的叶子
const selectedLeafId = ref<string | null>(null);

const selectedDto = computed<FunctionListDTO | null>(() => {
  if (!selectedLeafId.value) return null;
  return byLeafId.value.get(selectedLeafId.value) ?? null;
});

/**
 * 在 v3 树里按「根 → 叶子」路径反查叶子节点的 leafId。
 * 返回 null 表示没找到（用户点的可能是中间节点）。
 */
function findLeafByPath(
  root: Vue3MindmapNode[],
  targetName: string,
  parents: string[] = [],
): string | null {
  for (const node of root) {
    const path = [...parents, node.name];
    if (!node.children || node.children.length === 0) {
      // leaf
      if (node.name === targetName && path.length === 4) {
        const [_root, cat, mod, fnName] = path;
        return `${cat}|${mod}|${fnName.replace(/（外）$/, "")}`;
      }
    } else {
      const found = findLeafByPath(node.children, targetName, path);
      if (found) return found;
    }
  }
  return null;
}

function onClickItem(node: Vue3MindmapNode): void {
  const leafId = findLeafByPath(tree.value, node.name);
  selectedLeafId.value = leafId;
}

function selectByDtoId(dtoId: string): void {
  const dto = props.items.find((it) => it.id === dtoId);
  if (!dto) return;
  selectedLeafId.value = `${dto.category}|${dto.module}|${dto.id}`;
}

function onCpChange(e: Event): void {
  if (!selectedDto.value) return;
  const cp = Number((e.target as HTMLSelectElement).value);
  emit("changeCp", selectedDto.value, cp);
}

defineExpose({
  selectLeaf(leafId: string | null): void {
    selectedLeafId.value = leafId;
  },
});
</script>