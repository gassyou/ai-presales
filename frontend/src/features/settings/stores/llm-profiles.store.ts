/**
 * llmProfilesStore —— 阶段 13（PR #6）：Composer 的 LLM profile 数据源
 *
 * 包装 settingsApi.getLLMProfiles()；把 LLMProfileConfigDTO（name/provider/model）
 * 适配成 UI 友好的 LlmProfile（id/label/provider/model）。
 *
 * 注意：DTO 用 `name` 作主键；这里统一用 `id` 字段（与 spec 一致），等于 DTO.name。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { type LLMProfileConfigDTO, settingsApi } from "../api/settings.api.ts";

export interface LlmProfile {
  /** 与 LLMProfileConfigDTO.name 一致 —— 作为 profile 主键 */
  id: string;
  /** 供 el-select 显示：缺省用 `${provider}/${model}` */
  label: string;
  provider: string;
  model: string;
}

/** 把 DTO 展平成 UI 行 */
export function toLlmProfile(p: LLMProfileConfigDTO): LlmProfile {
  return {
    id: p.name,
    label: `${p.provider}/${p.model}`,
    provider: p.provider,
    model: p.model,
  };
}

export const useLlmProfilesStore = defineStore("llmProfiles", () => {
  const items = ref<LlmProfile[]>([]);
  const defaultProfile = ref<string>("");
  const loading = ref(false);
  const loaded = ref(false);

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      const dto = await settingsApi.getLLMProfiles();
      items.value = dto.profiles.map(toLlmProfile);
      defaultProfile.value = dto.defaultProfile;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { items, defaultProfile, loading, loaded, load };
});
