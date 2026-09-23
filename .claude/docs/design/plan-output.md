# plan の出力仕様

最終更新: 2026-09-20
前提: [要件定義 FR-3](../requirements/requirements-definition.md#fr-3-計画dry-run) / [core のデータモデル](core-reconciler.md)

人間向け（`--output text`）と機械向け（`--output json`）の両方を定義する。
どちらも同じ `Action[]` を描画するだけで、内容は同一。

## 1. 人間向け出力

### 1.1 形式

記号ベース（Terraform 風）を採る。

以下は**本文書を通して使う例**。**課題0件の既存プロジェクト** `PROJ_A`（UC-2）に対し、
課題種別に タスク（既定のまま）/ バグ（テンプレート追加）/ 調査（`oldname: その他`）を、
ステータスに既定4つ + レビュー中を、`access` に 開発チーム と 鈴木 花子 を、
Webhook に Slack 通知を宣言したマニフェストを適用する。

```
Blueprint: PROJ_A (example.backlog.com)

  ~ issueType      "バグ"
      templateSummary: (none) -> "【不具合】"
  ~ issueType      "調査"         renamed from "その他"
  - issueType      "要望"
  + status         "レビュー中"    color "#3b9dbd"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "鈴木 花子"
  + webhook        "Slack 通知"   hookUrl "https://hooks.example.com/T000/B000"

Warnings:
  ! [V-A16] access.members: "鈴木 花子" already belongs to team "開発チーム"

Plan: 4 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 8 (estimated 8s)
```

**既存プロジェクトを例にしているのは、`oldname` の効果（PO-1）と削除を同時に見せられるため。**
新規プロジェクトでは既定課題種別の名前が分からないので、同じマニフェストでも描かれ方が変わる
（[core のデータモデル §4.1](core-reconciler.md#41-フェーズと-read)）。

```
Blueprint: PROJ_A (example.backlog.com)
Project does not exist and will be created.

  + project        PROJ_A "プロジェクトA"
  ↻ refresh        reading back default issue types and statuses
  + issueType      "タスク"
  + issueType      "バグ"
  + issueType      "調査"
  - issueType      (unused default)
  ...
```

**既定の枠を引き継ぐ3件は `+` で描かれ、`renamed from` は付かない。** 利用者は何も無いところに
宣言しただけで、引き継ぎはツールが勝手に行う最適化だからである（PO-1 の適用範囲）。
余った4つ目の枠は名前が分からないので `(unused default)` と描く。

**例の空白は読みやすさのために手で揃えたもので、桁揃えの仕様ではない。**
実装は記号とリソース種別の幅だけを揃え、その右は2スペース区切りとする。
文字の幅を数えて右側まで揃える案は、PO-8 が表形式を退けた理由（日本語の文字幅で崩れる）に当たる。

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

**PO-1 が対象とするのは、利用者が `oldname` を書いた場合だけである。**
新規プロジェクトで既定課題種別の枠を引き継ぐ場合は、利用者が何も書いていないので `+` で描く
（[core のデータモデル §4.1](core-reconciler.md#41-フェーズと-read)）。`renamed from` も添えない。

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
| 変更点の展開 | `~` の行の下に `field: before -> after` をインデントして並べる。`(none)` は未設定。**`before` と `after` が同じ項目は描かない**（§2.2） |
| リソース名 | 利用者が Backlog 上で付けた名前はそのまま出す（翻訳しない。要件定義 §5.3） |
| 余った既定の枠 | 新規プロジェクトで余った既定課題種別の削除は `- issueType  (unused default)` と描く。`Action.name` は位置を表す数字だが、それを利用者に見せる意味が無い（[core §4.1](core-reconciler.md#41-フェーズと-read)） |
| ツールのメッセージ | 英語のみ（NFR-9） |
| 値 | `${ENV}` 由来も含めて変更前後の実値を出す（E-8）。API キーは計画に含めない（NFR-3） |
| 色 | **書き出す先のストリームが TTY のときだけ**。本文は stdout、診断・進捗・警告は stderr（[§1.3](cli-and-web-ui.md#13-標準出力と標準エラー出力)）なので、**2つを別々に判定する**。`--no-color` と環境変数 `NO_COLOR` はどちらも無効化する |
| 警告 | 本体の後に `Warnings:` セクションでまとめる。検証 ID を必ず付ける |

ストリームごとに判定するのは、`blueprint plan -f x | grep '^  -'` を成立させるためである（PO-8）。
パイプすると stdout は TTY でなくなるので本文から色が消えるが、**端末に出ている stderr の
エラーは色付きのまま**でよい。1つの真偽値で両方を決めると、どちらかが必ず不自然になる。

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
      "message": "\"鈴木 花子\" already belongs to team \"開発チーム\"",
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
| PO-11 | `Action.changes` は**リクエストに載る全フィールド**を持つ。値が変わらない項目も含める | 「何を送るか」を JSON が完全に表すため（PO-3 と同じ理由）。人間向け出力が変わった項目だけを描くのは**描画側の絞り込み**であって、データを間引いているのではない |
| PO-12 | 参照を持つフィールド（`applicableIssueTypes` / ステータスの表示順）の `changes` は、ID や `Ref` ではなく**名前**で表す | `changes` は人間が読む差分である。`request.params` が ID や `Ref` を持つのとは形が違ってよい |
| PO-3 | `request`（実際に飛ぶ HTTP リクエスト）を含める | 「何が起きるか」の最も正確な表現。PR コメントに貼るだけでなく、監査・不具合報告にそのまま使える |
| PO-4 | `request.params` の値をそのまま JSON に出す | 値を伏せると PO-3 の「実際に飛ぶリクエスト」でなくなる。API キーは `Action` に載らないので、そのまま出しても NFR-3 / AC-10 は保たれる |
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

## 2.3 `validate --output json`

`validate` は計画を持たないので、plan の構造から計画に関わる項目を落とした形にする。

```json
{
  "formatVersion": 1,
  "tool": { "name": "@simochee/backlog-blueprint", "version": "0.1.0" },
  "manifest": { "path": "projects/PROJ_A.yaml" },
  "diagnostics": []
}
```

`space` と `project` は無い。`validate` は Backlog に一切アクセスせず（CL-1）、
プロジェクトが存在するかも知らないため。

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

レート制限による待機（`ExecutionEvent` の `waiting`。X-4）は、進捗の行の後に1行足す。

```
[ 5/10] + status         "レビュー中" ... rate limited, waiting 42s
```

X-1 の1秒間隔では何も出さない。`waiting` が流れるのは 429 を受けたときだけで
（[core §7.1](core-reconciler.md#71-レート制限の扱い)）、毎回 1 秒の待機を報告しても
利用者の判断材料にならない。

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
  + projectMember  "鈴木 花子"
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

確認プロンプトで拒否したときは1行で終える。

```
Apply cancelled. Nothing has been applied.
```

何も書かずに終了コード 1 を返すと、拒否と失敗が区別できない。

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
  "pending": ["statuses/create/レビュー中", "statuses/reorder", "projectTeams/create/31", "projectMembers/create/12", "webhooks/create/Slack 通知"],
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
| PO-11 | `changes` は全フィールド、描画側で絞る | `changes` を差分のある項目だけにする。JSON から「送るが変わらない項目」が消え、`request.params` と突き合わせられなくなる |
