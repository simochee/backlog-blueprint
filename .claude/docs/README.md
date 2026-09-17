# .claude/docs

Claude Code とのやり取りの中で確定した設計・調査情報を置く場所。
コードで表現できること（How）はここに書かない。ここに書くのは「なぜそうするか」「何を作るか」。

## 文書一覧

| 文書 | 内容 |
| --- | --- |
| [requirements/requirement-design.md](requirements/requirement-design.md) | 要求設計。誰の何の課題を解くか、ユースケース、スコープ／非スコープ |
| [requirements/requirements-definition.md](requirements/requirements-definition.md) | 要件定義。機能要件・非機能要件・検証仕様・受け入れ基準 |
| [research/backlog-api-constraints.md](research/backlog-api-constraints.md) | Backlog API の実地調査結果。設計を縛っている制約の出典付き一覧 |
| [design/manifest-versioning.md](design/manifest-versioning.md) | マニフェストのバージョニング方針と、IaC 一般でのやり方の解説 |
| [design/syntax-reference-github.md](design/syntax-reference-github.md) | 先行事例（GitHub の設定 IaC）の調査と、そこから借りた設計 |

## 更新ルール

- 決定が変わったら該当文書を更新する。決定の履歴は Git に残るので、文書には最新の決定だけを書く。
- 「なぜその決定にしたか」は各文書の判断理由欄に残す。選ばなかった案も理由とともに残す。
- 未検証事項は憶測で埋めず `要検証` として明示する。
