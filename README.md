# backlog-blueprint

English | [日本語](https://github.com/simochee/backlog-blueprint/blob/main/README.ja.md)

[![npm version](https://img.shields.io/npm/v/@simochee/backlog-blueprint)](https://www.npmjs.com/package/@simochee/backlog-blueprint)
[![CI](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/simochee/backlog-blueprint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@simochee/backlog-blueprint)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/simochee/backlog-blueprint)](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)

Create a [Backlog](https://backlog.com/) project from a YAML file.

![backlog-blueprint](https://raw.githubusercontent.com/simochee/backlog-blueprint/main/packages/brand/out/eyecatch.svg)

The manifest lives in your repository, so a project's settings can be reviewed in a pull request and
reused for the next project. `plan` shows what will change; `apply` makes the changes.

A manifest can include:

- basic project settings
- issue types, statuses, and categories
- milestones and custom fields
- teams, members, and administrators
- webhooks

## Requirements

- Node.js 22 or later
- A Backlog space and an API key

## Usage

Run it with `npx`; there is nothing to install.

```sh
npx @simochee/backlog-blueprint --help
```

Write a manifest. The comment on the first line gives your editor completion and validation (see
[JSON Schema](#json-schema)).

```yaml
# yaml-language-server: $schema=https://simochee.github.io/backlog-blueprint/schema/0.1.0/project.json
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

Check the file without contacting Backlog:

```sh
npx @simochee/backlog-blueprint validate -f projects/PROJ_A.yaml
```

`validate` needs no API key and no `${ENV}` values, so it can run in a pull request check. It cannot
see your space, so it cannot report default statuses, existing members, or issue counts; `plan` can.

See what `apply` would change. In this example, `PROJ_A` already exists and has no issues:

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

Apply it:

```sh
npx @simochee/backlog-blueprint apply -f projects/PROJ_A.yaml
```

`apply` prints the same plan and asks for confirmation before it writes anything. Only the word
`yes` is accepted; any other answer exits with code 1.

[Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md)
explains the rest of the format.

## Commands

| Command        | Contacts Backlog | Description                              |
| -------------- | ---------------- | ---------------------------------------- |
| `validate`     | no               | Check a manifest                         |
| `plan`         | read only        | Show the changes that `apply` would make |
| `apply`        | read and write   | Apply the plan                           |
| `export <key>` | read only        | Print an existing project as a manifest  |

If validation fails, every command reports every problem it found and stops before the first write.

### Options

| Option               | Commands                  | Description                                       |
| -------------------- | ------------------------- | ------------------------------------------------- |
| `-f, --file <path>`  | `validate` `plan` `apply` | Manifest to read (required). `-` reads stdin      |
| `--space <domain>`   | all                       | Backlog space, such as `example.backlog.com`      |
| `--output <format>`  | `validate` `plan` `apply` | `text` (default) or `json`                        |
| `--no-color`         | all                       | Turn off colored output                           |
| `--show-unchanged`   | `plan`                    | Also show resources that already match            |
| `-y, --auto-approve` | `apply`                   | Skip the prompt. Required when stdin is not a TTY |

Each run handles one manifest and one project: `-f` is accepted once, and `export` takes exactly one
key. To process several projects, loop in the shell.

With `--output json`, standard output contains only the JSON document. Progress, warnings, errors,
and prompts are written to standard error.

### Environment variables

| Variable          | Description                                        |
| ----------------- | -------------------------------------------------- |
| `BACKLOG_API_KEY` | API key. Required by `plan`, `apply`, and `export` |
| `BACKLOG_SPACE`   | Same as `--space`                                  |
| `NO_COLOR`        | Same as `--no-color`                               |

There is no `--api-key` option, because command-line arguments show up in `ps`, shell history, and
CI logs. `${NAME}` references in a manifest are also resolved from environment variables.

### Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | Success. For `plan`: no changes                    |
| 1    | Error, including validation errors and failed runs |
| 2    | `plan` only: there are changes to apply            |

In CI, exit code 2 from `plan` tells you the manifest would change the space, without parsing the
output.

### Starting from an existing project

`export` prints a project as a manifest. This lets you use an existing project as a template:

```sh
npx @simochee/backlog-blueprint export PROJ_A > projects/standard.yaml
```

Standard output carries only the YAML. If any read fails, nothing is written and the command exits
with code 1.

The output includes webhook URLs exactly as Backlog returns them; replace secrets with `${NAME}` and
review the file before you commit it. Any project can be exported, even one with issues, but `plan`
and `apply` still refuse a project that has issues, so change `key` and `name` before you apply the
file.

`export` writes what the project looks like right now, as a starting point for a template. It is not
drift detection: the tool never compares two manifests.

## Limitations

backlog-blueprint sets up a project once. It does not keep Backlog in sync with the manifest
afterwards.

- **Only projects without issues.** If the project already exists and has at least one issue, `plan`
  and `apply` stop before making changes. You cannot turn off this check.
- **No state.** There is no state file or drift detection. Each run reads the current project and
  compares it with the manifest.
- **Some operations need a space administrator's key.** Backlog accepts creating a project, changing
  statuses, and adding project administrators only from a space administrator. `plan` warns you
  (`V-B2`) when the plan includes an operation your key cannot perform.
- **No rollback.** If `apply` fails partway through, it stops and reports what was applied, what
  failed, and what was not attempted. Run the same manifest again to continue: work already applied
  is skipped, as long as the project still has no issues.

The following are also out of scope: Git repositories, issues, wiki pages, space settings, and
deleting or archiving projects.

## Security

> **Warning:** push access to the repository that holds your manifests is, in effect, the access of
> whoever owns the API key in CI. Anyone who can push a manifest, or edit the workflow that runs it,
> can change every project that key can reach — the whole space, if the key belongs to a space
> administrator.

Require reviews on the branch that CI applies from. Limit who can edit workflow files. Store the API
key in the smallest secret scope that works.

## Web UI

<https://simochee.github.io/backlog-blueprint/> provides the same validation and planning in your
browser. It is a static page that calls the Backlog API directly. Your space and API key stay in the
tab's session storage, so a reload does not ask for them again; they are removed when you close the
tab or click **Disconnect**.

Paste or drop a manifest, or **Open** a file, then **Plan** and **Apply**. Unlike the CLI, **Apply**
does not ask for confirmation, so read the plan first. **Save** (Cmd/Ctrl+S) writes back to the
opened file in Chromium-based browsers and downloads a copy in others. **Import from Backlog** loads
an existing project into the editor as the same YAML that `export` prints.

## JSON Schema

Each release has a published JSON Schema:

```
https://simochee.github.io/backlog-blueprint/schema/<version>/project.json
```

The version in the URL is the CLI version, and old URLs are never removed. The CLI checks many
things a schema cannot express, so a manifest your editor accepts can still fail `validate`.

## Documentation

- [Writing a manifest](https://github.com/simochee/backlog-blueprint/blob/main/docs/manifest.md):
  deletion, `oldname`, default resources, ordering, `${ENV}`, `access`, `webhooks`, and why `apply`
  can be slow
- [DEVELOPMENT.md](https://github.com/simochee/backlog-blueprint/blob/main/DEVELOPMENT.md): how to
  work on backlog-blueprint itself
- [`.claude/docs/`](https://github.com/simochee/backlog-blueprint/tree/main/.claude/docs): the
  specification in Japanese. IDs such as `[V-A6]` in error messages refer to it

## License

[MIT](https://github.com/simochee/backlog-blueprint/blob/main/LICENSE)
