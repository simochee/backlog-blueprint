type SchemaNode = Record<string, unknown>;

/**
 * 1つの値の位置に当たりうるスキーマのノード。`anyOf` / `oneOf` の枝と `allOf` の
 * `then` はどれが効くかが値によって決まるので、1つに絞らずすべて持ち歩く。
 */
export type SchemaCursor = readonly SchemaNode[];

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodesIn = (value: unknown): SchemaNode[] =>
  Array.isArray(value) ? value.filter(isNode) : [];

/**
 * `if` はたどらない（E-10）。`if` は判別に使う条件であって、その位置の値が取りうる型を
 * 述べていない。`if` の `const: "number"` を拾うと、`type` の欄が数値を受け付けることになる。
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
