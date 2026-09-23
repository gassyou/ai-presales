/**
 * 路由表
 *
 * 阶段 1：仅展示工作台壳
 * 阶段 2：挂载 /projects → ProjectListView
 * 阶段 3：挂载 /ai → AiChatPanel（独立页，便于调试）
 * 阶段 6.0f：挂载 /projects/:id → ProjectDetailView（绑定 AI）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import WorkspaceShell from "./shell/WorkspaceShell.vue";
import DashboardView from "@frontend/features/dashboard/DashboardView.vue";
import ProjectListView from "@frontend/features/project/ProjectListView.vue";
import ProjectDetailView from "@frontend/features/project/ProjectDetailView.vue";
import AiChatView from "@frontend/features/ai-chat/AiChatView.vue";
import SettingsView from "@frontend/features/settings/SettingsView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: WorkspaceShell,
    children: [
      { path: "", name: "dashboard", component: DashboardView },
      { path: "projects", name: "projects", component: ProjectListView },
      { path: "projects/:id", name: "project-detail", component: ProjectDetailView, props: true },
      { path: "ai", name: "ai", component: AiChatView },
      // 阶段 7.4h：系统设置
      { path: "settings", name: "settings", component: SettingsView },
    ],
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});