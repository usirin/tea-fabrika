# Knobs in a file, systems with SDKs

> Draft, still being written.

At 00:54 on October 5, with a probe dead on a 402 and nothing to do but wait,
I typed this:

> if we can switch to this type of coding driven workflow instead of harness driven one, we can actually drive way more things via config itself.

Forty-six minutes later the pipeline read its numbers from a file, each run
kept its own copy of them, and a check that had been skipped said so in
capitals on the record a person signs. Four commits, all before 1:41 a.m. This
last post is about those four commits, and about why they're where the series
lands. They're small, and they're the first part of tea-fabrika that looks
less like an experiment and more like something you'd build on.

## Rules in a prompt aren't knobs

Think about where a number like "0.8" lives in fabrika, my v3. It lives in a
sentence. A skill says something like "act only when the judge is sure", and
an agent reads that and decides what sure means today. If I want phoenix to be
stricter than demlik, I don't change a number. I write another sentence and
hope both agents read it the same way.

Once the loop is code, that number is a constant in a file. And a constant in
a file can move to a different file, one a person edits without touching the
code. That's all my message meant. The agent's reply listed what could move:
the floors, whether "unsure" parks or goes back to the builder, the try limit,
which model each step uses. Then it added a caveat, and it's the line from
those two days I repeat most:

> One caveat: the order of the steps should stay in code. Once config starts making if/else decisions, you've built a worse programming language.

It recommended one typed config file, checked when it loads, at 75%
confidence. Its doubt was honest: it didn't know yet which knobs actually
differ between repos, and nothing short of a real run on phoenix would show
that. I said yes. (The habit of asking for a number and the doubt behind it is
what [post 9](./09-working-with-the-agent.md) is about.)

## jsonc is not fun

The side agent building it started on JSON. Seven minutes after my first
message I sent another one:

> and i really wanna use toml config lol, jsonc is not fun

That's a taste call, and I'll own it. But there's a reason under the taste.
These knobs are flat groups of numbers with a sentence of explanation each.
TOML has real comments and sections, and no braces to balance. The parser,
[`smol-toml`](https://github.com/squirrelchat/smol-toml), is one small
dependency.

Here's a full `fabrika.toml`, every key the code accepts, each at its default:

```toml
# fabrika.toml

[jev]
model = "jev-latest"        # the Jev model every question goes to
retries = 3                 # how often a busy Jev is asked again before a reader gives up

[triage]
sort_floor = 0.8            # below this, triage doesn't take Jev's word on a sort

[lane]
attempts = 3                # builds per issue before a person is asked

[failure]
floor = 0.8                 # below this, the failure reading counts as unsure
on_unsure = "rebuild"       # "rebuild" = back to the builder, "park" = ask a person
output_chars = 20000        # how much of the END of a failed run Jev reads
diff_chars = 20000          # how much of the START of the diff Jev reads

[review]
route_floor = 0.8           # router: does an extra change serve the ticket?
match_floor = 0.9           # matcher: does a finding repeat one a person decided?
missing_floor = 0.5         # missing-file check: flag an untouched file at or above this
missing_max_files = 2000    # over this many candidate files, skip the check

[comments]
floor = 0.8                 # reader: does an owner's comment change or add a rule?
no_change_floor = 0.9       # "changes nothing" lets a comment pass, so it needs more
```

Every number in there came out of an experiment in this series. The 0.8 floors
are from the calibration in [post 2](./02-meeting-jev.md). `missing_floor =
0.5` is from experiment 36, where no file reached 0.5 on a change that was
complete (the highest was 0.48). `on_unsure = "rebuild"` is from experiment 35,
where parking on "unsure" would have stopped about one ordinary bug in six for
a person.

Three rules make the file safe to hand to someone.

**An empty file changes nothing.** Every key defaults to the value the code
held before the file existed. Every table can be left out. So turning config
on was a no-op, and I could check that with a test instead of trusting it.

**An unknown key is an error.** `flor = 0.9` under `[failure]` fails the load.
So does a table called `[falure]`. A config file that quietly ignores typos is
worse than no config file, because you think you changed something.

**A value out of range names the key.** `floor = 1.5` fails with
`failure.floor` in the message. `attempts = 0` fails, `attempts = 2.5` fails,
and `on_unsure = "ask"` fails, because "ask" isn't one of the two paths the
code has.

All of that is one zod schema in `src/settings.ts`, about 60 lines of it. TOML
is parsed first, then the same schema checks every value:

```ts
lane: z.strictObject({
  attempts: count.default(3),
}).prefault({}),
failure: z.strictObject({
  floor: floor.default(0.8),
  on_unsure: z.enum(["rebuild", "park"]).default("rebuild"),
  output_chars: count.default(20_000),
  diff_chars: count.default(20_000),
}).prefault({}),
```

`strictObject` is the typo rule. `default` is the empty-file rule. `floor` is
a number between 0 and 1, and `count` is a whole number above zero. That's the
whole trick, and you can copy it into any agent pipeline that has a number in
a prompt.

## Data, not decisions

Look at what's in that file and what isn't. Floors. Limits. A model name. How
many characters of a log to read. And one key that looks like a decision,
`on_unsure`, which picks between `"rebuild"` and `"park"`.

That one is the edge, so it's worth a minute. Both paths already exist in
code, with tests. The lane can send a failed run back to the builder, and it
can stop for a person. The key picks which of two tested paths an unsure
reading takes. It doesn't describe a new path. You can't write
`on_unsure = "ask the reviewer, then rebuild twice"`, because the schema only
knows two words.

What isn't in the file is the order of the steps. There's no
`steps = ["triage", "build", "review", "ship"]`, no `when = "..."`, no list of
checks to run in some order. That stays in the machines, where it's a function
with tests around it.

Here's why I care, with a picture. A recipe has quantities and it has steps.
You can change the quantities freely: more salt, a hotter oven, ten minutes
longer. Nobody calls that a new recipe. But the moment the card says "if the
dough is sticky, go back to step 3, unless it's Tuesday", it isn't a recipe
card anymore. It's a program, written in a language with no tests, no types
and no debugger. That's the worse programming language the agent warned about,
and a config file gets there one reasonable key at a time.

So the rule I'd give anyone is short. A knob is a number, a name, or a pick
between paths the code already has and tests. Anything that decides what
happens next belongs in code.

## Copied in when it's filed

The first commit, `53f6c19` at 01:04, moved only the knobs the Jev readers
use: the floors for the router, the matcher, the comment reader and the
failure reader, how much of a log and a diff it reads, retries and the model.
Each reader reads its keys once,
when it's built. 128 tests passed.

Three knobs stayed in code on purpose: the try limit, triage's sort floor, and
the unsure rule. The agent explained why in its report. Those three are read
inside the machines, and the machines are pure. A tea machine is a function
from a state and a message to a new state. It can be killed at any step and
started again from what it saved, and replaying the same messages gives the
same state. That's the property the whole series leans on.

If the lane read `attempts` from a file, the file would become an input nobody
saved. Kill a lane on its second try, raise `attempts` from 3 to 5 in the
meantime, start it again, and the lane now runs by different rules than the
ones it started with. Replay its saved messages a week later and you might get
a different answer, because the file changed again.

So the second commit, `15502d8` at 01:14, did it the other way. When an issue
is filed, the host reads the settings once and sends the values in with the
`file` message. From then on the run carries its own copy:

```ts
/** The settings a run copies into its own state when it is filed. */
export const knobsOf = (settings: SettingsShape): Knobs => ({
  triage: { sortFloor: settings.triage.sort_floor },
  lane: { attempts: settings.lane.attempts, onUnsure: settings.failure.on_unsure },
});
```

Triage keeps its copy in every phase after idle. The type says so: each of
those phases is built on `Knobbed`, a `{ knobs: TriageKnobs }`, so a triage
state without its floor doesn't typecheck. The factory holds the lane's copy
next to the builder's conversation id, in one field, so the two are set
together or not at all. The lane gets it in its `start` message and keeps it.
None of the machines ever reads `Settings`.

Think of a board game where the table agrees on house rules before the first
roll. Someone can print new house rules halfway through. The game on the
table keeps the ones it started with. The next game gets the new ones.

There's a test for exactly that, and it's my favourite in the file. It starts
a lane with `attempts = 1`, kills it after the tests were written, and boots
it again in a world where the settings allow three tries. The restarted lane
parks out of attempts after one try, the same state the uninterrupted run
ended in. Its name says the rule: "keeps the knobs it started with, whatever
the settings say on boot". The agent also ran the scripted demo with a file
setting `attempts = 1`, and it parked after the first failed try. 140 tests
passed.

The Jev readers' floors aren't copied in. The machine doesn't make any
decision with them, it only gets the reader's answer, and the answer is saved.
I think that's the right line, with one cost I should say out loud: a question
asked again after a restart reads whatever the file says then.

## Old runs keep the rules they ran by

A run saved before `15502d8` has no knobs in it. Reading one back, the code
could fill in today's defaults. It doesn't, and the reason is small and I like
it a lot.

```ts
/**
 * The knobs every run had before they moved to `fabrika.toml`: the constants
 * the code held then. A state saved before that ran by exactly these, so
 * filling them in is what happened, not a guess. Written out rather than taken
 * from `DEFAULT_SETTINGS`, whose values may change.
 */
export const BEFORE_SETTINGS: Knobs = {
  triage: { sortFloor: 0.8 },
  lane: { attempts: 3, onUnsure: "rebuild" },
};
```

Today the defaults and `BEFORE_SETTINGS` hold the same numbers, and a test
checks that. But the defaults are allowed to move. If someone changes the
default try limit to 5 next month, an old run should still say it had 3,
because it did. A saved state is a record of what happened, and filling in a
gap with today's value would quietly rewrite history.

`parseFactory` knows exactly one older shape. A factory with a `builder` field
and no knobs gets `BEFORE_SETTINGS`. An idle part gets nothing, since it never
ran. Any shape it doesn't know is refused, not guessed at.

## Skipped says skipped

The same idea came back twenty-six minutes later, in a place I didn't expect.

The missing-file check from [post 7](./07-cheap-enough-to-read-everything.md)
went into review at 01:26 (`0f5fefb`). It added the two `[review]` keys, and
one of them is a new way to not run: over `missing_max_files` candidate files,
the check is skipped, because each file is one Jev call. The other way is a
reader that fails. Neither one parks the lane. Review's result records
`too_many` or `unread`.

The side agent that built it listed a doubt at the end of its report: the lane
dropped review's result before ship. So a skipped check showed up in the log
and the demo output, but not in the record a person reads before approving the
change. A skipped check and a clean one looked the same on the one page that
mattered.

That's false comfort, and it's the same mistake as filling an old run with
today's defaults. The fix, `b052c04` at 01:40, carries the check's outcome
through the lane and into ship as typed data, five kinds of it:

```ts
/** The approval record's line for the check. A skip says so in capitals: it is easy to read past. */
export function missingLine(m: MissingOnRecord): string {
  switch (m.kind) {
    case "checked":
      return `missing-file check: ran, asked ${m.asked} file(s), ${m.flagged.length} flagged`;
    case "too_many":
      return `missing-file check: SKIPPED, ${m.candidates} files to ask is over the cap of ${m.cap}`;
    case "unread":
      return "missing-file check: SKIPPED, the reader failed";
    case "no_change":
      return "missing-file check: not run, nothing was built";
    case "not_recorded":
      return "missing-file check: not recorded, the run was saved before the lane kept it";
  }
}
```

Look at the last case. A run saved before this commit can't say whether its
check ran or was skipped. The easy default would be "ran". The agent's report
said why it isn't: claiming it ran "would be exactly the false comfort we're
fixing". So an old run loads as `not_recorded`, and its approval record gets
that line too.

Here's the lesson I took for config in general. A knob that can switch
something off, or cap it, is a knob that can make a check quietly not happen.
Every one of those needs a line on the record a person reads, in words that
are hard to skim past.
