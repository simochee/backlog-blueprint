/**
 * エディタの部品（components/manifest-editor.tsx）に置かない。`verbatimModuleSyntax` では型だけの
 * `import { type X }` も読み込みとして残り、遅延読み込みのエディタ（WU-12）を最初の読み込みに引き込む。
 */
export type EditorPosition = { line: number; column: number };

export type EditorJump = EditorPosition & { request: number };
