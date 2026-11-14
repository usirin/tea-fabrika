---
date: "2026-11-03"
summary: "`next/` design, built in experiments only. Yes: tail-recursive conditional types read a literal line ArkType's way, and the editor says `Type '\"asks | nope\"' is not assignable to type '\"no program nope\"'`. Programs reach the checker through a `Register` interface each fills from its own file (TanStack Router's), no import between them. On 40 lines the compiler and a run-time reader of the same grammar give the same words on 37; on 3 the compiler lets through what the schema's checks refuse (`--ticket 0`, `1.5`), never the other way. One line costs about 520 instantiations and 0.45 ms of check time on TypeScript 7 (0.6 ms on 6); 167 stages (666 words) is the longest before TS2589. A line with a hole (`string`, a template) must go through `unchecked`, and `bad_line` stays. Shared ids need a brand and an `identifier`; today's `TicketNumber` has neither. Lean: yes for lines in program code, 70%; the doubt is how the registry reaches each program package's own type check. No model, $0."
---

# A tsh line typed at compile time

**Yes, the compiler can check a literal line, and say why it is wrong in words.** A chain of
tail-recursive conditional types reads `open({line: "asks | nope"})` the way ArkType reads its string
definitions, and the editor says `Type '"asks | nope"' is not assignable to type '"no program nope"'`.
The programs reach the checker through a `Register` interface that each fills from its own file, as
TanStack Router's does, with no import between them. On a fixed list of 40 lines the compiler and a
run-time parser of the same grammar give the same words on 37, and on the other 3 the compiler lets
through a line the run-time check refuses, never the other way. A checked line costs about 520 type
instantiations and under half a millisecond. The longest line TypeScript reads is 167 stages (666
words, about 4 KB).

```ts
// A sketch, next/, from experiments/204-typed-lines. Each program adds itself, in its own file:
declare module "../register.ts" {
	interface Register {
		ticket: typeof ticket;
	}
}

open({line: "asks --ask a-approve-8 | ticket", from: "t1", via}); // compiles
open({line: "asks | nope", from: "t1", via});
// error TS2322: Type '"asks | nope"' is not assignable to type '"no program nope"'.
open({line: `asks --ask ${id} | ticket`, from: "t1", via});
// error TS2322: Type '`asks --ask ${string} | ticket`' is not assignable to type
//   '"a line built at run time: pass it through unchecked(line)"'.
open({line: unchecked(`asks --ask ${id} | ticket`), from: "t1", via}); // compiles; the desk checks it
```

**Which version.** `next/` design work, built in `experiments/` only. No product code changed. The
grammar was learned from today's tsh (`packages/fabrika/src/shell/grammar.ts` and `check.ts`, read on
main at `b1a06509`) and rethought, not ported. The three programs' parts come from today's
`programs/ticket` and `programs/tracker`, cut down, and from the asks program of the program
guidelines note (proposed, on its own branch, not merged) and the [ask desk](../docs/direction/ask-desk.md).

## The question

The desk's `open` Cmd takes a `line`, the line a person could have typed in tsh
(the program guidelines note, G2 R4, not merged yet). Today only tsh's
fit check, at run time, refuses a line whose pipes do not fit. Can the compiler check a literal line,
so a program's own `open` calls fail to build when a name, a flag or a pipe is wrong? And G6 says a
program never imports another, so how do the other programs' types reach the call?

## The known way

| Who | What it does | What we take |
|---|---|---|
| ArkType | Parses a string definition in the type system; a mistake "is a type error that says what's wrong, right where you made it", for example `Unmatched ) before []` ([arktype.io](https://arktype.io/)). The parameter's type becomes the message, a string literal type. | The whole shape: walk the literal with conditional types, answer `"ok"` or a message, put the message where the argument goes. |
| TanStack Router | "we use declaration merging on the exported `Register` interface": `declare module '@tanstack/react-router' { interface Register { router: typeof router } }` ([type safety guide](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety)). `<Link to>` then knows every route, and the link's module imports none. | The registry. Ours has one key per program, each added from that program's file. |
| Hono RPC | The client takes the server's type, `hc<typeof app>`. | Not taken: the caller imports the type of what it calls, which G6 rules out between programs. |
| `ts-sql` | A small SQL engine in type annotations alone: a query string is parsed and run by the compiler. | Proof that the parsing part holds up on real grammars; also a warning that it gets slow as the grammar grows. |

## What was built

All in `experiments/204-typed-lines/`, about 930 lines with the tests and the measure script.

| File | What it is |
|---|---|
| `register.ts` | `Register`, empty; `defineProgram`, `flag`, `input`, `output` as stand-ins for tea-program's, parts only. |
| `schemas.ts` | The shared shapes: `TicketNumber`, `AskId`, `OneTicket`, `Query`. Programs import these, never each other. |
| `programs/asks.ts`, `ticket.ts`, `tracker.ts` | The three programs. Each adds itself to `Register` in its own file. |
| `programs/probe.ts` | Made up, for the law only: two inputs that both fit one output, and a union input. |
| `line.ts` | `Answer<S>`: the type-level reader. Imports only `Register`. |
| `parse.ts` | `read(line, programs)`: the same grammar at run time, with the desk's programs as values. |
| `open.ts` | `open`, `Checked<S>`, `unchecked`. |
| `cases.ts`, `agree.test.ts` | The 40 lines, and the law that both readers give their answers. |
| `calls.ts` | Calls as a program writes them, with `@ts-expect-error` on the bad ones. |
| `measure.ts` | The numbers below. |

The grammar is a part of tsh's:

```text
line     command ('|' command)* ['&']
command  program part*
part     --flag value | --flag=value | >output | <input
```

`|` and `&` are words even with no space around them. Words split on spaces only. The checks, in
order, first one wins: each command left to right, then the pipe into it.

- **A program:** a name in `Register`. `--ticket 1 | ticket` is `expected a program name, not --ticket`.
- **A flag:** one of that program's, given once, with a value the flag's type can be spelled as.
- **`>output` and `<input`:** one of that program's, named once.
- **A pipe:** exactly one (output, input) pair fits. "Fits" is today's rule: the same shape, or the
  same as one member of a union input. None fits, or more than one, and the line is refused.

```ts
// line.ts, the pipe, cut down
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Member<A, B> = B extends unknown ? Same<A, B> : never;
type Fits<A, B> = Same<A, B> extends true ? true : true extends Member<A, B> ? true : false;

type Pipe<L extends Seen, R extends Seen> = [Pairs<L, R>] extends [never]
	? `${Label<L, ">", L["out"]>} | ${Label<R, "<", R["into"]>}: no output fits an input`
	: true extends IsUnion<Pairs<L, R>>
		? `${Label<L, ">", L["out"]>} | ${Label<R, "<", R["into"]>}: more than one way fits, name one with >output or <input`
		: "ok";
```

### One id, one name, said twice

The type-level fit compares TypeScript types, and the run-time fit compares JSON Schema. Today's
`TicketNumber` is a plain integer of at least 1, so to the compiler it is `number`, the same as every
other number. So each shared id in `schemas.ts` gets its name twice: a brand, which the type sees,
and an `identifier`, which puts the name into the JSON Schema the run-time check compares.

```ts
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
	.pipe(Schema.brand("TicketNumber"))
	.annotate({identifier: "TicketNumber"});
```

Effect 4.1.1's brand leaves no trace at run time (probed), so the brand alone cannot do both. The
brand's name is also what the error says: `abc does not fit TicketNumber`.

## The law: two readers, one grammar

`cases.ts` lists 40 lines: 15 the desk takes, 22 both readers refuse, and 3 gaps. The type side
is one assertion over the whole list, so a drift fails `tsc`; the run-time side is one vitest case per
line.

```ts
// agree.test.ts
type Typed<T extends readonly Case[]> = {[K in keyof T]: Answer<T[K]["line"]>};
type Expected<T extends readonly Case[]> = {
	[K in keyof T]: T[K] extends {readonly gap: string} ? "ok" : T[K]["why"];
};
expectTypeOf<Typed<typeof cases>>().toEqualTypeOf<Expected<typeof cases>>();

it.each(cases)("$line", (c) => {
	const got = read(c.line, programs);
	expect(got._tag === "line" ? "ok" : got.why).toBe(c.why);
});
```

Both passed on the first full run: 43 of 43 vitest cases, and `tsc -p experiments/204-typed-lines`
clean. A planted wrong answer (`no program nopeX`) failed `tsc` and printed the compiler's whole list
of answers, so the type side does check.

| Line | Run time | Compiler |
|---|---|---|
| `ticket --ticket 0` | `0 does not fit TicketNumber` | ok |
| `ticket --ticket 1.5` | `1.5 does not fit TicketNumber` | ok |
| `asks --ask a-approve-1.5 \| ticket` | `a-approve-1.5 does not fit AskId` | ok |

**The gaps are checks the type cannot see.** "An integer" and "at least 1" live in the schema's
checks, and the type of `TicketNumber` is a branded `number`. So the compiler reads the value as
`${number}`, and lets `0` through. That is the safe side: the compiler never refuses a line the desk
would take, so a gap costs a `bad_line` at run time, as today. (Wrong: on a generated list,
[experiment 208](./208-typed-line-gaps.md) found 31 lines that differ, and on 3 of them, such as
`asks --ask a--1-0`, the compiler refuses what the run time takes.) A number is the text `${number}`
accepts, which the run-time reader matches exactly (`text !== "" && Number.isFinite(Number(text))`):
`1e3` and `0x10` pass both, `1_0` and `Infinity` fail both. A first guess, `JSON.parse`, would have
refused `0x10` where the compiler took it; the probe caught it before the law was written.

ArkType has no such gap because its string is the only definition: `"number.integer >= 1"` is read by
its type parser and its run-time validator alike. Ours has two: the Effect schema and its type.

## The numbers

Each compiler checked the sketch plus a file of `open` calls, every line different so none is cached,
3 runs each, median. A laptop under load (a live run and two other agents), all under `nice -n 19`, so
the wall times are high and only roughly comparable. `experiments/results/204-typed-lines.json`.

| Compiler | Lines | Wall | Check time | Instantiations | Memory |
|---|---|---|---|---|---|
| tsc 7.0.2 (the repo's, patched by `@effect/tsgo`) | 0 | 123 ms | 9 ms | 17,914 | 106 MB |
| | 1 | 122 ms | 9 ms | 19,471 | 106 MB |
| | 10 | 135 ms | 12 ms | 27,735 | 109 MB |
| | 100 | 175 ms | 53 ms | 70,035 | 127 MB |
| tsgo 7.0.0-dev.20260707.2 | 0 | 150 ms | 12 ms | 17,914 | 105 MB |
| | 100 | 224 ms | 65 ms | 70,035 | 127 MB |
| tsc 6.0.3 (the last JavaScript one) | 0 | 630 ms | 90 ms | 7,831 | 171 MB |
| | 1 | 614 ms | 90 ms | 8,832 | 172 MB |
| | 10 | 625 ms | 90 ms | 13,581 | 180 MB |
| | 100 | 652 ms | 150 ms | 55,881 | 204 MB |

- **One line costs about 520 instantiations** on TypeScript 7 (480 on 6) and about 0.45 ms of check
  time (0.6 ms on 6). 100 lines add about 21 MB. Today no program has more than a handful of `open`
  calls.
- **The longest line is 167 stages**, each `ticket <ticket >ticket`: 666 words, 4,164 characters. At
  168 all three compilers stop with TS2589, "Type instantiation is excessively deep and possibly
  infinite". The limit is in words, not stages; a real line has under 20.
- tsgo and tsc 7 count the same instantiations, as they are the same checker.

## Three errors, as the compiler prints them

From a scratch file of three bad calls, not kept. The editor's hover shows the same text, since it is the same checker. No editor was opened: the LSP
tool here found no TypeScript install in the worktree.

```text
(5,7): error TS2322: Type '"asks | nope"' is not assignable to type '"no program nope"'.
(6,7): error TS2322: Type '"ticket | tracker"' is not assignable to type '"ticket | tracker: no output fits an input"'.
(7,7): error TS2322: Type '"asks --ask approve-8 | ticket"' is not assignable to type '"asks --ask: approve-8 does not fit AskId"'.
```

## A line built at run time

`Checked<S>` asks first whether the line's type has a hole in it. `string` has, and so has
`` `asks --ask ${id} | ticket` ``. A line with a hole is refused, and the message says what to do:

```ts
export type Checked<S extends string> = S extends Unchecked
	? S
	: Literal<S> extends false
		? "a line built at run time: pass it through unchecked(line)"
		: Answer<S> extends "ok"
			? S
			: Answer<S>;
```

- **Why refuse a hole, and not read around it.** `Answer` alone, given
  `` `asks --ask a-${string}-${number} | ticket` ``, says `"ok"`. That is wrong: the `${string}` could
  hold `x | nope`. The type cannot say "a string with no space", so a line with a hole is never
  checked by the compiler.
- Even when the hole is a typed `AskId`, as in `` `asks --ask ${id} | ticket` `` with `id: AskId`, the
  call is refused the same way. `AskId`'s middle is any string.
- `unchecked(line)` gives an `Unchecked`, a branded string. The desk reads it at run time and may
  answer `bad_line`.
- **`bad_line` stays in the Cmd's `err` for every line.** The desk reads every line again, since the
  programs it has may not be the ones the caller was built against.

## Findings on the way

- **The registry has to reach each program's own type check.** TanStack's `Register` works because
  the router and the links are in one app. Our programs are packages, each with its own `typecheck`.
  The asks package, checked alone, sees only its own key, so `asks | ticket` would be `no program
  ticket` there. The `Register` idea needs one more piece: a generated file of every program's parts
  as types, which every program package includes. That is TanStack's `routeTree.gen.ts`. It is a
  type-only edge between programs, which `layer-rules.json` would have to allow for that one file.
  This spike has one tsconfig for all four programs, so it never met this.
- **The id needs a name the type can see.** Today's `TicketNumber` is not a brand. Without one, any
  integer output would fit a ticket input at compile time and not at run time.
- **Two shapes of ask id exist in today's code.** The pipeline's `AskId` is `plan:...`, `stuck:...`,
  `ruling:...` or `check:...` (`packages/pipeline/src/ids.ts:111`). The lane names its asks
  `a-<what for>-<count>` (`packages/pipeline/src/stages/pipeline/machine.ts:924`). The guidelines'
  `asks --ask a-approve-8` is the second. This spike uses the second.
- **A lint false alarm.** `fabrika/no-implicit-effect-concurrency` fired on a plain function named
  `valueOf`: the rule looks the callee's name up in a plain object (`WHAT[name]`), and `valueOf` is
  found on `Object.prototype`. The function was renamed; the rule is not changed here.

## Lean

**Yes, for lines written in code: a program's `open` calls, and its tests. Not for what a person
types.** 70%.

- **Why.** A wrong line in a program's code is a bug its author should see while typing, not when a
  person presses Enter. The messages are as readable as tsh's own. The cost per line is small, and
  the law keeps the two readers on one grammar.
- **What it costs.** About 190 lines of types and 180 of run-time reader, next to each other with the
  law between them. A generated registry file for the type check of each program package. A brand
  and an `identifier` on each shared id. Every grammar change is made twice, and the law fails until
  both are made.
- **What it does not replace.** The run-time check stays the one that decides. A person's typed line,
  a palette line and an `Unchecked` line only ever meet that one.
- **The doubt, and what settles it.** Two things. First, the generated registry: whether one
  program's package can see every other program's types without breaking G6 in spirit. One program
  package in `next/` with a generated `programs.gen.ts` and a `layer-rules.json` line settles it, about
  1 agent hour. Second, the grammar this spike left out: `$( )`, quotes, `input=value`, `;`, `&&`,
  `||`, `--help`, `--all` and `anyInput`. Quotes are the hard one: a value with a space in it means
  the type reader has to scan characters, not words, and that costs depth. Adding quotes to both
  readers and measuring the depth limit again settles it, about 1 agent hour.

## Made-up names

Every name here is either from a settled note or today's code, or listed below.

- `Register`: TanStack's name, used as theirs.
- `Answer`, `Checked`, `Unchecked`, `unchecked`, `read`, `Read`, `Stage`, `Seen`, `Literal`, `Fits`,
  `Same`, `Member`, `Pairs`, `Pipe`, `Label`, `Walk`, `Job`, `Words`, `Spread`, `Commands`, `Parts`,
  `FlagThen`, `TextOf`, `NameOf`, `TypeOf`, `Get`, `IsUnion`: this spike's.
- `defineProgram`, `flag`, `input`, `output`, `Part`, `Declared`: stand-ins for tea-program's, parts
  only, no `main`.
- The `probe` program and its parts `first`, `second`, `either`, `ask`: made up, for the law.
- The asks program's `ask` flag and `quit` input: the flag is the guidelines' `--ask`; `quit` is a
  guess, since its inputs are not settled.
- The error messages' words: this spike's, close to tsh's own.
- The keys `_tag`, `why`, `line`, `job`, `stages`, `wire`, `flags`, `program`: short words as
  AGENTS.md asks; `at` is not used.

## What this cannot tell us

- How it feels in an editor. The messages were read from `tsc`, and the editor's latency on a big
  program package was not measured.
- Whether the generated registry works across real program packages (above).
- Whether the type reader stays this cheap with quotes, `$( )` and statements. Only a part of tsh's
  grammar was built.
- Whether two readers drift in practice. The law covers 40 lines; a new rule with no case in the list
  could differ unseen. A generated list (every program, every flag, every pair) would close that, and
  was not built.
- Real programs have more parts than these cut-down ones, and `Pairs` grows as outputs times inputs.
  Not measured.

## How to run it

```sh
nice -n 19 node_modules/.bin/tsc -p experiments/204-typed-lines        # the type side of the law, and calls.ts
nice -n 19 node_modules/.bin/vitest run --config experiments/204-typed-lines/vitest.config.ts --maxWorkers=1
TS6=<an unpacked typescript@6.0.3>/bin/tsc nice -n 19 node experiments/204-typed-lines/measure.ts
```

No model, no network while running, $0.
