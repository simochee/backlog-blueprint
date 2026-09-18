# core のデータモデルと reconciler

最終更新: 2026-09-18
前提: [要件定義 §6 適用順序](../requirements/requirements-definition.md#6-適用順序) / [要件定義 §7 アーキテクチャ](../requirements/requirements-definition.md#7-アーキテクチャ) / [API 制約](../research/backlog-api-constraints.md)

`core` の中心は「リソース種別ごとの reconciler が `Action[]` を吐き、共通の Executor がそれを直列に流す」構造。
plan と apply は**同じ `Action[]` を見る**。plan は流さないだけ。

```
manifest ──[ reconciler.read() ]──▶ Snapshot ──[ reconciler.plan() ]──▶ Action[]
                 GET のみ                          純粋関数              │
                                                                        ├─▶ plan: 描画するだけ
                                                                        └─▶ apply: Executor が直列実行
```

## 1. 責務の分割

### C-1: reconciler は `read` と `plan` だけを持ち、`apply` は持たない

| 決定 | 内容 |
| --- | --- |
| C-1 | `Reconciler` のインターフェースは `read()`（GET のみ）と `plan()`（純粋関数）の2つ。適用は全リソース共通の `Executor` が `Action[]` に対して行う |

要件定義 NFR-8 は当初 reconciler が「現状取得 → 差分算出 → **適用**」を持つと書いていた。
その理由欄にある狙い —— *「plan と apply が同じ `Action[]` を扱うので『plan に出ないのに apply で起きる』が
構造的に消える」* —— を満たすには、適用を reconciler から取り上げたほうが強い。

reconciler が `apply(actions)` を持つと、その中で `Action[]` に現れない API 呼び出しを
書けてしまう。「構造的に消える」と言いながら、消えるかどうかが各 reconciler の行儀に依存する。
`Action` を唯一の実行単位にすれば、依存しなくなる。

副次的に、横断的な関心事が1箇所に集まる。

| 関心事 | 共通 Executor にある場合 | reconciler ごとにある場合 |
| --- | --- | --- |
| 1秒間隔（NFR-1） | 1箇所 | 全 reconciler が正しく実装する前提になる |
| 429 の再試行（NFR-2） | 1箇所 | 同上 |
| 進捗 N/M（FR-4.5） | 全体の M が自然に出る | reconciler をまたいだ通し番号を別途管理する必要がある |
| 中断レポート（FR-4.4） | 適用済み／未適用が `Action[]` の位置で決まる | 各 reconciler が自分の進捗を報告し合う必要がある |

NFR-8 の文言はこの決定に合わせて更新済み。

**採らなかった案: reconciler ごとに `apply` を持つ。**
ステータスの表示順更新のようなリソース固有の後処理をその場に書ける利点はあるが、
表示順更新も `Action`（`op: reorder`）として表現できるため、その利点は実在しない。

### C-2: `plan()` は純粋関数。ネットワークにアクセスしない

| 決定 | 内容 |
| --- | --- |
| C-2 | 計画の算出に必要な GET は `read()` ですべて済ませる。`plan()` は `(desired, snapshot, ctx) => Action[]` の純粋関数 |

得られるもの。

1. **FR-3.1（plan は GET しか行わない）を型で保証できる。** `plan()` に HTTP クライアントを渡さない
2. **計画のテストに実 API が要らない。** スナップショットを組み立てれば全パターンを検証できる
3. **GET の回数が事前に決まる。** read 段階でレート制限の消費量が確定する
4. plan と apply で `plan()` の入力が完全に同じになる（NFR-6）

例外は §4 の「フェーズ1直後の再取得」1箇所だけ。例外を1つに閉じ込めることが目的。

## 2. 型

### 2.1 リソース種別と操作

```ts
type ResourceKind =
  | 'project'
  | 'issueType'
  | 'status'
  | 'category'
  | 'milestone'
  | 'customField'
  | 'projectTeam'
  | 'projectMember'
  | 'projectAdministrator'
  | 'webhook'

type Op = 'create' | 'update' | 'delete' | 'reorder' | 'refresh' | 'noop'
```

`access` は3つの `ResourceKind` に分解する（`projectTeam` / `projectMember` / `projectAdministrator`）。
マニフェスト上は1ブロックだが、API は別エンドポイントで、削除判定の取得方法も
（`excludeGroupMembers`）別。操作語彙を `create` / `delete` に統一できるので、
`addTeam` / `grantAdmin` のような専用の op を増やさずに済む。

### 2.2 Action

```ts
type Action = {
  id: ActionId                     // 安定した識別子。"issueTypes/create/調査"
  phase: Phase                     // 1..8（要件定義 §6）
  kind: ResourceKind
  op: Op
  name: string                     // マニフェスト上の同定名。表示にも使う
  target?: IdOrRef                 // 操作対象の Backlog ID（update / delete / reorder）
  request?: HttpRequest            // op が noop / refresh のときは無い
  provides?: ProvidedRef[]         // 成功時に解決表へ登録するもの
  changes?: Change[]               // 表示用の前後差分
  notes?: Note[]                   // "rename of X" / "issues move to Y"
  writeRequest: boolean            // 所要時間の見積もりに数えるか
}

type HttpRequest = {
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string                     // Ref を含みうる
  params: Record<string, Value>
}

type Change = { field: string; before: Value | null; after: Value | null }
```

`id` は安定していなければならない。中断レポート（FR-4.4）で
「適用済み」「未適用」を列挙するときの識別子になり、
`--output json` の消費側がこれを見て差分を追う。

### 2.3 値と未解決参照

```ts
type Ref = { $ref: { kind: ResourceKind; name: string } }
type Value = string | number | boolean | null | Secret | Ref | Value[]
type IdOrRef = number | Ref
```

`Ref` は「Backlog ID がまだ分からないリソース」を名前で指す。
plan の時点では解決できないものが必ず残るため、Action は ID ではなく `Ref` を持つ。

### 2.4 Secret

```ts
class Secret {
  #value: string
  toString() { return '***' }
  toJSON()   { return '***' }
  reveal()   { return this.#value }   // HTTP 送信の直前だけが呼ぶ
}
```

`${ENV}` で展開された値（E-4）は必ず `Secret` になる。
`toString` / `toJSON` がマスクを返すので、**マスクし忘れるという書き方ができない**。
FR-3.6 / NFR-3 / AC-10 を実装の注意ではなく型で担保する。

API キーは `Action` にも `Secret` にも現れない。HTTP クライアントが保持する
トランスポートの関心事であり、計画のデータ構造に載せない。

## 3. 解決表と参照の解決

### 3.1 なぜ必要か

カスタム属性の `applicableIssueTypes[]` は**課題種別の ID** を要求する
（[API 制約](../research/backlog-api-constraints.md#カスタム属性カスタムフィールド)）。
その課題種別がフェーズ2で新規作成されるものなら、ID は適用してみるまで存在しない。

新規プロジェクトではさらに深刻で、既定の課題種別4件の ID すら分からない。
既定ステータスは全プロジェクト共通で 1〜4 の固定値だが、
**課題種別の ID はプロジェクト固有**（[API 制約](../research/backlog-api-constraints.md#課題種別)）。
「その他 を `oldname` でリネーム」「要望 を削除」が指す先が、`POST /projects` の前には存在しない。

### 3.2 解決表

```ts
type ResolutionTable = Map<`${ResourceKind}:${string}`, number>
```

| 契機 | 登録されるもの |
| --- | --- |
| `read()` のスナップショット | 既存リソースの名前 → ID |
| Action 成功時の `provides` | レスポンスの `id` を、その Action の `provides` が示す名前で登録 |
| `op: refresh` 成功時 | 再取得したリソース一覧をまとめて登録 |

`oldname` による更新は、**旧名のエントリを削除し、新名で登録し直す**。
そうしないと、リネーム後に旧名を指す `Ref` が解決できてしまう。

### 3.3 plan での見え方

解決できない `Ref` は「これから作られるもの」なので、計画の描画では
`<issueType "バグ" (to be created)>` のように記す。
`--output json` では `{"$ref":{"kind":"issueType","name":"バグ"}}` をそのまま出す。

### 3.4 V-C1 参照解決シミュレーション（新規提案）

`Action[]` を実行順に走査し、スナップショット由来のエントリだけを入れた解決表から始めて、
各 Action の `provides` を順に足していく。ある Action に到達した時点で
その `Ref` が解決できなければ**計画段階でエラーにする**。

| ID | 検証内容 | 結果 |
| --- | --- | --- |
| V-C1 | すべての `Ref` が、それを使う Action の実行時点で解決可能である | エラー |

これは主にツール自身の不具合（フェーズ順序の間違い、`provides` の付け忘れ）を
適用前に捕まえるための網である。要件定義 R-2 の「実行を始めてから気付くのは許容しない」を
マニフェストの誤りだけでなくツールの誤りにも広げる。

V-A10（`applicableIssueTypes` が存在する課題種別を指す）はマニフェストの静的検証として別途走るが、
V-C1 はその一般化にあたる。両方残す理由は、V-A10 のほうが
「どのキーが」「どう直すか」を利用者の言葉で言えるため。
V-C1 のメッセージは利用者に直せるものではなく、バグ報告への誘導になる。

## 4. read と、ただ1つの再取得点

### 4.1 フェーズと read

| # | フェーズ | reconciler | read で叩く GET |
| --- | --- | --- | --- |
| 0 | 前提 | — | `/users/myself` / `/rateLimit` / `/projects/:key`（404 を許容）/ `/issues/count`（存在時のみ） |
| 1 | プロジェクト | `project` | 上記で足りる |
| 2 | 課題種別 | `issueTypes` | `/projects/:key/issueTypes` |
| 3 | ステータス | `statuses` | `/projects/:key/statuses` |
| 4 | カテゴリー | `categories` | `/projects/:key/categories` |
| 5 | マイルストーン | `milestones` | `/projects/:key/versions` |
| 6 | カスタム属性 | `customFields` | `/projects/:key/customFields` |
| 7 | チーム・メンバー | `access` | `/projects/:key/users?excludeGroupMembers=true` / `/projects/:key/teams` / `/projects/:key/administrators` / `/users` / `/teams` |
| 8 | Webhook | `webhooks` | `/projects/:key/webhooks` |

プロジェクトが存在しない場合、フェーズ2〜8 の GET は叩けない。
スナップショットは「作成直後の初期状態」になる。

| リソース | 新規プロジェクトのスナップショット |
| --- | --- |
| 課題種別 | 既定4件（タスク / バグ / 要望 / その他）。**名前と色は既知、ID は未知** |
| ステータス | 既定4件。**ID は 1〜4 の既知の固定値** |
| その他すべて | 空 |

> `要検証` — `GET /projects/:key/administrators` の存在は
> [API 制約](../research/backlog-api-constraints.md#プロジェクトメンバーチーム) に
> `POST` しか記載が無い。プロジェクト管理者の現状取得手段が無いと
> 「管理者から外す」操作の差分を出せないため、実測で確認する。
> 存在しない場合、管理者の削除は表現できず、`administrators` は追加専用になる。

### 4.2 R-1: フェーズ1直後の再取得

新規プロジェクトでは、既定の課題種別4件の ID が `POST /projects` の成功後にしか分からない。
そこで**プロジェクト作成の直後に1回だけ GET し直す**。

| 決定 | 内容 |
| --- | --- |
| R-1 | プロジェクトが存在しない場合に限り、`project/create` の直後に `op: 'refresh'` の Action を1件挿入する。`/projects/:key/issueTypes` と `/projects/:key/statuses` を取得し、解決表に流し込む |

`refresh` は GET なので `writeRequest: false`。所要時間の見積もりにも、
更新系のレート制限の消費にも数えない。

C-2（read をすべて先に済ませる）の唯一の例外。例外であることを型に出すために
専用の `op` を与え、reconciler の中に隠さない。plan にも1行として現れる。

**採らなかった案: 既定リソースの ID を推測する。**
ステータスは 1〜4 で固定だが課題種別は固定でない。片方だけ推測できる状況で
推測に寄せると、「なぜステータスは大丈夫で課題種別はダメなのか」を
コードのどこにも書けなくなる。両方とも解決表経由にそろえる。

## 5. 適用順序と、DAG を作らない決定

### C-3: 依存グラフを持たず、全順序のリストで表現する

| 決定 | 内容 |
| --- | --- |
| C-3 | `Action[]` はフェーズ順（要件定義 §6）に並んだ**フラットな全順序リスト**とする。依存グラフとトポロジカルソートは実装しない |

依存グラフを入れる動機は普通2つある。どちらも本ツールには無い。

| 動機 | 本ツールでの状況 |
| --- | --- |
| 独立した操作を並列実行したい | NFR-1 で直列・1秒間隔が確定している。並列化の余地がゼロ |
| 順序を自動で決めたい | 要件定義 §6 で全順序が確定している。削除に振替先が要る以上、他の順序は成立しない |

残る依存は「後のフェーズが前のフェーズの ID を使う」データ依存だけで、
これは解決表（§3）が扱う。順序の問題ではない。

DAG を入れると、順序が「宣言から計算された結果」になり、
要件定義 §6 の表とコードの対応が失われる。表が仕様であり続けるほうがよい。

### 5.1 フェーズ内の並び

各 reconciler は自分のフェーズ内で `create` → `update` → `delete` の順に Action を並べる。
削除が最後なのは振替先が必要なため。フェーズ3だけ最後に `reorder` が付く。

フェーズ7は要件定義 §6 の通り
チーム追加 → 個人追加 → 管理者付与 → 管理者解除 → 個人削除 → チーム削除。
`administrators` の未参加者を個人追加に**必ず含める**（A-3 は API の必須制約）。

### 5.2 削除の振替先

| リソース | 振替先 | 表現 |
| --- | --- | --- |
| 課題種別 | 定義の先頭の課題種別 | `Ref{kind:'issueType', name: issueTypes[0].name}` |
| ステータス | 未対応（ID 1 固定） | `1` |

V-B7（振替先が削除対象自身でないこと）は、この `Ref` が削除対象の `name` と
一致しないことを見れば判定できる。課題種別が1件しか定義されておらず、
その1件が削除対象でもある状況でのみ違反する。

## 6. Reconciler インターフェース

```ts
interface Reconciler<Desired, Snapshot> {
  readonly kind: ResourceKind
  readonly phase: Phase

  /** GET のみ。ネットワークにアクセスする唯一の場所 */
  read(ctx: ReadContext): Promise<Snapshot>

  /** 純粋関数。同じ入力なら常に同じ Action[] を返す */
  plan(desired: Desired, snapshot: Snapshot, ctx: PlanContext): Action[]
}
```

`PlanContext` が持つのは、他フェーズの結果ではなく**マニフェスト全体と空間スナップショット**。
リソース間の参照（カスタム属性 → 課題種別）は `Ref` を作るだけなので、
他 reconciler の `Action[]` を見る必要がない。reconciler どうしは互いを知らない。

リソースを1つ増やす作業は、要件定義 NFR-8 の通り
「ファイルを1つ足して適用順序の配列に並べる」だけで済む。

### 6.1 `noop` Action を捨てない

差分が無いリソースも `op: 'noop'` の Action として残す。理由は3つ。

1. plan の「9 unchanged」（L-2 の効果）を数えるのに要る
2. V-A15（記述順と適用後の表示順の一致）を判定するには、
   変わらないものも含めた**適用後の全要素の並び**が要る
3. `--output json` の消費側が「このリソースは意図的に一致している」と
   「マニフェストに書かれていない」を区別できる

Executor は `writeRequest: false` の Action を実行せず読み飛ばす。

## 7. Executor

```ts
function execute(actions: Action[], ctx: ExecuteContext): AsyncIterable<ExecutionEvent>
```

| イベント | 内容 |
| --- | --- |
| `started` | 総数 M |
| `actionStarted` | N/M と Action |
| `actionSucceeded` | レスポンス、解決表への登録結果 |
| `actionFailed` | API エラー。直後に `aborted` |
| `waiting` | レート制限による待機（残り秒数） |
| `finished` | 全件成功 |
| `aborted` | 適用済み / 失敗 / 未適用 の3分割（FR-4.4） |

### C-4: 進捗を `AsyncIterable` で流し、描画は呼び出し側に任せる

CLI は行を書き、Web UI は state を更新する。core にコールバックやロガーを渡す設計にすると、
片方にしかない表現（TTY の書き換え、React の再描画）が core に漏れる。
イベント列だけを公開すれば NFR-6（同一ロジック）が保たれる。

### 7.1 レート制限の扱い

| 決定 | 内容 | 理由 |
| --- | --- | --- |
| X-1 | 更新系 Action の間隔は**常に1秒以上** | NFR-1。`GET /rateLimit` の実測値（毎分150 = 毎秒2.5）より保守的だが、公式推奨に従う |
| X-2 | GET には間隔を空けない | 公式推奨が1秒間隔を求めているのは Update / Search / Icon のみ |
| X-3 | レート制限の残量は**常に `GET /rateLimit` の本文**から取る。レスポンスヘッダは使わない | ブラウザは `access-control-expose-headers` が無くヘッダを読めない（実測）。Node だけ別経路にすると「Web でだけ起きる不具合」ができる。NFR-5 / NFR-6 |
| X-4 | `429` を受けたら `GET /rateLimit` を叩き直し、リセット時刻まで待って再試行。上限回数あり | NFR-2 |

X-3 は「Node のほうが情報を多く取れるが、少ないほうにそろえる」という選択。
環境差を core から消すことを優先する。

### 7.2 エラー時

FR-4.3 の通り即座に中断し、ロールバックしない。
`Action[]` の位置で「どこまで進んだか」が一意に決まるので、
中断レポートは `actions.slice(0, i)` / `actions[i]` / `actions.slice(i+1)` で作れる。

再実行は同じマニフェストで `apply` をやり直せばよい（NFR-4 冪等）。
state ファイルを持たない（要求設計 §6 非スコープ）ので、
中断状態を記録するファイルも作らない。再実行時は read からやり直し、
適用済みのぶんは `noop` になる。

## 8. 判断理由のまとめ

| ID | 決定 | 採らなかった案と理由 |
| --- | --- | --- |
| C-1 | 適用は共通 Executor | reconciler ごとの `apply`。`Action[]` に現れない操作を書ける余地が残り、NFR-8 の狙いが行儀頼みになる |
| C-2 | `plan()` は純粋関数 | plan の中で GET する。FR-3.1 が実装の注意事項になり、テストに実 API が要る |
| C-3 | 全順序リスト。DAG なし | 依存グラフ + トポロジカルソート。直列実行なので利得がゼロで、要件定義 §6 の表とコードの対応が失われる |
| C-4 | 進捗は `AsyncIterable` | core にロガー／コールバックを渡す。CLI と Web の表現差が core に漏れる |
| R-1 | 再取得点は `op: refresh` の1箇所 | 既定リソースの ID を推測する。ステータスだけ推測できる非対称を説明できない |
| X-3 | レート制限は常に本文 API | Node ではヘッダを読む。Web でだけ起きる不具合ができる |
| — | `Secret` クラスでマスク | 出力時にキー名でマスク。対象の追加漏れがそのまま漏洩になる |
