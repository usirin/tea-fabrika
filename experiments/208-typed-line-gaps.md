---
date: "2026-11-03"
summary: "`next/` design, built in experiments only. Yes: each refined value says once how it is spelled (`TicketNumber` is a digit 1-9 then up to 14 digits; `AskId` is `a-`, letters and `_`, `-`, digits), and the compiler, the run-time reader and the schema's check all read that one spelling. On 628 lines generated from the programs' parts (every program, flag, pair and three in a row, plus edge values from each spelling: `0`, `1.5`, `-1`, `1e3`, `0x10`, `01`, a 20-digit number, empty) and 41 fixed ones (204's 40 and one more), the compiler gives the run-time answer in the same words on every line. 204's readers differ on 31 of the 628: 28 the compiler lets through, and 3 it refuses that the run time takes (`a--1-0`), so 204's \"never the other way\" was wrong. The known way does not close it: Effect 4.1.1's and Zod 4.6.7's template literals keep one parts list but type it as TypeScript's template literal, looser than their own checks. One source per value; two readers of it in the library, held by the law. One line costs about 676 instantiations, up from 522, and about 0.5 ms; 167 stages is still the longest line. `1e3` and `0x10` are no longer a ticket number; a plain number flag no longer compiles. Lean: yes, 75%; the doubt is how far fixed text and runs reach on real ids. No model, $0."
---

# A typed tsh line with no gaps: one spelling per value

**Yes, the gaps close, from one source.** Each refined value now says once how it is spelled, and
the compiler, the run-time reader and the schema's own check all read that one spelling. On 628
generated lines and 41 fixed ones (204's 40 and one more), the compiler gives the run-time answer, in the same words,
on every line. On the same 628 lines, 204's two readers differ on 31: 28 the compiler let through,
and 3 it refused that the run time took. A checked line costs about 680 type instantiations, up
from 520 (+30%), and still about half a millisecond.

```ts
// A sketch, next/, from experiments/208-typed-line-gaps. A value, said once by its spelling:
export const TicketNumber = spelledNumber("TicketNumber", [
	run(DIGITS, {first: "123456789", most: 15}), // a digit 1-9, then up to 14 more digits
]);
export const AskId = spelledText("AskId", ["a-", run(`${LOWER}_`, {most: 32}), "-", run(DIGITS, {most: 15})]);

open({line: "ticket --ticket 117", from: "t1", via}); // compiles
open({line: "ticket --ticket 0", from: "t1", via});
// error TS2322: Type '"ticket --ticket 0"' is not assignable to type
//   '"ticket --ticket: 0 does not fit TicketNumber"'.
// The run-time reader says the same words: ticket --ticket: 0 does not fit TicketNumber
```

**Which version.** `next/` design work, built in `experiments/` only. No product code changed. The
sketch is experiment 204's (`experiments/204-typed-lines/`), copied and changed in four places: the
new `spelling.ts`, the two shared ids in `schemas.ts`, one type in `line.ts` and one function in
`parse.ts`. The ask id's shape comes from today's lane (`askedFor` in
`packages/pipeline/src/stages/pipeline/machine.ts`).

## The question

Experiment 204 typed a tsh line at compile time and left three gaps:

- `ticket --ticket 0`
- `ticket --ticket 1.5`
- `asks --ask a-approve-1.5 | ticket`

The run-time reader refuses each through a schema check: an integer, at least 1, the ask id's
pattern. The type of `TicketNumber` was a branded `number`, so the compiler read the value as
`${number}` and let all three through. Can the compiler see those checks, from one source, so the
two rules cannot drift? And does the law hold on a generated list, not only on 40 hand-picked
lines?

## The known way

Every library below keeps one declaration. None of them gets the refinement into the type of the
data, because a TypeScript template literal type has no "one or more digits".

| Who | One declaration | What the type says | What the run time checks |
|---|---|---|---|
| ArkType | A definition string, `"number.integer >= 1"`, read by its type-level parser and its validator alike ([arktype.io](https://arktype.io/)) | `number`, from memory: the parser checks the definition's syntax, not the data's text. Not checked here, no network. | integer, at least 1 |
| Effect 4.1.1, `Schema.TemplateLiteral(["a-", Schema.String, "-", Schema.Int])` | The parts list | `` `a-${string}-${number}` `` | Its own matcher (`segmentTemplateLiteralParts` in `SchemaAST.ts`): it splits the text, backtracking, then runs each part's checks. A number part must match `FINITE_PATTERN`, `[+-]?(?:\d+(?:\.\d+)?\|\.\d+)(?:[Ee][+-]?\d+)?`, and then `isInt`. |
| Zod 4.6.7, `z.templateLiteral([...])` | The parts list | `` `${number}` `` for a `z.int()` part (`AppendToTemplateLiteral` in `core/schemas.ts`) | One regex built from the parts; an int part becomes `-?\d+` (`leafPattern`), and a `.min(1)` on a number is left out (probed below). |
| TypeScript | `` `${number}` ``, `` `${bigint}` `` | No repetition and no character classes. A regex-typed string is an open request ([microsoft/TypeScript#41160](https://github.com/microsoft/TypeScript/issues/41160), cited from memory). | Nothing: types are gone at run time. |

So the known way gives one declaration with two meanings: a loose type and a strict check. That is
exactly 204's gap, and it is in Effect itself. Probed on 204's `AskId` with Effect 4.1.1 and tsc
7.0.2:

- `a-approve-1.5`: Effect refuses it (`isInt`); tsc's `` `a-${string}-${number}` `` takes it.
- `a-approve-0x10`: Effect refuses it (`FINITE_PATTERN`); tsc takes it.
- `a-re-plan-3`: Effect takes it, since its matcher backtracks to the last `-`; tsc refuses it, since
  its `${string}` stops at the first `-`.
- `a--8`: both take it.

The third runs the other way: the compiler refuses what the run time takes. 204 said that never
happens. It was wrong; the generated list below finds three such lines in 204's own sketch. Zod
4.6.7, probed the same way with `z.number().int().min(1)` as the last part, builds
`^a-[\s\S]{0,}--?\d+$` and so takes `a-x-0` and `a-x--1`.

`${bigint}` is no fix either. tsc 7.0.2 takes `-1`, `0` and `0x10` as `${bigint}`, and refuses `01`
and `+1`. And `${number}` takes `01`, `1.0`, `+1`, `.5`, `5.`, `0b11`, `0x10`, `1e3` and a 20-digit
number.

## What was built

The fix takes ArkType's shape: one definition, two readers in the library, one for the compiler and
one for the run time. The definition is not a string to parse but a short list of pieces, so the
type reader is small. All in `experiments/208-typed-line-gaps/`.

```ts
// spelling.ts: the whole vocabulary. A piece is fixed text, or a run of characters.
export interface Run {
	readonly of: string; // the characters a run may hold
	readonly first: string; // the characters it may start with
	readonly most: number; // at most this many, at least one
}
export type Piece = string | Run;
export type Spelling = readonly Piece[];
```

One spelling is read three ways. The two readers walk it step for step, the same greedy way: a run
takes as many characters as it can, up to `most`, and never gives one back.

```ts
// The run-time reader.
export const spells = (spelling: Spelling, text: string): boolean => {
	let i = 0;
	for (const piece of spelling) {
		if (typeof piece === "string") {
			if (!text.startsWith(piece, i)) return false;
			i += piece.length;
			continue;
		}
		const head = text[i];
		if (head === undefined || !piece.first.includes(head)) return false;
		i += 1;
		for (let n = 1; n < piece.most; n += 1) {
			const next = text[i];
			if (next === undefined || !piece.of.includes(next)) break;
			i += 1;
		}
	}
	return i === text.length;
};

// The compiler's reader: the same steps on a literal type.
export type Spells<V extends string, P extends Spelling> = P extends readonly [infer H, ...infer R extends Spelling]
	? H extends string
		? V extends `${H}${infer Rest}` ? Spells<Rest, R> : false
		: H extends Run
			? V extends `${infer C}${infer Rest}`
				? C extends Chars<H["first"]> ? Take<Rest, R, Chars<H["of"]>, H["most"], [C]> : false
				: false
			: false
	: V extends "" ? true : false;
```

The spelling reaches each reader through the schema:

- **The compiler** sees it in the value's type. `Schema.refine` with a type guard makes the schema's
  type `number & Spelled<P> & Brand<"TicketNumber">`, where `Spelled<P>` is a type-only mark that
  holds the pieces.
- **The run-time reader** finds it in a filter annotation, `{spelling}`, typed by augmenting Effect's
  `Annotations` interface, the way Effect's own docs show.
- **The schema's check** is the guard itself: a number is a `TicketNumber` when `String(n)` is
  spelled right. So `0`, `1.5`, `-1`, `NaN` and `1e21` fail as values too.

```ts
// spelling.ts, the number case. The string case is the same on Schema.String.
export const spelledNumber = <const B extends string, const P extends Spelling>(name: BrandName<B>, spelling: P) =>
	Schema.Number.pipe(
		Schema.refine((n: number): n is number & Spelled<P> => spells(spelling, String(n)), {spelling}),
		Schema.brand<B>(name),
	).annotate({identifier: name});

// line.ts: the one type that changed. 204 had `V extends TextOf<T>`, with `${number}` for a number.
type Takes<V extends string, T> = [Exclude<T, undefined>] extends [Spelled<infer P>]
	? Spells<V, P>
	: V extends Exclude<T, undefined> ? true : false;

// parse.ts: the one function that changed. The text must follow the spelling first.
const decodeText = (text: string, part: Part): {readonly value: unknown} | null => {
	const is = Schema.is(part.schema);
	const spelling = spellingOf(part.schema.ast);
	if (spelling !== undefined && !spells(spelling, text)) return null;
	if (is(text)) return {value: text};
	if (spelling !== undefined && is(Number(text))) return {value: Number(text)};
	return null;
};
```

Two guards keep a new hole out:

- **A plain number cannot be a flag.** `flag()` takes a schema whose type is text, a few fixed words,
  or a spelled value. `flag(Schema.Int, "A count.")` does not compile (`calls.ts` holds it with
  `@ts-expect-error`).
- **A string with a check of its own is the one hole the type cannot see.** A test walks every flag
  of every program and fails on any check that is not a spelling's.

| File | What it is |
|---|---|
| `spelling.ts` | New. `Run`, `Piece`, `Spelling`, `run`, `spells`, `Spells`, `Spelled`, `spelledText`, `spelledNumber`, `spellingOf`. About 170 lines. |
| `schemas.ts` | `TicketNumber` and `AskId`, each said once by its spelling. |
| `line.ts`, `parse.ts` | 204's two readers, with `Takes` and `decodeText` changed. |
| `register.ts` | 204's, with `flag()` limited to values that can be typed. |
| `programs/`, `open.ts` | 204's, unchanged. |
| `desk.ts` | The desk's programs as values, for the tests and the generator. |
| `cases.ts` | 204's 40 lines plus `a-rounds_spent-3`. No `gap` field any more. |
| `generate.ts`, `write-generated.ts`, `generated.ts` | The generated list: built from the programs' parts, written to a file the compiler reads. |
| `agree.test.ts` | The law, and three laws on the spellings. |
| `calls.ts` | Calls as a program writes them, 204's gaps now as `@ts-expect-error`. |
| `measure.ts` | The numbers below, and 204's readers on the generated list. |

## The generated list

`generate(programs)` builds lines from the programs' own parts, not by hand:

- every program alone, with each output and input named, and named twice;
- every flag of every program, with each value in both forms (`--ticket 0` and `--ticket=0`), alone,
  piped out of and piped into; given twice; with no value; on each program that lacks it;
- every pair of programs, with each output on the left and each input on the right named or not;
  bare pairs also with no spaces and as a job; every three in a row;
- the grammar's edges: an empty line, a lone `|` or `&`, a flag where a program goes.

A flag's values come from its spelling (`nearby` in `generate.ts`): the shortest and longest text,
one past the longest, an empty run, each run started or continued with a character outside its set
(`0`, `a`, `Z`, `_`, `-`, `.`, `+`, `é`, `😀`), each fixed text dropped or upper-cased, and the edge
list `0`, `1`, `1.5`, `-1`, `1e3`, `0x10`, `01`, a 20-digit number and the empty text, both whole and
inside each run. That makes 628 lines: 108 taken, 520 refused.

`write-generated.ts` writes them, with the run-time reader's answer, to `generated.ts` as one `const`
list, so the compiler reads each line as a literal. The type side of the law is one assertion over
the whole list, and on a failure it prints only the lines that differ:

```ts
// agree.test.ts
type Wrong<T extends readonly Case[]> = {
	[K in keyof T]: Same<Answer<T[K]["line"]>, T[K]["why"]> extends true
		? never
		: {line: T[K]["line"]; compiler: Answer<T[K]["line"]>; runtime: T[K]["why"]};
}[number];

expectTypeOf<Wrong<typeof generated>>().toBeNever();
expect(generate(programs)).toEqual(generated); // the file is current
```

## What came back

`tsc -p experiments/208-typed-line-gaps` is clean and vitest passes 50 of 50. `measure.ts` also reads
the same 628 lines with 204's readers, each with its own run-time answers:

| Sketch | Lines | Run time takes | Compiler differs | Compiler takes, run time refuses | Compiler refuses, run time takes |
|---|---|---|---|---|---|
| 204 | 628 | 206 | 31 | 28 | 3 |
| 208 | 628 | 108 | 0 | 0 | 0 |

204's 31 lines come from 9 values. Each shows in up to four lines (two forms, two pipes):

- `TicketNumber`: `0`, `1.5`, `-1`, `99999999999999999999`. The last is a fourth gap 204's list
  missed: Effect's `Schema.Int` takes only safe integers, while `${number}` takes any number.
- `AskId`, count part: `0.`, `1.5`, `0x10` and the 20-digit number. These are Effect's
  `FINITE_PATTERN` and `isInt` against tsc's `${number}`.
- `AskId`, the other way: `a--1-0`. Effect's matcher hands `-1` to the `${string}` part; tsc's
  `${string}` stops at the first `-` and then cannot read `1-0` as a number.

**Do the laws bite?** Three planted mistakes, each put back after:

- Two wrong answers in `generated.ts` (one `ok` made a refusal, one refusal made `ok`). `tsc` failed
  and named exactly those two lines, with both answers.
- An off-by-one in the run-time `spells` (`n <= piece.most`). `vitest` failed the "file is current"
  test. With the file written again from the broken reader, `tsc` failed and named the lines with one
  character too many, a 33-letter ask kind first.

## What changed in the answers

The spelling is stricter than 204's `${number}`, and a little stricter than today's tsh.

- **204 took `ticket --ticket 1e3` and `--ticket 0x10`. Both are refused now.** So are `01`, `1.0`,
  `+1` and `.5`.
- **Today's tsh takes `1e3` and `1.0` for a ticket number**, since it reads a word as JSON when the
  text alone does not fit (`packages/fabrika/src/shell/decode.ts`). It refuses `01` and `0x10`. A
  person typing a ticket as `1e3` is not a real case, so this is a cost on paper only.
- **A ticket number now stops below 10^15.** Today's has no top beyond what JavaScript can hold. A
  bound is needed: without one, `99999999999999999999` follows the digits but is not a safe integer.
- **An ask id keeps today's reading,** `/^a-([a-z_]+)-\d+$/`, with a bound on each run (32 letters, 15
  digits). `a-approve-08` is still an ask id, as today.

## The numbers

204's method: the sketch plus a file of `open` calls, every line different, 3 runs each, median. Both
sketches ran side by side in one run, so the two columns compare. The laptop had other agents
running, all under `nice -n 19`. `experiments/results/208-typed-line-gaps.json`.

| Compiler | Lines | 204 instantiations | 208 instantiations | 204 check time | 208 check time |
|---|---|---|---|---|---|
| tsc 7.0.2 | 0 | 17,958 | 19,680 | 10 ms | 12 ms |
| | 1 | 19,559 | 21,532 | 9 ms | 10 ms |
| | 10 | 27,823 | 31,058 | 13 ms | 19 ms |
| | 100 | 70,123 | 87,276 | 54 ms | 60 ms |
| tsgo 7.0.0-dev.20260707.2 | 100 | 70,123 | 87,276 | 48 ms | 60 ms |

- **One line costs about 676 instantiations, up from 522**, and about 0.5 ms of check time either way.
  Memory at 100 lines: 130 MB, up from 127 MB. tsgo counts the same as tsc 7, as in 204.
- **The 628 generated lines as one file:** 202,791 instantiations and 112 ms of check time for 208,
  against 191,516 and 102 ms for 204.
- **The longest line is still 167 stages** of `ticket <ticket >ticket` (666 words), as in 204. With a
  15-digit ticket on every stage it is 125 stages (748 words, 6,239 characters). Past that, both
  compilers stop with TS2589. A real line has under 20 words.
- TypeScript 6 was not measured: 204 used an unpacked 6.0.3 from outside the repo, and none was on
  this machine.

## Lean

**Yes: give each refined value a spelling, and let both readers read it.** 75%.

- **Why.** It closes all of 204's gaps and the four more the generated list found, from one
  declaration per value. The error words do not change. The type check of a literal line now agrees
  with the run time on every generated line, in both directions.
- **What it costs.** About 170 lines in `spelling.ts`. About 30% more type work per line, still half a
  millisecond. A spelling for every number flag: a plain `Schema.Int` flag no longer compiles.
- **One source, or two?** One source per value: the spelling. Two readers of it in the library, the
  type `Spells` and the function `spells`, as ArkType has a type parser and a validator. Those two are
  written twice and kept together by the law. That pair is generic, a few dozen lines each, and it does
  not grow with the number of ids. The one source cannot be Effect's own `TemplateLiteral`: its type
  is TypeScript's template literal, looser than its check, as the table above shows.
- **The doubt, and what settles it.** Three things.
  - The vocabulary is tiny: fixed text and runs. A value that needs a choice (`0`, or a digit 1-9 and
    more) or an optional piece needs a new piece kind, written in both readers. Trying the ids in
    today's `packages/pipeline/src/ids.ts` (`plan:...`, `stuck:...`) as spellings settles how far it
    reaches, about 1 agent hour.
  - A string flag with a check of its own is caught by a test, not by the type. A lint rule on
    `flag(...)` could make it a build error.
  - The law is as wide as the generated list. A rule with no generated case could still differ, as in
    204. Generating from the spelling, not from a hand list, is what makes this smaller than before.

## Made-up names

Every name here is from experiment 204, from Effect, or listed below.

- `Spelling`, `Piece`, `Run`, `run`, `spells`, `Spells`, `Take`, `Chars`, `Spelled`, `spelledText`,
  `spelledNumber`, `spellingOf`, `BrandName`, `DIGITS`, `LOWER`: this spike's. The keys `of`, `first`
  and `most` are short words as AGENTS.md asks.
- `Takes`, `Typeable`, `Wrong`, `Same`: this spike's, beside 204's own.
- `generate`, `nearby`, `EDGES`, `STRANGERS`, `generated`, `desk.ts`'s `programs`: this spike's.
- The `spelling` annotation key: this spike's, added to Effect's `Annotations` the way Effect's docs
  show.
- 204's programs and their parts are unchanged, `probe` among them (made up, for the law).

## What this cannot tell us

- How it feels in an editor. The messages were read from `tsc`, not from a hover.
- Whether a spelling reaches every real id. Only two were tried, both short and regular.
- Whether today's tsh should take the same stricter spelling. Only the sketch's readers changed.
- How it scales with real programs, which have more parts and more flags. `Pairs` grows as outputs
  times inputs, and that was not measured here either.
- Whether ArkType's data type is `number` for `"number.integer >= 1"`, and whether
  microsoft/TypeScript#41160 is still open. Both are from memory, with no network to check.
- The generated list tries each flag's values one at a time. It never puts two refined flags with
  edge values on one line, since no program has two.

## How to run it

```sh
nice -n 19 node_modules/.bin/tsc -p experiments/208-typed-line-gaps        # the type side of the law, and calls.ts
nice -n 19 node_modules/.bin/vitest run --config experiments/208-typed-line-gaps/vitest.config.ts --maxWorkers=1
nice -n 19 node experiments/208-typed-line-gaps/write-generated.ts && pnpm format   # after a change to the programs or the spellings
nice -n 19 node experiments/208-typed-line-gaps/measure.ts                   # RUNS=<n>, default 3; about 25 seconds
```

No model, no network while running, $0.
