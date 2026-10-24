# 51. Does Jev pick what Opus picked?

Jev is small, cheap and fast. Nobody here expects it to out-think Opus. The
hope is narrower: on a small question with fixed choices, Jev gives the answer
Opus would give, for a fraction of the price. So this experiment does not
score Jev against a right answer. It scores Jev against Opus.

The questions come from section 48. It counted what 13 operator agents decided
in a day and found 9 choices that fit a narrow Jev question. Nine is too few,
so I went back to the transcripts of 25 operator runs and the logs of the two
machine runs, and pulled 66 real moments of the same kinds.

**Answer: at 0.8 and up, Jev gave Opus's answer every time, 48 of 48.** Under
0.8 it matched 21 of 30, and 7 of those 9 misses leaned the careless way. One
Jev answer cost $0.000023 and took 96 ms. One Opus answer on the same text
cost $0.0052 and took about a second.

Against what the operator agent really did, the number is much lower: 35 of
57. Most of that gap is not Jev. Opus, given the same small text, matched the
operator only 41 of 57 times, and 15 of Jev's 22 misses are the very answer
Opus gave. The operator knew things the small text does not say, and it was
not always consistent, or right.

## The cases

`51-cases.json` holds 78 cases. Each has a small text, a question, fixed
choices, and what the driver did next. 66 are real: the text is copied from an
agent's report, a tool's output or an issue, with local paths and names
scrubbed. 12 are written by me and marked `written`. They are scored apart
and never mixed into a real number.

Of the 66 real ones, an operator agent on Opus made the choice in 57. The
machine made it in 8 (code, no model). A builder made it in 1.

| Type | The text | The choices | Real | Written |
|---|---|---|---|---|
| `next` | The first 600 characters of a shell's last message | go on, repair, wait, person, start again | 26 (6 machine) | 3 |
| `flag` | One thing a shell flagged beside its result | nothing, write a note, a person must settle it | 15 | 3 |
| `ruling` | One ask of a decision ticket, and the owner's comment | decides it, leaves it open | 7 (1 builder) | 2 |
| `same_defect` | A defect the operator just hit, and a filed issue's title | same, different | 11 | 2 |
| `gate` | What a tool printed about a PR before review | review, wait, repair | 7 (2 machine) | 2 |

The text is small on purpose. The median case is 563 characters and the
largest is 861. A `gate` case is two lines of tool output, about 170
characters.

I did not pick the easy ones. In the set: the one stop of the day that needed
a person, the ruling an operator recorded as complete when it was not, a
review that passed and was held for an approval anyway, three builders the
machine recorded dead, and four readings of "checks still running" where
three operators started the reviewer and one waited.

Three choices of mine shape the cases, and a reader should know them. The
600 character cut is a rule, not a judgement, and it cost one case its answer
(below). The `flag` paragraphs I picked by hand out of longer reports. And a
`different` label in `same_defect` means only that the operator read a list
of titles and picked another one.

## Against Opus on the same text

Each case went to Jev through the real Judge (`createJudge`, floor 0.8) and
to Opus through `claude -p --model opus --tools ""`, with a one-line system
prompt and no settings of the machine's own. Both got the same instructions,
the same texts and the same choices. Each side answered three times. A case's
answer is the choice it gave at least twice, and Jev's confidence is the
middle one of the three.

| Type | Real cases | Jev at 0.8 and up | Jev gave Opus's answer | Of those at 0.8 and up |
|---|---|---|---|---|
| `next` | 26 | 18 | 26 | 18 of 18 |
| `flag` | 15 | 1 | 11 | 1 of 1 |
| `ruling` | 7 | 6 | 6 | 6 of 6 |
| `same_defect` | 11 | 6 | 8 | 6 of 6 |
| `gate` | 7 | 7 | 7 | 7 of 7 |
| All | 66 | 38 | 58 | 38 of 38 |

The written cases say the same: 11 of 12, and 10 of 10 at 0.8 and up.

By confidence, over all 78: at 0.9 and up 35 of 35, from 0.8 to 0.9 13 of
13, from 0.7 to 0.8 9 of 11, under 0.7 12 of 19. That is the earlier
finding again. The floor at 0.8 is where Jev stops being Opus.

Both sides were steady. Jev gave one choice all three times in 76 of 78
cases, and the two that flipped had confidence under 0.3. Opus gave one
choice all three times in 75 of 78.

`flag` is the type Jev cannot carry. It cleared the floor once in 15. The
question asks for a judgement of weight, "is this worth writing down", and
Jev's answer to that is nearly always "write a note", at 0.3 to 0.8.

## Against what the operator did

This is the harder comparison, and the less fair one. The operator had the
whole conversation, its brief and the lane. Jev had 563 characters.

| Type | Operator cases | Jev did what the operator did | Opus on the small text did |
|---|---|---|---|
| `next` | 20 | 17 | 17 |
| `flag` | 15 | 5 | 7 |
| `ruling` | 6 | 3 | 4 |
| `same_defect` | 11 | 8 | 11 |
| `gate` | 5 | 2 | 2 |
| All | 57 | 35 | 41 |

At 0.8 and up Jev matched the operator 23 of 31 times. Under it, 12 of 26.

Jev missed the operator 22 times. In 15 of them Opus on the same text gave
the same answer as Jev. So those 15 are about the input, or about the
operator, and not about the small model. The 7 that are Jev's alone were all
under the floor: three `flag` cases, one `ruling` and three `same_defect`.

Put plainly: every time Jev was sure and still disagreed with the operator,
Opus reading the same text disagreed with the operator too.

## The misses, and which way they lean

A wrong answer can lean two ways. It can be more careful than the right one
(it asks a person, it waits, it writes a note nobody needed). Or it can be
less careful (it skips a person, or moves the ticket on when the driver held
it back). The second kind is the one that hurts.

Against the operator, 8 of Jev's 22 misses lean the careless way: 4 skip a
person and 4 move on. 14 are the harmless kind. These are the 8 where Jev was
at 0.8 or above, which are the ones a machine would act on.

| Case | The operator | Jev (confidence) | Leans | What happened |
|---|---|---|---|---|
| `next-04` | held it for a person | go on (0.82) | skips a person | A review passed. The operator's brief said this repo merges only after a visible approval. The report does not say that |
| `ruling-03` | left the ask open | decides (1.00) | skips a person | The first ruling on #612 gives the bump per tier and never mentions a callout. Jev and Opus both read "the same tier policy as a break, one step lighter" as an answer. The builder said that reading was a guess, and the operator asked the owner |
| `next-12` | waited | go on (0.90) | moves on | The shipper's message ends "still queued". My 600 character cut dropped that line |
| `next-05` | sent it to repair | person (0.94) | asks a person | The shipper stopped for an approval. The operator knew from its brief that a review had failed since |
| `ruling-01` | recorded the ruling | open (0.82) | asks a person | The operator was wrong here. A builder stopped on the gap twenty minutes later |
| `gate-02`, `-03`, `-04` | started the reviewer | wait (0.94 to 1.00) | more care | Checks were still running. The skill says wait. One other operator did wait |

So at the floor, two answers would have skipped a person. Both are Opus's
answers too. One of them (`next-04`) needs a fact that was never in the
text. The other (`ruling-03`) is the real warning in this run: a ruling that
almost answers a question reads as an answer, to both models, at full
confidence.

Under the floor Jev's misses against Opus are 9, and they lean the same way
the earlier research found. Four skip a person, three fold a new defect into
an old issue, two are harmless. The floor caught all nine.

The machine's own cases point the other way. Three builders ended their last message waiting on CI. The machine recorded
each one dead and started another, and section 50 priced that at $1.94. Jev read all three as
`wait`, at 1.00. So did Opus. And where the machine started a reviewer on a
PR whose required check was red, both said `repair`.

## Cost and time

| | Jev | Opus on the same text |
|---|---|---|
| Answers | 234 | 234 |
| One answer, dollars | $0.000023 | $0.0052 |
| One answer, time | 96 ms | 972 ms in the API, 5.1 s with the CLI's start |
| Input for one answer | about 554 tokens | about 967 tokens |
| The whole run | $0.005 | $1.22 |

How each was measured. Jev's reply names the input tokens it billed. I
multiplied them by the published $0.042 per million. It is not an invoice.
Opus's dollars are the `total_cost_usd` that `claude -p` reports for each
turn, at API prices, and the time is the CLI's own `duration_api_ms`. Both
times are medians.

That is about 220 times cheaper and 10 times faster. It is also less than it
sounds. An Opus answer on a text this small is already half a cent. What an
operator agent costs is not the choosing. It is the 100,000 tokens it holds
while it chooses (section 48), and no number here measures that.

Everything this experiment spent, with the first five cases and one test
call, is about $1.34.

## What I changed along the way

Nothing after seeing answers. Each question was written once and asked as
written. Before the first call I made one ask self-contained: the ticket's
third ask ends "a sentence saying so", and I added what "so" is. The first
five cases ran alone, the answers looked sane, and the same five were run
again with the rest.

Later, on 2026-10-24: in `51-cases.json`, one product name inside a quoted
tool message was replaced with `‹product›`, to keep it out of this public
repo. Nothing else changed, and no answer depended on it.

## What this does not show

- **That Jev is right.** It shows Jev agrees with Opus. On `ruling-03` they
  agree and a person had to step in.
- **A rate.** 66 real moments from one repo, 25 operator runs and one week.
  A type has 7 to 26 cases. "48 of 48" means no miss was seen. It does not
  mean a miss is rare.
- **That the labels are clean.** I read what each operator did from its
  transcript, alone, with no second reader. The operators were not
  consistent with each other (`gate`) and one was wrong (`ruling-01`).
- **Anything about code.** Every text is prose: a report, a tool's sentence,
  an issue. The earlier research found Jev reads prose much better than code.
- **Jev inside the machine.** Nothing here ran in a lane. What a sure wrong
  answer would cost a real ticket is not measured.
- **The right text to send.** The 600 character cut lost one answer. Sending
  the last lines too, or the whole message, is untested.
- **Opus at its best.** One short turn, no tools, the CLI's default effort.
  A different prompt or more thinking may answer differently.
- **Rare flips.** Three answers a case is enough to see a steady answer, not
  to see one that changes one time in fifty.

## What I take from it

1. **Use the floor as the line.** At 0.8 and up Jev can stand in for an Opus
   turn on these questions. Under it, the answer goes to Opus or to a person,
   not into the lane.
2. **`next` and `gate` are ready, and `gate` should stay code.** The tool's
   own words already say wait or repair. Jev agreeing with a rule is no
   reason to pay for a call.
3. **`ruling` needs a second look before it clears a park.** It cleared the
   floor 6 of 7 times and one of those was the wrong way. Ask it per ask, as
   here, and treat "decides" on a ticket's last open ask as a note for the
   person until there is more data.
4. **`flag` is not a Jev question as asked.** Split it, or leave it out. "A
   person must settle this" may work alone as a yes or no.
5. **The cheapest fix for the operator's gap is the brief.** `next-04` and
   `next-05` were lost on facts the operator had and the text did not. A
   machine that knows "this repo wants an approval" knows it in code.

Next would be the same cases with the whole last message and not its first
600 characters, and a second batch from lanes the machine drives, where the
typed last word is missing and Jev's reading would be the only one.
