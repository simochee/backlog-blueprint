# plan の出力仕様

最終更新: 2026-09-19
前提: [要件定義 FR-3](../requirements/requirements-definition.md#fr-3-計画dry-run) / [core のデータモデル](core-reconciler.md)

人間向け（`--output text`）と機械向け（`--output json`）の両方を定義する。
どちらも同じ `Action[]` を描画するだけで、内容は同一。

## 1. 人間向け出力

### 1.1 形式

記号ベース（Terraform 風）を採る。

以下は**本文書を通して使う例**。存在しない `PROJ_A` に対し、
課題種別に タスク（既定のまま）/ バグ（テンプレート追加）/ 調査（`oldname: その他`）を、
ステータスに既定4つ + レビュー中を、`access` に 開発チーム と suzuki を、
Webhook に Slack 通知を宣言したマニフェストを適用する。

```
Blueprint: PROJ_A (example.backlog.com)
Project does not exist and will be created.

  + project        PROJ_A "プロジェクトA"
  ↻ refresh        reading back default issue types and statuses
  ~ issueType      "バグ"
      templateSummary: (none) -> "【不具合】"
  ~ issueType      "調査"         renamed from "その他"
  - issueType      "要望"
  + status         "レビュー中"    color "#3b9dbd"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "suzuki"
  + webhook        "Slack 通知"   hookUrl ***

Warnings:
  ! [V-A16] access.members: "suzuki" already belongs to team "開発チーム"

Plan: 5 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 9 (estimated 9s)
```

一致している5件（タスクと既定ステータス4つ）は既定では表示されない（§1.2）。
`↻ refresh` は GET なので更新系の件数には入らない。

| 記号 | `op` | 意味 |
| --- | --- | --- |
| `+` | `create` | 作成される |
| `~` | `update` / `reorder` | 更新される |
| `-` | `delete` | 削除される |
| `=` | `noop` | 一致しているので何もしない |
| `↻` | `refresh` | 作成直後の既定リソースを読み直す（GET のみ） |
| `!` | — | 警告 |

削除行に振替先を添えない理由は要件定義 FR-3.3 の通り。対象が課題0件のプロジェクトに
限られる以上、振替先に移る課題は常に0件になる。

### PO-1: `oldname` によるリネームは `+` ではなく `~` で表す

`oldname` の対象が存在すれば、`Action` は `create` ではなく `update` になる
（[差分算出規則](core-reconciler.md#62-oldname-の解釈)）。
利用者から見れば「新しい課題種別が増える」ので `+` と書きたくなるが、それは採らない。

要件定義 L-6 の効果は「削除＋作成の2リクエストが更新1リクエストになる」ことにある。
`+` と描くと、`-` が見当たらないのにリクエスト数が1しか増えない理由を説明できず、
**`oldname` を書いた甲斐が plan の上で見えなくなる**。
`~ ... renamed from "その他"` なら、1リクエストで済んでいることが読める。

**採らなかった案。**

| 案 | 採らない理由 |
| --- | --- |
| 表形式 | 列幅を固定すると `before -> after` のような長い値が入らない。日本語の文字幅で整列が崩れる |
| リソース種別ごとのセクション | マニフェストとの対応は取りやすいが、行数が倍近くになり、更新系が何件あるかを一目で数えにくい |

記号ベースには「IaC 利用者に馴染みがある」以外に、**行指向で `grep` しやすい**という実利がある。
`blueprint plan -f x | grep '^  -'` で削除だけを抜ける。

### 1.2 表示規則

| 規則 | 内容 |
| --- | --- |
| 並び順 | `Action[]` の順（＝適用順序）。フェーズをまたいでも並べ替えない |
| `noop` の表示 | 既定では**表示しない**。件数のみ集計に出す。`--show-unchanged` で展開する |
| 変更点の展開 | `~` の行の下に `field: before -> after` をインデントして並べる。`(none)` は未設定 |
| リソース名 | 利用者が Backlog 上で付けた名前はそのまま出す（翻訳しない。要件定義 §5.3） |
| ツールのメッセージ | 英語のみ（NFR-9） |
| マスク | `Secret`（`${ENV}` 由来）は `***`。Yaml に直接書かれた値は出す（E-4 / E-5） |
| 色 | TTY のときのみ。`--no-color` と環境変数 `NO_COLOR` を尊重する |
| 警告 | 本体の後に `Warnings:` セクションでまとめる。検証 ID を必ず付ける |

`noop` を既定で隠すのは、既定の課題種別4件をそのまま使う雛形（L-2 の推奨形）で
一致行が支配的になり、実際に起きることが埋もれるため。
一方で「一致しているので 0 リクエスト」は本ツールの売りなので、集計には必ず出す。

### 1.3 フッタ

```
Plan: 4 to add, 2 to change, 1 to destroy, 9 unchanged.
Write requests: 8 (estimated 8s)
```

| 項目 | 定義 |
| --- | --- |
| to add / to change / to destroy | `create` / `update` + `reorder` / `delete` の件数 |
| unchanged | `noop` の件数 |
| Write requests | `writeRequest: true` の Action 数。`refresh` と `noop` は含まない |
| 進捗の分母（apply） | **実行される Action 数**。`noop` を除き、`refresh` を含む。上の例では 10 |
| estimated | Write requests × 1秒（X-1）。切り上げ。60 秒以上は `2m 30s` 形式 |

**差分なし**（終了コード 0）の定義は「`writeRequest: true` の Action が 0 件」。
`refresh` は新規プロジェクトのときしか出ず、そのときは必ず `project/create` があるので、
この定義で判定が食い違うことはない。

差分が無いときは本体を出さず、1行で済ませる。

```
Blueprint: PROJ_A (example.backlog.com)
No changes. The project already matches the manifest.
```

### 1.4 適用後の表示順

表示順を制御できないリソース（課題種別・カテゴリー・マイルストーン・カスタム属性）は、
**適用後に実際どう並ぶか**を示す（要件定義 §2.4）。
記述順と一致するなら黙り、ずれるときだけ警告（V-A15）と一緒に出す。

以下は通し例とは**別のシナリオ**。既にカテゴリー「インフラ」がある課題0件のプロジェクトに、
フロントエンド / バックエンド / インフラ の順で宣言した場合。

```
Warnings:
  ! [V-A15] categories: resulting order differs from manifest
      manifest: フロントエンド, バックエンド, インフラ
      result:   インフラ, フロントエンド, バックエンド
      New items are always appended after existing ones; there is no reorder API.
```

`hint` に「なぜそうなるか」を必ず添える。V-A15 は直しようがない場合があるので、
「直せ」ではなく「そうなることを知っておけ」という情報として出す。

## 2. 機械向け出力（`--output json`）

### 2.1 構造

```json
{
  "formatVersion": 1,
  "tool": { "name": "@simochee/backlog-blueprint", "version": "0.1.0" },
  "space": "example.backlog.com",
  "manifest": { "path": "projects/PROJ_A.yaml" },
  "project": { "key": "PROJ_A", "name": "プロジェクトA", "exists": false },
  "summary": {
    "hasChanges": true,
    "create": 5, "update": 2, "delete": 1, "reorder": 1, "noop": 5,
    "writeRequests": 9,
    "estimatedSeconds": 9
  },
  "diagnostics": [
    {
      "id": "V-A16",
      "severity": "warning",
      "stage": "plan",
      "path": "access/members/0",
      "message": "\"suzuki\" already belongs to team \"開発チーム\"",
      "hint": "Remove it from access.members to save one write request."
    }
  ],
  "actions": [
    {
      "id": "issueTypes/update/調査",
      "phase": 2,
      "kind": "issueType",
      "op": "update",
      "name": "調査",
      "writeRequest": true,
      "target": { "$ref": { "kind": "issueType", "name": "その他" } },
      "notes": [{ "type": "renamed", "from": "その他" }],
      "changes": [
        { "field": "name",  "before": "その他",   "after": "調査" },
        { "field": "color", "before": "#2779ca", "after": "#2779ca" }
      ],
      "request": {
        "method": "PATCH",
        "path": "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:その他}",
        "params": { "name": "調査", "color": "#2779ca" }
      }
    }
  ],
  "resultingOrder": {
    "issueTypes": ["タスク", "バグ", "調査"],
    "statuses": ["未対応", "処理中", "レビュー中", "処理済み", "完了"],
    "categories": [],
    "milestones": [],
    "customFields": []
  }
}
```

### 2.2 決定

| ID | 決定 | 理由 |
| --- | --- | --- |
| PO-2 | `noop` の Action も**必ず含める** | 人間向けとは逆。消費側が「一致している」と「マニフェストに無い」を区別できる必要がある。`--show-unchanged` は人間向け出力にのみ効く |
| PO-3 | `request`（実際に飛ぶ HTTP リクエスト）を含める | 「何が起きるか」の最も正確な表現。PR コメントに貼るだけでなく、監査・不具合報告にそのまま使える |
| PO-4 | `Secret` は `"***"` にシリアライズされる | `Secret.toJSON()` がマスクを返すので、`request.params` に載っていても漏れない（NFR-3 / AC-10） |
| PO-5 | 未解決の `Ref` はそのまま `{"$ref":{...}}` として出す | 適用前に ID が存在しないという事実を、偽の値で埋めずに表現する |
| PO-6 | `formatVersion` は整数。**破壊的変更のときだけ**上げる | キーの追加は上げない。消費側は未知のキーを無視する前提で書けばよい |
| PO-7 | stdout には JSON **だけ**を書く | `\| jq` が素通しで動く。進捗・警告・ログは stderr（[CLI 仕様](cli-and-web-ui.md#13-標準出力と標準エラー出力)） |

PO-3 は「実装の詳細を晒す」という見方もできるが、本ツールの `plan` の約束は
「apply で何が起きるか」であり、飛ぶリクエストこそがその答えである。
中断レポート（FR-4.4）で失敗したリクエストを示すときも同じ構造を使える。

**採らなかった案: `formatVersion` を持たず、CLI の semver を頼りにする。**
消費側がツールのバージョンから出力形式を推測することになる。
マニフェストの `$schema` と CLI の semver を一致させた
[D-2](manifest-versioning.md#3-本プロジェクトの決定) とは事情が違い、
JSON 出力は「壊れない限りバージョンを上げない」ほうが消費側が楽になる。

## 3. apply の出力

`apply` は plan と同じ描画を出したうえで、確認プロンプトと進捗を重ねる。

### 3.1 text

```
Blueprint: PROJ_A (example.backlog.com)
...（plan と同じ本体）...

Plan: 5 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 9 (estimated 9s)

Do you want to apply these changes?
  Only "yes" will be accepted to confirm.

  Enter a value: yes

[ 1/10] + project        PROJ_A ... done
[ 2/10] ↻ refresh        reading back default issue types and statuses ... done
[ 3/10] ~ issueType      "バグ" ... done
[ 4/10] ~ issueType      "調査" ... done
...
Apply complete. 5 added, 3 changed, 1 destroyed.
```

### 3.2 中断時（FR-4.4）

```
[ 5/10] - issueType      "要望" ... failed

ERROR  DELETE /api/v2/projects/PROJ_A/issueTypes/1234
  400  deletedTargetIssueTypeId and substituteIssueTypeId are the same.

Apply aborted. Nothing has been rolled back.

Applied (4):
  + project        PROJ_A
  ↻ refresh
  ~ issueType      "バグ"
  ~ issueType      "調査"
Failed (1):
  - issueType      "要望"
Not applied (5):
  + status         "レビュー中"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "suzuki"
  + webhook        "Slack 通知"

Re-run apply with the same manifest to continue. Already applied changes become no-ops.
The project must still have zero issues at that point.
```

最後の2行が要点。state ファイルを持たない設計（非スコープ）なので、
**中断からの再開手段は「同じマニフェストでもう一度 apply する」以外に無い**。
冪等（NFR-4）だからそれで足りることを、中断した本人に必ず伝える。

ただし無条件ではない。再実行までの間に誰かが課題を1件でも作ると V-B3 で止まり、
**そのプロジェクトは二度とツールで触れなくなる**
（[適用対象の限定 §7.3](validation-pipeline.md#73-中断後の再開は保証されない)）。
「続きから進む」とだけ書いて、その条件を書かないのは嘘になる。

### 3.3 JSON

`--output json` の `apply` は、実行が終わってから1つの JSON を出す。
plan の構造に `result` と実行結果を足したもの。

```json
{
  "formatVersion": 1,
  "result": "aborted",
  "summary": { "...": "plan と同じ" },
  "applied": ["project/create/PROJ_A", "project/refresh", "issueTypes/update/バグ", "issueTypes/update/調査"],
  "failed": {
    "id": "issueTypes/delete/要望",
    "request": { "method": "DELETE", "path": "/api/v2/projects/PROJ_A/issueTypes/1234" },
    "status": 400,
    "errors": [{ "message": "deletedTargetIssueTypeId and substituteIssueTypeId are the same." }]
  },
  "pending": ["statuses/create/レビュー中", "statuses/reorder", "projectTeams/create/開発チーム", "projectMembers/create/suzuki", "webhooks/create/Slack 通知"],
  "actions": ["...", "plan と同じ配列"]
}
```

`result` は `succeeded` / `aborted` / `rejected`（確認プロンプトで拒否）。
`applied` / `pending` は `Action.id` の配列。`id` が安定している（[Action の定義](core-reconciler.md#22-action)）ことがここで効く。

`failed.status` は**任意**である。タイムアウト・名前解決の失敗・ブラウザの CORS 失敗のように
HTTP のやり取りが成立しなかった場合、ステータスは存在しない。そのときは `status` を省き、
`errors[]` にだけ内容を入れる。消費側は `status` の有無で「Backlog が拒否した」と
「Backlog に届かなかった」を判別できる。

存在しないステータスを `0` などで埋める案は採らない。未解決の `Ref` を偽の ID で
埋めないこと（PO-5）と同じ理由で、無い値は無いまま表す。

進捗を逐次 JSON で流す（JSON Lines）案は採らない。
`--output json` の消費者は CI のスクリプトであり、
途中経過ではなく最終結果を1つの値として受け取りたい。
途中経過が要る場面では `--output text` の stderr を読めばよい。

## 4. 判断理由のまとめ

| ID | 決定 | 採らなかった案と理由 |
| --- | --- | --- |
| PO-1 | `oldname` のリネームは `~` | `+`。リクエストが1しか増えない理由を説明できず、`oldname` を書いた効果が plan で見えない |
| PO-8 | 記号ベースの人間向け出力 | 表形式（長い値と日本語幅で崩れる）/ セクション別（行数が増え、更新系の件数が読みにくい） |
| PO-9 | `noop` は人間向けでは隠し、集計に出す | 常に表示。推奨形の雛形ほど一致行が支配的になり、起きることが埋もれる |
| PO-2 | JSON には `noop` も含める | 人間向けと同じ扱い。消費側が「一致」と「未記述」を区別できない |
| PO-3 | JSON に HTTP リクエストを含める | 含めない。plan の約束（何が起きるか）を最も正確に表す情報を落とすことになる |
| PO-6 | `formatVersion` は破壊的変更時のみ | CLI の semver に追随。消費側がバージョン対応表を持つ羽目になる |
| PO-10 | apply の JSON は最終結果1つ | JSON Lines で逐次。消費者は CI であり、途中経過を求めていない |
