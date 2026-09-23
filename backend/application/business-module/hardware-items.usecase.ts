/**
 * HardwareItemsUseCase —— 硬件设备成本清单（结构化）用例编排
 *
 * 阶段 7.4f。
 *
 * 设计要点：
 *   - 复用 `BusinessModuleService` 通用 CRUD（与 function_list / budget_settings 同模式）
 *   - payloadJson 存 `{items: HardwareItemPayload[]}`；getPayload 解析为强类型对象
 *   - title = 自动拼接 category + device（与 function_list 的 title 策略一致）
 *   - 校验：qty ≥ 1 整数；unitPrice ≥ 0（域内 `validateHardwareItemInput`）
 *   - 出库时小计由 `computeSubtotal` 重算，保证一致
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { BusinessModuleService } from "./business-module.service.ts";
import {
  HARDWARE_ITEMS_KIND,
  type HardwareItemPayload,
  type HardwareItemsPayload,
  computeSubtotal,
  makeHardwareItem,
  makeHardwareItemsPayload,
  parseHardwareItemsPayload,
  validateHardwareItemInput,
} from "@backend/domain/business-module/hardware-items.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";

export interface HardwareItemsResult {
  id: string;
  projectId: ProjectId;
  title: string;
  item: HardwareItemPayload;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareItemsInput {
  category: string;
  device: string;
  spec?: string;
  qty: number;
  unitPrice: number;
  remarks?: string;
}

function toResult(snap: BusinessModuleItemSnapshot): HardwareItemsResult {
  const payload = parseHardwareItemsPayload(snap.payloadJson ?? "{}");
  // 单条记录只存 1 个 item；取最后一条
  const last = payload.items[payload.items.length - 1] ?? makeHardwareItem();
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    item: last,
    createdAt: typeof snap.createdAt === "string" ? snap.createdAt : new Date(snap.createdAt).toISOString(),
    updatedAt: typeof snap.updatedAt === "string" ? snap.updatedAt : new Date(snap.updatedAt).toISOString(),
  };
}

function makeTitle(input: HardwareItemsInput): string {
  const c = input.category?.trim() ?? "";
  const d = input.device?.trim() ?? "";
  return [c, d].filter(Boolean).join(" / ") || d || "(未命名)";
}

export class HardwareItemsUseCase {
  constructor(
    private readonly bm: BusinessModuleService,
    private readonly clock: Clock,
  ) {}

  async list(projectId: ProjectId): Promise<HardwareItemsResult[]> {
    const snaps = await this.bm.listItems(projectId, HARDWARE_ITEMS_KIND);
    return snaps.map(toResult);
  }

  async get(id: string): Promise<DomainResult<HardwareItemsResult>> {
    const r = await this.bm.getItem(id);
    if (!r.ok) return r;
    return domainOk(toResult(r.value));
  }

  async create(
    projectId: ProjectId,
    input: HardwareItemsInput,
  ): Promise<DomainResult<HardwareItemsResult>> {
    const v = validateHardwareItemInput(input);
    if (v) return domainErr("INVALID_INPUT", `hardware item invalid: ${v}`);
    const item = makeHardwareItem({
      category: input.category,
      device: input.device,
      spec: input.spec,
      qty: input.qty,
      unitPrice: input.unitPrice,
      remarks: input.remarks,
    });
    const payload: HardwareItemsPayload = { items: [item] };
    const r = await this.bm.createItem(projectId, HARDWARE_ITEMS_KIND, {
      title: makeTitle(input),
      payloadJson: JSON.stringify(payload),
    });
    if (!r.ok) return r;
    return domainOk(toResult(r.value));
  }

  async update(
    id: string,
    patch: Partial<HardwareItemsInput>,
  ): Promise<DomainResult<HardwareItemsResult>> {
    const existingR = await this.bm.getItem(id);
    if (!existingR.ok) return existingR;
    const existing = existingR.value;
    const existingPayload = parseHardwareItemsPayload(existing.payloadJson ?? "{}");
    const prev = existingPayload.items[existingPayload.items.length - 1] ?? makeHardwareItem();
    const merged = makeHardwareItem({
      category: patch.category ?? prev.category,
      device: patch.device ?? prev.device,
      spec: patch.spec ?? prev.spec,
      qty: patch.qty ?? prev.qty,
      unitPrice: patch.unitPrice ?? prev.unitPrice,
      remarks: patch.remarks ?? prev.remarks,
    });
    const v = validateHardwareItemInput(merged);
    if (v) return domainErr("INVALID_INPUT", `hardware item invalid: ${v}`);

    // 出库前重算小计，保证一致
    merged.subtotal = computeSubtotal(merged);

    const newPayload: HardwareItemsPayload = {
      items: [...existingPayload.items.slice(0, -1), merged],
    };
    const newTitle = makeTitle({
      category: merged.category,
      device: merged.device,
      qty: merged.qty,
      unitPrice: merged.unitPrice,
    });
    const r = await this.bm.updateItem(id, {
      title: newTitle,
      payloadJson: JSON.stringify(newPayload),
    });
    if (!r.ok) return r;
    return domainOk(toResult(r.value));
  }

  async delete(id: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(id);
  }

  /** 给 quote / AI sub-agent 用 */
  async getPayload(projectId: ProjectId): Promise<HardwareItemsPayload> {
    const snaps = await this.bm.listItems(projectId, HARDWARE_ITEMS_KIND);
    const items: HardwareItemPayload[] = [];
    for (const s of snaps) {
      const p = parseHardwareItemsPayload(s.payloadJson ?? "{}");
      for (const it of p.items) {
        // 出库前重算小计，保证一致性
        items.push({ ...it, subtotal: computeSubtotal(it) });
      }
    }
    return { items };
  }
}