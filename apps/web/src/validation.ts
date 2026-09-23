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
import { manifestStamp, type Derived, type ManifestInputs } from "./freshness";
import { environmentValue } from "./secrets";

export type ManifestValidation = {
  diagnostics: Diagnostic[];
  names: string[];
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
 * S1〜S4 をブラウザで走らせる（検証パイプライン §4 の Web エディタ）。テキストを2度読むのは、
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
    ...(validation.manifest === undefined ? {} : { manifest: validation.manifest }),
  };
};

const EMPTY: ManifestValidation = { diagnostics: [], names: [] };

let memo: Derived<ManifestValidation> | undefined;

/**
 * 環境変数の入力値はモジュールに置くので、描画からは見えない依存になる。印が
 * その値の代わりに変わるので、印を引数に取れば「同じ印なら同じ結果」が関数の外から言える。
 * `useMemo` に任せない — React Compiler は書いた依存配列を採らず、式が触っている
 * ものから依存を引き直すので、本文が読んでいない版の違いを落としてしまう。
 */
export const validatedFor = (inputs: ManifestInputs): Derived<ManifestValidation> => {
  const stamp = manifestStamp(inputs);

  if (memo?.stamp !== stamp) {
    memo = {
      stamp,
      value:
        inputs.manifestText.trim() === ""
          ? EMPTY
          : validateInBrowser({ text: inputs.manifestText, valueOf: environmentValue }),
    };
  }

  return memo;
};
