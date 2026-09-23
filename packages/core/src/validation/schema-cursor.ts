type SchemaNode = Record<string, unknown>;

/**
 * 枝を1つに絞らない。どの `anyOf` / `oneOf` の枝や `then` が効くかは値を検証しないと決まらず、
 * 展開はスキーマ検証（S3）より前に走る。
 */
export type SchemaCursor = readonly SchemaNode[];

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodesIn = (value: unknown): SchemaNode[] =>
  Array.isArray(value) ? value.filter(isNode) : [];

/**
 * `if` はたどらない（E-10）。`if` は枝を選ぶための条件で、その位置に書ける値を述べていない。
 * 今の `if` は `type` を持たないので結果は同じだが、`if` に型を書いた時点で判別条件が
 * 変換の根拠に紛れ込む。
 */
const alternativesOf = (node: SchemaNode): SchemaNode[] => [
  node,
  ...[...nodesIn(node.anyOf), ...nodesIn(node.oneOf)].flatMap(alternativesOf),
  ...nodesIn(node.allOf)
    .flatMap(({ then }) => (isNode(then) ? [then] : []))
    .flatMap(alternativesOf),
];

export const schemaCursor = (schema: unknown): SchemaCursor => (isNode(schema) ? [schema] : []);

const childOf = (node: SchemaNode, segment: string | number): unknown => {
  if (typeof segment === "number") {
    return node.items;
  }

  return isNode(node.properties) ? node.properties[segment] : undefined;
};

export const descend = (cursor: SchemaCursor, segment: string | number): SchemaCursor =>
  cursor
    .flatMap(alternativesOf)
    .map((node) => childOf(node, segment))
    .filter(isNode);

export const admittedTypes = (cursor: SchemaCursor): Set<string> =>
  new Set(
    cursor
      .flatMap(alternativesOf)
      .flatMap(({ type }) => (Array.isArray(type) ? type : [type]))
      .filter((type): type is string => typeof type === "string"),
  );
