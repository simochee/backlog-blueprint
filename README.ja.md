# backlog-blueprint

[English](https://github.com/simochee/backlog-blueprint/blob/main/README.md) | 日本語

[![npm version](https://img.shields.io/npm/v/@simochee/backlog-blueprint)](https://www.npmjs.com/package/@simochee/backlog-blueprint)
[![CI](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@simochee/backlog-blueprint)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/simochee/backlog-blueprint)](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)

YAML ファイルから [Backlog](https://backlog.com/ja/) のプロジェクトを作成します。

![backlog-blueprint](https://raw.githubusercontent.com/simochee/backlog-blueprint/main/packages/brand/out/eyecatch.svg)

**[ブラウザで試す](https://simochee.github.io/backlog-blueprint/)** — インストールもサーバーも不要です。

マニフェストをリポジトリに置けば、プロジェクトの設定をプルリクエストでレビューし、次のプロジェクトに使い回せます。
マニフェストで扱えるもの:

- プロジェクトの基本設定
- 課題種別、状態、カテゴリー
- マイルストーン、カスタム属性
- チーム、メンバー、管理者
- Webhook

## 使い方

Node.js 22 以上と Backlog の API キーが必要です。

マニフェストを書きます。1行目でエディタの補完と検証が効きます。

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@simochee/backlog-blueprint@0.2.0/schema.json
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

API キーなしで、オフラインで検証します。

```sh
npx @simochee/backlog-blueprint validate -f projects/PROJ_A.yaml
```

何が変わるかを確認します。

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

反映します。`apply` は同じ計画を表示し、`yes` と入力したときだけ続行します。

```sh
npx @simochee/backlog-blueprint apply -f projects/PROJ_A.yaml
```

既存のプロジェクトから始めるなら、マニフェストとして書き出します。

```sh
npx @simochee/backlog-blueprint export PROJ_A > projects/standard.yaml
```

出力には Webhook の URL がそのまま含まれるので、コミットする前にシークレットを `${NAME}` に置き換えてください。
`export` はテンプレートの出発点を作るもので、ドリフト検知の手段ではありません。

## リファレンス

| コマンド       | Backlog への接続   | 説明                                           |
| -------------- | ------------------ | ---------------------------------------------- |
| `validate`     | しない             | マニフェストを検証する                         |
| `plan`         | 読み取りのみ       | `apply` で行われる変更を表示する               |
| `apply`        | 読み取りと書き込み | 計画を反映する                                 |
| `export <key>` | 読み取りのみ       | 既存のプロジェクトをマニフェストとして出力する |

| オプション           | コマンド                  | 説明                                               |
| -------------------- | ------------------------- | -------------------------------------------------- |
| `-f, --file <path>`  | `validate` `plan` `apply` | 読み込むマニフェスト（必須）。`-` で標準入力を読む |
| `--space <domain>`   | すべて                    | Backlog のスペース。例: `example.backlog.com`      |
| `--output <format>`  | `validate` `plan` `apply` | 標準出力の形式。`text`（既定）または `json`        |
| `--no-color`         | すべて                    | 出力の色付けを無効にする                           |
| `--show-unchanged`   | `plan`                    | 既に一致しているリソースも表示する                 |
| `-y, --auto-approve` | `apply`                   | 確認を省く。標準入力が TTY でないときは必須        |

| 変数              | 説明                                       |
| ----------------- | ------------------------------------------ |
| `BACKLOG_API_KEY` | API キー。`plan`、`apply`、`export` で必須 |
| `BACKLOG_SPACE`   | `--space` と同じ                           |
| `NO_COLOR`        | `--no-color` と同じ                        |

マニフェスト中の `${NAME}` も環境変数から読みます。

| 終了コード | 意味                              |
| ---------- | --------------------------------- |
| 0          | 成功。`plan` の場合は変更なし     |
| 1          | エラー                            |
| 2          | `plan` のみ: 反映すべき変更がある |

## 制限事項

backlog-blueprint はプロジェクトを一度だけセットアップします。その後 Backlog をマニフェストと一致させ続けることはしません。

- **課題のないプロジェクトのみ。** プロジェクトに課題が既にあると、`plan` と `apply` は止まります。
- **state なし。** 毎回プロジェクトを読んでマニフェストと比べます。
- **一部の操作はスペース管理者のキーが必要:** プロジェクトの作成、状態の変更、プロジェクト管理者の追加。
  キーで実行できない場合は `plan` が警告（`V-B2`）します。
- **ロールバックなし。** `apply` が途中で失敗すると、どこまで反映したかを報告します。再実行すれば続きから進みます。

Git リポジトリ、課題、Wiki ページ、スペースの設定は対象外です。

## セキュリティ

> **警告:** CI がマニフェストを反映するリポジトリに push できる人は、CI の API キーで操作できるすべてのプロジェクトを
> 書き換えられます。キーがスペース管理者のものなら、スペース全体です。

そのブランチではレビューを必須にし、ワークフローを編集できる人を絞り、シークレットのスコープはできるだけ狭くしてください。

## ドキュメント

- [Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md)（英語）
- [DEVELOPMENT.md](https://github.com/simochee/backlog-blueprint/blob/main/DEVELOPMENT.md)（英語）:
  backlog-blueprint 自体の開発
- [`.claude/docs/`](https://github.com/simochee/backlog-blueprint/tree/main/.claude/docs): 日本語の仕様書。
  メッセージ中の `[V-A6]` のような ID はここを指します

## ライセンス

[MIT](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)
