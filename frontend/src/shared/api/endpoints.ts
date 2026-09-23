/**
 * 后端 API 端点常量
 *
 * 与后端 `backend/presentation/server.ts` 路由表对应。
 * 改路径时只改这一处。
 */

export const Endpoints = {
  health: "/api/health",
  projects: "/api/projects",
  project: (id: string) => `/api/projects/${id}`,
  // AI
  aiChat: "/api/ai/chat",
  aiChatStream: "/api/ai/chat/stream",
  // Sub-agent
  subAgents: "/api/sub-agents",
  subAgent: (name: string) => `/api/sub-agents/${name}`,
  subAgentInvoke: (name: string) => `/api/sub-agents/${name}/invoke`,
  // 阶段 7.4g：仪表盘
  dashboardSummary: "/api/dashboard/summary",
  dashboardMonthly: "/api/dashboard/monthly",
  dashboardUpcomingActivities: "/api/dashboard/upcoming-activities",
  // 阶段 7.4h：系统设置
  settingsAll: "/api/settings",
  settingsLlmProfiles: "/api/settings/llm-profiles",
  settingsMailAccounts: "/api/settings/mail-accounts",
  settingsToolConfigs: "/api/settings/tool-configs",
  settingsAgentSpecs: "/api/settings/agent-specs",
  settingsEmbedding: "/api/settings/embedding",
} as const;