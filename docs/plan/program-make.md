Approved by the lead agent, builds program-make.md.

Tracker ticket **280**. Approved with the amendments below (lead, 2026-11-08). **Where an amendment and the body disagree, the amendment wins.** The body is kept as the planner wrote it.

## Lead amendments

The draft walked back two lines of [the Program.make note, now 0256](../../.decisions/0256-a-program-is-one-program-make.md): "nothing is written twice" (it passed `state.schema`, `msg` and a schema per write port again) and "the runner reads the model and Msg schemas off the machine" (it said no tea patch was needed). It also left out two owner calls from 2026-11-08. Fixed here.

### A1. The tea patch, in the shape of demlik#897

Upstream fix: [kamp-us/demlik#897](https://github.com/kamp-us/demlik/issues/897), approved at appetite S; [PR 899](https://github.com/kamp-us/demlik/pull/899), open at `607ed9deb9c4406e35b82bd12af312efccf0c6b3`, all root checks green. Its whole change to the API is the return type of `Machine.make` in `@demlik/tea/effect`:

```ts
// tea 0.25.0 today
): CoreMachine<S, M | Settled<D>, CmdOf<D>, U, Ctx>
// PR 899
): CoreMachine<S, M | Settled<D>, CmdOf<D>, U, Ctx> & {
	readonly model: Schema.Schema<S>;
	readonly msg: Schema.Schema<M>;
}
```

- **Runtime needs no change.** 0.25.0's `make` already spreads `spec` into `defineMachine`, which returns that same object, so `machine.model` and `machine.msg` are already the schemas passed in. The PR's own triage note says the same.
- **So our patch is declaration-only:** `pnpm patch @demlik/tea@0.25.0`, change that one return type in `dist/effect/index.d.ts` (the `declare function make<S, M ...` line), `pnpm patch-commit`. It writes `patches/@demlik__tea@0.25.0.patch` and a `patchedDependencies` entry in `pnpm-workspace.yaml`, with a comment that names demlik#897 and says to drop the patch at the release that has it.
- **Same names, same types:** `model: Schema.Schema<S>`, `msg: Schema.Schema<M>`, both readonly, `msg` the plain Msg only (no settled Cmd replies). No extra field, no runtime code, no other type touched. The bump then only deletes the patch, and no caller changes.
- **What the shape does not give us:** `Schema.Schema<S>` hides the encoded side, so tsc cannot prove the model encodes to JSON. The runner already checks encoded output as JSON at run time; that check stays, and a law covers it (A5).
- Both `patches/**` and `pnpm-workspace.yaml` are exam paths, so the **tests** step writes the patch (with the `pnpm-lock.yaml` change `patch-commit` makes). The type tests cannot compile without it anyway.

### A2. Nothing written twice

Authoring passes the machine once. `Program.make` reads `machine.model` and `machine.msg` and fills the checked declaration with them, so P11's declaration Schema, `stepper`, the loader and the runner keep their shape and see the same fields as today.

```ts
// Sketch: the counter after this change. Every type comes from counterMachine.
export const counter = Program.make({
	name: "counter",
	machine: counterMachine,
	state: {v: 1, upgrades: []}, // no schema: it is counterMachine.model
	view: (m) => ({count: m.count}), // V inferred; a wrong field fails tsc
	refuse: () => null,
	inputs: {inc: "Add one", dec: "Take one away", reset: "Back to zero"}, // key not a fresh Msg type: tsc fails
	outputs: {},
	writes: {},
	wake: () => null,
});
counter.state.schema === counterMachine.model; // true: filled in, not passed
counter.msg === counterMachine.msg; // true
```

- **No `msg` field and no `state.schema` in the authoring spec.** Passing either fails tsc.
- **The view is a function,** `view: (m) => V`, as the note says. V is inferred and must be a JSON type (tsc). In the checked declaration the view's data schema is `Schema.Json`, so a view that is not JSON at run time still fails as today. Drop `view.data`/`view.select` from authoring.
- **A write port is its description string** (anyone may send it), or `{description, personOnly: true}` for a person-only port. Its key must be a fresh Msg `type`; its payload schema is `machine.msg`, filled in. A read port keeps `Input.cases.read.make` with its own query schema and `answer(view, query)`, typed from V and the decoded query. That query schema is not a Msg, so nothing is repeated.
- This supersedes the body's "The shape" contract where they differ (`state.schema`, `msg`, `view.data`, write-port `schema`).

### A3. Throws follow Effect (owner, 2026-11-08)

- `Program.make(spec)` is for trusted input, the author's own code, like Schema's `.make`: it runs the load check and **throws** if it fails.
- `Program.makeEffect(spec)` keeps the failure in the error channel and never throws. *Changed after review, 2026-11-08:* it fails with the bare `SchemaIssue.Issue`, as Schema's own `makeEffect` does ([which one throws](../direction/schema-classes-not-of-helpers.md)). The first build wrapped it in a `ProgramInvalid`; the review caught that as a walk-back, and it is gone.
- The loader and `stepper(unknown)` take untrusted modules, so they use the typed path, never a throw. A broken module is still `ProgramDown` with `why: "load"`.

### A4. Lives in libfabrika (owner, 2026-11-08)

`Program.make` and `Program.makeEffect` are exported from `@kampus/libfabrika`. A program written from scratch against libfabrika and tea alone, with no fabrika app code, must compile and load without rewriting anything: no cast, no second schema, no app import. A type test writes one such program next to the counter.

### A5. Laws added to "Properties the tests check"

| Property | Plant |
|---|---|
| `machine.model` and `machine.msg` are typed `Schema.Schema<S>` / `Schema.Schema<M>`, readonly, and are the very schemas passed in. | Revert the patch; type them `unknown`; copy the schema. |
| `Program.make` fills `state.schema` and `msg` from the machine; passing either fails tsc. | Take them from the spec; accept an extra `msg`. |
| `view` is `(m) => V`; a wrong field or a non-JSON V fails tsc; a non-JSON value at run time still fails. | Drop the JSON bound; skip the run-time JSON check. |
| A write port key that is not a fresh Msg type fails tsc; `"desc"` and `{description, personOnly: true}` both load. | Accept any key; drop `personOnly`. |
| `Program.make` throws on a broken trusted spec; `makeEffect` fails with a bare `SchemaIssue.Issue` and never throws; `stepper(unknown)` and the loader never throw. | Return a broken program; throw from `makeEffect`; throw in the loader. |
| A from-scratch libfabrika program compiles and loads with no cast. | Require an app import or a cast. |

### A6. P12 and P34 are not on main

Neither is merged. `execution.test.ts`, `runner-supervision.test.ts`, `recovery-gaps.test.ts`, `supervision-spans.test.ts` and `door-recovery.test.ts` do not exist on `origin/main`, which this box starts from. The tests step skips them. Whichever of this PR, P12 and P34 lands second migrates the other's healthy fixtures in its own tests step. The rest of the body's P12/P34 section stands.

### A7. one-id-per-thing

Checked: this change makes no new id. A program's `name` stays a name. Nothing here points at a number or a title.

### A8. Files added to the table

| File | Work | Owner step |
|---|---|---|
| `patches/@demlik__tea@0.25.0.patch` | Declaration-only patch, demlik#897 shape | tests (exam path) |
| `pnpm-workspace.yaml` | `patchedDependencies` entry with its drop-when comment | tests (exam path) |
| `pnpm-lock.yaml` | The patch hash `pnpm patch-commit` writes | tests (same change as the patch) |

No open questions: each amendment builds the note or an owner call of 2026-11-08.

---

# `Program.make` in `next/`

Elm keeps the machine separate so a parent can hold and step it. Effect puts construction on `X.make`. This change follows both. [Elm first](../direction/elm-first.md), [Effect naming and constructors](../direction/schema-classes-not-of-helpers.md).

I checked installed Effect **4.1.1** and tea **0.25.0**. Effect Schema’s `.make` constructs and checks a value synchronously. Tea’s `Machine.make` infers the model and plain Msg from schemas, then adds Cmd values and settled Msgs from `cmds`. Its `NoInfer` prevents callbacks from widening those types. It performs no runtime decoding. `Cmd.make` takes Effect schemas directly and returns typed constructors and reply builders. The versions are pinned in [the catalog](../../pnpm-workspace.yaml); [the counter](../../next/programs/counter/src/program.ts) already uses these tea constructors. ~~No tea patch is present or needed.~~ Wrong: the note needs one. See the lead's amendments above.

The lead records the owner’s November 7 decision in a direction note. This plan builds that decision and repairs P11’s missing generic contract. It changes `next/` only.

## The whole idea

Sketch of the counter after this change:

```ts
import { Machine } from "@demlik/tea/effect";
import { Input, Program } from "@kampus/libfabrika";
import { Schema } from "effect";

const Model = Schema.Struct({ count: Schema.Int });
const Inc = Schema.Struct({ type: Schema.Literal("inc") });
const Dec = Schema.Struct({ type: Schema.Literal("dec") });
const Reset = Schema.Struct({ type: Schema.Literal("reset") });
const Msg = Schema.Union([Inc, Dec, Reset]);

export const counterMachine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (loaded) => [loaded ?? { count: 0 }, []],
	update: {
		inc: (m) => [{ count: m.count + 1 }, []],
		dec: (m) => [{ count: m.count - 1 }, []],
		reset: () => [{ count: 0 }, []],
	},
});

export const counter = Program.make({
	name: "counter",
	machine: counterMachine,
	state: { v: 1, schema: Model, upgrades: [] },
	msg: Msg,
	view: { data: Model, select: (m) => m },
	refuse: () => null,
	inputs: {
		inc: Input.cases.write.make({
			schema: Inc, description: "Add one", personOnly: false,
		}),
		dec: Input.cases.write.make({
			schema: Dec, description: "Take one away", personOnly: false,
		}),
		reset: Input.cases.write.make({
			schema: Reset, description: "Back to zero", personOnly: false,
		}),
	},
	outputs: {},
	writes: {},
	wake: () => null,
});
```

Made up: the proposed `Program.make` implementation and the stronger Input case-constructor types. The counter’s behavior, field names and message shapes already exist.

The schema values are declared once and reused. There are no repeated model, Msg or view type annotations.

## The shape

`Program` becomes the public constructor object and generic type. `Program.schema` holds the declaration Schema used at load time. This keeps the Schema separate from the authoring API and avoids retaining an inherited, permissive `.make` overload.

Sketch of the contract:

```ts
type Program<S, M extends { readonly type: string }, V, C extends Cmd> = {
	readonly name: string;
	readonly machine: Machine<S, M, C, Sub<never>, unknown>;
	readonly state: State<S>;
	readonly msg: Schema.Codec<M, Schema.Json>;
	readonly view: {
		readonly data: Schema.Codec<V, Schema.Json>;
		readonly select: (model: S) => V;
	};
	readonly refuse: (model: S, msg: M) => Refusal | null;
	readonly inputs: Ports<M, V>;
	readonly outputs: Readonly<Record<string, Schema.Codec<unknown, Schema.Json>>>;
	readonly writes: FactPolicies;
	readonly wake: (model: S) => number | null;
};

// Constructor signature sketch.
// The implementation retains each concrete port, output and fact schema.
declare function make<S, M extends { readonly type: string }, V, C extends Cmd>(
	spec: {
		readonly machine: Machine<S, M, C, Sub<never>, unknown>;
		readonly view: {
			readonly data: Schema.Codec<V, Schema.Json>;
			readonly select: (model: NoInfer<S>) => NoInfer<V>;
		};
	} & CheckedFields<NoInfer<S>, NoInfer<M>, NoInfer<V>, NoInfer<C>>,
): Program<S, M, V, C>;
```

`CheckedFields`, `Ports` and `FactPolicies` stand for the mapped checks below. They are implementation types, not new authoring helpers.

Inference has these sources:

- **Model, full Msg and Cmd:** the supplied machine only.
- **View:** `view.data`; `select` must accept that machine’s model and return that view.
- **Port payloads:** each port’s concrete schema.
- **Fact payloads:** each `writes` entry’s concrete schema.

Tea has no view type to extract. The machine supplies the selector’s model type; the required view schema supplies its result type. That preserves the decided typed view without another type declaration. Typed views.

Keep `state.schema` and `msg` as references to the schemas used by `Machine.make`. Tea’s public machine type does not expose those schemas. This avoids depending on undeclared tea fields. The full machine Msg includes Cmd replies; the fresh-message schema may describe its external subset.

The constructor must enforce:

1. `state.schema` describes the machine’s model. The fresh Msg schema produces messages the machine accepts.
2. `view.select`, `refuse` and `wake` use the machine’s model. `refuse` returns `Refusal | null`; `wake` returns `number | null`.
3. A write port’s key and schema match a fresh Msg case. A read port’s answer accepts the declared view and its query schema’s decoded input. Read and write fields remain exclusive.
4. A `writes.saved` schema produces facts tagged `"saved"`. A different tag, missing tag or malformed policy fails compilation.
5. Callback fields cannot widen the inferred machine or view types to make a mismatch fit.

Strengthen `Input.cases.write.make` and `Input.cases.read.make` to retain their concrete schema and callback types. Their current declaration-wide return types erase information before `Program.make` can check it. Schema still writes `_tag`.

`Program.make` is synchronous and pure. It runs the declaration check and returns the checked declaration with its concrete types intact. It preserves the supplied machine’s identity. It never boots or steps the machine, calls selectors, runs Cmds or reaches services.

Use strict function properties for the authoring contract. Keep erased function types confined to the runtime loader. No caller casts, explicit generic arguments or broad overloads should be needed.

This costs generic checking code and stronger port constructors. It preserves P11’s data and runner behavior. Confidence **90%**.

## Loading and running

Keep P11’s declaration Schema, including its required fields and function/schema checks. `Program.make` runs it. `stepper(unknown)` also runs it, since a loaded module remains an unchecked runtime input.

Malformed declarations still become `ProgramDown` with `why: "load"`. Schema checks cannot inspect a function’s TypeScript signature. A function that later returns invalid data still fails during checked initialization or stepping, as P11 does today. [P11’s declaration and stepper](../../next/packages/libfabrika/src/app/program.ts), [load-time requirement](./tier-1-detail.md#programs-as-p11-built-it).

The returned value works directly with `stepper`, `ProgramLoader` and the runner. Its machine works directly with tea’s pure stepping helpers and `syncTest`. It gains no wrapper machine.

All healthy test programs move through `Program.make`. This includes complete variants currently made by spreading a declaration. Deliberately broken declarations remain explicit runtime inputs typed `unknown`. They must not become examples of supported authoring.

The test writer owns the fixture changes. Some existing write ports use the entire Msg union, and some authority fixtures name ports absent from their machine’s Msg. Make those healthy fixtures complete while preserving their sender-law expectations. Do not weaken a law to fit the constructor.

## Fields included now and fields waiting

This change includes P11’s existing fields. None of the sketch’s additional fields is required by an approved Tier 1 row.

| Field | When it belongs |
|---|---|
| `location` | Tier 2’s desk, with navigation and focus history. [Program guidelines](../direction/program-guidelines.md#which-version) |
| `prefix`, `index` | Tier 2’s desk and `pick`. [Picker guidelines](../direction/picker-guidelines.md#which-version) |
| `commands` | The Tier 2 command and key work. A Tier 1 notes plan may adopt the decided form if it needs it. This counter repair does not. [Modes](../direction/modes.md#the-shape) |
| `find` | The Tier 2 `fabsh` plan must specify its contract. It is listed as made up in the agreed sketch; the picker note’s older `find.word` proposal is a different shape. |

Tier 2 has no approved pull-request rows yet, so this plan assigns none. Deferring these declarations loses no recorded fact. Their behavior has no current producer or consumer. Confidence **95%**.

## P12, P34 and P14

**P12:** its branch replaces the runner’s direct stepper access with Effect-based execution and a serializable declaration. Keep that work. Construction and full Schema checking stay inside the program’s isolate. The wire still carries the checked declaration projection and step results, never machine functions or schemas. Its execution tests’ healthy programs need migration. No RPC format or program-table change is needed.

**P34:** preserve its supervision changes, including `ProgramDown.cause`. Its runner, recovery and span tests contain more healthy program literals to migrate. Constructor failures stay load failures; bad step results retain their existing failure class. Restart policy and stored state do not change.

The lead reconciles their final merged code before tests start. These conclusions came from reading both local branches; their final combined result was not run.

**P14:** depends on this change. It takes view data and fresh Msg types from the constructed counter and its schemas. It must not introduce parallel handwritten types or a second constructor. Its React code stays on the window import path. [P12, P34 and P14](./tier-1.md#the-pull-requests-one-at-a-time).

## One value, traced

1. Importing the counter runs `Program.make`. The declaration passes its Schema check. `counter.machine === counterMachine`.
2. The loader checks it again. Initialization produces `{count: 0}`.
3. A fresh `{type: "inc"}` passes the Msg schema and its write port. `refuse` returns `null`.
4. The runner prepares `{count: 1}`, saves the accepted input, then publishes `{count: 1}`. No Cmd runs.
5. A parent can step `counter.machine` with tea’s helper. The existing saved-state law can run on that same value.

The input, saved model and view retain their current shapes. This change adds no ledger fields or records.

## Properties the tests check

Type failures live in a `.test.ts` included by the existing package typecheck. Put invalid calls inside an uncalled function. Use `@ts-expect-error` on the exact failing expression and `expectTypeOf` for positive inference. Runtime Vitest execution alone is not proof of these checks.

| Property | Plant |
|---|---|
| Model, Msg, Cmd and view types stay concrete, including a machine with a real `Cmd.make` definition. | Replace inference with `unknown` or `any`; erase settled Msgs or Cmd payloads. |
| A wrong view parameter or result fails compilation. | Read another model’s field; return a string count against the numeric view schema. |
| A wrong refusal parameter or result fails compilation. | Accept another Msg union; return `{why: 3}` or a Promise. |
| A wrong write port fails compilation. | Put a `dec` schema under `inc`; use an unknown Msg name or wrong payload. |
| Read answers receive the declared view and decoded query input. Read/write fields stay exclusive. | Use the wrong view or query type; combine `answer` and `personOnly`. |
| Wrong wake parameters and results fail compilation. | Accept another model; return text or a Promise. |
| Fact policy tags match their keys. Caused writes require their parent. | Put an `"answered"` schema under `saved`; omit `caused.parent`. |
| State and fresh Msg schemas fit the machine. Callbacks cannot widen them. | Supply another model schema or Msg case; remove the inference barriers. |
| A complete constructed program passes the load Schema and preserves machine identity. | Reject all programs; replace or wrap the machine. |
| Construction checks declarations without executing program code. | Invoke `init`, `select`, `refuse` or `wake` during construction. |
| Constructor and loader still reject broken runtime declarations. | Remove a required field; substitute a non-schema or non-function; skip either check. |
| Invalid callback results still fail at the right phase. | Accept invalid initial view data, a bad step model or malformed wake result. |
| Counter arithmetic, saved-state cuts, refusals, Cmd replies and sender laws remain intact after migration. | Skip a step, lose count on save, run refusal during replay or erase a queued parent. |
| P12 execution and P34 recovery still accept constructed programs. | Bypass isolate validation; lose load-error classification or supervision cause. |

Every negative type case has a nearby valid case. This prevents a constructor that rejects everything from passing.

## Files and lines

Paths are repo-relative. Counts estimate added or changed lines after P12 and P34 land. Every path matching [exam-paths.json](../../exam-paths.json) belongs to **tests**.

| File | Work | Lines | Owner step |
|---|---|---:|---|
| `next/packages/libfabrika/src/app/program.types.test.ts` | Positive inference and negative compile cases | 260 | tests |
| `next/packages/libfabrika/src/app/program.test.ts` | Constructor, load checks and healthy fixture migration | 180 | tests |
| `next/packages/libfabrika/src/app/runner.test.ts` | Construct healthy programs and variants; retain explicit corruption cases | 150 | tests |
| `next/programs/counter/src/program.laws.test.ts` | Schema path, identity and inferred types | 50 | tests |
| `next/packages/libfabrika/src/app/execution.test.ts` | P12 fixture migration and constructor handoff | 35 | tests |
| `next/packages/libfabrika/src/app/runner-supervision.test.ts` | P34 fixture migration | 30 | tests |
| `next/packages/libfabrika/src/app/recovery-gaps.test.ts` | P34 fixture migration | 25 | tests |
| `next/packages/libfabrika/src/app/supervision-spans.test.ts` | P34 fixture migration | 25 | tests |
| `next/apps/fabrika/src/door-recovery.test.ts` | P34 fixture migration | 25 | tests |
| `next/packages/libfabrika/src/app/program.ts` | Generic constructor, typed ports and private load representation | 240 | build |
| `next/packages/libfabrika/src/index.ts` | Public constructor and type exports | 10 | build |
| `next/programs/counter/src/program.ts` | Construct the counter and declare each port schema once | 45 | build |
| `docs/direction/program-make.md` | Record the November 7 decision and checked dependency contracts | 90 | lead |
| `docs/direction/README.md` | Index the decision | 1 | lead |
| `docs/plan/program-make.md` | Save the approved plan | 190 | lead |
| `docs/plan/README.md` | Record the repair and P14 dependency | 8 | lead |
| `docs/plan/tier-1.md` | Update P11 and P14 dependencies | 8 | lead |
| `docs/plan/tier-1-detail.md` | Separate authoring from load checking; update examples | 45 | lead |
| `.glossary/TERMS.md` | Correct the `next/` program definition | 8 | lead |
| `field/runs.jsonl`, `field/notes.jsonl` | Record each step and the confirmed gap | 12 | lead |

About **1,540 changed or added lines**, including the saved plan. The test writer repeats the program search on the merged base. Any further runnable test declaration belongs to tests; any further product declaration belongs to build.

## Order, checks and size

1. The lead records the existing decision, reconciles P12/P34 and approves this plan.
2. Tests writes the compile checks and runtime laws first. Confirm the missing guarantees are red.
3. Build implements the constructor and migrates the counter. Test-file changes return to tests.
4. Run narrow checks while working. Finish with format, typecheck, lint and the full test suite.
5. Run the bounded mutation check, then one separate review. The lead reads the final diff, CI and leak search.

Use the repository’s worker caps and one typecheck at a time. Generated laws and mutation sampling use seed **119120**. Reuse P12’s real counter loading check after migration.

Estimate **4 agent hours** on the repository’s scale: about 1.5 for tests, 1 for build, and 1.5 for integration, mutation, review and lead work. Confidence **70%**. The doubt is TypeScript inference through nested port constructors. The first compile tests settle that before the build expands. [Agent hours](../direction/agent-hours.md).

## What this cannot tell us

Nothing was changed, compiled or tested for this plan. The constructor signatures are sketches checked by reading installed types.

The load Schema cannot prove a function’s signature or behavior. Type tests cover authoring relationships; runtime laws cover returned data. Dynamic writes still need P11’s runtime policy and sender checks.

The final P12/P34 combination may need small adapter changes. This plan provides no new timing, cloud-wake or window result.

## Open questions

None. The constructor decision and Tier 1 scope are settled.