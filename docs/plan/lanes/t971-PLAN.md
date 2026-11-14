Approved by the lead agent, builds 0527 for ticket 971; body bd31f9db48db
Plancheck-Version: 3

# Plan: law-shape takes `type:` as a fifth label, on a body of type assertions only (decision 0527)

Today's lint tooling, the oxlint plugins folder, which reads `next/` and `.agents/` tests. It builds
[0527](../../../.decisions/0527-type-laws-get-a-type-label.md) (owner, 2026-11-14, PR
https://github.com/kamp-us/tea-fabrika/pull/1233, merged). The PR stacks on
https://github.com/kamp-us/tea-fabrika/pull/1199 and lands after it.

```ts
// Passes: a type: law whose body only asserts types. Nothing runs (expectTypeOf is a no-op at run time).
it("type: no service of access/ fails with an error tagged LedgerError", () => {
  type Sessions = (typeof SessionManager)["Service"];
  expectTypeOf<FromLedger<Sessions>>().toBeNever();
});
// Blocks, with the type: message: a runtime check under the type label.
it("type: the session opens", () => {
  expect(open()).toBe(true);
});
// Blocks too: a property is a runtime check, so the type label cannot cover it.
it.prop("type: n is a number", [fc.nat()], ([n]) => n >= 0);
```

## What changes, in one paragraph

`oxlint-plugins/law-shape.ts` gains `type` as a fifth label. A title that starts with `type:` (after
the optional ticket or law id, as for the other four) is judged by its body, before the property
check: the body passes only when every statement is an `expectTypeOf(...)` or `assertType(...)`
chain, or a type alias or interface declaration, with at least one chain, and no other call, `new`,
`await`, `yield`, tagged template or `import()` anywhere in it, the chains' arguments and nested
functions included. A `type:` title on `it.prop`, `it.effect.prop` or a body that calls `fc.assert`
fails too. The general message names five labels; a `type:` fire gets its own message. Eight laws
in `next/` change their title to `type:`, and one type law loses a dummy property that wrapped it.

## How others do it

- **Vitest** checks types with `expectTypeOf` and `assertType`, and runs them as plain tests or in
  its typecheck mode over `*.test-d.ts`. Read in the installed code: `expect-type` 1.4.0 (what
  vitest 5.0.5 ships) builds `expectTypeOf` from `const fn = () => true`, and vitest's
  `assertType` is `function assertType() {}`. So a body of those calls runs nothing, which is what
  0527 asks. The typecheck mode and `.test-d.ts` stay out: 0527 leaves them undecided.
- **tsd** (`expectType`, `expectError`) and DefinitelyTyped's dtslint (`$ExpectType`) keep type
  checks in files the compiler reads and nothing runs. Cited from memory, not fetched.
- **Lint rules that read a test body:** `eslint-plugin-vitest`'s `expect-expect` takes a list of
  assertion function names, and `valid-title` takes a `mustMatch` pattern. Neither ties a title
  pattern to what the body may hold, so the check stays in our rule, beside the label list, as
  0527's binding constraint and 0040 say. From memory of those rules' docs, not fetched.
- **Elm and OTP** have no answer here: this is a lint rule over test files, not a machine.

## The shape

```ts
// oxlint-plugins/law-shape.ts, a sketch of the new parts.
const LABELS = ["vector", "format", "pinned", "scenario", "type"] as const;
type Label = (typeof LABELS)[number];

/** Vitest's two compile-time checks, and the modules that give them. */
const CHECKS = new Set(["expectTypeOf", "assertType"]);
const VITEST = new Set(["vitest", "@effect/vitest"]);

const MESSAGE = `A law here is a property (it.prop, it.effect.prop, a body that calls fc.assert, or a @demlik/tea/pbt runner) or an example whose title starts with ${LABELS.map((l) => `${l}:`).join(", ")} and its reason (0093, 0527).`;
const TYPE_MESSAGE =
  "A law titled type: holds only compile-time checks: expectTypeOf or assertType from vitest, and type declarations, with no other call. A runtime check makes it a property or one of the other four labels (0527).";

/** The label a written title starts with, `"none"`, or `null` when the source does not say. */
const labelOf = (title: Node | undefined): Label | "none" | null => {
  /* today's `labeled`, answering which label it found */
};

/** The calls of one `expectTypeOf(...)...` or `assertType(...)` chain, or `null` for any other expression. */
const assertion = (expression: Node, checks: ReadonlySet<string>): ReadonlySet<Node> | null => {
  /* walk callee and object down to the first call; its dotted callee must be in `checks` */
};

/** Whether a body asserts types and runs nothing else: 0527's body. */
const typeOnly = (fn: Fn, checks: ReadonlySet<string>): boolean => {
  /* each statement a chain or a type declaration, one chain at least, and every call in the body one of theirs */
};
```

`checks` is built from the file's imports the way `asserts` is today: a value import of
`expectTypeOf` or `assertType` from `vitest` or `@effect/vitest`, under any local name, or a
namespace import, which gives `V.expectTypeOf`. A `type` import, another module, or a local function
of that name gives nothing, so its calls count as other calls.

The loop, with the type label read first:

```ts
const label = labelOf(node.arguments[0]);

if (label === "type") {
  const kept = !chain.includes("prop") && bodies.length > 0 && bodies.every((b) => typeOnly(b, checks));
  if (!kept) context.report({ node: title ?? node, message: TYPE_MESSAGE });
  continue;
}

if (chain.includes("prop") || bodies.some((body) => proves(body, seen))) continue;
if (label === "none") context.report({ node: title ?? node, message: MESSAGE });
```

Decided here, each in one line, from the notes named:

- **Every call counts, nested ones too.** 0527 says "any other call fails". A call inside an arrow the
  body never calls, or inside a chain's argument (`expectTypeOf(make())`), is still a call, so it
  fails. The repo already has a home for refused calls that must only compile: a function at module
  scope that nothing calls, as `checkTypes` in `next/packages/libfabrika/src/Id.types.test.ts` and
  `authoringTypeErrors` in `next/packages/libfabrika/src/runtime/Program.types.test.ts` do.
- **Type declarations are `type` aliases and `interface`s.** An `enum` runs, and a `const` is a value,
  so neither is in 0527's list.
- **A template title** is judged as today: `type: ${x}` is a `type:` title, and `${x}` is not judged.
  A head such as `ty${x}` could still become `type:`, so it is not judged either. That is the one
  place the rule now judges less than today, where such a head fired; on 1199's head no title in
  `next/` or `.agents/` starts that way (an `rg` over both found 0).
- **`plancheck.sh` stays as it is.** A plan's type law already writes `type` in its generator cell.
  That it refuses `type: <reason>` there is a finding, below.

## One value traced

`Access.types.test.ts:29` on 1199's head, retitled `type: no service of access/ fails with an error
tagged LedgerError`:

1. `labelOf` reads the literal title. No id stands before `type:`, and text follows it: `"type"`.
2. The chain is `["it"]`: no `prop`. `bodies` holds the one arrow.
3. `checks` holds `expectTypeOf`, from `import { expectTypeOf, it } from "@effect/vitest"`.
4. `typeOnly` reads five statements: two chains, `type Sessions = ...`, two chains. All are chains or
   type aliases, and there are four chains.
5. Every call in the body is one of the chains' own calls (`expectTypeOf<...>()`,
   `.toEqualTypeOf<...>()`, `.toBeNever()`), and their arguments hold no call. `typeOnly` is true.
6. Nothing is reported. `access/` blocks for `law-shape`, so before this change the same title fired
   and blocked, which is why 1199 titled it `pinned:`.

`counter/src/window.types.test.ts:24`, `type: props come from the real program, ...`: step 4 meets
`const press = (props: Props) => {...}`, a `const`, so `typeOnly` is false and `TYPE_MESSAGE` is
reported. `counter/src/*` still advises for `law-shape` on 1199, so it prints as advice and does not
block. Before this change it fired too, with the general message.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, the existing generated law, its label now drawn from five: law-shape fires on exactly the tests that are neither a property nor labeled, and on each type: test whose body runs anything, in any order and spelling, 4 runs | test, of a lint rule | fc.record: alias, id, star, title, reason, label from the five, and the order of the case lines by fc.shuffledSubarray | (a) read the property shapes before the type label, (b) skip the chains' arguments, nested functions in them included, (c) pass a type body with no chain, (d) pass a const or any other statement: each turns L1 red | oxlint-plugins/law-shape.test.ts |
| L2, expectTypeOf and assertType count only when a value import of vitest or @effect/vitest gives them, under any local name or a namespace, 2 runs | test, of a lint rule | fc.record: title, reason, and whether the chain sits under describe | take the two names with no import check: the rows for another module, a type import and a local function stop firing | oxlint-plugins/law-shape.test.ts |
| L3, the changed T930 L7: the real lint.ts blocks an unlabeled law in a clean next/ folder, and its message names all five labels | test, of a lint rule | scenario: the real lint.ts run in a temp git checkout under next/ | keep the four old labels in MESSAGE: the check for the five fails | oxlint-plugins/law-shape.test.ts |
| L4, the real lint.ts blocks a type: law whose body runs a check, in a clean next/ folder, with the type message | test, of a lint rule | scenario: the real lint.ts run in a temp git checkout under next/ | report a type fire with MESSAGE in place of TYPE_MESSAGE: L4 fails | oxlint-plugins/law-shape.test.ts |
| L5, the retitled laws and the unwrapped one pass law-shape on the real tree, no blocking folder gains a fire, and no warn line goes stale | lint | lint | drop type from LABELS: Access.types.test.ts blocks in access/ | the nine next/ test files below |

L1's new case lines, each one line of the generated file, with whether it fires. `ok(label)` is the
body a labeled example needs to pass: `{}` for the four, and `{ expectTypeOf<1>().toEqualTypeOf<1>(); }`
for `type`, so every spelling line the table has today runs for all five labels unchanged.

```ts
// passes
it("type: ${reason}", () => { type T = 1; interface I { readonly t: T } expectTypeOf<I>().toHaveProperty("t"); });
it("${id} type: ${reason}", () => expectTypeOf<1>().not.toBeAny());
it("type: ${reason}", () => { assertType<number>(1); expectTypeOf(plain).toBeFunction(); });
it.each([1])("type: ${reason} %s", () => { expectTypeOf<1>().toBeNumber(); });
// fires, with TYPE_MESSAGE
it("type: ${reason}", () => { expectTypeOf<1>().toBeNumber(); expect(1).toBe(1); });
it("type: ${reason}", () => { ${a}.assert(${a}.property(${a}.nat(), () => true)); });
it.prop("type: ${reason}", [${a}.nat()], ([n]) => n >= 0);
it("type: ${reason}", () => { expectTypeOf(plain()).toBeNumber(); });
it("type: ${reason}", () => { expectTypeOf(() => plain()).returns.toBeNumber(); });
it("type: ${reason}", () => { const one = 1; expectTypeOf(one).toBeNumber(); });
it("type: ${reason}", async () => { await x; expectTypeOf<1>().toBeNumber(); });
it("type: ${reason}", () => { if (x) throw y; expectTypeOf<1>().toBeNumber(); });
it("type: ${reason}", () => {});
it(`type: ${reason}`, () => { expect(1).toBe(1); });
```

The line `it("${label}: ${reason}", () => { fc.assert(...) })` passes today for every label. With
`type` drawn it fires, since a property under `type:` is a runtime check. Its expected cell becomes
`label === "type"`. The test also checks that each fire carries the right message, not only its
line.

The preamble imports `expectTypeOf` and `assertType` from `vitest`; `plain` is its own
`const plain = () => 1`. L2's table, like the `sources` table beside it: named, renamed, and namespace imports from `vitest` and
`@effect/vitest` pass; `./helper.ts`, `fast-check`, `import type`, and a local
`const expectTypeOf = () => ...` fire.

Every plant is run once by the tests step and recorded in its report and run row, never committed
(0093). A lint rule's own generated lines are its test inputs and stay. No host-only law: nothing
needs the real machine.

## The laws in `next/` that change

All read on 1199's head `68051977d`. Eight titles change, and one body, so that each passes as
`type:`. None changes what it asserts.

| Test | Today | After |
|---|---|---|
| `next/packages/libfabrika/src/access/Access.types.test.ts:29` | `pinned: a type law, checked at compile time, ...`, the stopgap 1199 wrote | `type: no service of access/ fails with an error tagged LedgerError`, main's title |
| `next/packages/libfabrika/src/runtime/Entry.test.ts:6` | no label (`type law, plant View = any: ...`), fires | `type: views require decoding before use (plant: View = any)` |
| `next/packages/libfabrika/src/runtime/Program.types.test.ts:84` | no label, fires | `type: tea exposes the original schemas with readonly fields and a plain Msg, excluding Cmd replies` |
| `next/packages/libfabrika/src/cloudflare/SettingsRecorded.test.ts:116` | `format: L14 ...` | `L14 type: consumer Layer requirements and declared value types are compiler checked` |
| `next/packages/libfabrika/src/runtime/IsolateUsage.test.ts:116` | `format: U10 ...` | `U10 type: Method, Outcome and Usage keep their closed wire types` |
| `next/packages/libfabrika/src/settings/Start.test.ts:62` | `format: transport has one snapshot ...` | `type: transport has one snapshot and explicit repo presence, as the approved wire table specifies` |
| `next/packages/libfabrika/src/settings/Toml.types.test.ts:28` | `scenario: L9 ...` | `L9 type: Toml's complete contract and tagged reasons are typechecked` |
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts:481` | `pinned: [secrets] P12 bearer-type gap, ...` | `type: [secrets] P12 bearer-type gap, control services require a Redacted bearer` |
| `next/packages/libfabrika/src/transport/internal/connection.test.ts:299` | `type:`, its eight `expectTypeOf` lines wrapped in `fc.assert(fc.property(fc.constant(null), ...), { numRuns: 1 })` | the same title and lines, unwrapped: one constant drawn once and nothing checked at run time is no property, and under the new rule the wrapper would fire |

- **Two that were unlabeled** (`Entry.test.ts:6`, `Program.types.test.ts:84`) are the ones the brief
  asks to list: type-only, firing today in `runtime/`, which still advises, and passing once titled.
- **Five carry another label** on a body only the compiler checks. 0527's title says such a law is
  titled `type:`, and `format:` and `scenario:` say a fixed format or an outside run, which these are
  not. `dev-secrets.laws.test.ts:481` keeps its past gap's name, P12, in its reason.
- **Already `type:` and now accepted,** with no edit: `gateway/Gateway.types.test.ts:28`,
  `node/ErrorCause.types.test.ts:41`, `runtime/Runtime.types.test.ts:29`.
- The tests step words each new title. A title change is a renamed law, so `loosening.sh` lists it;
  the PR body maps each old title to its new one, as 1199's did.

The fire count, from oxlint 1.90.0 run over `next/` on an export of 1199's head: 277 `law-shape`
fires, none in a folder that blocks. After this PR: 272, one fewer in `gateway/`, one in `node/` and
three in `runtime/`. No folder reaches zero, so no warn line goes, and none is added.

## How it fits PRs 1199 and 1209

- **https://github.com/kamp-us/tea-fabrika/pull/1199** makes `law-shape` block in every folder at
  zero. This PR builds on it: it edits 1199's message line and its L7 scenario law, and undoes 1199's
  `pinned:` stopgap in `access/`, which blocks. Branch from `fabrikalfa/advice-rules-block`, and
  rebase on main once 1199 lands. 1199's L10 law in `oxlint-plugins/advice.test.ts` reads every
  message of the five rules, so `TYPE_MESSAGE` must not say "advice" or "does not block".
- **What stays from 1199:** its four disable lines, on `access/ClientManager.test.ts`, two in
  `settings/Setting.test.ts`, and `checklist/src/program.laws.test.ts` L11. Each body still makes a
  call (refused calls in a closure, a `Setting.make`, a runtime `expect`), so the new rule still fires
  there and each disable stays in use. `.oxlintrc.json` sets `reportUnusedDisableDirectives` to
  `"error"`, so a disable that went unused would fail lint. They go in the follow-up below.
- **https://github.com/kamp-us/tea-fabrika/pull/1209** is stacked on 1199 and turns `jsdocs` on. It
  touches no law-shape file or test. Both PRs edit `oxlint-plugins/README.md` around line 34; whichever
  lands second rebases by hand.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `oxlint-plugins/law-shape.ts` | tests | 70 | the fifth label, `labelOf`, `assertion`, `typeOnly`, the import scan for the two names, `TYPE_MESSAGE`, and the head comment |
| `oxlint-plugins/law-shape.test.ts` | tests | tests | L1 to L4 |
| `next/packages/libfabrika/src/access/Access.types.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/runtime/Entry.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/runtime/Program.types.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/runtime/IsolateUsage.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/cloudflare/SettingsRecorded.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/settings/Start.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/settings/Toml.types.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts` | tests | tests | title |
| `next/packages/libfabrika/src/transport/internal/connection.test.ts` | tests | tests | the dummy property unwrapped |
| `oxlint-plugins/README.md` | tests | docs | "Law shape": five labels and what a `type:` body may hold; the paragraph after the count table names 0527 in place of "the owner's call", and the new count |
| `.agents/skills/tests/SKILL.md` | build | docs | lines 27 and 45 to 46: a fixed test needs a label `law-shape` accepts, linked, in place of listing four |
| `.agents/skills/review/SKILL.md` | build | docs | lines 42 to 43: five labels, `type:` among them |
| `.agents/skills/lead/SKILL.md` | build | docs | line 78: "the five reason labels" |
| `.glossary/TERMS.md` | build | docs | line 148, the `laws` row: "one of the five reason labels below" |
| `oxlint-plugins/advice.test.ts` | tests | none | not changed: its L10 law reads `TYPE_MESSAGE`, and it runs in Validation |
| `.oxlintrc.json` | tests | none | not changed: no warn line is added or removed (L5) |
| `next/packages/libfabrika/src/Id.types.test.ts` | tests | none | not changed: cited for its module-scope `checkTypes` idiom |

Decision 0527's own records (the `type (label)` glossary row and the label table row in
`docs/direction/five-steps-for-every-check.md`) landed with
https://github.com/kamp-us/tea-fabrika/pull/1233.

## Validation

- The tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `oxlint-plugins/law-shape.test.ts`, `oxlint-plugins/advice.test.ts` and
  `next/packages/libfabrika/src/transport/internal/connection.test.ts`, then `pnpm lint` on the whole
  tree, so its stale warn line check runs. Each plant, run once, recorded.
- The lead: one `pnpm typecheck`, since the unwrapped type law and the retitled ones are read by
  the compiler, and the leak grep.

## Size

One pull request that lands whole.

1. law-shape takes `type:`, and nine laws in `next/` move: about 70 product lines in
   `oxlint-plugins/law-shape.ts`, plus about 90 test lines, eight title edits and one unwrap of
   about 4 lines in `next/`, and about 15 lines of prose.

Priced from T930's lane on 1199, a lint rule with its laws and prose: tests $8.41, build $0.87,
review $2.70 (list dollars, from that PR's body). This one has more law code than T930's build and
fewer prose files. Expected: tests about $8, build about $2, review about $3, and one fix round
about $3. Confidence 75%: the doubt is the L1 table rework, since every spelling line now runs for
five labels and one expectation flips.

Estimate: 4 steps, $16

## Follow-up ticket, not this lane

The type laws whose bodies 0527 refuses under `type:`, each rewritten with the module-scope idiom
above, a runtime part split into its own property or labeled example, and every disable line
removed. The lead files it.

- `type:` titles that make calls: `runtime/RunnerOptions.test.ts:26` and `:46`,
  `counter/src/window.types.test.ts:24` and `:44`, `settings/Setting.test.ts:140` and `:175`,
  `checklist/src/program.laws.test.ts:524`.
- 1199's four disable lines, three of them on the laws above, the fourth on
  `access/ClientManager.test.ts:431`.
- `pinned:` laws whose checks are `@ts-expect-error` lines on calls:
  `checklist/src/window.types.test.ts:44` and `:67`, the app's `checklist-instance.laws.test.ts:57`.
- Unlabeled ones of the same kind: `ledger/Log.test.ts:157` and `:190`,
  `transport/Sshsig.test.ts:475`.
- `desktop/BrainService.types.test.ts:14`, `format:`: type-only but for one `const` under
  `@ts-expect-error`, which moves to module scope before it can be `type:`.

## Records

- What is lost if not written now: the plant runs and their results (the run row), and the fire
  count before and after on 1199's head (the README and the PR body). Both are gone once main moves.
- `oxlint-plugins/README.md`, `.glossary/TERMS.md` and the three skills, as in the files table.
- `field/runs/` rows for each step, written by the lead.
- No `.decisions/` file: 0527 is the decision, and this plan makes no new call.

## What this cannot tell us

- How often the strict rule refuses a type law written well. The measure is 11 `type:` titles and 8
  other type-only laws on 1199's head; laws written after it may lean on closures more.
- Whether the follow-up's module-scope idiom keeps every `@ts-expect-error` line as strong. Moving a
  line keeps the same compiler error, but the line may now error for a different reason; only a read
  of each one can say.
- The rule reads syntax. A getter, an iterator or a template string can run code with no call node.
  It guards against an honest mislabel, not against code written to slip past it.
- That `expectTypeOf` and `assertType` run nothing is read from `expect-type` 1.4.0 and vitest
  5.0.5. A later version could change it; the rule would not notice.

## Answered questions

1. A `type:` example counts as "proper" under plan README line 431, the same as the other four labels, so an exam change of them skips an owner read. The lead's answer, from 0527 making `type:` a fifth label of the same standing.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-14-plancheck-refuses-type-label","date":"2026-11-14","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":".agents/skills/plan/scripts/plancheck.sh","line":153},"says":"plancheck.sh's laws-table generator check accepts `vector:`, `format:`, `pinned:` and `scenario:` with a reason but not `type:` with one, and its head comment says fixed inputs need one of the four labels, while 0527 made `type:` a fifth label and law-shape will accept it.","proof":"`git show origin/main:.agents/skills/plan/scripts/plancheck.sh | sed -n 153p` prints `match = re.fullmatch(r\"(vector|format|pinned|scenario):\\s*(.+)\", text)`, and line 12 says `Fixed inputs need one of the four labels`; .decisions/0527-type-laws-get-a-type-label.md says the label is `type:` with its reason. A plan row whose generator cell is `type: <reason>` fails as `invalid generator`; only the bare word `type` passes.","cost":"A plan that writes a type law the way its test title will read is refused, and the writer must learn that only the bare `type` cell passes.","head":"b0b093defc22c3acd5acf7994db59434f9a60695","ticket":null,"pr":null}
```
