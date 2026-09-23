/**
 * quoteStore —— 报价单 Pinia store
 *
 * 阶段 7.4f。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  quoteApi,
  type QuoteSnapshotDTO,
  type QuoteRunDTO,
  type TemplateDTO,
} from "../api/quote.api.ts";

export const useQuoteStore = defineStore("quote", () => {
  const snapshotByProject = ref<Map<string, QuoteSnapshotDTO>>(new Map());
  const templatesByProject = ref<Map<string, TemplateDTO[]>>(new Map());
  const runsByProject = ref<Map<string, QuoteRunDTO[]>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadSnapshot(projectId: string): Promise<QuoteSnapshotDTO | null> {
    loading.value = true;
    error.value = null;
    try {
      const s = await quoteApi.compute(projectId);
      snapshotByProject.value.set(projectId, s);
      return s;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function loadTemplates(projectId: string): Promise<void> {
    try {
      const r = await quoteApi.listTemplates(projectId);
      templatesByProject.value.set(projectId, r.items);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadRuns(projectId: string): Promise<void> {
    try {
      const r = await quoteApi.listRuns(projectId);
      runsByProject.value.set(projectId, r.items);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function generate(
    projectId: string,
    args: { templateId?: string; userInput: string; aiMarkdown?: string },
  ): Promise<{ runId: string; filename: string; mimeType: string } | null> {
    loading.value = true;
    try {
      const r = await quoteApi.generateXlsx(projectId, args);
      await loadRuns(projectId);
      return r;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function uploadTemplate(projectId: string, file: File): Promise<TemplateDTO | null> {
    try {
      const t = await quoteApi.uploadTemplate(projectId, file);
      await loadTemplates(projectId);
      return t;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async function deleteTemplate(projectId: string, id: string): Promise<boolean> {
    try {
      await quoteApi.deleteTemplate(id);
      await loadTemplates(projectId);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  function getSnapshot(projectId: string): QuoteSnapshotDTO | undefined {
    return snapshotByProject.value.get(projectId);
  }
  function getTemplates(projectId: string): TemplateDTO[] {
    return templatesByProject.value.get(projectId) ?? [];
  }
  function getRuns(projectId: string): QuoteRunDTO[] {
    return runsByProject.value.get(projectId) ?? [];
  }

  return {
    snapshotByProject,
    templatesByProject,
    runsByProject,
    loading,
    error,
    loadSnapshot,
    loadTemplates,
    loadRuns,
    generate,
    uploadTemplate,
    deleteTemplate,
    getSnapshot,
    getTemplates,
    getRuns,
  };
});