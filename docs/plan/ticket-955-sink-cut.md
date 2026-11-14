Approved by the lead agent, builds 0186 and ticket 955; body 42c9105f27a4
Plancheck-Version: 3

# Ticket 955: the sink's frame cut holds with stray parentheses and CRLF stacks

Everything here is about `next/`. Today's version is not changed. This plan builds
[0186](../../.decisions/0186-stored-stack-frames-name-no-folder.md): a stored stack frame keeps its
name, file name, line and column, and never a folder. It fixes the cut in
`next/packages/libfabrika/src/telemetry/Sink.ts` that pull request 1012 and ticket 502's slice S1
(commits 680e334, tests, and 04d0415, build) brought in.

```text
what Cause.pretty gives                         stored today                         stored after this plan
    at fn (/root/a)b/c.ts:1:2)                      at fn (/root/a)b/c.ts:1:2)           at fn (c.ts:1:2)
    at fn (/root/a(b/c.ts:1:2)                      at fn (/root/a(c.ts:1:2)             at fn (c.ts:1:2)
    at fn (/root/a/b/c.ts:1:2)\r                    at fn (/root/a/b/c.ts:1:2)\r         at fn (c.ts:1:2)\r
      at g (/root/x.ts:3:4)\r {                     at g (/root/x.ts:3:4)\r {          at g (x.ts:3:4)\r {
```

## The answer first

- **Two bugs, one each.** The cut finds a frame's location by counting parentheses from the right
  (`opening`). A folder with one unmatched `(` or `)` breaks the count. A `)` alone makes the cut
  give up and store the line whole. A `(` alone makes it open the location inside the folder, so
  the part of the folder before the `(` is stored (`at fn (/root/a(c.ts:1:2)`). The ticket says the
  line is stored whole in both cases; that is true only of the `)` case. The lead's run and mine
  agree on what each case stores.
- **The CRLF bug is a line-break bug.** The call site splits `Cause.pretty`'s text on `"\n"` only,
  so each frame line keeps a `\r`. The frame regex's `.` does not match `\r`, so no frame matches
  and every line is stored whole, folders included. `Cause.pretty` also writes ` {` after a cause's
  last line when that cause has a cause of its own, so a stack that ends in `\r` gives `...)\r {`,
  with the `\r` inside the line (`effect@4.1.2`, `src/internal/effect.ts`, `renderErrorCause`; I
  ran it on a scratch copy, outside the repo, three errors deep).
- **The fix, my lean:** split on every line break and keep each break as it was; open a location at
  the leftmost ` (` whose rest starts a path, a URL or an eval origin, else at the last ` (`; and
  let the frame regex match any character. A `\r` stays where it was: the cut only takes folders
  out.
- **The laws:** two new properties, S4 and S5, over generated folders that hold a stray `(` or
  `)` and generated line endings (`\n`, `\r\n`). Two `pinned:` tests for the two named cases. S1,
  S2, S3 and the supervision law stay as they are, word for word.
- **Case 2 had no law before.** The earlier cut at `f83e0e9e8` fixes case 1 (the lead ran it: it
  stores `at fn (c.ts:1:2)`), but it also stores a line ending in `\r` whole. No law at
  `f83e0e9e8` or at `HEAD` ever fed the sink a `\r`.

## How others do it

- **V8's own format** (the stack trace API, [v8.dev/docs/stack-trace-api](https://v8.dev/docs/stack-trace-api),
  not fetched for this plan; from memory): `at <name> (<location>)`, `at <location>`, `at async
  <name> (<location>)`, and an eval origin `eval at <name> (<location>), <location>`. V8 does not
  escape a folder's parentheses. So no parser can tell every name from every location: a name that
  holds ` (/x)` and a folder named `a) (` print the same bytes.
- **error-stack-parser-es 1.0.5**, installed here as a dependency of another package
  (`node_modules/.pnpm/error-stack-parser-es@1.0.5/.../dist/lite.mjs`, read): it splits on `"\n"`,
  takes the location from the **first** ` (` to the end (`/ (\(.+\)$)/`), and strips every `(` and
  `)` from it. So a name never holds ` (`. It drops `(definition)` from Effect's names and strips
  eval origins, which S2 and the eval shapes forbid, and it parses frames into fields where the
  sink must rebuild each line word for word. So it is not used
  ([0040](../../.decisions/0040-existing-tools-before-hand-written.md) asks; this is why not).
  Its lesson is taken: when in doubt, the location starts at the leftmost ` (`.
- **Sentry's V8 line parser** (`@sentry/core`, `node-stack-trace`, not installed, not fetched,
  from memory) also reads the name lazily up to the first ` (`, with special cases for `async` and
  `eval`.
- **Line breaks:** JavaScript's `.` matches no line terminator: `\n`, `\r`, U+2028 and U+2029
  (ECMA-262, "LineTerminator", from memory). The `s` flag (dotAll) makes `.` match them all.

The known way is "the location opens at the first ` (`", and this plan keeps it, with one
refinement that keeps Effect's `sink.frames (definition)` names whole.

## The shape

A sketch, for the build to shape as it likes. Only `opening`, `located`, `portable` and the call
site change; `place` stays.

```ts
// Sketch. Where a location may start: an eval origin, a scheme (`file:`, `http:`, `node:`, a drive
// `C:`), or a separator.
const START = /^(?:eval at |[a-z][a-z\d+.-]*:|[/\\])/is;

/** Where the location group opens in `body`: the leftmost " (" whose rest starts a location, else
 *  the last " (". -1 if there is none. Leftmost, so a folder's own " (" can never end a name. */
const opens = (body: string): number => {
  let last = -1;
  for (let at = body.indexOf(" ("); at !== -1; at = body.indexOf(" (", at + 1)) {
    if (START.test(body.slice(at + 2))) return at + 1;
    last = at + 1;
  }
  return last;
};

/** An eval origin, `eval at <name> (<location>), <location>`: its name stays; each location loses
 *  its folder, however deep the origins nest. */
const located = (location: string): string => {
  const origin = location.startsWith("eval at ") ? location.lastIndexOf("), ") : -1;
  const head = origin === -1 ? "" : location.slice(0, origin);
  const open = origin === -1 ? -1 : opens(head);
  return open === -1
    ? place(location)
    : `${head.slice(0, open)}(${located(head.slice(open + 1))}), ${place(location.slice(origin + 3))}`;
};

const portable = (line: string): string => {
  const frame = /^(\s*at )(.*?)( \{)?$/s.exec(line); // `s`: no character in a folder stops the match
  if (frame === null) return line;
  const [, at = "", body = "", ending = ""] = frame;
  const open = body.endsWith(")") ? opens(body) : -1;
  if (open > 0) return `${at}${body.slice(0, open)}(${located(body.slice(open + 1, -1))})${ending}`;
  const bare = /^(async )?((?:[a-z][a-z\d+.-]*:|[/\\]).*|.*(?::\d+){1,2})$/is.exec(body);
  return bare === null ? line : `${at}${bare[1] ?? ""}${place(bare[2] ?? "")}${ending}`;
};

// The call site: every line break is a separator, kept as it was, so a `\r` survives the cut.
const cut = (text: string): string =>
  text
    .split(/(\r\n|\r|\n)/)
    .map((piece, index) => (index % 2 === 1 ? piece : portable(piece)))
    .join("");
```

I ran this sketch on a scratch copy, outside the repo, on 16 lines: both named cases, a `\r\n` stack
with a `\r {` line, eval origins with a stray `)` and a nested ` (/`, `(definition)`, the bracket root
`/sink w (private)/folder`, `<anonymous>`, `index 3`, a slashed name, a dev-server query with a
`)`, `node:`, a Windows path with `(`, a relative `src/a.ts`. Each came out as the laws below want.

No new type, no Schema, no union and no state: the cut is a pure function on a string. It has no
states, so 0037 and 0046 ask nothing of it.

## Decided here

Each is a call on how the code does what 0186 already decides. Those marked **for the lead** are
calls a reader could argue; each carries my lean and how sure I am.

**The lead's lean, for the owner to read:** the lead takes each lean below as written, at the
confidence given. The one the owner may want to read is the third: a name that holds ` (` and then
a path start loses that part of the name, because those bytes cannot be told apart from a folder,
and 0186 says a folder is never stored. No law covers such a name today, so nothing is loosened.

- **A `\r` stays where it was** (for the lead; 90% sure). The cut takes folders out and nothing
  else, so a CRLF stack stays CRLF and a `\r {` stays `\r {`. Dropping `\r` would change bytes
  0186 does not let the sink touch, and S2 already says every non-frame byte survives. What would
  change my mind: a reader of stored content that breaks on `\r`; none exists in `next/`.
- **Split on `\r\n`, `\r` and `\n`, keeping each break** (for the lead; 80% sure), over "strip one
  trailing `\r`, cut, put it back". The strip misses `...)\r {`, the line `Cause.pretty` writes
  when a cause whose stack ends in `\r` has a cause of its own, so it still leaks on CRLF text.
  The split handles it with no special case. A lone `\r` is split too, for free; the laws cannot reach a lone `\r`
  through `Cause.pretty` (see "What this cannot tell us").
- **The location opens at the leftmost ` (` that starts a location, else at the last ` (`** (for
  the lead; 75% sure). This replaces parenthesis counting. It fails closed: when a name and a folder
  cannot be told apart, the folder goes, never the other way. The cost is fidelity in one rare
  case: a name that itself holds ` (` and then a path start, as in a span named `GET (/api)`,
  stores as `at GET (x.ts:1:2)`, losing ` (/api)`. Today's cut keeps that name whole. No law
  covers that name today, so this loosens nothing, and S5 pins the new answer with the
  `pathName` shape. The other way, the rightmost ` (` that starts a path, keeps that name but
  stores `/root/a` for a folder named `a (`, which 0186 forbids. What would change my mind: a real
  span or function name in `next/` that holds ` (/`; `rg -n 'Effect.fn\("[^"]* \(' next` finds
  none today.
- **The frame regexes take the `s` flag** (for the lead; 70% sure). It is the same root cause as
  case 2: `.` stops at a line terminator. After the split, only U+2028 and U+2029 are left that
  `.` would stop at, and a folder may hold either. The laws put U+2028 in generated folders. Cost:
  one letter on two regexes.
- **Pinned tests, not fast-check `examples`.** Effect's `Arbitrary.CheckOptions` in
  `effect@4.1.2` has `runs`, `seed`, `replay` and others, but no `examples`, and the file's laws
  run through `it.effect.prop`. So each named bug is its own `it.effect("pinned: ...")`.
- **New laws beside S1 and S2, not a wider S1 and S2.** Adding shapes or folder kinds to
  `FrameInput` would change every sample S1 and S2 draw under seed 119120, and spread their 50 runs
  thinner over the old shapes. The new input, `StrayInput`, is its own schema; the frame table is
  shared only if the shared code gives S1 and S2 byte-identical samples.
- **No plan README row.** `docs/plan/README.md` lists tiers and multi-PR plans; ticket 502's line
  there covers S1, and this ticket fixes S1's cut. The plan doc is the record. The lead may add a
  clause to the 502 line; I lean no.

## One value traced through

The input is three errors, outer, inner and innermost, each the cause of the one before, as S5's
helper throws them. Each has this stack, joined with `\r\n` and ending in a lone `\r` (S5's
`tail: "\r"`):

```text
Error: inner\r\n    at fn (/sink-ab/x)y/private/nested/fn.ts:1:2)\r
```

1. `Cause.pretty` drops the outer header's `\r` (`cleanErrorStack` rebuilds the first line from
   name and message) and keeps each frame line with its `\r`. The outer stack is followed by the
   `Effect.fn` span frames, the last of them taking ` {`. The inner error is printed as
   `  [cause]: Error: inner` and its frame lines with two more spaces; its last line takes ` {`
   because it has a cause: `      at fn (/sink-ab/x)y/private/nested/fn.ts:1:2)\r {`.
2. `cut` splits that line into a piece, a break and a piece:
   `"      at fn (/sink-ab/x)y/private/nested/fn.ts:1:2)"`, `"\r"`, `" {"`.
3. `portable` on the first piece: the frame regex matches; the body ends in `)`; `opens` finds
   ` (` after `fn`, and its rest starts with `/`, so the location is
   `/sink-ab/x)y/private/nested/fn.ts:1:2`. `place` keeps `:1:2` and the text after the last `/`:
   `fn.ts:1:2`. Out: `      at fn (fn.ts:1:2)`.
4. `" {"` matches no frame and comes back unchanged; so does the `"\r"` break.
5. Joined: `      at fn (fn.ts:1:2)\r {`. S4 finds no `/` or `\` in any frame line and no form of
   `/sink-ab/x)y/private`. S5 finds the `\r` break and ` {` where they were, and the frame equal to
   its `kept` text. Today's cut stores this line whole: `.` stops at the `\r`.

## Laws

Every law is a test: each one reads stored content through the real sink, `flush` and
`RecordManager.content`, as S1 and S2 do. None is a lint or type law, since the cut works on text
at run time. No law computes what it expects by calling the sink's cutting code (0186): each
generated frame carries its own expected text, built from the same parts as its raw text, and the
`Effect.fn` frame is read by the test's own regex, as S2 does. Each plant is run once and recorded,
not kept ([0093](../../.decisions/0093-laws-walk-plants-run-once.md)). No law is host-only.

`StrayInput`, the new Effect Schema in `Sink.test.ts`:

```ts
// Sketch, for the tests step to shape.
const StrayInput = Schema.Struct({
  word: FrameWord,
  rootKind: Schema.Literals(["posix", "url", "windows"]),
  // One unmatched parenthesis in one folder, with spaces around it, so " (" and ") " appear too.
  before: Schema.String.check(Schema.isPattern(/^[a-z ]{0,8}$/)),
  stray: Schema.Literals(["(", ")"]),
  after: Schema.String.check(Schema.isPattern(/^[a-z ]{0,8}$/)),
  breaker: Schema.Literals(["", "\u2028"]), // a line terminator `.` does not match
  ending: Schema.Literals(["\n", "\r\n"]), // between a stack's lines
  tail: Schema.Literals(["", "\n", "\r\n", "\r"]), // after its last line; "\r" gives `\r {` below
  frames: Schema.Array(
    Schema.Struct({
      // FrameInput's 15 shapes, plus two names that hold " (".
      shape: Schema.Literals([/* FrameInput's shapes */ "parenName", "pathName"]),
      name: FrameWord,
      line: FramePosition,
      column: FramePosition,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
});
// root, posix: `/sink-${word}/${before}${stray}${breaker}${after}/private`; the url and windows
// forms as frameCases builds them. The two new shapes:
//   parenName: raw `at ${name} (${word}) (${location})`  kept `at ${name} (${word}) (${file})`
//   pathName:  raw `at ${name} (${root}) (${location})`  kept `at ${name} (${file})`   (the fail-closed lean)
// Every other shape builds raw and kept as frameCases does, over this root.
```

`storedFrames` gains the line ending, the tail and a third error as inputs. For `StrayInput` it
throws outer, inner and innermost, so the inner's last line takes ` {`. S1 and S2 call it with
`"\n"`, no tail and two errors, so their stacks stay byte for byte what they are now.

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| S1 [secrets], kept word for word: every stored frame loses folders, including nested causes and encoded roots; 50 runs, seed 119120 | test | Effect Arbitrary: FrameInput | (the law as it is; no change) |
| S2, kept word for word: frame order, names, file positions and every non-frame byte survive; 50 runs, seed 119120 | test | Effect Arbitrary: FrameInput | (the law as it is; no change) |
| S3 [secrets], kept word for word: a typed failure through nested `Effect.fn` spans stores no folder or repo root, and every span frame keeps its name, file, line and column; 50 runs, seed 119120 | test | Effect Arbitrary: TypedInput | (the law as it is; no change) |
| Supervision law in `supervision-spans.test.ts`, kept word for word: the throw's message and every frame (name, file, line, column) reach P37, no stored frame names a folder, the content is deletable, only classes stay in receipts, dead events and measurements; default runs | test | fc.oneof: the file's `generatedThrow`, unchanged | (the law as it is; no change) |
| S4 [secrets]: with a stray `(` or `)` in a folder, U+2028 or not, and `\n` or `\r\n` line endings, no stored frame line names a folder (no `/` or `\` outside `node:` and the generated slashed names), and the content holds no form of the root (plain, JSON-escaped, `encodeURI`, `encodeURIComponent`); 50 runs, seed 119120 | test | Effect Arbitrary: StrayInput | count parentheses again, as `opening` does; split on `"\n"` only; drop the `s` flag |
| S5: on the same inputs, the stored text and `Cause.pretty`'s text, each split on `\r\n`, `\r` and `\n` with the breaks kept, have the same pieces in the same order; every break is equal, `\r` included; every non-frame piece is equal; each generated frame is its indent plus its `kept`; the `Effect.fn` frame keeps name, file, line and column; 50 runs, seed 119120 | test | Effect Arbitrary: StrayInput | drop every `\r`; strip one trailing `\r` only, which leaves `\r {` whole; open at the rightmost ` (` that starts a path |
| `pinned: ticket 955, a folder with one unmatched parenthesis`: four frames, `at fn (/root/a)b/c.ts:1:2)`, `at fn (/root/a(b/c.ts:1:2)`, `at eval (eval at g (/root/a)b/c.ts:3:4), <anonymous>:1:1)` and `at /root/a(b/c.ts:5:6`, store as `at fn (c.ts:1:2)`, `at fn (c.ts:1:2)`, `at eval (eval at g (c.ts:3:4), <anonymous>:1:1)` and `at c.ts:5:6` | test | pinned: ticket 955, case 1, the shapes the parenthesis count got wrong, plus a bare location | count parentheses again |
| `pinned: ticket 955, a CRLF stack keeps its line endings`: three errors, each the cause of the one before, every stack `Error: m\r\n    at fn (/root/a/b/c.ts:1:2)\r\n    at g (/root/x.ts:3:4)\r`; the stored text holds `at fn (c.ts:1:2)\r` and `at g (x.ts:3:4)\r` for each, the inner's as `at g (x.ts:3:4)\r {`, and no `/root` anywhere | test | pinned: ticket 955, case 2, never covered by any law before | split on `"\n"` only; strip one trailing `\r` only |

S1 to S3 and the supervision law are listed so the review can see none was loosened, removed or
renamed. The test writer does not edit them; the build must keep them green.

Which plant catches which bug: S4's first plant is today's case 1, its second is today's case 2.
S5's second plant is the "strip one `\r`" fix that leaks on `\r {`. S5's third plant is the
rightmost-` (` alternative from "Decided here"; it fails on `pathName` (a folder in the name) and
on roots whose folder ends in ` (`.

## Is it a setting?

No. Where a frame's location starts is how 0186's rule is carried out, not a choice a person makes
when running fabrika ([0069](../../.decisions/0069-choices-are-settings.md)). The plan adds no
setting.

## What this records

No row, span or ledger entry changes shape. What is stored changes: a frame line that held a folder
before now holds only its file name, line and column. The folder in rows written before this lands
is already stored; this plan does not rewrite old rows. The fact lost if this does not land: none
new, since folders are what 0186 says must not be kept. A person's own deletion of a span's content
still removes old rows ([an agent run keeps its content](../../docs/direction/an-agent-run-keeps-its-content.md)).

## Files and ownership

| Path | Owner | Product lines expected | What changes |
|---|---|---|---|
| `next/packages/libfabrika/src/telemetry/Sink.test.ts` | tests | tests | `StrayInput`, `storedFrames` taking the line ending, the tail and a third error, laws S4 and S5, and the two `pinned:` tests; S1, S2 and S3 untouched |
| `next/packages/libfabrika/src/telemetry/Sink.ts` | build | 30 | `opening` goes; `opens`, `located` and `portable` as in the sketch; the call site splits on every line break and keeps it; the doc comments say what they now do |
| `next/packages/libfabrika/src/node/dev/supervision-spans.test.ts` | tests | tests | no change: its law is listed above so the review can see it is kept; it must stay green on the build |
| `docs/plan/ticket-955-sink-cut.md` | lead | docs | this plan |

No screenshots: no window changes.

## Size

1. **One pull request, stacked on `fabrikalfa/t502-s1-connection`.** About 30 product lines in
   `Sink.ts`, about 120 test lines in `Sink.test.ts`. 80% sure of both.

The budget: tests, build, review, and one send-back. Priced from ticket 502's step medians since
2026-11-09, as its plan gives them (tests $0.97, build $1.15, review $1.18), with the send-back as
a build ($1.15): $4.45, rounded up for a small margin.

Estimate: 4 steps, $5

## What this cannot tell us

- **Whether a real stack ever holds these folders.** The laws use made-up folders. No stored record
  from a real run with a parenthesis in its folder or a CRLF stack was read.
- **A lone `\r` as a line break.** `Cause.pretty` splits a stack on `"\n"` and rebuilds the first
  line from the error's name and message (`cleanErrorStack`), so a stack broken only by `\r` loses
  its frames before the sink sees them. The cut splits on a lone `\r` anyway, but no law reaches it
  through the sink.
- **A `\r` or `\n` inside a folder name.** Both are legal on Linux. The split breaks such a frame in
  two, and the first half (`at fn (/root/a`) is stored whole. This plan does not cover it. A fix
  would need to read the whole frame across a break; I found no real case, and I name it here
  rather than in a law that would be red.
- **A folder whose name holds `), `.** The eval origin is split at its last `), `, so a trailing
  location whose folder holds `), ` can leave a folder's last word in the stored line. The
  generator's alphabet has no comma, so no law covers it.
- **Names that hold ` (` and then a path start.** They lose that part of the name, by the lean in
  "Decided here". If a real one turns up, the lead's call there gets read again.
- **Whether S5's helper's third error changes what `Cause.pretty` prints for the `Effect.fn`
  frames.** The scratch run says it does not; the tests step sees it first.
- **I did not run the supervision law.** Only the three `A-Sink` laws ran here (`vitest run
  --maxWorkers=1 ... -t "A-Sink"`: 3 passed). The build runs `supervision-spans.test.ts` once.

## Open questions

None.

Each call above follows 0186's rule (never a folder, nothing else lost), and each is marked for the
lead where a reader could argue it.

## Findings

none
