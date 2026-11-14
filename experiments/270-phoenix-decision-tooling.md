---
date: "2026-11-11"
summary: "Reading plus four read-only runs. Phoenix finds decisions the same way we do (ADR 0129, which 0008 copied) and still misses them (issues 9132, 7483, 3172). It has three tools we lack: `adr sweep` (ranks decisions by rare shared words in title, gloss and Decision), `adr resolve` (cite only live) and `grill read` (keeps a recommendation apart from a ruling). Its only hard gate is at merge, for governed paths. The sweep ranked the right decisions 2nd and 6th for the Tier 6 miss and found nothing for the pipe-letters miss, whose rule lived only in a direction note. Sweeping the notes too made both worse. Leans: try the sweep as advice (70%), add a lint for live citations (80%), a backlinks list (80%), and move note rules into decision files (85%). The last two became 0115. Agent time only, $0."
---

# 270. What does phoenix's fabrika do to make agents find a decision, and would it have caught our two misses?

Read and run on 2026-11-11. **This is reading, plus four read-only runs of one tool, not an
experiment.** Nothing in either repo changed, no model was called beyond the one agent that read,
and it cost $0 (agent time only; tokens not recorded). The tool read is phoenix's pipeline CLI,
`@kampus/fabrika-cli` 0.10.0 ([kamp-us/phoenix](https://github.com/kamp-us/phoenix), public, also
on npm), run from a local checkout of phoenix 2 commits behind its origin. It is not part of this
repo, in either version. Claims about this repo are about its lead tooling and `.decisions/`, which
both versions share. It is the reading behind the sweep in
[0115](../.decisions/0115-decided-rules-live-in-decision-files.md).

**The answer: phoenix does not find decisions any better than we do, but it has three pieces of
code we lack, and one of them would have caught one of our two misses.**

- Discovery there is the same contract: list `.decisions/` plus frontmatter, no hook, no index
  ([phoenix ADR 0129](https://github.com/kamp-us/phoenix/blob/main/.decisions/0129-adr-discovery-is-the-claude-md-contract.md),
  which our [0008](../.decisions/0008-decision-discovery-is-the-agents-md-contract.md) copied).
  Nothing in phoenix pushes a decision at an agent before it asks the owner a question.
- The three pieces:
  1. `fabrika adr sweep`: ranks the decision files a text is about, by rare shared words in each
     file's title, "What this decides" line and `## Decision` section. Local, read-only, no GitHub
     needed. **It runs on this repo's `.decisions/` as is.**
  2. `fabrika adr resolve`: checks that a decision you cite is live (not superseded, not only in an
     open pull request).
  3. `fabrika grill read`: keeps an agent's recommended answer apart from the owner's ruling, so a
     ruled question shows as ruled and is not asked again in that session.
- **The only hard gate is at merge, and it is narrow.** The governance verdict is required only
  when a diff touches phoenix's "governed roots" (`.decisions/`, `.claude/`, `.github/`, the plugin
  tree, `.fabrika.jsonc`). A product-code diff that walks back a decision never meets it. Its "does
  this contradict a decision" half is a hand read unless the diff adds a decision file.
- **Phoenix still misses decisions** (issues 9132, 7483, 3172, below).
- **Against our two misses of 2026-11-11:** the sweep ranked the right decisions 2nd and 6th for
  the first (a plan placed the pipeline in Tier 6, which [0078](../.decisions/0078-agent-and-flow-slices-start-early.md)
  and [0088](../.decisions/0088-six-slices-in-tier-1.md) had moved). It found nothing for the second
  (a question about cleaning up old pipe letters, which
  [design for bounded objects](../docs/direction/design-for-bounded-objects.md) answers), because
  that rule lived in no decision file and its note never says "pipe" or "letter".

```text
$ settled "How are old pipe letters cleaned up?" --reading docs/plan/tiers.md     # a sketch, not built
ranked decisions (phoenix sweep algorithm, title + gloss + Decision only)
  0103  6.92  A program may send mail to another program's named mailbox ...
  ...
decisions that link docs/plan/tiers.md
  0068  Each tier carries and updates a working slice of every core idea ...
  0078  An agent fabrika starts and a flow fabrika runs join the core ideas ... from Tier 1
  0088  All six core ideas get their thin slice in Tier 1 ...
```

The 0103 row is a real score, from the run below that adds a made-up decision file; the backlink
list is real, from `rg -l plan/tiers.md .decisions`, and shows 3 of its hits (10 then, 14 on main on
2026-11-11).

The `fabrika` CLI read reports `fabrika v0.10.0+91dfd45dd3 (source)`. `governance digest` and
`governance readout`, which the brief for this reading named, do not exist in this version: the
governance group has `scope`, `sweep`, `guards`, `base` and `post`.

## How phoenix does it, piece by piece

Every verb follows one contract: stdout is the answer, a non-zero exit means UNKNOWN, never
"nothing found". That contract is code (exit tables in each verb's help), and it is the habit worth
copying most: a search that failed is never read as "nothing settled".

| Piece | What it does | Reads, writes, needs | Forced by |
|---|---|---|---|
| Discovery (`ls .decisions/` + frontmatter) | Filenames are the map; frontmatter `id`, `title`, `status` is the row. The title carries the ruling, not the topic. | Reads files. Needs nothing. | Prose only (CLAUDE.md). ADR 0129 dropped a SessionStart hook "before it was built"; the on-demand `compact` map died with the old CLI (0129's 2026-08-19 amendment). |
| `adr sweep --new <id or draft path>` | Ranks live decisions by summed `ln(N/df)` of shared rare words, over title + gloss + `## Decision` only (Context and Consequences are left out on purpose). Excludes what the draft already cites. Caps at 8. Answers `shortlist`, `no-overlap` or `indeterminate` (corpus under 10 live records), and says none of them is a clearance. | Reads `--dir` (default `.decisions`, or `decisionsDir` in `.fabrika.jsonc`). Writes nothing. No git, no GitHub. 200 lines in `adr/sweep.ts`, the algorithm written out step by step in the adr contract. | Prose: the adr skill's step 3 says to run it before writing a decision. Born from [phoenix issue 3980](https://github.com/kamp-us/phoenix/issues/3980) ("Nothing sweeps a new ADR against live accepted ADRs"). |
| `adr resolve <ids>` | Prints `live`, `landed` (present but superseded or proposed), `in-flight` (only in an open pull request) or `absent`, with the real filename. | Fetches the base ref from `origin`; lists open pull requests on GitHub for the in-flight set. Needs an origin remote and a GitHub token. | Prose ("cite only live"), checked again by the governance skill. |
| `adr next` / `adr mint` | Next free id: merged files, ids claimed by open pull requests, and ids on local and remote-tracking branches. `mint` writes the file in the same call. | Git fetch, GitHub pull request list, branch refs. Writes one file (`mint`). | Code, plus a CI number lock (`decisions-index.yml`). Not about finding decisions. |
| `grill open / round / answer / rule / read` | A session is a GitHub issue labeled `grilling:session`; each round is a comment of numbered questions, each with a required `**Recommended:**`. `read` computes each question's state: `open`, `answered`, `ruled`, `unattested`, `stale`, `superseded`. A question is `ruled` only when four clauses hold: the marker parses, it names a real question, its author has write access (checked against GitHub's ACL), and an adjacent comment quotes the owner's words **verbatim with a date**. A ruling is bound to a digest of the question text, so rewording the question makes the ruling `stale`. | Reads and writes issue comments and one label on GitHub. Needs a repo token with write. | Code for the state. Prose for the split that matters most here: "fact or decision? Could evidence settle it? If yes, it is a fact and yours, never the owner's." Prose also for "an old quote does not bind a new question". |
| `governance scope / sweep / guards / base / post` | `scope` says whether a pull request needs a governance verdict, from its changed paths against `governedRoots`. `sweep` runs the adr sweep for a decision file in the pull request. `guards` lists removed or changed `<!-- anchor: NAME -->` invariants. `base` serves the skill's own text at the merge base, so a diff cannot judge itself by its new rules. `post` writes the verdict as a comment bound to the head sha and reruns the `governance-floor` workflow. | Needs a pull request number on GitHub, `.fabrika.jsonc` with `governedRoots`, a token with `actions: write`. Writes one comment and one workflow rerun. | **Code, at merge**: `ship gate` refuses a governed-root pull request with no current-head verdict, and the `governance-floor` workflow is a required check. Only for those roots. The contradiction half is a hand read unless the pull request adds a decision file. |
| `wire doc-section --heading <text>` | Prints one Markdown section by its heading, to the next heading of the same depth; ignores fenced headings; refuses a missing (exit 3) or doubled (exit 4) heading. | stdin or `--file`. Writes nothing. Needs nothing. 125 lines. | Used by the skills to load one contract section instead of a whole file. It saves context; it finds nothing. |
| `decision rule / ruling` | Records and reads a founder ruling on an issue, graded by every gate. | GitHub issues and comments. | Code. Rulings live on issues, not in `.decisions/`, which is exactly how 7483 happened. |
| `status settings` | Every config key with its value and where it came from. | Reads `.fabrika.jsonc` and `.fabrika.local.jsonc`. | Not about decisions. |

Two skills add judgment only, no verbs that find decisions: `glossary` (one canonical word per
thing; `glossary lookup` says if a term exists) and `wayfinding` (a map issue for "we keep
re-litigating this"). `graduate` turns a cleared grilling session into one spec issue; it does not
write a decision file.

## Does it work? Phoenix's own record

Phoenix still misses decisions, in the same ways we do:

- [kamp-us/phoenix#9132](https://github.com/kamp-us/phoenix/issues/9132) (open): a founder
  ruling's premise contradicted accepted ADR 0276, and a triager minted acceptance criteria from it
  anyway. The issue says the only corpus check (governance) "grades a diff at review time",
  downstream of where the miss happened. It also says
  [#6511](https://github.com/kamp-us/phoenix/issues/6511) filed the same contradiction before.
- [kamp-us/phoenix#7483](https://github.com/kamp-us/phoenix/issues/7483) (open): a ruling that
  dropped invite-only was made on an issue comment; no ADR recorded it, and two accepted ADRs still
  describe invite-only as live. A ruling outside the corpus is invisible to every tool.
- [kamp-us/phoenix#3172](https://github.com/kamp-us/phoenix/issues/3172) (closed): a `.patterns/`
  doc repeated a claim that ADR 0032 had corrected. A doc outside `.decisions/` drifted from it.
- [kamp-us/phoenix#3980](https://github.com/kamp-us/phoenix/issues/3980) (closed): two live cases
  in one session of a new ADR contradicting an accepted one; this is what produced `adr sweep`.
- The `governance-floor` workflow's own header says two pull requests merged with no governance
  verdict after the floor was "live", because nothing read its answer. Fixed by making it a
  required check.

Not found: any count of how often agents ask the founder a settled question. Phoenix measures none
of that, as far as its decisions and issues show.

## What we could take

The rules here that shape this: no Claude Code hooks from repo tooling (owner, 2026-11-09; 0008);
no GitHub issues on this repo; `.agents/` code follows `next/` rules, TypeScript and Effect
([0033](../.decisions/0033-agents-code-follows-next-rules.md)); try an existing tool before writing
one ([0040](../.decisions/0040-existing-tools-before-hand-written.md)); a rule code can check
becomes code; a blocking check needs its false alarms measured first; and this repo never quotes
what a person typed.

| Phoenix piece | (a) Call it as is | (b) Write a small own version | Lean |
|---|---|---|---|
| `adr sweep` ranking | Works today, read-only, on our `.decisions/` (tested below). Needs `@kampus/fabrika-cli` pinned as a dev dependency or a global install, which a step's Docker box does not have. Its bin is also named `fabrika`, which may clash with `next/`'s own. | A TypeScript and Effect script, about 150 lines plus tests, porting the written-out ranking (it is a plain idf sum; the spec is exact). 0040 asks to look at widely used search libraries first: MiniSearch or lunr give BM25 with field weights, which would also handle long notes better. | **(a) now, for a measured trial, then (b)** once it should run in boxes or block. Why: zero code to learn whether ranking helps; 0040 is satisfied by measuring the existing tool first. Cost: one pinned dev dependency. 70% sure. |
| `adr resolve` (cite only live) | Needs GitHub pull request reads; fine, but only answers for ids you pass. | A `pnpm lint` check over every Markdown link into `.decisions/`: target exists, and status is not `superseded`. About 80 lines. This is the "rule code can check becomes code" case: today it is prose in our adr skill's step 5 (`.agents/skills/adr/SKILL.md`, "Cite only live decisions"). | **(b)**. Small, local, no false alarms by construction. Does not touch either miss. 80% sure. |
| `adr next` / `mint` | Works with git and `gh`. | Not needed for the misses. | **Skip** for this problem. Number clashes are a separate, small annoyance. 75%. |
| `grill` sessions | Fights two rules: it writes GitHub issues on this repo, and `grill rule` requires the owner's words quoted verbatim, which this public repo forbids. | The idea only: a plan's open question carries a kind, `fact` or `decision`, and `plancheck.sh` refuses a `fact` question ("could evidence settle it?"). A few lines in the plan check plus one line in the plan skill. Rulings already land as decision files the same turn ([0001](../.decisions/0001-decisions-live-in-the-repo.md)). | **Skip the CLI; take the fact/decision split.** It sharpens the open questions test we already have. 65%: the split is still the agent's judgment, so it only helps if agents label honestly. |
| `governance scope/guards/post` | Built on pull request numbers, comments, a workflow rerun and `governedRoots`. Our `governance.sh` already lists decisions a diff's words touch. Calling phoenix's would add a second gate design. | Improve `governance.sh`: rank by rarity, as the sweep does, instead of raw shared-word counts, which over a whole diff lists many files. The study called it a Python script; **wrong**: on main on 2026-11-11 it is a shell script (`.agents/skills/lead/scripts/governance.sh`), which moves to TypeScript when touched ([0113](../.decisions/0113-no-shell-or-python-scripts.md)). | **(b), later.** It acts after the work is written; both misses happened before. 70%. |
| Anchored invariants (`<!-- anchor: NAME -->`) | Needs the guards verb on a pull request. | A lint that a removed anchor needs a decision file in the same pull request. | **Skip for now.** Not about finding decisions. 70%. |
| `wire doc-section` | Works as is, stdin only. | 125 lines, or `mdq`- or `markdown-section`-style tools. | **Skip.** It reads one section; both misses were reading the wrong part or the wrong file. 75%. |
| (Not phoenix) backlinks: which decisions link the file I am reading | n/a | `rg -l <path> .decisions` with titles printed. About 30 lines inside the `settled` check. | **(b), in the first step.** It is what catches the Tier 6 miss without guessing words. 80%. |
| (Not phoenix) corpus coverage | n/a | Move the decided rules of direction notes into decision files, as 0001 says ("Old decisions are not copied in yet", `0001:37`). On 2026-11-11, 133 of our 149 direction notes said "decided" in their first lines, and 73 of those were linked from no decision file. | **Yes, steadily, one decision per pull request.** No tool finds a rule that lives only in a long note. 85%. |

One more gap found on the way: a search tool the lead used outside the repo searched `docs`,
`experiments`, `field`, `.glossary` and `AGENTS.md`, but **not `.decisions/`**, and step agents in a
box could not run it at all.

What happened next, on main: 0115 took the corpus row (decided rules move into decision files,
as seven docs pull requests; its own inventory counted 85 notes in scope by a different method) and
the sweep as advice in the plan check ("It blocks nothing until its false alarms are measured").
As of 2026-11-11 the plan check has no sweep yet (`.agents/skills/plan/scripts/plancheck.sh`).

## The smallest first step, against the two misses

The step the reading proposed: a read-only `settled` script in `.agents/` (TypeScript, Effect), run
by any agent before it asks, and printed by `plancheck.sh --draft` as advice for each open question,
in the shape sketched at the top. Advice only until its false alarms are measured, as AGENTS.md asks
of any check.

What ran, read-only: `fabrika adr sweep` against our real `.decisions/` (105 files then) and a draft
file written outside the repo.

| Miss | Draft wording | Result | Would it have caught it? |
|---|---|---|---|
| Tier 6 | "The pipeline belongs to Tier 6" | `shortlist`: 0078 ranked **2nd** (11.41), 0088 **6th** (8.97), 0064 first | **Yes**, if the agent reads the top 8. Backlinks catch it with no ranking: 0078 and 0088 were among the 10 decisions that linked `docs/plan/tiers.md`. `tiers.md` also cites both right above its table (`tiers.md:11-12`): the agent read the table and skipped those lines. |
| Pipe letters | "How are old pipe letters cleaned up once a pipe has delivered them" | `shortlist`: 0020, 0103, 0041 ... nothing about bounded objects | **No.** The rule ("nothing is ever dropped to stay under a cap", "old ledger stretches are sealed") lived only in `docs/direction/design-for-bounded-objects.md`. No decision file's title said it; 0020 and 0038 only link the note in passing. The note never uses "pipe" or "letter". |
| Pipe letters, sweep over notes too | Same drafts, corpus = decisions + every `docs/direction` and `docs/plan` note (260 files) | Long notes swamp the ranking: the bounded-objects note did not appear in the top 12, and for the Tier 6 draft 0078 and 0088 fell out of the top 12 | **No, and worse for the other miss.** The algorithm assumes short decision files. |
| Pipe letters, if a decision file existed | Same corpus plus one made-up decision titled "No object grows forever ... nothing is ever deleted or dropped to stay under a cap" | Ranked **4th** for the first wording and **2nd** for the bare question "How are old pipe letters cleaned up?" | **Probably**, once the rule is a decision file. Doubt: the reader wrote that made-up title knowing the question, so its words ("old", "cleaned up", "deleted") may be kinder than a real title would be. |

So the first step catches the Tier 6 miss two ways. For the pipe-letters miss, what catches it is
corpus work, not a tool: the bounded-objects rules become decision files. Even then, a word search
only works if the agent knows a pipe's letters are ledger data that grows. That link is judgment
the tool cannot supply; a glossary row for "letter" that says where letters are stored would help
it.

## What it cannot tell us

- How often agents here ask settled questions at all. Two misses from one day are not a rate. A
  trial would log, per plan, each open question and whether a ranked hit already answered it.
- Whether agents would read the shortlist. Phoenix's skills say "none of the three outcomes is a
  clearance", and its issues show misses anyway.
- How the sweep does on a real question an agent wrote, as opposed to two drafts the reader
  phrased. An agent's wording may share fewer rare words.
- The false alarm rate. Two queries were looked at. Most of each shortlist was noise (0020, 0041,
  0033 for pipe letters); that is fine for advice and far from the about 0% a blocking check needs.
- Whether `@kampus/fabrika-cli` 0.10.0 installs and runs cleanly inside a step's box, and whether
  its `fabrika` bin clashes with `next/`'s. Not tried; installing was out of scope.
- Anything in phoenix newer than the checkout read (2 commits behind its origin), or anything
  phoenix decided outside its repo.
- The decision counts are from 2026-11-11 morning (105 files); main has grown since, and the runs
  were not repeated.
