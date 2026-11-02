# Tier 1: the first pass of the new fabrika

**This is the input for the plan step. A planner turns it into the project's real plan: stories and small pull requests.** The owner approved what Tier 1 builds and why on 2026-11-01. That approval does not cover the breakdown. The owner approves the planner's output before any builder starts. Nothing here is built, and later tiers stay proposed.

Every claim is about `next/` at [PR 223](https://github.com/usirin/tea-fabrika/pull/223)'s head (`7c1d073`), unless it says "today's version". The full design, the laws and the reasons are in [`tier-1-detail.md`](./tier-1-detail.md). [The map](#where-the-detail-is) says where. This page fits a ticket's body (the limit is 65,536 characters, `packages/pipeline/src/tickets/ticket.ts:32`). The detail file does not, so a ticket has to name it.

```ts
// The whole idea, as one sketch. A window proves who it is, its person lets it in, a press lands
// once, a note's save is one fact, and a program that breaks things on purpose only asks; code does the breaking.
const key = yield* ClientKey;                             // WebCrypto in a tab, the app's window key in Electron
send(initialize({key: key.publicKey, signed: yield* key.sign({nonce, url, tab})})); // unknown key: {why: "not_granted"}, then a code
// the person, once per browser: same code in the tab and the menu bar, Approve, a finger. One `granted` fact.
yield* Mailbox.send("counter:1", id, {type: "plus"}, who);  // Effect<Place, LedgerError>, `by` from the key
// the first real program. An agent saves through MCP and a person reads it drawn. A save on an old version
// is refused and writes nothing, for a window and an agent alike:
yield* Mailbox.send("notes:1", id, {type: "save", value: {note: "n-7f3a", base: 3, body}}, who);
// the chaos program stays pure Elm. Its update only returns data:
return [armed, [{type: "fire", fault: Fault.cases.abort.make({target: "gateway", name}), tick}]]; // the runner saves it, then a service fires it
```

## What to write

**The owner wants a project plan: stories at the top, then small tasks, each one small pull request.** A tier is a project ([a project is a parent plan](../direction/a-project-is-a-parent-plan.md)). Where this differs from the plan brief, which is written for one ticket, this is what the owner asks for here. Say so in `gaps`.

- **Stories stay at the project level.** A task is a plain task: what changes, how we know, what it needs first. This is close to [how Linear works](https://linear.app/method/write-issues-not-user-stories): it talks about the customer's experience at the project level and writes issues as plain tasks. Linear goes further and drops user stories altogether. We keep them, one level up.
- **Each task lands alone.** Its checks are green when it lands. From the first working demo on, the demo keeps working after every task. The unit is one cluster of laws or one step of a demo. No line limit has been set, so do not invent one, and no task count is the right one. Say how big each task is, in files and lines.
- **The laws stay in the detail file.** Tier 1 has about 65 laws and 17 criteria. Each task names the ones it owns, written as "detail p26", since the lane renumbers a plan's own Properties from p1 (`stages/pipeline/program.ts:232`). This plan has no Properties or `interface` of its own: a project-wide test could not go green in any one small pull request. Each small ticket's own plan step writes its laws and names out in full.
- **The proof of the whole project is the `goal`:** [the checks below](#what-done-looks-like), as its criteria, in a user's words, with commands in `check.what`. No lane judges a goal that spans tickets, and the cloud checks run after a landing. So the owner closes Tier 1 by hand, on a run logged in `field/`. My call, 75%. The planner gap may change this.
- **The breakdown below is a starting guess.** Change it where you have a reason, and say the reason. Do not change what Tier 1 builds. A scope change goes in `questions`.

**In today's shape.** All of this is today's version. A task holds only `title`, `ends`, `job` and `criteria`, so:

- Each landing is `ends: "pr"`, and each spike or design pass is `ends: "answer"`. The detail's `ends: local commit` is not a value, and came from the older one-PR cut.
- What a task needs first, its size and its law numbers go in `pointers`, one entry per task, with the task's title as `at`.
- A task with no user, such as a rule or a move, has a read or typecheck check as its job, as the brief allows.
- An exam PR is a task, marked by hand. Leave `exam` empty on this plan: the lane acts on that list right after a yes, and it cannot hold exams for three different times. Each small ticket's plan lists its own. My call, 75%.

**What today's plan step cannot do.** It writes one `planned` fact for one ticket (`packages/pipeline/src/stages/pipeline/program.ts:275`), its Check says all the tasks land in one pull request (`stages/plan/check.ts:265`), and no stage files a new ticket. So one plan cannot yet become several small tickets. [PR 279](https://github.com/usirin/tea-fabrika/pull/279) records the owner's decision on this flow (`docs/direction/free-form-plan-to-planner.md`, not on main when this was written) and sizes that gap: about 7 files, 6 to 10 agent hours, sure 50%. It is built as its own ticket after ticket 117, and then the plan step may have fields for all of the above.

**Either way, write the plan.** If the gap is not built when you run, use today's shape, and make it your first question. What stops is the lane, not you: [the first question](#open-questions) says how.

## What you can see

- **Your folder is a copy of main, with no history and no network.** You have Read, Grep and Glob, and nothing else (`stages/pipeline/agents.ts`, `stages/plan/planner.ts:133`).
- **`next/` is not in it.** Nothing from `next/` is on main. You cannot read PR 223, and `git show` will not work. What you need from it is written in the detail file: [every file with its lines, and the moves](./tier-1-detail.md#pr-223-file-by-file), and [the public interface](./tier-1-detail.md#the-public-interface).
- **Today's code is in it,** so the sources of the named copies can be read: `programs/markdown/src/`, `packages/fabrika/src/mcp/tools.ts`, `apps/fabrika/src/window/window.css`. The commits the detail names cannot be read from your folder, and line numbers named at them can be a little off. `root.ts`, `highlight.ts`, `tools.ts`, `drive.ts` and `serve.ts` have not changed since `2c29c13`. A copy names the commit it really came from, which may be later.
- **The lane gives you no notes.** Its `decisions`, `code_context` and `names` slots are empty (`stages/pipeline/program.ts:258-260`). So [Rules that bind](#rules-that-bind) names the notes.

**PR 223 in numbers:** 3,323 added lines in 43 files, none deleted. It conflicts with main, and main has moved 36 commits past its base and counting. It uses `kind`, `is` and 53 lines that say `peer`, has no `_tag` and no `xOf` names, and has about 60 lines that use Promises, by plan-115's rough count. So it fails the first exam's rules as it stands.

## Who it is for

**One person and their agents.** A second person comes in Tier 3. Each person answers for their own agents, so this tier does not defend against them. The door stays real all the same: an unknown key is refused, on the laptop and on the cloud.

**The moments, in the order they happen:**

1. **The first open.** The owner opens the one app, types their name and clicks Start. A window comes up with no prompt. The menu bar is part of the app, and the app starts the brain as a plain service.
2. **A new browser.** A tab shows a code and waits. The menu bar shows a row with the same code. Approve and a finger, and the tab is online with no reload. A second tab of that browser needs nothing.
3. **Every day.** Opening fabrika asks nothing.
4. **An agent writes a doc.** The owner adds it once with `claude mcp add`, and approves its name once. It saves through MCP, and its name stays on what it writes. It can never let anyone in or write as the owner.
5. **The owner reads it drawn,** in another window, or on a phone tab on Cloudflare. `e` shows the plain text box, and they adjust it.
6. **Two writers disagree.** The agent's next save, on the old `base`, is refused and writes nothing. It reads and saves again. If the person is the stale one, "Keep mine as a new note" keeps both texts. No saved text is ever lost.
7. **Something goes wrong.** The Wi-Fi drops or the brain restarts, and a press still lands once. If the app dies, the other windows keep working, and only new approvals wait.
8. **Taking one back.** Remove in the menu bar takes out a let-in window or agent, with the same check as Approve.
9. **A lost Mac.** The text is safe on Cloudflare. A backup sheet brings the same notes back on a new Mac.
10. **Breaking it on purpose.** A run with a seed, on a throwaway ledger, ends with a verdict on the screen, and can be read back months later.

**Stories:**

- **s1:** the owner wants the brain built on Effect with strict layers, so nothing rests on Promises and every layer can be replaced.
- **s2:** the owner wants laws they can read, so a green run means something without reading the diff.
- **s3:** a person at a window wants the same speed and the same recovery as before.
- **s4:** the owner wants nothing to join their fabrika unless they said so, on the laptop and on the cloud alike.
- **s5:** the owner wants a browser tab and an Electron window to be the same client in different clothes.
- **s6:** the owner wants the same stack one command from Cloudflare.
- **s7:** the owner wants to break the running thing on purpose, watch it recover, and read what happened months later.
- **s8:** a person wants to open one app and have everything run, with one click and a finger when a new window asks in, and no prompt when opening fabrika.
- **s9:** the owner wants an agent to write a doc, to read it drawn in any window, a phone included, and to adjust it, and never lose saved text, even if two writers disagree.
- **s10:** a person wants to remove a let-in window or agent from the menu bar, without a terminal.
- **s11:** the owner wants to let a named agent in once, see its name on what it writes, and know it cannot let anyone in or write as them.
- **s12:** the owner wants the library, the desktop and each program to stand as packages, so a program can only use what the library really offers, and nothing in `next/` can lean on today's code.
- **s13 (new, since the backup had no story):** the owner wants to lose a Mac and get the same notes and the same fabrika back on a new one, from a sheet they keep, without a new ledger.

## What done looks like

**Tier 1 is done when each check below passes where it says, and the whole demo works in a browser tab and an Electron window, on the laptop and on Cloudflare** ([the rule](./tiers.md#the-rules)). Each runs with `pnpm typecheck`, `pnpm lint` and `pnpm test` green. Every law in [the detail file](./tier-1-detail.md#properties) has to pass too, named below or not. These commands do not exist yet. Tier 1 builds them.

```sh
pnpm exec vitest run next/                 # the laws that run on Node
node next/apps/fabrika/e2e.ts              # the exam's thin runner, over each landing's e2e/*.test.ts
node next/apps/fabrika/dev.ts --port=N --founder=<key.pub>    # a brain for agents and tests
alchemy plan                               # read by the owner, and a yes, before any deploy
node next/apps/fabrika/chaos-drill.ts      # a run on a throwaway ledger, to a verdict
```

1. **The door.** Two tabs of one browser show one code, and one terminal command lets both in, on the local stage. An unknown key gets `not_granted` and writes nothing. (p26 to p29, p43)
2. **The speed and recovery bar.** A press in one window shows in the other, a restart loses nothing, and the numbers are measured on the new stage, base and head in one sitting. The first stage landing has no base, so its own run sets the first numbers. (p10 to p15, p17, p22)
3. **The app.** A temp home: founding screen, a window, "Open in browser" brings a tab online, a tab typed by hand comes in with Approve, Remove takes it out. Kill the app, and the counter keeps working. The owner opens the built app twice and sees no prompt. (p31, p44 to p51, p66, c13)
4. **Cloud.** The same, on Cloudflare, with the same approval flow, in one built file, after the owner reads `alchemy plan` and says yes. (p33, p41, c10)
5. **Notes.** On Cloudflare: an agent runs `notes_save` through MCP, let in once. The doc shows drawn in another window and on a phone tab. The owner presses `e`, adjusts and saves. The agent's next save on the old `base` is refused, and it reads and saves again. Raw HTML is never drawn. (p52 to p59, p61 to p64, c14 to c17)
6. **Backup.** See [The backup](#the-backup-needs-a-design-pass-first). Its checks are written in that pass.
7. **Chaos.** A run with a seed ends in a verdict on each stage, pressing the counter and saving notes while faults fire. A planted bug is caught. A build for the real ledger has no chaos in it. (p34 to p39, p60, c11, c12)
8. **The shape.** Each package stands alone, nothing in `next/` imports today's code, layers point one way, and no Promise, no hand-written `_tag` and no `xOf` name passes lint. (p24, p32, p65, the exam's rules)

**Only a person can pass these:** the real finger, "no prompt appeared", and the first real use on the phone. Tests use a test `PersonCheck`, and the run goes in `field/`.

**A deploy is not a lane step.** No box has a key. So a check on Cloudflare runs after its pull request lands, from main, by hand, with the owner's yes, and it is logged. The pull request ends with the local half green. My call, 80%.

**Laws that Tier 1 cannot run.** T0 deletes the desk program, so plan-115's p6 and p7 test nothing and come back with the desk in Tier 2. p4 and p9 change with it. [The detail file](./tier-1-detail.md#properties) says how.

## What is out

- **Later tiers:** `fabsh`, pipes, the tracker, the desk, split and close, prefix keys (2). A second person, invites, the full Windows list, typed codes (3). Hands, leases, `kill -9` through real hands (4). Agents in a box, spend, the `claude` and `codex` programs (5). Drag, workspaces, palette, reconnect tested hard, typing in place, tabs and search for notes (6). Apple signing, auto-update, Windows and Linux as an app, others' programs (7).
- **In notes:** formatted typing in place, tabs, comments, search, sharing, live co-editing, any CRDT, and deleting a note.
- **Security:** no defense against a person's own agents, and no passphrase key.
- **Accounts:** nothing new to pay for. Dev builds use a self-made card, and the cloud stays on the account already in use.
- **Publishing:** nothing is published. Real package names, one workspace.
- **Today's version:** no change, except what this plan needs and does not build itself: [guarding the exam files](#rules-that-bind), the planner gap, and, if the owner says so, [fast mutation and a daily run](#open-questions). `next/` never imports it.

No fact is lost by waiting on any of these. The check is in [Later tiers](./tier-1-detail.md#later-tiers).

## Rules that bind

Read [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) first. It holds for all of this. Where two notes clash, the newer holds, and the clash goes in `questions`.

**How `next/` is written:**

- **Effect all the way.** A Promise appears only in a one-line edge the platform demands ([no Promises](../direction/no-promises.md)).
- **An object class stays thin:** what the platform gives it and a one-line handoff. The logic runs on Node in tests ([the note](../direction/object-classes-stay-thin.md)).
- **A window reads state through one `useSyncExternalStore` hook.** State lives in a tea machine, never `useState`, and tea's `useMachine` is not used ([Elm first](../direction/elm-first.md)). PR 223's `window/main.tsx` still uses `useRuntime`, so this has to change.
- **`_tag`, written by Effect Schema, for every union we define.** tea's Msgs and Cmds keep `type`. PR 223's `kind` and `is` move ([Tags](./tier-1-detail.md#tags)).
- **No bare `of`, and no `xOf` names.** The copies bring about 55, so they get fixed on the way in.
- **Words:** hands, a window and an agent dial the brain. `client` means any of them at the door, and `host` is a place hands can run ([the note](../direction/brain-hands-window-agent.md)). No `peer`, and no `node` for a thing that connects. PR 223's 53 `peer` lines go when it moves. The shell is `fabsh`.
- **Layers go one way,** and programs have no power of their own. A Cmd is data, and the runtime does it.
- **Every keybinding is configurable from day one.** New owner rule ([the note](../direction/keybindings-are-configurable.md), being written, and it holds the shape). The first window reads its keys from the person's own file, `~/.fabrika/keybindings.toml`, and no key is wired into a handler. That covers `e` on a note, and every other key Tier 1 shows. How a browser tab, which has no files, gets that table is in [the note](../direction/keybindings-are-configurable.md#a-browser-tab-has-no-files). See [the questions](#open-questions).
- **Never copied, with three named exceptions from the owner:** styling, `programs/markdown`, and the MCP tools. Each copy carries a comment naming its source path and commit.

**How it is built:**

- **Every pull request goes through today's pipeline:** plan, test writer, build, mutation, one review, each by its own agent. A step that cannot run goes by hand for that PR and is logged in `field/` ([the steps](../direction/next-is-a-pipeline-pre-run.md)).
- **The test writer only adds new `*.test.ts` files** (`.fabrika/fabrika.toml`, `programs/pipeline/briefs/test-writer.md`). A helper goes in such a file too. It cannot move a test, change one, delete one, or write a data fixture. The builder cannot touch the exam. So a saved vector or a fixture has to come from an exam PR, or sit inside a test file. A later law goes in a new test file rather than a bigger old one, so each landing adds its own e2e file, and the exam holds a thin runner that finds them (my call, 80%). A test that renders React uses `createElement` in a `.ts` file.
- **A law on a real window or a real service has no red-to-green step in the lane.** The test writer runs vitest, in a box with a temp home and no network. So laws on real Chromium, real Electron, launchd or the cloud (p29, p31, p46 to p48, p50, the live halves of p51, p58, p59, p62, p41) go through a by-hand run or the daily pile, logged. [The questions](#open-questions) ask which.
- **`pnpm-workspace.yaml` is an exam file, and the catalog lives in it.** A builder who adds a dependency ends the lane stuck, and that is final. So a new dependency lands in an exam PR before its task. A package's own `package.json` is the builder's. A new package also changes `pnpm-lock.yaml`, which `RULES` does not name, so the builder updates it, on a lean of 70% that the first landing tests. Today's catalog already has Electron, `@modelcontextprotocol/server`, `@pierre/highlights` and the mdast packages. `@effect/platform-browser` is one it lacks.
- **A rule or law that lives in the exam is written by the exam PR.** A task that "owns" it (p24, p32, p65) only turns it green. Everything else is the test writer's: each machine's `*.laws.test.ts`, and the ported tests for the copies. The small exam holds their fixtures and rules.
- **On main, every law is `new`.** There is no `next/` to pass an `existing` test on. So plan-115's `existing` laws go red first like the rest, and p16 means PR 223's tests come over, fitted.
- **The exam files need guarding first.** `RULES` in `packages/pipeline/src/stages/exam/machine.ts:36` lacks `next/**/*.test.ts`, `fixtures/next/**`, `next/apps/fabrika/src/exam/**`, `boundary-rules.json`, `vitest.config.ts` and `pnpm-workspace.yaml`. Tracker ticket 122 holds this. Until it lands, a builder could change them and the lane would not notice.
- **Long checks do not block a pull request.** New direction, with no note on main yet. They run daily, and what they find becomes a ticket. So sort every check into one of two piles: fast ones that block, and long ones that run daily. The likely long ones: real launchd, the cloud smoke run, chaos, a full mutation run. Nothing daily exists yet, and only the [proposed note on scheduled jobs](../direction/scheduled-jobs-on-the-host.md) touches it. See [the questions](#open-questions).
- **Mutation on a pull request must be very fast.** Same new direction, and no number is set. Today's step takes a fixed sample of at most 150, and this plan's guess of 10 to 25 machine minutes per PR is too slow for that direction. Do not promise a number. Say which files each task's mutation covers.
- **Exact versions, never a range.** Today's catalog: Effect 4.0.6, pnpm 10.27.0, Node 26.12.0, Electron 45.0.0, React 19.3.1, tea 0.21.0. [PR 258](https://github.com/usirin/tea-fabrika/pull/258) would move Effect to 4.1.1, pnpm to 12.16.1, Node to 26.13.0 and Electron to 45.2.1. The design was read on 4.0.6. Re-check the `Schema` sketches if 258 lands first.
- **Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test` before any change is offered. None needs a key or the network. A real deploy needs the owner's yes after reading `alchemy plan`.
- **Screens:** real shots in `docs/`, in the five layouts, and how Linear would do it, per screen. "No rough first versions" starts when a person opens `next/` for real work, which is notes in PR D.

**How it looks.** The tile and color rules were decided for today's version, and `next/` reads them as lessons: [tile guidelines](../direction/tile-guidelines.md), [color principles](../direction/color-principles.md), [pipe colors](../direction/pipe-colors.md). What that means in Tier 1:

```tsx
// A sketch, from the tile guidelines. Tier 1 has no pipes, so it uses the plain case.
<section className="tile focused" aria-current="true" aria-label="notes, t2">
	<header className="titlebar">
		<span className="slot" aria-hidden="true" /> {/* a plain tile: a dot */}
		<h2 className="name">notes</h2>
	</header>
	<Body />
</section>
```

- **Holds now:** a color means one thing, color never works alone, slate steps for a plain tile, no line under a washed title, WCAG 2.2 AA with no setting, one named region per tile.
- **Waits:** the six pipe colors and letters wait for pipes in Tier 2. Prefix keys and folding keys wait for the desk.
- **Clash:** the [styling exception](./tier-1-detail.md#styling) copies today's tokens, which predate these rules. See [the questions](#open-questions).

**Windows.** [The note](../direction/windows-in-next.md) is proposed. Plan with [the lean](#open-questions) on it.

## Words that look like a clash

These were checked, and none is a real conflict.

- **`hello` and `initialize`.** The wire method is `initialize`, as PR 223 has it. `Hello` is the schema, and "hello" is the plain word. The sync note's sketch `method: "hello"` is old. Tier 1 adds one thing the note does not name: the brain's first frame, `challenge`, carries the nonce the hello signs. The detail's old `ping: Schema.Number` was wrong: it is a string such as `"30s"`, as in PR 223 and the note.
- **Keychain and `safeStorage`.** Same thing on a Mac. Keys are made with Node's WebCrypto, and `safeStorage`'s async API seals each private half into `userData`, using a master key in the Keychain. The sync API is removed in Electron 46. The capability word `keychain` means "can seal". If the Keychain asks when opening fabrika, the window key moves to WebCrypto in a hidden page, and T8's spike tells.
- **`port` and `pid`.** The sync note's T2 sketch says `{port: "tile:t3", m}`, as `link.ts` once did. Tier 1 and PR 223 name the process: `pid`, as in `Mailbox.send("counter:1", ...)`. A tile is a window's view of a process. "Ports" in this plan means Elm ports, a program's typed inputs and outputs. Nothing named `port` goes on the wire.

## A starting guess at the pieces

**Not settled.** These six pull requests and their exam PRs were the first cut. They show the order of the demos, and they are too big for small pull requests. PR A carries PR 223's 3,323 lines plus T1 to T6, and PR D is about 1,500 to 2,000 product lines. Use them as milestones, and split them. [The tasks T0 to T22](./tier-1-detail.md#tasks) are finer, and also a guess.

| Piece | The demo at its end | Tasks |
|---|---|---|
| Exam | Rules red on PR 223's tree, each fire read by hand | see the detail |
| A, door and plumbing | Check 1, 2 and 8 | T0 to T6 |
| B, the app | Check 3 | T7, T8, T15, T9 |
| C, cloud | Check 4 | T10, T11 |
| Small exam, then D, notes | Check 5 | T16, T17, T18, T20, T21, T19 |
| D2's design pass, then D2, backup | Check 6 | T22 |
| E, chaos | Check 7 | T12, T13, T14 |

**Names-only tasks do not land alone.** T1 and T16 add names whose bodies only die, so the next task's tests load. That suited one pull request with local commits. On main, it would be a stub sitting in the code. Drop them as tasks: each landing adds the names it uses, and each of their laws moves to the landing that first adds its code. The lane counts a test that cannot load because a name is missing as red (`stages/test-writer/results.ts`), so this loses nothing, and c1 reads per landing. My call, 80%.

**The dead-export check on a bottom-up landing.** Names in a package's `exports` count as public, so they pass. An internal name has to be used already. Nobody has run this on the new shape, which is why the first package landing tries it.

**The whole size, a guess at 50%: 5,360 to 7,440 product lines, 4,940 to 7,200 test lines, 63 to 92 agent hours,** plus today's-version work (the planner gap, ticket 122). *Wrong, kept as wrong: this plan said 44 to 70 hours. Its first row, at its own rate of 150 lines an hour, is 44 to 62 hours, not 25 to 40.*

## The order of work

Most of the order above is a choice. **These parts are not, and each says why:**

1. **Ticket 117, then the planner gap, then this plan.** The pipeline has to prove itself first, and it cannot file small tickets yet.
2. **Guard the exam files, then land the exam, before any builder works in `next/`.** A builder cannot be held to rules that do not exist. An exam-only change goes by hand and is logged, since an exam ticket has no build step.
3. **[How `next/` reaches the lane](#still-open-how-next-reaches-the-lane) is answered before the first `next/` lane.** Everything else in `next/` stands on what PR 223 worked out.
4. **The door before the app, the app before the cloud.** The menu bar signs what the door checks, and the cloud proves the same flow. The terminal command `grant.ts` lets windows in until Approve exists.
5. **The cloud before notes.** Real notes live on Cloudflare. Check 4 still proves the counter there, on data nobody minds losing.
6. **Words and fact shapes are settled before real facts get written,** which is the first real note. A fact written then lives forever: `has`, `saw`, `as`, what `granted` keeps, and any OS or capability word.
7. **Notes before chaos.** Chaos needs a real target, its drill dials through the MCP client, and doing it first would write its target list, driver and p39 twice (biggest call 10).
8. **Backup right after notes.** Settled by the owner: once notes are real, a lost Mac would otherwise mean a new ledger.
9. **Each new `next/` law lands before the code it checks.** The test writer's tests must fail first, on the base.

**Free to change:** the split inside any piece, the order of tasks inside a piece (except that T15 needs T8's keys), and where the shared names land. PR 258 and today's other work wait for nothing here.

**Each pull request:** the test writer adds its tests and runs them on the base. The builder works with local commits and cannot touch the tests. Then the mutation step, one review by another agent, screenshots, the owner's yes. Runs and notes go to `field/` the same day.

### One ticket per pull request

Each small pull request gets its own tracker ticket, and each runs its own lane, with the owner approving that ticket's plan.

- *Changed 2026-11-01:* an agent was going to file these by hand, one per PR, each pointing at its part of this plan. Now they come out of the planner, and are filed after the owner's yes ([PR 279](https://github.com/usirin/tea-fabrika/pull/279)).
- **Exam pull requests go by hand and are logged.** That covers the first exam, the small one before notes, and the backup's.

## The backup needs a design pass first

**Nothing is designed.** The owner moved it up from Tier 3, and no note holds a design, only one line in [every update builds every layer](../direction/every-update-builds-every-layer.md). What is known: the person key lives on the Mac, the text lives on Cloudflare, `founded.keys` stays a list so keys can join, and a new fact `added` goes on it. `added` is not yet in `MemberFact`, `foldMembers` or p28.

```ts
// A sketch and a starting guess, not settled. Two moments.
// While the old Mac lives: make a recovery key, print its private half on a sheet.
{_tag: "added", key: recovery.publicKey, for: person, signed: sign(personKey, text), saw: {how: "sheet", check: "touch"}}
// On a new Mac: type the sheet in, and sign the new person key with it. The door's one signature shape.
{_tag: "added", key: newMac.personKey, for: person, signed: sign(recovery, text), saw: {how: "recovery", check: "none"}}
```

**The design pass answers,** and the owner reads it before any test writer starts: what is on the sheet, and on paper or in a file. Whether recovery revokes the old Mac's keys. What the new Mac's window key does. What happens with a wrong or a used sheet. How the door reads `added`, in one signature shape. How `founded.keys` folds with it.

**Its done check, as a guess:** a temp home with the sheet and the Cloudflare address comes back to the same notes and the same name, with no new ledger. Without the sheet, it gets a waiting screen and nothing else. The sheet's secret is never on the wire or in the ledger. Plan it as one design task and one PR after it, and put any design choice with a real trade-off in `questions`.

## Known risks

Each has a way out, or a first step that tells. More in [the detail](./tier-1-detail.md#what-this-plan-cannot-tell-us).

- **Launchd from an unsigned build, Touch ID from it, and the Keychain asking on open.** Nobody has built these here. T8's spikes come first, and each way out is written: a child process, a plain click, a WebCrypto window key.
- **A non-extractable key in IndexedDB over a reload.** T5 tries it in Chromium first. If it fails, stop and tell the owner, since the only fallback is a key the page can read. A phone's browser may also clear it after seven days, which means one more Approve.
- **The package move.** Nobody has run code-graph or esbuild on the new shape. T0 runs both first, and stops if either is off.
- **The copies carry bugs.** `programs/markdown` was written for a program that showed one text and quit.
- **A wake with a long history.** Each wake folds every save, and the object sleeps quickly on Cloudflare. T17 records it at 1,000 and 10,000 saves.
- **The cloud is first seen late.** Cold load, `abort_all`, a redeploy mid-run: all first seen at p39 and p41.
- **This plan itself.** Nothing was built for it. Only single tickets have been measured through the plan step, so it may not hold a project this size. One run tells.
- **A big landing is a weak review.** If PR 223 lands whole, nobody really reads it.

## Open questions

The owner answers these. **The first two stop work, and the third stops PR D.** Plan with the lean, and ask again in `questions` if you see more.

1. **Can the plan step turn out small tickets yet?** *Stops this plan going through the lane.* In the lane, a yes on a plan sends it on to the exam and the builder, as one giant pull request. Only the owner's `no` stops that. **Lean:** build the gap first, as decided. If a look is wanted sooner, a plan-only run, and the owner answers `no` to stop the lane. Sure: 85%.
2. **[How `next/` reaches the lane](#still-open-how-next-reaches-the-lane).** *Stops the first `next/` lane, not this plan.* Lean 65% on the route, 60% on what lands.
3. **Windows' words and OS.** *Stops PR D.* Should `touch-id` become `check`, `keychain` become `seal`, and the hello record the OS, before real facts are written? [The note](../direction/windows-in-next.md) leans yes at 75%. Its other parts: a `next-windows` CI job, `.gitattributes`, one way to stop a brain, about 320 lines and 3 to 5 agent hours, sure 50%. **Lean:** the OS field lands with the door, and `.gitattributes` with the first exam, since a later hello can never get the field back, and they cost a few lines. Tasks use today's words, `touch-id` and `keychain`, until the owner answers, and nothing is real until notes, so a rename is still cheap then. If renamed, pick another word than `check`, which already means three things in this plan (`saw.check`, chaos's `check`, the menu's `check`). Leave the CI job and the pipe to the owner's word on Windows. Sure: 70%. A walk of the Approve screen settles it.
4. **What runs the daily checks, what do its tickets go to, and how does mutation get fast?** Tier 1 did not include this, so it is a scope question. It also asks which pile holds the real-window laws: the first exam's `next` CI job runs Chromium and e2e, which looks like blocking. **Lean:** tests that spawn `dev.ts` stay in vitest and block. Real-browser e2e runs in CI without blocking. Laptop-only laws run by hand and are logged. The daily run is the smallest thing on the owner's laptop, as the proposed scheduled-jobs note has it, and it files tracker tickets. Plan with today's mutation step as it is, and promise no time. Why: a check that blocks nothing and runs nowhere is worse than none. Sure: 60%. The cost is unknown, and a sized proposal settles it.
5. **Do the tile rules change the styling copy?** The copy brings today's graphite tokens, and the rules want Radix slate steps. **Lean:** copy spacing, type and the meaning of colors, and take a plain tile's colors from the rules, since `next/` would otherwise copy what today's version is about to change (ticket 124). c7 then reads "tokens match the rules". Sure: 70%. Cost: a few more token lines. What settles it: a look at one real tile.
6. **Does `next/` use Manti?** The detail says `next/` has no Manti, and copies today's styles instead. [AGENTS.md](../../AGENTS.md#changing-the-product) says all in on Manti, and the [UI on Manti](../direction/ui-on-manti.md) note agrees. The tile is ours either way, as [the tile guidelines](../direction/tile-guidelines.md#tokens) say. **Lean:** Manti for the buttons and fields on the founding, waiting, panel and notes screens, since the newer rule holds. Cost: a dependency for those screens, a catalog change, and more bytes on a phone tab. Sure: 60%. The doubt is whether the owner's styling exception meant no Manti. The owner's word settles it.
7. **Where do saved vectors and letters come from?** `sshsig` vectors and `notes-letters.jsonl` live in `fixtures/next/`, and the test writer can only add `*.test.ts`. **Lean:** from the exam PRs, so the owner reads them. Sure: 85%. Cost: the sshsig vectors move into the first exam PR.

8. **What does configurable keys add?** The owner's new rule was not in the approved size. It adds no pull request of its own, on the lean: the table lands with the first window that takes a key. **Lean:** a small addition to the door's window work. A guess, 50 to 150 product lines and about the same in tests, about 1 to 2 agent hours, not in the total above. Sure: 50%. The note's shape settles it. The keys are the person's, in `~/.fabrika/keybindings.toml`, not the repo's `.fabrika/fabrika.toml` ([the note](../direction/keybindings-are-configurable.md)).

### Still open: how `next/` reaches the lane

**It stops the first `next/` lane, and not this plan.** Two parts: how the steps can read PR 223, and what lands.

**How the steps read it.** In today's version, a lane starts only from `origin/main` (`packages/pipeline/src/stages/pipeline/work.ts:244`, `:274`, `:276`), and `next/` is not on main. A read-only step, and the test writer's box, get a copy with no history, so they cannot read 223's commit at all.

```text
main -> first `next/` lane, like any other
          plan         names PR 223's commit, and cannot read it
          test writer  adds tests at their new paths, as new files, and cannot read 223's either
          builder      adds the product code, if its box can read those git objects
```

**What lands.** PR 223 cannot land as it is. It breaks `no-promises` and `no-tea-react`, and p65 fires until the packages exist. The lane's checks run the whole of `pnpm lint`, so no slice carrying its old code gets through. And 3,323 lines do not fit a small pull request.

- **Lean, 60%: PR 223 is read, and each layer lands already fixed.** Data, then coordination, then transport, then app and desktop, each already on Effect, in packages, with its tests. Why: the rules hold from the first day, and each piece is small. Cost: rewriting done work, about five landings before the first demo, and that is a real strain on the walking-skeleton idea.
  - **Under this lean T0 goes away.** Nothing is moved. Each layer's first landing makes its package, and the desk never arrives. The T numbers and [the moves table](./tier-1-detail.md#packages) read as "where each thing ends up".
  - **Wire laws move.** p10 to p15 and p17 run on the real stage, so they belong to the landing that first brings up `dev.ts`. Put that landing as early as you can.
  - **Unknown: can a test that starts `dev.ts` run in the test writer's box,** with a temp home and no network? If not, those laws join the by-hand pile. Make this a spike, `ends: "answer"`, before that landing.
- **Lean, 65%, on the way in:** the lane as it is, plus PR 223's text placed where a copy can read it, such as a file under `docs/` or a folder of its own. That is one by-hand task before the first `next/` landing. No new lane code, and [the deal](./README.md#where-we-want-to-go) holds. It is unproved.
- **The other route:** the first slice by hand and logged, with the blocking rules held back until it has landed. That is one landing in the old shape, and it leans on exam item 11, "no check blocks until its false alarms are measured", which was not written for this.
- **What settles it:** one rehearsal by an agent, before this comes back to the owner. Plan with the leans either way, and do not list the rehearsal as a task.

## Where the detail is

In [`tier-1-detail.md`](./tier-1-detail.md). Read what your task touches. It is too long to read for the sake of it.

| You need | Section |
|---|---|
| Why each big choice went the way it did | [The biggest calls](./tier-1-detail.md#the-biggest-calls) |
| The door, step by step | [How the lock works](./tier-1-detail.md#how-the-lock-works-the-notes-t5) |
| Approve, Remove, the brain as a service | [The menu bar](./tier-1-detail.md#the-menu-bar) |
| Notes, drawing, agents | [Notes](./tier-1-detail.md#notes), [Drawing a note](./tier-1-detail.md#drawing-a-note), [Agents through MCP](./tier-1-detail.md#agents-through-mcp) |
| Faults and where they run | [Chaos monkey](./tier-1-detail.md#chaos-monkey) |
| Package names, PR 223's file moves | [Packages](./tier-1-detail.md#packages) |
| Services per platform, Electron, Cloudflare | [Platform pieces](./tier-1-detail.md#platform-pieces), [Electron window](./tier-1-detail.md#electron-window), [Cloudflare](./tier-1-detail.md#cloudflare) |
| Facts that must be recorded now | [What fact is lost](./tier-1-detail.md#what-fact-is-lost-forever-if-we-dont-record-it-now) |
| Layers, tags, types and names | [Strict layers](./tier-1-detail.md#strict-layers), [Tags](./tier-1-detail.md#tags), [The public interface](./tier-1-detail.md#the-public-interface) |
| Tasks, laws, criteria | [Tasks](./tier-1-detail.md#tasks), [Properties](./tier-1-detail.md#properties), [Criteria](./tier-1-detail.md#criteria), and [plan-115](./ticket-115.md) for p1 to p24 and c1 to c6 |
| The exam and the mutation step | [The exam PR](./tier-1-detail.md#the-exam-pr-not-in-this-plan), [The mutation step](./tier-1-detail.md#the-mutation-step) |
| What the owner settled | [Settled by the owner](./tier-1-detail.md#settled-by-the-owner) |

**Notes that bind, beyond those linked above:** [the five layers](../direction/a-local-first-sync-engine.md), [a browser is always a client](../direction/a-browser-is-always-a-client.md), [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md), [the desktop layer](../direction/the-desktop-layer.md), [the cloud is one more host](../direction/the-cloud-is-one-more-host.md), [local is the cloud](../direction/local-is-the-cloud.md), [every update builds every layer](../direction/every-update-builds-every-layer.md).

## What this cannot tell us

- **Nothing was built or run for this plan.** It rests on reading, plan-115's probes and past experiments.
- **Whether small pull requests fit this work.** A walking skeleton wants each piece whole, and small pull requests want each piece small. The planner's split is the first test. In two cold reads of this page, readers agreed on the stories, goal, order of the demos and questions, and their task lists differed. That split is left to the planner on purpose, and the owner's look catches a bad one.
- **How small "very fast" mutation has to be, and which checks count as long.** The direction is set, but no number is, and no experiment has landed on main.
- **What the backup is.** Its pass has not happened.
- **How long the whole thing takes.** The size is 50% sure.
- **Facts about PR 223 and PR 258 are as of 2026-11-01.** A later push changes them. Check the links.
