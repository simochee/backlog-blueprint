# Backlog API 制約の調査結果

最終更新: 2026-09-19 / 出典: https://developer.nulab.com/docs/backlog/

設計判断の根拠になっている API 仕様をここに集約する。
仕様が変わったらこの文書を更新し、影響を受ける要件を洗い直す。

ドキュメントに記載が無かった挙動は**実 API を叩いて確認済み**。
実測で確認した項目には「実測」と記す。

## 認証・実行環境

| 項目 | 内容 | 出典 |
| --- | --- | --- |
| 認証方式 | API キー、または OAuth 2.0 | [API Overview](https://developer.nulab.com/docs/backlog/) |
| CORS | **対応している**（実測で確認済み。下記） | [API Overview](https://developer.nulab.com/docs/backlog/) |

### CORS の実挙動（実測）

プリフライト（`OPTIONS`）のレスポンスヘッダ。

| ヘッダ | 値 |
| --- | --- |
| `access-control-allow-origin` | `*` |
| `access-control-allow-methods` | `POST, GET, PUT, DELETE, PATCH` |
| `access-control-allow-headers` | `Authorization, Cache-Control, Origin, X-Requested-With, Content-Type, Accept, Referer, If-Modified-Since, If-None-Match, If-Unmodified-Since, **Backlog-API-Key**` |
| `access-control-max-age` | `86400` |

**実装に必要な結論。**

1. **API キーは `Backlog-API-Key` ヘッダで渡せる。** 許可ヘッダに含まれており、
   このヘッダだけで認証が通ることを実測で確認した。クエリパラメータに載せる必要はない
2. 必要なメソッド（GET / POST / PATCH / DELETE）はすべて許可されている
3. プリフライトは 24 時間キャッシュされるので、リクエスト数を実質増やさない
4. `access-control-allow-credentials` は返らない（オリジンがワイルドカードのため）。
   Cookie を使う認証はできないが、ヘッダ認証なので問題にならない

**制約: `access-control-expose-headers` が返らない。**
そのためブラウザからは `X-RateLimit-*` ヘッダを読めない。
レート制限の残量をブラウザで観測する手段は、`GET /api/v2/rateLimit`（本文で返る）だけになる。

## 既定リソースの表示名

既定ステータスと既定課題種別の表示名は、**スペースの言語設定で変わる**。
言語は `GET /api/v2/space` の `lang` で取れる（[応答例](https://developer.nulab.com/docs/backlog/api/2/get-space/)に `lang` がある）。

| 言語 | 既定ステータス（ID 1〜4） | 既定課題種別 |
| --- | --- | --- |
| `ja` | 未対応 / 処理中 / 処理済み / 完了（実測） | タスク / バグ / 要望 / その他（実測） |
| `en` | `Open` / `In Progress` / `Resolved` / `Closed` | `Bug` / `Task` / `Request` / **4つ目は `要検証`** |

英語のステータス名は [Get Status List of Project](https://developer.nulab.com/docs/backlog/api/2/get-status-list-of-project/)
の応答例が id 1 = `Open` を示し、[Customize issue status](https://support.backlog.com/hc/en-us/articles/360035098894-Customize-issue-status)
が4つを列挙している。英語の課題種別は [Issue Type](https://support.backlog.com/hc/en-us/articles/115015501328-Issue-Type)
が Bug / Task / Request の3つしか挙げておらず、日本語の「その他」に対応する4つ目が確認できていない。

**課題種別はこの表に依存しない。** 新規プロジェクトでは名前を使わず枠として引き継ぐ
（[core のデータモデル §4.1](../design/core-reconciler.md#41-フェーズと-read)）。
既存プロジェクトは `GET` が実名を返す。

**ステータスはこの表が要る。** 課題種別と違って枠に寄せられない。既定ステータスは
削除もリネームもできず（実測）、マニフェストの4件が既定のどれに対応するかを
名前でしか決められないためである。新規プロジェクトでは V-A6 の判定と
reconciler の照合の両方でこの表を引き、**日本語・英語のどちらの組に一致しても通す**。

英語の4組が未確認のまま `ja` 以外のスペースで新規プロジェクトを作ると、
V-A6 が正しいマニフェストを止めうる。適用を壊す向きではないので `要検証` のまま進める。

## リクエストの形式

出典は [backlog-js](https://github.com/nulab/backlog-js)（Nulab 公式クライアント・MIT）の
実装。実 API を叩いて確かめたものではなく、公式クライアントが実際に何を送っているかを読んだもの。

| 項目 | 内容 |
| --- | --- |
| 認証 | `Backlog-API-Key` ヘッダ。クエリパラメータには載せない（FR-5.1a と一致） |
| 更新系の本文 | `Content-Type: application/x-www-form-urlencoded` |
| 配列パラメータ | `qs.stringify(params, { arrayFormat: 'brackets' })`。`statusId[]=1&statusId[]=2` の形 |
| 低レベル API | `request({ method, path, params })` が公開されている。型付きのエンドポイント別メソッドを経由せずに任意のパスを叩ける |
| 空配列 | **`qs` がキーごと落とす**（実測）。`{ applicableIssueTypes: [] }` をそのまま渡すと本文に現れないので、送信層が `applicableIssueTypes[]=` に変換する（[空配列を送る方法](#空配列を送る方法)） |
| 実行環境 | `globalThis.fetch` を使う。差し替えも可能。ブラウザ向けビルドがある |

本文書が配列パラメータを一貫して `statusId[]` `applicableIssueTypes[]` `activityTypeIds[]` と
`[]` 付きで記録しているのは、この `arrayFormat: 'brackets'` に対応する。

## レート制限

| 項目 | 内容 |
| --- | --- |
| 区分 | Read（GET）/ Update（POST・PATCH・DELETE）/ Search（課題一覧・Wiki 一覧）/ Icon |
| 上限値 | プランと区分ごとに異なる。`GET /api/v2/rateLimit` で**本文として**取得できる |
| 実測値（ある有料プランの場合） | read 600 / update 150 / search 150 / icon 60（いずれも毎分） |
| レスポンスヘッダ | `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（Unix time） |
| 超過時 | `429 Too Many Requests` |
| 公式推奨 | リクエストは直列化し、**Update / Search / Icon は1秒以上あける** |

出典: [Rate Limit](https://developer.nulab.com/docs/backlog/rate-limit/)

**設計への影響**: apply は並列化できない。更新 API 20 件なら 20 秒以上かかる。
plan の段階で所要時間を見積もって提示し、apply 中は進捗を出す必要がある。

ただし実測した更新系の上限は毎分 150（＝毎秒 2.5）で、公式推奨の1秒間隔はかなり保守的。
**プランによって上限が変わるため、値を決め打ちにせず `GET /api/v2/rateLimit` で取得する。**
この API は本文で値を返すので、ヘッダを読めないブラウザからでも使える。

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

**`roleType: 1` がスペース管理者（実測）。** 管理者権限を持つスペースでは 1、
持たないスペースでは 2 が返ることを、同一アカウントで複数スペースを比較して確認した。
1 以外の値（2 や 4 など）も実在する。
判定に必要なのは「1 か、それ以外か」だけなので、全数値の対応は不要。

## ステータス

| 制約 | 内容 |
| --- | --- |
| 既定ステータス | 4つが最初から存在する。表示名はスペースの言語設定で変わる |
| 既定ステータスの表示名 | [既定リソースの表示名](#既定リソースの表示名)を参照 |
| 既定ステータスの ID | **全プロジェクト共通で 1 / 2 / 3 / 4 の固定値**（実測）。プロジェクト固有の ID ではない |
| 既定ステータスの削除 | **できない**（実測）。`Default status cannot be deleted. id: 1` が返る |
| 既定ステータスのリネーム・色変更 | **できない**（実測）。`PATCH` は `No such status` を返す。プロジェクト固有のステータスしか更新対象にならない |
| 上限 | **1プロジェクトあたり合計 12**（既定4 + カスタム8）。超えると `The maximum number of status are 12 per project`（実測） |
| 色 | 10色の固定パレット。`#ea2c00` `#e87758` `#e07b9a` `#868cb7` `#3b9dbd` `#4caf93` `#b0be3c` `#eda62a` `#f42858` `#393939`。**`POST` の必須パラメータ**（[Add Status](https://developer.nulab.com/docs/backlog/api/2/add-status/) のリファレンス記載） |
| パレット外の色 | **拒否される**（実測）。`error.unknown : color` |
| 既定ステータスの色 | `#ed8077` / `#4488c5` / `#5eb5a6` / `#b0be3c`（実測）。**先頭3つはパレット外の値**で、既定ステータスだけが特別扱いされている |
| 新規カスタムの挿入位置 | **「完了」の直前に入る**（実測）。末尾ではない |
| 削除 | `substituteStatusId`（振替先ステータス）が**必須**。削除対象の課題は振替先に移される |
| 表示順 | `PATCH /projects/:key/statuses/updateDisplayOrder`。`statusId[]` に**プロジェクトの全ステータス**を渡す。一括なので1リクエストで済む |
| 順序制約 | 「未対応」が先頭、「完了」が末尾、「処理中」は「処理済み」より前でなければならない |

**既定ステータスは名前も色も変えられず、消すこともできない。**
したがって「既定の4枠を任意の名前に寄せる」ことはできず、
マニフェストに既定4つをそのまま書かせる方針が確定した。

既定ステータスは ID が 1〜4 の固定値なので、**ID で既定かどうかを判定できる**。
名前の一致で判定する必要はない。

カスタムステータスが「完了」の直前に挿入されるため、
記述順どおりに並べるには作成後に `updateDisplayOrder` を必ず呼ぶ。

## 課題種別

| 制約 | 内容 |
| --- | --- |
| 既定の課題種別 | タスク / バグ / 要望 / その他 の4つが最初から存在する |
| 削除 | `substituteIssueTypeId`（振替先）が**必須** |
| 最低件数 | **最低1件は残る**（実測）。4件から1件までは削除できるが、最後の1件は削除できない |
| 振替先の制約 | **削除対象と振替先を同一にはできない**（実測）。`deletedTargetIssueTypeId and substituteIssueTypeId are the same.` が返る。これが「最後の1件を消せない」実装上の理由 |
| 既定の課題種別と色 | タスク `#7ea800` / バグ `#990000` / 要望 `#ff9200` / その他 `#2779ca`（実測） |
| 色 | **10色の固定パレット**（実測）。`#e30000` `#990000` `#934981` `#814fbc` `#2779ca` `#007e9a` `#7ea800` `#ff9200` `#ff3265` `#666665`。**ステータスの10色とは完全に別の集合** |
| その他 | 件名テンプレート `templateSummary` / 詳細テンプレート `templateDescription` を設定できる |

| 表示順 | **変更する API が無い**。作成順で決まる |

課題種別の色パレットは、多数のプロジェクトの課題種別を走査して
**色の種類がちょうど 10 に収束する**ことを確認した（実測）。
既定4色はいずれもこの10色に含まれる。
ただし確認したのは「使われている色が10種類しかない」ことであって、
**パレット外の色を API が拒否するかは未確認**（作成には権限が要り、確認できていない）。

**設計への影響**: 「全部消してから定義通りに作る」は API 上できない。
必ず「定義のものを先に作る → 既定のものを新しいものへ振り替えて削除する」順序になる。
また表示順を制御する手段が無いため、Yaml の記述順を厳密に再現するには全削除・再作成しかない。
リクエスト数が跳ね上がるので、本ツールでは**課題種別の表示順は保証しない**方針を採る。

## カスタム属性（カスタムフィールド）

| 項目 | 内容 |
| --- | --- |
| 種別 | 1:文字列 / 2:文章 / 3:数値 / 4:日付 / 5:単一リスト / 6:複数リスト / 7:チェックボックス / 8:ラジオ |
| 共通パラメータ | `name`（必須）, `typeId`（必須）, `description`, `required`, `applicableIssueTypes[]`（空なら全種別） |
| 更新できない項目 | **`typeId` は [Update Custom Field](https://developer.nulab.com/docs/backlog/api/2/update-custom-field/) のパラメータに無い**。型を変えるには削除して作り直すしかない |
| 数値型 | `min` `max` `initialValue`（Number）/ `unit`（String） |
| 日付型 | `min` `max` `initialDate` は **String（yyyy-MM-dd）**。`initialValueType`（Number。1:当日 2:当日+シフト 3:指定日）`initialShift`（Number） |

**`min` / `max` はキー名が共有されているが型が違う。** 数値型は Number、日付型は
yyyy-MM-dd の String（[Add Custom Field](https://developer.nulab.com/docs/backlog/api/2/add-custom-field/) のリファレンス記載）。
| リスト型 | `items[]` `allowInput` `allowAddItem` |

`applicableIssueTypes[]` が課題種別 ID を要求するため、
**カスタム属性の作成は課題種別の作成より後**でなければならない。

プランによる利用可否の制限は、参照したリファレンスには記載が無かった。`要検証`。

## プロジェクト基本設定

`POST /api/v2/projects` で指定できる項目（すべて Yaml の管理対象になり得る）。
**必須は `name` と `key` の2つだけで、残りはすべて Optional**
（[Add Project](https://developer.nulab.com/docs/backlog/api/2/add-project/) のリファレンス記載）。
省略した項目は Backlog 側の既定値が適用されるため、ツールが既定値を持つ必要はない。

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

**並べ替えできないリソースが実際どう並ぶか（実測）。**

| リソース | 挙動 |
| --- | --- |
| マイルストーン（版） | 作成時に `displayOrder` が連番で振られる。**作成順に並ぶ** |
| カテゴリー | API 作成時の `displayOrder` は `2147483646` 固定。全要素が同値になり、同値のときは ID 順（＝作成順）で返る。**結果として作成順に並ぶ** |
| 課題種別 | 作成順に並ぶ |

いずれもマニフェストの記述順に作成すれば、結果として記述順に並ぶ。
ただし**既存要素が残っている場合、新規は必ずその後ろに付く**ため、
既存を含めた任意の並びは実現できない。

## プロジェクトメンバー・チーム

| 項目 | 内容 |
| --- | --- |
| プロジェクト参加者の取得 | `GET /projects/:key/users`。**`excludeGroupMembers`（既定 false）** を true にすると、チーム経由の参加者を除外して個人参加者だけを返す |
| プロジェクトへの個人追加 | `POST /projects/:key/users`（`userId`）。1人1リクエスト |
| プロジェクトへのチーム追加 | `POST /projects/:key/teams`（`teamId`）。1チーム1リクエスト |
| プロジェクト管理者の付与 | `POST /projects/:key/administrators`（`userId`）。**Administrator 権限必須**。個人単位でしか付与できず、チームごと管理者にはできない |
| プロジェクト管理者の取得 | `GET /projects/:key/administrators`（実測）。ユーザーの配列を返す。**管理者の削除差分を出せる** |
| スペースのチーム一覧 | `GET /api/v2/teams`。**各チームに `members[]`（ユーザーオブジェクトの配列）が含まれる**（実測）。プロジェクトに未参加のチームについても所属者が分かる |

`excludeGroupMembers` を取り違えると、チーム経由で参加している人を
「Yaml の `members` に無いから削除」と誤判定する。削除判定では必ず true を指定すること。

**プロジェクト管理者の付与には、対象が事前にプロジェクト参加者である必要がある（実測）。**
未参加のユーザーを管理者にしようとすると `No such project member` が返り、付与されない。
したがって管理者に指定された人を先に参加させる処理は、任意の最適化ではなく**必須**。

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

## Webhook

| 項目 | 内容 |
| --- | --- |
| 追加 | `POST /projects/:key/webhooks`。Administrator / Project Administrator |
| パラメータ | `name` `description` `hookUrl` `allEvent`(Boolean) `activityTypeIds[]`(Number 複数) |
| `allEvent` | true にすると全イベントを通知する。個別指定が不要になる |

### activityTypeId の一覧

| ID | イベント | ID | イベント |
| --- | --- | --- | --- |
| 1 | Issue Created | 25 | Project Group Added |
| 2 | Issue Updated | 26 | Project Group Deleted |
| 3 | Issue Commented | 36 | Document Created |
| 4 | Issue Deleted | 37 | Document Deleted |
| 5 | Wiki Created | 38 | Document Title Updated |
| 6 | Wiki Updated | 39 | Document Revision Updated |
| 7 | Wiki Deleted | 40 | Document Commented |
| 8 | File Added | 41 | Document Comment Updated |
| 9 | File Updated | 42 | Document Comment Deleted |
| 10 | File Deleted | 43 | Document Comment Reply Created |
| 11 | SVN Committed | 44 | Document Comment Reply Updated |
| 12 | Git Pushed | 45 | Document Comment Reply Deleted |
| 13 | Git Repository Created | 46 | Document Attachment Added |
| 14 | Issue Multi Updated | 48 | Document Multi Created |
| 15 | Project User Added | 49 | Document Mentioned |
| 16 | Project User Deleted | | |
| 17 | Comment Notification Added | | |
| 18 | Pull Request Added | | |
| 19 | Pull Request Updated | | |
| 20 | Comment Added on Pull Request | | |
| 21 | Pull Request Deleted | | |
| 22 | Milestone Created | | |
| 23 | Milestone Updated | | |
| 24 | Milestone Deleted | | |

出典: [Get Recent Updates](https://developer.nulab.com/docs/backlog/api/2/get-recent-updates/)

**27〜35 と 47 は欠番。** Document 関連が 36 番以降に後から追加されており、
今後もイベントが増える。番号が連番でも網羅的でもないことが、
マニフェストで名前も書けるようにする理由になっている。

## Git リポジトリ

| 操作 | 可否 |
| --- | --- |
| 一覧取得 `GET /projects/:key/git/repositories` | できる |
| 個別取得 `GET /projects/:key/git/repositories/:repo` | できる |
| プルリクエストの作成・更新・コメント | できる |
| **リポジトリの作成・更新・削除** | **エンドポイントが存在しない**（実測・ドキュメントとも） |

1プロジェクトに複数のリポジトリを持てることは実測で確認した。
返却されるのは `id` `name` `description` `httpUrl` `sshUrl` `hookUrl` `displayOrder`
`pushedAt` `created` `updated` `createdUser` `updatedUser`。

**Git 機能はスペース／プラン単位で無効化され得る（実測）。**
無効なスペースでは参照系も `msg.featureRestrictedError.title.git`（code 5）を返す。

## その他の関連 API

| 用途 | エンドポイント |
| --- | --- |
| 課題件数の確認 | `GET /api/v2/issues/count?projectId[]=N` → `{"count": 43}`。全ロール利用可。**完了済みを含む全ステータスを数える**（実測） |
| 実行者の確認 | `GET /api/v2/users/myself` |
| スペースのユーザー一覧 | `GET /api/v2/users`（Yaml のユーザー ID → 数値 ID 解決に使う） |
| スペースのチーム一覧 | `GET /api/v2/teams`（Yaml のチーム名 → teamId 解決に使う） |
| プロジェクトのチーム | `GET` / `POST /api/v2/projects/:key/teams`（`teamId` を指定） |

## 確認済みであること

当初 `要検証` としていた項目は、実 API を叩いてすべて解消した。

| 項目 | 結果 |
| --- | --- |
| `roleType` と役割の対応 | 1 = スペース管理者。判定に必要なのは「1 か否か」だけ |
| 既定ステータスのリネーム・色変更 | **できない** |
| 既定ステータスの削除 | **できない**（明示的なエラーが返る） |
| ステータスの上限 | 1プロジェクト合計 12 |
| パレット外の色 | 拒否される |
| 課題種別の色 | 既定4つの色を実測で確定 |
| 課題種別の下限 | 最低1件。振替先を自分自身にはできない |
| CORS プリフライトと API キーの渡し方 | `Backlog-API-Key` ヘッダで可。`expose-headers` が無くレート制限ヘッダは読めない |
| 更新系リクエストの本文の形式 | form-urlencoded、配列は `key[]` の繰り返し（[リクエストの形式](#リクエストの形式)） |
| 管理者付与の前提 | 事前のプロジェクト参加が必須 |
| カテゴリー・マイルストーンの表示順 | いずれも作成順 |
| `GET /projects/:key/administrators` の存在 | **存在する。** ユーザー配列を返す |
| `GET /teams` にメンバーが含まれるか | **含まれる。** `members[]` にユーザーオブジェクトの配列 |
| `issues/count` が数える範囲 | **完了済みを含む全件。** 全件数が、ステータス別に数えた件数の合計と一致することを確認した |
| 課題種別の色 | **10色の固定パレット**（観測による。拒否挙動は未確認） |

## 実装中に見つかった事項（実測で確定）

実装を進める過程で文書に記述が無かった点を、検証用スペースで実測して確定させた。

| # | 確認したこと | 結果 |
| --- | --- | --- |
| 1 | マイルストーンとカスタム属性の日付の形式 | **`yyyy-MM-ddT00:00:00Z`** で返る。時刻は常に `T00:00:00Z` なので、**先頭10文字の切り詰めでタイムゾーンのずれは起きない** |
| 2 | カテゴリー / マイルストーン / カスタム属性 / Webhook の更新・削除 | 通常形。同じパスに `:id` を足して `PATCH` / `DELETE` |
| 3 | プロジェクトメンバー / チーム / 管理者の削除 | 追加と同じパスへ `DELETE`。パラメータも追加時と同じ（`userId` / `teamId`） |
| 4 | `GET /rateLimit` の本文 | `rateLimit.{read,update,search,icon}.{limit,remaining,reset}`。仮定どおり |
| 5 | `applicableIssueTypes` の絞りの解除 | **`applicableIssueTypes[]=`（空の値を1つ）を送れば解除できる。** 省略した場合は現状維持（K-3 が成立） |
| 6 | プロジェクト画面の URL | `https://<space>/projects/<KEY>` |

残っているのは**英語スペースでの既定リソースの表示名**だけで、検証用スペースの言語が `ja` のため
そこからは確認できない（[既定リソースの表示名](#既定リソースの表示名)）。

### 空配列を送る方法

`qs` は空配列をキーごと落とす。**絞りを解除するには `applicableIssueTypes[]=` を明示的に送る**
必要があり、値の配列をそのまま渡すだけでは本文に現れない。送信層がこの変換を持つ。

### チーム経由のみの参加者には管理者を付与できない

`POST /projects/:key/administrators` は `No such project member` を返す（実測）。
[core のデータモデル §6.3](../design/core-reconciler.md#63-access-の差分算出) が安全側に倒して
「個人参加していない管理者には必ず個人参加の Action を出す」としていたのは、
**任意の最適化ではなく必須の制約**だった。A-3 と同じ扱いになる。

`GET /projects/:key/users` は既定でチーム経由の参加者も返し、`excludeGroupMembers=true` で
個人参加者だけになることも実測で確認した。

### 既定課題種別の並び

`GET /projects/:key/issueTypes` は**表示順**で返る。**ID の昇順ではない**（実測で、2番目に並ぶ
リソースの ID が1番目より小さい例を確認）。新規プロジェクトの枠を「返ってきた順」で割り当てる
（[§4.1](../design/core-reconciler.md#41-フェーズと-read)）のは、この並びに依存している。

## 残る未検証事項

| 項目 | 備考 | 確認に必要なもの |
| --- | --- | --- |
| パレット外の色を API が拒否するか（課題種別） | 10色に収束することは観測済み。拒否されるなら JSON Schema の enum にできる | 課題種別の作成権限 |
| 管理者付与にチーム経由の参加で足りるか | 足りるなら、個人参加 Action を1件減らせる | スペース管理者権限 + チーム |
| カスタム属性のプランによる利用可否 | 利用可能なプランでしか確認していない | 別プランのスペース |
| チーム機能のプラン制限 | 同上 | 同上 |
| `useDevAttributes: false` 時のマイルストーン・版の扱い | 整合性検証を厳密にするなら要確認 | スペース管理者権限 |

上2件は**実装の骨格に影響する**が、いずれも書き込みを伴うため未実施。

下3件はプラン差に関わるもので、実装の骨格には影響しない。
