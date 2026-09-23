/**
 * ProjectName —— 项目名称值对象
 *
 * 规则：
 *   - 长度 1..120
 *   - 去除首尾空白后非空
 *   - 不允许全空白 / 控制字符
 */

import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

const MIN_LEN = 1;
const MAX_LEN = 120;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export class ProjectName {
  private readonly raw: string;
  private readonly trimmed: string;

  private constructor(raw: string) {
    this.raw = raw;
    this.trimmed = raw.trim();
  }

  static create(raw: string): DomainResult<ProjectName> {
    if (typeof raw !== "string") {
      return domainErr("INVALID_INPUT", "project name must be a string");
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN_LEN) {
      return domainErr("INVALID_INPUT", "project name cannot be empty");
    }
    if (trimmed.length > MAX_LEN) {
      return domainErr(
        "INVALID_INPUT",
        `project name too long (max ${MAX_LEN})`,
        { length: trimmed.length },
      );
    }
    if (CONTROL_CHARS.test(trimmed)) {
      return domainErr("INVALID_INPUT", "project name contains control characters");
    }
    return domainOk(new ProjectName(raw));
  }

  get value(): string {
    return this.trimmed;
  }

  equals(other: ProjectName): boolean {
    return this.trimmed === other.trimmed;
  }

  toString(): string {
    return this.trimmed;
  }
}