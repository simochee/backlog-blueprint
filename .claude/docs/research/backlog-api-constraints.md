# Backlog API 制約の調査結果

最終更新: 2026-09-17 / 出典: https://developer.nulab.com/docs/backlog/

設計判断の根拠になっている API 仕様をここに集約する。
仕様が変わったらこの文書を更新し、影響を受ける要件を洗い直す。

## 認証・実行環境

| 項目 | 内容 | 出典 |
| --- | --- | --- |
| 認証方式 | API キー、または OAuth 2.0 | [API Overview](https://developer.nulab.com/docs/backlog/) |
| CORS | **対応している**。「You can use Ajax requests on your browser as Backlog API supports Cross Origin Resource Sharing (CORS)」 | [API Overview](https://developer.nulab.com/docs/backlog/) |

CORS 対応が明記されていることが、サーバレスの static hosting な Web UI が成立する根拠。
ただし実際のプリフライト（`OPTIONS`）の挙動、許可ヘッダ、API キーをクエリで渡す場合の扱いは
`要検証`。実装初期に疎通確認を取ること。

## レート制限

| 項目 | 内容 |
| --- | --- |
| 区分 | Read（GET）/ Update（POST・PATCH・DELETE）/ Search（課題一覧・Wiki 一覧）/ Icon |
| 上限値 | プラン（Free / 有料）と区分ごとに異なる。`GET /api/v2/rateLimit` で取得可能 |
| レスポンスヘッダ | `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（Unix time） |
| 超過時 | `429 Too Many Requests` |
| 公式推奨 | リクエストは直列化し、**Update / Search / Icon は1秒以上あける** |

出典: [Rate Limit](https://developer.nulab.com/docs/backlog/rate-limit/)

**設計への影響**: apply は並列化できない。更新 API 20 件なら 20 秒以上かかる。
plan の段階で所要時間を見積もって提示し、apply 中は進捗を出す必要がある。

## 権限

必要権限がリソースごとにばらついている。これが「常にスペース管理者必須」という決定の理由。

| 操作 | 必要権限 | 出典 |
| --- | --- | --- |
| プロジェクト追加 | **Administrator**（スペース管理者） | [Add Project](https://developer.nulab.com/docs/backlog/api/2/add-project/) |
| ステータス追加 | **Administrator** | [Add Status](https://developer.nulab.com/docs/backlog/api/2/add-status/) |
| ステータス更新 | **Administrator** | [Update Status](https://developer.nulab.com/docs/backlog/api/2/update-status/) |
| ステータス削除 | **Administrator** | [Delete Status](https://developer.nulab.com/docs/backlog/api/2/delete-status/) |
| 課題種別 追加 | All permissions | [Add Issue Type](https://developer.nulab.com/docs/backlog/api/2/add-issue-type/) |
| 課題種別 削除 | All permissions | [Delete Issue Type](https://developer.nulab.com/docs/backlog/api/2/delete-issue-type/) |
| カスタム属性 追加 | Administrator / Project Administrator | [Add Custom Field](https://developer.nulab.com/docs/backlog/api/2/add-custom-field/) |
| プロジェクトへチーム追加 | Administrator / Project Administrator | [Add Project Team](https://developer.nulab.com/docs/backlog/api/2/add-project-team/) |

`GET /api/v2/users/myself` で実行者情報を取得できる（全ロール可）。
返却される `roleType` の数値と役割の対応表は、参照した API リファレンスには記載が無かった。
`roleType: 1` が管理者であることはレスポンス例から読み取れるが、
**全数値の対応は `要検証`**（実装前に実スペースで確認すること）。

## ステータス

| 制約 | 内容 |
| --- | --- |
| 既定ステータス | 未対応 / 処理中 / 処理済み / 完了 の4つが最初から存在する |
| 既定ステータスの削除 | **できない** |
| カスタムステータス | 既定4つに加えて**最大8つ**まで |
| 色 | 10色の固定パレットから選ぶ。`#ea2c00` `#e87758` `#e07b9a` `#868cb7` `#3b9dbd` `#4caf93` `#b0be3c` `#eda62a` `#f42858` `#393939` |
| 削除 | `substituteStatusId`（振替先ステータス）が**必須**。削除対象の課題は振替先に移される |
| 表示順 | `PATCH /projects/:key/statuses/updateDisplayOrder`。`statusId[]` に**プロジェクトの全ステータス**を渡す。一括なので1リクエストで済む |
| 順序制約 | 「未対応」が先頭、「完了」が末尾、「処理中」は「処理済み」より前でなければならない |

既定ステータスをリネームできるかは `要検証`。
`PATCH /projects/:key/statuses/:id` に `name` は存在するが、既定ステータスに対して通るかは未確認。
**もしリネームできるなら**「既定の4枠を任意の名前に寄せる」という選択肢が生まれるが、
現時点ではリネーム不可を前提として、定義に既定4つを必ず書かせる方針を採っている。

## 課題種別

| 制約 | 内容 |
| --- | --- |
| 既定の課題種別 | タスク / バグ / 要望 / その他 の4つが最初から存在する |
| 削除 | `substituteIssueTypeId`（振替先）が**必須** |
| 最低件数 | 0件にはできない（振替先が必要な構造上、最低1件は残る） |
| 色 | 固定パレットと思われるが、API リファレンスに一覧の記載なし。`要検証` |
| その他 | 件名テンプレート `templateSummary` / 詳細テンプレート `templateDescription` を設定できる |

| 表示順 | **変更する API が無い**。作成順で決まる |

**設計への影響**: 「全部消してから定義通りに作る」は API 上できない。
必ず「定義のものを先に作る → 既定のものを新しいものへ振り替えて削除する」順序になる。
また表示順を制御する手段が無いため、Yaml の記述順を厳密に再現するには全削除・再作成しかない。
リクエスト数が跳ね上がるので、本ツールでは**課題種別の表示順は保証しない**方針を採る。

## カスタム属性（カスタムフィールド）

| 項目 | 内容 |
| --- | --- |
| 種別 | 1:文字列 / 2:文章 / 3:数値 / 4:日付 / 5:単一リスト / 6:複数リスト / 7:チェックボックス / 8:ラジオ |
| 共通パラメータ | `name`（必須）, `typeId`（必須）, `description`, `required`, `applicableIssueTypes[]`（空なら全種別） |
| 数値型 | `min` `max` `initialValue` `unit` |
| 日付型 | `min` `max` `initialValueType`（1:当日 2:当日+シフト 3:指定日）`initialDate` `initialShift` |
| リスト型 | `items[]` `allowInput` `allowAddItem` |

`applicableIssueTypes[]` が課題種別 ID を要求するため、
**カスタム属性の作成は課題種別の作成より後**でなければならない。

プランによる利用可否の制限は、参照したリファレンスには記載が無かった。`要検証`。

## プロジェクト基本設定

`POST /api/v2/projects` で指定できる項目（すべて Yaml の管理対象になり得る）。

| パラメータ | 内容 |
| --- | --- |
| `name` / `key` | 必須。キーは英大文字・数字・アンダースコアのみ |
| `chartEnabled` | チャートを使用する |
| `useResolvedForChart` | 「処理済み」以降を完了扱いにする |
| `subtaskingEnabled` / `grandchildIssueEnabled` | 子課題 / 孫課題。孫は子が有効であることが前提 |
| `projectLeaderCanEditProjectLeader` | 管理者が相互に管理者を編集できる |
| `useWiki` / `useWikiTreeView` / `useOriginalImageSizeAtWiki` | Wiki 関連 |
| `useDocument` | ドキュメント機能 |
| `useFileSharing` | 共有ファイル |
| `useSubversion` / `useGit` | バージョン管理 |
| `textFormattingRule` | `backlog` または `markdown` |
| `useDevAttributes` | 優先度・発生バージョン・マイルストーンを使用する |

`grandchildIssueEnabled` は `subtaskingEnabled` に依存する。
`useDevAttributes: false` のときマイルストーン定義が意味を持つかは `要検証`。
いずれも Yaml の整合性検証の対象になる。

## 表示順を変更できるリソース

| リソース | 並べ替え API |
| --- | --- |
| ステータス | あり（`updateDisplayOrder`・一括） |
| 課題種別 | **無い** |
| カテゴリー | **無い** |
| マイルストーン | **無い** |
| カスタム属性 | **無い** |

レスポンスには `displayOrder` が含まれるが、更新する手段が提供されていない。

## プロジェクトメンバー・チーム

| 項目 | 内容 |
| --- | --- |
| プロジェクト参加者の取得 | `GET /projects/:key/users`。**`excludeGroupMembers`（既定 false）** を true にすると、チーム経由の参加者を除外して個人参加者だけを返す |
| プロジェクトへの個人追加 | `POST /projects/:key/users`（`userId`）。1人1リクエスト |
| プロジェクトへのチーム追加 | `POST /projects/:key/teams`（`teamId`）。1チーム1リクエスト |
| プロジェクト管理者の付与 | `POST /projects/:key/administrators`（`userId`）。**Administrator 権限必須**。個人単位でしか付与できず、チームごと管理者にはできない |

`excludeGroupMembers` を取り違えると、チーム経由で参加している人を
「Yaml の `members` に無いから削除」と誤判定する。削除判定では必ず true を指定すること。

プロジェクト管理者の付与に、対象ユーザーが事前にプロジェクト参加者であることが必要かは
リファレンスに記載が無く `要検証`。

## リクエスト数に効く API の性質

更新系は1秒に1件しか流せないため、1リクエストにまとめられるかどうかが所要時間を決める。

| まとめられるもの | 内容 |
| --- | --- |
| プロジェクト基本設定 | `POST` / `PATCH /projects` の1リクエストに全項目が乗る |
| ステータス表示順 | `statusId[]` で全ステータスを1リクエスト |
| カスタム属性の適用種別 | `applicableIssueTypes[]` で複数種別を1リクエスト |
| Webhook の通知イベント | `activityTypeIds[]` で複数イベントを1リクエスト |
| チーム参加 | 1チーム1リクエストで、その所属人数ぶんの参加をまとめて表現できる |

| まとめられないもの | 内容 |
| --- | --- |
| 課題種別・ステータス・カテゴリー・マイルストーン・カスタム属性の作成／更新／削除 | すべて1件1リクエスト |
| プロジェクトへの個人追加 | 1人1リクエスト |
| プロジェクト管理者の付与 | 1人1リクエスト |

## その他の関連 API

| 用途 | エンドポイント |
| --- | --- |
| 課題件数の確認 | `GET /api/v2/issues/count?projectId[]=N` → `{"count": 43}`。全ロール利用可 |
| 実行者の確認 | `GET /api/v2/users/myself` |
| スペースのユーザー一覧 | `GET /api/v2/users`（Yaml のユーザー ID → 数値 ID 解決に使う） |
| スペースのチーム一覧 | `GET /api/v2/teams`（Yaml のチーム名 → teamId 解決に使う） |
| プロジェクトのチーム | `GET` / `POST /api/v2/projects/:key/teams`（`teamId` を指定） |

## 未検証事項の一覧

実装着手前に実スペースで確認すべきもの。

- [ ] `roleType` の数値と役割の対応
- [ ] 既定ステータスをリネーム・色変更できるか
- [ ] 課題種別の色に許可されるパレット
- [ ] カスタム属性のプランによる利用可否
- [ ] CORS プリフライトの実挙動（許可ヘッダ、API キーの渡し方）
- [ ] `useDevAttributes: false` 時のマイルストーン・版の扱い
- [ ] チーム機能自体のプラン制限
- [ ] プロジェクト管理者の付与に、事前のプロジェクト参加が必要か
- [ ] 既定の課題種別4つ（タスク / バグ / 要望 / その他）の正確な色
- [ ] カテゴリー・マイルストーンの表示順が実際に何で決まるか（作成順か名前順か）
