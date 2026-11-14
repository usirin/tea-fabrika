---
date: "2026-11-09"
scripts: "none"
summary: "`next/`, structure-sweep 0.3.9 and Jev, every verdict checked by hand, $0.012. Three real finds, now tickets 472 to 474: the pre-hello method rule decided twice and differently (`transport/gateway.ts`, `transport/answer.ts`), the execution call-to-reason map written twice, the brain's stopping guard three times. Pairwise verdicts 13 of 20 right, with the two highest scores wrong; anchor mode found none. Features 83 of 91 right. `move plan` would undo the five layers' folders, and `move apply` still strips `.ts` (ts-morph `move`), so it was not run."
---

# 244. What does structure-sweep find in `next/`?

Run 2026-11-09 on origin/main at `972bfcdd`. **All claims are about `next/`.** The tool is
`@demlik/structure-sweep` 0.3.9 with `@demlik/code-graph` 0.15.0, asking Jev `jev-1.13.0`. Every
verdict below was checked by hand against the code. Raw output stayed under `runs/` (not in git);
the numbers are in [`results/244-structure-sweep-on-next.json`](./results/244-structure-sweep-on-next.json).

**The answer.** The tool found three real duplicated or misplaced decisions in `next/`, and each is
now a tracker ticket: 472 (the pre-hello rule), 473 (the execution reason map) and 474 (the brain's
stopping guard). Jev's own verdicts were right about two times in three on duplicate pairs, and its
most confident wrong answers were its highest scores, as the earlier Jev research warned. Feature
placement was right for 83 of 91 files. The whole run cost about 1.2 cents. Treat it as a cheap
way to point a person at code, never as a verdict.

```text
code-graph next --collapse        20 candidate pairs, 218 functions considered    no model
structure-sweep pairs --pairwise  20 Jev calls   13 of 20 right by hand
structure-sweep pairs (anchor)    17 Jev calls   0 "same decision", missed both real ones
structure-sweep sweep             91 files       83 of 91 features right; 5 rule-in-API flags, 3 worth acting on
structure-sweep move plan         28 moves       not applied: it would undo the five layers' folders
```

## 1. Pairs: which functions make the same decision twice

code-graph's collapse report gave 20 candidate pairs over 35 functions in `next/`. `pairs --plan`
priced them at about 14,000 input tokens before any call. A 4-pair try came back readable, so all
20 were asked in both modes.

How a verdict was scored: right if its action fits the code. `same_decision` means "make it one
function", `shared_helper` means "pull out a helper", `look_alike` means "keep apart".

| Jev's pairwise verdict | Pairs | Right by hand |
|---|---|---|
| `look_alike` | 9 | 7 |
| `shared_helper` | 9 | 4 |
| `same_decision` | 2 | 2 on "a rule repeats", 0 on "make it one function" |

The real finds, all checked in the code:

```ts
// next/packages/libfabrika/src/app/brain-life.ts: the same guard in three handlers
started: (s, m) => [terminal(s) || s._tag === "stopping" ? s : BrainState.cases.online.make(...), []],
waiting: (s, m) => [terminal(s) || s._tag === "stopping" ? s : BrainState.cases.waiting.make(...), []],
braked:  (s, m) => [terminal(s) || s._tag === "stopping" ? s : BrainState.cases.braked.make(...), []],
```

- **The brain's "ignore news once stopping" guard, three times** (above). Jev called two of the
  three symmetric pairs `same_decision` and the third `look_alike`. The rule does repeat. But the
  right fix is one named predicate, not one function, so the action was wrong. Ticket 474.
- **Which `ProgramDown` reason each execution call fails with,** written twice in
  `app/execution.ts`: `nodeExecution` and `workerExecution` both map init to `load`, fold to
  `saved_letter`, upgrade to `saved_state`, and step, reply, check and admit to `step`. Jev said
  `shared_helper` (0.76). Right: one table would stop the two drifting apart. Ticket 473.
- **Lazy table setup in four stores** (`data/records.ts`, `data/sink.ts`,
  `coordination/process-store.ts`, `data/ledger-store.ts`): `if (!ready) for (const query of
  TABLES) sql.exec(query)` inside the first transaction. Jev said `shared_helper` on one pair.
  It is plumbing, not a decision, so no ticket.

Where Jev was wrong:

- Its two highest scores were both wrong: `workerExecution` against `workerLoader` (0.87) and
  `bridgeProperty` against `isPromiseBridge` (0.83), where one already calls the other. Both are
  `shared_helper` with nothing left to share.
- Three more `shared_helper` calls named code that already uses one helper (`forProcess`, `process`)
  or does unrelated jobs (`guard` and `model`; `placedByAny` and a table setup).
- `checkRoot` and `root` in `exam/twin.ts` walk a member chain the same way. Jev split its answer
  three ways (0.32, 0.35, 0.33) and picked `look_alike`.

**Anchor mode, the default, found nothing.** It said `look_alike` on all 20 pairs, including the
three brain-life pairs (yes at 0.43, 0.29 and 0.20) and the execution reason map (0.17). Its yes or
no question "is this the same business rule" can't express "the same guard with different
outcomes".

**The same question, asked twice, flipped.** The `braked`/`waiting` pair came back 0.42 same and
0.46 look-alike on the first run. On the second it came back 0.45 and 0.45, and the tool recorded
`same_decision`. The tool takes Jev's top choice, and a tie went to the first option.

## 2. Sweep: which feature and role each file is

The vocabulary came from `next/`'s own words in `.glossary/TERMS.md`, the Runtime, Ledger and
Clients sections: `ledger`, `records`, `processes`, `supervision`, `grants`, `door`, `gateway`,
`programs`, `brain`, `host`, `build`, `exam`. The roles stayed the tool's five defaults. A 5-file
try came back right, then all 91 files under `next/packages/libfabrika` and `next/apps/fabrika`
were swept.

**Features: 83 of 91 right.** The 8 wrong ones fall into three groups:

- No feature fit, because the vocabulary has none for the shared kernel or test helpers: `id.ts`
  and `id.test-support.ts` went to `processes`, `testing.ts` to `exam`, the package's `index.ts` to
  `programs`.
- A word with two meanings. `node/stage.fixture.ts` fakes an OS process's RSS output, and Jev filed
  it under fabrika's `processes` (0.63). The glossary's rule of one meaning per word is ours, not
  Jev's.
- Three wiring files in `workers/` landed on the feature they serve, not on `host`:
  `fetch.ts` to `grants` (0.35, a three-way split), `control.ts` to `door`, and `index.ts` to
  `host` when the vocabulary put the program loader under `build`.

**Rules inside API files: 5 flagged at 0.3 or more, all 5 hold a rule, 3 worth acting on.**

| File | Score | What is there | Act? |
|---|---|---|---|
| `transport/gateway.ts` | 0.78 | wait caps (64, 16,384 bytes) and which methods may come before hello | yes |
| `workers/control.ts` | 0.70 | the internal method list, and refusing a commit that names `process` | no: a guard at the edge, and `commit` sets `process` itself anyway |
| `workers/fetch.ts` | 0.52 | host and origin checks | no: a guard that belongs at the edge |
| `transport/answer.ts` | 0.33 | which methods may come before hello | yes |
| `workers/gateway.ts` | 0.30 | the hello and knock moves of the socket's state | yes |

The three "yes" rows are one finding. Two plain functions decide which methods a client may call
before hello, and they disagree:

```ts
// next/packages/libfabrika/src/transport/gateway.ts:98, used by workers/gateway.ts
if (now._tag !== "online" && !["initialize", "door.knock"].includes(request.method)) // no_hello
// next/packages/libfabrika/src/transport/answer.ts:47, reached only by answer.test.ts
if (attached._tag !== "online" && !(attached._tag === "waiting" && method === "door.knock")) // no_hello
```

`answerFrame` is the plain function that [an object class stays
thin](../docs/direction/object-classes-stay-thin.md) names, but only its own test calls it. The
running path is `connection`, and the moves to `waiting` and `online` sit in the gateway's
platform wiring (`workers/gateway.ts:65-118`). Both build the JSON-RPC error frame by hand too. Ticket 472.

Roles were not scored file by file. A spot check agreed on the clear cases (`brain-life.ts`,
`process.ts`, `members.ts`, `recovery.ts` as rules; the stores as persistence). `data/referee.ts`
came back `persistence` at 0.37, though it is where append's rules are decided.

## 3. Move plan, not applied

`move plan` proposed 28 moves and 25 to review, into `<scope>/src/<feature>/<role>/`, such as
`coordination/process.ts` to `processes/rules/process.ts`. That would replace the five layers'
folders (`transport`, `data`, `coordination`, `app`), which `layer-rules.json` checks import
directions by. So the plan is evidence only. Nothing moved.

The `.ts` stripping bug is still there in 0.3.9, read from its code and shown on ts-morph alone.
`move apply` rewrites imports with ts-morph's `SourceFile.move`, and its heal step only fixes a
path that no longer resolves. ts-morph 28.0.0 turns `"./a.ts"` into `"./feat/rules/a"`, which
still resolves, so it is never healed. `move apply` was not run.

## Cost

| Run | Input tokens |
|---|---|
| pairs, 4-pair try | 3,748 |
| pairs, pairwise | 20,808 |
| pairs, anchor | 19,585 |
| sweep, 5-file try | 13,978 |
| sweep, 91 files | 218,300 |
| **Total** | **276,419** |

At $0.042 per million input tokens, with output free (TypeSafe's model page, read 2026-11-09),
that is **$0.012**. code-graph, `propose`, `pairs --plan` and `move plan` made no call.

## What this cannot tell us

- **One person's hand check, no second reader.** "Right" means one agent read the code and the
  verdict's action. A second reader might score the near ties (`checkRoot`/`root`,
  `forProcess`/`process`) the other way.
- **Recall is unknown.** code-graph picked the 20 candidates. A duplicated decision whose two
  copies look different was never asked about.
- **The vocabulary is ours.** The 83 of 91 depends on the 12 features written for this run. A
  vocabulary with a shared-kernel feature would likely fix 3 of the 8 misses. That is a guess,
  not measured.
- **`score` was not run.** It grades features by co-change in git history, and `next/` is a few
  weeks old, so its history is thin.
- **One run per question,** except the four pairs asked twice. One of those four flipped, so a
  single answer near a tie is not stable.
