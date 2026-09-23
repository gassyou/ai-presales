/**
 * MailStorage —— 邮件附件 / 发送 .eml 的磁盘抽象
 *
 * 阶段 7.4e。
 *
 * 设计：
 *   - `emailRoot(projectId, emailId)` 返回 `<data>/projects/<projectId>/email-attachments/<emailId>/`
 *   - `attachmentPath(emailRoot, safeFilename)` 返回该目录下子文件路径
 *   - `writeEml(projectId, emailId, bytes)` 把已发送邮件写到
 *     `<data>/projects/<projectId>/sent-emails/<emailId>.eml` 并返回绝对路径
 *
 * 路径安全：所有路径都是绝对路径且在 dataDir 下；调用方拿到的是
 * 直接可用的绝对路径（不依赖客户端输入）。
 */

import { join } from "@std/path";
import { ensureDir } from "@backend/infrastructure/platform/paths.ts";

export interface MailStorage {
  /** 邮件附件根目录（自动 mkdir） */
  emailRoot(projectId: string, emailId: string): Promise<string>;
  /** 在 emailRoot 下拼出子文件路径（不创建） */
  attachmentPath(emailRoot: string, safeFilename: string): string;
  /** 写附件字节流 */
  writeAttachment(absolutePath: string, bytes: Uint8Array): Promise<void>;
  /** 读附件字节流 */
  readAttachment(absolutePath: string): Promise<Uint8Array>;
  /** 写已发送邮件 .eml，返回绝对路径 */
  writeEml(projectId: string, emailId: string, bytes: Uint8Array): Promise<string>;
}

export class FilesystemMailStorage implements MailStorage {
  constructor(private readonly dataRoot: string) {}

  async emailRoot(projectId: string, emailId: string): Promise<string> {
    const root = join(this.dataRoot, "projects", projectId, "email-attachments", emailId);
    await ensureDir(root);
    return root;
  }

  attachmentPath(emailRoot: string, safeFilename: string): string {
    return join(emailRoot, safeFilename);
  }

  async writeAttachment(absolutePath: string, bytes: Uint8Array): Promise<void> {
    await ensureDir(this.dirname(absolutePath));
    await Deno.writeFile(absolutePath, bytes);
  }

  async readAttachment(absolutePath: string): Promise<Uint8Array> {
    return await Deno.readFile(absolutePath);
  }

  async writeEml(projectId: string, emailId: string, bytes: Uint8Array): Promise<string> {
    const dir = join(this.dataRoot, "projects", projectId, "sent-emails");
    await ensureDir(dir);
    const path = join(dir, `${emailId}.eml`);
    await Deno.writeFile(path, bytes);
    return path;
  }

  private dirname(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx) : ".";
  }
}