/**
 * skillStore —— 阶段 13（PR #5）
 *
 * Pinia store：缓存 skill 列表 + 提供 invoke action。
 * 调用 ai-chat.store 注入做 executeSkill 时用 invoke；ChatComposer 弹 popover 时用 items。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { skillApi, type SkillSummaryDTO } from "../api/skill.api.ts";

export const useSkillStore = defineStore("skill", () => {
  const items = ref<SkillSummaryDTO[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      items.value = await skillApi.list();
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function invoke(name: string, args: Record<string, unknown> = {}) {
    return await skillApi.invoke(name, args);
  }

  return { items, loading, loaded, load, invoke };
});
