/**
 * SurveyTask API —— 调查任务专用
 *
 * 阶段 7.1。后端在 survey_task kind 下暴露：
 *   - POST /api/projects/:id/modules/survey_task/items            单条创建
 *   - POST /api/projects/:id/modules/survey_task/items?action=batchGenerate  批量生成
 *   - POST /api/modules/items/:id/start                            启动
 *   - POST /api/modules/items/:id/stop                             终止
 *   - GET  /api/modules/items/:id                                  单条（含 taskStatus）
 *   - POST /api/modules/items/:id/adopt                            采纳调查结果
 *   - POST /api/modules/items/:id/unadopt                          不采用
 */

import { http } from "@frontend/shared/api/http-client.ts";

export type SurveyTaskStatus = "idle" | "running" | "completed" | "aborted";
export type AdoptionStatus = "pending" | "adopted" | "unadopted";

export interface SurveyTaskResult {
  id: string;
  projectId: string;
  title: string;
  taskStatus: SurveyTaskStatus;
  resultContent: string;
  adoptionStatus: AdoptionStatus;
  topicHint?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export const surveyTaskApi = {
  list(projectId: string) {
    return http.get<{ items: SurveyTaskResult[]; kind: string; projectId: string }>(
      `/api/projects/${projectId}/modules/survey_task/items`,
    );
  },
  create(
    projectId: string,
    body: { title: string; content?: string; topicHint?: string },
  ) {
    return http.post<SurveyTaskResult>(
      `/api/projects/${projectId}/modules/survey_task/items`,
      {
        title: body.title,
        content: body.content ?? "",
        payloadJson: JSON.stringify({ topicHint: body.topicHint }),
      },
    );
  },
  batchGenerate(projectId: string, topics: string[]) {
    return http.post<{ items: SurveyTaskResult[] }>(
      `/api/projects/${projectId}/modules/survey_task/items?action=batchGenerate`,
      { topics },
    );
  },
  start(taskId: string) {
    return http.post<SurveyTaskResult>(`/api/modules/items/${taskId}/start`);
  },
  stop(taskId: string) {
    return http.post<SurveyTaskResult>(`/api/modules/items/${taskId}/stop`);
  },
  get(taskId: string) {
    return http.get<SurveyTaskResult>(`/api/modules/items/${taskId}`);
  },
  adopt(taskId: string) {
    return http.post<SurveyTaskResult>(`/api/modules/items/${taskId}/adopt`);
  },
  unadopt(taskId: string) {
    return http.post<SurveyTaskResult>(`/api/modules/items/${taskId}/unadopt`);
  },
  delete(taskId: string) {
    return http.del<void>(`/api/modules/items/${taskId}`);
  },
};
