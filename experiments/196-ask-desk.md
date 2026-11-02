# 196. How should fabrika show a person its asks, so most take one key, and learn from the answers?

Read 2026-11-02. **This is reading, not a measurement.** Nothing was built or run, and no model was
called. It reads ticket 117's real asks off the tracker, today's asks list and ask box on `main` at
`8742402f`, and about 18 outside sources. It feeds
[the ask desk](../docs/direction/ask-desk.md), a proposed note, and a private page, "Ask desk
guidelines", with a desk you can answer with the keys.

**Which version.** Every "today" claim is about today's version: `apps/fabrika`, `programs/tracker`
and `packages/pipeline`. `next/` has no asks list yet; it comes in Tier 5
([tiers](../docs/plan/tiers.md)). The note's shape is written for `next/` and offers small tryouts
in today's version.

**Decided before this study (the owner, 2026-11-02), not asked again:** asks to the owner are fine,
even many; the 10% to 30% call stands ([triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md),
about 105 to 190 asks a week); the owner makes every decision the system thinks needs them. What is
needed is a desk where most asks are one key in one sitting, and a desk that learns from the
answers so the system automates better over time. Folded in on the same day, from
[experiment 185](./185-dsh-superagent-study.md)'s "steal 1": attention is a counted cost, recorded
per merged ticket, and a design that asks a person says what it costs them a week. It is data the
desk records, not a budget that cuts asks.

## The answer

The makers agree on four things.

1. **One item, one decision, then the next.** Linear's triage is "a special inbox for your team"
   with one key per action [l1]; Superhuman says "Mark Done with E and keep triaging from the next
   conversation" [s1]; GitHub's `E` is "Mark as done" [g2]. The way out of an item is a decision or
   a snooze, never a dismiss.
2. **A suggestion is shown with its why, and taken with one press.** Linear's Triage Intelligence:
   "Accept, decline, or view more information about why a suggestion was made" [l3]. Superhuman's
   drafts are ready before you open the mail, and "you just hit Tab and then Enter" [s2].
3. **Autonomy is switched on per narrow kind, by a person, from a real example.** Gmail starts a
   rule from one message, "Filter messages like these" [g1]. Linear's suggestions "can be
   configured to auto-apply" per team and per property [l3]. Neither waits for measured agreement:
   both are a manual switch. The research side says pick a target error and act alone only where
   you are sure [a2], and the 2000 levels paper makes "high reliability" the test [a1].
4. **A shown suggestion is followed, even when wrong.** "Automation bias ... cannot be prevented by
   training or instructions" [a3]; "prominent incorrect advice is more likely to be followed" [a3];
   people click the top hit "simply because it's first" [n1]. So an agreement given with one key on
   a shown rec is weak evidence that a kind is safe to automate.

The fourth point is where the owner's lean needs a change. Agreement counted on asks where the rec
was shown measures the person's trust, not the rec. The note's fix: a share of asks hide the rec
until the person picks (a blind ask), and only blind asks earn autonomy. And "19 of 20" is too few:
it still allows about a 22% disagree rate at 95% (Clopper-Pearson, our arithmetic); 30 blind in a
row allows at most about 10% (the rule of three, 3/n [a4]), which is this repo's advise line
(Google CACM 2018, in [AGENTS.md](../AGENTS.md#checks)).

**Ticket 117 follows half of it and breaks the rest.** Its three real asks each had one line and
two picks, and the person answered each in 71 to 121 seconds from the ledger's times. The plan's
open questions already carry a lean, why, cost and how sure, and `approve` takes every lean, so
"do your rec" exists today for one kind. But no ask says its rec in a field; the asks list cannot
answer (`frame.tsx:431`); the note is optional on `no`; all three answers carry the same hash, of
the ticket's text, so neither yes covers the plan or the rule changes it was about; and the
`no_review` stop that ended the run never reaches the asks list at all.

```text
how each does it, one line each
Linear triage      one inbox per team; 1 accept, 2 decline, 3 duplicate, H snooze; accept can add a comment     [l1]
Linear inbox       J / K move, H snooze, U read                                                                [l2]
Linear Triage AI   a suggestion with "why"; accept or decline; per property: show, hide, or auto-apply         [l3]
Superhuman         one conversation at a time; E done; drafts ready, Tab then Enter sends one                  [s1][s2]
Gmail              "Filter messages like these": a rule from one example; importance learned from your acts   [g1][g3]
GitHub             E done in notifications; stale approvals dismissed when the diff changes; auto-merge        [g2]
Sheridan levels    4 suggest; 5 act if approved; 6 act unless vetoed in time; 7 act, then tell                  [a1]
Selective / defer  set a target risk; act on the share you are sure of; pass the rest to the person           [a2]
Rule of three      0 misses in n: the 95% upper bound is about 3/n                                             [a4]
SRE                "Every page should be actionable"; rote answers are "a red flag"                            [t1]
OTP gen_server     a call waits for one reply; the server may reply later with reply/2                         [o1]
Elm                model, update, view; a subscription brings outside events in                                [e1]
today, ticket 117  one line, two picks, first pick drawn as primary, note optional, answer in the ticket       (below)
```

## What was read

Quotes were checked against the pages as fetched on 2026-11-02, through a fetch tool that passes a
page through a small model, so each quote here was kept short and checked twice. Superhuman's help
center refused every fetch; its blog and learn pages stand in. A claim found only on a summary page
is marked **secondary**.

### Queues a person works through

| Tag | Source | What it says for us |
|---|---|---|
| [l1] | [Linear, Triage](https://linear.app/docs/triage) | "Triage is a special inbox for your team." Each item gets one action; "Accepting an issue will offer the option to leave a comment". The keys (1 accept, 2 decline, 3 duplicate, H snooze) came back paraphrased, not quoted. |
| [l2] | [Linear, Inbox](https://linear.app/docs/inbox) | "Scroll through the notifications in your Inbox using `J` / `K`"; "Press `H` to snooze". `E` for done was found only in a third-party guide (**secondary**). |
| [s1] | [Superhuman, Inbox Zero](https://superhuman.com/learn/email/inbox-zero-method) | "Mark Done with E and keep triaging from the next conversation." "Inbox Zero really means that you've decided what to do with every email." `H` for remind me: **secondary**. |
| [g2] | [GitHub keyboard shortcuts](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) | `E` is "Mark as done". "Dismiss stale pull request approvals when commits are pushed that affect the diff." "Auto-merge merges a pull request automatically after all required reviews and status checks pass." |
| [t1] | [Google SRE, Monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) | "Every page should be actionable." "Pages with rote, algorithmic responses should be a red flag." Too many, and people "skim, or even ignore". |

### Suggestions taken with one press, and rules made from one example

| Tag | Source | What it says for us |
|---|---|---|
| [l3] | [Linear, Triage Intelligence](https://linear.app/docs/triage-intelligence) | "Accept, decline, or view more information about why a suggestion was made before making a decision." Suggestions "can be configured to auto-apply when suggested." No agreement threshold was found: auto-apply is a manual setting. |
| [s2] | [Superhuman, Instant Reply](https://blog.superhuman.com/superhuman-ai-instant-reply/) | "We show three draft replies under each conversation"; "you just hit Tab and then Enter." The draft is made before you open the mail. |
| [g1] | [Gmail, create rules to filter](https://support.google.com/mail/answer/6579) | "Click Filter messages like these." A rule starts from one real message; you edit what it matches, then create it. |
| [g3] | [Gmail, importance markers](https://support.google.com/mail/answer/186543) | It learns from "Which emails you reply to"; a correction "helps Gmail learn which emails you think are important". A setting turns learning off. |

### Earning autonomy, and the risk of the shown answer

| Tag | Source | What it says for us |
|---|---|---|
| [a1] | Sheridan and Verplank's ten levels, from an [MIT OCW 16.422 copy](https://ocw.iti.hr/courses/aeronautics-and-astronautics/16-422-human-supervisory-control-of-automated-systems-spring-2004/lecture-notes/020504hmancenter.pdf) (**secondary** to the 1978 report); Parasuraman, Sheridan and Wickens 2000, IEEE SMC-A 30(3), read from a copy of unclear standing | Level 4 "suggests one alternative", 5 "executes that suggestion if the human approves", 6 "allows the human a restricted time to veto before automatic execution", 7 "executes automatically, then necessarily informs humans". 2000: "ensuring high reliability is a critical evaluative criterion". |
| [a2] | [Geifman and El-Yaniv 2017](https://arxiv.org/abs/1705.08500); [Madras et al. 2018](https://arxiv.org/abs/1711.06664); [Settles 2009](https://research.cs.wisc.edu/techreports/2009/TR1648.pdf) | Selective prediction lets "a user to set a desired risk level", "trading-off coverage". Learning to defer weighs "the effect of other agents in the decision-making process". Active learning "queries the instances about which it is least certain". |
| [a3] | [Parasuraman and Manzey 2010](https://depositonce.tu-berlin.de/items/0c787d91-6021-480b-a333-009e0d1d0092/full); [Goddard et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751) | "Automation bias results in making both omission and commission errors"; it "cannot be prevented by training or instructions". "Prominent incorrect advice is more likely to be followed"; people who felt "accountable made less AB errors". |
| [a4] | [Eypasch et al. 1995, BMJ](https://pmc.ncbi.nlm.nih.gov/articles/PMC2550668); [rule of three](https://en.wikipedia.org/wiki/Rule_of_three_(statistics)) (**secondary**) | "Upper limit of 95% confidence interval = maximum risk = 3/n (for n > 30)." The 1983 original (Hanley and Lippman-Hand) is paywalled. |
| [n1] | [NN/g, The Power of Defaults](https://www.nngroup.com/articles/the-power-of-defaults/); [NN/g, Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/) | "People tend to stick to the defaults"; the top hit is clicked "simply because it's first". A confirm is "not a second chance at all if users automate their response". |

**Our arithmetic, not a source.** One-sided 95% bounds on the disagree rate (Clopper-Pearson):

| Agreed | Upper bound on disagree | Note |
|---|---|---|
| 19 of 20 | about 22% | the owner's example |
| 20 of 20 | about 14% | |
| 30 of 30 | about 10% (exact 9.5%) | the rule of three, 3/30; this repo's advise line |
| 60 of 60 | about 5% | |
| 100 of 100 | about 3% | |

### Keys, patterns and WCAG

| Tag | Source | What it says for us |
|---|---|---|
| [w1] | [APG listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/), [feed](https://www.w3.org/WAI/ARIA/apg/patterns/feed/), [grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) | A listbox "does not provide an accessible way to present a list of interactive elements, such as links, buttons". Feed is for content that loads as you scroll ("Page Down: Move focus to next article"). Grid "can be used to group a set of interactive elements". |
| [w2] | [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), [4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | 2.1.4: a one-letter shortcut must be able to be turned off, remapped, or be "only active when that component has focus". 4.1.3: status messages "can be presented to the user by assistive technologies without receiving focus". 1.4.1: color is never "the only visual means". 2.4.3: focus order "preserves meaning and operability". |

### Elm and Erlang

| Tag | Source | What it says for us |
|---|---|---|
| [o1] | [OTP gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html), [processes](https://www.erlang.org/doc/system/ref_man_processes.html) | A call "makes a synchronous call"; on timeout it "exits the calling process". With `{noreply, ...}`, the reply "has to be created by calling" `reply/2` "in this or in a later callback". A receive "will select the first message ... that matches". |
| [e1] | [Elm architecture](https://guide.elm-lang.org/architecture/), [Elm time](https://guide.elm-lang.org/effects/time) | Model is "the state of your application", view "a way to turn your state into HTML", update "a way to update your state based on messages". `subscriptions : Model -> Sub Msg`. |

- **Elm.** A desk is a model (the asks, folded from the ledger), an update (a key is a Msg) and a
  view (the head ask, drawn). Today's asks list is already that: a tea machine over the ledger
  (`apps/fabrika/src/asks.ts:1-40`). In `next/`, a program's required `refuse` turns away a `y` when
  the ask has no rec ([Elm first](../docs/direction/elm-first.md)).
- **OTP.** Each step that asks is a parked `gen_server:call`: the lane waits for one reply, and the
  desk is where the reply is made later, as `reply/2` does [o1]. An automatic kind answers the same
  call without a person. A rule a person adds and removes reads like an event handler added to and
  removed from a manager; that comparison is ours, and gen_event was not read for this study.

## Today's asks, on ticket 117

Read off the tracker's ledger for ticket 117 ("tracker | ticket | map: the map should take a ticket
on a pipe") and today's code. The times are the ledger's `at`, so "asked to answered" is an upper
bound on the person's time: it includes any wait before they looked.

| What | Today | Where |
|---|---|---|
| Plan v1 ask | `a-approve-2`, "Do you approve plan version 1?", picks `approve`, `no`; answered `approve` 71 s later | ticket 117, 2026-11-02 00:31 |
| Plan v2 ask | `a-approve-8`, "Do you approve plan version 2?"; answered `approve` 97 s later | ticket 117, 19:49 |
| Rule changes ask | `a-exam_merge-10`, "Do you want to merge these rule changes: apps/fabrika/src/tsh.test.ts, programs/map/src/selection.laws.test.ts?", picks `merge`, `no`; answered `merge` 121 s later | ticket 117, 19:55; [PR 313](https://github.com/usirin/tea-fabrika/pull/313) |
| The `no_review` stop | `r-exam_merge-12` ended `send:reviewer:no_review`; the lane stopped `stuck:sent_back`; nothing reached the asks list | ticket 117, 21:20; `programs/tracker/src/head.ts:115` says stuck only when the last end is `stuck` |
| A spend ask (made up for 117) | Not asked yet: self-fix PR 11 turns `over_budget` into a `spend` ask with "the cost so far". On 117 the plan run read 1,566,437 input tokens and the ledger kept `usd 0`, `listUsd null`, so the ask would say "price unknown" | [PR 11](../docs/plan/pipeline-self-fix.md#pr-11-every-outcome-has-a-route-and-a-fixable-stop-never-stops); `packages/pipeline/src/stages/pipeline/program.ts:1309` |
| The rec | No field. The plan's open questions each carry `lean`, `why`, `cost`, `sure` (`stages/plan/plan.ts:136-149`); 117's v1 and v2 had three each, at 99, 95 and 95, and `approve` "takes the lean on each open question" | ticket 117 `planned` facts; the `${ask}/picks` comment |
| What each pick does | A comment written just before the ask, "What each answer does:" | `program.ts:1316-1325` |
| The question | Made by the lane, one line per kind | `stages/pipeline/machine.ts:799-800` |
| The asked fact | `{ask, what, picks}`: no kind field (the kind is read back from the id, `a-approve-8`), no rec, no shows | `tickets/ticket.ts:317-322`, `machine.ts:811` |
| The answer | `{ask, pick, note, text}`; `text` is the hash of the ticket's title and body | `ticket.ts:347-353`, `tickets/approval.ts:32-38` |
| The hash | All three answers carry the same `sha256:a747…`: the ticket's text, not the plan or the diff | ticket 117's three `answered` facts |
| The asks list | A menu of rows; `↵` opens the ticket, `H` sets an ask aside; "You answer in the ticket's own tile, never here." | `apps/fabrika/src/window/frame.tsx:421-431` |
| A row of the asks list | `{key, ticket, title, what, kind: "ask" or "stuck", at, seen}`: no picks, so it cannot answer | `apps/fabrika/src/asks.ts:49-66` |
| The ask box | The question, a note box, one button per pick; the first pick is drawn primary | `programs/tracker/src/window.tsx:783-826`, `:813` |
| The note | Optional on every pick, `no` included | `window.tsx:801`; the old desk pack required a why on `no` (`packages/pipeline/src/asks/ask.ts:126`) |
| The card in view | The plan ask scrolls out of view while the person reads the plan | field note 2026-11-01-34 |
| Attention counted | asked and answered `at` exist, so asks per ticket and minutes to answer are a view; time on the ask, keys and nudges are not recorded | `ticket.ts`; [jidoka](../docs/direction/jidoka-and-andon.md#count-a-persons-attention) |

The same case, against each principle of the note:

| Principle | Ticket 117 today |
|---|---|
| A1 one queue, one ask at a time | **Half.** The asks list is one queue, oldest first, with a count in the top bar (`asks.ts:250`), but each answer means opening the ticket, and the header says no time. |
| A2 one line, the rec, the evidence folded | **Half.** One line each, and the plan's leans exist, but the rec has no field, the first pick is the unstated default, and the card scrolls away from the evidence. |
| A3 three keys, only where focus is | **Breaks.** No keys: a click on a pick. The note is optional on `no`. |
| A4 the rec before the ask, and what the person saw and did | **Breaks.** No rec, no time on the ask, no key, no record of what was opened. The yes covers the ticket's text, not the plan or the diff. |
| A5 autonomy per kind, earned blind | **Not there.** Nothing counts agreement. 117 gives 3 of 3 first picks and 6 of 6 leans taken, all with the rec in view: too few, and not blind. |
| A6 code answers what code can; a stop shows as a stop | **Breaks.** The `no_review` stop was a step code could take (PR 11 routes it to `run("review")`), and it never showed on the desk. |

## What this tells us for fabrika

- **Build the desk on the one ask** ([one ask, one meter](../docs/direction/one-ask-and-one-meter.md),
  ticket 90): one kind field, `shows` and its hash. The rec is one more field on the same fact.
  Without it, the asks list grows a second way to answer, which ticket 102 already warns against.
- **Record the rec, and what the person did, now.** The rec before the ask, the key, the time on
  screen and what was opened exist only at that moment. Agreement, minutes per kind and the
  header's estimate are folds that can wait.
- **Count attention per merged ticket, from experiment 185.** Asks, messages a person got (nudges
  and notices) and time from ask to answer, as one view. A design that adds an ask says what it
  costs a week. It is a count, not a cap: the 10% to 30% call stands.
- **Earn autonomy on blind asks only, with a real count.** Linear and Gmail switch by hand; we can
  do better because we can count, but only if the count is not the person trusting the rec.
- **Keep some kinds a person's forever.** The exam kinds ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)),
  a spend yes (a dollar limit points at a person's yes, [one meter](../docs/direction/one-ask-and-one-meter.md))
  and a security triage ask ([triage asks](../docs/direction/triage-asks-when-worth-is-unclear.md)).
- **Clash with a goal, in one line:** grouping same-kind asks reorders a queue that
  [every wait is a queue](../docs/direction/every-wait-is-a-queue.md) says is first in, first out.
  That note is proposed, so the note here leans to grouping and names it.

## What it cannot tell us

- **How long a real ask takes a person.** 71 to 121 seconds on 117 includes the wait before looking.
  Only the new `took` field, on live weeks, will say.
- **Whether ask kinds are narrow enough to match on.** Experiment 163 part 5 found a file or a pull
  request says where the code is, not what to decide (2 of 10 bundles held), and precedents found 0
  of 68. Kind and rec may be narrower; nobody has counted.
- **How much a blind ask slows a person,** and whether a person minds. Untested.
- **Whether the plan's percent sure is calibrated.** 117's were 95 to 99, all taken. Six is not a
  sample.
- **Any screen reader behavior.** Nothing was run with VoiceOver or NVDA.
- **The outside docs as they are tomorrow.** Linear's keys came back paraphrased; Superhuman's help
  center could not be read.

## Dollars

$0. No model was called. The outside reading ran through a fetch tool in one agent session; no
paid API was used.

## Links

- [l1] https://linear.app/docs/triage
- [l2] https://linear.app/docs/inbox
- [l3] https://linear.app/docs/triage-intelligence
- [s1] https://superhuman.com/learn/email/inbox-zero-method
- [s2] https://blog.superhuman.com/superhuman-ai-instant-reply/
- [g1] https://support.google.com/mail/answer/6579
- [g2] https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts,
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches,
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request
- [g3] https://support.google.com/mail/answer/186543
- [a1] https://ocw.iti.hr/courses/aeronautics-and-astronautics/16-422-human-supervisory-control-of-automated-systems-spring-2004/lecture-notes/020504hmancenter.pdf; Parasuraman, Sheridan and Wickens 2000, DOI 10.1109/3468.844354
- [a2] https://arxiv.org/abs/1705.08500, https://arxiv.org/abs/1711.06664, https://research.cs.wisc.edu/techreports/2009/TR1648.pdf
- [a3] https://depositonce.tu-berlin.de/items/0c787d91-6021-480b-a333-009e0d1d0092/full, https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751
- [a4] https://pmc.ncbi.nlm.nih.gov/articles/PMC2550668, https://en.wikipedia.org/wiki/Rule_of_three_(statistics)
- [n1] https://www.nngroup.com/articles/the-power-of-defaults/, https://www.nngroup.com/articles/confirmation-dialog/
- [w1] https://www.w3.org/WAI/ARIA/apg/patterns/listbox/, https://www.w3.org/WAI/ARIA/apg/patterns/feed/, https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- [w2] https://www.w3.org/TR/WCAG22/
- [t1] https://sre.google/sre-book/monitoring-distributed-systems/
- [o1] https://www.erlang.org/doc/apps/stdlib/gen_server.html, https://www.erlang.org/doc/system/ref_man_processes.html
- [e1] https://guide.elm-lang.org/architecture/, https://guide.elm-lang.org/effects/time
