---
state: "proposed 2026-11-08; walked at Tier 6"
summary: "Proposed for `next/`: an agent hands back a change; code checks, commits and signs it, using one list of roles. Today's tooling adopts only signing at fetch early, owner, 2026-11-08. Agents still commit; removing Git from their tools and adding roles remain proposed. *Changed 2026-11-13 (owner, [0161](../../.decisions/0161-no-step-signing-by-hand.md)): today's tooling stops signing.*"
---

# Code commits and signs each step

**Proposed 2026-11-08.** `next/`, walked when Tier 6 starts, where the pipeline's steps land. It
builds on [a unit of work is a commit](./a-unit-of-work-is-a-commit.md) and comes from one day of
steps run by hand in today's version. One rule walks a decided line back: who holds a step's key
(rule 1).

Owner, 2026-11-08: today's hand-run tooling adopts signing at fetch early. Agents still commit,
and MAIN checks saved run bounds and owners before signing missing notes. Existing commit-and-sign
calls remain valid. This note stays proposed for `next/`; the call approves neither removing Git
from agent tools nor adding signing roles. Mutation still uses the tests key.

Owner, 2026-11-13 ([0161](../../.decisions/0161-no-step-signing-by-hand.md)): today's hand-run
tooling stops signing, so the paragraph above no longer holds for it. This note stays proposed for
`next/`.

```ts
// A sketch, next/. One step program, after its agent answers. The agent ran no git and holds no key.
// tea's Msgs keep `type`; our outcomes are `_tag` unions with the five verbs.
type Msg =
	| {type: "drafted"; change: Change} // Draft: the agent hands back files, nothing else
	| {type: "committed"; sha: string; link: Link} // Act: code committed and signed, as this step
	| {type: "commit_failed"};

const update = (m: Model, msg: Msg): [Model, Cmd<Msg>] => {
	switch (msg.type) {
		case "drafted": {
			const paths = msg.change.files.map((f) => f.path);
			const exam = m.step === "build" ? paths.filter(isExam) : []; // Check, pure
			if (exam.length > 0) return end(m, {_tag: "ask", who: "owner", for: "exam_touched", paths: exam});
			const foreign = paths.filter((p) => m.plan.owner(p) !== m.step); // the plan said who owns each file
			if (foreign.length > 0) return end(m, {_tag: "send", to: "planner", why: "owner_unknown", paths: foreign});
			// One Act: stage these paths, commit as the bot, sign the link as `m.step`. No second command.
			return [{...m, state: "committing"}, commitAndSign({step: m.step, ticket: m.ticket, from: m.tree, change: msg.change, intent: intentOf(m.ticket, m.step, m.round)})];
		}
		case "committed":
			return end(m, {_tag: "done", sha: msg.sha});
		case "commit_failed":
			return end(m, {_tag: "stuck", why: "commit_failed"});
	}
};
```

The idea in one line: a step's agent drafts, code checks, and code commits and signs in one Act, so
an unsigned or wrongly owned step commit cannot be made.

## The evidence

126 step-agent reports in one day, all in today's version with the steps run by hand. About 21 were
signing problems. None was a forged or wrong signature: the keys and the check did their job. Every
problem was in how the signing was driven. The count is field note 2026-11-08-20.

| Count | What happened | Field note |
|---|---|---|
| 7 | A builder stopped because its plan gave it an exam path: a lint plugin, a `pnpm patch`, `pnpm-workspace.yaml`, an old test with type errors | 2026-11-08-15 |
| 10 | Commits left unsigned because the lead's brief said not to sign; the lead signed them all as `lead` at landing, so which role wrote each is lost | 2026-11-08-11 |
| 3 | Stale or broken chains: a dropped attempt's links stayed on `refs/notes/fabrika`; a test writer told to `git reset --soft HEAD~1` to take over a builder's commit, which made 7 `build` links stale; `main` moved ahead with no merge (`broken_chain`) | 2026-11-08-04, 2026-11-08-18 |
| 1 | The mutation step had no role to sign with | 2026-11-08-19 |

Three causes sit under all 21:

- **Who owns a file was first known when the builder hit it.** The plan did not say.
- **Signing was a second command.** An agent ran `git commit`, then ran the signing tool or did not.
- **History rewrites break links bound to a commit.** A reset or a dropped attempt left signed
  links that no longer matched the branch.

**The builders stopped instead of taking the route that exists.** Today's pipeline already handles a
builder that touches the test writer's files (below, rule 2). The lead's hand-written briefs never
told the builders about it, so each one stopped with free text. That is a lead-brief gap, not a gap
in the decided design, and it is why rule 4 has briefs made from the same list as the keys.

## What today's version changed the same day

The lead changed today's hand-run steps on 2026-11-08:

- Plan writers' file tables now name an owner step for each file, and a script lists every exam
  path a plan names before it is approved.
- One wrapper command stages named paths, refuses a `build` commit that holds an exam path, commits
  as the bot and signs. Agents no longer run the two steps apart.
- Handoffs only append commits. Nobody resets a branch to take over a step's work.
- The mutation step signs as `tests` for now, a stopgap until it has a role.

These are fixes in today's version. The rules below rethink them for `next/`
([rethink, do not port](./rethink-do-not-port.md)).

## The rules

### 1. A step's agent never runs git or the signing tool

The agent hands back a change (a Draft). Code Checks its paths against the exam list, then Acts: it
commits as the bot and signs the link as that step, in one Act with one intent. There is no command
that commits without signing.

- **Already decided or built:**
  - Code makes the commit in today's pipeline: the build's tools and the test writer's program call
    `work.commit` on the agent's files (`packages/pipeline/src/stages/pipeline/tools.ts`,
    `packages/pipeline/src/stages/test-writer/program.ts`).
  - The build's exam check before that commit is built too: a change on the test writer's files
    fails `exam_touched` before `work.commit` runs (same `tools.ts`).
  - Bot authorship is decided in [agents commit as a bot](./agents-commit-as-a-bot.md). What a step
    signs, the link and its fields, is decided in [a unit of work is a
    commit](./a-unit-of-work-is-a-commit.md).
- **New:** signing joins the same Act, and the key moves from the agent to the step program.
- **It walks back one decided line.** [A unit of work is a commit](./a-unit-of-work-is-a-commit.md)
  says "each step's agent signs its commits with its own key", and its Tier 1 section starts each
  step's agent with its own role's key. Here the step program holds the key and the agent never sees
  it. The proof still names the step. It no longer claims an agent held a key.
- **It also narrows one decided line for pipeline steps.** [Agents commit as a
  bot](./agents-commit-as-a-bot.md) keeps plain `git push` and `gh` for agents in a box. A pipeline
  step's agent would no longer commit or push at all. A summoned agent outside the pipeline keeps
  plain git. That note's open item 2, "who writes the trailers", gets an answer for steps: the code
  that commits writes them.
- **Lean: 85%.** Why: both causes it removes (a skipped second command, a key in the agent's reach)
  were real today, and the commit half is already how today's pipeline works. It costs one Act in
  `next/`'s step program, a guess at 150 to 250 lines with its tests, about 0.3 to 0.5 agent hours.
  The doubt: a step that needs several commits, such as a test writer's exam commit and its test
  commit. A Draft that hands back an ordered list of changes covers it; one real P-row with two
  commits would show whether that is enough.
- **What holds it:** a type and a refusal. The agent's tools have no shell git and no key file in
  reach. The step program's only commit Cmd takes a step and signs, so an unsigned commit has no
  code path. P32's check already answers `stuck: unsigned_commit` for any that slips in.

### 2. Who owns each file is settled when the plan is approved

The plan's files table names each file's step. Code checks it against the exam list before the plan
can be approved, so a plan that gives `build` an exam path goes back to the planner
(`send:planner:exam_owner`), and the owner's read of the exam paths comes before the build, not after.

```ts
// A sketch, next/. The plan approval's Check. Field names from the plan's files table.
const FileRow = Schema.Struct({path: Schema.String, step: Role, why: Schema.String});

const ownerCheck = (rows: ReadonlyArray<typeof FileRow.Type>): Outcome => {
	const wrong = rows.filter((r) => r.step === "build" && isExam(r.path)).map((r) => r.path);
	if (wrong.length > 0) return {_tag: "send", to: "planner", why: "exam_owner", paths: wrong};
	const exam = rows.filter((r) => isExam(r.path)).map((r) => r.path);
	return exam.length > 0 ? {_tag: "ask", who: "owner", for: "exam_read", paths: exam} : {_tag: "done"};
};
```

- **Already decided or built, and this rule only builds on it:**
  - The builder never changes the exam, and changing it is the owner's call
    ([nobody writes their own exam](./nobody-writes-their-own-exam.md)).
  - A `build` commit that touches an exam path is `stuck: build_touched_exam` (Tier 1's P32, built
    in `next/apps/fabrika/src/exam/commits.ts`).
  - Today's pipeline already has the route for a builder that changes the test writer's files: the
    build's work is held as its own commit, and a person is asked "which was wrong: the builder, or
    the test?" (`exam_touched`, with `exam_conflict` for main changing them, in
    `packages/pipeline/src/stages/pipeline/routes.ts` and `machine.ts`; the held commit in
    `program.ts`). `builder_wrong` puts the tests back; the other pick sends it to the test writer.
- **New:** the files table names a step per file, and code checks it at plan approval. The same ask
  then comes before the build, when it is cheap, instead of after a build round was spent.
- **A builder that still finds it needs an exam file** takes the built route above, not a
  free-text stop. Under rule 1 it cannot stop wrongly: it hands back its change, and code's Check
  ends the step on the decided ask.
- **Lean: 80%.** Why: 7 of 21 problems were an exam path found mid-build, and each one's file was
  knowable when the plan was written. It costs a `step` column in the plan's files table and one
  pure check, a guess at 80 to 120 lines with tests. The doubt: a plan cannot foresee every file. A
  build that needs a file no row names goes back to the planner (`owner_unknown` in the opening
  sketch), and if that happens often it costs a round each time. A count of such sends over one tier
  of real plans would settle it.
- **What holds it:** a test on the plan's schema (no row without a step) and the check above, run by
  code before approval.

### 3. A takeover appends

When one step takes over another's work, it commits on top. No step and no lead rewrites a pushed or
signed history by hand. The code that signs picks the link's `version` from what is already on
`refs/notes/fabrika`, one past the highest for that ticket and step, so a dropped attempt's links
are never the newest.

```ts
// A sketch. Recorded wide when an attempt is dropped; the check needs no new rule to ignore it.
{_tag: "dropped", step: "build", ticket: "t-255", to: "c7a8f55", why: "replaced", by: "lead", arrivedAt: "14:02:11"}
```

- **Already decided:** only a step's newest signature for the ticket counts (p89, in [a unit of work
  is a commit](./a-unit-of-work-is-a-commit.md)). A branch catches up by merging `main` in, never a
  rebase or a force-push, and a stage that must replace a branch keeps the old head under a kept ref
  first ([read fresh, run alone](./read-fresh-run-alone.md)). The rebase that a later row allows is
  carried by replay, with kept refs (experiment 221). This rule does not walk any of that back.
- **New:** a takeover is a new commit by the new step, never a reset. The signer, not the agent,
  picks the version. A dropped attempt is recorded as a `dropped` entry, so a reader knows why its
  links are not in the chain.
- **Lean: 80%.** Why: both stale chains today came from a rewrite by hand, and p89 already does the
  rest once versions only go up. It costs the version pick inside rule 1's Act and one entry shape,
  a guess at 40 to 60 lines. The doubt: whether a `dropped` entry needs a signature of its own. It
  cannot make a bad commit pass, since the chain must still be whole, so the lean is no; a case where
  a reader is misled by an unsigned one would change that.
- **What holds it:** the step program has no reset Cmd, and a test plants a reused version and sees
  `stuck: stale_link`.

### 4. One list of roles feeds the briefs, the keys and the check

One list names every role that signs. The step programs, the brief each agent gets, the keys file
check and the commit check all read it, so a step with no role cannot start.

```ts
// A sketch, next/. Today the list is ROLES in commits.ts, with three roles.
export const ROLES = ["tests", "build", "mutation", "lead"] as const;
const BRIEFS: Record<Role, Brief> = {...}; // the compiler refuses a role with no brief
// keysProblem(allowed_signers) already fails a keys file that misses a role (p87).
```

- **Already built:** `ROLES` in `next/apps/fabrika/src/exam/commits.ts`, and p87's keys file check
  fails when a role has no key. Today's pipeline has its own list of steps (`STEPS` in
  `routes.ts`), apart from the signing roles.
- **New:** the step programs and the briefs read the same list, and `mutation` becomes a role. A
  step that makes no commit, such as mutation, signs a link with `from` equal to `to`, the fix 2026-11-07-03
  proposed, so its result sits in the chain instead of only in `field/`.
- **Lean: 85%.** Why: the missing mutation role and the briefs that never named the exam route are
  both two lists that drifted. It costs one role, one key, one row in `allowed_signers` and a typed
  briefs table, a guess at 60 to 100 lines. Adding a role touches `allowed_signers` and changes p87,
  both exam paths, so that change is the owner's read. The doubt: whether a `from` equal to `to` link
  confuses the chain walk. A planted test on P32's check would settle it before the role is added.
- **What holds it:** a type (a `Record` over `Role`) and p87's existing refusal.

### 5. The lead's merge of `main` is its own signed step, made by code

When `main` moves, code merges it into the branch and signs a `lead` link from the old tree to the
merged one, on every merge, before the pull request can land.
*Changed 2026-11-11 by [0098](../../.decisions/0098-the-signed-chain-covers-the-branch-not-main.md):
a branch behind `main` is no longer refused for that, so the merge is not needed before it lands; a
merge that is made is still a signed `lead` link.*

- **Already decided:** the branch catches up by merging `main` in, as a `lead` link ([a unit of work
  is a commit](./a-unit-of-work-is-a-commit.md), "When `main` moved"). Today's pipeline already
  merges `main` in by code at its fresh read, and sends a conflict on the test writer's files to the
  test writer (`exam_conflict`) and one on the builder's files to the builder (`conflicts`).
- **New:** only that the merge goes through rule 1's one Act, so it is never made by an agent or by
  hand, and is never left unsigned.
- **Lean: 75%.** Why: the one `broken_chain` today was a merge from `main` nobody made. It costs
  little on top of rule 1. The doubt: a merge with conflicts is not something code can finish. The
  built routes send it to a step, and that step's fix lands as its own signed commit after the
  `lead` merge. Whether a conflicted merge commit should be signed as `lead` before the step fixes it
  is open; one real conflict on a Tier 1 row would show it.
- **What holds it:** P32's `broken_chain` answer, and a test that a pull request behind `main` gets
  a `lead` link from code before it can merge. *Changed 2026-11-11 by
  [0098](../../.decisions/0098-the-signed-chain-covers-the-branch-not-main.md): the check no longer
  answers `broken_chain` for a branch behind `main`, so this holds only a merge that is made.*

## Where it differs from settled notes

- **Rule 1 walks back** "each step's agent signs its commits with its own key" in [a unit of work is
  a commit](./a-unit-of-work-is-a-commit.md): the step program signs, the agent never holds a key.
- **Rule 1 narrows** "agents keep plain `git push` and `gh`" in [agents commit as a
  bot](./agents-commit-as-a-bot.md), for pipeline step agents only.
- **Rule 2** moves the decided exam ask earlier, to plan approval. The build-time route stays as
  built.
- **Rules 3, 4 and 5** add to decided notes and undo nothing.

## What it cannot tell us

- **The day ran today's version by hand.** No `next/` step program exists yet, so the counts show
  what a lead's briefs and an agent's habits get wrong, not what a step program would.
- **About 21 is a hand count** from free-text reports. The exact split may be off by one or two.
- **A key held by the step program is still on the laptop in Tier 1.** Every process runs as one
  user, so this note does not close the doubt in [a unit of work is a
  commit](./a-unit-of-work-is-a-commit.md) about a builder reading a key. It moves the key out of the
  agent's tools; Tier 5's boxes close it.
- **Nothing here was tried as code.** Each lean comes from one day of evidence. A first Tier 6 step
  program built this way, on a real ticket, is what would test them.
