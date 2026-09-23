/**
 * ClientName —— 客户名称值对象
 *
 * 规则与 ProjectName 一致（去除首尾空白，1..120 字符）。
 */

import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

const MIN_LEN = 1;
const MAX_LEN = 120;

export class ClientName {
  private readonly trimmed: string;

  private constructor(raw: string) {
    this.trimmed = raw.trim();
  }

  static create(raw: string): DomainResult<ClientName> {
    if (typeof raw !== "string") {
      return domainErr("INVALID_INPUT", "client name must be a string");
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN_LEN) {
      return domainErr("INVALID_INPUT", "client name cannot be empty");
    }
    if (trimmed.length > MAX_LEN) {
      return domainErr(
        "INVALID_INPUT",
        `client name too long (max ${MAX_LEN})`,
        { length: trimmed.length },
      );
    }
    return domainOk(new ClientName(raw));
  }

  get value(): string {
    return this.trimmed;
  }

  equals(other: ClientName): boolean {
    return this.trimmed === other.trimmed;
  }

  toString(): string {
    return this.trimmed;
  }
}