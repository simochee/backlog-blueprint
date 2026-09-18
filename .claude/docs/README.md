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
| [design/manifest-schema.md](design/manifest-schema.md) | 機能設計。マニフェストのキー・型・enum と、JSON Schema の責務範囲 |
| [design/core-reconciler.md](design/core-reconciler.md) | 機能設計。`Action` / 未解決参照 / 解決表と、reconciler と Executor の責務分割 |
| [design/plan-output.md](design/plan-output.md) | 機能設計。plan の人間向け出力と `--output json` の構造 |
| [design/cli-and-web-ui.md](design/cli-and-web-ui.md) | 機能設計。CLI のコマンド体系・入出力と、Web UI の画面構成 |
| [design/validation-pipeline.md](design/validation-pipeline.md) | 機能設計。V-A* / V-B* を7つの実行ステージに割り付けたもの |

読む順序。要求 → 要件 → 機能設計の順に具体化していく。

```
requirement-design ─▶ requirements-definition ─┬─▶ manifest-schema
                                               ├─▶ core-reconciler
                                               ├─▶ plan-output
                                               ├─▶ cli-and-web-ui
                                               └─▶ validation-pipeline
       backlog-api-constraints が全体を縛る
```

## 更新ルール

- 決定が変わったら該当文書を更新する。決定の履歴は Git に残るので、文書には最新の決定だけを書く。
- 「なぜその決定にしたか」は各文書の判断理由欄に残す。選ばなかった案も理由とともに残す。
- 未検証事項は憶測で埋めず `要検証` として明示する。
