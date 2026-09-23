/**
 * Mindmap 数据适配器 —— 阶段 7.4i
 *
 * 用途：把后端的 MindmapNode / FunctionListDTO 树转为 vue3-mindmap 的 Data[] 形状，
 *       以及反向转换回来。
 *
 * vue3-mindmap 的节点形状：{ name, children?, collapse?, left? }
 * 我们的后端形状（MindmapNode）：{ id, text, children }
 *
 * id 在适配过程中保留：每次 mindmapToV3 时为每个节点生成稳定的 UUID 作为 v3 节点
 * 的隐式 key（vue3-mindmap 内部用 name 作为 key，name 重复时用 :nth-of-type 区分）。
 * 这里我们用「id → 原数据」映射维护反向查找。
 */
import type { MindmapNode } from "../api/survey-questionnaire.api.ts";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";

export interface Vue3MindmapNode {
  name: string;
  children?: Vue3MindmapNode[];
  collapse?: boolean;
  left?: boolean;
}

/**
 * MindmapNode[] → Vue3MindmapNode[]
 * - 丢失：id（不可序列化进 v3 节点；保存时由 v3ToMindmap 重新生成）
 * - 保留：text → name
 */
export function mindmapToV3(nodes: MindmapNode[]): Vue3MindmapNode[] {
  return nodes.map((n) => {
    const out: Vue3MindmapNode = { name: n.text };
    if (n.children.length > 0) out.children = mindmapToV3(n.children);
    return out;
  });
}

/**
 * Vue3MindmapNode[] → MindmapNode[]
 * - 每个节点生成新 UUID
 */
export function v3ToMindmap(nodes: Vue3MindmapNode[]): MindmapNode[] {
  return nodes.map((n) => ({
    id: crypto.randomUUID(),
    text: n.name,
    children: n.children ? v3ToMindmap(n.children) : [],
  }));
}

/**
 * FunctionListDTO[] → 3 层 Vue3MindmapNode 树
 * - 根：固定 "功能清单"
 * - L1：category（按字母顺序）
 * - L2：module（按字母顺序）
 * - L3：functionName
 *
 * 返回 byLeafId 用于从 leaf name 反查原 DTO（key 用 `${category}|${module}|${functionId}`）。
 */
export interface FunctionV3Result {
  tree: Vue3MindmapNode[];
  byLeafId: Map<string, FunctionListDTO>;
}

export function functionsToV3(items: readonly FunctionListDTO[]): FunctionV3Result {
  // 按 category → module → items 嵌套
  const byCat = new Map<string, Map<string, FunctionListDTO[]>>();
  for (const it of items) {
    let modMap = byCat.get(it.category);
    if (!modMap) {
      modMap = new Map();
      byCat.set(it.category, modMap);
    }
    let arr = modMap.get(it.module);
    if (!arr) {
      arr = [];
      modMap.set(it.module, arr);
    }
    arr.push(it);
  }

  const byLeafId = new Map<string, FunctionListDTO>();
  const categories = [...byCat.keys()].sort();
  const tree: Vue3MindmapNode[] = [
    {
      name: "功能清单",
      children: categories.map((cat) => {
        const modMap = byCat.get(cat)!;
        const modules = [...modMap.keys()].sort();
        return {
          name: cat || "(未分类)",
          children: modules.map((mod) => {
            const fns = modMap.get(mod)!;
            return {
              name: mod || "(未分模块)",
              children: fns.map((fn) => {
                const leafId = `${cat}|${mod}|${fn.id}`;
                byLeafId.set(leafId, fn);
                return { name: `${fn.name}${fn.inScope ? "" : "（外）"}` };
              }),
            };
          }),
        };
      }),
    },
  ];

  return { tree, byLeafId };
}
