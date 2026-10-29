# 167. Does the duplicate hint work on our own tracker?

The question: when a ticket is filed in this repo's tracker, can the shipped
code (a cheap word filter, then one Jev yes-or-no per candidate, then a
floor) say "maybe the same as #N" when it is, and stay quiet when it is not?

**Answer: yes, at the floor of 0.7. Of 25 true pairs, 24 got a hint, every
one ranked first. Of 1,613 pairs that are not the same work, 1 got a hint.
The whole run was 1,638 Jev calls for $0.05.**

```ts
// The whole experiment: the code that ships, on every ticket filed again in number order.
const pool = tickets.filter((c) => openAt(c, t.at));          // open when t was filed
const kept = candidatesOf(t, pool);                            // the cheap filter, at most 20
const yes = duplicateJudge.judge(model, {new: textOf(t), existing: textOf(c)}); // one call per kept c
hintsOf(scores, 0.7);                                          // at the floor, best first, at most 3
// Jev: jevFromConfig({calls: 3_000, usd: 1.5}), the live Layer, with its receipts.
```

| At 0.7 | Got a hint | Rate (95% interval) |
|---|---|---|
| True pairs: 1 real duplicate and 24 paraphrases | 24 of 25, each ranked first | 96% (80 to 99%) |
| Related pairs (a part, a sequel, a spec of) | 0 of 17 | 0% (0 to 18%) |
| Every other pair the filter kept | 1 of 1,613 | 0.06% (0.01 to 0.35%) |
| Real filings that showed a false hint | 1 of 77 | 1.3% (0.2 to 7%) |

- **The one real duplicate scored 0.78.** #64 "Ticket view: see each agent's
  state at a glance" against #6 "The ticket view shows what the agents do,
  and whether it is done". A floor of 0.8 would have missed it.
- **The one false alarm scored exactly 0.70**, on the same filing: #64
  against #61 "Tracker: Linear's model, every view a small program". #64 says
  "Lean: Linear's layout". A person would have seen #6 first (0.78) and #61
  second.
- **The one missed paraphrase scored 0.61.** "Hot reload for programs" against
  #67 "Programs update live while agents edit them (host reload)". The
  paraphrase is two lines; the original names a config file, a file watcher
  and module stamps. Jev could not tell whether the short one asked for all
  of that.
- **The filter lost nothing that mattered.** Every true pair's original was
  among the 20 it kept: 23 paraphrases ranked first, 1 third, and #6 second
  for #64.
- **No related pair came near.** The traces parts A to D of #46 scored 0.02 to
  0.18 against their parent; the highest related pair was 0.37 (#37 "The
  cloud is one more host" after #9 "The ledger moves to Cloudflare").

## Who did what

- This repo's code: the filter, the question, the ranking and the live Jev
  Layer, all from `packages/pipeline` as they ship
  (`tickets/duplicates.ts`, `jev-live.ts`). The script only builds pairs and
  counts.
- No agent ran in the measurement. An agent (this lane's) wrote the labels
  and the paraphrases by hand, before any call.
- The tickets were read once, read only, from the shared tracker, as the
  agent `reader`. Nothing was written to it, apart from this lane's progress
  comments on its own ticket.

## How it was done

1. **Read every ticket.** All 78 tracker tickets, with their bodies and when
   each was filed and closed, into a dump that stays on the laptop.
2. **Label by hand, first.** Read all 78 for real near-duplicates. Found one
   (#64 and #6). Wrote down 17 related pairs a person would not close: the
   four traces parts of #46 and their siblings, and sequels or specs such as
   #11 after #10, #40 after #38, #63 as the spec of #62. They are in the
   script, `DUPLICATES` and `RELATED`.
3. **Paraphrase.** One real duplicate is too few. So 24 open tickets got a
   re-filing in other words, as a person might file the same thing again
   weeks later: a new title, one to three lines (`PARAPHRASES`). Each was
   filed against today's 51 open tickets.
4. **File every ticket again.** In number order, each against the tickets
   open at its own filing time, through `candidatesOf`. The filter kept
   1,638 pairs: 1 duplicate, 17 related, 1,156 controls, 24 paraphrases and
   440 paraphrase controls.
5. **Estimate, then a handful, then the rest.** The plan said about 0.8M
   tokens, about $0.03. Then 5 paraphrases, 5 related and 10 controls, read
   by hand: the scores looked right (0.85 to 0.96, then 0.01 to 0.37, then
   0.01 to 0.03). Then the other 1,618.

| Run | Calls | Input tokens | Output tokens | Dollars |
|---|---|---|---|---|
| 5 paraphrases | 5 | 3,349 | 100 | $0.0001 |
| 5 related | 5 | 3,551 | 100 | $0.0002 |
| 10 controls | 10 | 6,978 | 200 | $0.0003 |
| the rest | 1,618 | 1,152,903 | 32,360 | $0.0498 |
| **all** | **1,638** | **1,166,781** | **32,760** | **$0.0504** |

The dollars are the live Layer's own receipts: the tokens each reply's
`usage` reported, at $0.042 a million. About 730 tokens a call, so a filing
with 20 candidates costs about $0.0006. Calls ran 8 at a time; none failed.

## What came back

At each floor, the pairs at or above it:

| Floor | Duplicate | Paraphrase | Related | Control | Paraphrase control |
|---|---|---|---|---|---|
| 0.5 | 1 of 1 | 24 of 24 | 0 of 17 | 2 of 1,156 | 2 of 440 |
| 0.6 | 1 of 1 | 24 of 24 | 0 of 17 | 1 of 1,156 | 1 of 440 |
| **0.7** | **1 of 1** | **23 of 24** | **0 of 17** | **1 of 1,156** | **0 of 440** |
| 0.8 | 0 of 1 | 23 of 24 | 0 of 17 | 0 of 1,156 | 0 of 440 |
| 0.9 | 0 of 1 | 18 of 24 | 0 of 17 | 0 of 1,156 | 0 of 440 |

The surest pairs that are not the same work, all below the floor but one:

```
0.70 control             #64 "Ticket view: see each agent's state at a glance" / #61 "Tracker: Linear's model, every view a small program"
0.61 paraphrase control  "Sandbox service for stage agents" / #51 "v1 slice 6c: The box on Cloudflare"
0.57 control             #60 "v1 slice 14: Two people" / #9 "The ledger moves to Cloudflare, so two people share tickets and jobs"
0.51 paraphrase control  "Stacked PRs in the push stage" / #76 "A ticket can be blocked by another ticket"
0.47 control             #20 "Typing: redraw only the row being typed" / #15 "Experiment 143: how fast a key reaches the screen"
```

Each is a close neighbour, not noise: the same subject, a different ask.
That is what the question's `false` criterion names ("even about the same
file, feature or subject"), and it holds below 0.7.

Every pair, its kind, its rank in the filter and its score are in
`results/167-duplicate-hint.json`, with titles only.

## What this means

- **Keep the floor at 0.7.** It is experiment 37's floor, and it holds here:
  at 0.7 the one real duplicate shows, at 0.8 it does not. The cost of 0.7 is
  one false hint in 77 filings, on a filing that also had the true one first.
  A hint is advice with a Dismiss button, so the bar is the advising one, not
  the blocking one: Google's Tricorder turns a check off when more than 10%
  of its results are marked "not useful"
  ([Sadowski et al., CACM 2018](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/);
  [Every finding is rated](../docs/direction/every-finding-is-rated.md)). 80% sure: one real duplicate is one data point; the floor
  rests mostly on the paraphrases.
- **The cheap filter can stay a word filter.** It kept every true pair's
  original in its 20, mostly first. 75% sure, because the paraphrases were
  written by the same hand that read the originals, and they share some
  words with them (see below).
- **Jev's job here is a new question, not a cheaper agent turn.** No agent
  checks for duplicates at filing today. So the measure is hand labels and
  controls, not agreement. Recorded in
  [Jev: the same answer, cheaper](../docs/direction/jev-same-answer-cheaper.md),
  under "Changed 2026-10-28".
- **Count the false alarms from now on.** Accept and dismiss are facts on the
  ticket (`duplicate_rated`), so the real rate on real filings can be read
  off the ledger. Look again after 50 hinted filings.

## What it cannot tell us

- **Real duplicates are rare here.** One in 78 tickets. The hit rate is
  mostly the paraphrases', and paraphrases written by one person, reading the
  original, are likely easier than a real second filing by someone who never
  saw the first. They share words with the original ("ghostty-web",
  "Stryker", "Cmd-K"), which helps both the filter and Jev. Experiment 37's
  30 real duplicates of another repo are the better hit rate for real
  filings: 26 of 30 ranked first.
- **Our tickets are written by a few agents in one style.** Many share words
  ("slice", "host", "ledger", "tile"). A tracker with many writers may give
  the filter more to sort, or less.
- **Open at filing time is a guess for 1 ticket in a few.** The dump has close
  facts with their times, but no reopen times; a ticket closed and reopened
  before another was filed would be counted wrong. None was seen.
- **The model can change under us.** `jev-latest` is a moving name. A wording
  change, or a new model, needs this run again: it is $0.05.
- **It does not say whether people want the hint.** Only accept and dismiss
  on real filings can.

## Run it

```sh
# The dump: every ticket, read only, as {number, state, title, body, at, notes: [{type, at, body}]}.
node experiments/167-duplicate-hint.ts plan <tickets.json>      # no key, no call: pairs and cost
TYPESAFE_API_KEY=... KIND=paraphrase node experiments/167-duplicate-hint.ts run <tickets.json> 5
TYPESAFE_API_KEY=... node experiments/167-duplicate-hint.ts run <tickets.json>   # the rest, about $0.05
node experiments/167-duplicate-hint.ts report                   # no key, no call: the tables
```

`run` asks only the pairs not yet in the results file, so a handful first and
the rest after spend once. It stops at 3,000 calls or $1.50 (the Layer's cap).
