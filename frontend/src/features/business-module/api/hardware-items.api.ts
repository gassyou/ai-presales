/**
 * HardwareItems API —— 硬件设备成本清单（结构化）
 *
 * 阶段 7.4f。后端走 HardwareItemsUseCase + handleHardwareItems。
 */

import { http } from "@frontend/shared/api/http-client.ts";

export interface HardwareItemDTO {
  id: string;
  projectId: string;
  title: string;
  item: {
    category: string;
    device: string;
    spec: string;
    qty: number;
    unitPrice: number;
    subtotal: number;
    remarks: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface HardwareItemInput {
  category: string;
  device: string;
  spec?: string;
  qty: number;
  unitPrice: number;
  remarks?: string;
}

export const hardwareItemsApi = {
  list(projectId: string): Promise<{ items: HardwareItemDTO[] }> {
    return http.get<{ items: HardwareItemDTO[] }>(`/api/projects/${projectId}/hardware-items`);
  },
  create(projectId: string, body: HardwareItemInput): Promise<HardwareItemDTO> {
    return http.post<HardwareItemDTO>(`/api/projects/${projectId}/hardware-items`, body);
  },
  update(id: string, patch: Partial<HardwareItemInput>): Promise<HardwareItemDTO> {
    return http.patch<HardwareItemDTO>(`/api/modules/hardware-items/${id}`, patch);
  },
  delete(id: string): Promise<void> {
    return http.del<void>(`/api/modules/hardware-items/${id}`);
  },
};