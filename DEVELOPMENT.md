# Development

How to work on backlog-blueprint itself. What the tool does is in [README.md](README.md), how to
write a manifest is in [docs/manifest.md](docs/manifest.md), and the rules you have to follow when
changing the code are in [AGENTS.md](AGENTS.md).

## Setup

The repository is a pnpm workspace driven by turbo. Enable Corepack if you do not already have the
pinned pnpm version, then install:

```sh
corepack enable
pnpm install
```

## Commands

Everything is run from the repository root.

```sh
pnpm run build       # build every package in dependency order
pnpm run typecheck   # tsc --noEmit in each package
pnpm run test        # vitest
pnpm run lint        # oxlint
pnpm run lint:fix
pnpm run format      # oxfmt
pnpm run format:check
pnpm run dev         # Vite dev server for the Web UI
```

`lint` and `typecheck` are separate checks and both have to pass: one is fast static analysis, the
other is the type checker.

`format` does not touch Markdown — `.oxfmtrc.json` excludes `**/*.md` so that the documents under
`.claude/docs/` are never rewritten by a tool. Keep Markdown tidy by hand.

To work on a single package, use a filter:

```sh
pnpm --filter @backlog-blueprint/core run test
pnpm --filter @backlog-blueprint/core exec vitest run src/manifest.test.ts
pnpm --filter @backlog-blueprint/core exec vitest watch
```

After `pnpm run build`, the CLI can be run straight out of the build directory, which is the most
direct way to check what a change does to the output:

```sh
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js validate -f path/to/manifest.yaml
```

`validate` never opens a network connection, so it is safe to run against anything. `plan` and
`apply` do talk to Backlog; point them at a space you own, never at somebody else's.

### Adding a dependency

Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml` (B-6) so that every
package agrees on one version. Add them through the catalog rather than writing a range into a
`package.json`:

```sh
pnpm --filter @backlog-blueprint/core add --save-catalog some-package
pnpm --filter @backlog-blueprint/core add --save-catalog -D some-dev-package
```

Adding anything to `packages/core` has a further condition attached; see
[AGENTS.md](AGENTS.md#packagescore-must-not-touch-node-or-the-dom-nfr-5).

## Packages

```
apps/
  cli/             @simochee/backlog-blueprint — the npx entry point, binary name backlog-blueprint
  web/             @backlog-blueprint/web — the Vite SPA published to GitHub Pages
packages/
  core/            @backlog-blueprint/core — parsing, validation, planning, execution
  backlog-client/  @backlog-blueprint/backlog-client — the transport layer, wrapping backlog-js
  schema/          @backlog-blueprint/schema — the JSON Schema artifact, generated from core (M-1)
  brand/           @backlog-blueprint/brand — the eyecatch image and the Web UI icons
  test-utils/      @backlog-blueprint/test-utils — shared test helpers (B-3)
  tsconfigs/       @backlog-blueprint/tsconfigs — shared TypeScript configuration (B-4)
```

`apps/` is what gets distributed; `packages/` is what it is built from (B-1). Every package is
ESM only.

**`packages/core` holds all the behavior.** It parses the manifest, runs the validation stages,
computes the plan, and executes it. `apps/cli` and `apps/web` differ only in how input arrives and
how output is shown, which is what keeps the two from disagreeing (NFR-6). Core never performs I/O
itself: it is handed a `get` and a `send` function and calls them.

**`packages/backlog-client`** provides those two functions on top of Nulab's
[backlog-js](https://github.com/nulab/backlog-js), and both apps use the same one. It exists as a
separate package rather than living inside core for the reason described in AGENTS.md.

**`packages/schema`** turns core's schema definition into the published JSON Schema document. It
writes no files of its own: it returns a path and the contents, and the CLI's Vite build writes
them to `apps/cli/schema.json`. That is how the schema ends up in the npm tarball without any
package gaining a dependency on Node.

**`packages/brand`** draws the eyecatch in JSX and renders it with
[Satori](https://github.com/vercel/satori) and resvg. `pnpm --filter @backlog-blueprint/brand run
render` writes `out/eyecatch.svg` and `out/eyecatch.png`, plus the Web UI's `favicon.svg` and
`apple-touch-icon.png` into `apps/web/public/`; commit all of them after changing the design.
The fonts are committed beside it with their licenses (SIL OFL and Apache 2.0), because Satori has
no access to system fonts and cannot read WOFF2. It is not part of `build`, so nothing else depends on it.

Inside core, one file per resource kind lives under `src/resources/`, and a single Executor carries
out what they produce. Read
[`.claude/docs/design/core-reconciler.md`](.claude/docs/design/core-reconciler.md) for the data
model before changing anything there.

## Tests

`pnpm run test` runs vitest across the workspace. What tests may and may not do is in
[AGENTS.md](AGENTS.md#tests-never-reach-the-network).

`@backlog-blueprint/test-utils` currently offers:

| Helper                                    | Purpose                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fixedSnapshot(overrides?)`               | A phase-0 `Snapshot` built from fixed values                                              |
| `fixedResourceSnapshots(overrides?)`      | The `ResourceSnapshots` a reconciler's `read()` returns                                   |
| `fixedManifest(overrides?)`               | A normalized `Manifest`                                                                   |
| `fixedGet(responses)`                     | A `ReadContext['get']` driven by a path-to-response table; a path outside the table fails |
| `fixedSpaceResponses(overrides?)`         | GET responses for an existing project that has no issues                                  |
| `httpFailure(failure)`                    | Marks a path in the table as throwing an `HttpFailure`                                    |
| `recordingGet(responses)`                 | `fixedGet` that also records requested paths in `requested`                               |
| `recordingSend(respond?)`                 | An `ExecuteContext['send']` that records sent requests in `sent`                          |
| `fixedReadContext(responses, overrides?)` | A `ReadContext`                                                                           |
| `fixedPlanContext(overrides?)`            | A `PlanContext`                                                                           |
| `mockBacklog(options?)`                   | A whole space behind a `fetch` that answers writes as well, and records every request     |
| `withoutWritePacing(run)`                 | Runs `run` with the one-second pause between writes (X-1) collapsed to none               |

The acceptance criteria from the requirements (AC-1 to AC-10) are covered end to end in
`apps/cli/src/acceptance.test.ts` and `apps/cli/src/end-to-end.test.ts`. A change to the CLI's
observable behavior should show up there.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. It is the five
commands listed above — `lint`, `format:check`, `typecheck`, `build`, `test` — in a single job, on
the Node version pinned in `.tool-versions`, with the pnpm version from `packageManager` supplied by
Corepack. The pnpm store and the turbo cache are both carried between runs, so a package that did
not change is not rebuilt.

## Releasing

The first release is `0.1.0`. `.release-please-manifest.json` starts at `0.0.0`, because nothing had
been released yet, and `initial-version` in `release-please-config.json` names the version that a
repository in that state is released at — without it the first release would be `1.0.0`, which is
release-please's default.

What a release publishes, and where:

| Artifact    | Destination                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------- |
| CLI         | npm, as `@simochee/backlog-blueprint`                                                              |
| JSON Schema | Inside the same npm tarball, as `schema.json`, served by jsDelivr at `https://cdn.jsdelivr.net/npm/@simochee/backlog-blueprint@<version>/schema.json` |

The schema's URL carries the CLI's version (D-2), and the schema travels in the CLI's own tarball,
so a version cannot be published without its schema, and npm never lets a published version's
contents change (D-3). jsDelivr serves any file of any published npm version; there is nothing to
deploy for it.

The Web UI is not part of a release. **Pages is deployed on every push to `main`**, so a correction
to the Web UI is live without the CLI having to find a reason to be published, and a change to the
Web UI alone never produces a release (see [Which commits count](#which-commits-count)).

### Where the version comes from

Nobody edits it by hand. release-please derives the next version from the Conventional Commit types
that landed on `main` since the last release, and writes it into `apps/cli/package.json`, the root
`package.json` and `.release-please-manifest.json` in the very commit it then tags — so the tag,
the published package and the schema URL cannot disagree with each other.

| Commits since the last release          | `0.4.2` becomes |
| --------------------------------------- | --------------- |
| `feat:`                                 | `0.5.0`         |
| anything else                           | `0.4.3`         |
| `feat!:` or a `BREAKING CHANGE:` footer | `1.0.0`         |

A version those rules do not produce — a round number that a rewrite of the manifest format deserves
— is forced by putting `Release-As: 1.0.0` in the body of a commit on `main`. That commit has to
count (next section), or the footer is never read.

`.release-please-manifest.json` records the last version that was released — not the version in
`apps/cli/package.json`, which is where release-please writes the next one.

### Which commits count

The CLI is built from far more than `apps/cli`: core, the schema and the Backlog client are bundled
into it, and so are the dependencies pinned in `pnpm-lock.yaml`. So `release-please-config.json`
has release-please read the whole repository (`.`) and lists in `exclude-paths` the directories
that never reach the tarball: `apps/web`, `packages/brand`, `packages/test-utils`, `docs`,
`.claude` and `.github`. A commit counts unless every file it touches is under one of those.

`exclude-paths` matches directories only; a file at the repository root cannot be excluded. A
commit to the Web UI that also touches `pnpm-lock.yaml` or `pnpm-workspace.yaml` — adding a
dependency, typically — therefore counts, and its subject lands in `CHANGELOG.md` and moves the
version. Keep such a change out of the Web UI commit: land the dependency first as a
`chore(deps):` commit, which is hidden from the changelog and opens no release on its own.

release-please has no way to exclude by scope. `changelog-sections` could hide `feat(web)` from the
notes, but the version is decided from the type alone, so a hidden `feat` would still bump the
minor version.

### Cutting one

1. Merge work into `main` as usual. Every push to `main` runs the release workflow, whose first job
   opens — or updates — a pull request titled `chore(main): release <version>` holding the version
   bump and the CHANGELOG entry for everything merged since the last release.
2. Merge that pull request when the release should go out. Nothing reaches npm until it is merged,
   so leaving it open to collect further commits is the normal way to batch a release. Pages is not
   waiting for it: the site has been redeployed on every one of those pushes already.
3. Its merge runs the workflow again. This time release-please tags the merge commit `v<version>`
   and creates the GitHub Release, and the publish job — which runs only for a release — stages
   the CLI, schema included, on npm.
4. Approve the staged version: on the package's page on npmjs.com, **Staged Packages**, or with
   `pnpm stage approve` from a terminal. Either asks for 2FA. Until then nobody can install it,
   and its schema URL does not resolve, even though the tag and the GitHub Release already exist.
5. Read the GitHub Release that release-please created. Its body is the generated CHANGELOG entry,
   which needs no rewriting so long as the commit subjects were written for the people who read it.
   Add prose above it only when a version asks something of its users — a manifest that has to be
   rewritten, an option that no longer exists.

CI runs on the release pull request like on any other, because release-please opens it as the
organization's release bot, a GitHub App, rather than with `GITHUB_TOKEN`. A pull request opened by
`github-actions[bot]` holds its workflows until someone with write access approves them, which
would leave the one pull request that decides a release as the only one merged without CI.

If the publish job fails once the tag exists, use **Re-run failed jobs** on that workflow run: the
tag comes from the first job's outputs, which a re-run keeps, so the same commit is built and
staged again. Re-running the workflow from the start does not work — release-please has already
released that version and the second job would be skipped.

### CHANGELOG.md

`CHANGELOG.md` at the repository root is generated from commit subjects, which are English
(AGENTS.md), and release-please puts the same text into the GitHub Release. It is therefore **what
users read**, and a commit subject is worth writing with that in mind. Editing the file by hand is
pointless, as the next release rewrites it from the commits.

`0.1.0` is the exception. The commits it was generated from predate that rule and are Japanese, so
its Release body was written by hand and does not match the file.

Which types reach it is `changelog-sections` in `release-please-config.json`. Listed are `feat`,
`fix`, `perf`, `revert`, `refactor` and `build` — the types that can change how the published CLI
behaves or what it is built from. Hidden are `docs`, `test`, `ci`, `chore` and `style`: an entry of
one of those says nothing about what a version does differently from the one before it.

### What the workflow has to guarantee

- **Tagging and publishing stay inside one workflow run.** Publishing is another job of the
  release workflow, gated on release-please's `releases_created` output, and takes the tag from
  that job's outputs. The publish job does not wait for Pages: the schema is in the tarball it
  publishes, and the Web UI is not part of the release.
- **A breaking change to the manifest format bumps the major version** and ships as a new schema
  URL, leaving the old one in place. The CLI is then expected to recognize the superseded syntax and
  say how to rewrite it, rather than interpreting it in a way the author did not intend. The
  reasoning, and the automatic-migration command that was considered and deferred, are in
  [`.claude/docs/design/manifest-versioning.md`](.claude/docs/design/manifest-versioning.md).

### What the repository has to provide

The workflow cannot create any of these itself.

| What                       | Value                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| Pages source               | Settings, Pages, Build and deployment, Source: **GitHub Actions**           |
| Pages custom domain        | Settings, Pages, Custom domain: **backlog-blueprint.simochee.net**, with **Enforce HTTPS**; a DNS `CNAME` record from that name to `simochee.github.io` |
| npm trusted publisher      | On the package's npm settings: this repository, workflow `release.yml`, **no environment**, allowed actions: **stage publish only** |
| npm publishing access      | On the package's npm settings: **Require two-factor authentication and disallow tokens** |
| `github-pages` environment | Created by GitHub with the Pages source; must allow `main`                  |
| Release bot                | The organization's GitHub App, installed on this repository with Contents, Issues and Pull requests: **Read and write** |
| Release bot credentials    | Organization secrets `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY`, available to this repository |

The custom domain lives in the settings and not in a `CNAME` file under `apps/web/public/`: Pages
ignores that file when the site is deployed from a workflow.

The repository holds no npm token. npm accepts the publish job's OIDC token instead, which is why
`id-token: write` appears in its permissions and why `actions/setup-node` is not given
`registry-url`. The environment field of the trusted publisher is left empty because that job runs
in no environment; `github-pages` belongs to the Pages job, which does not talk to npm.

Trusted publishing cannot create a package, though. A trusted publisher is configured on a
package's settings page, and a package nobody has published yet has no settings page
([npm/cli#8544](https://github.com/npm/cli/issues/8544)). So `0.0.0` was published by hand, only to
bring that page into existence, and is deprecated; it contains nothing that was ever released.
Every real release, `0.1.0` included, is
the workflow's.

Nothing the workflow holds can put a version in front of users on its own. The trusted publisher
may only stage, so a release goes live only when a maintainer approves it with 2FA; and publishing
access disallows tokens, so a leaked or forgotten token cannot publish around that either.
