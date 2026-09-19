import { LineCounter, isMap, isNode, isScalar, isSeq, parseAllDocuments } from "yaml";

import { type Diagnostic } from "../diagnostic";
import {
  ROOT_PATH,
  childPath,
  parentPath,
  type ParsedDocument,
  type SourceMap,
  type SourcePosition,
} from "./source-map";

export const SYNTAX_ID = "V-A23";

export const MULTIPLE_DOCUMENTS_ID = "Y-5";

/**
 * `resolveKnownTags: false` と `schema: "core"` はどちらも外せない（Y-1）。
 * 外すと `!!timestamp 2026-10-01` が `Date` に解決され、日付が文字列でなくなる。
 * `version` を明示しないと `%YAML 1.1` ディレクティブを書いた利用者だけ別の
 * スキーマで読まれる。`prettyErrors: false` は、`message` に位置と原文の抜粋を
 * 混ぜさせないため。位置は `Diagnostic.line` / `column` が持つ（DG-5）。
 */
const PARSE_OPTIONS = {
  version: "1.2",
  schema: "core",
  resolveKnownTags: false,
  prettyErrors: false,
} as const;

type SourceEntry = { offset: number; emptySource: boolean };

const collectEntries = (node: unknown, path: string, entries: Map<string, SourceEntry>): void => {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key)) {
        continue;
      }

      const keyPath = childPath(path, String(pair.key.value));
      const offset = pair.key.range?.[0];

      if (offset !== undefined) {
        entries.set(keyPath, {
          offset,
          emptySource: isScalar(pair.value) && pair.value.source === "",
        });
      }

      collectEntries(pair.value, keyPath, entries);
    }

    return;
  }

  if (isSeq(node)) {
    for (const [index, item] of node.items.entries()) {
      if (!isNode(item)) {
        continue;
      }

      const itemPath = childPath(path, index);
      const offset = item.range?.[0];

      if (offset !== undefined) {
        entries.set(itemPath, { offset, emptySource: isScalar(item) && item.source === "" });
      }

      collectEntries(item, itemPath, entries);
    }
  }
};

const buildSourceMap = (contents: unknown, lineCounter: LineCounter): SourceMap => {
  const entries = new Map<string, SourceEntry>();

  collectEntries(contents, ROOT_PATH, entries);

  const rootOffset = (isNode(contents) ? contents.range?.[0] : undefined) ?? 0;

  const positionOf = (offset: number): SourcePosition => {
    const { line, col } = lineCounter.linePos(offset);

    return { line, column: col };
  };

  return {
    positionAt: (path) => {
      for (let current = path; ; current = parentPath(current)) {
        const entry = entries.get(current);

        if (entry) {
          return positionOf(entry.offset);
        }

        if (current === ROOT_PATH) {
          return positionOf(rootOffset);
        }
      }
    },
    isEmptySource: (path) => entries.get(path)?.emptySource ?? false,
  };
};

export type SyntaxStageResult = { diagnostics: Diagnostic[]; parsed?: ParsedDocument };

export const parseManifestSyntax = (text: string): SyntaxStageResult => {
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(text, { ...PARSE_OPTIONS, lineCounter });
  const positionOf = (offset: number): SourcePosition => {
    const { line, col } = lineCounter.linePos(offset);

    return { line, column: col };
  };

  const [first, second] = documents;

  if (!first) {
    return { diagnostics: [], parsed: { value: null, source: buildSourceMap(null, lineCounter) } };
  }

  const diagnostics: Diagnostic[] = first.errors.map((error) => ({
    id: SYNTAX_ID,
    severity: "error",
    stage: "syntax",
    path: ROOT_PATH,
    ...positionOf(error.pos[0]),
    message: error.message,
    /**
     * パーサの診断そのものは何が起きたかしか言わない。DG-2 が hint に求めるのは
     * どう直すかなので、YAML で最も多い2つの原因を名指しする。
     */
    hint: 'fix the YAML at this position: check the indentation, and quote values that contain ":" or start with "#"',
  }));

  if (second) {
    diagnostics.push({
      id: MULTIPLE_DOCUMENTS_ID,
      severity: "error",
      stage: "syntax",
      path: ROOT_PATH,
      ...positionOf(second.range[0]),
      message: "a manifest must contain exactly one YAML document",
      hint: 'one file describes one project. remove the "---" separator, or move the other documents into their own files',
    });
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    diagnostics,
    parsed: { value: first.toJS(), source: buildSourceMap(first.contents, lineCounter) },
  };
};
