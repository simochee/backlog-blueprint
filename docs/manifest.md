# Writing a manifest

Which keys exist, what type each one takes, and which values are allowed are all in the JSON Schema,
and your editor will show them while you type — start from the
[`$schema` comment](../README.md#json-schema) and let completion do that work.

This page is about the rest: the behavior behind the keys, which no schema can describe. What it
means to leave something out, how resources are matched against what already exists, what Backlog
refuses to let you change, and why two manifests that produce the same project can take very
different amounts of time to apply.

## The file itself

A manifest describes exactly one project. A few properties of YAML are worth knowing before they
surprise you.

- **Quote colors.** `color: #ea2c00` is not a color; `#` starts a comment, so YAML reads the value as
  empty. Always write `color: "#ea2c00"`. The tool detects this particular mistake and says so, but
  it is easier to never make it.
- **Dates are plain strings.** `2026-10-01` and `"2026-10-01"` mean the same thing here. The tool
  never converts a date into a timestamp, so there is no timezone in the picture.
- **One document per file.** A `---` separator starting a second document is an error rather than
  half a file that is silently ignored.
- **Anchors and aliases work.** `&name` and `*name` are ordinary YAML and are expanded before
  anything else looks at the file.
- **An unknown key is an error.** A misspelled key is never skipped over, and neither is a key from a
  newer version of the tool than the one you are running. Being told "this key does not exist here"
  is unpleasant; being told "applied successfully" while a setting you wrote had no effect is worse.
- **A top-level `$schema:` key is accepted and ignored.** The version that matters is the one in the
  `# yaml-language-server:` comment, but writing the key as well does no harm.

## Anything you do not write is deleted

The manifest is a complete picture of the project, not a list of additions. Issue types, statuses,
categories, milestones, custom fields, members and webhooks that exist in Backlog but are absent
from the file are removed.

**Leaving a key out entirely is the same as writing an empty list.** There is no way to say "I am
not managing this part". If `categories` is missing, every category is deleted; if `access` is
missing, every member is removed from the project and every project administrator loses the role.
That does not lock you out. You run as a space administrator, and a space administrator can
administer a project without belonging to it — which is also why you must not write yourself into
`administrators`; [`access`](#access) below says what to write instead.

The same rule applies one level down. `access: { teams: [31] }` leaves `members` and
`administrators` empty, with the same consequence.

Scalar keys work the other way around. A key you do not write is not sent at all, so Backlog keeps
whatever it has — the tool has no opinion of its own about what a setting should default to. Leaving
`required` out of a custom field that is currently required does not make it optional; write
`required: false` if that is what you mean. The same goes for everything under `settings`, for
`templateSummary`, `description`, `startDate`, and so on.

The one place where those two rules collide is `customFields[].applicableIssueTypes`. It is a list,
so the list rule wins: an empty or absent `applicableIssueTypes` means "not restricted to any
particular issue type", and removing it from a field that was restricted lifts the restriction.

## Resources are matched by name

Nothing in the manifest refers to a Backlog ID. A resource in the file and a resource in the project
are the same resource when their names are equal.

This means renaming is not something the tool can see. Change `name: 要望` to `name: 改善` and the
plan will delete one issue type and create another, because that is genuinely all the information
available. On a project with no issues nothing is lost by that, which is exactly why the tool
restricts itself to such projects.

It still costs two write requests, and `oldname` brings that down to one:

```yaml
issueTypes:
  - name: 調査
    oldname: その他 # reuse the default issue type instead of replacing it
    color: "#2779ca"
```

`oldname` says "if something called this exists, rename it instead of starting over". If nothing by
that name exists, the entry is simply created as usual — no error. That matters more than it sounds:
after the first successful run the old name is gone, and an `oldname` that complained about its own
success would make the manifest impossible to apply twice. Keeping or deleting the line afterwards
makes no difference to the result.

`oldname` is available on `issueTypes`, `statuses`, `categories`, `milestones` and `customFields`.
It may not name another entry in the same list, since that would describe two resources becoming
one.

## The four default statuses

Every Backlog project starts with 未対応, 処理中, 処理済み and 完了, and the API will not let you
delete them, rename them, or change their color. There is no way to express "I don't want these",
so **the manifest has to list all four**, without `color` and without `oldname`:

```yaml
statuses:
  - name: 未対応
  - name: 処理中
  - name: レビュー中
    color: "#3b9dbd"
  - name: 処理済み
  - name: 完了
```

Everything else about statuses follows from Backlog's own constraints. There can be twelve at most,
including the four. 未対応 must come first and 完了 last, and 処理中 must appear before 処理済み.

A custom status must have a `color`, chosen from a fixed palette that your editor offers as
completions. This holds even for a custom status that already exists in Backlog, so that a manifest
that worked on an existing project does not fail the day it is applied to a new one.

On a project that already exists, the tool identifies the default statuses by ID, so a space whose
display language is not Japanese still works; write the names as that space shows them. For a
project that does not exist yet, the Japanese and the English names are accepted.

Issue types have no such protection. The four that Backlog creates — タスク, バグ, 要望, その他 —
are deleted if the manifest does not mention them, with one floor: a project must always keep at
least one issue type, so a manifest with an empty `issueTypes` is rejected before anything runs.
On a project that does not exist yet those four names are not known in advance, so the first four
entries in `issueTypes` take over the four default slots whatever they are called, and a slot left
over is deleted.

## Display order

The order you write resources in is the order you get, as far as the API allows.

Statuses can be reordered, so their order is guaranteed. Nothing else can: issue types, categories,
milestones and custom fields are shown in the order they were created, and Backlog offers no way to
rearrange them afterwards. New entries land at the end of what is already there.

The tool will not delete and recreate resources to force the order you wrote — that would turn a
cosmetic difference into a pile of write requests. Instead, `plan` shows the order the project will
actually end up with, and warns when it differs from the file.

One detail is easy to miss: a newly created custom status is inserted *before* 完了, not at the end.
That is why applying a manifest that adds a status always ends with an explicit reordering request.

## How long `apply` takes

Backlog's write APIs are meant to be called one at a time, about a second apart, and the tool does
not try to be cleverer than that. So the number of write requests *is* the running time, which is
why `plan` ends with a count of them and an estimate in seconds.

Five things change that number, roughly in order of how much they are worth:

**Match what already exists.** A resource whose name and attributes are identical to the one in
Backlog produces no request at all. A template built on Backlog's four default issue types needs
eight fewer requests than one that replaces them — four deletions and four creations that never
happen — when it is applied to a project that already exists. On a new project the first four
entries cost one request each whatever they are called, so the saving there comes from staying
within those four and from the other points below. Cleaning the defaults away is a real choice with
a real price, and when you design an organization-wide template it is worth asking which parts can
be made to agree with the defaults instead. It is also why the plan in the README reports five
unchanged resources and eight requests instead of thirteen.

**Rename with `oldname` instead of replacing.** Two requests become one. Where a default cannot be
kept as it is, renaming it is the next cheapest thing.

**Add people through teams.** A team is one request no matter how many people are in it, while
twenty individual members are twenty requests.

**Do not repeat yourself in `access`.** Someone already covered by a team, or by `administrators`,
costs one more request if they appear in `members` as well; [`access`](#access) below says why.

**Some keys cost one request however large.** All of `settings` travels in a single request; so do
the status order, `applicableIssueTypes`, and a webhook's `events`. Nothing you write there adds to
the count.

## Values from the environment

Any string value may contain `${NAME}`, which is replaced with the environment variable of that
name. Use it for values that vary between environments, including names and template text.

```yaml
webhooks:
  - name: Slack 通知
    hookUrl: ${SLACK_WEBHOOK_URL}
```

A value that is nothing but a single `${NAME}` takes the type the key expects: where a key accepts
`true`/`false` or a number, an expanded `true`, `false` or JSON number such as `31` or `-1.5` becomes
that type. Anything else stays a string and is checked like one. A reference inside other text, such
as `PROJ_${ENV}`, always stays a string.

```yaml
settings:
  chartEnabled: ${CHART_ENABLED} # CHART_ENABLED=true
access:
  teams:
    - ${QA_TEAM_ID} # QA_TEAM_ID=31
```

An undefined variable is an error — except under `validate`, where it is only a warning, so that a
CI job can check the manifest without those values. To write the characters literally, escape the
expansion as `$${NAME}`.

Expanded values appear in `plan` and its JSON output like values written directly in YAML: the
tool cannot tell whether a value is sensitive, so it does not mask any. A value that must not show
up in plan output or CI logs does not belong in the manifest, whether written directly or through
`${NAME}`. The API key is not a manifest value and never appears in plan or apply output.

In the browser there is no environment, so the Web UI reads the names out of your manifest and asks
you to fill them in.

## `access`

```yaml
access:
  teams: # team IDs
    - 31 # 開発チーム
    - 32 # QA
  members: # user IDs of people who are not in any of those teams
    - suzuki # 鈴木 花子
  administrators: # user IDs of people to make project administrators
    - yamada # 山田 太郎
```

Teams are written by their numeric ID, not by name. Backlog does not keep team names unique within
a space, so a name could point at more than one team; an ID cannot. The names after `#` are
comments for whoever reads the file. The tool ignores them: the ID decides, and `plan` shows the
team's current name from Backlog. You rarely have to look an ID up yourself — `export` and the Web
UI's Teams pane both write the ID with the name beside it, and the Users pane does the same with
each person's display name.

Teams and individuals are separate keys because a name alone would not say which one was meant, and
because they are added through different APIs. `administrators` is separate again, and holds people
rather than teams: Backlog grants the project administrator role to individuals only, so there is no
way to write "this whole team administers the project".

Anyone in `administrators` is added to the project automatically if they are not in it already.
Backlog refuses to grant the role to a non-member, so this is not a convenience — it is the only way
the grant can succeed.

**You cannot be one of them.** The tool only runs with the API key of a space administrator, and
Backlog refuses to make a space administrator a project administrator: the grant comes back as
`Only normal-user role can be a project administrator.` Validation reports this before anything is
applied, so it costs you a run rather than a project left half-configured. If you want to appear in
the project, write yourself under `members`. Leaving yourself out of the file altogether is fine
too: being a space administrator is already enough to operate the project.

`members` is for people who are not covered by a team, and not covered by `administrators` either.
Listing someone who is already covered is not wrong, but it joins them a second time as an
individual, which is one more request; `plan` points this out.

When it decides who to remove, the tool looks only at people who joined individually, so team
members are never mistaken for individuals who dropped out of the file.

## `webhooks`

```yaml
webhooks:
  - name: Slack 通知
    description: 課題の追加・更新を Slack に流す
    hookUrl: ${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
      - 50 # an event this version of the CLI has no name for

  - name: 監査ログ
    hookUrl: ${AUDIT_URL}
    events: all
```

`events` takes event names, which your editor will complete and describe, and it also takes raw
numeric IDs. The names are there so the file can be read; the numbers are there so that an event
Backlog adds tomorrow can be used today, without waiting for a release. `events: all` subscribes to
everything.

The two forms are checked differently, for that reason. A name the tool does not recognize is an
error, because a name can only be a typo. A number it does not recognize is a warning, because it
might be a typo or might be the new event you are reaching for. In the plan, numbers are shown with
their names where the tool knows them.

## Starting from an existing project

`export <KEY>` writes a project out as a manifest, in the key order the schema defines, so what you
get back reads like a file you would have written by hand. It describes the project as it is at
that moment and nothing else: there is no comparison with a file you already have, and no state
kept between runs.

Every list key is written even when it is empty. `categories: []` says that the project has no
categories, whereas a missing key would leave you wondering whether the tool had simply not looked
— and since an absent list means deletion, that is not a question to leave open in a file you are
about to edit. `settings` is the exception, because a scalar key that is not written means "keep
what Backlog has" rather than "remove it": only the keys Backlog reported are written, and if it
reported none, the key is left out altogether instead of appearing as `settings: {}`.

`oldname` is absent because it is a hint about where a resource came from and a project can only
tell you where it is now. Whether a milestone is archived is not written, and neither is the
archived flag of the project itself, since the manifest has no key for either. An archived
milestone comes out as an ordinary one, and a template applied to a new project creates
everything unarchived.

Webhook URLs are written as Backlog returns them. Replace any of them with `${NAME}` yourself if
you want to supply a different value for each environment. With no edits, `plan` against the
project it came from reports no changes.

Someone who belongs to one of the project's teams **and** joined it individually is written under
`members` as well. `plan` will point that membership out as a repetition — it costs one more
request — but it is not one the tool can drop for you. Removing the line would not remove the
repetition; it would make the manifest say that this person is not an individual member, and the
next `apply` would take their individual membership away.

A project can be in a state no manifest can describe: two categories with the same name, a name
containing `}`, a status whose color is not one of the ten, a webhook subscribed to nothing. When
that happens, `export` writes nothing at all and lists every such problem at once, so that you can
fix them in Backlog and run it again rather than discover them one at a time. Writing the file
anyway would mean handing you something the same tool's own `validate` rejects.

One edit is always yours to make. The `key` and `name` that come out still point at the project you
exported, so give the manifest new ones before you apply it as a template. Applying it back
unchanged is not a shortcut either: if that project holds issues, `plan` and `apply` refuse it as
they always do.
