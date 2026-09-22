export type SchemaNode = Record<string, unknown>;

/**
 * `$${NAME}` は参照として数えない。core の展開ではリテラルになる書き方なので、
 * これを受け付けるとエディタだけが制約を免除することになる。
 */
const ENV_REFERENCE = {
  type: "string",
  pattern: String.raw`(?:^|[^$])\$\{[^}]+\}`,
};

const SCALAR_KEYWORDS = ["pattern", "enum", "const"];

const NON_STRING_SCALAR_TYPES = new Set(["boolean", "number", "integer"]);

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const branchesOf = (node: SchemaNode): unknown[] => [
  ...(Array.isArray(node.anyOf) ? node.anyOf : []),
  ...(Array.isArray(node.oneOf) ? node.oneOf : []),
];

const judgedBeforeExpansion = (node: SchemaNode): boolean => {
  if (SCALAR_KEYWORDS.some((keyword) => keyword in node)) {
    return true;
  }

  if (typeof node.type === "string" && NON_STRING_SCALAR_TYPES.has(node.type)) {
    return true;
  }

  const branches = branchesOf(node);

  return (
    branches.length > 0 &&
    branches.every((branch) => isNode(branch) && judgedBeforeExpansion(branch))
  );
};

const SUBSCHEMA_KEYWORDS = new Set(["items", "then"]);

const SUBSCHEMA_LIST_KEYWORDS = new Set(["anyOf", "oneOf", "allOf"]);

const relaxSubschemas = (keyword: string, child: unknown): unknown => {
  if (keyword === "properties" && isNode(child)) {
    return Object.fromEntries(Object.entries(child).map(([key, node]) => [key, relax(node)]));
  }
  if (SUBSCHEMA_KEYWORDS.has(keyword)) {
    return relax(child);
  }
  if (SUBSCHEMA_LIST_KEYWORDS.has(keyword) && Array.isArray(child)) {
    return child.map(relax);
  }

  return child;
};

/**
 * スカラーの union は枝ごとに包まず、ノードごと1回だけ包む（E-9）。`oneOf` の各枝に
 * 参照を足すと、`${NAME}` がすべての枝に一致して `oneOf` が必ず失敗する。
 * `if` は判別であって制約ではないので包まない。
 */
const relax = (value: unknown): unknown => {
  if (!isNode(value)) {
    return value;
  }

  if (judgedBeforeExpansion(value)) {
    return {
      ...(value.description === undefined ? {} : { description: value.description }),
      anyOf: [value, ENV_REFERENCE],
    };
  }

  return Object.fromEntries(
    Object.entries(value).map(([keyword, child]) => [keyword, relaxSubschemas(keyword, child)]),
  );
};

/**
 * 実行時のスキーマはこの変換を通さない。core は展開後の値を検証するので、そこに
 * 参照が残っていれば `$${NAME}` のリテラルであり、制約どおりに判定されるべき値である。
 */
export const acceptEnvReferences = (schema: object): SchemaNode => {
  const relaxed = relax(schema);

  return isNode(relaxed) ? relaxed : {};
};
