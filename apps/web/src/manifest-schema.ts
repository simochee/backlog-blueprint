import { projectSchema, isEnvReferenceBranch } from "@backlog-blueprint/schema";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { linter } from "@codemirror/lint";
import { type Extension } from "@codemirror/state";
import { hoverTooltip, type EditorView } from "@codemirror/view";
import { handleRefresh, JSONValidation, stateExtensions } from "codemirror-json-schema";
import {
  parseYAMLDocumentState,
  yamlCompletion,
  yamlSchemaHover,
} from "codemirror-json-schema/yaml";

/**
 * スキーマは走っているコードからその場で渡す。公開 URL を読ませると版がずれうるし、
 * 開くたびに通信が要る。`codemirror-json-schema` は draft-07 の型で受けるので、
 * 型の口だけ合わせる（中身は同じ JSON Schema の構造である）。
 */
const SCHEMA = projectSchema(__SCHEMA_VERSION__) as Parameters<typeof stateExtensions>[0];

type SchemaError = {
  code: string;
  data?: { anyOf?: unknown; errors?: SchemaError[]; pointer?: string; value?: unknown };
};

type ValidationInternals = {
  rewriteError: (error: SchemaError) => string;
  schema: {
    validate: (value: unknown, schema: unknown, pointer?: string) => SchemaError[];
  } | null;
};

type SchemaNode = { anyOf?: unknown };

/**
 * 残った枝のうち最後のものを選ぶ。json-schema-library は `then` の `anyOf` を元の `anyOf` の
 * 後ろに連結するので、最後の枝がその位置でいちばん具体的な制約になる（数値型の `min` なら
 * 数値・日付の和ではなく数値）。
 */
const constraintOf = (branches: unknown[]): unknown => {
  const constraint = branches.filter((branch) => !isEnvReferenceBranch(branch)).at(-1);
  const nested = (constraint as SchemaNode | undefined)?.anyOf;

  return Array.isArray(nested) ? constraintOf(nested) : constraint;
};

/**
 * `JSONValidation` の非公開メンバーを差し替える。公開されている `formatError` は型に
 * あるだけで 0.8 の実装から呼ばれない。参照の枝を足した `anyOf` の違反は、そのままだと
 * 枝の配列を JSON で並べた1文になり、元のノードが言えた「10色のどれか」が読めなくなる（E-9）。
 * `oneOf` の違反は枝ごとの違反を並べて文にするので、その中身も同じように置き換える。
 */
export const manifestLinter = (): ((
  view: EditorView,
) => ReturnType<JSONValidation["doValidation"]>) => {
  const validation = new JSONValidation({ jsonParser: parseYAMLDocumentState, mode: "yaml" });
  const internals = validation as unknown as ValidationInternals;
  const rewrite = internals.rewriteError;

  const causeOf = (error: SchemaError): SchemaError => {
    const branches = error.data?.anyOf;

    if (
      error.code !== "any-of-error" ||
      !Array.isArray(branches) ||
      !branches.some(isEnvReferenceBranch)
    ) {
      return error;
    }

    const [cause] =
      internals.schema?.validate(error.data?.value, constraintOf(branches), error.data?.pointer) ??
      [];

    return cause ?? error;
  };

  internals.rewriteError = (error) => {
    const nested = error.data?.errors;

    if (error.code === "one-of-error" && Array.isArray(nested)) {
      return rewrite({ ...error, data: { ...error.data, errors: nested.map(causeOf) } });
    }

    return rewrite(causeOf(error));
  };

  return (view) => validation.doValidation(view);
};

/**
 * `yamlSchema()` の束を使わずに組み直す。束は linter を内部で作るので、上の差し替えを
 * 挟む口が無い。中身は束と同じ5つである。
 */
export const manifestSchemaExtensions = (): Extension[] => [
  yaml(),
  linter(manifestLinter(), { needsRefresh: handleRefresh }),
  yamlLanguage.data.of({ autocomplete: yamlCompletion() }),
  hoverTooltip(yamlSchemaHover()),
  stateExtensions(SCHEMA),
];
