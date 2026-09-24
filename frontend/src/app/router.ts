/**
 * 路由表
 *
 * 阶段 1：仅展示工作台壳
 * 阶段 2：挂载 /projects → ProjectListView
 * 阶段 6.0f：挂载 /projects/:id → ProjectDetailView（绑定 AI）
 * 阶段重构：移除独立 /ai 路由 —— AI 常驻右侧抽屉 dock，
 *          项目列表在 WorkspaceShell 启动时拉一次作为 @ mention 候选池。
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import WorkspaceShell from "./shell/WorkspaceShell.vue";
import DashboardView from "@frontend/features/dashboard/DashboardView.vue";
import ProjectListView from "@frontend/features/project/ProjectListView.vue";
import ProjectDetailView from "@frontend/features/project/ProjectDetailView.vue";
import SettingsView from "@frontend/features/settings/SettingsView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: WorkspaceShell,
    children: [
      { path: "", name: "dashboard", component: DashboardView },
      { path: "projects", name: "projects", component: ProjectListView },
      { path: "projects/:id", name: "project-detail", component: ProjectDetailView, props: true },
      // 阶段 7.4h：系统设置
      { path: "settings", name: "settings", component: SettingsView },
    ],
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});