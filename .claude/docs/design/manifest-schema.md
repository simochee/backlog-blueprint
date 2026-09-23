# マニフェストのスキーマ定義

最終更新: 2026-09-23
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
| E-8 | 展開された値を機微として扱わない。**マスクしない** | どの値が機微かはツールに判断できない（下記） |
| E-9 | 配布する JSON Schema は、展開前には判定できない制約の箇所で `${NAME}` を含む文字列も受け付ける | エディタは展開前のテキストを検証する。E-1 で書けると約束した値に赤波線を出さないため（下記） |
| E-10 | 値全体がちょうど1つの `${NAME}` で、その位置のスキーマが真偽値・数値を受け付けるとき、解決した文字列が JSON の `true` / `false` / 数値表記ならその型に変換する | 展開結果は常に文字列なので、変換しないと真偽値・数値の欄では E-1 が成り立たない（下記） |

### E-8: 展開値を機微として扱わない

`${ENV}` は環境ごとに変わる値を差し込むための記法である。
値が機微かどうかは出自やフィールド名から判断できないため、展開後は通常の文字列として検証し、計画と書き出しに表示する。
API キーはマニフェストの値ではなく認証情報として受け取るため、NFR-3 と AC-10 に従って出力しない。

`${NAME}` が解決できない場合の扱いはコマンドによって変わる（[検証パイプライン §4](validation-pipeline.md#4-コマンドごとのステージ構成)）。

### E-9: 配布スキーマは `${NAME}` を受け付ける

core の S3 は**展開後の値**を検証するが、エディタ（yaml-language-server）は**展開前のテキスト**を検証する。
同じスキーマをそのまま配ると、`key: ${PROJECT_KEY}` は `pattern` に、`color: ${COLOR}` は `enum` に、
`chartEnabled: ${CHART}` は型に落ち、E-1 で書けると言った値にエディタが赤波線を出す。

そこで `packages/schema` は、`ManifestSchema` から次の変換で配布物を導出する（M-1 は保たれる。定義は1つのまま、
検証する時点に合わせた2つの見え方を持つ）。

- `pattern` / `enum` / `const` を持つ、または型が `boolean` / `number` / `integer` のスカラーのノードを、
  「元のノード」か「`${NAME}` を含む文字列」の `anyOf` で包む。説明は外側にも写し、ホバーを失わない
- 枝がすべてスカラーの `anyOf` / `oneOf` は、枝ごとではなくノードごと1回だけ包む。
  `oneOf` の各枝に `${NAME}` を足すと、参照がすべての枝に一致して `oneOf` が必ず失敗する
- `if` は包まない。`if` は判別であって制約ではなく、緩めると `then` が意図しない入力に掛かる

**core の実行時スキーマは緩めない。** 展開後に `${` が残るのは `$${NAME}` と書いたリテラルだけで、
それは制約どおりに判定されるべき値である。core にも `anyOf` を入れると、`identify()` が
キーワードと path で振り分けている V-A3 / V-A8 が「どの形にも一致しない」に崩れる。

この変換で配布スキーマは実行時スキーマより緩くなるが、§1 のとおり配布スキーマは部分集合であって権威ではない。
エディタで通って `plan` で落ちる向きのズレは、展開して初めて分かる値についてだけ起きる。
例外が1つある。Web UI のエディタが使う json-schema-library は `then` を合成するとき `anyOf` の配列を連結するので、
カスタム属性の `min` / `max` では、型が要求する側（数値か日付か）ではない方の形も通る（日付型に `min: 5`）。
Ajv と `plan` は拒むので、行番号付きで報告されるのは変わらない。

**Web UI のエディタ（[WU-11](cli-and-web-ui.md)）は、包んだノードの違反を元のノードの違反として報告する。**
codemirror-json-schema が検証に使う json-schema-library は、`anyOf` に一致しない値を
「`anyOf` の配列全体（参照を受ける枝の正規表現を含む）のどれにも一致しない」という1文で報告する。
包む前なら「10色のどれか」と言えていた誤りが、利用者の読めない JSON に変わる。
そこで Web UI は、参照の枝を持つ `anyOf` の違反に限って、値を元のノードだけで検証し直した結果を出す。

### E-10: 値全体が1つの参照なら、真偽値・数値に変換する

`access.teams: [${QA_TEAM_ID}]` や `chartEnabled: ${CHART}` は、展開結果が文字列の `"31"` / `"true"` なので
変換しなければ必ず型エラーになる。E-1 の「例外を覚えさせない」を真偽値・数値の欄でも成り立たせるため、次の条件をすべて満たすときだけ変換する。

1. スカラーの値全体が、ちょうど1つの `${NAME}` である（`PROJ_${ENV}` のような埋め込みは変換しない）
2. その位置の `ManifestSchema` が `boolean` / `number` / `integer` を受け付ける（`anyOf` / `oneOf` / `allOf` の `then` も見る。`if` は見ない）
3. 解決した文字列が、その型の JSON 表記（`true` / `false`、JSON の数値）である

どれかを満たさなければ文字列のまま S3 に渡し、型の誤りは通常どおり行番号付きで報告する。
条件 2 は `if` を見ないので、どの `then` の型も受け付ける型に数える。日付型のカスタム属性で `min: ${M}` に `M=5` を渡すと
数値になり、日付の `pattern` ではなく型の違反として報告される。どちらにしても行番号付きの誤りになるので、`if` を評価して枝を絞ることはしない。

**スキーマを見ずに変換しない。** `name: ${N}` に `N=123` を渡した結果は文字列 `"123"` でなければならない。
**解決した値を YAML のスカラーとして読み直さない。** `#e30000` がコメントとして読まれて `null` になり、
`yes` / `0x1F` のような YAML 固有の表記が入り込む。
**Ajv の `coerceTypes` を使わない。** マニフェストに直接書いた `name: 123` まで文字列にしてしまい、
S3 がデータを書き換えることにもなる。

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
`access` を書かなければ全メンバーが削除対象になる。プロジェクト管理者を宣言している
プロジェクトでは実行者以外の管理者も外れるので、**V-B6 が実行者を締め出す計画を止める**。

**ただし実行者自身を `administrators` に書いてはならない**（A-5 / V-B11）。実行者は必ず
スペース管理者であり（FR-5.4）、**スペース管理者はプロジェクト管理者になれない**。
実行者をプロジェクトに残したいなら `members` に書く。スペース管理者は参加していなくても
そのプロジェクトを操作できるので、書かなくても締め出されはしない。

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

### K-3: 省略されたスカラーキーは「現状維持」

配列（K-1）と違い、スカラーのキーは削除の概念を持たない。
書かれたキーだけを `POST` / `PATCH` のパラメータに載せ、書かれなかったキーは送らない。

**既存プロジェクトの更新**では、送らなければ現状が保たれる。
**新規作成**でも同じでよい。`POST /api/v2/projects` の必須パラメータは
[`name` と `key` の2つだけ](../research/backlog-api-constraints.md#プロジェクト基本設定)で、
`settings` に対応する項目はすべて Optional だからである。

したがって**ツールが既定値を持つ必要はない**。書かれなかったキーは送らず、
Backlog 側の既定に委ねる。ツールが独自の既定値を持つと、
Backlog が既定を変えたときに追随できず、「マニフェストに書いていないのに
ツールの都合で値が決まる」という説明しにくい状態になる。

**この規則は `settings` に限らない。** 配列要素の中のスカラーキー
（`templateSummary` / `description` / `startDate` / `required` など）も同じ扱いで、
省略されたキーは比較にも送信にも載せない。

本文書の表が「既定 `false`」のように書いている欄は、**Backlog が新規作成時に採る値**の説明であって、
ツールが送る値ではない。既に `required: true` のカスタム属性から `required` を省略しても、
`false` を送って倒すことはしない。倒したいなら明示的に `required: false` と書く。

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

**パレット外の色は拒否される**（実測）。ステータスと同じ `error.unknown : color` が返る。
同じマニフェストに並ぶ `issueTypes[].color` と `statuses[].color` を同じ強さで止めるのが、
利用者から見ても API の挙動から見ても正しい。

判定は JSON Schema の enum としてスキーマステージ（S3）で行う。
ステータスの V-A8 が S6 に置かれるのは既定ステータスを ID で除外する必要があるためで
（[K-5](#k-5-既定ステータスの判定を-json-schema-でやらない)）、課題種別にはその事情が無い。



## 7. `statuses[]`

| キー | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `name` | string | **必須** | `minLength: 1` |
| `color` | string | —（**カスタムには実質必須**。V-A26） | 10色パレットの enum |
| `oldname` | string | — | `minLength: 1` |

パレット（[実測](../research/backlog-api-constraints.md#ステータス)）:
`#ea2c00` `#e87758` `#e07b9a` `#868cb7` `#3b9dbd` `#4caf93` `#b0be3c` `#eda62a` `#f42858` `#393939`

**`color` を JSON Schema の `required` に入れられない。** カスタムステータスには必須だが
（`POST /projects/:key/statuses` の必須パラメータ）、既定ステータスには書いてはならない（V-A6a）。
S3 はどれが既定かを判定できない（K-5）ので、**必須の判定は S6 に置く（V-A26）**。

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
| `applicableIssueTypes` | string[] | — | `uniqueItems: true`。**空／省略で全種別**（K-3 の例外。下記） |
| `oldname` | string | — | `minLength: 1` |

`applicableIssueTypes` は K-3（省略されたスカラーキーは現状維持）の**例外**である。
このキーは配列であり、K-1（配列キーの省略は空配列）が当てはまる。空配列は「絞らない＝全種別」を
意味するので、**既に絞られているカスタム属性からこのキーを消すと、絞りが解除される**。
差分としても現れ、空の `applicableIssueTypes[]` を送る。
「書いていないものは削除」（要件定義 §2.2）と同じ向きである。

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
| `teams` | integer[] | 1 以上。`uniqueItems: true`（V-A13） |
| `members` | string[] | 同上 |
| `administrators` | string[] | 同上 |

`teams` はチーム ID（[A-6](../requirements/requirements-definition.md#26-access-の仕様)）、`members` / `administrators` はユーザー ID（ログイン ID）。
V-A13 は `uniqueItems` で JSON Schema が直接表現できる数少ない検証のひとつ。

**3キーはいずれも任意で、省略したキーは空配列として扱う。** `access` 全体を省略した場合
（[K-1](#k-1-配列キーの省略は空配列であって管理対象外ではない)）と同じ規則を、キー単位にも一貫させる。
`access: { teams: [31] }` と書けば `members` と `administrators` は空配列になり、
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
| V-A6 / V-A6a / V-A14 ステータス関連 | 既定かどうかの判定に ID（＝スナップショット）が要る（K-5）。**V-A8（色）は S3 に置く**（[検証パイプライン S3](validation-pipeline.md#s3-スキーマ)） |
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
| E-8 | 展開値は通常の文字列として扱う | 出自やフィールド名で機微性を推定する。環境ごとに変わる名前やテンプレート本文を正しく扱えない |
| E-9 | 配布スキーマだけが `${NAME}` を受け付ける | 実行時スキーマにも `anyOf` を入れる。V-A3 / V-A8 の報告が崩れ、`$${NAME}` のリテラルが制約をすり抜ける |
| E-10 | 値全体が1つの参照なら、スキーマに従って真偽値・数値に変換する | 真偽値・数値の欄では使えないと定める（E-1 に例外を作る）／YAML として読み直す／Ajv の `coerceTypes`。いずれも文字列の欄を壊すか、書いた値まで変える |
| K-1 | キー省略 = 空配列 | 省略 = 管理対象外。「書き忘れ」と「意図的に管理しない」が区別できなくなる |
| K-4 | 課題種別の色は enum。パレット外はエラー | 警告に留める／`pattern` のみ。同じマニフェスト上の2つの `color` で強さが変わる理由を利用者に説明できない |
| K-5 | 既定ステータス判定を Schema でやらない | 既定名を enum に持つ。言語設定が違うスペースで誤検出 |
| K-6 | カスタム属性の型は名前のみ | 数値も許す。前方互換の必要が無いところに書き方を2つ作る |
| K-7 | イベント名は `const` の `oneOf` | `enum`。値ごとの説明を補完に出せない |
