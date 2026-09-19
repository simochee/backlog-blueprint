# マニフェストのスキーマ定義

最終更新: 2026-09-19
前提: [要件定義 §2](../requirements/requirements-definition.md#2-マニフェスト仕様) / [API 制約](../research/backlog-api-constraints.md) / [バージョニング方針](manifest-versioning.md)

要件定義 §2 で決めた構造を、キー・型・enum・制約のレベルまで落としたもの。
**JSON Schema が何を担い、何を担わないか**を先に決めてから各キーを定義する。

## 1. JSON Schema の責務範囲

[バージョニング方針 D-5](manifest-versioning.md#d-5-が実質的なバージョン安全装置である理由) で
「互換性は strict parse が担い、`$schema` はエディタ支援に専念させる」と決めている。
これを検証全体に拡張する。

| 担う | 担わない |
| --- | --- |
| キーの綴り・型・必須・enum・数値範囲・配列長 | 要素間の相互参照（`applicableIssueTypes` → `issueTypes`） |
| 正規表現パターン（プロジェクトキー・色・日付） | 同一配列内の `name` 重複 |
| 型ごとの必須パラメータ（`if`/`then`） | スペースの実状に依存する判定（既定ステータス・ユーザーの存在） |
| 補完に出る各値の説明 | 順序制約（ステータスの並び） |

**JSON Schema は権威ではない。** 権威は CLI / Web UI が走らせるバリデータであり、
JSON Schema はその部分集合をエディタに配るための成果物にすぎない。
どの検証がどのステージで走るかは [検証パイプライン](validation-pipeline.md) で定義する。

### M-1: JSON Schema は手書きせず、コード側のスキーマ定義から生成する

| 決定 | 内容 |
| --- | --- |
| M-1 | TypeScript のスキーマ定義を単一の真実とし、JSON Schema は `packages/schema` のビルド生成物とする |

手書きの JSON Schema と実行時バリデータを二重に持つと必ずズレる。
ズレた瞬間「エディタでは赤くならないのに CLI が落ちる」が起き、これは NFR-6
（CLI と Web で同一ロジック）が防ごうとしている問題とまったく同じ性質のものである。
生成物にすれば構造的に一致する。

ライブラリの選定は実装時に行う。満たすべき条件だけを決めておく。

1. JSON Schema (draft 2020-12) を出力できる
2. ブラウザ向けバンドルに載る大きさである（NFR-5 の趣旨）
3. 未知キーを拒否する挙動（strict）を既定にできる

**採らなかった案: JSON Schema を手書きし、実行時は Ajv で検証する。**
生成の手間は消えるが、JSON Schema だけでは表現できない検証（相互参照・重複・順序）を
別に書くことになり、結局2箇所に分かれる。それなら最初から1箇所にまとめたほうがよい。

### M-2: `$schema` キーを受理して無視する

マニフェストのバージョン指定は `# yaml-language-server: $schema=...` のコメント形式が正だが、
`$schema` をドキュメント中のキーとして書くツールも多く、素直に書く利用者が必ず出る。

| 決定 | 内容 |
| --- | --- |
| M-2 | トップレベルの `$schema`（文字列）を既知キーとして受理する。値は一切解釈しない |

strict parse（V-A1）でここだけエラーにすると、「スキーマを正しく指定したのに怒られた」という
最悪の第一印象になる。一方で値を互換性判定に使わない点は
[バージョニング方針 D-5](manifest-versioning.md#d-5-が実質的なバージョン安全装置である理由) のまま変えない。

## 2. YAML の解釈規則

パーサの設定は仕様の一部である。ここを曖昧にすると「書いたのに効かない」が起きる。

| ID | 決定 | 理由 |
| --- | --- | --- |
| Y-1 | **timestamp 型を有効にしない。** 日付は常に文字列として読む | `startDate: 2026-10-01` と `startDate: "2026-10-01"` が別物になるのを防ぐ。API に渡すのは `yyyy-MM-dd` の文字列なので、途中で Date になる必要がない |
| Y-2 | **ノードの位置情報（行・列）を保持する** | FR-2.2 の「どのキーが」をエラーに出すため。位置を捨てるパーサ設定は選べない |
| Y-3 | スカラー値が `null` で、かつソース上に値が書かれていない場合を区別する | `color: #ea2c00` は `color: null` になる。V-A18 の「引用符を付けてください」を出すのに必要 |
| Y-4 | アンカー・エイリアス（`&a` / `*a`）は許可する | YAML の標準機能であり、禁止する理由がない。展開後の値だけを見ればよい |
| Y-5 | 複数ドキュメント（`---` 区切り）はエラー | 1ファイル = 1プロジェクト（要件定義 §2.1）。2つ目を黙って捨てるより止める |

## 3. `${ENV}` 展開

| ID | 決定 | 理由 |
| --- | --- | --- |
| E-1 | **すべての文字列値**に適用する。キー名には適用しない | 適用箇所を絞ると「なぜここでは使えないのか」という例外を利用者に覚えさせることになる |
| E-2 | 展開はパース後のスカラー値に対して行い、ノードの位置情報を保ったまま置き換える | 未解決時のエラーに行番号を出すため（Y-2） |
| E-3 | `$${NAME}` は リテラルの `${NAME}` に展開する | 課題テンプレート（`templateDescription`）にシェル片やプレースホルダを書きたい実例が想定できる。エスケープ手段が無いと詰む |
| E-4 | 展開された値は `Secret` として扱い、出力時に常にマスクする | FR-3.6 / NFR-3。マスク対象を「Webhook URL だけ」のように列挙すると、対象の追加漏れが漏洩になる |
| E-5 | Yaml に直接書かれた値はマスクしない | 既にリポジトリに平文で入っている。マスクしても秘匿性は増えず、plan が読みにくくなるだけ |

### E-6: マニフェストの型は `Secret` を持たず、展開した経路を別に持つ

| ID | 決定 |
| --- | --- |
| E-6 | S2 は展開後の**素の文字列**をマニフェストに残し、`${ENV}` 由来の値がどの `path` にあったかを集合として別に返す。`Secret` で包むのは `Action` を組み立てるとき |

E-1（すべての文字列値が対象）と E-4（展開値は `Secret`）を素直に型にすると、
マニフェストのあらゆる文字列が `string | Secret` になる。すると V-A3 のパターン、
`minLength`、10色パレットの enum といった検証が、すべて `reveal()` を経由することになる。

**マスクを担保するために作った型を、検証のたびに剥がして回る形は採らない。**
`reveal()` の呼び出し箇所が増えるほど、§2.4 が型で消したはずの「マスクし忘れ」が
別の顔で戻ってくる。`reveal()` は HTTP 送信の直前だけ、という不変条件を保つほうが強い。

したがって S3 / S4 はまっさらな `string` を検証し、`Action` を組む段で
展開経路の集合に載っている値だけを `Secret` で包む。E-4 の「出力時に常にマスクする」は、
出力に載るのが `Action` である以上これで満たされる。

**採らなかった案: `${ENV}` を使えるキーを絞る。** 型は素直になるが、
E-1 が避けようとした「なぜここでは使えないのかという例外を覚えさせる」が戻る。

`${NAME}` が解決できない場合の扱いはコマンドによって変わる（[検証パイプライン §4](validation-pipeline.md#4-コマンドごとのステージ構成)）。

## 4. トップレベル

| キー | 型 | 必須 | 制約 | 省略時 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 解釈しない（M-2） | — |
| `key` | string | **必須** | `^[A-Z0-9_]+$`（V-A3） | — |
| `name` | string | **必須** | `minLength: 1` | — |
| `settings` | object | — | 未知キー禁止 | 全キー現状維持（§5） |
| `issueTypes` | array | — | `minItems: 1`（V-A9） | 空配列 |
| `statuses` | array | — | `maxItems: 12`（V-A7） | 空配列 |
| `categories` | array | — | | 空配列 |
| `milestones` | array | — | | 空配列 |
| `customFields` | array | — | | 空配列 |
| `access` | object | — | 未知キー禁止 | 全キー空配列 |
| `webhooks` | array | — | | 空配列 |

### K-1: 配列キーの省略は「空配列」であって「管理対象外」ではない

要件定義 §2.2 の「すべてのリソースで Yaml に書いていないものは削除」を、
キーごと省略した場合にも一貫して適用する。

**帰結**: `categories` を書かなければ既存カテゴリーは全削除される。
`access` を書かなければ全メンバーが削除対象になり、実行者自身も管理者から外れるため
**V-B6 でエラーになる**。つまり `access` は実質的に必須である。

省略を「管理対象外」と解釈する案は採らない。宣言的であること（Yaml が現実の完全な写像）を
優先する要件定義 §2.2 の決定と両立しないため。キーの有無で削除の意味が変わると、
「書き忘れ」と「意図的に管理しない」が区別できなくなる。

### K-2: `issueTypes` / `statuses` を JSON Schema の `required` に入れない

どちらも実質必須だが、`required` に入れると
`"issueTypes" is required` という機械的なメッセージになる。
V-A9（1件以上必要）/ V-A6（既定ステータスを含める）のほうが
「なぜ必要か」「どう直すか」を含んだメッセージを出せる。
要件定義 V-A2 が必須キーを `key` / `name` に限っているのとも整合する。

## 5. `settings`

すべて任意。型は [プロジェクト基本設定](../research/backlog-api-constraints.md#プロジェクト基本設定) に従う。

| キー | 型 | enum |
| --- | --- | --- |
| `textFormattingRule` | string | `backlog` / `markdown` |
| `chartEnabled` | boolean | |
| `useResolvedForChart` | boolean | |
| `subtaskingEnabled` | boolean | |
| `grandchildIssueEnabled` | boolean | |
| `projectLeaderCanEditProjectLeader` | boolean | |
| `useWiki` | boolean | |
| `useWikiTreeView` | boolean | |
| `useOriginalImageSizeAtWiki` | boolean | |
| `useDocument` | boolean | |
| `useFileSharing` | boolean | |
| `useGit` | boolean | |
| `useSubversion` | boolean | |
| `useDevAttributes` | boolean | |

### K-3: 省略されたキーは「現状維持」

配列（K-1）と違い、`settings` の各キーは削除の概念を持たないスカラーである。
書かれたキーだけを `POST` / `PATCH` のパラメータに載せ、書かれなかったキーは送らない。

**既存プロジェクトの更新**では、送らなければ現状が保たれる。
**新規作成**でも同じでよい。`POST /api/v2/projects` の必須パラメータは
[`name` と `key` の2つだけ](../research/backlog-api-constraints.md#プロジェクト基本設定)で、
`settings` に対応する項目はすべて Optional だからである。

したがって**ツールが既定値を持つ必要はない**。書かれなかったキーは送らず、
Backlog 側の既定に委ねる。ツールが独自の既定値を持つと、
Backlog が既定を変えたときに追随できず、「マニフェストに書いていないのに
ツールの都合で値が決まる」という説明しにくい状態になる。

## 6. `issueTypes[]`

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `color` | string | **必須** | 10色パレットの enum |
| `templateSummary` | string | — | |
| `templateDescription` | string | — | |
| `oldname` | string | — | `minLength: 1` |

課題種別のパレット（[実測](../research/backlog-api-constraints.md#課題種別)）:
`#e30000` `#990000` `#934981` `#814fbc` `#2779ca` `#007e9a` `#7ea800` `#ff9200` `#ff3265` `#666665`

### K-4: 課題種別の色は enum とし、パレット外はエラーにする

| 決定 | 内容 |
| --- | --- |
| K-4 | 課題種別の `color` は上記10色の enum とする。パレット外の値は**エラー**。ステータス（V-A8）と同じ強さで止める |

多数のプロジェクトの課題種別を走査して色の種類がちょうど10に収束することは確認したが、
**パレット外の色を API が拒否するかは確認できていない**。ステータスをエラーにできるのは
パレット外が `error.unknown : color` で拒否されることを実測しているからで、
課題種別には同じ根拠が無い。

それでも同じ強さで止めるのは、**利用者から見て2つの色の扱いが違う理由を説明できない**ため。
同じマニフェストに並ぶ `issueTypes[].color` と `statuses[].color` で、
片方は赤くなり片方は警告で通る挙動は、実測の有無という内部事情でしか説明できない。

払う代償は誤検出の可能性である。API が実際にはパレット外を受け付けるなら、
通るはずのマニフェストを止めることになる。10色に収束するという観測があるので
実際に踏む利用者は稀だと見込むが、踏んだ場合の逃げ道は無い。

判定は JSON Schema の enum としてスキーマステージ（S3）で行う。
ステータスの V-A8 が S6 に置かれるのは既定ステータスを ID で除外する必要があるためで
（[K-5](#k-5-既定ステータスの判定を-json-schema-でやらない)）、課題種別にはその事情が無い。

> `要検証` — パレット外の色の拒否挙動。**受け付けられることが確認できたら**
> この決定を警告に差し戻す。

## 7. `statuses[]`

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `color` | string | — | 10色パレットの enum |
| `oldname` | string | — | `minLength: 1` |

パレット（[実測](../research/backlog-api-constraints.md#ステータス)）:
`#ea2c00` `#e87758` `#e07b9a` `#868cb7` `#3b9dbd` `#4caf93` `#b0be3c` `#eda62a` `#f42858` `#393939`

### K-5: 既定ステータスの判定を JSON Schema でやらない

既定ステータスは `color` / `oldname` を書けず（V-A6a）、カスタムステータスは `color` が必須。
条件分岐そのものは JSON Schema の `if`/`then` で書けるが、
**どれが既定かを名前で判定してはならない**。

[API 制約](../research/backlog-api-constraints.md#ステータス) は
「既定ステータスは全プロジェクト共通で ID が 1〜4 なので、名前の一致ではなく **ID で判定する**」
と決めている。ID はスナップショットを取るまで分からないため、既定かどうかの判定は
JSON Schema の段階では原理的にできない。

したがって JSON Schema では `color` を任意にとどめ、
V-A6 / V-A6a / V-A8 / V-A14 はスナップショット取得後のステージで判定する
（[検証パイプライン §3](validation-pipeline.md#3-ステージと検証の対応)）。

副次的な効果として、既定ステータスの表示名がスペースの言語設定で変わっても
ツールは正しく動く。ID で判定しているため名前に依存しない。

**採らなかった案: 既定名（未対応/処理中/処理済み/完了）を enum に持たせてエディタで判定する。**
名前が違うスペースで正しいマニフェストが赤くなる。誤検出の害が、補完が少し賢くなる利得を上回る。

## 8. `categories[]` / `milestones[]`

`categories[]`

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `oldname` | string | — | `minLength: 1` |

`milestones[]`

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `description` | string | — | |
| `startDate` | string | — | `^\d{4}-\d{2}-\d{2}$` |
| `releaseDueDate` | string | — | 同上 |
| `oldname` | string | — | `minLength: 1` |

## 9. `customFields[]`

共通キー。

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `type` | string | **必須** | 下表の enum |
| `description` | string | — | |
| `required` | boolean | — | 既定 `false` |
| `applicableIssueTypes` | string[] | — | `uniqueItems: true`。空／省略で全種別 |
| `oldname` | string | — | `minLength: 1` |

型の enum と `typeId` の対応。

| `type` | `typeId` | 追加キー |
| --- | --- | --- |
| `text` | 1 | — |
| `textArea` | 2 | — |
| `number` | 3 | `min` `max` `initialValue`（いずれも **number**）/ `unit`（string） |
| `date` | 4 | `min` `max` `initialDate`（いずれも `^\d{4}-\d{2}-\d{2}$` の**文字列**）/ `initialValueType` / `initialShift`（integer） |
| `singleList` | 5 | `items`（string[]・**必須**）/ `allowInput` / `allowAddItem`（boolean） |
| `multipleList` | 6 | 同上 |
| `checkBox` | 7 | 同上 |
| `radio` | 8 | 同上 |

**`min` / `max` は型によって値の型が変わる。** number 型では数値、date 型では `yyyy-MM-dd` の文字列。
キー名が共有されているため取り違えやすい（[API 制約](../research/backlog-api-constraints.md#カスタム属性カスタムフィールド)）。
条件付きの表でこれも分岐させる。

`initialValueType` の enum。

| 値 | API 値 | 意味 |
| --- | --- | --- |
| `today` | 1 | 当日 |
| `todayPlusShift` | 2 | 当日 + `initialShift` 日 |
| `specifiedDate` | 3 | `initialDate` の日付 |

条件付き必須（V-A11 の具体）。JSON Schema の `allOf` + `if`/`then` で表現する。

| 条件 | 必須になるキー | 禁止されるキー |
| --- | --- | --- |
| `type` がリスト型4種 | `items`（`minItems: 1`） | `min` `max` `unit` `initialValue` `initialDate` `initialValueType` `initialShift` |
| `type: number` | — | `items` `allowInput` `allowAddItem` `initialDate` `initialValueType` `initialShift` |
| `type: date` | — | `items` `allowInput` `allowAddItem` `unit` `initialValue` |
| `type: number` の `min` / `max` | number であること | — |
| `type: date` の `min` / `max` | `^\d{4}-\d{2}-\d{2}$` の文字列であること | — |
| `initialValueType: specifiedDate` | `initialDate` | `initialShift` |
| `initialValueType: todayPlusShift` | `initialShift` | `initialDate` |
| `initialValueType: today` | — | `initialDate` `initialShift` |
| `type` が `text` / `textArea` | — | 型固有キーすべて |

### K-6: カスタム属性の型は数値 `typeId` を受け付けない

Webhook のイベントは名前と数値の両方を受け付ける（W-1）が、ここでは名前だけにする。

W-1 が数値を許す理由は「Backlog が新イベントを追加しても CLI を更新せず使える」という
前方互換性にある。カスタム属性の型は8種で固定されており、
[API 制約](../research/backlog-api-constraints.md#カスタム属性カスタムフィールド) の一覧が増える見込みがない。
前方互換の必要が無いところに2つの書き方を用意すると、レビュー時の読み替えが増えるだけになる。

## 10. `access`

| キー | 型 | 制約 |
| --- | --- | --- |
| `teams` | string[] | `uniqueItems: true`（V-A13） |
| `members` | string[] | 同上 |
| `administrators` | string[] | 同上 |

`teams` はチーム名、`members` / `administrators` はユーザー ID（ログイン ID）。
V-A13 は `uniqueItems` で JSON Schema が直接表現できる数少ない検証のひとつ。

**3キーはいずれも任意で、省略したキーは空配列として扱う。** `access` 全体を省略した場合
（[K-1](#k-1-配列キーの省略は空配列であって管理対象外ではない)）と同じ規則を、キー単位にも一貫させる。
`access: { teams: [開発チーム] }` と書けば `members` と `administrators` は空配列になり、
実行者が管理者から外れるので V-B6 でエラーになる。

## 11. `webhooks[]`

| キー | 型 | 必須 |
| --- | --- | --- |
| `name` | string | **必須**。`minLength: 1` |
| `description` | string | — |
| `hookUrl` | string | **必須**。`minLength: 1` |
| `events` | `"all"` \| array | **必須** |

`events` の型（W-1 / W-2 / W-4）。

```
oneOf:
  - const: all                  # API の allEvent: true
  - type: array
    minItems: 1
    uniqueItems: true
    items:
      oneOf:
        - <イベント名の const 列>   # 未知の名前はここで弾かれる（W-4 前半）
        - type: integer
          minimum: 1              # 未知の数値は通す（W-4 後半）
```

### K-7: イベント名は `enum` ではなく `const` の `oneOf` で書く

JSON Schema の `enum` は値ごとに説明を持てない。`const` + `description` を `oneOf` で並べると、
エディタの補完候補に説明が出る。W-5（plan で数値に名前を添える）と同じ意図を入力側にも効かせる。

イベント名は
[activityTypeId 一覧](../research/backlog-api-constraints.md#activitytypeid-の一覧)の英語名を
camelCase にしたもの。

| ID | 名前 | ID | 名前 | ID | 名前 |
| --- | --- | --- | --- | --- | --- |
| 1 | `issueCreated` | 15 | `projectUserAdded` | 38 | `documentTitleUpdated` |
| 2 | `issueUpdated` | 16 | `projectUserDeleted` | 39 | `documentRevisionUpdated` |
| 3 | `issueCommented` | 17 | `commentNotificationAdded` | 40 | `documentCommented` |
| 4 | `issueDeleted` | 18 | `pullRequestAdded` | 41 | `documentCommentUpdated` |
| 5 | `wikiCreated` | 19 | `pullRequestUpdated` | 42 | `documentCommentDeleted` |
| 6 | `wikiUpdated` | 20 | `commentAddedOnPullRequest` | 43 | `documentCommentReplyCreated` |
| 7 | `wikiDeleted` | 21 | `pullRequestDeleted` | 44 | `documentCommentReplyUpdated` |
| 8 | `fileAdded` | 22 | `milestoneCreated` | 45 | `documentCommentReplyDeleted` |
| 9 | `fileUpdated` | 23 | `milestoneUpdated` | 46 | `documentAttachmentAdded` |
| 10 | `fileDeleted` | 24 | `milestoneDeleted` | 48 | `documentMultiCreated` |
| 11 | `svnCommitted` | 25 | `projectGroupAdded` | 49 | `documentMentioned` |
| 12 | `gitPushed` | 26 | `projectGroupDeleted` | | |
| 13 | `gitRepositoryCreated` | 36 | `documentCreated` | | |
| 14 | `issueMultiUpdated` | 37 | `documentDeleted` | | |

27〜35 と 47 は欠番。名前の一覧は CLI のバージョンごとに固定され、
Backlog 側で増えたイベントは数値で書いて使う（W-1）。

## 12. JSON Schema で表現できない制約

以下は JSON Schema に載せない。載せる場所は [検証パイプライン](validation-pipeline.md) で定める。

| 検証 | 載せない理由 |
| --- | --- |
| V-A5 同一配列内の `name` 重複 | `uniqueItems` はオブジェクト全体の一致しか見ない。プロパティ単位の一意性を表現できない |
| V-A6 / V-A6a / V-A8 / V-A14 ステータス関連 | 既定かどうかの判定に ID（＝スナップショット）が要る（K-5） |
| V-A10 `applicableIssueTypes` の参照 | 同一ドキュメント内の別配列を参照する記述ができない |
| V-A12 `grandchildIssueEnabled` → `subtaskingEnabled` | 書けなくはないが、依存を表す `if`/`then` が増えるほど生成 JSON が読めなくなる。他の相互制約と同じ場所に置く |
| V-A17 `oldname` と `name` の衝突 | 同上 |
| V-A15 / V-A16 / V-B* | スペースの実状または計画結果が要る |

## 13. 判断理由のまとめ

| ID | 決定 | 採らなかった案と理由 |
| --- | --- | --- |
| M-1 | JSON Schema はコードから生成 | 手書き + Ajv。検証が2箇所に分かれてズレる |
| M-2 | `$schema` キーを受理して無視 | strict parse でエラー。正しく書いた人を怒るのは最悪の第一印象 |
| Y-1 | 日付は文字列（timestamp 型を無効化） | YAML の Date に任せる。引用符の有無で型が変わる罠を新たに作る |
| E-1 | `${ENV}` は全文字列値 | 対象キーを列挙。例外を覚えさせる |
| E-4 | 展開値は常にマスク | 対象キーを列挙してマスク。追加漏れがそのまま漏洩になる |
| E-6 | 展開経路を別に持ち、`Action` を組む段で包む | マニフェストの型を `string \| Secret` にする。検証のたびに `reveal()` が要り、「送信の直前だけ」という不変条件が崩れる |
| K-1 | キー省略 = 空配列 | 省略 = 管理対象外。「書き忘れ」と「意図的に管理しない」が区別できなくなる |
| K-4 | 課題種別の色は enum。パレット外はエラー | 警告に留める／`pattern` のみ。同じマニフェスト上の2つの `color` で強さが変わる理由を利用者に説明できない |
| K-5 | 既定ステータス判定を Schema でやらない | 既定名を enum に持つ。言語設定が違うスペースで誤検出 |
| K-6 | カスタム属性の型は名前のみ | 数値も許す。前方互換の必要が無いところに書き方を2つ作る |
| K-7 | イベント名は `const` の `oneOf` | `enum`。値ごとの説明を補完に出せない |
