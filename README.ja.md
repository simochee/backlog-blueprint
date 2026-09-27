# backlog-blueprint

[English](https://github.com/simochee/backlog-blueprint/blob/main/README.md) | 日本語

[![npm version](https://img.shields.io/npm/v/@simochee/backlog-blueprint)](https://www.npmjs.com/package/@simochee/backlog-blueprint)
[![CI](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@simochee/backlog-blueprint)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/simochee/backlog-blueprint)](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)

YAML ファイルから [Backlog](https://backlog.com/ja/) のプロジェクトを作成します。

![backlog-blueprint](https://raw.githubusercontent.com/simochee/backlog-blueprint/main/packages/brand/out/eyecatch.svg)

マニフェストはリポジトリに置くので、プロジェクトの設定をプルリクエストでレビューし、次のプロジェクトに使い回せます。
`plan` で変更内容を確認し、`apply` で反映します。

マニフェストで扱えるもの:

- プロジェクトの基本設定
- 課題種別、状態、カテゴリー
- マイルストーン、カスタム属性
- チーム、メンバー、管理者
- Webhook

## 動作要件

- Node.js 22 以上
- Backlog のスペースと API キー

## 使い方

`npx` で実行します。インストールは要りません。

```sh
npx @simochee/backlog-blueprint --help
```

マニフェストを書きます。1行目のコメントで、エディタの補完と検証が効くようになります（[JSON Schema](#json-schema)
を参照）。

```yaml
# yaml-language-server: $schema=https://simochee.github.io/backlog-blueprint/schema/0.1.0/project.json
key: PROJ_A
name: プロジェクトA

issueTypes:
  - name: タスク
    color: "#7ea800"
  - name: バグ
    color: "#990000"
    templateSummary: "【不具合】"
  - name: 調査
    oldname: その他
    color: "#2779ca"

statuses:
  - name: 未対応
  - name: 処理中
  - name: レビュー中
    color: "#3b9dbd"
  - name: 処理済み
  - name: 完了

access:
  teams:
    - 31 # 開発チーム
  members:
    - 12 # 鈴木 花子

webhooks:
  - name: Slack 通知
    hookUrl: ${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
```

Backlog に接続せずにファイルを検証します。

```sh
npx @simochee/backlog-blueprint validate -f projects/PROJ_A.yaml
```

`validate` は API キーも `${ENV}` の値も要らないので、プルリクエストのチェックで実行できます。スペースが見えないので、
既定の状態、既存のメンバー、課題数は報告できません。これらは `plan` が報告します。

`apply` で何が変わるかを確認します。この例では `PROJ_A` は既にあり、課題は1件もありません。

```sh
export BACKLOG_SPACE=example.backlog.com
export BACKLOG_API_KEY=...
export SLACK_WEBHOOK_URL=https://hooks.example.com/T000/B000

npx @simochee/backlog-blueprint plan -f projects/PROJ_A.yaml
```

```
Blueprint: PROJ_A (example.backlog.com)

  ~ issueType      "バグ"
      templateSummary: (none) -> "【不具合】"
  ~ issueType      "調査"  renamed from "その他"
  - issueType      "要望"
  + status         "レビュー中"  color "#3b9dbd"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "鈴木 花子"
  + webhook        "Slack 通知"  hookUrl "https://hooks.example.com/T000/B000"

Warnings:
  ! [V-A16] access.members: "鈴木 花子" (12) already joins the project through the team "開発チーム"
      remove 12 from access.members to save one request. leaving it there also works

Plan: 4 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 8 (estimated 8s)
```

反映します。

```sh
npx @simochee/backlog-blueprint apply -f projects/PROJ_A.yaml
```

`apply` は同じ計画を表示し、書き込む前に確認を求めます。`yes` と入力したときだけ続行し、それ以外の入力では
終了コード 1 で終了します。

形式の続きは
[Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md)（英語）で説明しています。

## コマンド

| コマンド       | Backlog への接続   | 説明                                           |
| -------------- | ------------------ | ---------------------------------------------- |
| `validate`     | しない             | マニフェストを検証する                         |
| `plan`         | 読み取りのみ       | `apply` で行われる変更を表示する               |
| `apply`        | 読み取りと書き込み | 計画を反映する                                 |
| `export <key>` | 読み取りのみ       | 既存のプロジェクトをマニフェストとして出力する |

検証に失敗すると、どのコマンドも見つけた問題をすべて報告し、最初の書き込みの前に止まります。

### オプション

| オプション           | コマンド                  | 説明                                               |
| -------------------- | ------------------------- | -------------------------------------------------- |
| `-f, --file <path>`  | `validate` `plan` `apply` | 読み込むマニフェスト（必須）。`-` で標準入力を読む |
| `--space <domain>`   | すべて                    | Backlog のスペース。例: `example.backlog.com`      |
| `--output <format>`  | `validate` `plan` `apply` | `text`（既定）または `json`                        |
| `--no-color`         | すべて                    | 出力の色付けを無効にする                           |
| `--show-unchanged`   | `plan`                    | 既に一致しているリソースも表示する                 |
| `-y, --auto-approve` | `apply`                   | 確認を省く。標準入力が TTY でないときは必須        |

1回の実行で扱うのは1つのマニフェストと1つのプロジェクトです。`-f` は1回だけ指定でき、`export` に渡せる
キーは1つだけです。複数のプロジェクトを処理するにはシェルでループしてください。

`--output json` のとき、標準出力には JSON ドキュメントだけが出ます。進捗、警告、エラー、確認プロンプトは
標準エラー出力に出ます。

### 環境変数

| 変数              | 説明                                       |
| ----------------- | ------------------------------------------ |
| `BACKLOG_API_KEY` | API キー。`plan`、`apply`、`export` で必須 |
| `BACKLOG_SPACE`   | `--space` と同じ                           |
| `NO_COLOR`        | `--no-color` と同じ                        |

`--api-key` オプションはありません。コマンドライン引数は `ps` やシェルの履歴、CI のログに現れるためです。
マニフェスト中の `${NAME}` 参照も環境変数から解決されます。

### 終了コード

| コード | 意味                                 |
| ------ | ------------------------------------ |
| 0      | 成功。`plan` の場合は変更なし        |
| 1      | エラー。検証エラーや実行の失敗を含む |
| 2      | `plan` のみ: 反映すべき変更がある    |

CI では、`plan` の終了コード 2 を見れば、出力を解析しなくてもマニフェストがスペースを変更するかどうかがわかります。

### 既存のプロジェクトから始める

`export` はプロジェクトをマニフェストとして出力します。既存のプロジェクトをテンプレートにできます。

```sh
npx @simochee/backlog-blueprint export PROJ_A > projects/standard.yaml
```

標準出力には YAML だけが出ます。読み取りが1つでも失敗すると何も出力せず、終了コード 1 で終わります。

出力には Backlog が返した Webhook の URL がそのまま含まれます。シークレットは `${NAME}` に置き換え、コミットする前に
ファイルを見直してください。課題のあるプロジェクトも `export` はできますが、`plan` と `apply` は課題のある
プロジェクトを拒否するままなので、反映する前に `key` と `name` を変えてください。

`export` はプロジェクトの今の姿を、テンプレートの出発点として書き出すものです。ドリフト検知ではありません。
このツールが2つのマニフェストを比べることはありません。

## 制限事項

backlog-blueprint はプロジェクトを一度だけセットアップします。その後、Backlog をマニフェストと一致させ続けることは
しません。

- **課題のないプロジェクトのみ。** プロジェクトが既にあり、課題が1件でもあれば、`plan` と `apply` は何も変更する前に
  止まります。このチェックは無効にできません。
- **state なし。** state ファイルもドリフト検知もありません。毎回、現在のプロジェクトを読んでマニフェストと
  比べます。
- **一部の操作はスペース管理者のキーが必要。** プロジェクトの作成、状態の変更、プロジェクト管理者の追加は、
  Backlog がスペース管理者からしか受け付けません。キーで実行できない操作が計画に含まれると、`plan` が警告（`V-B2`）を
  出します。
- **ロールバックなし。** `apply` が途中で失敗すると、そこで止まり、反映したもの、失敗したもの、試みなかったものを
  報告します。同じマニフェストで再実行すれば続きから進みます。プロジェクトに課題がまだないかぎり、反映済みの作業は
  飛ばされます。

次のものも対象外です: Git リポジトリ、課題、Wiki ページ、スペースの設定、プロジェクトの削除とアーカイブ。

## セキュリティ

> **警告:** マニフェストを置くリポジトリへの push 権限は、実質的に CI に置いた API キーの持ち主の権限です。
> マニフェストを push できる人や、それを実行するワークフローを編集できる人は、そのキーで操作できるすべてのプロジェクトを書き換えられます。
> キーがスペース管理者のものなら、スペース全体です。

CI が反映に使うブランチにはレビューを必須にし、ワークフローファイルを編集できる人を絞り、API キーは使える範囲で
最も狭いシークレットのスコープに置いてください。

## Web UI

<https://simochee.github.io/backlog-blueprint/> では、同じ検証と計画をブラウザで実行できます。静的なページで、
Backlog API を直接呼び出します。スペースと API キーはタブのセッションストレージに
保持されるので、再読み込みしても聞き直されません。タブを閉じるか **Disconnect** を押すと消えます。

マニフェストを貼り付けるかドロップするか、**Open** でファイルを開き、**Plan** と **Apply** を押します。CLI と違い、
**Apply** は確認を求めないので、先に計画を読んでください。**Save**（Cmd/Ctrl+S）は、Chromium 系のブラウザでは
開いたファイルに書き戻し、それ以外ではコピーをダウンロードします。**Import from Backlog** は既存のプロジェクトを、
`export` が出力するのと同じ YAML としてエディタに読み込みます。

## JSON Schema

リリースごとに JSON Schema を公開しています。

```
https://simochee.github.io/backlog-blueprint/schema/<version>/project.json
```

URL のバージョンは CLI のバージョンで、古い URL は削除しません。CLI はスキーマでは表せない検証を数多く行うため、
エディタが受け入れたマニフェストでも `validate` で失敗することがあります。

## ドキュメント

- [Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md)（英語）:
  削除の扱い、`oldname`、既定のリソース、表示順、`${ENV}`、`access`、`webhooks`、`apply` が遅くなる理由
- [DEVELOPMENT.md](https://github.com/simochee/backlog-blueprint/blob/main/DEVELOPMENT.md)（英語）:
  backlog-blueprint 自体の開発
- [`.claude/docs/`](https://github.com/simochee/backlog-blueprint/tree/main/.claude/docs): 日本語の仕様書。
  エラーメッセージ中の `[V-A6]` のような ID はここを指します

## ライセンス

[MIT](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)
