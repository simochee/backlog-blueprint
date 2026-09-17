# 先行事例の調査: GitHub の設定 IaC

最終更新: 2026-09-18

Backlog のプロジェクト設定を Yaml で管理するのと**同じ問題**を、GitHub 界隈は何年も運用している。
構文をゼロから考えるより、そこで検証済みの形を借りるほうが筋が良い。

調査対象:

| ツール | 対象 | 特徴 |
| --- | --- | --- |
| [repository-settings/app](https://github.com/repository-settings/app) | リポジトリ設定 | `.github/settings.yml` を PR で変更して同期する。Probot 製 |
| [github/safe-settings](https://github.com/github/safe-settings) | Organization 全体 | org / suborg / repo の3層で設定を継承する。GitHub 公式 |

## 1. 構造の取り方

`safe-settings` の設定ファイルはこうなっている（抜粋）。

```yaml
repository:
  description: description of the repo
  private: true
  has_issues: true
  default_branch: main
  allow_squash_merge: true

labels:
  include:
    - name: bug
      color: CC0000
      description: An issue with the system
    - name: first-timers-only
      oldname: Help Wanted
      color: "#326699"
  exclude:
    - name: ^release

milestones:
  - title: milestone-title
    description: milestone-description
    state: open

collaborators:
  - username: regpaco
    permission: push

teams:
  - name: core
    permission: admin
```

読み取れる設計原則。

| 原則 | 内容 |
| --- | --- |
| G-1 | **基本設定は1ブロックにフラットに詰める**（`repository:`）。API の1リクエストに対応する単位でまとめる |
| G-2 | **リソース種別ごとにトップレベルのキーを立てる**（`labels` / `milestones` / `teams` / `collaborators`）。ネストを深くしない |
| G-3 | **キー名を API のフィールド名にそのまま合わせる**（`allow_squash_merge` は GitHub API のフィールド名そのもの） |
| G-4 | **各要素は `name`（または `username` / `title`）で同定する**。ID は書かせない |

本ツールの構造（`settings` / `issueTypes` / `statuses` / ...）は既に G-1・G-2 と同じ形になっている。

### G-3 について: 表記スタイルは真似しない

GitHub の Yaml が `snake_case` なのは **GitHub API が `snake_case` だから**であって、
snake_case そのものが良いわけではない。原則は「API の命名をそのまま使う」ことにある。

Backlog API は `camelCase`（`textFormattingRule`、`useDevAttributes`、`substituteIssueTypeId`）。
したがって**本ツールは camelCase を採用する**。API リファレンスと Yaml とエラーメッセージが
1対1で対応し、利用者が読み替えをしなくて済む。

## 2. 借りるべき仕組み

### 2.1 `oldname` によるリネーム宣言 — 採用する

`safe-settings` のラベル定義:

```yaml
- name: first-timers-only
  oldname: Help Wanted     # 既存の "Help Wanted" をリネームする
  color: "#326699"
```

`repository-settings/app` は逆方向の `new_name` を持つが、**`oldname` のほうが優れている**。

- `new_name` 方式: Yaml に「今の名前」を書き、別キーに「新しい名前」を書く。
  適用後は Yaml を書き換えないと次回が壊れる。**宣言的でない**
- `oldname` 方式: Yaml は常に「あるべき姿」を表し、`oldname` は移行元のヒントに過ぎない。
  適用後もそのまま置いておける

本ツールにとっての価値は**リクエスト削減**にある。

```yaml
# oldname 無し: 「その他」を削除 + 「調査」を作成 = 2リクエスト
- name: 調査
  color: "#2779ca"

# oldname 有り: 「その他」を更新 = 1リクエスト
- name: 調査
  oldname: その他
  color: "#2779ca"
```

課題0件が前提なので結果は同じになる。純粋に速度のための機構。

> 既定ステータスのリネームが可能だと判明した場合、この仕組みの価値はさらに上がる。
> `- name: Done / oldname: 完了` と書けるなら、削除できない既定ステータスを
> 任意の名前で使い回せることになり、V-A6 の制約を緩和できる。
> [未検証事項](../research/backlog-api-constraints.md#未検証事項の一覧) を参照。

### 2.2 `exclude` による削除除外 — 記録するが初期スコープ外

```yaml
labels:
  exclude:
    - name: ^release      # GitHub 上で作られた release* は消さない
```

「Yaml に無いものは削除」に対する安全弁。正規表現で削除対象から除外する。

本ツールは新規プロジェクトと課題0件のプロジェクトしか対象にしないため、
「手で作ったものを守る」必要性が薄い。初期スコープ外とするが、
差分適用を将来入れるなら真っ先に必要になる機構として記録しておく。

### 2.3 `_extends` による継承 — 記録するが初期スコープ外

別リポジトリの設定を継承し、差分だけを書ける。
配列要素は **`name` が一致するものどうしでマージ**される。

依頼者は「1ファイル = 1プロジェクト」を選択済みで、テンプレート機構は入れない決定になっている。
将来「組織標準の雛形 + プロジェクト固有の差分」が欲しくなったときは、
`name` でマージするというこの方式が前例になる。

### 2.4 リソース種別ごとのプラグイン構成 — 採用する

両ツールとも、リソース種別ごとに独立したプラグイン（`labels` / `teams` / `branches` ...）を持ち、
それぞれが「現状を取得 → 差分を出す → 適用する」を実装している。

本ツールの `core` も同じ形にする。

```
core/
  resources/
    project.ts       diff(): Action[] / apply(actions)
    issueTypes.ts
    statuses.ts
    categories.ts
    milestones.ts
    customFields.ts
    access.ts
    webhooks.ts
```

リソースを1つ増やすことが「ファイルを1つ足して適用順序に並べる」だけになる。
plan と apply が同じ `Action[]` を扱うので、「plan に出ないのに apply で起きる」が構造的に消える。

## 3. 反面教師

### 3.1 削除挙動が文書化されていない

`repository-settings/app` のドキュメントは、**Yaml に書かなかったリソースがどうなるかを明記していない**。
設定 IaC で利用者が最も恐れるのはこれなので、書かないのは不親切を通り越して危険。

本ツールは [要件定義 §2.2](../requirements/requirements-definition.md#22-構造) で
リソースごとに削除の扱いを表にしている。この方針を維持する。

### 3.2 `#` 始まりの色は引用符が要る

```yaml
color: '#336699'    # 引用符が無いと YAML のコメントとして解釈される
```

`safe-settings` のサンプルにわざわざ注意書きがある、実際によく踏まれる罠。
Backlog も色を `#ea2c00` 形式で扱うため同じ問題が起きる。
JSON Schema で色を必須のパターン付き文字列にし、
値が `null` になったときは「引用符で囲ってください」と明示するエラーを出す。

### 3.3 設定リポジトリへの push 権限が管理者権限になる

`repository-settings/app` の README にある警告。

> this mechanism "inherently _escalates anyone with `push` permissions to the **admin** role_"

**本ツールにも完全に同じ問題がある。** マニフェストをリポジトリに置いて CI から適用する構成では、
そのリポジトリに push できる人が、実質的に Backlog スペース管理者の権限を手にする。
CI に置く API キーはスペース管理者のものだからである。

これは実装で防げるものではないので、**ドキュメントで明示的に警告する**。
要件としては [NFR-7](../requirements/requirements-definition.md#4-非機能要件) に記載した。
