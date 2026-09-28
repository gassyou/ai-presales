/**
 * GET    /api/projects?status=&search=&limit=&offset=
 * POST   /api/projects                    body: { name, clientName }
 * GET    /api/projects/:id
 * PATCH  /api/projects/:id                body: { name?, ... }
 * POST   /api/projects/:id/status         body: { target, reason? }
 * DELETE /api/projects/:id
 *
 * 错误统一 ErrorEnvelope（presentation 层做映射）。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { type DomainErrorCode, type DomainResult } from "@backend/domain/shared/result.ts";
import type { ErrorCodeValue, ErrorEnvelope } from "@shared/types/common.ts";
import { ErrorCode } from "@shared/types/common.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type {
  CreateProjectInput,
  ProjectDTO,
  ProjectStatusValue,
  UpdateProjectInput,
} from "@shared/types/dto/project.ts";

export interface ProjectRouteDeps {
  logger: Logger;
  service: ProjectService;
}

function err(status: number, code: ErrorCodeValue, message: string, details?: unknown): Response {
  const body: ErrorEnvelope = details === undefined
    ? { code, message, traceId: "" }
    : { code, message, details, traceId: "" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** DomainError → HTTP status + ErrorCode */
function mapDomainError(domainCode: DomainErrorCode): { status: number; code: ErrorCodeValue } {
  switch (domainCode) {
    case "INVALID_INPUT":
      return { status: 400, code: ErrorCode.VALIDATION_FAILED };
    case "NOT_FOUND":
      return { status: 404, code: ErrorCode.NOT_FOUND };
    case "CONFLICT":
      return { status: 409, code: ErrorCode.CONFLICT };
    case "ILLEGAL_STATE_TRANSITION":
      return { status: 409, code: ErrorCode.CONFLICT };
    case "INVARIANT_VIOLATED":
      return { status: 422, code: ErrorCode.VALIDATION_FAILED };
    case "ABORTED":
      return { status: 499, code: ErrorCode.INTERNAL };
    case "NOT_IMPLEMENTED":
      return { status: 501, code: ErrorCode.INTERNAL };
    case "INTERNAL":
      return { status: 500, code: ErrorCode.INTERNAL };
  }
}

function unwrap<T>(r: DomainResult<T>): { value?: T; response?: Response } {
  if (r.ok) return { value: r.value };
  const m = mapDomainError(r.error.code);
  return { response: err(m.status, m.code, r.error.message, r.error.details) };
}

function snapshotToDTO(s: {
  id: ProjectId;
  code: string;
  name: string;
  clientName: string;
  status: ProjectStatusValue;
  createdAt: Date;
  updatedAt: Date;
  contacts?: readonly {
    id: string;
    name: string;
    title: string;
    email: string;
    phone: string;
    isPrimary: boolean;
  }[];
  teamMembers?: readonly { id: string; name: string; email: string; phone: string }[];
  clientWebsite?: string | null;
  clientIntro?: string | null;
  projectIntro?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}): ProjectDTO {
  const contacts = s.contacts ?? [];
  const teamMembers = s.teamMembers ?? [];
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    clientName: s.clientName,
    clientWebsite: s.clientWebsite ?? undefined,
    clientIntro: s.clientIntro ?? undefined,
    projectIntro: s.projectIntro ?? undefined,
    startDate: s.startDate ? s.startDate.toISOString() : undefined,
    endDate: s.endDate ? s.endDate.toISOString() : undefined,
    status: s.status,
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title || undefined,
      email: c.email || undefined,
      phone: c.phone || undefined,
      isPrimary: c.isPrimary,
    })),
    teamMembers: teamMembers.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email || undefined,
      phone: m.phone || undefined,
    })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("expected application/json");
  }
  try {
    return await req.json();
  } catch {
    throw new Error("invalid JSON body");
  }
}

export async function handleProjects(
  req: Request,
  deps: ProjectRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // 列表 / 创建
  if (path === "/api/projects") {
    if (method === "GET") return listProjects(req, deps, url);
    if (method === "POST") return createProject(req, deps);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  // 子资源
  const sub = path.match(/^\/api\/projects\/([0-9a-fA-F-]{36})(\/status)?$/);
  if (!sub) {
    return err(404, ErrorCode.NOT_FOUND, `route ${path} not found`);
  }
  const id = toProjectId(sub[1]);

  if (sub[2]) {
    // /status
    if (method === "POST") return changeStatus(req, deps, id);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  if (method === "GET") return getProject(deps, id);
  if (method === "PATCH") return updateProject(req, deps, id);
  if (method === "DELETE") return deleteProject(deps, id);
  return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
}

async function listProjects(req: Request, deps: ProjectRouteDeps, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const result = await deps.service.listProjects({ status, search, limit, offset });
  const items = result.items.map(snapshotToDTO);
  return new Response(JSON.stringify({ items, total: result.total, limit, offset }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function createProject(req: Request, deps: ProjectRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(
      400,
      ErrorCode.VALIDATION_FAILED,
      e instanceof Error ? e.message : "invalid request",
    );
  }
  if (!raw || typeof raw !== "object") {
    return err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body");
  }
  const input = raw as Partial<CreateProjectInput>;
  if (typeof input.name !== "string" || typeof input.clientName !== "string") {
    return err(400, ErrorCode.VALIDATION_FAILED, "name and clientName are required strings");
  }
  const serviceInput: {
    name: string;
    clientName: string;
    clientWebsite?: string;
    clientIntro?: string;
    projectIntro?: string;
    startDate?: Date;
    endDate?: Date;
  } = {
    name: input.name,
    clientName: input.clientName,
  };
  if (typeof input.clientWebsite === "string") serviceInput.clientWebsite = input.clientWebsite;
  if (typeof input.clientIntro === "string") serviceInput.clientIntro = input.clientIntro;
  if (typeof input.projectIntro === "string") serviceInput.projectIntro = input.projectIntro;
  const startDate = parseIsoDate(input.startDate, "startDate");
  if (startDate.error) return startDate.error;
  if (startDate.value) serviceInput.startDate = startDate.value;
  const endDate = parseIsoDate(input.endDate, "endDate");
  if (endDate.error) return endDate.error;
  if (endDate.value) serviceInput.endDate = endDate.value;
  const r = await deps.service.createProject(serviceInput);
  const u = unwrap(r);
  if (u.response) return u.response;
  deps.logger.info("project created", { id: u.value!.id, code: u.value!.code });
  return new Response(JSON.stringify(snapshotToDTO(u.value!)), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getProject(deps: ProjectRouteDeps, id: ProjectId): Promise<Response> {
  const r = await deps.service.getProject(id);
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(snapshotToDTO(u.value!)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function updateProject(
  req: Request,
  deps: ProjectRouteDeps,
  id: ProjectId,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(
      400,
      ErrorCode.VALIDATION_FAILED,
      e instanceof Error ? e.message : "invalid request",
    );
  }
  if (!raw || typeof raw !== "object") {
    return err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body");
  }
  const input = raw as Partial<UpdateProjectInput>;
  const serviceInput: {
    name?: string;
    clientName?: string;
    clientWebsite?: string | null;
    clientIntro?: string | null;
    projectIntro?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  } = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length === 0) {
      return err(400, ErrorCode.VALIDATION_FAILED, "name must be a non-empty string");
    }
    serviceInput.name = input.name;
  }
  if (input.clientName !== undefined) {
    if (typeof input.clientName !== "string" || input.clientName.length === 0) {
      return err(400, ErrorCode.VALIDATION_FAILED, "clientName must be a non-empty string");
    }
    serviceInput.clientName = input.clientName;
  }
  if (input.clientWebsite !== undefined) {
    if (input.clientWebsite !== null && typeof input.clientWebsite !== "string") {
      return err(400, ErrorCode.VALIDATION_FAILED, "clientWebsite must be a string or null");
    }
    serviceInput.clientWebsite = input.clientWebsite;
  }
  if (input.clientIntro !== undefined) {
    if (input.clientIntro !== null && typeof input.clientIntro !== "string") {
      return err(400, ErrorCode.VALIDATION_FAILED, "clientIntro must be a string or null");
    }
    serviceInput.clientIntro = input.clientIntro;
  }
  if (input.projectIntro !== undefined) {
    if (input.projectIntro !== null && typeof input.projectIntro !== "string") {
      return err(400, ErrorCode.VALIDATION_FAILED, "projectIntro must be a string or null");
    }
    serviceInput.projectIntro = input.projectIntro;
  }
  // 日期字段：null 表示清空；string 表示写入；undefined 表示不修改
  const startR = parseOptionalIsoDate(input.startDate, "startDate");
  if (startR.error) return startR.error;
  if (input.startDate !== undefined) serviceInput.startDate = startR.value;
  const endR = parseOptionalIsoDate(input.endDate, "endDate");
  if (endR.error) return endR.error;
  if (input.endDate !== undefined) serviceInput.endDate = endR.value;
  // 至少要有一个字段
  if (Object.keys(serviceInput).length === 0) {
    return err(400, ErrorCode.VALIDATION_FAILED, "no fields to update");
  }
  const r = await deps.service.updateProjectProfile(id, serviceInput);
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(snapshotToDTO(u.value!)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function changeStatus(
  req: Request,
  deps: ProjectRouteDeps,
  id: ProjectId,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(
      400,
      ErrorCode.VALIDATION_FAILED,
      e instanceof Error ? e.message : "invalid request",
    );
  }
  if (!raw || typeof raw !== "object") {
    return err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body");
  }
  const input = raw as { target?: string; reason?: string };
  if (typeof input.target !== "string") {
    return err(400, ErrorCode.VALIDATION_FAILED, "target is required");
  }
  const r = await deps.service.changeProjectStatus(
    id,
    input.target as ProjectStatusValue,
    input.reason ? { reason: input.reason } : undefined,
  );
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(snapshotToDTO(u.value!)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function deleteProject(deps: ProjectRouteDeps, id: ProjectId): Promise<Response> {
  const r = await deps.service.deleteProject(id);
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(null, { status: 204 });
}

/**
 * 解析创建场景下的 ISO 日期（必填型 —— 未传或空字符串视为 undefined）。
 * 返回 { value?: Date; error?: Response }：
 *   - value: undefined 表示未提供（不应写入 serviceInput）
 *   - value: Date 表示合法日期
 *   - error: Response 表示返回 400
 */
function parseIsoDate(
  raw: unknown,
  field: string,
): { value?: Date; error?: Response } {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  if (typeof raw !== "string") {
    return {
      error: err(400, ErrorCode.VALIDATION_FAILED, `${field} must be a string in ISO format`),
    };
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return {
      error: err(400, ErrorCode.VALIDATION_FAILED, `${field} is not a valid ISO date: ${raw}`),
    };
  }
  return { value: d };
}

/**
 * 解析更新场景下的可选 ISO 日期：null = 清空；undefined = 不修改；
 * string = 写入。返回 { value: Date | null | undefined, error?: Response }。
 */
function parseOptionalIsoDate(
  raw: unknown,
  field: string,
): { value: Date | null | undefined; error?: Response } {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  if (typeof raw !== "string") {
    return {
      value: undefined,
      error: err(400, ErrorCode.VALIDATION_FAILED, `${field} must be a string or null`),
    };
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return {
      value: undefined,
      error: err(400, ErrorCode.VALIDATION_FAILED, `${field} is not a valid ISO date: ${raw}`),
    };
  }
  return { value: d };
}
