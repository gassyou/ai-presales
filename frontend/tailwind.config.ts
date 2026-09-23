import type { Config } from "tailwindcss";

/**
 * 主题：浅色商务风（Notion / Linear 感）
 *   - canvas  : 页面底色（白 / 近白）
 *   - surface : 卡片/区域底（白 / 极浅灰 / 浅灰）
 *   - accent  : 主色（墨绿 #059669）
 *   - muted   : 次要文字
 *   - border  : 边框灰
 *
 * 保留 darkMode: "class" 以备未来主题切换（本轮不使用）。
 *
 * 用法约定：
 *   页面底色       bg-canvas
 *   卡片底         bg-surface / bg-white
 *   区域底（次级）  bg-surface-alt
 *   行 hover       hover:bg-surface-sunken
 *   边框           border-border
 *   主文字         text-slate-900 / text-canvas-ink
 *   次要文字       text-muted
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#FFFFFF",
          subtle: "#FAFAFA",
          ink: "#0F172A",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          alt: "#F9FAFB",
          sunken: "#F3F4F6",
        },
        accent: {
          DEFAULT: "#059669",
          subtle: "#047857",
          soft: "#ECFDF5",
          ink: "#065F46",
        },
        border: {
          DEFAULT: "#E5E7EB",
          strong: "#D1D5DB",
          soft: "#F3F4F6",
        },
        muted: "#6B7280",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "xs": ["0.6875rem", { lineHeight: "1rem" }],
        "sm": ["0.8125rem", { lineHeight: "1.15rem" }],
        "base": ["0.875rem", { lineHeight: "1.3rem" }],
        "lg": ["1rem", { lineHeight: "1.45rem" }],
      },
      spacing: {
        "4.5": "1.125rem",
      },
      boxShadow: {
        "card": "0 1px 2px rgba(15, 23, 42, 0.04)",
        "pop": "0 4px 16px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
