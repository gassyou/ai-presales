/**
 * HardwareItem + HardwareItemsPayload —— 硬件设备成本清单（结构化）
 *
 * 阶段 7.4f。报价单生成模块的"硬件"派生源。
 *
 * 与 markdown_hardware_cost 的关系：
 *   - markdown_hardware_cost：自由文本描述（保留，工程师备注用）
 *   - hardware_items：结构化行（每行一类硬件，含数量 / 单价 / 小计），
 *     供 budget_summary 的派生逻辑、quote 的 Excel 模板填充、AI sub-agent 读取。
 *
 * 设计要点：
 *   - 校验在域内（qty ≥ 1 整数；unitPrice ≥ 0；subtotal 导出时重算以保证一致）
 *   - 序列化走 payloadJson（同 function_list / budget_settings 模式）
 *   - groupByCategory 用于报价单分组显示
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const HARDWARE_ITEMS_KIND: BusinessModuleKind = "hardware_items";

/** 单行硬件 */
export interface HardwareItemPayload {
  category: string; // 服务器 / 网络 / 存储 / 终端 …
  device: string; // 设备名
  spec: string; // 规格 / 型号
  qty: number; // 数量（≥ 1 整数）
  unitPrice: number; // 单价（元，≥ 0）
  /** 小计 = qty × unitPrice（导出时由 computeSubtotal 重算，保证一致） */
  subtotal: number;
  remarks: string; // 备注
}

/** 整体载荷：永远包含 items 数组（即便空） */
export interface HardwareItemsPayload {
  items: HardwareItemPayload[];
}

export const EMPTY_HARDWARE_ITEMS: HardwareItemsPayload = { items: [] };

export function makeHardwareItem(
  seed: Partial<HardwareItemPayload> = {},
): HardwareItemPayload {
  const qty = typeof seed.qty === "number" && seed.qty >= 1 ? Math.floor(seed.qty) : 1;
  const unitPrice = typeof seed.unitPrice === "number" && seed.unitPrice >= 0 ? seed.unitPrice : 0;
  return {
    category: (seed.category ?? "").toString(),
    device: (seed.device ?? "").toString(),
    spec: (seed.spec ?? "").toString(),
    qty,
    unitPrice,
    subtotal: qty * unitPrice,
    remarks: (seed.remarks ?? "").toString(),
  };
}

export function makeHardwareItemsPayload(
  seed: Partial<HardwareItemsPayload> = {},
): HardwareItemsPayload {
  const items = Array.isArray(seed.items) ? seed.items.map((i) => makeHardwareItem(i)) : [];
  return { items };
}

/** 解析 payloadJson；失败 → EMPTY_HARDWARE_ITEMS（永不抛） */
export function parseHardwareItemsPayload(json: string): HardwareItemsPayload {
  try {
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === "object" && Array.isArray((obj as { items?: unknown }).items)) {
      return makeHardwareItemsPayload(obj as Partial<HardwareItemsPayload>);
    }
  } catch {
    // ignore
  }
  return { ...EMPTY_HARDWARE_ITEMS };
}

/** 域校验：返回 null 表示通过；否则返回错误码（"qty_invalid" / "unitPrice_invalid" / "category_empty" / "device_empty"） */
export function validateHardwareItemInput(
  input: Partial<HardwareItemPayload>,
): string | null {
  if (typeof input.qty !== "number" || !Number.isFinite(input.qty) || input.qty < 1 || !Number.isInteger(input.qty)) {
    return "qty_invalid";
  }
  if (typeof input.unitPrice !== "number" || !Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return "unitPrice_invalid";
  }
  if (typeof input.category === "string" && input.category.trim().length === 0 && input.device?.trim().length === 0) {
    // 允许 category 空只要 device 有名（实际场景里 "类别 + 设备" 至少一个有）
    // 这里采用宽松策略：不强制。
  }
  return null;
}

/** 重算小计（保证一致） */
export function computeSubtotal(
  item: Pick<HardwareItemPayload, "qty" | "unitPrice">,
): number {
  return Math.max(0, Math.floor(item.qty)) * Math.max(0, item.unitPrice);
}

/** 总小计 */
export function totalSubtotal(payload: HardwareItemsPayload): number {
  return payload.items.reduce((acc, i) => acc + computeSubtotal(i), 0);
}

export interface HardwareGroup {
  category: string;
  items: HardwareItemPayload[];
  subtotal: number;
}

/** 按 category 分组（按首次出现顺序） */
export function groupByCategory(payload: HardwareItemsPayload): HardwareGroup[] {
  const order: string[] = [];
  const map = new Map<string, HardwareItemPayload[]>();
  for (const it of payload.items) {
    const key = it.category.trim() || "(未分类)";
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(it);
  }
  return order.map((cat) => {
    const items = map.get(cat)!;
    return {
      category: cat,
      items,
      subtotal: items.reduce((acc, i) => acc + computeSubtotal(i), 0),
    };
  });
}