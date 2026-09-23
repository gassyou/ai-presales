/**
 * Budget Store —— 功能清单 + 预算设置 + 预算汇总 的 Pinia store
 *
 * 阶段 7.4b。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  structuredModulesApi,
  type BudgetSettingsDTO,
  type BudgetSettingsInput,
  type BudgetSummaryDTO,
  type FunctionListDTO,
  type FunctionListInput,
} from "../api/structured-modules.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

export const useBudgetStore = defineStore("budget", () => {
  // ---------- FunctionList ----------
  const functionsByProject = ref<Map<string, FunctionListDTO[]>>(new Map());
  const functionError = ref<string | null>(null);

  async function loadFunctions(projectId: string): Promise<void> {
    try {
      const r = await structuredModulesApi.listFunctions(projectId);
      functionsByProject.value.set(projectId, r.items);
      functionsByProject.value = new Map(functionsByProject.value);
      functionError.value = null;
    } catch (e) {
      functionError.value = errMsg(e);
    }
  }

  async function createFunction(
    projectId: string,
    input: FunctionListInput,
  ): Promise<FunctionListDTO | null> {
    try {
      const it = await structuredModulesApi.createFunction(projectId, input);
      await loadFunctions(projectId);
      return it;
    } catch (e) {
      functionError.value = errMsg(e);
      return null;
    }
  }

  async function updateFunction(
    projectId: string,
    id: string,
    input: Partial<FunctionListInput>,
  ): Promise<FunctionListDTO | null> {
    try {
      const it = await structuredModulesApi.updateFunction(id, input);
      await loadFunctions(projectId);
      return it;
    } catch (e) {
      functionError.value = errMsg(e);
      return null;
    }
  }

  async function deleteFunction(projectId: string, id: string): Promise<boolean> {
    try {
      await structuredModulesApi.deleteFunction(id);
      await loadFunctions(projectId);
      return true;
    } catch (e) {
      functionError.value = errMsg(e);
      return false;
    }
  }

  // ---------- BudgetSettings ----------
  const settingsByProject = ref<Map<string, BudgetSettingsDTO>>(new Map());
  const settingsError = ref<string | null>(null);

  async function loadSettings(projectId: string): Promise<BudgetSettingsDTO | null> {
    try {
      const r = await structuredModulesApi.getBudgetSettings(projectId);
      settingsByProject.value.set(projectId, r);
      settingsByProject.value = new Map(settingsByProject.value);
      settingsError.value = null;
      return r;
    } catch (e) {
      settingsError.value = errMsg(e);
      return null;
    }
  }

  async function saveSettings(
    projectId: string,
    input: BudgetSettingsInput,
  ): Promise<BudgetSettingsDTO | null> {
    try {
      const r = await structuredModulesApi.updateBudgetSettings(projectId, input);
      settingsByProject.value.set(projectId, r);
      settingsByProject.value = new Map(settingsByProject.value);
      settingsError.value = null;
      return r;
    } catch (e) {
      settingsError.value = errMsg(e);
      return null;
    }
  }

  // ---------- BudgetSummary ----------
  const summaryByProject = ref<Map<string, BudgetSummaryDTO>>(new Map());
  const summaryError = ref<string | null>(null);

  async function loadSummary(projectId: string): Promise<BudgetSummaryDTO | null> {
    try {
      const r = await structuredModulesApi.getBudgetSummary(projectId);
      summaryByProject.value.set(projectId, r);
      summaryByProject.value = new Map(summaryByProject.value);
      summaryError.value = null;
      return r;
    } catch (e) {
      summaryError.value = errMsg(e);
      return null;
    }
  }

  return {
    functionsByProject,
    functionError,
    settingsByProject,
    settingsError,
    summaryByProject,
    summaryError,
    loadFunctions,
    createFunction,
    updateFunction,
    deleteFunction,
    loadSettings,
    saveSettings,
    loadSummary,
  };
});