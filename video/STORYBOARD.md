# Storyboard: The machine owns the loop

A visual version of the ten-post series in `../blog/`, for people who would
rather watch than read. No voiceover: the captions carry the story.

**Length:** 9:35. A 20-second intro, ten chapters, a 20-second outro.

| Part | Post | Seconds |
|---|---|---|
| Intro | — | 20 |
| Ch01 | Fabrika was v3. This is v4. | 55 |
| Ch02 | Meeting Jev: when unsure means the question was bad | 60 |
| Ch03 | A judge that cannot add | 60 |
| Ch04 | The agents had a shell | 55 |
| Ch05 | Tests decide, not models | 55 |
| Ch06 | Rebuilding fabrika one step at a time | 60 |
| Ch07 | Cheap enough to read everything | 55 |
| Ch08 | The twenty dollar lesson | 40 |
| Ch09 | Working with the agent, not through it | 45 |
| Ch10 | Knobs in a file, systems with SDKs | 50 |
| Outro | — | 20 |

`src/timeline.ts` holds these numbers. It is the only place they live.

## How a chapter is built

Every chapter has the same shape, laid out by `Chapter` in
`src/design/Chapter.tsx`:

1. **Header card**, 3.5 s: the number, the post's title, "Part N of 10".
2. **Scenes**, in order. A scene is one visual plus the captions that run over
   it. Each caption stays up for its words at 3 a second, plus 0.8 s for the
   fades (never under 2.4 s). A scene can add `lead` (seconds before its first
   caption) and `hold` (seconds after its last).
3. **Takeaway card**: the one line at the end. It gets whatever time is left,
   and must get at least 4 s. If the scenes leave less, the render fails and
   says by how much.

Below, each beat is one scene. Lines starting with `>` are the captions, word
for word, in order. **Visual** says which component, what animates, and the
numbers. The numbers all come from the posts; do not add any that are not in
`../blog/` or `../experiments/README.md`.

### Rules for every caption

- At most 96 characters, so it never wraps past two lines. Longer fails the
  render.
- Plain words, the posts' voice: first person, warm, short sentences.
- `*word*` paints a word in the accent; `` `code` `` sets it in mono. Use the
  accent once per caption at most, on the thing the visual is pointing at.
- No quotes of chat messages, and nothing that only says someone said or
  asked something. tea and demlik are the author's brother's work: say "my
  brother's library" if credit comes up, and never name him.

### Components

All in `src/design/`, exported from `src/design/index.ts`:

| Component | Use |
|---|---|
| `Chapter`, `Scene` | The chapter runner: header, scenes, takeaway |
| `Caption` | One narration line (the runner places these for you) |
| `TitleCard` | Kicker, big title, subtitle; full frame |
| `ChapterHeader`, `Takeaway` | The chapter's first and last cards (placed by the runner) |
| `Counter`, `CounterRow` | A number ticking up, with a label |
| `BarChart` | Horizontal bars that grow in, value printed at the end |
| `FlowDiagram`, `row()` | Boxes and arrows that draw on; `bend` for curves, `muted` for the old way |
| `CodeCard` | A code or TOML card that types on, with highlighted lines |

Design tokens (`color`, `type`, `space`, `stage`) and timing helpers
(`seconds`, `enter`, `progress`, `easeOut`, `captionSeconds`) live next to
them. One accent colour only: use it for the single thing each frame is about.
`src/chapters/Ch01.tsx` is the reference chapter; copy its shape.

### Building chapters in parallel

Each chapter is one file, `src/chapters/ChNN.tsx`, exporting `ChNN`. A
chapter agent edits only its own file. Anything it needs that the design
system lacks (a dot grid, a ruler, a receipt) goes in that file, or in a
folder `src/chapters/ChNN/` next to it. Do not edit `src/timeline.ts`,
`src/Root.tsx`, anything under `src/design/`, `package.json` or the lockfile:
every chapter shares them. If a shared change is truly needed, say so in your
report instead.

The caption times below already fit each chapter's row with room for the
takeaway; Ch02 is the tightest (about 0.6 s spare after a 4 s takeaway), so
give its scenes no `hold`.

---

## Intro · 20 s (built)

**Beat 1 · 5 s.** `TitleCard`: kicker "tea-fabrika", title "The machine owns
the loop", subtitle "Rebuilding an agent pipeline as a plain state machine."
Parts rise in one after another. No caption.

**Beat 2 · 9.5 s.** `CounterRow`: 58 commits, 37 experiments (accent), 2 days.

> 58 commits and 37 experiments, in two days.
>
> One question: could the loop that takes a ticket to working code be plain code?

**Beat 3 · 5.5 s.** All ten chapter titles in two columns, numbers in the
accent, fading in top to bottom.

> Ten parts, one per blog post. No sound needed. Just read along.

---

## Ch01 · Fabrika was v3. This is v4. · 55 s (built)

**Beat 1.** `FlowDiagram` row of six boxes, drawing on left to right: report →
triage → plan → build → review → ship. Kicker above: "fabrika · v3".

> Fabrika is my agent pipeline. An issue goes through six steps.

**Beat 2.** `CounterRow`: 29 skills, 8 agents, 2,500 lines in the operator's
skill (accent).

> 29 skills, 8 agents, and an operator skill of about 2,500 lines.
>
> The prose is the program. The model is the CPU.

**Beat 3.** Two rows. "v3" (faint): "An agent reads prose" → "CLI checks".
Then "v4" (accent): "A state machine / code runs the loop" → "Agents / write"
and → "Jev / answers yes/no", arrows in the accent.

> Flip it: code drives the loop, and calls the model.

**Beat 4.** `FlowDiagram` loop of four boxes with curved arrows, clockwise:
Msg ("something happened") → update ("a pure function", accent) → Model + Cmds
("new state, work as data") → runtime ("does the work") → back to Msg.

> It's built on tea, my brother's library: the Elm Architecture in TypeScript.
>
> The machine never does anything. It only decides.

**Beat 5.** `CodeCard` titled "the first update · commit 6e9a510": the
`start` and `build_ok` handlers from post 1, with the `build(...)` and
`check({})` lines highlighted.

> First commit, 28 minutes in: a whole lane, 8 tests, no model, no network.

**Beat 6.** Three cards: "The machine / owns the loop and the facts" (accent),
"Agents / own the writing", "Jev / owns narrow yes/no calls".

> The machine owns the loop. Agents write. Jev answers narrow yes/no calls.

**Beat 7.** A timeline: "turn 1" at 03:41:57, "SIGINT" (accent) at +5 s,
"turn 2" at 03:42:05. With the second caption, a pill above: `state.json:
phase "building", same conversation id`.

> Experiment 23 killed a real build 5 seconds in.
>
> Run again, it picked up the same conversation. The machine knew where it was.

**Takeaway:** Put the loop in code. Keep the model for the *open-ended* parts.

---

## Ch02 · Meeting Jev · 60 s

**Beat 1.** `BarChart`, max 1.0: four bars 0.69, 0.79, 0.64, 0.77, labelled
"ask 1" to "ask 4". A dashed vertical floor line at 0.8, labelled "floor 0.8"
(the one accent). Every bar stops short of it.

> 0.69, 0.79, 0.64, 0.77. One question, asked four times. All under the floor of 0.8.

**Beat 2.** `FlowDiagram`: "state (JSON)" and "a question with your answers"
→ "Jev" (accent) → "one answer + confidence". With the second caption, a small
price tag fades in under Jev: "$0.042 per million tokens".

> Jev is a small classifier. You give it JSON and a multiple-choice question.
>
> It picks one of your answers and says how sure it is.

**Beat 3.** Three cards appear one by one, the three kinds of bad input: "A
rule that fights the code", "A rule about what stayed the same", "A ticket too
thin to say what done is". The first two light up as the second caption
names them.

> It wasn't noise. Every time we looked, the question was bad.
>
> A rule that fought the code. A rule about what stayed the same.

**Beat 4.** `BarChart` as runs finishing, two pairs: slugify before 0 of 3,
after 5 of 5 (accent); duration-open before 0 of 5, after 8 of 10. Show as
percent bars with the "x of y" text printed.

> So fix the question, don't ask again. Slugify went from 0 of 3 runs finishing to 5 of 5.

**Beat 5.** `BarChart` "right, by confidence" (87 cases, 261 answers): "0.8
and up" 218 of 221 (accent), "0.7 to 0.8" 11 of 12, "under 0.7" about half.
With the second caption, swap to "right, by what it was shown": "a passing
test" 117 of 117 (accent), "no test, correct code" 95%, "no test, broken code"
about half.

> Then we counted. At 0.8 and up, the judge was right 218 times out of 221.
>
> With a passing test in front of it: 117 of 117. Without one, on broken code: about half.

**Beat 6.** A tray metaphor: a row of bins ("met", "not met") and a tray
marked "unsure" (accent) where low answers drop. Under it, the router's
result as `BarChart`: right 30 of 36, unsure 6, wrong 0.

> Unsure is not an error. It goes somewhere, and code decides where, by what a mistake costs.

**Takeaway:** When a small model is *unsure*, check the question before the model.

---

## Ch03 · A judge that cannot add · 60 s

**Beat 1.** Two cards side by side: `parseDuration("1.5h") → 5400` and
`parseDuration("1.5h") → 4500`. Under each a `Counter` ticks to its
confidence: 0.90, then 0.89. The 4500 card gets a faint "wrong" mark once both
numbers land; the numbers stay level with each other.

> An hour and a half is 5,400 seconds. Jev said yes to 5400, at 0.90.
>
> Then we showed it 4500. Jev said yes again, at 0.89.

**Beat 2.** `CounterRow`: "200 of 200" right at 0.9 and up (from 54
hand-built tests, 324 answers), then "41%" of good tests unsure at 0.8
(accent).

> On 54 hand-built tests, Jev at 0.9 was right 200 of 200 times.
>
> But 41% of the good tests came back unsure.

**Beat 3.** Four rows, the same background line shown under different JSON
keys, as `BarChart` with ranges printed: `issue`, short line 0.92 to 0.94;
`issue`, long line 0.67 to 0.84; `goal`, long line 0.30 to 0.36 (accent);
`about`, long line 0.85 to 0.90. Bar length at the midpoint of each range.

> Same words, different key. Under `issue`: 0.67 to 0.84. Under `goal`: 0.30 to 0.36.

**Beat 4.** One box "Is this test good?" splits into three yes/no boxes:
`same_input`, `same_result`, `exact_check`. Then `BarChart` "good tests
accepted": broad question 53 of 88, three narrow questions 87 of 88 (accent).

> Split one broad question into three small yes/no ones.
>
> Good tests accepted went from 53 of 88 to 87 of 88. Same model, same tests.

**Beat 5.** Two of the three boxes (`same_input`, `same_result`) turn into
"string match" chips; `Counter` "152 of 156" agreement.

> Two of the three were string matching. Code agreed with Jev on 152 of 156.

**Beat 6.** `BarChart` pairs for "does this example show the rule?": at cut
0.5, good accepted 30 of 35 and bad accepted 47 of 216; at cut 0.9, good
accepted 7 of 35 and bad accepted 1 of 216. Then the proofreader picture: an
invoice whose total is off by 900, passed.

> No cut works. At 0.5, 47 bad examples get in. At 0.9, most good ones don't.
>
> Jev reads. It doesn't add. Keep the arithmetic in code.

**Takeaway:** Code works out the facts. *Jev reads them.*

---

## Ch04 · The agents had a shell · 55 s

**Beat 1.** `CodeCard` lang `sh`, one line: `git show HEAD:slugify.test.js`.
Beside it, a faded prompt card: "You cannot run commands."

> The prompt said you cannot run commands. The agents ran this anyway.

**Beat 2.** Two flags side by side: `--allowedTools` "pre-approves" and
`--tools` "takes away" (accent). Then `BarChart` "sessions that looked at git
or the tests": test-writer 46 of 63 (accent), triage 50 of 73, builder 1 of 40.

> `--allowedTools` only pre-approves tools. It doesn't take the shell away.
>
> The test-writer looked at git or the tests in 46 of 63 sessions.

**Beat 3.** `CodeCard` ts: the `"--tools", ...ask.tools, "--allowedTools",
...ask.tools` lines with their comment, from commit `46bd5a4`. A chip: "6
experiments rerun".

> The fix: `--tools`, which names the only tools an agent has. Six experiments were rerun.

**Beat 4.** The exam picture: a "practice" card (visible tests, one per rule)
and an "exam" card (hidden tests, three more per rule, never shown to the
builder). Then `CounterRow`: 36 of 36 cheats passed the visible tests, 27
caught by the hidden tests (accent), 0 of 90 hidden tests wrong on correct
code.

> Practice questions and an exam. Hidden tests catch code that only learned the examples.
>
> All 36 hand-written cheats passed the visible tests. The hidden tests caught 27.

**Beat 5.** `FlowDiagram`: hidden test fails → test output "expected 5400"
(accent) → builder. A dashed arrow labelled "the answer key".

> The second leak: a failing hidden test prints what it expected. The answer key, with the grade.

**Beat 6.** A log page: old lines stay, a "Correction: the agents had a
shell" section slides in between them, with before and after side by side
(48 of 48 → 48 of 48; 24 of 33 → 27 of 36).

> We kept the wrong lines in the log, and added the correction next to them.

**Takeaway:** A prompt is not a fence. Check what the agent *did*, in its session log.

---

## Ch05 · Tests decide, not models · 55 s

**Beat 1.** `CounterRow`: "117 of 117" with a passing test (accent), "about
half" with no test on broken code.

> With a passing test in front of it, the judge was right 117 of 117 times.
>
> So write the tests first, and let them say when the work is done.

**Beat 2.** `CodeCard` ts: an example `{ call: 'slugify("A b")', result:
'"a-b"' }`, then an arrow down to the generated line
`assert.deepStrictEqual(slugify("A b"), "a-b")` (highlighted).

> Triage writes each rule with an example: a call and its exact result.
>
> Code turns each example into a test. No agent writes it, no judge checks it.

**Beat 3.** `Counter` 36 of 130, then a `BarChart` of the seven demlik
issues by fit: #516 18 of 32, #576 11 of 22, #565 7 of 22, and #568, #567,
#529, #569 at 0. A chip: `unchecked` (accent).

> On seven real issues, only 36 of 130 criteria fit a call and a result.
>
> The rest park as `unchecked`, with a reason. Not a quiet pass.

**Beat 4.** Two cashiers counting the same till: triage's example vs a
throwaway reference built from the rules. `BarChart` "wrong examples caught":
throwaway reference 20 of 20 (accent), builder's `contradiction` 19 of 20.
False alarms: 0.

> A throwaway build from the rules alone caught 20 of 20 planted wrong examples.

**Beat 5.** The duration ticket: triage wrote 3 rules; the toy's hidden tests
hold 8. The 6 that nobody wrote down fade in faint, one by one: seconds,
spaces, upper case, decimals, a bare number, the order of units.

> The limit: a test only checks a rule somebody wrote down. The ticket is the ceiling.

**Takeaway:** Settle "is it right" by *running code*. Spend your effort on the ticket.

---

## Ch06 · Rebuilding fabrika one step at a time · 60 s

**Beat 1.** Two finish lines as progress bars: "code-driven loop, proven"
nearly full; "fabrika, rebuilt" a quarter full (accent).

> New ideas, or rebuilding fabrika? As a rebuild, we were about a quarter done.

**Beat 2.** The review map, one row per part and who decides it: each
criterion is met (code), no edits to locked tests (code), no changes outside
the ticket (code), extra changes listed (code and the router), tests green on
the real commit (code), extra problems (an agent), stale docs (an agent),
owner comments (Jev reads, a person rules). Rows not built yet are faint.

> So we drew a map: one row per thing fabrika's review checks, and who decides it.

**Beat 3.** `FlowDiagram`: reviewer agent "finds" → code "checks the quote" →
router "sorts" → machine "pass or fail" (accent), with a branch to "a person"
for what the router is unsure of.

> Review became its own machine. The agent only finds. Code checks every quote is real.
>
> A router sorts each finding. The machine says pass or fail.

**Beat 4.** `BarChart` for the matcher, 12 findings asked 3 times: right 28
of 36, missed a repeat 8, wrong match 0 (accent).

> A fresh reviewer forgets what a person decided. A matcher catches the repeats.
>
> 28 of 36 right, 0 wrong matches. Every miss fell on the safe side.

**Beat 5.** Three review rounds as cards; round 3 gets a lock (accent): "new
findings filed, not blocking".

> A reviewer always finds one more thing. So the list freezes on the last round.

**Beat 6.** `CodeCard` ts: `readonly approve: { readonly kind: "approve";
readonly head: string } | Drop;` with its comment line.

> Ship waits for a person to approve one named commit. An agent never gives it.

**Beat 7.** The six fabrika steps again (`FlowDiagram` row): triage, build,
review, ship marked "proven"; report "by hand"; plan `muted`, "not built".

> Four of six steps proven, on two toys. None has run on a real issue yet.

**Takeaway:** Copy which steps exist. Decide how each works *on its merits*.

---

## Ch07 · Cheap enough to read everything · 55 s

**Beat 1.** A grid of 1,511 small dots (the package's files). Two dots light
up in the accent and rise to the top, labelled "1st" and "2nd".

> A real ticket. Its fix changed 2 files. The package has 1,511.
>
> Jev read every file whole. The 2 changed files came out first and second.

**Beat 2.** `Counter`: about 1,000 questions, and a clock: 11 s.

> About a thousand file questions in 11 seconds.
>
> A narrow question about a whole file is still a narrow question.

**Beat 3.** `CounterRow`: failure triage "42 of 42" right (accent); docs
check "0 of 66" false claims passed.

> Whose fault is a red run? 42 of 42 right. Does the doc say X? 0 false claims passed.

**Beat 4.** `BarChart` "hidden file found, whole packages (268 to 1,591
files)": ranked 1st 22 of 28 (accent), in top 5 26 of 28, in top 10 27 of 28.
Then a faint knock-on example: `port.ts` ranked 15th of 268.

> Hide one file a real fix changed. Over whole packages, Jev ranked it first 22 of 28 times.
>
> It misses knock-on edits. Reading isn't tracing. A typechecker does that part.

**Beat 5.** Four floors on one ruler from 0 to 1: missing file 0.5,
duplicate 0.7, failure and shell 0.8, docs 0.9. Under each, what a wrong
answer costs there: "one look", "one look", "a person's time", "a false claim
passes".

> Every floor is set by what a mistake costs there: 0.5, 0.7, 0.8, 0.9.

**Takeaway:** Ask what you'd want read *if reading were free*.

---

## Ch08 · The twenty dollar lesson · 40 s

**Beat 1.** Two receipts side by side: 36,171 calls → about $20 (accent);
35,374 calls → a dollar or two.

> 36,171 calls cost about $20. Later, 35,374 calls cost a dollar or two.

**Beat 2.** `CodeCard` lang `text`: `Error: Jev answered 402`, then a retry
ladder: 1 s, 2 s, 4 s, 8 s, give up.

> 402 means payment required. The helper retried it anyway, five times per call.

**Beat 3.** The sum, typed out one line at a time: "estimate: $0.60" struck
out; "36,171 × 13,000 tokens ≈ 470 million"; "470 million × $0.042 per million
≈ $20" (accent). Under it: real bill $21.31 for 508 million tokens.

> The estimate said $0.60. Jev bills by the token, and each call carried a whole file.
>
> 36,171 calls × 13,000 tokens × $0.042 per million ≈ $20.

**Beat 4.** `CodeCard` ts: the `DOLLARS_PER_TOKEN` and `MAX_DOLLARS` lines
from `experiments/jev.ts`.

> Now the helper stops at 5,000 calls or $5, and prints a receipt.

**Beat 5.** The four rules as a list: estimate before you run, sample before
you scale, send the least text, put the budget in the helper.

> Estimate first. Sample before you scale. Send the least text.

**Takeaway:** Price the *input*, not the call.

---

## Ch09 · Working with the agent, not through it · 45 s

**Beat 1.** A row of six compaction marks along an 11-hour line (1:49 p.m. to
12:53 a.m.). Under each, a note card stays put.

> Six times in eleven hours, the agent forgot most of what we'd said.
>
> It came back working the same way, because every habit was written down.

**Beat 2.** A recommendation card: "Recommend X · 75%". Then the 25% splits
off as "the doubts". With the second caption a `Counter` falls from 75% to
about 40% (accent).

> Every recommendation came with a confidence number. The useful part was the other 25%.
>
> Once it went down: 75% to about 40%, after one experiment. That stopped a build on a hole.

**Beat 3.** `CounterRow`: 9 subagents in the eleven hours before, 6 in the
hour after (accent). A main thread line keeps three chips: decide, ask one
question, report.

> Heavy reading went to subagents. The main thread kept the decisions.

**Beat 4.** `FlowDiagram`: builder, test-writer, reviewer, person; arrows show
nobody checks their own work. The person's box (accent) approves one commit.

> Nobody grades their own exam. Not the builder, and not the agent posting for you.

**Takeaway:** Notes are where a rule starts. The ones that matter *end up in code*.

---

## Ch10 · Knobs in a file, systems with SDKs · 50 s

**Beat 1.** `CodeCard` lang `toml` titled `fabrika.toml`, these lines:
`[lane]` `attempts = 3`, `[failure]` `floor = 0.8` and `on_unsure =
"rebuild"`, `[review]` `missing_floor = 0.5` and `match_floor = 0.9`, with
their comments. `floor = 0.8` highlighted.

> Once the loop is code, "sure enough" is a number. Numbers can live in a file.

**Beat 2.** Three cards, one by one: "empty file → changes nothing", "`flor =
0.9` → refused", "`floor = 1.5` → names `failure.floor`" (accent).

> An empty file changes nothing. A typo fails the load. A bad value names its key.

**Beat 3.** A recipe card: quantities on the left (fine in config), steps on
the right (stay in code). A line "if sticky, go back to step 3" gets struck
out.

> Config holds numbers. The order of the steps stays in code, where it has tests.

**Beat 4.** `FlowDiagram`: `fabrika.toml` → "filed" → the run's own state
(accent, "attempts = 1"). A kill mark, a restart with settings "attempts = 3",
and the run still parks after 1 try.

> Each run copies its knobs when it's filed. A restart replays by the rules it began with.

**Beat 5.** `CodeCard` lang `text`, two approval-record lines from
`missingLine` in post 10: `missing-file check: ran, asked 911 file(s), 1
flagged` (the #9611 run in post 7) and `missing-file check: SKIPPED, the
reader failed`, with the second highlighted.

> A check that was skipped says SKIPPED, in capitals, where the approver reads.

**Beat 6.** Two columns. v3 (faint): "prose inside an agent harness". v4
(accent): machines, services, a classifier, a tracker, a repo, each a box,
composed in code.

> v3 lives inside an agent harness. v4 is systems with SDKs, composed in code.

**Takeaway:** A knob is a number. Anything that *decides what happens next* belongs in code.

---

## Outro · 20 s (built)

**Beat 1 · 11 s.** A numbered list of five lessons, one after another: a
small classifier is great at reading, useless at arithmetic; an unsure answer
usually means the question was bad; agents see what their tools let them see,
not what the prompt says; tests decide better than any judge; a bill is a fine
teacher, if you let it be one.

> Two days and 37 experiments later, this is what stuck.
>
> And the state lives in one place. Kill it, and it starts again.

**Beat 2 · 9 s.** `TitleCard`: kicker "the machine owns the loop", title
"Fabrika was v3. This is the start of *v4*.", subtitle
"github.com/usirin/tea-fabrika · the posts live in blog/".

> Still a repro on two toy tickets. The real repo is next.
