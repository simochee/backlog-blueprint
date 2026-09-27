import { type ResourceKind } from "./resource";

export type Ref = { $ref: { kind: ResourceKind; name: string } };

export type Value = string | number | boolean | null | Ref | Value[];

export type ResolvedValue = string | number | boolean | null | ResolvedValue[];

export type IdOrRef = number | Ref;

export const isRef = (value: Value): value is Ref =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "$ref" in value;

export const sameValue = (
  left: Value | null | undefined,
  right: Value | null | undefined,
): boolean => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }

  if (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    isRef(left) &&
    isRef(right)
  ) {
    return left.$ref.kind === right.$ref.kind && left.$ref.name === right.$ref.name;
  }

  return (left ?? null) === (right ?? null);
};
