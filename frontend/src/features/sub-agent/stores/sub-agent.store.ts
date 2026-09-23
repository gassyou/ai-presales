/**
 * SubAgentStore —— Pinia store，缓存 sub-agent 列表
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { subAgentApi, type SubAgentDTO } from "../api/sub-agent.api.ts";

export const useSubAgentStore = defineStore("subAgents", () => {
  const items = ref<SubAgentDTO[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    try {
      const res = await subAgentApi.list();
      items.value = [...res.items];
      loaded.value = true;
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  return { items, loaded, error, load };
});