/**
 * AutoMode API —— 阶段 13（PR #9）
 *
 * POST /api/ai/auto-mode
 *   body: { projectId: string, plan?: "default" | TaskPlan }
 *   → 同步返回 AutoModeResult（任务结果 + 评分 + 总耗时）
 *
 * 注意：orchestrator.run 是同步阻塞；后续 PR 加 SSE 流式推送再补 GET /api/ai/auto-mode/:id。
 */

import { http } from "@frontend/shared/api/http-client.ts";

/** 与后端 backend/domain/auto-mode/auto-mode.ts 的 ReviewScore 对齐 */
export interface ReviewScoreDTO {
  taskName: string;
  round: number;
  customerScore: number;
  directorScore: number;
  average: number;
  customerFeedback: string;
  directorFeedback: string;
  passed: boolean;
}

export interface TaskResultDTO {
  taskName: string;
  subAgentName: string;
  output: string;
  wroteModules: string[];
  reviews: ReviewScoreDTO[];
  passed: boolean;
  rounds: number;
}

export interface AutoModeResultDTO {
  planId: string;
  projectId: string;
  taskResults: TaskResultDTO[];
  success: boolean;
  totalMs: number;
}

export interface TaskSpecDTO {
  name: string;
  subAgentName: string;
  description: string;
  contextInputs: string[];
}

export interface TaskPlanDTO {
  id: string;
  projectId: string;
  tasks: TaskSpecDTO[];
}

export const autoModeApi = {
  async run(
    input: { projectId: string; plan?: TaskPlanDTO | "default" },
  ): Promise<AutoModeResultDTO> {
    return await http.post<AutoModeResultDTO>("/api/ai/auto-mode", input);
  },
};
