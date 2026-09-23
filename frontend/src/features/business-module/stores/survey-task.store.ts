/**
 * SurveyTask Store —— 调查任务专用 Pinia store
 *
 * 阶段 7.1。按 projectId 缓存列表；start 后轮询 get 直到 taskStatus 不为 running。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { surveyTaskApi, type SurveyTaskResult, type SurveyTaskStatus } from "../api/survey-task.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const POLL_INTERVAL_MS = 400;

export const useSurveyTaskStore = defineStore("survey-task", () => {
  const tasksByProject = ref<Map<string, SurveyTaskResult[]>>(new Map());
  const loading = ref<string | null>(null);
  const error = ref<string | null>(null);
  /** taskId -> polling handle */
  const polling = new Map<string, number>();
  /** taskId -> 最新瞬时状态（用于 UI 在 polling 期间也响应 stop） */
  const liveStatus = ref<Map<string, SurveyTaskStatus>>(new Map());

  async function load(projectId: string): Promise<void> {
    loading.value = projectId;
    error.value = null;
    try {
      const r = await surveyTaskApi.list(projectId);
      tasksByProject.value.set(projectId, r.items);
      tasksByProject.value = new Map(tasksByProject.value);
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      loading.value = null;
    }
  }

  async function create(
    projectId: string,
    input: { title: string; content?: string; topicHint?: string },
  ): Promise<SurveyTaskResult | null> {
    error.value = null;
    try {
      const it = await surveyTaskApi.create(projectId, input);
      await load(projectId);
      return it;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function batchGenerate(
    projectId: string,
    topics: string[],
  ): Promise<SurveyTaskResult[] | null> {
    error.value = null;
    try {
      const r = await surveyTaskApi.batchGenerate(projectId, topics);
      await load(projectId);
      return r.items;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function start(taskId: string, projectId: string): Promise<SurveyTaskResult | null> {
    error.value = null;
    try {
      const it = await surveyTaskApi.start(taskId);
      liveStatus.value.set(taskId, "running");
      liveStatus.value = new Map(liveStatus.value);
      beginPolling(taskId, projectId);
      await load(projectId);
      return it;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function stop(taskId: string, projectId: string): Promise<SurveyTaskResult | null> {
    error.value = null;
    stopPolling(taskId);
    try {
      const it = await surveyTaskApi.stop(taskId);
      liveStatus.value.set(taskId, "aborted");
      liveStatus.value = new Map(liveStatus.value);
      await load(projectId);
      return it;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function adopt(taskId: string, projectId: string): Promise<void> {
    try {
      await surveyTaskApi.adopt(taskId);
      await load(projectId);
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    }
  }

  async function unadopt(taskId: string, projectId: string): Promise<void> {
    try {
      await surveyTaskApi.unadopt(taskId);
      await load(projectId);
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteTask(taskId: string, projectId: string): Promise<boolean> {
    stopPolling(taskId);
    try {
      await surveyTaskApi.delete(taskId);
      await load(projectId);
      return true;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function getList(projectId: string): SurveyTaskResult[] {
    return tasksByProject.value.get(projectId) ?? [];
  }

  function getLiveStatus(taskId: string): SurveyTaskStatus | undefined {
    return liveStatus.value.get(taskId);
  }

  function clearError(): void {
    error.value = null;
  }

  function beginPolling(taskId: string, projectId: string): void {
    stopPolling(taskId);
    const handle = setInterval(async () => {
      try {
        const it = await surveyTaskApi.get(taskId);
        if (it.taskStatus !== "running") {
          liveStatus.value.set(taskId, it.taskStatus);
          liveStatus.value = new Map(liveStatus.value);
          stopPolling(taskId);
          await load(projectId);
        }
      } catch {
        stopPolling(taskId);
      }
    }, POLL_INTERVAL_MS);
    polling.set(taskId, handle as unknown as number);
  }

  function stopPolling(taskId: string): void {
    const h = polling.get(taskId);
    if (h !== undefined) {
      clearInterval(h);
      polling.delete(taskId);
    }
  }

  return {
    tasksByProject,
    loading,
    error,
    load,
    create,
    batchGenerate,
    start,
    stop,
    adopt,
    unadopt,
    deleteTask,
    getList,
    getLiveStatus,
    clearError,
  };
});
