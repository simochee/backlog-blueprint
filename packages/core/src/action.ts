import { type Op, type Phase, type ResourceKind } from "./resource";
import { sameValue, type IdOrRef, type ResolvedValue, type Value } from "./value";

export type ActionId = string;

type HttpRequestOf<ParamValue> = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  params: Record<string, ParamValue>;
};

export type HttpRequest = HttpRequestOf<Value>;

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

/**
 * 書かれていないキーを比較にも送信にも載せない。書いていない値をツールの既定で
 * 上書きする（K-3）。
 */
export const declaredOnly = (fields: Record<string, Value | undefined>): Record<string, Value> =>
  Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, Value] => entry[1] !== undefined),
  );

/** 値が変わらない項目も落とさない。`request.params` と突き合わせられなくなる（PO-11）。 */
export const fieldChanges = (
  declared: Record<string, Value>,
  before: Record<string, Value | undefined>,
): Change[] =>
  Object.entries(declared).map(([field, after]) => ({
    field,
    before: before[field] ?? null,
    after,
  }));

export const differs = (changes: Change[]): boolean =>
  changes.some(({ before, after }) => !sameValue(before, after));

export const paramsOf = (changes: Change[]): Record<string, Value> =>
  Object.fromEntries(changes.map(({ field, after }) => [field, after]));

/** `refresh` を GET だからと落とさない。進捗の分母にも中断レポートにも数える（§6.1）。 */
export const executedActions = (actions: Action[]): Action[] =>
  actions.filter(({ op }) => op !== "noop");
