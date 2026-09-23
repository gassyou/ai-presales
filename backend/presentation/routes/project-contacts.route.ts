/**
 * 项目联系人 / 团队成员路由
 *
 * 阶段 7.4e。
 *
 * 端点：
 *   GET    /api/projects/:id/contacts          列表（按 isPrimary DESC, created_at ASC）
 *   POST   /api/projects/:id/contacts          body: { name, title?, email?, phone?, isPrimary? }
 *   GET    /api/projects/:id/contacts/:cid
 *   PATCH  /api/projects/:id/contacts/:cid     body: { name?, ... }
 *   DELETE /api/projects/:id/contacts/:cid
 *
 *   GET    /api/projects/:id/team-members
 *   POST   /api/projects/:id/team-members      body: { name, email?, phone? }
 *   GET    /api/projects/:id/team-members/:mid
 *   PATCH  /api/projects/:id/team-members/:mid body: { name?, ... }
 *   DELETE /api/projects/:id/team-members/:mid
 *
 * 错误统一 ErrorEnvelope（presentation 层做映射）。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type {
  DomainErrorCode,
  DomainResult,
} from "@backend/domain/shared/result.ts";
import type { ErrorEnvelope, ErrorCodeValue } from "@shared/types/common.ts";
import { ErrorCode } from "@shared/types/common.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { IProjectContactsRepository } from "@backend/domain/project/project-contacts.repository.ts";
import type { IProjectTeamMembersRepository } from "@backend/domain/project/project-team-members.repository.ts";
import type {
  ProjectContactSnapshot,
} from "@backend/domain/project/project-contacts.ts";
import type {
  TeamMemberSnapshot,
} from "@backend/domain/project/project-team-members.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import {
  validateContactInput,
} from "@backend/domain/project/project-contacts.ts";
import {
  validateTeamMemberInput,
} from "@backend/domain/project/project-team-members.ts";

export interface ProjectContactsRouteDeps {
  logger: Logger;
  contactsRepo: IProjectContactsRepository;
  teamRepo: IProjectTeamMembersRepository;
  clock?: Clock;
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
    case "INTERNAL":
      return { status: 500, code: ErrorCode.INTERNAL };
  }
}

function unwrap<T>(r: DomainResult<T>): { value?: T; response?: Response } {
  if (r.ok) return { value: r.value };
  const m = mapDomainError(r.error.code);
  return { response: err(m.status, m.code, r.error.message, r.error.details) };
}

function contactToDTO(s: ProjectContactSnapshot) {
  return {
    id: s.id,
    name: s.name,
    title: s.title || undefined,
    email: s.email || undefined,
    phone: s.phone || undefined,
    isPrimary: s.isPrimary,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function memberToDTO(s: TeamMemberSnapshot) {
  return {
    id: s.id,
    name: s.name,
    email: s.email || undefined,
    phone: s.phone || undefined,
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

export async function handleProjectContacts(
  req: Request,
  deps: ProjectContactsRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const clock = deps.clock ?? new SystemClock();

  // /api/projects/:id/contacts
  const contactsList = path.match(/^\/api\/projects\/([0-9a-fA-F-]{36})\/contacts$/);
  if (contactsList) {
    const pid = toProjectId(contactsList[1]);
    if (method === "GET") return listContacts(deps, pid);
    if (method === "POST") return createContact(req, deps, pid, clock);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  // /api/projects/:id/contacts/:cid
  const contactOne = path.match(/^\/api\/projects\/([0-9a-fA-F-]{36})\/contacts\/([0-9a-fA-F-]{36})$/);
  if (contactOne) {
    const cid = contactOne[2];
    if (method === "GET") return getContact(deps, cid);
    if (method === "PATCH") return updateContact(req, deps, cid, clock);
    if (method === "DELETE") return deleteContact(deps, cid);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  // /api/projects/:id/team-members
  const teamList = path.match(/^\/api\/projects\/([0-9a-fA-F-]{36})\/team-members$/);
  if (teamList) {
    const pid = toProjectId(teamList[1]);
    if (method === "GET") return listMembers(deps, pid);
    if (method === "POST") return createMember(req, deps, pid, clock);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  // /api/projects/:id/team-members/:mid
  const memberOne = path.match(/^\/api\/projects\/([0-9a-fA-F-]{36})\/team-members\/([0-9a-fA-F-]{36})$/);
  if (memberOne) {
    const mid = memberOne[2];
    if (method === "GET") return getMember(deps, mid);
    if (method === "PATCH") return updateMember(req, deps, mid, clock);
    if (method === "DELETE") return deleteMember(deps, mid);
    return err(405, ErrorCode.INTERNAL, `method ${method} not allowed`);
  }

  return err(404, ErrorCode.NOT_FOUND, `route ${path} not found`);
}

// ---------- contacts ----------

async function listContacts(deps: ProjectContactsRouteDeps, pid: ProjectId): Promise<Response> {
  const items = await deps.contactsRepo.listByProject(pid);
  return new Response(JSON.stringify({ items: items.map(contactToDTO) }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function createContact(
  req: Request,
  deps: ProjectContactsRouteDeps,
  pid: ProjectId,
  clock: Clock,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "invalid request");
  }
  const input = (raw ?? {}) as { name?: string; title?: string; email?: string; phone?: string; isPrimary?: boolean };
  const v = validateContactInput(input);
  if (v !== null) return err(400, ErrorCode.VALIDATION_FAILED, v);
  const r = await deps.contactsRepo.create({
    projectId: pid,
    name: input.name!.trim(),
    title: input.title,
    email: input.email,
    phone: input.phone,
    isPrimary: input.isPrimary,
    createdAt: clock.now(),
  });
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(contactToDTO(u.value!)), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getContact(deps: ProjectContactsRouteDeps, id: string): Promise<Response> {
  const snap = await deps.contactsRepo.findById(id);
  if (!snap) return err(404, ErrorCode.NOT_FOUND, `contact ${id} not found`);
  return new Response(JSON.stringify(contactToDTO(snap)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function updateContact(
  req: Request,
  deps: ProjectContactsRouteDeps,
  id: string,
  clock: Clock,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "invalid request");
  }
  const input = (raw ?? {}) as { name?: string; title?: string; email?: string; phone?: string; isPrimary?: boolean };
  // PATCH：按字段独立校验（不强制所有字段都存在）
  if (input.name !== undefined && input.name.trim().length === 0) {
    return err(400, ErrorCode.VALIDATION_FAILED, "name cannot be empty");
  }
  if (input.name !== undefined && input.name.length > 100) {
    return err(400, ErrorCode.VALIDATION_FAILED, "name too long (max 100)");
  }
  if (input.email !== undefined && input.email.length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      return err(400, ErrorCode.VALIDATION_FAILED, `invalid email: ${input.email}`);
    }
  }
  const r = await deps.contactsRepo.update(id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
  }, clock.now());
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(contactToDTO(u.value!)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function deleteContact(deps: ProjectContactsRouteDeps, id: string): Promise<Response> {
  const r = await deps.contactsRepo.delete(id);
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(null, { status: 204 });
}

// ---------- team members ----------

async function listMembers(deps: ProjectContactsRouteDeps, pid: ProjectId): Promise<Response> {
  const items = await deps.teamRepo.listByProject(pid);
  return new Response(JSON.stringify({ items: items.map(memberToDTO) }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function createMember(
  req: Request,
  deps: ProjectContactsRouteDeps,
  pid: ProjectId,
  clock: Clock,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "invalid request");
  }
  const input = (raw ?? {}) as { name?: string; email?: string; phone?: string };
  const v = validateTeamMemberInput(input);
  if (v !== null) return err(400, ErrorCode.VALIDATION_FAILED, v);
  const r = await deps.teamRepo.create({
    projectId: pid,
    name: input.name!.trim(),
    email: input.email,
    phone: input.phone,
    createdAt: clock.now(),
  });
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(memberToDTO(u.value!)), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getMember(deps: ProjectContactsRouteDeps, id: string): Promise<Response> {
  const snap = await deps.teamRepo.findById(id);
  if (!snap) return err(404, ErrorCode.NOT_FOUND, `team member ${id} not found`);
  return new Response(JSON.stringify(memberToDTO(snap)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function updateMember(
  req: Request,
  deps: ProjectContactsRouteDeps,
  id: string,
  clock: Clock,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "invalid request");
  }
  const input = (raw ?? {}) as { name?: string; email?: string; phone?: string };
  if (input.name !== undefined && input.name.trim().length === 0) {
    return err(400, ErrorCode.VALIDATION_FAILED, "name cannot be empty");
  }
  if (input.name !== undefined && input.name.length > 100) {
    return err(400, ErrorCode.VALIDATION_FAILED, "name too long (max 100)");
  }
  if (input.email !== undefined && input.email.length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      return err(400, ErrorCode.VALIDATION_FAILED, `invalid email: ${input.email}`);
    }
  }
  const r = await deps.teamRepo.update(id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  }, clock.now());
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(memberToDTO(u.value!)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function deleteMember(deps: ProjectContactsRouteDeps, id: string): Promise<Response> {
  const r = await deps.teamRepo.delete(id);
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(null, { status: 204 });
}