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

type SchemaError = { code: string; data?: { anyOf?: unknown; value?: unknown } };

type ValidationInternals = {
  rewriteError: (error: SchemaError) => string;
  schema: { validate: (value: unknown, schema: unknown) => SchemaError[] } | null;
};

/**
 * `JSONValidation` の非公開メンバーを差し替える。公開されている `formatError` は型に
 * あるだけで 0.8 の実装から呼ばれない。参照の枝を足した `anyOf` の違反は、そのままだと
 * 枝の配列を JSON で並べた1文になり、元のノードが言えた「10色のどれか」が読めなくなる（E-9）。
 */
export const manifestLinter = (): ((
  view: EditorView,
) => ReturnType<JSONValidation["doValidation"]>) => {
  const validation = new JSONValidation({ jsonParser: parseYAMLDocumentState, mode: "yaml" });
  const internals = validation as unknown as ValidationInternals;
  const rewrite = internals.rewriteError;

  internals.rewriteError = (error) => {
    const branches = error.data?.anyOf;

    if (
      error.code === "any-of-error" &&
      Array.isArray(branches) &&
      branches.length === 2 &&
      isEnvReferenceBranch(branches[1])
    ) {
      const [cause] = internals.schema?.validate(error.data?.value, branches[0]) ?? [];

      if (cause !== undefined) {
        return rewrite(cause);
      }
    }

    return rewrite(error);
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
