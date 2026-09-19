# AGENTS.md

AI コーディングエージェントがこのリポジトリで作業するときの手引き。

## 概要

backlog-blueprint は Backlog のプロジェクト設定を Yaml で宣言し、plan / apply で反映する
ツール。CLI（npm `@simochee/backlog-blueprint`）とブラウザで動く Web UI の2つを成果物とする
pnpm workspace のモノレポで、パッケージはすべて ESM only。

## 仕様は `.claude/docs/` にしかない

`.claude/docs/` が唯一の仕様である。実装の判断は必ずここを根拠にする。

| ディレクトリ | 内容 |
| --- | --- |
| `.claude/docs/requirements/` | 要件定義（FR / NFR / V-A / V-B / AC） |
| `.claude/docs/design/` | 設計（マニフェストのスキーマ定義・検証パイプライン・reconciler・plan 出力・CLI と Web UI・バージョニング・先行事例 bee） |
| `.claude/docs/research/` | Backlog API の実測（X-*） |

- **決定は ID で参照する。** 「NFR-5 のため」「K-1 のため」のように書き、内容を写さない。
  写すと文書と実装で二重管理になり、文書を直しても実装のコメントが古いまま残る。
- **仕様に書いていないことを推測で埋めない。** 判断が要るところに行き当たったら、
  埋めずに報告する。文書に決定を足してから実装する。

## コマンド

```sh
# 依存のインストール
pnpm install

# リント（oxlint。ESLint ではない）
pnpm run lint
pnpm run lint:fix

# フォーマット（oxfmt）
pnpm run format
pnpm run format:check

# 型検査（turbo 経由で各パッケージの tsc --noEmit）
pnpm run typecheck

# テスト（vitest）
pnpm run test
pnpm --filter @backlog-blueprint/core exec vitest run src/manifest.test.ts

# ビルド
pnpm run build
```

依存のバージョンは `pnpm-workspace.yaml` の `catalog:` に集める（B-6）。
追加は `pnpm add --save-catalog <pkg>`（devDependencies は `-D` を添える）で行い、
`package.json` にバージョン範囲を直接書かない。

## パッケージ構成

```
apps/
  cli/             @simochee/backlog-blueprint。実行ファイル名 backlog-blueprint
  web/             @backlog-blueprint/web。Vite の SPA
packages/
  core/            @backlog-blueprint/core。パース・検証・plan 算出・apply 実行
  backlog-client/  @backlog-blueprint/backlog-client。backlog-js を包む送信層
  schema/          @backlog-blueprint/schema。JSON Schema の生成物（M-1）
  test-utils/      @backlog-blueprint/test-utils。テストの共有ヘルパ（B-3）
  tsconfigs/       @backlog-blueprint/tsconfigs。共有 TypeScript 設定（B-4）
```

`apps/` が配布するもの、`packages/` が共有する部品（B-1）。
`apps/cli` と `apps/web` は「入出力の違い」だけを担い、検証と計画は `packages/core` に閉じる。

`packages/core` の構成と各リソースの reconciler については
[core のデータモデルと reconciler](.claude/docs/design/core-reconciler.md) を読む。

## `packages/core` に Node 専用 API を書かない（NFR-5）

`packages/core` で使ってよいのは ECMAScript の標準と `fetch` だけである。
`node:*` / `process` / `Buffer` も `document` / `window` / `localStorage` も書けない。

これは注意事項ではなく**型検査で落ちる**。`packages/tsconfigs/base.json` が
`types: []` / `lib: ["ES2022"]` を置き、`fetch` は `packages/core/src/fetch.d.ts` の
ambient 宣言で必要な面だけを持っている。Node が要るパッケージだけが
`packages/tsconfigs/node.json` を継承して `types: ["node"]` を足す。

**このガードは依存の `.d.ts` にある `/// <reference types="node" />` 1つで黙って無効になる。**
`types: []` が止めるのは自動読み込みだけで、参照ディレクティブは止められない。
`packages/core` に依存を足したら、足した後に次を実行してガードが生きていることを確かめる。

```sh
# packages/core/src/ に一時ファイルを置いて typecheck が落ちることを確認し、確認後に消す
printf "import { readFileSync } from 'node:fs'\nexport const probe = () => [readFileSync, process.env.HOME, Buffer.from('x')]\n" > packages/core/src/nfr5-probe.ts
pnpm --filter @backlog-blueprint/core run typecheck   # 落ちなければガードが壊れている
rm packages/core/src/nfr5-probe.ts
```

送信層を `packages/backlog-client` に切り出しているのはこのためでもある（B-2 / 要件定義 §7.0）。
backlog-js とその型定義を `packages/core` に入れない。

## 情報の置き場所

- **How = コード。** 実現方法はコードだけが表す。コメントで補いたくなったら、
  名前を変える・関数を切り出すなどコード側を直す。
- **What = テスト。** テストは仕様の実行可能な記述である。テスト名は挙動を述べる
  （「日付型のカスタム属性の範囲は日付文字列で書く」。「validate が false を返す」ではない）。
- **Why = コミットログ。** なぜ必要だったかを本文に書く。diff で分かる What は書かない。
- **Why not = コードコメント。** 自然な書き方を採らなかった理由だけを書く。
  「削られると壊れる」ところに置き、将来の読み手が「単純化」して壊すのを止めるために書く。
  コードが何をしているかの説明は書かない。

## テスト

- **実 Backlog API を叩かない。** テストは固定値で組み立てる。
  ネットワークに出るテストは書かない。
- 共有ヘルパは `@backlog-blueprint/test-utils` に置く。各パッケージに散らさない（B-3）。
  現在あるもの:

  | ヘルパ | 用途 |
  | --- | --- |
  | `fixedSnapshot(overrides?)` | フェーズ0の `Snapshot` を固定値で組み立てる |
  | `fixedResourceSnapshots(overrides?)` | 各 reconciler の `read()` が返す `ResourceSnapshots` を固定値で組み立てる |
  | `fixedManifest(overrides?)` | 正規化済みの `Manifest` を固定値で組み立てる |
  | `fixedGet(responses)` | `ReadContext['get']` を path → 応答の表で差し替える。表に無い path は失敗する |
  | `fixedSpaceResponses(overrides?)` | 課題0件の既存プロジェクトに対する GET の応答をひととおり持つ表 |
  | `httpFailure(failure)` | 応答の表に「その path では `HttpFailure` を投げる」と書く |
  | `recordingGet(responses)` | `fixedGet` に加えて、取得した path を `requested` に記録する |
  | `recordingSend(respond?)` | `ExecuteContext['send']` を差し替え、送られた `ResolvedHttpRequest` を `sent` に記録する |
  | `fixedReadContext(responses, overrides?)` | `ReadContext` を組み立てる |
  | `fixedPlanContext(overrides?)` | `PlanContext` を組み立てる |
  | `secretPaths(...paths)` | `PlanContext['isSecret']` を、展開された path の集合で差し替える |

- 足りないヘルパは `packages/test-utils` に足してから使う。
- **`packages/core` からは相対 path で読む。** core の devDependencies に
  `@backlog-blueprint/test-utils` を足すと turbo がワークスペースの循環を検出して
  すべてのタスクが組めなくなる（test-utils は core に依存しているため）。

## メッセージとコミットログの言語

- **利用者に見えるメッセージは英語のみ**（NFR-9）。CLI / Web UI / JSON Schema の
  description・エラー・ヒントが対象。i18n の仕組みは入れない。
- **コミットログは日本語。** 本文の Why に決定 ID を書く。

## ESM とモジュール解決

`module: "preserve"` / `moduleResolution: "bundler"`。

- **相対 import は拡張子を書かない。**

  ```ts
  import { resolveRef } from './ref' // 正しい
  import { resolveRef } from './ref.js' // 誤り
  ```

- **`type` はインラインで書く。** `import { type Manifest, normalizeManifest } from './manifest'`
  のように1つの import にまとめる（oxlint が指摘する）。
- 型定義は `interface` ではなく `type` を使う。配列は `T[]`。名前付き export のみ。

## ツール

| 用途 | ツール |
| --- | --- |
| パッケージマネージャ | pnpm（依存バージョンは `catalog:`） |
| タスクランナー | turbo（`turbo.json` の `dependsOn` で依存順に流す） |
| リンタ | oxlint（**ESLint ではない**） |
| フォーマッタ | oxfmt（`.md` は対象外。仕様文書を書き換えないため） |
| 型検査 | パッケージごとの `tsc --noEmit` |
| テスト | vitest |

`lint` と `typecheck` は別物で、どちらも通す。`lint` は高速な静的解析、
`typecheck` は `tsc` による型検査である。

`.oxlintrc.json` で無効にしている規則には理由がある。消す前に確かめる。

- `unicorn/no-thenable`（`packages/core/src/manifest.ts` のみ）— JSON Schema の
  `then` キーワードを `Promise` と誤認するため。
- `unicorn/no-empty-file` / `unicorn/require-module-specifiers`（骨組みのファイルのみ）—
  実装が入るまでの `export {}` を許すため。**実装を入れたら `.oxlintrc.json` から
  そのパスを消す。**
- `no-template-curly-in-string` — 仕様上 `${ENV}` を含む文字列を書く場面が多いため（E-1）。
- `import/no-nodejs-modules`（`apps/cli/src/` のみ）— CLI は Node のアプリで、
  ファイル読み込みと標準入力に `node:*` が要るため。`packages/` では有効のままにする（NFR-5）。
