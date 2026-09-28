/**
 * Mindmap 数据适配器 —— 阶段 7.4i + 功能清单脑图编辑
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

/**
 * 编辑后的 Vue3MindmapNode 树 → 一组 item 级 patch 操作
 *
 * 算法：
 *   - 同 byLeafId 路径上的 L3 节点：
 *     · 文本变了 → patch.name
 *     · 路径（L1/L2 名字）变了 → patch.category / patch.module
 *   - 新出现的 L3 节点 → create（category=父L1, module=父L2, name=L3新名）
 *   - 消失的 L3 节点 → delete（按原 dto.id 删）
 *   - L1/L2 节点文本变化 → 等同其下所有 items 的 category/module 改了
 *   - 父层（L1/L2）被整体删除 → 该层下所有 items 全部删
 *
 * 返回 3 个数组：creates / updates / deletes（都为同一 FunctionListDTO 结构）
 */
export interface FunctionDiffResult {
  creates: Array<{ title: string; category: string; module: string; cp?: number; inScope?: boolean }>;
  updates: Array<{ id: string; patch: Partial<Pick<FunctionListDTO, "name" | "category" | "module" | "inScope" | "cp">> }>;
  deletes: string[];
}

export function diffFunctionTree(
  oldItems: readonly FunctionListDTO[],
  newTree: Vue3MindmapNode[],
): FunctionDiffResult {
  const result: FunctionDiffResult = { creates: [], updates: [], deletes: [] };

  // 1. 拍平新树，建立 leafKey → { newCategory, newModule, newName } 的映射
  const newLeaves = new Map<string, { category: string; module: string; name: string; inScope: boolean }>();
  walkNewTree(newTree, (path) => {
    const key = path.cat + "|" + path.mod + "|" + path.fn;
    newLeaves.set(key, {
      category: path.cat,
      module: path.mod,
      name: path.fn,
      inScope: path.inScope,
    });
  });

  // 3. 建立 old leafKey → dto 映射（from old items byLeafId）
  const oldByLeafKey = new Map<string, FunctionListDTO>();
  for (const it of oldItems) {
    const key = `${it.category}|${it.module}|${it.id}`;
    oldByLeafKey.set(key, it);
  }

  // 4. 遍历新 leaves：找到匹配的 old → emit update；未找到 → emit create
  const consumedOldIds = new Set<string>();
  for (const [key, fresh] of newLeaves) {
    const old = oldByLeafKey.get(key);
    if (old) {
      consumedOldIds.add(old.id);
      // 检查实际字段差异（不要无意义 update）
      const patch: Partial<Pick<FunctionListDTO, "name" | "category" | "module" | "inScope" | "cp">> = {};
      if (old.name !== fresh.name) patch.name = fresh.name;
      if (old.category !== fresh.category) patch.category = fresh.category;
      if (old.module !== fresh.module) patch.module = fresh.module;
      // inScope / cp 不在脑图上展示，跳过
      if (Object.keys(patch).length > 0) {
        result.updates.push({ id: old.id, patch });
      }
    } else {
      result.creates.push({
        title: fresh.name,
        category: fresh.category,
        module: fresh.module,
        inScope: fresh.inScope,
      });
    }
  }

  // 5. 遍历 old items：未在新 leaves 中出现的 → delete
  for (const it of oldItems) {
    if (!consumedOldIds.has(it.id)) {
      result.deletes.push(it.id);
    }
  }

  return result;
}

function walkNewTree(
  nodes: Vue3MindmapNode[],
  cb: (p: { cat: string; mod: string; fn: string; inScope: boolean }) => void,
  ctx?: { cat?: string; mod?: string },
): void {
  // 根节点：name === "功能清单" → 跳过
  for (const node of nodes) {
    if (!ctx) {
      // 根节点
      if (node.children) walkNewTree(node.children, cb, {});
      continue;
    }
    if (ctx.cat === undefined) {
      // L1 = category
      if (node.children) {
        for (const c2 of node.children) {
          if (c2.children) walkNewTree(c2.children, cb, { cat: node.name, mod: c2.name });
        }
      }
      continue;
    }
    if (ctx.mod === undefined) {
      // 不会走到这里（我们用两层调用）
      continue;
    }
    // L3 = function leaf
    const inScope = !node.name.endsWith("（外）");
    const fnName = inScope ? node.name : node.name.replace(/（外）$/, "");
    cb({ cat: ctx.cat!, mod: ctx.mod!, fn: fnName, inScope });
  }
}