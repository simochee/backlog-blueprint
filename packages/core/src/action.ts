import { type Op, type Phase, type ResourceKind } from "./resource";
import { type IdOrRef, type ResolvedValue, type Value } from "./value";

export type ActionId = string;

type HttpRequestOf<ParamValue> = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  params: Record<string, ParamValue>;
};

export type HttpRequest = HttpRequestOf<Value>;

/**
 * Secret を剥がした型にしない。§2.4 が `reveal()` を呼ぶのは HTTP 送信の直前だけと
 * 定めており、直前にあたるのは本文を組み立てる層である。ここで実値にすると、
 * Executor から送信層までの区間を生値が裸で流れ、その区間の例外やログに載る。
 */
export type ResolvedHttpRequest = HttpRequestOf<ResolvedValue>;

export type Change = { field: string; before: Value | null; after: Value | null };

export type Note = { type: "renamed"; from: string };

export type ProvidedRef = { kind: ResourceKind; name: string };

export type Action = {
  id: ActionId;
  phase: Phase;
  kind: ResourceKind;
  op: Op;
  name: string;
  target?: IdOrRef;
  request?: HttpRequest;
  provides?: ProvidedRef[];
  changes?: Change[];
  notes?: Note[];
  writeRequest: boolean;
};
