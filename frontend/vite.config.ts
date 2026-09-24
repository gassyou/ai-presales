import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";

/** 复制目录（递归） */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = resolve(src, entry);
    const d = resolve(dest, entry);
    if (statSync(s).isDirectory()) copyDirSync(s, d);
    else copyFileSync(s, d);
  }
}

/** 把 vue3-mindmap 的 icons 复制到 dist/icons/，因为 style.css 引用 /icons/... */
const mindmapIcons = resolve(__dirname, "node_modules/vue3-mindmap/dist/icons");
const distIcons = resolve(__dirname, "..", "dist/icons");

export default defineConfig({
  plugins: [
    vue(),
    // 自动导入 Element Plus 组件（按需引入，无需手动 import）
    Components({
      resolvers: [ElementPlusResolver()],
      dts: "src/types/auto-components.d.ts",
    }),
    // 自动导入 ElMessage / ElMessageBox / ElNotification 等函数
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: "src/types/auto-imports.d.ts",
    }),
    {
      name: "copy-vue3-mindmap-icons",
      closeBundle(): void {
        try {
          copyDirSync(mindmapIcons, distIcons);
        } catch (e) {
          console.warn("[vite.config] failed to copy mindmap icons:", e);
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, ".."),
      "@shared": resolve(__dirname, "..", "shared"),
      "@backend": resolve(__dirname, "..", "backend"),
      "@frontend": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
