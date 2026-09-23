/**
 * Quote API —— 报价单（阶段 7.4f）
 */

import { http } from "@frontend/shared/api/http-client.ts";

export interface QuoteSnapshotDTO {
  top: {
    totalCP: number;
    totalEffortHours: number;
    functionTotalAmount: number;
    deployTrainingAmount: number;
    totalAmountExclTax: number;
    totalPeriodDays: number;
  };
  hardware: {
    items: Array<{
      category: string;
      device: string;
      spec: string;
      qty: number;
      unitPrice: number;
      subtotal: number;
      remarks: string;
    }>;
    subtotal: number;
    groupedByCategory: Array<{ category: string; items: unknown[]; subtotal: number }>;
  };
  software: { subtotal: number };
  deployTraining: { subtotal: number };
  grandTotalExclTax: number;
}

export interface TemplateDTO {
  id: string;
  filename: string;
  originalFilename: string;
  mime: string;
  size: number;
  projectId: string | null;
  pathOnDisk: string;
  uploadedAt: string;
}

export interface QuoteRunDTO {
  id: string;
  projectId: string;
  templateId: string | null;
  templateFilename: string | null;
  userInput: string;
  aiMarkdown: string;
  summary: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  outputPath: string;
  mimeType: string;
  createdAt: string;
  downloadUrl: string;
}

export const quoteApi = {
  compute(projectId: string): Promise<QuoteSnapshotDTO> {
    return http.get<QuoteSnapshotDTO>(`/api/projects/${projectId}/quote`);
  },
  generateXlsx(
    projectId: string,
    args: { templateId?: string; userInput: string; aiMarkdown?: string },
  ): Promise<{ runId: string; filename: string; mimeType: string }> {
    return http.post<{ runId: string; filename: string; mimeType: string }>(
      `/api/projects/${projectId}/quote/generate`,
      args,
    );
  },
  /** 阶段 7.5（M9）：真实调用 AI sub-agent 起草 markdown；后端已接 proposal-drafter */
  draft(projectId: string, args: { userInput: string }): Promise<{ markdown: string }> {
    return http.post<{ markdown: string }>(`/api/projects/${projectId}/quote/draft`, args);
  },
  listTemplates(projectId: string): Promise<{ items: TemplateDTO[] }> {
    return http.get<{ items: TemplateDTO[] }>(`/api/quote-templates?projectId=${projectId}`);
  },
  uploadTemplate(projectId: string, file: File): Promise<TemplateDTO> {
    const form = new FormData();
    form.append("file", file);
    return http.post<TemplateDTO>(`/api/projects/${projectId}/quote-templates`, form);
  },
  deleteTemplate(id: string): Promise<void> {
    return http.del<void>(`/api/quote-templates/${id}`);
  },
  listRuns(projectId: string): Promise<{ items: QuoteRunDTO[] }> {
    return http.get<{ items: QuoteRunDTO[] }>(`/api/projects/${projectId}/quote/runs`);
  },
  getRun(projectId: string, runId: string): Promise<QuoteRunDTO> {
    return http.get<QuoteRunDTO>(`/api/projects/${projectId}/quote/runs/${runId}`);
  },
  downloadUrl(projectId: string, runId: string): string {
    return `/api/projects/${projectId}/quote/runs/${runId}/download`;
  },
  downloadTemplateUrl(id: string): string {
    return `/api/quote-templates/${id}`;
  },
};