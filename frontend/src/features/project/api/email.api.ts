/**
 * email.api.ts —— 邮件 + 附件 API
 *
 * 阶段 7.4e。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

export type EmailStatus = "draft" | "sent" | "failed";

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailDTO {
  id: string;
  projectId: string;
  subject: string;
  body: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  status: EmailStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface CreateEmailInput {
  subject?: string;
  body?: string;
  to?: EmailAddress[];
  cc?: EmailAddress[];
}

export interface UpdateEmailInput {
  subject?: string;
  body?: string;
  to?: EmailAddress[];
  cc?: EmailAddress[];
}

export interface EmailAttachmentDTO {
  id: string;
  emailId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

export const emailApi = {
  list(projectId: string) {
    return http.get<{ items: EmailDTO[] }>(`/api/projects/${projectId}/emails`);
  },
  get(projectId: string, emailId: string) {
    return http.get<EmailDTO>(`/api/projects/${projectId}/emails/${emailId}`);
  },
  create(projectId: string, input: CreateEmailInput) {
    return http.post<EmailDTO>(`/api/projects/${projectId}/emails`, input);
  },
  update(projectId: string, emailId: string, input: UpdateEmailInput) {
    return http.patch<EmailDTO>(
      `/api/projects/${projectId}/emails/${emailId}`,
      input,
    );
  },
  send(projectId: string, emailId: string) {
    return http.post<EmailDTO>(
      `/api/projects/${projectId}/emails/${emailId}/send`,
      {},
    );
  },
  listAttachments(projectId: string, emailId: string) {
    return http.get<{ items: EmailAttachmentDTO[] }>(
      `/api/projects/${projectId}/emails/${emailId}/attachments`,
    );
  },
  /** 上传附件（multipart/form-data，不走通用 httpClient） */
  async uploadAttachment(
    projectId: string,
    emailId: string,
    file: File,
  ): Promise<EmailAttachmentDTO> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(
      `/api/projects/${projectId}/emails/${emailId}/attachments`,
      { method: "POST", body: formData },
    );
    if (!res.ok) {
      let body: { code?: string; message?: string } = {};
      try { body = await res.json() as typeof body; } catch { /* ignore */ }
      throw new ApiError(
        { code: body.code ?? "ERROR", message: body.message ?? `upload failed (${res.status})`, traceId: "" },
        res.status,
      );
    }
    return await res.json() as EmailAttachmentDTO;
  },
  /** 下载附件 → 触发浏览器保存 */
  async downloadAttachment(
    projectId: string,
    emailId: string,
    attachmentId: string,
    filename: string,
  ): Promise<void> {
    const res = await fetch(
      `/api/projects/${projectId}/emails/${emailId}/attachments/${attachmentId}`,
    );
    if (!res.ok) {
      throw new ApiError(
        { code: "ERROR", message: `download failed (${res.status})`, traceId: "" },
        res.status,
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  removeAttachment(projectId: string, emailId: string, attachmentId: string) {
    return http.del<void>(
      `/api/projects/${projectId}/emails/${emailId}/attachments/${attachmentId}`,
    );
  },
};