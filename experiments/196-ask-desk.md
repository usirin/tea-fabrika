# 196. How should fabrika show a person its asks, so most take one key, and learn from the answers?

Read 2026-11-02, in two rounds. **This is reading, not a measurement.** No model was called. Round
1 reads ticket 117's real asks off the tracker, today's asks list and ask box on `main` at
`8742402f`, and about 18 outside sources. Round 2, the same day, after the owner's review, shoots
today's asks popup from the built app, reads how Linear lays out triage and how its team builds, and
checks the page's demo with 132 click and key checks in Chromium. Those checks test a drawing of
the window, not the app. It feeds [the ask desk](../docs/direction/ask-desk.md), a proposed note,
and a private page, "Ask desk guidelines", with a small desk you can click and key through.

**Which version.** Every "today" claim is about today's version: `apps/fabrika`, `programs/tracker`
and `packages/pipeline`. `next/` has no asks list yet; it comes in Tier 5
([tiers](../docs/plan/tiers.md)). The note's shape is written for `next/` and offers small tryouts
in today's version.

**Decided before this study (the owner, 2026-11-02), not asked again:** asks to the owner are fine,
even many; the owner's call of 2026-10-30 stands ([triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md):
about 130 to 190 asks a week, with no ask budget set yet); the owner makes every decision the system thinks needs them. What is
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
| A1 one queue, a list beside the selected ask | **Half.** The asks list is one queue, oldest first, with a count in the top bar (`asks.ts:250`), but each answer means opening the ticket, and the header says no time. |
| A2 one line, the rec, the evidence folded | **Half.** One line each, and the plan's leans exist, but the rec has no field, the first pick is the unstated default, and the card scrolls away from the evidence. |
| A3 three keys, a button for each, only where focus is | **Breaks.** No keys: a click on a pick. The note is optional on `no`. |
| A4 the rec before the ask, and what the person saw and did | **Breaks.** No rec, no time on the ask, no key, no record of what was opened. The yes covers the ticket's text, not the plan or the diff. |
| A5 autonomy per kind, earned blind | **Not there.** Nothing counts agreement. 117 gives 3 of 3 first picks and 6 of 6 leans taken, all with the rec in view: too few, and not blind. |
| A6 code answers what code can; a stop shows as a stop | **Breaks.** The `no_review` stop was a step code could take (PR 11 routes it to `run("review")`), and it never showed on the desk. |

## Round 2: one asks program, two views

The owner reviewed round 1's page the same day. Three findings, recorded as decisions:

- **The layout was not how Linear would build it.** Round 1 drew one card in the middle, the head
  ask whole and the rest as a count. That is closer to Superhuman than to Linear.
- **The mouse did nothing.** A click on a row did not select it. Round 1's demo had key handlers
  only.
- **It was a second desk.** Today's top bar already has an asks popup, and call 6 already leaned to
  making it the desk (ticket 102). It must be one thing.

Then two more, while round 2 ran: do not copy Linear's triage screen, but ask how Linear's team would
build this out of fabrika's own parts; and "open all" is the first time the app opens a tile with
content, so name the patterns that needs.

### Today's popup, from the built app

Shot on Electron from today's version, built in the work tree, the way `apps/fabrika/e2e.ts` drives
it: a short temp `FABRIKA_HOME` of its own, a stand-in host on its socket that sends a desk and
ticket 117's three real asks, dark theme. Five layouts: one tile, two side by side, two stacked, a
2x2 grid at 1440x900, and two side by side at 1024x700. The shots are on the page, not in the repo.

| What the shots show | What changes in round 2 |
|---|---|
| "Asks 3" under the top bar's count, a menu anchored to the right of the bar | Kept: the popup is the asks program's glance, in the same place. |
| Each row: the question, then "#117 tracker \| ticket \| map: the map sh…", then the time | The second line says the rec instead of repeating the title: "#117 · rec approve · 95%". |
| `H` Later as a button on the row; footer "↑↓ Move · ↵ Open · H Later · Esc Close" | Kept, with `y` Rec and `n` Not the rec added, each as a button on the selected row. |
| `↵` opens the tile that shows the ticket, or turns the tracker to it, or says no tile shows it (`frame.ts:357-382`) | `↵` opens the asks tile on the same ask; the ticket tile follows it on a pipe. |
| The same popup at every layout, about 400px wide | No change: the popup does not depend on the layout. |

The tiles behind the popup say "starting" in every shot: the stand-in host sent no program views
that took. The popup itself is today's, drawn from today's asks machine.

### How Linear lays out triage, and how its team builds

| Tag | Source | What it says for us |
|---|---|---|
| [l5] | [Linear changelog, 2022-01-20](https://linear.app/changelog/2022-01-20-linear-preview-new-sidebar-and-team-icons) | "The new interface for Triage allows you to view your list of issues side by side with the focused issue." A staff reply on a forum says split view is "only an option in the inbox and triage views" (**secondary**). |
| [l9] | [Linear changelog, 2025-09-19](https://linear.app/changelog/2025-09-19-auto-apply-triage-suggestions) | "Properties that have been automatically applied are clearly marked in the suggestions header." "Hover over them to review the reasoning or to make changes." |
| [l4] | [Linear changelog, 2021-03-25](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help) | The shortcuts help became searchable. Linear's keyboard shortcuts docs page returned 404 on 2026-11-02. |
| [m1] | [Linear Method, introduction](https://linear.app/method/introduction) | "Flexible software lets everyone invent their own workflows, which eventually creates chaos as teams scale." "Sometimes the most important thing is to make a decision, and move on." |
| [m4] | [Building at the early stage](https://linear.app/now/building-at-the-early-stage) | "The key is to think broadly but then only choose few things to do well". |
| [m8] | [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | They defined "the behaviors of the main components of the app" (paraphrased by the fetch tool), and "simplified headers and filters to improve the overall navigation." |
| [m10] | [Design for the AI age](https://linear.app/now/design-for-the-ai-age) | "The role of design is to bring form around the function." The question it asks: "how do you create consistent, high-quality experiences?" |
| [m7] | [Designing remote work at Linear](https://linear.app/now/designing-remote-work-at-linear) | "We keep the bar high by saying no." "We ship behind feature flags to internal users first." |

Not found in Linear's docs: what triage shows when it is empty, whether the next item is selected
after an action, and whether buttons show their keys. No Linear essay on keyboard design was found.

So Linear's own screen is a list beside the focused issue, keys per action, and suggestions marked
with their reason. How they build is the part we take: a few things done well, each main component
with one behavior everywhere, and consistency over a new screen per feature. In fabrika, that is one
asks program whose row, detail and action bar are the same component in the popup, the tile and the
ticket's ask box; the ticket shown by the ticket program on a pipe, not drawn again inside triage;
and the pieces that any program can reuse (list and detail, an action bar with its keys, open or
focus). The note's [one asks program](../docs/direction/ask-desk.md#one-asks-program-two-views)
has the per-screen table.

### What the demo is, and what passed

The page's demo draws a fabrika window: a top bar, a workspace of tiles with the tile guidelines'
title bars and edges, a bottom line, and the asks popup. The asks program's two views share one
model and one selection. A setting picks the layout (one tile, side by side, stacked, 2x2), a
zoom, and "Today", which draws today's popup and its `↵`. Made up: ticket 141's plan ask and stop,
the spend ask on 117, the exam ask's rec and 80%, the new question wording, the cost line, the
blind count of 29, and every clock value; the three 117 asks and their questions are real, though
they never waited all at once.

132 checks in Chromium (Playwright, headless, the page's built HTML), all passing, no page errors:

| Group | Checks | What it covers |
|---|---|---|
| Popup by keys | 23 | `Ctrl-B a`, arrows and `j` `k`, `y`, `y` refused on a blind ask, `n` with the note refused empty, `Esc` from the note, `h`, `Esc` back to the top bar's asks |
| Popup by clicks | 11 | the top bar's asks, a row, Take rec, Not the rec, Send empty and with a note, Back, Later, a second click, a click outside |
| Open all | 18 | the handoff, open or focus, the way back by `Esc` and by closing, `Ctrl-B x`, the ticket on the pipe, the polite status and the bottom line |
| The tile, wide | 33 | a row by click and key, no rec, the evidence by `space` and by click, every pick, a pick against the rec, the blind pick and its reveal, the stop by `↵` and by click, `y` refused on a stop, Later |
| The tile, narrow | 6 | one pane: detail first, `Esc` and "All asks" to the list, `Enter` and a click to a detail |
| The offer | 5 | the 30th blind match, `a` and its click, dropping the rule |
| Where it lands | 14 | each layout, a zoom, 390 wide, a strip by click, closing undoes a nested row |
| Keys only where focus is | 2 | `y` outside the window, `y` in a terminal tile |
| Tab order and focus rings | 6 | the tile's stops in order with a 2px ring each, the popup's, back to the one selected row |
| Today and the page | 14 | today's popup: `j`, `y` does nothing, `H`, `↵` and a click on a row; the page's own views, the program and patterns views included |

The checks found two bugs, both fixed before publishing: the page's log took focus with a 1px ring,
and dropping a rule erased its own fact from the log.

### The layouts, and what squeezes

Each key state (the popup, the tile just opened, the evidence open, the note open) shot in full size
at the five layouts, plus the page at 1280 and 390 wide.

| Layout | The asks tile | What squeezes or breaks |
|---|---|---|
| One tile, 1440x900 | 714 wide, list and detail | Nothing. Much empty space under a short ask. |
| Side by side | 356 wide, one pane | The list hides behind "All asks"; a person sees one ask at a time again, round 1's shape. |
| Stacked | 714x419, nested in a new row | With the plan's evidence open, the action bar fell below the tile's edge. Fixed: the action bar is pinned to the tile's bottom edge. The question still scrolls away under a long plan. |
| 2x2 | 355x419, nested, one pane | Both squeezes at once: one pane, and the evidence scrolls under the pinned bar. |
| 1024x700 | 252 wide, one pane | Readable. The rec and cost wrap to four lines. |
| The page at 390 | t2 folds, then the tile is 150 wide | The popup's header and footer wrap to two lines. The tile is one narrow column; nothing is cut off, and the page does not scroll sideways. |

## Patterns found

"Open all" is the first time the app opens a tile with content. Each pattern below was checked
first against what is settled, then against Linear, Tuval's old code, tmux and i3. The layout model
is decided: AeroSpace and i3, a split the same way as the container is a sibling, a split across
nests ([fold, not tabs](../docs/direction/fold-not-tabs.md)).

- **P1. Open or focus.** A second "open all" focuses the asks tile already open, unfolds it if
  folded, ends a zoom, and makes no second tile. **Lean, 90%.**
  - Tuval's old code does this for a project: an open project is landed on "instead of opening it
    twice" (`shell/picker/open-project.ts`, its `Focus` answer). i3 has the same move by hand, "Get
    me to the next open VIM instance" [k3]. Linear has one triage page per team, so it never meets
    the case.
  - **Flag:** with P2 and P4, this wants its own note, "a program can open a tile with content",
    since every program that opens one meets the same three questions.
- **P2. Where it lands.** The asks tile takes half of the focused tile's share and goes right after
  it, side by side. In a row it is a sibling; in a column it nests in a new row. A zoom ends first.
  If it would be under 220px wide, the others in its row fold into strips, the tile it came from
  last. **Lean, 65%.**
  - Settled: today's line rule opens a line "in place", spread from the tile it was typed in, and "a
    zoom goes, so the line is seen" (`apps/fabrika/src/desk/layout/line.ts:68-95`, with `MIN_WINDOW`
    220 by 120). Tuval's `split` seeds "the new window with half the split window's share"
    (`shell/layout/tree.ts:139`). tmux's split makes "a new pane by splitting target-pane" [k2]; its
    `-Z` "keeps the window zoomed", so without it a split ends the zoom (our reading). i3 places a new
    window "next to the current one, splitting the screen size in half" [k3].
  - We differ from today's line rule in what folds: a line folds its new windows and keeps the first
    open; here the new tile is the one asked for, so it stays open and the others fold. Always side
    by side, never the container's direction, because a list beside a detail needs width.
  - **Doubt:** side by side in a 2x2 gives a 355px tile, one pane. Taking the whole column, or
    zooming the new tile, would give a full list and detail; both hide more of the person's work.
    The owner clicking through the layouts settles it.
- **P3. The handoff.** The popup closes, the new tile is focused, and the same ask stays selected:
  on its row when the tile is wide, on its question when it is one pane. **Lean, 85%.**
  - i3: "When a new window appears, it will be focused" [k3]. Linear's inbox: "Click into the
    notification to view the individual issue" [l2]. Keeping the selection is ours: the two views
    share one model, so there is nothing to hand over.
- **P4. The way back.** `Esc` at the tile's top level (after the note, the picks, and the one-pane
  detail have each taken their `Esc`) moves focus back to the tile it was opened from, and the asks
  tile stays. Closing it (`Ctrl-B x`) does the same and undoes a row made for it. **Lean, 60%.**
  - APG, for a dialog: "When a dialog closes, focus returns to the element that invoked the dialog"
    [w4]. [Popovers](../docs/direction/popovers.md) does this for a popover.
  - It clashes with the tile guidelines, decided 2026-11-01: a closed tile gives focus to the next
    open tile in reading order (`apps/fabrika/src/desk/desk.ts:415`, `heirOf`). Reading order is
    predictable with no memory; the opener is where the person was. Ticket 7's back and forward per
    tile would make the opener one press away either way.
  - **Flag:** this wants an owner's call, then a line in the tile guidelines. Under 80%: a person
    who closes the asks tile after answering may want the ticket beside it, not the opener.
- **P5. What is said.** A focus move speaks for itself: assistive tech gets "focus change events"
  when focus moves [w3], so the new tile is not also put in a live line. An answer is a polite status
  ("approve, the rec, for #117. 3 asks, 1 stop. Next: …"), never a focus move (4.1.3 [w2]). Opening
  says "asks, t3", the header and the selected ask, once. The bottom line names the tile and what
  just happened ("asks opened in t3, beside t1"); it is never the only place a fact is (tile
  guidelines). **Lean, 80%.** Needs a real VoiceOver run: whether the polite status and the new
  focus are both read, and in which order.
- **P6. One program, two sizes.** The popup is the asks program's glance view, not a second list.
  Both views draw one model; answering in one is answering in the other. **Lean, 75%.**
  - **Flag:** a note of its own, "a program may have a glance view in the top bar", since the
    tracker, runs and spend could each want one. It changes the program shape in
    [modes](../docs/direction/modes.md) by one optional view.
- **P7. List and detail that fold to one pane.** Under about 520px the tile shows the list or the
  detail, with "All asks" (`Esc`) between them. **Lean, 70%.** 520 is the demo's guess: a 170px list
  and a 300px detail with gaps. A reusable piece for any program with a list.
- **P8. An action bar from the program's commands, each key on its button.** Every command with a
  key gets a button with the key printed on it and `aria-keyshortcuts`, which only names the key:
  "the keyboard behavior must be added via JavaScript event handlers" [w5]. **Lean, 75%.**
  - **Flag:** a line in the tile guidelines or [modes](../docs/direction/modes.md): the buttons come
    from `commands`, so a key and its button cannot drift.

## What this tells us for fabrika

- **Build the desk on the one ask** ([one ask, one meter](../docs/direction/one-ask-and-one-meter.md),
  ticket 90): one kind field, `shows` and its hash. The rec is one more field on the same fact.
  Without it, the asks list grows a second way to answer, which ticket 102 already warns against.
- **Record the rec, and what the person did, now.** The rec before the ask, the key, the time on
  screen and what was opened exist only at that moment. Agreement, minutes per kind and the
  header's estimate are folds that can wait.
- **Count attention per merged ticket, from experiment 185.** Asks, messages a person got (nudges
  and notices) and time from ask to answer, as one view. A design that adds an ask says what it
  costs a week. It is a count, not a cap: the owner's call of 2026-10-30 stands.
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
- **Any screen reader behavior.** Nothing was run with VoiceOver or NVDA. The demo shows what it
  would say; that is our text, not a reader's.
- **Whether the tile rules hold in the app.** The demo's layout tree, folding and focus moves are a
  sketch of today's rules in a browser page, not today's desk code. Its 132 checks prove the
  drawing, not the app.
- **How the real popup looks with program views.** The Electron shots' tiles stayed "starting",
  since the stand-in host's views did not take.
- **The outside docs as they are tomorrow.** Linear's keys came back paraphrased; Superhuman's help
  center could not be read.

## Dollars

$0. No model was called. The outside reading ran through a fetch tool in one agent session; no
paid API was used. Round 2's shots and checks ran on the laptop: one Electron app at a time, then
headless Chromium, under `nice -n 19`.

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
- [w3] https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- [w4] https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [w5] https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts
- [l4] https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- [l5] https://linear.app/changelog/2022-01-20-linear-preview-new-sidebar-and-team-icons
- [l9] https://linear.app/changelog/2025-09-19-auto-apply-triage-suggestions
- [m1] https://linear.app/method/introduction
- [m4] https://linear.app/now/building-at-the-early-stage
- [m7] https://linear.app/now/designing-remote-work-at-linear
- [m8] https://linear.app/now/how-we-redesigned-the-linear-ui
- [m10] https://linear.app/now/design-for-the-ai-age
- [k2] https://man7.org/linux/man-pages/man1/tmux.1.html
- [k3] https://i3wm.org/docs/userguide.html
- [t1] https://sre.google/sre-book/monitoring-distributed-systems/
- [o1] https://www.erlang.org/doc/apps/stdlib/gen_server.html, https://www.erlang.org/doc/system/ref_man_processes.html
- [e1] https://guide.elm-lang.org/architecture/, https://guide.elm-lang.org/effects/time
