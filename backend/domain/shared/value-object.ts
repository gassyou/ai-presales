/**
 * ValueObject 基类 —— 通过值域相等、不可变原生
 *
 * 使用 class extends + private constructor + 工厂方法，强制构造时校验。
 * 子类需要：
 *   1. protected constructor + 私有字段（readonly）
 *   2. static create(raw: unknown): DomainResult<This>
 *   3. equals(other: This): boolean —— 基于值域
 */

export abstract class ValueObject<T> {
  /** 值域访问器；具体子类按需暴露 getter */
  protected abstract readonly value: T;

  /** 值域相等 —— 必由子类实现 */
  abstract equals(other: this): boolean;

  /** 默认 toString —— 给日志/序列化用 */
  toString(): string {
    return `${this.constructor.name}(${JSON.stringify(this.value)})`;
  }
}