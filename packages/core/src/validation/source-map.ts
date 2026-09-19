export type SourcePosition = { line: number; column: number };

export type SourceMap = {
  positionAt: (path: string) => SourcePosition;
  isEmptySource: (path: string) => boolean;
};

export type ParsedDocument = { value: unknown; source: SourceMap };

export const ROOT_PATH = "";

export const childPath = (parent: string, segment: string | number): string =>
  parent === ROOT_PATH ? String(segment) : `${parent}/${segment}`;

export const parentPath = (path: string): string => {
  const separator = path.lastIndexOf("/");

  return separator === -1 ? ROOT_PATH : path.slice(0, separator);
};

/**
 * Ajv の `instancePath` は JSON Pointer で、`Diagnostic.path` は DG-4 の
 * スラッシュ区切りである。似ているので各所で `split("/")` を書きたくなるが、
 * `~0` / `~1` の復号を1つでも落とすと、その path だけ位置も値も引けなくなる。
 */
export const instancePathTokens = (instancePath: string): string[] =>
  instancePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

export const pathFromInstancePath = (instancePath: string): string =>
  instancePathTokens(instancePath).join("/");
