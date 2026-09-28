# 先行事例: nulab/bee

最終更新: 2026-09-28
調査対象: [nulab/bee](https://github.com/nulab/bee)（Nulab 公式の Backlog CLI・TypeScript・MIT）

Backlog を対象にした CLI の先行事例。[GitHub の設定 IaC](syntax-reference-github.md) が
「設定を宣言で持つ」側の先行事例だったのに対し、bee は**同じ API・同じ言語・同じ組織**の先行事例である。
借りられるものが構成とツールの層に多い。

## 1. bee の構成

```
apps/cli                 CLI 本体（commander / consola）
apps/docs                Astro Starlight。コマンド一覧は CLI のソースから自動生成
packages/backlog-utils   backlog-js のラッパ。OAuth 自動更新、レート制限
packages/cli-utils       出力整形・表・プロンプト・標準入力
packages/config          ~/.config/bee の RC ファイル、スペースと認証の解決
packages/test-utils      共有テストヘルパ（モッククライアント、stdout 捕捉、process.exit の spy）
packages/tsconfigs       共有 TypeScript 設定
```

ESM only。`module: "preserve"` / `moduleResolution: "bundler"`。
相対 import は拡張子を書かない。`import { type Foo, bar }` のインライン `type`。
pnpm workspace ＋ turbo ＋ `catalog:` による依存バージョンの一元管理。
リンタは oxlint、フォーマッタは oxfmt（bee の AGENTS.md が「NOT ESLint」と明記）。

## 2. 借りた決定

| ID | 決定 | 理由 |
| --- | --- | --- |
| B-1 | `apps/` と `packages/` を分ける。`apps/cli` `apps/web` が成果物、`packages/*` が再利用される部品 | 「配布するもの」と「共有するもの」がディレクトリで読める。要件定義 §7 の4パッケージ構成を置き換える |
| B-2 | backlog-js を専用パッケージ（`packages/backlog-client`）で包み、`apps/*` からは直接触らせない | bee の `backlog-utils` と同じ分け方。core には注入された関数しか渡らないので、送信の実体を core が知らずに済む |
| B-3 | `packages/test-utils` に共有テストヘルパを置く | 実 API を叩かないという制約（NFR-5 / 開発上の禁止事項）を満たすには、スナップショットとモックの組み立てが全 worker で共通になる。各パッケージに散らすと形がばらつく |
| B-4 | `packages/tsconfigs` に共有 TypeScript 設定を置く | 設定の重複を消す。**ただし bee の基底は `"types": ["node"]` なので、core はこれを継承しない**（後述） |
| B-5 | CLI は commander | bee の `apps/cli` と同じ。CL-1〜CL-6 と stdout / stderr の分離（PO-7）を組む土台。**consola は採らない**（下記） |
| B-6 | ~~turbo~~ Vite+ の `vp run` ＋ pnpm の `catalog:`（2026-09-28 に turbo から置き換え。[§2.1](#21-b-6--b-7-の見直し2026-09-28)） | タスクの依存順実行と、依存バージョンの一元管理 |
| B-7 | リンタ・フォーマッタは oxlint ＋ oxfmt。2026-09-28 からは Vite+ に同梱のものを `vp check` / `vp lint` / `vp fmt` で使う（[§2.1](#21-b-6--b-7-の見直し2026-09-28)） | bee に揃える |
| B-8 | リポジトリ直下に `AGENTS.md` を置き、規約をそこに集める | bee と同じ。規約を作業依頼のたびに書き写さずに済む |

### 2.1 B-6 / B-7 の見直し（2026-09-28）

Vite+ 1.0 が出たのを機に、ツールチェーンを `vite-plus` 1つにまとめた。依頼者の判断であり、
turbo と pnpm を使い続けることに強い理由は無いとされた。

- **タスクの実行は `vp run`。** turbo の `dependsOn: ["^build"]` はワークスペースの依存順に
  置き換わる。キャッシュの入力は、各タスクが実際に読んだファイルを Vite Task が記録して決める。
  turbo では `apps/web` のビルドが `apps/cli/package.json`（D-2 のスキーマの版）を読むことを
  手で入力に足していたが、その指定は要らなくなった。
- **リンタ・フォーマッタは oxlint ＋ oxfmt のまま**で、bee に揃えるという B-7 の趣旨は変わらない。
  設定の置き場がルートの `vite.config.ts` の `lint` / `fmt` に移り、パッケージごとの違いは
  `overrides` で書く。
- **pnpm と `catalog:` は残す。** Vite+ はパッケージマネージャーを持たず、`vp install` などは
  検出したマネージャーに委ねる。コマンドは `vp` で打ち、pnpm は Vite+ が `packageManager` の版を
  取ってくる。Node の版は `package.json` の `devEngines.runtime` に置き、Vite+ が選ぶ。
- **テストは Vitest、ビルドは Vite と tsdown（`vp pack`）**を Vite+ 経由で使う。CLI は Node で
  動く実行ファイルなので `vp build` ではなく `vp pack` で組む。

## 3. 借りなかったもの

**bee は CLI 専用ツール、backlog-blueprint は CLI ＋ ブラウザ。** この前提の違いが、借りられる範囲を決めている。

| bee のやり方 | 借りない理由 |
| --- | --- |
| `packages/tsconfigs/base.json` が `"types": ["node"]` | core は `types: []` ＋ `fetch` の ambient 宣言で、**Node 専用 API を書くと型検査が落ちる**状態を保つ（NFR-5）。基底をそのまま継承するとこのガードが消える。共有設定は持つが、core は `types` を上書きする |
| `backlog-utils` が `undici` に依存 | `undici` は Node 専用。`backlog-client` はブラウザでも動く必要がある（FR-7.1）。`globalThis.fetch` だけを使う |
| スキーマライブラリが valibot | valibot も zod も、判別共用体を JSON Schema にすると `oneOf` になる（実測）。マニフェストのスキーマ定義 §9 は `allOf` + `if`/`then` を要求しており、`oneOf` だとエディタの指摘が「どの分岐にも一致しない」になって V-A11 が伝えたいことに届かない。TypeBox を採る（M-1 はライブラリ選定を実装時に委ねている） |
| OAuth による認証 | 本ツールの認証は API キーのみ（FR-5.1 / CL-2） |
| ロガーに consola | 描画は core が担い（NFR-6）、CLI は完成した文字列を書き出すだけ。ロガーを挟むとタグと装飾が混ざる |
| `packages/config` による RC ファイル | 設定ファイルを持たない。スペースは `--space` と環境変数、API キーは環境変数だけ（CL-2） |

## 4. 参考にとどめたもの

`apps/docs` がコマンドリファレンスを CLI のソースから自動生成し、`.md` を手で置くことを禁じている点は、
M-1（JSON Schema をコードから生成する）と同じ思想である。本ツールのドキュメントサイトは
初期スコープに無いが、将来足すならこの形を採る。
