/**
 * AutoModeStore —— 阶段 13（PR #9）
 *
 * 中央 auto-mode 触发 + 结果管理。
 * 单一项目触发；返回的 AutoModeResult 留在 store，前端组件直接渲染。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { autoModeApi, type AutoModeResultDTO } from "../api/auto-mode.api.ts";
import { ElMessage } from "element-plus";

export const useAutoModeStore = defineStore("autoMode", () => {
  const running = ref<boolean>(false);
  const lastResult = ref<AutoModeResultDTO | null>(null);
  const lastError = ref<string | null>(null);

  async function run(projectId: string): Promise<AutoModeResultDTO | null> {
    if (running.value) return null;
    running.value = true;
    lastError.value = null;
    try {
      const result = await autoModeApi.run({ projectId, plan: "default" });
      lastResult.value = result;
      if (result.success) {
        ElMessage.success(
          `auto-mode 完成：${result.taskResults.length} 个任务全部通过（总耗时 ${
            (result.totalMs / 1000).toFixed(1)
          }s）`,
        );
      } else {
        ElMessage.warning(
          `auto-mode 部分失败：${
            result.taskResults.filter((t) => t.passed).length
          }/${result.taskResults.length} 通过`,
        );
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError.value = msg;
      ElMessage.error(`auto-mode 失败：${msg}`);
      return null;
    } finally {
      running.value = false;
    }
  }

  function clear(): void {
    lastResult.value = null;
    lastError.value = null;
  }

  return { running, lastResult, lastError, run, clear };
});
