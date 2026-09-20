# AGENTS.md

Constraints and conventions for anyone — human or AI — changing this repository. Break a constraint
and the tool breaks with it, silently or loudly; break a convention and the next reader pays for it.
Follow both.

How to build, test and release is in [DEVELOPMENT.md](DEVELOPMENT.md), and the package layout is
described there too. This file does not repeat it.

## `.claude/docs/` is the only specification

Every decision in the code traces back to a document there.

| Directory                    | Contents                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.claude/docs/requirements/` | Requirements: FR, NFR, V-A, V-B, AC                                                                           |
| `.claude/docs/design/`       | Design: manifest schema, validation pipeline, reconcilers, plan output, CLI and Web UI, versioning, prior art |
| `.claude/docs/research/`     | Measured behavior of the Backlog API (X-\*)                                                                   |

- **Refer to a decision by its ID, never by copying its text.** Write "for NFR-5" or "K-1 requires
  this", not a paraphrase of what those say. A paraphrase in the code is a second copy that will not
  be updated when the document is.
- **Do not fill a gap in the specification by guessing.** When a decision is needed and no document
  makes it, stop and report it. The document gets the decision first, then the code.

## Do not widen the target: one-shot initialization only

Keep the targets as they are — a project being created, and a project that exists but has no issues
(requirement-design §6, validation-pipeline §7). Add no state file, no drift detection, and no
support for a project that is already in use. The `reconciler` vocabulary is not a license to
introduce any of them.

## Never write from inside a reconciler

Within core, a reconciler reads the current state and computes the difference. **It does not apply
anything** (C-1). Every write goes through the single Executor, over the `Action[]` the reconcilers
produced. That is what guarantees that nothing happens during `apply` which was not visible in
`plan`, and it keeps rate limiting, retries, progress reporting and the abort report in one place
(NFR-8). Applying from inside a reconciler would break all of that at once.

## `packages/core` must not touch Node or the DOM (NFR-5)

Core runs in Node and in the browser, so it may use ECMAScript, `fetch` and `setTimeout`, and
nothing else: no `node:*`, `process` or `Buffer`, and no `document`, `window` or `localStorage`.

This is enforced by the type checker, not by discipline. `packages/tsconfigs/base.json` sets
`types: []` and `lib: ["ES2022"]`, and `fetch` and `setTimeout` exist only as the ambient
declarations in `packages/core/src/fetch.d.ts`. Packages that genuinely need Node extend
`packages/tsconfigs/node.json` instead.

**A single `/// <reference types="node" />` inside a dependency's `.d.ts` disables the guard without
a word.** `types: []` only stops automatic loading; it cannot stop a reference directive. So after
adding any dependency to `packages/core`, confirm the guard still bites:

```sh
# typecheck must FAIL with this file present
printf "import { readFileSync } from 'node:fs'\nexport const probe = () => [readFileSync, process.env.HOME, Buffer.from('x')]\n" > packages/core/src/nfr5-probe.ts
pnpm --filter @backlog-blueprint/core run typecheck
rm packages/core/src/nfr5-probe.ts
```

If that passes, the guard is already broken. This is also why backlog-js and its type definitions
live in `packages/backlog-client` and not in core (B-2).

The same hazard applies to every package that has to run in a browser (today `core`, `schema`,
`backlog-client` and `web`). Keep their tests in a separate tsconfig from the source: putting both
in one config pulls `@types/node` in through vitest and vite, and the guard dies quietly.

## Tests never reach the network

No test may call the real Backlog API, or any other host. Build from fixed values instead, and put
shared helpers in `@backlog-blueprint/test-utils` rather than reinventing them per package (B-3).

**`packages/core` imports those helpers by relative path.** Adding
`@backlog-blueprint/test-utils` to core's `devDependencies` creates a workspace cycle — test-utils
depends on core — and turbo then refuses to build any task at all.

## Where each kind of information goes

- **How — the code.** Only the code says how something is done. If a comment is needed to explain
  it, rename something or extract a function instead.
- **What — the tests.** A test name states behavior: "a date custom field's range is written as a
  date string", not "validate returns false".
- **Why — the commit message.** The body explains why the change was needed and cites the decision
  ID. The diff already shows what changed. The subject line is published as it stands:
  release-please copies the subjects of `feat`, `fix`, `perf`, `revert`, `refactor` and `build`
  commits into `CHANGELOG.md`, and the type picks the next version number (see
  [DEVELOPMENT.md](DEVELOPMENT.md#releasing)). Write a subject that still reads sensibly beside ten
  others, with no context around it.
- **Why not — code comments.** Only where the code departs from the obvious implementation, to stop
  a later reader from "simplifying" it back into a bug. Never a description of what the code does.

## Language

- **Everything a user can see is English, and only English** (NFR-9): CLI output, the Web UI, and
  the descriptions inside the JSON Schema. No i18n machinery. Names that users gave their own
  Backlog resources are printed as they are and never translated.
- **Commit messages are Japanese.**

## TypeScript conventions

`module: "preserve"` with `moduleResolution: "bundler"`.

- **Relative imports carry no file extension.**

  ```ts
  import { resolveRef } from "./ref"; // correct
  import { resolveRef } from "./ref.js"; // wrong
  ```

- **`type` goes inline**, in the same import as the values:
  `import { type Manifest, normalizeManifest } from "./manifest"`. oxlint enforces this.
- Declare types with `type`, not `interface`. Write arrays as `T[]`. Export by name only; no default
  exports.

## Disabled lint rules have reasons

Each override in `.oxlintrc.json` is there for a specific problem. Check before removing one.

- `unicorn/no-thenable` (`packages/core/src/manifest.ts` only) — the JSON Schema `then` keyword
  reads as a `Promise` to the rule.
- `no-template-curly-in-string` — `${ENV}` appears in string literals all over the specification
  (E-1).
- `typescript/consistent-type-definitions` (`**/*.d.ts` only) — `packages/core/src/fetch.d.ts`
  declares the runtime surface core may use as ambient `interface`s, which merge with a platform
  declaration of the same name. The `type` form the rest of the code uses does not merge.
- `import/no-default-export` and `import/no-anonymous-default-export` (`vite.config.*` and
  `vitest.config.*` only) — Vite reads a configuration file's default export, and there is no other
  way to hand it one.
- `import/no-unassigned-import` (`apps/web/src/test-setup.ts` only) — jest-dom matchers can only be
  registered by a side-effecting import.
- `import/no-nodejs-modules` (`apps/cli/src/` only) — the CLI is a Node application and needs
  `node:*` for file and stdin access. It stays enabled everywhere under `packages/` (NFR-5).
