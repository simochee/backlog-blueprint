import {
  orderDiagnostics,
  parseManifestSyntax,
  schemaStage,
  UNRESOLVED_ENV_ID,
  validateManifest,
  type Diagnostic,
  type Environment,
  type Manifest,
} from "@backlog-blueprint/core";

import { environmentReferences, missingValueDiagnostics, referencedNames } from "./environment";

export type ManifestValidation = {
  diagnostics: Diagnostic[];
  names: string[];
  expandedPaths: Set<string>;
  manifest?: Manifest;
};

export type ValidateInput = { text: string; valueOf: (name: string) => string };

const environmentOf = (names: string[], valueOf: (name: string) => string): Environment =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = valueOf(name);

      return value === "" ? [] : [[name, value] as [string, string]];
    }),
  );

/**
 * S1〜S4 をブラウザで走らせる（検証パイプライン §4 の Web Step 2）。テキストを2度読むのは、
 * 入力欄を生成するのに `${NAME}` の一覧が要るのに、core の展開が名前を返すのは
 * 診断の文面の中だけだからである。文面から名前を取り出す形にすると、core の文言が
 * 変わった瞬間に入力欄が消える。
 */
export const validateInBrowser = ({ text, valueOf }: ValidateInput): ManifestValidation => {
  const syntax = parseManifestSyntax(text);

  if (syntax.parsed === undefined) {
    return {
      diagnostics: orderDiagnostics(syntax.diagnostics),
      names: [],
      expandedPaths: new Set(),
    };
  }

  const references = environmentReferences(syntax.parsed);
  const names = referencedNames(references);
  const isEntered = (name: string): boolean => valueOf(name) !== "";
  const validation = validateManifest({
    text,
    schemaStage,
    env: environmentOf(names, valueOf),
  });
  const diagnostics = [
    ...validation.diagnostics.filter(({ id }) => id !== UNRESOLVED_ENV_ID),
    ...missingValueDiagnostics(references, syntax.parsed.source, isEntered),
  ];

  return {
    diagnostics: orderDiagnostics(diagnostics),
    names,
    expandedPaths: validation.expandedPaths,
    ...(validation.manifest === undefined ? {} : { manifest: validation.manifest }),
  };
};
