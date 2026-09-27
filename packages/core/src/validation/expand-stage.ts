import { type Diagnostic } from "../diagnostic";
import { ManifestSchema } from "../manifest";
import { ROOT_PATH, childPath, type ParsedDocument } from "./source-map";

export const UNRESOLVED_ENV_ID = "V-A4";

const SENTINEL_PREFIX = "\0unresolved-env:";

const SENTINEL_SUFFIX = "\0";

/**
 * 空文字や名前そのもので置き換えない（VG-3）。空文字は `minLength` に、名前は重複や参照の
 * 判定に紛れ込み、環境変数が足りないだけの利用者に S3 / S4 の嘘の違反を見せる。
 */
const envSentinel = (name: string): string => `${SENTINEL_PREFIX}${name}${SENTINEL_SUFFIX}`;

export const hasEnvSentinel = (value: unknown): boolean =>
  typeof value === "string" && value.includes(SENTINEL_PREFIX);

/**
 * 正規表現そのものを共有しない（EX-5 と共用）。`g` 付きの `RegExp` は `lastIndex` を持ち、
 * `exec` / `test` と混ざると2回目の呼び出しだけ結果が変わる。
 */
export const envReferencePattern = (): RegExp => /\$\$\{([^}]+)\}|\$\{([^}]+)\}/g;

export type Environment = Record<string, string | undefined>;

type StringExpansion = { text: string; unresolved: string[] };

const expandString = (value: string, env: Environment): StringExpansion => {
  const unresolved = new Set<string>();

  const text = value.replaceAll(
    envReferencePattern(),
    (match: string, escaped: string | undefined, name: string | undefined) => {
      if (escaped !== undefined) {
        return `\${${escaped}}`;
      }

      if (name === undefined) {
        return match;
      }

      const resolved = env[name];

      if (resolved === undefined) {
        unresolved.add(name);

        return envSentinel(name);
      }

      return resolved;
    },
  );

  return { text, unresolved: [...unresolved] };
};

type SchemaNode = Record<string, unknown>;

/**
 * 枝を1つに絞らない。どの `anyOf` / `oneOf` の枝や `then` が効くかは値を検証しないと決まらず、
 * 展開はスキーマ検証（S3）より前に走る。
 */
type SchemaCursor = readonly SchemaNode[];

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodesIn = (value: unknown): SchemaNode[] =>
  Array.isArray(value) ? value.filter(isNode) : [];

/**
 * `if` はたどらない（E-10）。枝を選ぶ条件で、その位置に書ける値を述べていない。`if` に型を
 * 書いた時点で、判別条件が変換の根拠に紛れ込む。
 */
const alternativesOf = (node: SchemaNode): SchemaNode[] => [
  node,
  ...[...nodesIn(node.anyOf), ...nodesIn(node.oneOf)].flatMap(alternativesOf),
  ...nodesIn(node.allOf)
    .flatMap(({ then }) => (isNode(then) ? [then] : []))
    .flatMap(alternativesOf),
];

const schemaCursor = (schema: unknown): SchemaCursor => (isNode(schema) ? [schema] : []);

const childOf = (node: SchemaNode, segment: string | number): unknown => {
  if (typeof segment === "number") {
    return node.items;
  }

  return isNode(node.properties) ? node.properties[segment] : undefined;
};

const descend = (cursor: SchemaCursor, segment: string | number): SchemaCursor =>
  cursor
    .flatMap(alternativesOf)
    .map((node) => childOf(node, segment))
    .filter(isNode);

const admittedTypes = (cursor: SchemaCursor): Set<string> =>
  new Set(
    cursor
      .flatMap(alternativesOf)
      .flatMap(({ type }) => (Array.isArray(type) ? type : [type]))
      .filter((type): type is string => typeof type === "string"),
  );

const WHOLE_REFERENCE = /^\$\{[^}]+\}$/;

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * 解決した値を YAML として読み直さない（E-10）。`#e30000` はコメントとして `null` になり、
 * 文字列の欄に渡した `123` まで数値になる。
 */
const coerceWholeReference = (text: string, cursor: SchemaCursor): unknown => {
  const types = admittedTypes(cursor);

  if (types.has("boolean") && (text === "true" || text === "false")) {
    return text === "true";
  }

  if ((types.has("number") || types.has("integer")) && JSON_NUMBER.test(text)) {
    const number = Number(text);

    return Number.isFinite(number) ? number : text;
  }

  return text;
};

export type ExpandStageResult = {
  diagnostics: Diagnostic[];
  parsed: ParsedDocument;
  unresolvedPaths: Set<string>;
};

export type ExpandOptions = { env: Environment; severity: Diagnostic["severity"] };

export const expandEnvironment = (
  parsed: ParsedDocument,
  { env, severity }: ExpandOptions,
): ExpandStageResult => {
  const diagnostics: Diagnostic[] = [];
  const unresolvedPaths = new Set<string>();

  const walk = (value: unknown, path: string, cursor: SchemaCursor): unknown => {
    if (typeof value === "string") {
      const { text, unresolved } = expandString(value, env);

      for (const name of unresolved) {
        unresolvedPaths.add(path);
        diagnostics.push({
          id: UNRESOLVED_ENV_ID,
          severity,
          stage: "expand",
          path,
          ...parsed.source.positionAt(path),
          message: `environment variable is not defined: ${name}`,
          hint: `set ${name} in the environment, or write the value in the manifest. to keep the literal text, write $\${${name}}`,
        });
      }

      return unresolved.length === 0 && WHOLE_REFERENCE.test(value)
        ? coerceWholeReference(text, cursor)
        : text;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, childPath(path, index), descend(cursor, index)));
    }

    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          walk(item, childPath(path, key), descend(cursor, key)),
        ]),
      );
    }

    return value;
  };

  return {
    diagnostics,
    parsed: {
      value: walk(parsed.value, ROOT_PATH, schemaCursor(ManifestSchema)),
      source: parsed.source,
    },
    unresolvedPaths,
  };
};
