/**
 * Knowledge Store —— 项目知识库状态缓存 + ingest 触发
 *
 * 阶段 6.0g。Pinia store，按 projectId 缓存 status；ingest 触发后自动 invalidate。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { knowledgeApi, type KnowledgeIngestResult, type KnowledgeStatusResult } from "../api/knowledge.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

export const useKnowledgeStore = defineStore("knowledge", () => {
  /** key = projectId */
  const statusMap = ref<Map<string, KnowledgeStatusResult>>(new Map());
  /** 当前 ingest 中的 projectId（loading 态） */
  const ingesting = ref<string | null>(null);
  /** 最近一次 ingest 结果 */
  const lastIngest = ref<KnowledgeIngestResult | null>(null);
  /** 错误消息 */
  const error = ref<string | null>(null);

  async function loadStatus(projectId: string): Promise<void> {
    try {
      const s = await knowledgeApi.status(projectId);
      statusMap.value.set(projectId, s);
      statusMap.value = new Map(statusMap.value);  // trigger
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    }
  }

  async function ingest(projectId: string, opts?: { messageLimit?: number }): Promise<KnowledgeIngestResult | null> {
    if (ingesting.value === projectId) return null;
    ingesting.value = projectId;
    error.value = null;
    try {
      const r = await knowledgeApi.ingest(projectId, opts);
      lastIngest.value = r;
      // 自动刷新 status
      await loadStatus(projectId);
      return r;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      ingesting.value = null;
    }
  }

  function getStatus(projectId: string): KnowledgeStatusResult | undefined {
    return statusMap.value.get(projectId);
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    statusMap,
    ingesting,
    lastIngest,
    error,
    loadStatus,
    ingest,
    getStatus,
    clearError,
  };
});