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
 * どれも外せない（Y-1）。`resolveKnownTags` と `schema` を外すと `!!timestamp` が `Date` になり、
 * `version` が無いと `%YAML 1.1` を書いた利用者だけ別のスキーマで読まれる。書き出し（EX-5）と
 * 版がずれると、YAML 1.1 で真偽値になる `yes` / `on` などの名前だけが読み戻せなくなる。
 */
export const YAML_SCHEMA_OPTIONS = {
  version: "1.2",
  schema: "core",
  resolveKnownTags: false,
} as const;

/** `prettyErrors` を外さない。`message` に位置と原文が混ざる（位置は DG-5 で別に持つ） */
const PARSE_OPTIONS = { ...YAML_SCHEMA_OPTIONS, prettyErrors: false } as const;

type SourceEntry = { offset: number; emptySource: boolean };

const positionOf = (lineCounter: LineCounter, offset: number): SourcePosition => {
  const { line, col } = lineCounter.linePos(offset);

  return { line, column: col };
};

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

  return {
    positionAt: (path) => {
      for (let current = path; ; current = parentPath(current)) {
        const entry = entries.get(current);

        if (entry) {
          return positionOf(lineCounter, entry.offset);
        }

        if (current === ROOT_PATH) {
          return positionOf(lineCounter, rootOffset);
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

  const [first, second] = documents;

  if (!first) {
    return { diagnostics: [], parsed: { value: null, source: buildSourceMap(null, lineCounter) } };
  }

  const diagnostics: Diagnostic[] = first.errors.map((error) => ({
    id: SYNTAX_ID,
    severity: "error",
    stage: "syntax",
    path: ROOT_PATH,
    ...positionOf(lineCounter, error.pos[0]),
    message: error.message,
    // パーサの文言で済ませない。何が起きたかしか言わず、DG-2 が hint に求めるどう直すかが無い。
    hint: 'fix the YAML at this position: check the indentation, and quote values that contain ":" or start with "#"',
  }));

  if (second) {
    diagnostics.push({
      id: MULTIPLE_DOCUMENTS_ID,
      severity: "error",
      stage: "syntax",
      path: ROOT_PATH,
      ...positionOf(lineCounter, second.range[0]),
      message: "a manifest must contain exactly one YAML document",
      hint: 'one file describes one project. remove the "---" separator, or move the other documents into their own files',
    });
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  // `toJS()` を裸で呼ばない。解決できないエイリアスは `errors` に載らずここで初めて throw し、
  // 利用者には理由の分からない白い画面だけが残る。`*` で始まる値を引用符なしで書けば踏む。
  try {
    return {
      diagnostics,
      parsed: { value: first.toJS(), source: buildSourceMap(first.contents, lineCounter) },
    };
  } catch (error) {
    return {
      diagnostics: [
        {
          id: SYNTAX_ID,
          severity: "error",
          stage: "syntax",
          path: ROOT_PATH,
          message: error instanceof Error ? error.message : String(error),
          hint: 'quote any value that starts with "*" or "&": YAML reads those as an alias or an anchor, not as text',
        },
      ],
    };
  }
};
