# backlog-blueprint

Declare the settings of a [Backlog](https://backlog.com/) project in a YAML file, and create the
project from it. The manifest lives in your repository, so the shape of a project can be reviewed in
a pull request, copied to the next project, and kept as your organization's template instead of a
page of instructions that people follow by hand.

```
projects/PROJ_A.yaml  ──[ validate ]──[ plan ]──[ apply ]──▶  Backlog space
```

It manages the project's basic settings, issue types, statuses, categories, milestones, custom
fields, teams, members and administrators, and webhooks.

## What it is not

backlog-blueprint is a **one-shot initializer**. It sets a project up once; it is not a control loop
that keeps Backlog in step with a file over time. Two consequences are worth knowing before you
adopt it:

- **It only touches projects that have no issues.** If the project already exists and holds even one
  issue, `plan` and `apply` stop before changing anything. A project that is already in use is out
  of scope, and there is no way to opt out of that check.
- **It keeps no state.** There is no state file and no drift detection. Each run reads the space as
  it is now and computes what to do from the manifest alone. `export` writes down what a project
  looks like *right now*, as a starting point for a template; it is not a way to watch a project for
  drift, and the tool never compares two manifests.

The internal design documents call the per-resource modules *reconcilers*, and `plan` / `apply` will
look familiar to anyone who has used Terraform. Only the vocabulary is borrowed: nothing watches the
project after `apply` returns.

These are deliberately out of scope as well:

- a form-based editor for the YAML
- Git repositories, which the Backlog API cannot create
- issues and wiki content
- space settings
- priorities and resolutions
- deleting or archiving a project

## Before you start

- You need a Backlog space, and an API key that belongs to a **space administrator**. The key is
  required for every run, whether the project is new or already exists, because the status APIs
  accept nothing less. A project administrator's key is not enough.
- The API key is read from the `BACKLOG_API_KEY` environment variable and from nowhere else. There
  is no `--api-key` option, on purpose: an argument would be visible in `ps`, in shell history, and
  in CI command logs.

### Security: who can change your space

> **Push access to the repository that holds your manifests amounts to space administrator
> access.**

The API key a CI job uses belongs to a space administrator, so anyone who can push a change to a
manifest — or to the workflow that runs it — can rewrite the settings of any project the tool can
reach. No amount of validation inside the tool can prevent this; it is a property of where the
credentials live.

Protect the manifest repository accordingly: require review on the branch that CI applies from,
restrict who can edit workflow files, and keep the key in the narrowest secret scope that works.

## Install

```sh
npx @simochee/backlog-blueprint --help
```

There is nothing to install globally; the CLI is meant to be run through `npx`, both locally and
from CI.

## Quick start

Write a manifest. The comment on the first line is what gives your editor completion and validation
for the file — see [JSON Schema](#json-schema) below.

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
    - 開発チーム
  members:
    - suzuki

webhooks:
  - name: Slack 通知
    hookUrl: ${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
```

Check it without touching Backlog at all:

```sh
npx @simochee/backlog-blueprint validate -f projects/PROJ_A.yaml
```

Point the tool at your space and see what would happen. Here `PROJ_A` already exists and holds no
issues:

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
  + projectMember  "suzuki"
  + webhook        "Slack 通知"  hookUrl "https://hooks.example.com/T000/B000"

Warnings:
  ! [V-A16] access.members: "suzuki" already belongs to team "開発チーム"
      Remove it from access.members to save one write request.

Plan: 4 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 8 (estimated 8s)
```

Then carry it out:

```sh
npx @simochee/backlog-blueprint apply -f projects/PROJ_A.yaml
```

`apply` prints the same plan, asks for confirmation, and executes the write requests one at a time.

Notice what the plan above does not contain: not a single issue type is created. Three of the four
that Backlog created with the project are kept — one of them renamed in place by `oldname` — and
only the unused fourth is deleted. On a project that does not exist yet the picture is different:
the default names cannot be known in advance, so the first four entries in `issueTypes` take over
the four default slots, one request each. Either way, how a manifest is written is the main thing
that decides how long a run takes, and [Writing a manifest](docs/manifest.md) explains why.

## Commands

| Command        | Reaches Backlog | API key  | Purpose                                     |
| -------------- | --------------- | -------- | ------------------------------------------- |
| `validate`     | never           | not used | Check the manifest on its own               |
| `plan`         | reads only      | required | Show what `apply` would do                  |
| `apply`        | reads + writes  | required | Carry the plan out                          |
| `export <key>` | reads only      | required | Write an existing project out as a manifest |

The difference between `validate` and `plan` is one thing only: whether Backlog is consulted.
`validate` is for the editor loop and for pull request checks in a CI job that holds neither an API
key nor values referenced by `${ENV}`. It cannot see your space, so it cannot tell you about default statuses,
existing members, or issue counts.

If validation fails, every command stops before the first write and reports every problem it found,
not only the first.

### Options

| Option               | Environment     | Default | Applies to                | Meaning                                     |
| -------------------- | --------------- | ------- | ------------------------- | ------------------------------------------- |
| `-f, --file <path>`  |                 |         | `validate` `plan` `apply` | The manifest, or `-` to read standard input |
| `--space <domain>`   | `BACKLOG_SPACE` |         | all                       | For example `example.backlog.com`           |
| `--output <format>`  |                 | `text`  | `validate` `plan` `apply` | `text` or `json`                            |
| `--no-color`         | `NO_COLOR`      |         | all                       | Disable colored output                      |
| `--show-unchanged`   |                 |         | `plan`                    | Also list the resources that already match  |
| `-y, --auto-approve` |                 |         | `apply`                   | Skip the confirmation prompt                |

`-f` may be given only once, and `export` takes exactly one project key. One manifest is one
project, and one command handles one project; to process several, loop in the shell.

With `--output json`, standard output carries nothing but the JSON document, so it can be piped
straight into `jq`. Progress, warnings, errors, and the confirmation prompt go to standard error.

`apply` asks for confirmation by default and accepts nothing but the word `yes` typed in full. If
standard input is not a terminal and `--auto-approve` was not given, it stops with an error rather
than waiting for an answer nobody will type.

### Exit codes

| Code | `validate`                             | `plan`          | `apply`                         | `export` |
| ---- | -------------------------------------- | --------------- | ------------------------------- | -------- |
| 0    | passed                                 | no changes      | applied                         | written  |
| 1    | validation error, or any other failure | error           | error, including an aborted run | error    |
| 2    | —                                      | changes to make | —                               | —        |

`plan` returning 2 is what makes it useful in CI: it separates "this manifest matches the space"
from "this manifest would change something" without parsing the output.

### Starting from a project you already have

`export` reads a project and writes it out as a manifest, so an organization's template can begin
from a project that already works rather than from a blank file.

```
$ backlog-blueprint export PROJ_A > projects/standard.yaml
```

Standard output carries the YAML and nothing else, so redirecting it gives you the file; everything
else goes to standard error. Nothing is written at all unless every read succeeded, so a failed run
never leaves you with half a manifest.

Two things are worth knowing before you use the result.

- **Webhook URLs are included.** `export` writes the values returned by Backlog. Replace any value
  with `${NAME}` yourself when you want to supply it from the environment. Review the generated
  file before committing it.
- **The project it came from can have issues.** `export` only reads, so any project can be a
  template. Applying that manifest back to the same project is another matter: `plan` and `apply`
  still refuse a project that holds issues. Change `key` and `name` first, which is what you would
  do to reuse a template anyway.

This is not drift detection, as [What it is not](#what-it-is-not) says: nothing watches the project
after `export` returns.

### When `apply` stops partway

There is no rollback. Some resources cannot be deleted at all, so an automatic undo could only ever
produce a differently broken project. Instead, `apply` stops at the failing request and prints what
was applied, what failed, and what was never attempted.

Running the same manifest again continues from where it stopped, because work that has already been
applied is recognized and skipped. This depends on the project still having no issues at that
point: if someone files one in the meantime, the run stops at validation and the project can no
longer be managed with this tool.

## Web UI

The same validation and planning code runs in a browser at
**<https://simochee.github.io/backlog-blueprint/>**, for people who would rather paste YAML than
install anything. It is a static page with no server behind it: it talks to the Backlog API directly
from the browser, and the API key is held in memory only, never written to storage of any kind.

## JSON Schema

The schema is published alongside the Web UI, one URL per released version:

```
https://simochee.github.io/backlog-blueprint/schema/<version>/project.json
```

The version in the URL is the version of the CLI, and old URLs are never removed, so an editor
keeps working on a manifest written years ago. Pointing at it with the
`# yaml-language-server: $schema=...` comment gives you completion, inline documentation, and
red squiggles for spelling mistakes. The schema is a convenience rather than the authority, though:
the CLI performs many checks that no schema can express, so a manifest your editor is happy with
can still be rejected.

## Further reading

- **[Writing a manifest](docs/manifest.md)** — what the editor cannot tell you: what deletion means,
  `oldname`, default resources, display order, `${ENV}`, `access`, `webhooks`, what `export` writes
  and leaves out, and how the way you write the file decides how long `apply` takes.
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — working on the tool itself.
- **`.claude/docs/`** — the specification and the reasoning behind it: the requirements, the
  measured behavior of the Backlog API that constrains the design, and the decision records that
  the `[V-A6]`-style identifiers in error messages refer to. They are written in Japanese and are
  the authority wherever this README disagrees with them.

## License

backlog-blueprint is released under the MIT License. See [LICENSE](LICENSE) for the full text.
