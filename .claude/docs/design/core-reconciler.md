# core のデータモデルと reconciler

最終更新: 2026-09-19
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

type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8   // 要件定義 §6 の適用順序
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
  notes?: Note[]                   // 現状は "renamed from X" のみ（FR-3.3）
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
| `read()` のスナップショット | 既存リソースの名前 → ID。**各 reconciler ではなく、`plan()` を呼ぶ側がまとめて登録する** |
| Action 成功時の `provides` | レスポンスの `id` を、その Action の `provides` が示す名前で登録 |
| `op: refresh` 成功時 | 再取得したリソース一覧をまとめて登録 |

`oldname` による更新は、**旧名のエントリを削除し、新名で登録し直す**。
そうしないと、リネーム後に旧名を指す `Ref` が解決できてしまう。

### 3.3 plan での見え方

解決できない `Ref` は「これから作られるもの」なので、計画の描画では
`<issueType "バグ" (to be created)>` のように記す。
`--output json` では `{"$ref":{"kind":"issueType","name":"バグ"}}` をそのまま出す。

### 3.4 V-C1 参照解決シミュレーション（未採用）

依頼者の判断により**未採用**。以下は提案内容と、採らなかったことの帰結の記録である。

`Action[]` を実行順に走査し、スナップショット由来のエントリだけを入れた解決表から始めて、
各 Action の `provides` を順に足していく。ある Action に到達した時点で
その `Ref` が解決できなければ**計画段階でエラーにする**。

| ID | 検証内容 | 結果 |
| --- | --- | --- |
| V-C1 | すべての `Ref` が、それを使う Action の実行時点で解決可能である | エラー |

これは主にツール自身の不具合（フェーズ順序の間違い、`provides` の付け忘れ）を
適用前に捕まえるための網である。要件定義 R-2 の「実行を始めてから気付くのは許容しない」を
マニフェストの誤りだけでなくツールの誤りにも広げる。

V-A10（`applicableIssueTypes` が存在する課題種別を指す）はマニフェストの静的検証として別途走り、
V-C1 はその一般化にあたる。**未採用にしたことで、`Ref` の解決可能性を担保するのは V-A10 だけになる。**
V-A10 が見ていない経路（フェーズ順序の誤り、`provides` の付け忘れ）でツール側が `Ref` を
解決し損ねた場合、それは計画段階ではなく適用の実行時エラーとして現れる。

V-C1 のメッセージはもともと利用者に直せるものではなくバグ報告への誘導であり、
利用者向けの検証としての価値が無い点が判断の材料になった。
同じく設計フェーズで提案した V-A19 / V-A20 が採用されたのは、
そちらが利用者の直せる誤りを指すため（[検証パイプライン S4](validation-pipeline.md#s4-静的意味)）。

## 4. read と、ただ1つの再取得点

### 4.1 フェーズと read

| # | フェーズ | reconciler | read で叩く GET |
| --- | --- | --- | --- |
| 0 | 前提 | — | `/users/myself` / `/rateLimit` / `/space` / `/projects/:key`（404 を許容）/ `/issues/count`（存在時のみ） |
| 1 | プロジェクト | `project` | 上記で足りる |
| 2 | 課題種別 | `issueTypes` | `/projects/:key/issueTypes` |
| 3 | ステータス | `statuses` | `/projects/:key/statuses` |
| 4 | カテゴリー | `categories` | `/projects/:key/categories` |
| 5 | マイルストーン | `milestones` | `/projects/:key/versions` |
| 6 | カスタム属性 | `customFields` | `/projects/:key/customFields` / `/projects/:key/issueTypes` |
| 7 | チーム・メンバー | `access` | `/projects/:key/users?excludeGroupMembers=true` / `/projects/:key/teams` / `/projects/:key/administrators` / `/users` / `/teams` |
| 8 | Webhook | `webhooks` | `/projects/:key/webhooks` |

フェーズ6が課題種別も取るのは、`applicableIssueTypes[]` の差分を出すためである。
スナップショットが持つのは課題種別の **ID** で、マニフェストが書くのは**名前**なので、
対応表が無いと突き合わせられない。取らずに比較を諦めると
「`applicableIssueTypes` だけを変えても差分が出ない」という穴ができる。

表のパスは省略形である。**実際に組み立てるパスは `/api/v2` を前置する**
（[plan の出力仕様 §3.2](plan-output.md#32-中断時fr-44) の表記に合わせる）。
送信層はこれをそのまま使うので、二重に前置しない。

プロジェクトが存在しない場合、フェーズ2〜8 の GET は叩けない。
スナップショットは「作成直後の初期状態」になる。

| リソース | 新規プロジェクトのスナップショット |
| --- | --- |
| 課題種別 | 既定4件。**色は既知、ID は未知。名前はスペースの言語に依存する**（下記） |
| ステータス | 既定4件。**ID は 1〜4 の既知の固定値** |
| その他すべて | 空 |

#### 新規プロジェクトの既定リソース名は、スペースの言語で決まる

既定の表示名はスペースの言語設定で変わる。**既存プロジェクトは `GET` が実名を返すので問題にならないが、
新規プロジェクトはまだ存在しないので取得できない。** そこでフェーズ0で `GET /api/v2/space` を叩き、
`lang` に応じて[既定リソースの表示名](../research/backlog-api-constraints.md#既定リソースの表示名)の組を選ぶ。

**課題種別ではこれが必須である。** ステータスは ID が 1〜4 の固定値なので照合は ID で行い、
名前は V-A6 の存在確認にしか使わない。一方**課題種別は ID がプロジェクト固有なので、
照合そのものが名前で行われる**。言語を取り違えると、計画は `{$ref:issueType:タスク}` を組むのに
`refresh` が登録するのは `issueType:Task` になり、**適用の実行時に未解決参照で中断する**。

**`lang` に対応する名前の組を持っていない場合、新規プロジェクトの計画を拒否する**（fail closed）。
推測した名前で計画を組むと、上記の中断が適用の途中で起きる。VP-5 と同じ考え方で、
「分からないまま破壊的操作に進まない」を優先する。
エラーメッセージでは、先にプロジェクトを作ってから当てる道（UC-2）を案内する。

`GET /projects/:key/administrators` は**存在することを実測で確認済み**（2026-09-19）。
ユーザーの配列を返すので、管理者の付与だけでなく解除の差分も出せる。

### 4.2 RF-1: フェーズ1直後の再取得

新規プロジェクトでは、既定の課題種別4件の ID が `POST /projects` の成功後にしか分からない。
そこで**プロジェクト作成の直後に1回だけ GET し直す**。

| 決定 | 内容 |
| --- | --- |
| RF-1 | プロジェクトが存在しない場合に限り、`project/create` の直後に `op: 'refresh'` の Action を1件挿入する。`/projects/:key/issueTypes` と `/projects/:key/statuses` を取得し、解決表に流し込む |

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

```ts
type PlanContext = {
  manifest: Manifest
  snapshot: Snapshot
  /** その path の値が ${ENV} 由来か。E-6 */
  isSecret: (path: string) => boolean
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

### 6.2 `oldname` の解釈

要件定義 O-1〜O-3 を Action に落とすと、判定は3分岐になる。

| スナップショットの状態 | 生成する Action |
| --- | --- |
| `name` と同名のリソースが存在する | 差分があれば `update`、無ければ `noop`。`oldname` は無視する |
| `name` は無いが `oldname` と同名が存在する | `update`（改名 + 他フィールドの更新を1リクエストに乗せる） |
| どちらも存在しない | `create` |

1行目で `oldname` を無視するのが冪等性（NFR-4 / O-3）の要。
1回目の適用で改名が済むと2回目は `name` 側に当たるので、`oldname` の対象が
消えていてもエラーにならず、`noop` に落ちる。

2行目が `create` ではなく `update` になることは plan の描画にも効く
（[PO-1](plan-output.md#po-1-oldname-によるリネームは--ではなく--で表す)）。

`oldname` が複数の要素から同じリソースを指す場合は V-A17 が静的に弾く。

### 6.3 `access` の差分算出

フェーズ7だけリソースが3種（`projectTeam` / `projectMember` / `projectAdministrator`）に
分かれ、取得方法にも罠があるので個別に定める。

| 対象 | あるべき集合 | 現状 | 生成する Action |
| --- | --- | --- | --- |
| チーム | `access.teams` | `GET /projects/:key/teams` | 差集合で `create` / `delete` |
| 個人参加 | `access.members` ∪ `access.administrators` | `GET /projects/:key/users?excludeGroupMembers=true` | 同上 |
| 管理者 | `access.administrators` | `GET /projects/:key/administrators` | 同上 |

個人参加のあるべき集合に `administrators` を**丸ごと**含めるのが要点である。
「`administrators` のうち未参加の人」と書くと追加側の結果は同じだが、**削除側が壊れる**。
`members` に名前が無く既に個人参加している管理者が差集合に落ち、個人削除の Action が出てしまう。
A-3 が言っているのは「未参加なら参加させる」であって「参加済みなら外す」ではない。

**現状の取得で `excludeGroupMembers=true` を外すと壊れる。**
既定（false）ではチーム経由の参加者も返るため、差集合を取ると
チームの所属者を個人として削除する Action を生んでしまう（要件定義 §2.6）。

#### L-4 と A-4 の関係

要件定義 L-4（冗長な記述をツール側で畳む）は、`access` について2つのことを言っているが、
**ツールの挙動としては別物**なので設計上は分けて扱う。

| L-4 の項目 | 設計上の扱い |
| --- | --- |
| チーム経由で参加済みの人を `members` に書かせない | **畳まない。** 書かれたら個人参加の Action を出す。V-A16 で警告するだけ（A-4 が明示） |
| `administrators` の自動参加も重複を打たない | **畳む。** 既に個人参加している人には参加 Action を出さない |

前者を黙って畳むと、`members` に書いたのに個人参加として登録されない、という
マニフェストと現実の食い違いが生まれる。A-4 が「書いても動く」と決めているのはそのため。
L-4 が言う「書かせない」は、ツールが無視するという意味ではなく、警告で誘導するという意味。

> `要検証` — `administrators` の人がチーム経由でのみ参加している場合に、
> プロジェクト管理者を付与できるかは未確認。確認には書き込みを伴う。
> [API 制約](../research/backlog-api-constraints.md#プロジェクトメンバーチーム) が確認したのは
> 「未参加のユーザーには付与できない」ことだけである。
> 確認できるまでは安全側に倒し、**個人参加していない管理者には必ず個人参加の Action を出す**。
> チーム経由で足りるなら、これは1リクエストの無駄で済む。

### 6.3a カスタム属性の型変更は削除＋作成になる

`PATCH /api/v2/projects/:key/customFields/:id` は `typeId` を受け取らない
（[API 制約](../research/backlog-api-constraints.md#カスタム属性カスタムフィールド)）。
型は更新できないので、同名で `type` だけが変わった場合は **`delete` と `create` の2つの Action** を出す。

本ツールは課題0件のプロジェクトしか対象にしないので、失われるデータが無い。
2リクエストになることは plan に出るので、利用者は L-2 / L-6 と同じ判断材料を得られる。

検証で止める案は採らない。「Yaml があるべき姿を表す」（要件定義 §2.2）という建て付けのもとで、
型を書き換えただけで適用できなくなるのは説明しにくい。

### 6.4 `webhooks` の差分算出

| 項目 | 規則 |
| --- | --- |
| `events` の比較 | 名前をすべて数値に解決してから、**順序を無視した集合として**比較する。同じイベントを名前と数値で書いても差分にならない |
| `events: all` | `allEvent: true` として比較する。全イベントを列挙した指定とは**別物**として扱う（API 上の表現が違い、将来イベントが増えたときの挙動も違う） |
| `hookUrl` | 差分判定は `Secret.reveal()` の実値で行い、表示だけマスクする。**`read()` が返す既存の値も `Secret` で包む** |

既存 Webhook の `hookUrl` を `read()` の段で包むのは、E-5（Yaml に直接書かれた値はマスクしない）が
除外しているのが**マニフェスト側の値**だからである。Backlog に登録済みの URL はリポジトリに無く、
plan を PR コメントに貼る運用（PO-3）で CI ログに出ることになる。`changes[].before` に平文で載せない。

### 6.5 `settings` の差分算出

マニフェストに**書かれたキーだけ**を比較する（[K-3](manifest-schema.md#k-3-省略されたキーは現状維持)）。
1つでも差があれば `PATCH /projects/:key` を1件出す。
`settings` は1リクエストに全項目が乗る（L-3）ので、差分の数に関わらず Action は常に0件か1件。

## 7. Executor

```ts
function execute(actions: Action[], ctx: ExecuteContext): AsyncIterable<ExecutionEvent>
```

| イベント | 内容 |
| --- | --- |
| `started` | 総数 M |
| `actionStarted` | 実行対象のうち何件目かと Action。**添字は 0 始まり**で、`[ 5/10]` のような表示は描画側が +1 する |
| `actionSucceeded` | レスポンス、解決表への登録結果 |
| `actionFailed` | API エラー、または HTTP まで到達しなかった失敗。直後に `aborted` |
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
| X-4 | `429` を受けたら `GET /rateLimit` を叩き直し、リセット時刻まで待って再試行。**上限3回**で諦める | NFR-2 |

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
| RF-1 | 再取得点は `op: refresh` の1箇所 | 既定リソースの ID を推測する。ステータスだけ推測できる非対称を説明できない |
| X-3 | レート制限は常に本文 API | Node ではヘッダを読む。Web でだけ起きる不具合ができる |
| — | `Secret` クラスでマスク | 出力時にキー名でマスク。対象の追加漏れがそのまま漏洩になる |
