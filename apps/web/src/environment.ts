import {
  childPath,
  ROOT_PATH,
  UNRESOLVED_ENV_ID,
  type Diagnostic,
  type ParsedDocument,
  type SourceMap,
} from "@backlog-blueprint/core";

type EnvironmentReference = { name: string; path: string };

/**
 * `$${NAME}` を参照として数えない。core の展開（S2）が literal として扱う書き方なので、
 * 拾うと値を求める入力欄だけが増える。
 */
const REFERENCE_PATTERN = /\$\$\{[^}]*\}|\$\{([^}]+)\}/g;

const namesIn = (value: string): string[] =>
  [...value.matchAll(REFERENCE_PATTERN)].flatMap(([, name]) => (name === undefined ? [] : [name]));

export const environmentReferences = ({ value }: ParsedDocument): EnvironmentReference[] => {
  const found: EnvironmentReference[] = [];

  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      found.push(...namesIn(node).map((name) => ({ name, path })));

      return;
    }

    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, childPath(path, index));
      }

      return;
    }

    if (typeof node === "object" && node !== null) {
      for (const [key, item] of Object.entries(node)) {
        walk(item, childPath(path, key));
      }
    }
  };

  walk(value, ROOT_PATH);

  return found;
};

export const referencedNames = (references: EnvironmentReference[]): string[] => [
  ...new Set(references.map(({ name }) => name)),
];

/** core の「環境変数が未定義」を出さない。ブラウザに環境変数は無く、正しくない説明になる（V-A4） */
export const missingValueDiagnostics = (
  references: EnvironmentReference[],
  source: SourceMap,
  isEntered: (name: string) => boolean,
): Diagnostic[] =>
  references
    .filter(({ name }) => !isEntered(name))
    .map(({ name, path }) => ({
      id: UNRESOLVED_ENV_ID,
      severity: "error",
      stage: "expand",
      path,
      ...source.positionAt(path),
      message: `value is not entered: ${name}`,
      hint: `enter a value for ${name} in the environment values panel`,
    }));
