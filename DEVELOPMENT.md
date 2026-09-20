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
writes no files of its own: it returns a path and the contents, and the Web UI's Vite build emits
them into the site. That is how the schema ends up next to `index.html` without any package gaining
a dependency on Node.

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
| `secretPaths(...paths)`                   | Replaces `PlanContext['isSecret']` with a set of expanded paths                           |
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

The first release is pinned to `0.1.0` with a `Release-As: 0.1.0` footer on a commit, because
release-please would otherwise read the whole history — 49 `feat` commits with no tag before them —
and propose `0.2.0`. The schema URL carries the same version as the npm package (D-2), and the
documentation already points at `schema/0.1.0/project.json`, so the first published version has to
be that one.

Nothing has been published yet. `.github/workflows/release.yml` and the release-please
configuration next to it are in place but have never run.

A release consists of three artifacts that are produced from the same version number:

| Artifact    | Destination                                                      |
| ----------- | ---------------------------------------------------------------- |
| CLI         | npm, as `@simochee/backlog-blueprint`                            |
| Web UI      | GitHub Pages, at `https://simochee.github.io/backlog-blueprint/` |
| JSON Schema | GitHub Pages, at `.../schema/<version>/project.json`             |

`pnpm run build` produces the whole Pages site in `apps/web/dist`: `index.html`, its assets, and
`schema/<version>/project.json`. The version in that path is read from `apps/cli/package.json`,
because the schema version and the CLI version are deliberately the same number (D-2) — the root
`package.json` is private and its version means nothing.

### Where the version comes from

Nobody edits it by hand. release-please derives the next version from the Conventional Commit types
that landed on `main` since the last release, and writes it into `apps/cli/package.json` and
`.release-please-manifest.json` in the very commit it then tags — so the tag, the published package
and the schema URL cannot disagree with each other.

| Commits since the last release          | `0.4.2` becomes |
| --------------------------------------- | --------------- |
| `feat:`                                 | `0.5.0`         |
| anything else                           | `0.4.3`         |
| `feat!:` or a `BREAKING CHANGE:` footer | `1.0.0`         |

A version those rules do not produce — a first release, or a round number a rewrite of the manifest
format deserves — is forced by putting `Release-As: 1.0.0` in the body of a commit on `main`.

`release-please-config.json` points all of this at `apps/cli`, the only package that is published,
and `.release-please-manifest.json` records the version the repository is currently at.

### Cutting one

1. Merge work into `main` as usual. Every push to `main` runs the release workflow, whose first job
   opens — or updates — a pull request titled `chore(main): release <version>` holding the version
   bump and the CHANGELOG entry for everything merged since the last release.
2. Merge that pull request when the release should go out. Nothing reaches npm or Pages until it is
   merged, so leaving it open to collect further commits is the normal way to batch a release.
3. Its merge runs the workflow again. This time release-please tags the merge commit `v<version>`
   and creates the GitHub Release, and the second job of the same run builds the site, restores the
   schema versions already on Pages into it, deploys Pages, and publishes the CLI to npm — in that
   order, stopping at the first failure.
4. **Write the GitHub Release body, in English. That part is a person's job.** release-please fills
   the Release with the generated CHANGELOG entry, which is Japanese and addressed to whoever works
   on this repository. The Release is what users of the CLI read, so replace that body with English
   prose: what changed for them and what they have to do about it (NFR-9).

The release pull request carries no CI run, because a pull request opened with `GITHUB_TOKEN` does
not start workflows. Everything in it has already been checked on `main`; the only thing CI would
see for the first time is the version bump and the CHANGELOG.

If the publish job fails once the tag exists, use **Re-run failed jobs** on that workflow run: the
tag comes from the first job's outputs, which a re-run keeps, so the same commit is built and
published again. Re-running the workflow from the start does not work — release-please has already
released that version and the second job would be skipped.

### CHANGELOG.md

`CHANGELOG.md` at the repository root is generated from commit subjects, which are Japanese
(AGENTS.md). It is **a record for whoever works on this repository**, not documentation for users;
what users read is the GitHub Release body. Editing it by hand is pointless, as the next release
rewrites it from the commits.

Which types reach it is `changelog-sections` in `release-please-config.json`. Listed are `feat`,
`fix`, `perf`, `revert`, `refactor` and `build` — the types that can change how the published CLI
behaves or what it is built from. Hidden are `docs`, `test`, `ci`, `chore` and `style`: an entry of
one of those says nothing about what a version does differently from the one before it.

### What the workflow has to guarantee

- **Tagging and publishing stay inside one workflow run.** A tag or a Release created with
  `GITHUB_TOKEN` starts no further workflow, so a separate workflow listening for `v*` tags would
  wait forever. Publishing is therefore a second job of the release workflow, gated on
  release-please's `releases_created` output. The other way out — a personal access token, whose
  tags do trigger workflows — was rejected: a long-lived secret to store and rotate, for nothing
  that two jobs do not already give.
- **npm publish and the Pages deployment happen together.** Publish a CLI whose schema URL is not on
  Pages yet, and every editor pointed at that version silently stops offering completion. Both are
  steps of one job (requirements-definition §7.1), and Pages is deployed first: a schema URL that no
  published CLI mentions yet harms nobody, whereas the reverse breaks completion with nothing to
  see.
- **Previously published schema versions survive the deployment.** Old manifests keep pointing at
  old URLs and must keep working (D-3). The build emits only the version being released, and
  `actions/deploy-pages` replaces the site wholesale, so the workflow asks npm which versions exist
  — the same number as the schema version, by D-2 — downloads each `schema/<version>/project.json`
  from the live site, and adds them to the artifact before uploading it. A package that npm does not
  know yet is the first release and has nothing to preserve; any other failure to reach npm or Pages
  aborts the release rather than quietly dropping a version.
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
| `NPM_TOKEN` secret         | An npm granular or automation token allowed to publish the package          |
| `github-pages` environment | Created by GitHub with the Pages source; must allow `main`                  |
| Pull requests from Actions | Settings, Actions, General: **Allow GitHub Actions to create and approve pull requests** |
