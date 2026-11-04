/**
 * 源码读取助手 —— 供"扫描源码文本做断言"的单元测试使用。
 *
 * 为什么统一行尾：
 *   这类测试用正则匹配实现源码（例如 /\n  \}\n\}/），如果工作区是 CRLF
 *   （开发者本机 core.autocrlf=true 时就会这样），正则匹配不到，
 *   测试结果取决于开发者的 git 配置而不是代码本身。
 *   统一成 LF 后，断言结果只取决于代码。
 *
 * 约定：rel 是相对仓库根的路径（Deno.cwd() 即仓库根）。
 */

import { join } from "@std/path";

/** 读仓库内相对路径的源码文件，行尾统一为 LF。 */
export function readText(rel: string): string {
  return Deno.readTextFileSync(join(Deno.cwd(), rel)).replace(/\r\n/g, "\n");
}
