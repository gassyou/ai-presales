/**
 * QuoteStorage —— 报价单 .xlsx + 模板的磁盘抽象
 *
 * 阶段 7.4f。
 *
 * 目录布局：
 *   - <dataRoot>/templates/quote-default.xlsx —— App 内置默认模板（启动期确保存在）
 *   - <dataRoot>/projects/<pid>/quote-templates/<safe>.xlsx —— 项目上传的定制模板
 *   - <dataRoot>/projects/<pid>/quotes/<runId>/quote.xlsx —— 生成产物
 *
 * 路径安全：所有路径绝对且在 dataRoot 下；调用方拿到的是绝对路径。
 */

import { join } from "@std/path";
import { ensureDir } from "@backend/infrastructure/platform/paths.ts";

export interface QuoteStorage {
  /** 启动期确保内置默认模板存在；返回其绝对路径 */
  ensureDefaultTemplate(bytes: Uint8Array): Promise<string>;
  /** 内置默认模板绝对路径（不创建） */
  defaultTemplatePath(): string;

  /** 项目模板路径（不创建） */
  projectTemplatePath(projectId: string, safeFilename: string): string;
  /** 项目模板目录（自动 mkdir） */
  projectTemplateDir(projectId: string): Promise<string>;
  /** 写项目模板字节流 */
  writeTemplate(absolutePath: string, bytes: Uint8Array): Promise<void>;
  /** 读模板字节流 */
  readTemplate(absolutePath: string): Promise<Uint8Array>;

  /** 生成产物路径（不创建） */
  outputPath(projectId: string, runId: string): string;
  /** 写产物字节流 */
  writeOutput(absolutePath: string, bytes: Uint8Array): Promise<void>;
  /** 读产物字节流 */
  readOutput(absolutePath: string): Promise<Uint8Array>;
}

export class FilesystemQuoteStorage implements QuoteStorage {
  constructor(private readonly dataRoot: string) {}

  defaultTemplatePath(): string {
    return join(this.dataRoot, "templates", "quote-default.xlsx");
  }

  async ensureDefaultTemplate(bytes: Uint8Array): Promise<string> {
    const dir = join(this.dataRoot, "templates");
    await ensureDir(dir);
    const path = this.defaultTemplatePath();
    try {
      await Deno.stat(path);
    } catch {
      // 不存在则写入
      await Deno.writeFile(path, bytes);
    }
    return path;
  }

  projectTemplateDir(projectId: string): Promise<string> {
    const dir = join(this.dataRoot, "projects", projectId, "quote-templates");
    return ensureDir(dir).then(() => dir);
  }

  projectTemplatePath(projectId: string, safeFilename: string): string {
    return join(this.dataRoot, "projects", projectId, "quote-templates", safeFilename);
  }

  async writeTemplate(absolutePath: string, bytes: Uint8Array): Promise<void> {
    await ensureDir(this.dirname(absolutePath));
    await Deno.writeFile(absolutePath, bytes);
  }

  async readTemplate(absolutePath: string): Promise<Uint8Array> {
    return await Deno.readFile(absolutePath);
  }

  outputPath(projectId: string, runId: string): string {
    return join(this.dataRoot, "projects", projectId, "quotes", runId, "quote.xlsx");
  }

  async writeOutput(absolutePath: string, bytes: Uint8Array): Promise<void> {
    await ensureDir(this.dirname(absolutePath));
    await Deno.writeFile(absolutePath, bytes);
  }

  async readOutput(absolutePath: string): Promise<Uint8Array> {
    return await Deno.readFile(absolutePath);
  }

  private dirname(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx) : ".";
  }
}