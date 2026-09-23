/**
 * use-resizable-width.ts
 * ======================
 * 共享的「可持久化宽度」composable：把面板宽度状态 + localStorage 读写封在一起。
 * 不耦合到具体组件（侧栏/抽屉）—— 任何需要拖动 + 记住宽度的面板都能用。
 */
import { ref, watch, type Ref } from "vue";

export interface UseResizableWidthOptions {
  /** localStorage key，例如 "ui.shell.leftNav" */
  storageKey: string;
  /** 首次访问时（无 localStorage）使用的默认宽度，px */
  defaultWidth: number;
  /** 下限，px */
  min: number;
  /** 上限，px */
  max: number;
}

export interface UseResizableWidthReturn {
  width: Ref<number>;
  setWidth: (px: number) => void;
  reset: () => void;
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function useResizableWidth(
  opts: UseResizableWidthOptions,
): UseResizableWidthReturn {
  let initial = opts.defaultWidth;
  try {
    const stored = localStorage.getItem(opts.storageKey);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        initial = parsed;
      }
    }
  } catch {
    // localStorage 不可用（隐私模式 / SSR）—— 走默认
  }
  const width = ref(clamp(initial, opts.min, opts.max));

  function setWidth(px: number): void {
    width.value = clamp(px, opts.min, opts.max);
  }

  function reset(): void {
    width.value = opts.defaultWidth;
    try {
      localStorage.removeItem(opts.storageKey);
    } catch {
      // ignore
    }
  }

  watch(width, (w) => {
    try {
      localStorage.setItem(opts.storageKey, String(w));
    } catch {
      // ignore
    }
  });

  return { width, setWidth, reset };
}