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

type ValidateInput = { text: string; valueOf: (name: string) => string };

/** 空欄の名前を環境に入れない。core の展開（S2）が値として受け取り、「値が未入力」を判定できなくなる */
const environmentOf = (names: string[], valueOf: (name: string) => string): Environment =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = valueOf(name);

      return value === "" ? [] : [[name, value] as [string, string]];
    }),
  );

/**
 * `${NAME}` の一覧を診断の文面から取り出さない。core の文言が変わった瞬間に入力欄が消えるので、
 * テキストを2度読む。
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
 * `useMemo` に任せない。React Compiler は書いた依存配列を採らず、式が触っているものから
 * 依存を引き直すので、本文が読んでいない環境の版の違いを落とす。
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
