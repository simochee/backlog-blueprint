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
 * 公開 URL を読ませない。版がずれうるし、開くたびに通信が要る。`as` は
 * `codemirror-json-schema` が draft-07 の型で受けるためで、中身は同じ構造である。
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
 * 最初の枝を選ばない。json-schema-library は `then` の `anyOf` を元の `anyOf` の後ろに
 * 連結するので、最後の枝がその位置でいちばん具体的な制約になる。
 */
const constraintOf = (branches: unknown[]): unknown => {
  const constraint = branches.filter((branch) => !isEnvReferenceBranch(branch)).at(-1);
  const nested = (constraint as SchemaNode | undefined)?.anyOf;

  return Array.isArray(nested) ? constraintOf(nested) : constraint;
};

/**
 * 公開の `formatError` ではなく非公開メンバーを差し替える。`formatError` は型にあるだけで
 * 0.8 の実装から呼ばれない。差し替えないと、参照の枝を足した `anyOf` の違反が枝の配列を
 * JSON で並べた1文になり、「10色のどれか」が読めなくなる（E-9）。
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
