# backlog-blueprint

English | [日本語](https://github.com/simochee/backlog-blueprint/blob/main/README.ja.md)

[![npm version](https://img.shields.io/npm/v/@simochee/backlog-blueprint)](https://www.npmjs.com/package/@simochee/backlog-blueprint)
[![CI](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@simochee/backlog-blueprint)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/simochee/backlog-blueprint)](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)

Create a [Backlog](https://backlog.com/) project from a YAML file.

![backlog-blueprint](https://raw.githubusercontent.com/simochee/backlog-blueprint/main/packages/brand/out/eyecatch.svg)

**[Try it in your browser](https://backlog-blueprint.simochee.net/)** — no install, no server.

Keep the manifest in your repository to review a project's settings in a pull request and reuse them
for the next project. A manifest can include:

- basic project settings
- issue types, statuses, and categories
- milestones and custom fields
- teams, members, and administrators
- webhooks

## Usage

You need Node.js 22 or later and a Backlog API key.

Write a manifest. The first line gives your editor completion and validation.

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@simochee/backlog-blueprint@0.2.0/schema.json
key: PROJ_A
name: プロジェクトA

issueTypes:
  - name: タスク
    color: "#7ea800"
  - name: バグ
    color: "#990000"
    templateSummary: "【不具合】"
  - name: 調査
    oldname: その他
    color: "#2779ca"

statuses:
  - name: 未対応
  - name: 処理中
  - name: レビュー中
    color: "#3b9dbd"
  - name: 処理済み
  - name: 完了

access:
  teams:
    - 31 # 開発チーム
  members:
    - 12 # 鈴木 花子

webhooks:
  - name: Slack 通知
    hookUrl: ${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
```

Check it offline, with no API key:

```sh
npx @simochee/backlog-blueprint validate -f projects/PROJ_A.yaml
```

See what would change:

```sh
export BACKLOG_SPACE=example.backlog.com
export BACKLOG_API_KEY=...
export SLACK_WEBHOOK_URL=https://hooks.example.com/T000/B000

npx @simochee/backlog-blueprint plan -f projects/PROJ_A.yaml
```

```
Blueprint: PROJ_A (example.backlog.com)

  ~ issueType      "バグ"
      templateSummary: (none) -> "【不具合】"
  ~ issueType      "調査"  renamed from "その他"
  - issueType      "要望"
  + status         "レビュー中"  color "#3b9dbd"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "鈴木 花子"
  + webhook        "Slack 通知"  hookUrl "https://hooks.example.com/T000/B000"

Warnings:
  ! [V-A16] access.members: "鈴木 花子" (12) already joins the project through the team "開発チーム"
      remove 12 from access.members to save one request. leaving it there also works

Plan: 4 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 8 (estimated 8s)
```

Apply it. `apply` shows the same plan and continues only if you type `yes`:

```sh
npx @simochee/backlog-blueprint apply -f projects/PROJ_A.yaml
```

To start from a project you already have, print it as a manifest:

```sh
npx @simochee/backlog-blueprint export PROJ_A > projects/standard.yaml
```

The output contains webhook URLs as they are, so replace secrets with `${NAME}` before you commit it.
`export` gives you a starting point for a template; it is not a way to detect drift.

## Reference

| Command        | Contacts Backlog | Description                              |
| -------------- | ---------------- | ---------------------------------------- |
| `validate`     | no               | Check a manifest                         |
| `plan`         | read only        | Show the changes that `apply` would make |
| `apply`        | read and write   | Apply the plan                           |
| `export <key>` | read only        | Print an existing project as a manifest  |

| Option               | Commands                  | Description                                       |
| -------------------- | ------------------------- | ------------------------------------------------- |
| `-f, --file <path>`  | `validate` `plan` `apply` | Manifest to read (required). `-` reads stdin      |
| `--space <domain>`   | all                       | Backlog space, such as `example.backlog.com`      |
| `--output <format>`  | `validate` `plan` `apply` | `text` (default) or `json` on stdout              |
| `--no-color`         | all                       | Turn off colored output                           |
| `--show-unchanged`   | `plan`                    | Also show resources that already match            |
| `-y, --auto-approve` | `apply`                   | Skip the prompt. Required when stdin is not a TTY |

| Variable          | Description                                        |
| ----------------- | -------------------------------------------------- |
| `BACKLOG_API_KEY` | API key. Required by `plan`, `apply`, and `export` |
| `BACKLOG_SPACE`   | Same as `--space`                                  |
| `NO_COLOR`        | Same as `--no-color`                               |

`${NAME}` in a manifest is also read from the environment.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| 0         | Success. For `plan`: no changes         |
| 1         | Error                                   |
| 2         | `plan` only: there are changes to apply |

## Limitations

backlog-blueprint sets up a project once. It does not keep Backlog in sync with the manifest.

- **Only projects without issues.** `plan` and `apply` stop if the project already has issues.
- **No state.** Each run reads the project and compares it with the manifest.
- **Some operations need a space administrator's key:** creating a project, changing statuses, and
  adding project administrators. `plan` warns you (`V-B2`) if your key cannot do them.
- **No rollback.** If `apply` fails partway, it reports what was done. Run it again to continue.

Git repositories, issues, wiki pages, and space settings are out of scope.

## Security

> **Warning:** anyone who can push to the repository that CI applies manifests from can change every
> project the CI's API key can reach — the whole space, if the key belongs to a space administrator.

Require reviews on that branch, limit who can edit workflows, and scope the secret as narrowly as you
can.

## Documentation

- [Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md)
- [DEVELOPMENT.md](https://github.com/simochee/backlog-blueprint/blob/main/DEVELOPMENT.md): working
  on backlog-blueprint itself
- [`.claude/docs/`](https://github.com/simochee/backlog-blueprint/tree/main/.claude/docs): the
  specification (Japanese). IDs such as `[V-A6]` in messages refer to it

## License

[MIT](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)
