# Fabrika's skills, read for machines

What each fabrika skill decides, and who should own each decision once it is a
tea machine: code, an agent with a typed answer, Jev, or a person.

Two agents read every skill in
[kamp-us/phoenix `claude-plugins/fabrika/skills`](https://github.com/kamp-us/phoenix/tree/main/claude-plugins/fabrika/skills)
on 2026-10-04, one the main loop and one the skills used now and then. This is
their reading, condensed. Nobody has checked it line by line against the
skills yet; read it as a map, not a spec.

## The lens

From the experiments ([the log](../experiments/README.md)):

- **Code** owns anything with an exact answer: matches, counts, labels, CI and
  file state, test runs, exit codes, schema checks.
- **Agents** do open-ended writing, and end every turn in a typed answer, so
  code routes on a field and not on prose.
- **Correctness** is settled by running things written apart against each
  other: tests before code, hidden tests, a throwaway implementation from the
  rules, planted bugs. Never by a model reading a diff.
- **Jev** reads short text people wrote and routes it. Its yes may route work
  or make it stricter, never let work through, because a false fact in a
  person's text moves it with confidence.
- **People** are asked when there is a real disagreement or gap, with both
  sides shown.

## The pattern across all of them

Most of fabrika is already code. The `fabrika` CLI verbs make the exact checks,
and the agent mostly reads an exit code and looks up what happens next in a
table the skill spells out in prose, a table the skills themselves call "a
total function of the code". In tea that table is the reducer.

What is left in prose is mostly ordering the skill calls "convention, not
enforcement": grill before writing the plan, walk the approval, a ruling's
quote must be about this question. A machine makes those real.

The real agent work left is narrow: writing, reading prose for stale or
contradicting sentences, judging pixels, and reading what people write.

## The main loop

### triage

- **Code:** the claim, the scratch path, the criteria shape, "a stated
  ordering must be an edge", where the issue lives, the label set, and who
  filed it (footer plus operator accounts). The verbs already refuse by exit
  code.
- **Agent, typed:** type, split, fold into an epic, priority, and the value
  bar. Priority rules like "a signed-out visitor sees it means p1" are house
  rules, which Jev gets wrong.
- **Person:** pitch approval.
- **Code could do more:** a report could carry a command that reproduces it,
  and code runs it at main. If it passes, the issue is stale.
- **Jev:** duplicates. "Do these two describe the same observation? same /
  different / unsure." Same proposes a fold, confirmed by an agent for an
  agent's filing and by a person for a person's. Unsure keeps it and adds a
  "maybe related to #N" link.
- **Against the current tea-fabrika:** `src/sort.ts` lets Jev say an issue is
  for an agent, and lets it kill an issue. Both let work through on Jev's yes.
  Code should require a criteria block for agent-ready, and Jev may only move
  an issue to a person.

### build and build-ui

- **Code:** pick, claim, blockers, refusals, branch base, the repair budget,
  the terminal tokens. All verbs already.
- **Agent, typed:** the construction, the deviations, and a "contradiction"
  answer when an example contradicts its rule (experiment 20).
- **Code could do more:** run `build check` per file class, tell a fixed
  escalation from an open one by its test, reproduce a CI failure on the merge
  ref.
- **Against the lens:** build-ui's look-and-fix loop has no test that passes
  or fails. Test-first gives it nothing.

### review

The test-first lane replaces the per-criterion evidence rows, "behavior claims
must trace to code", test honesty (the tests are locked), and the loop where a
new criterion fails the PR.

Not covered yet, and who should own it:

| Check | Owner |
|---|---|
| Edits to existing tests or fixtures | Code: changed paths against the locked set, each with a deviation |
| Scope creep | Code: changed paths outside what the criteria name, each with a deviation |
| Honest deviations | Code works out a minimum list from the diff; a "None." that contradicts it fails |
| Comments, stale sentences, rollout gating | Agent, typed findings; code checks each quoted line exists |
| Docs, skills, ADRs | Agent, typed; every contradiction in a file in one round |
| `## Report` | Agent |

- **Jev:** an owner's comment with no ruling marker. "Does this comment change
  or contradict criterion X? yes / no / unsure." Yes parks for a ruling with
  both texts side by side; unsure lists it in the verdict.
- **Against the lens:**
  - The repo bans local test runs: a local run returned another checkout's
    cached green three times in one session. Tests need a clean tree tied to
    the commit, or CI, and hidden tests a place the builder cannot read.
  - CI tests the merge ref, not the head. Running the head alone can pass
    falsely.
  - Most fabrika PRs are prose. Test-first covers little there, and an agent
    with typed findings stays the main judge.

### ship

- Almost all code already: scope, route, gates, CI wait, mergeability,
  enqueue, reconcile. Ship can be a pure reducer.
- **Person:** control-plane approval.
- **Unresolved threads:** a person's thread refuses (code). A bot nit uses
  GitHub's "outdated" flag (code); everything else counts as substantive.
- **Jev:** "Does this person's thread ask for a change? yes / no / unsure." Yes
  means repair; no or unsure leaves it for the person. Jev must not resolve a
  bot thread, since that lets work through.

### operate

- **Code:** the routing table, seats, claim, boot and resume, checking every
  event against the board or git, laps against fails, unpark keyed on a closed
  set of park causes, the size stop. This is the tea reducer.
- **Agent:** cleaning up after a dead shell. The rationale on a driver clear
  should become a closed list.
- **Person:** founder parks, rulings owed, founder actions, size stops.
- **Jev:** a person's reply on a parked issue. Code first checks the author.
  Then "Which option does this reply pick: A / B / asks a question /
  unrelated / unsure?" A pick posts "Reading this as A, reply `/pick A` to
  confirm" and does not unpark; only an exact `/pick A` from the right account
  does. A question writes the next park comment. Unsure stays parked.
- **Against the lens:** agents post under the founder's account and "the bytes
  do not say which", so checking the author is weak. One more reason Jev only
  routes.

### review-ui and taste-color

- review-ui's render checks are strong code already. Judging pixels against
  each design-law row is an agent's typed PASS / FAIL / N-A per row; the
  hand-check is a person.
- taste-color is a lookup table: a linter (no raw hex, role tokens only) is
  code; "the law is silent" parks to a person.
- demlik does not adopt this lane. Build it last.

### Build order for the main loop

1. A lane that survives a restart, with parks as a closed set of causes.
2. The test-first build lane: criteria with kinds, tests first, tests fail on
   untouched code, tests locked by hash, builder answers done / contradiction
   / blocked, visible and hidden tests run in a clean tree, then on the merge
   ref.
3. Code review checks: scope, edits to locked tests, the minimum deviations,
   CI at head.
4. Ship. It closes the loop end to end, which has never run.
5. Triage with kinds: a throwaway reference, the duplicate check, a park that
   shows both answers, a stale-report check.
6. The reply channel: park comment, Jev reads the reply, `/pick` confirms.
7. Agent review for prose, with typed findings and checked quotes.
8. The UI lane.

## The skills used now and then

| Skill | Machine? | In short |
|---|---|---|
| plan-epic + check-epic-plan | Yes, the richest | Plan, grill, mint children and edges, then a 15-defect floor that is already code |
| heal-ci | Yes | Why a PR is not moving: diagnose, look up, one guarded rerun |
| governance | Yes, a merge gate | Does a diff contradict an ADR or weaken a guard |
| wayfinding + grilling | Yes, over many sessions | A map of open questions, worked down; grilling is a child machine others reuse |
| test-audit | Yes | Gate a new test, or prune ones that catch nothing |
| prototyping | Yes, small | Answer one question by running a throwaway spike; already works this way |
| architecture-audit | Medium | Three explorers, merge, coverage, hand to grilling |
| graduate, adr, write-pattern | Small | Turn a trail into one spec; record a decision; record a pattern |
| report, glossary, diataxis, campaign, handoff | No, writing aids | Their checks belong in verbs |
| deslop-comments | Fan-out | Per-comment cut / keep, typed |
| front-door, skill-doctor, writing-for-agents | No | A menu, a grader, a guide |

### Per skill

- **plan-epic + check-epic-plan.** Plan content and slice shape are an agent's
  typed answer; decisions and approval are the founder's. Two slices may run in
  parallel only if they write different files, but "the verb cannot see your
  file plan": have the agent declare file globs per child, and code checks the
  overlap and forces an order. Enforce grill-before-write, and render the
  approval walk from the board. The floor's advisory caveats feed nothing
  today; Jev could ask "does this criterion state an outcome someone can see?",
  with no or unsure sending the child back to the planner.
- **heal-ci.** `diagnose` picks the stall token (code); the routing is "a
  lookup with no judgment" (code); `classify` is pure and default-deny (code);
  the one-rerun guard is in the verb (code); "a rerun is not free of judgment"
  (person). For an unclassified failure Jev can ask "same failure as open issue
  #N?": yes adds a note, no or unsure files a new one. Never let Jev call a log
  "transient": logs can be written by an attacker, and default-deny is the
  point.
- **governance.** Scope, sweep and anchored guards are code. "Does this weaken
  a guard" is a model reading a diff today. Instead: plant violations the guard
  should catch, run the guard at base and at head; if head lets one through
  that base caught, the guard was weakened. Jev: "do these two ADRs answer the
  same question?" routes a pair to an agent or person, and clears nothing.
- **wayfinding + grilling.** "Is this fog?" is an agent's call. Merging "one
  question wearing two titles" is Jev's same-thing strength; its yes sends the
  pair to an agent and never drops a question. The fact-or-decision test,
  "could evidence settle this?", is an agent's call with a Jev check that can
  only escalate. "That the quoted authorization was given about this question"
  is "convention, not enforcement" today. Wayfinding asks the founder after
  every write; batching would cost him less.
- **test-audit.** The best fit for running instead of reading. Code checks a
  regression test fails at base and passes at head; planted bugs show what a
  test can detect, and a test that catches none is a junk candidate; lint
  catches assertion-free tests and self-comparisons. Jev has no place here.
- **prototyping.** Already open, build, run, capture, dispose, with evidence
  only from running. Jev could ask "does this decision answer the named
  question?", with no or unsure blocking the capture.
- **architecture-audit.** Explorer findings and coverage should be typed; "a
  report naming no opened files is an incomplete pass" is a code check.
  Duplicates are Jev's; the human pick stays a person.
- **adr.** Mint, sweep, resolve and renumber are code. Jev: "does this title
  state a decision or a topic?", with topic or unsure meaning rewrite.
- **write-pattern.** "Every rule traces to something you actually read" is
  checkable: each rule cites a path that exists at the commit. Fenced examples
  can be typechecked.
- **glossary.** A collision asks whether two terms mean the same thing: Jev's
  same / different / unsure, with unsure held as ambiguous.
- **report.** A Jev "same observation" yes still files, with a "possible
  duplicate of #N" link: the skill says "when it is genuinely ambiguous, file
  it".
- **deslop-comments.** Code proves the diff is comments only, and that no TODO,
  pragma or license line went. Judging a comment against code is not Jev's.
- **diataxis.** "What mode is this page?" fits Jev as a review flag, though
  long pages may be past its sweet spot.
- **campaign.** The mermaid node-id rule is pure string work written as prose:
  move it into the verb.
- **skill-doctor.** Has a model grade transcripts. Measured signals would fit
  the lens better: turns, tool errors, reruns, endings reached.

### Where the lens would hurt

- heal-ci and governance: Jev must never turn "unknown" into "safe".
  Default-deny there is deliberate.
- The founder's approval of every epic plan, and his ownership of every
  decision, are gates, not disagreements. No test settles scope.
- The writing aids gain little from being machines. Putting their checks in
  verbs is enough.

## Where Jev fits, across all of them

1. **Duplicates**, shared by report, triage, graduate, plan-epic,
   architecture-audit and wayfinding. "Is X the same as #N? same / different /
   unsure." Same links or proposes a fold, never closes alone; unsure files
   with a link.
2. **A person's reply on a park**, in operate and grilling. "Which option does
   this pick?" The answer only drafts a confirm request; an exact `/pick` from
   the right account moves the lane.
3. **An owner's comment mid-lane.** "Does this change or contradict criterion
   X?" Yes parks with both texts. It only makes the lane stricter.

Runners-up: whether a person's PR thread asks for a change, and escalating an
agent's "this is a fact" to a founder decision.

## Best machines, in order

1. plan-epic with check-epic-plan
2. heal-ci
3. governance
4. wayfinding with grilling as its child machine
5. test-audit

Prototyping is a close sixth: small, but it already works this way.
