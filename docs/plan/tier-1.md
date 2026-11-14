# Tier 1: the first pass of the new fabrika

**Tier 1 is built now, by hand, one small pull request at a time ([the split](#the-pull-requests-one-at-a-time)).** Decided by the owner on 2026-11-05: `next/` no longer waits on today's pipeline. Today's pipeline is paused, and tickets 117, 213 and 159 stay saved at their asks. The lead session's agents build Tier 1 with the same steps the pipeline enforces, each step logged in `field/`; [how it is built now](#how-it-is-built-now) says how. [PR 396](https://github.com/usirin/tea-fabrika/pull/396) recorded that decision in `docs/direction` and `AGENTS.md`. The owner approved what Tier 1 builds and why on 2026-11-01. Later tiers stay proposed.

**Where it stands, 2026-11-05:** P1 and P2, the exam's frame and its rules, are on main ([PR 402](https://github.com/usirin/tea-fabrika/pull/402) and [PR 401](https://github.com/usirin/tea-fabrika/pull/401); [the exam on main](#the-exam-on-main)). P3 and P4, the two spikes, answered yes ([experiment 215](../../experiments/215-browser-key-survives-reload.md) and [experiment 214](../../experiments/214-mac-app-four-unknowns.md)). No product code is built yet. P5, the backup's design pass, is done for the sheet (2026-11-06, [PR 404](https://github.com/usirin/tea-fabrika/pull/404)).

*Changed 2026-11-05: this page was the input for today's plan step, which was to turn it into small tickets. That flow is paused for `next/`, so the planner's brief and the planner's box are gone from this page. Its stories, checks, rules and order hold.*

Every claim is about `next/` at [PR 223](https://github.com/usirin/tea-fabrika/pull/223)'s head (`7c1d073`), unless it says "today's version". The full design, the laws and the reasons are in [`tier-1-detail.md`](./tier-1-detail.md). [The map](#where-the-detail-is) says where.

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

## The four primitives first

**Approved by the owner on 2026-11-13, with that day's changes:** the Electron app beside the
browser tab, the thin menu bar, the cloud instance alongside, and recovery first after done
([0159's amendments](../../.decisions/0159-fabsh-pipes-summon-join-first.md#amendments)).

[0159](../../.decisions/0159-fabsh-pipes-summon-join-first.md) changed what is built next in
`next/`: the four primitives, `fabsh`, pipes, `summon` and `join`, working for real with whatever
they need, so fabrika is built inside fabrika. This section is the changed Tier 1 that 0159 asks
for. It says what has to be built, in build order. Where it and the older sections of this page
differ, this section and 0159 win. Every claim here is about `next/` unless it says "today's
version". A line marked "the lead's reading" is the lead's, not a decision.

```text
A sketch, next/: the build order, then the lines that work at the end. Built-in names are not decided.
window  ->  fabsh in a tile (the desk beside it)  ->  pipes  ->  summon and @name  ->  join and rooms
the window is a browser tab and the Electron app, built side by side: one window code, two clients
prefix, then split right                       the desk sends {type: "did", does: "split_right"} (0278)
fabsh$ a | b                                   what a puts out is mailed to b, saved like any letter (0109)
fabsh$ summon claude haiku as scout            the one way to start an agent (0157)
fabsh$ @scout what changed in next/ yesterday?  a letter to scout's mailbox; it runs behind you (A1, A3)
fabsh$ fg %scout                               wait on the turn; Ctrl-C stops the turn, scout stays (A2)
fabsh$ join #bug-17                            the verb is a lean (R1)
fabsh$ #bug-17 @scout here is the failing run  scout answers in the room, which everyone can read (R2)
```

### What done means

Done is the four primitives working for real, never a thin slice and never a stub. Each piece is
built the way its decision or note designs it, and today's version shows what working means for it
([0159's amendments](../../.decisions/0159-fabsh-pipes-summon-join-first.md#amendments)).

Done is seen in the Electron app and in a browser tab (owner, 2026-11-13, 0159's third amendment).
The two are built side by side from the first piece that draws, and a piece that draws is not done
until it works in both. The app is one more client of the same window code
([0274](../../.decisions/0274-the-desktop-is-a-platform-free-core.md)), so nothing is built for
the browser alone and found broken in the app later.

Two more pieces come with it (owner, 2026-11-13, the same amendment):

- **The menu bar extra, in its simplest version (P21 in part):** just enough to approve and deny a
  new window from the app's menu bar. It grows into the full one with nothing to undo, the rule
  [0151](../../.decisions/0151-a-thin-inbox-is-a-tier-1-row.md) set for the thin inbox.
- **The cloud instance (P24), built alongside once the window works.** Each piece is deployed
  there as it lands, as a quick check, the same way each is checked in the app. The brain is
  workerd everywhere, so the gap is small, but only the real cloud shows its real limits, a public
  door, and hands that dial in over the internet, and those touch `summon` and `@name`.

At the laptop, in the app or a tab, a person can:

- open a tile that runs `fabsh`, type a line and see each letter at once, while the process confirms
  it ([0275](../../.decisions/0275-the-shell-is-a-regular-program.md)); each word shows its role in
  color, so colors, Tab and the error mark read one list (S1 of the
  [summon guidelines](../direction/summon-guidelines.md#s1-one-grammar-typed-tokens-every-view-reads-it),
  a lean; the lead's reading puts syntax highlighting in `fabsh`'s first build, not later);
- split a second tile, close it and move between tiles with the prefix key, from the desk program
  `fabrika/tezgah` ([0279](../../.decisions/0279-tuval-is-a-package-desk-in-tier-2.md),
  [0278](../../.decisions/0278-each-window-runs-its-own-prefix.md),
  [0272](../../.decisions/0272-a-press-finds-its-command.md)), never a fixed layout first;
- start a program from `fabsh` and see it in a tile, which follows its `keep` when the process ends
  ([0276](../../.decisions/0276-a-tile-shows-one-process.md)); the brain checks the start against
  the member whose line caused it, never against `fabsh`'s program
  ([0170](../../.decisions/0170-a-start-is-checked-against-its-sender.md)). *2026-11-14: not built.
  The start still checks only program to program, `StartGrant` in
  `next/packages/libfabrika/src/processes/ChildrenLedger.ts:85`; ticketed. What becomes of
  `StartGrant` is the owner's open question;*
- pipe `a | b` between `fabsh`'s built-ins, over saved program mail
  ([0109](../../.decisions/0109-a-pipe-is-saved-program-mail.md));
- `summon` an agent under a name, talk to it with `@name` in the background, wait on it with
  `fg %name`, and end it with `dismiss`
  ([0157](../../.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md), A1 to A5);
- send `@name` to a person, which reaches that person's inbox program (A5);
- `join` a room, talk in it with a `#room` line, `leave` it, and know everyone on the project can
  read it (R1, R2, R5, [0158](../../.decisions/0158-no-dms-only-rooms.md)).

Then the next work is built inside fabrika, by talking to a summoned agent there. The first work
after done is recovery and the rest of the cloud rows (P26, P27, P28, P29, P36; owner,
2026-11-13). A program with its own view that the four do not need, such as the tracker and the
ticket page, comes after those, and is not part of done. A piece the four need is in scope even
when it has a view of its own: `fabsh`'s view, the desk, and wherever a room's talk is shown.

### What is already built that the four stand on

All on main in `next/`, read 2026-11-13.

- **The base layers:** the ledger, the door, processes, programs, the local instance, supervision
  and the span sink (P6, P7, P9 to P12, P33, P34, P37, and P34c's slices 1 to 3).
- **A program can start a child:** the `start_child` Cmd
  (`next/packages/libfabrika/src/runtime/StartChild.ts:33`), run by the runner itself
  (`runtime/Runner.ts:1356`). A start right is one exact pair of programs
  (`processes/ChildrenLedger.ts:100`).
- **Program mail:** the `send` Cmd (`runtime/Send.ts:14`) and its refusals, which have no `full`
  (`processes/ProgramMail.ts:13`). A child and its starter may mail each other with no grant
  (`processes/ProgramMailLedger.ts:122`); anyone else needs a host grant (`ProgramMailLedger.ts:172`).
- **The process list** that `ps` reads: `ProcessManager.info` (`processes/ProcessManager.ts:52`).
- **A window:** `defineWindow` (`runtime/Window.ts:36`) with a key row per command
  (`runtime/Window.ts:31`), one view (`next/programs/counter/src/window.tsx`), and the page the build
  serves (`packages/libfabrika/src/node/build/build.ts:218`).
- **Settings:** declared once and read from both `fabrika.toml` files (P38's slices 1, 2 and 3a).
- **A durable job service** for hands (`jobs/Jobs.ts:32`, P39's slice 1).
- **The checklist program** and **the thin inbox program** (P44, P45's slice 1). The app's table
  still holds one program, `fabrika/counter` (`next/apps/fabrika/src/table.ts:7`).

No code in `next/` names `fabsh`, `summon`, a room or a registry of names (searched 2026-11-13).

### What is missing, piece by piece

In build order. "Decide first" lists only what no decision answers yet.

**0. The merge line.**
- Designed by: [0161](../../.decisions/0161-no-step-signing-by-hand.md),
  [0162](../../.decisions/0162-no-friction-before-a-merge.md),
  [0163](../../.decisions/0163-the-lead-acts-on-the-owners-word.md),
  [0164](../../.decisions/0164-the-bot-stays-without-signing.md),
  [0116](../../.decisions/0116-github-requires-ci-required-on-main.md).
- Decided and done, 2026-11-13:
  - Nothing is signed (0161). Main requires `ci-required` alone, so a plain commit merges (0162).
  - Nothing stands between a finished pull request and main but green CI and a clean leak check.
    It lands by `gh pr merge --squash`, pinned to the checked head, with no re-run on newest main
    (0162, which supersedes 0146).
  - The repo moved to an organization, where GitHub offers its merge queue. GitHub's queue is the
    stopgap, and fabrika's own queue stays the design (0162).
  - The bot stays for pushes and pull requests, with the owner as co-author, and a step's agent
    stays in its box (0164).
- In code now: the lead scripts still hold the signing paths, and
  `botpush.mjs` still refuses a tree with no step notes
  (`.agents/skills/lead/scripts/botpush.mjs:62`). On the morning of 2026-11-13, 18 pull requests
  were open, and 5 of the 7 marked ready conflicted with main.
- Not built: the merge queue's trigger in CI
  ([PR 1120](https://github.com/kamp-us/tea-fabrika/pull/1120), open), with the queue turned on
  once it merges; the bot's plain push, its pull requests and its commit path (0164's owed list);
  the plain tooling 0161 lists as owed.
- Decide first: nothing. The merge queue is decided (0162).

**1. The window, in a browser tab and in the Electron app.**
- Designed by: P14's and P19's rows, [Elm first](../direction/elm-first.md),
  [keybindings are configurable](../direction/keybindings-are-configurable.md),
  [0274](../../.decisions/0274-the-desktop-is-a-platform-free-core.md) (one core, with `electron`,
  `browser` and `headless` backends),
  [0280](../../.decisions/0280-the-app-starts-a-launchd-brain.md) (the app starts the brain).
- In code now: the pieces above, in a browser page. No `next/packages/tuval` package is on main,
  and no Electron app is on main in `next/`.
- Not built: P14 past slice 1, with the checklist drawn in it
  ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md); 0159 says the checklist's
  window finishes first, since `fabsh`'s view needs the same parts); P13's safe input recording, so
  a typed line is saved before `update` runs; P18's client cores, where a tile follows its `keep`;
  P19, the Electron app, beside the browser page from this piece on: the founding screen, the
  sealed keys and the brain as a launchd service (slice 1 is draft
  [PR 1079](https://github.com/kamp-us/tea-fabrika/pull/1079)), and, from 2026-11-13, the app file
  and start at login
  ([0182](../../.decisions/0182-the-app-file-and-start-at-login-are-in-p19.md)); right behind it, P21's thin
  version, approve and deny from the menu bar (slice 1 is
  [PR 1097](https://github.com/kamp-us/tea-fabrika/pull/1097)). Remove and the rest of P21 wait.
- From this piece on, every piece that draws (2, 3, 7's inbox and 8's room) is shown working in
  both before it counts as done.
- The lead's reading: 0280 holds in the thin menu bar, so Approve asks for a finger and Deny does
  not. The ruling names only approve and deny.

**Beside every piece, once the window works: the cloud instance.**
- Designed by: P24's row, [the cloud is one more host](../direction/the-cloud-is-one-more-host.md),
  [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md),
  [0295](../../.decisions/0295-where-hot-reload-is-off.md).
- In code now: one built file and its stack (P16, `next/apps/fabrika/alchemy.run.ts`). P24's
  tests sit on a branch, with no pull request, and its row calls it the first cloud deploy after
  P17.
- Not built: P24, the cloud instance, with the menu bar's second link to it. Then each piece is
  deployed there as it lands, as a quick check.
- P24 needs P16, P17 and P21: P16 is built, P17 is done, and P21 comes in its thin version above.
  It pulls in no other waiting row. Its row lists a ticket clash (331 against 329), not fixed here.
- Decide first: the owner's yes after reading `alchemy plan`, before the first deploy (0295,
  [0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md)). Whether one yes may
  cover the quick deploys that follow is open.
- Decide first: nothing for the owner. The lead picks and restarts
  [PR 1028](https://github.com/kamp-us/tea-fabrika/pull/1028) and
  [PR 1044](https://github.com/kamp-us/tea-fabrika/pull/1044), both past their budget stop with red
  laws (0162; [0076](../../.decisions/0076-a-lane-stops-at-its-budget.md)).

**2. A person starts a program, and the desk.**
- Designed by: [0274](../../.decisions/0274-the-desktop-is-a-platform-free-core.md),
  [0276](../../.decisions/0276-a-tile-shows-one-process.md), 0278, 0272,
  [0267](../../.decisions/0267-commands-and-one-mode-field.md), 0279 as 0159 amends it, and P42's row.
- In code now: `start_child` and the one-pair start right (above). No desk program, no prefix and no
  focus code.
- Not built: P42 past slice 1; `fabrika/tezgah` with split, close and the prefix key, its layout
  and focus as a process in the brain (0274); each window running the prefix itself (0278).
- Decide first: whether focus is the window's own or the desk process's, where 0279 and 0274 read
  two ways (below; the first walk due). *2026-11-13: settled, see below; the open part is how a focus move fits 0278.* How `fabsh` may start any program when a start right names
  one exact pair (open; no decision found). Whether the desk's commands need the palette now: 0278 says every command also
  has a shell word and a palette entry (`.decisions/0278-each-window-runs-its-own-prefix.md:33`), and the palette is in Tier 6 (open).

**3. `fabsh`, a program in a tile.**
- Designed by: [0275](../../.decisions/0275-the-shell-is-a-regular-program.md),
  [0432](../../.decisions/0432-next-has-fabsh-rethought-from-tsh.md), S1 of the summon guidelines,
  [fabsh grows into a language](../direction/fabsh-grows-into-a-language.md) (proposed).
- In code now: nothing named `fabsh`. Today's `tsh` has 12 built-in words
  (`packages/fabrika/src/shell/grammar.ts:83`), which maps the jobs and is not copied.
- Not built: the program, its line editor in its model, its view with local echo (0275), the
  reader that gives every word a role (S1), and the built-ins.
- Decide first: S1, and with it what a line may hold and which built-in words `fabsh` has (both
  listed as not decided in 0159).

**4. Pipes, for built-ins first.**
- Designed by: [0109](../../.decisions/0109-a-pipe-is-saved-program-mail.md),
  [0103](../../.decisions/0103-a-program-may-mail-another-by-name.md), program guidelines G6.
- In code now: program mail (above). A program's `outputs` are declared
  (`runtime/Program.ts:144`) and nothing reads them. Delivery reads the sender's whole outbox
  (`processes/ProgramMailLedger.ts:50`), and the recovery save rereads every receipt
  ([finding](../../field/findings/2026-11-11-recovery-save-rereads-every-receipt.json)): 0109 makes
  fixing both a binding first step.
- Not built: the two fixes; the inbox cap and its `full` answer; chunked sends from the writer; the
  inbox cap and chunk size as settings (P38); the right for two programs on one line to mail each
  other, which today needs a host grant (`ProgramMailLedger.ts:172`).
- Decide first: how a pipe carries one program's output to the next one's input (not decided in
  0159); the inbox cap's default, from a measurement (0109).

**5. Hands, far enough to run a turn.**
- Designed by: [talk where you work](../direction/talk-where-you-work.md#in-next-summon-is-an-alias-with-a-session)
  (the brain keeps the name and the session; the turn runs on hands),
  [0102](../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md).
- In code now: the job service (`jobs/Jobs.ts:32`). Key ranks are `person`, `window`, `agent` and
  `recovery`, with no `hands` rank (`access/Access.ts:130`). A search finds no jobs method at the
  gateway.
- Not built: P39 past slice 1.
- Decide first: where a summoned agent runs; 0078's default, the laptop, holds until hands say
  otherwise (0159). Whether a turn on the laptop goes through hands is the lead's reading, 75%: the
  doubt is that 0159 lists the place as not decided.

**6. `summon`, the agent link and the list of names.**
- Designed by: [0157](../../.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md), T1 and
  A5 of the summon guidelines, [0026](../../.decisions/0026-fabrika-never-owns-the-agent-loop.md),
  [0419](../../.decisions/0419-a-harness-adapter-is-the-official-one.md),
  [0417](../../.decisions/0417-fabrika-has-no-supervisor-of-its-own.md),
  [0326](../../.decisions/0326-the-agent-service-leaves-room-for-chat.md), the Tier 5 laws in
  [the tiers](./tiers.md#tier-5-laws-decided-2026-11-07).
- In code now: nothing. Today's version's adapters are a map only
  (`packages/fabrika/src/agents/acp/`).
- Not built: the link to the agent harnesses; the summon record on the ledger (T1); one list of
  names for people, agents and connectors (A5); `agents` and `dismiss` (S7, a lean); an agent's own
  signed way to send, since A4 lets an agent message a name it was handed (the lead's reading: P25's
  bridge with its own key is the row that builds one, 70%; the doubt is whether those sends go
  through the harness link instead).
- Decide first: S2 to S7; how a warm session sits beside the hard stop (0326 leaves it open); the
  clash between 0517 and 0157 on how an agent connects (below); the clash between S3 and A5 on
  names (below), since the one list of names is built here; the summon record's shape.

**7. `@name`, job control and the inbox.**
- Designed by: A1 to A5, S6's decided part, [0480](../../.decisions/0480-the-inbox-is-one-program-two-views.md),
  [0521](../../.decisions/0521-an-agents-message-is-an-inbox-row.md),
  [0151](../../.decisions/0151-a-thin-inbox-is-a-tier-1-row.md),
  [0154](../../.decisions/0154-the-brain-mails-the-inbox-one-letter-per-notice.md).
- In code now: the thin inbox, whose row has one case, `added` (`next/programs/inbox/src/program.ts:17`),
  and which declares no input (`program.ts:51`), so no person or agent can send to it.
- Not built: the `@` line in the background, `jobs` and `fg %name` (A1, A2); a send that always
  lands in the name's mailbox (A3); the inbox growing past the thin row, so `@person` reaches that
  person's inbox program and an agent's message is an inbox row (A5, 0521). 0151 binds the thin
  inbox to grow into the full one with no shape to undo. Needed by the lead's reading, 85%: the doubt
  is that one person on one laptop could get by with replies printed in `fabsh`, which A5 decides
  against. The email recovery notice row waits with email recovery.
- Decide first: whether a person's inbox is one program per person, as A5 says, while the built one
  is the single `fabrika/inbox` (`program.ts:45`).

**8. Rooms and `join`.**
- Designed by: R1, R2, R5 and R8 of the summon guidelines,
  [0158](../../.decisions/0158-no-dms-only-rooms.md).
- In code now: nothing.
- Not built: room records, `join`, `leave`, `#room` lines, the bottom line's list of rooms (R5),
  and wherever a room's talk is shown (in scope by 0159's second amendment; R5 names a room tile).
- Decide first: R8's record shape, before the first talk line is saved, since a field added later
  never reaches the entries written before it; the verb `join` (lean 70%); two agents with one name
  in a room (lean 60%); what a room of two is called and whether it keeps R8's `direct` mark (0158
  leaves both open).

### The build order

0. The merge line, before any piece: nothing is signed, the bot pushes and opens pull requests,
   and a finished pull request lands on green CI and a clean leak check alone
   ([0161](../../.decisions/0161-no-step-signing-by-hand.md),
   [0162](../../.decisions/0162-no-friction-before-a-merge.md),
   [0164](../../.decisions/0164-the-bot-stays-without-signing.md)). What is left is the queue's
   trigger in CI, the queue turned on, and the bot's plain tooling.
1. The window: P14 and P13's open slices, then P14's later slices with P18's `keep`. P14 and P13 run
   side by side. The Electron app (P19) is built beside the browser page from here on, and the thin
   menu bar (P21 in part) right behind the app.
   - Once the window works, the cloud instance (P24) is built alongside, and each later step is
     deployed there as it lands, after the owner's yes on `alchemy plan`.
   - Each later step that draws is shown working in the app and in a tab before it counts as done.
2. A person starts a program (P42), then the desk program. Side by side with step 3 once the window
   is in.
3. `fabsh` in a tile, after the owner's walk of S1.
4. Pipes for `fabsh`'s built-ins: the two slow reads first, then the rest. Needs step 3.
5. Hands, far enough to run a turn. Side by side with steps 1 to 4.
6. `summon`, the agent link and the list of names. Needs steps 3 and 5, and the walk of S2 to S7.
7. `@name`, job control and the inbox past its thin row. Needs step 6.
8. Rooms and `join`. R8's shape is settled before any talk line is saved. Room records can be built
   side by side with steps 5 and 6.

After step 8, the first work is recovery and the rest of the cloud rows (P26, P27, P28, P29, P36),
ahead of the programs with their own view (owner, 2026-11-13).

The order of steps 2 and 3, and of step 8's records, is the lead's lean. 0159 fixes only window,
`fabsh`, pipes, `summon`, `join`, with the app, the thin menu bar and the cloud instance beside
them.

### The owner's walks and decisions, by step

| Before step | What the owner walks or decides |
|---|---|
| 0 | Nothing: the merge queue is decided (0162) |
| 1 | Nothing: the lead picks on PR 1028 and PR 1044, past their budget stop with red laws (0162) |
| the first cloud deploy | A yes after reading `alchemy plan` (0295); whether one yes covers the quick deploys after it |
| 2 | How a focus move fits 0278's "no network wait" (applied in the window at once and then confirmed by the brain, or not), and whether a window opens a project from the brain's list in a browser tab; how `fabsh` may start any program; whether the palette comes now (0278, 0157) |
| 3 | S1, with what a line may hold and which built-in words `fabsh` has |
| 4 | How a pipe carries one output to the next input |
| 6 | S2 to S7 (proposed; S6 carries a decided part); where a summoned agent runs; 0517 against 0157; S3 against A5 on names, since the one list of names is built here |
| 7 | One inbox program per person or one in all |
| 8 | R8's record shape; the verb `join`; two agents with one name; what a room of two is called |
| any | Whether done includes reaching `@scout` from a phone while the Mac sleeps (below); P24 itself is decided |

The summon guidelines say they are walked when Tier 5 starts (`docs/direction/summon-guidelines.md:3`); under 0159
those walks come inside this work, as listed. A walk is not a decision until the owner says so.

### Which rows wait

These rows are not needed by any decided rule for `fabsh`, pipes, `summon`, `@name`, `join` or
rooms, so they wait. Nothing leaves the plan, and no row here blocks the four (0159).

- P4, the Mac app's four unknowns (done); P5, the backup's design pass (done); P17, chaos (done).
- P32, the commit check (done): from [0161](../../.decisions/0161-no-step-signing-by-hand.md),
  today's hand-run tooling makes plain commits, so the check stops gating a merge until `next/`'s
  own pipeline signs.
- P23, the app's demo. The owner ruled on 2026-11-13 that the Electron app (P19), the thin menu
  bar (P21 in part) and the cloud instance (P24) are needed, and that P23 still waits.
- P26, the checklist on Cloudflare; P27, live faults; P29, the drill.
- P28, the sheet; P36, email recovery.
- P40, programs written outside fabrika; P43, the merge queue's first stage.
- Parts of needed rows: P21 past its thin version (Remove and the rest); P41's slice 3, the
  example from a pack; P44's MCP demo on Cloudflare; P45's recovery notice row.

**First after done (owner, 2026-11-13):** P26, P27, P28, P29 and P36, recovery and the rest of the
cloud rows, ahead of the programs with their own view.

**The one risk of waiting, accepted by the owner on 2026-11-13:** until the recovery rows are built
(P26, P28, P36), daily work in `next/` lives only in the laptop's ledger. The cloud instance is a
quick check of each piece, not a copy of that work, and there is no way back after a lost Mac. No
row loses a recorded fact by waiting; this risk is about the work itself. Recovery is the first
work after done.

**The doubt on P24, resolved (owner, 2026-11-13):** P24 is needed and built alongside. The doubt
came from [talk where you work](../direction/talk-where-you-work.md#in-next-summon-is-an-alias-with-a-session),
which says the brain keeps an agent's name and session so any client can reach `@scout`, a phone
included, while the Mac sleeps (`docs/direction/talk-where-you-work.md:187`). With P24 the cloud
brain that reach needs is there. Whether the phone itself is part of done is still not ruled.

### Notes that disagree with each other

Listed, not resolved.

- **S3 against A5, on names.** S3 makes a name unique per person, so two people may each have a
  `scout` (`docs/direction/summon-guidelines.md:224`). A5 puts people, agents and connectors in one list, "so no
  two are the same name" (`docs/direction/summon-guidelines.md:789`). The note's own reading at
  `docs/direction/summon-guidelines.md:921` refuses an agent's name that is a person's, and leaves two people's
  `scout` open.
- **0517 against 0157, on how an agent connects.** 0517 says `summon` takes any agent that speaks
  the agent link, `fabrika mcp --as <name>` (`.decisions/0517-a-tile-holds-you-and-your-agents.md:30`), an agent that dials in. 0157 makes
  `<agent>` a harness fabrika starts (`.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md:61`), and S4 has fabrika open the harness's session
  (`docs/direction/summon-guidelines.md:240`). 0157 points to 0517 for which agents may be summoned (`.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md:95`).
- **0279 against 0274, on focus.** 0279 says each window keeps its own focus and there is no desk
  process (`.decisions/0279-tuval-is-a-package-desk-in-tier-2.md:26`). 0274 puts tiles, focus and layout in a process in the brain (`.decisions/0274-the-desktop-is-a-platform-free-core.md:42`).
  0159 amends 0279 in its timing only, so whether focus is the window's or the desk process's
  still reads two ways.
  *2026-11-13: settled. 0159 brings the desk program now, with a second tile, so the stopgap in 0279
  ended and focus is the desk process's, one per workspace, as 0274 and
  [0277](../../.decisions/0277-size-belongs-to-the-viewer.md) say. Focus per window stays a named fast
  follow in 0277, not decided.*
- **The glossary's `room` row against R3.** The row's example is `fork #bug-17 at 12 as bar`
  (`.glossary/TERMS.md:421`); R3 decided no message numbers and the order `as bar at "footer"`
  (`docs/direction/summon-guidelines.md:537`). R3 wins. The row is not fixed here: it gets its own
  change.
- **Checked and dropped:** R5's example still says "your DM with scout"
  (`docs/direction/summon-guidelines.md:596`), but the note's own amendment says such lines now mean the room of
  two (`docs/direction/summon-guidelines.md:481`), so it is not a live clash. R8's `direct` mark stays open, as
  0158 says.

### What this section cannot tell us

- Sizes. No piece above is sized, and nothing here gives a basis for one.
- What the open pull requests hold beyond their titles. PR 1028's slices for keys and a second
  tile were not read.
- Whether a turn needs hands on the laptop, or a harness started by the brain's host is enough:
  0159 leaves the place open.
- Whether the row marks below are right in every case. Each was read against the decided rules of
  the summon guidelines, 0157, 0158, 0073, 0109, 0275, 0278, 0279, 0326, 0517 and talk where you
  work, by their words; a rule outside that set could pull in a row marked waits.

**Marks on the rows below:** each row of [the split](#the-pull-requests-one-at-a-time) starts with
needed, helps or waits, as this section reads it. Needed: P1, P2, P3, P6, P7, P9, P10, P11, P12,
P13, P14, P16, P18, P19, P21, P24, P25, P30, P31, P33, P34, P34c, P35, P37, P38, P39, P41, P42,
P44, P45. Helps: P8 and P15. Waits: the 12 rows above. That is 30 needed, 2 that help and 12 that
wait. A needed row may be needed only in part:

- P21: the thin version, approve and deny from the menu bar, in a shape the full one grows from.
  Remove and the rest of its row wait.
- P24: the cloud instance, with each piece deployed there as it lands. Its ticket clash is not
  fixed here.
- P25: the bridge as a client with its own key, for an agent's own sends (piece 6). Its checklist
  demo waits.
- P34c: a crashed run is restarted by an OTP supervisor
  ([0417](../../.decisions/0417-fabrika-has-no-supervisor-of-its-own.md)), which slices 1 to 3
  began. Which later slices the four need was not read.
- P38: the settings 0109 asks for (the inbox cap and the chunk size) and the harness blocks S4 says
  are decided, read where they are used.
- P39: far enough to run a turn (piece 5). P41: slices 1 and 2, which pipes ride; slice 3 waits.
- P44: the program its window draws (piece 1). P45: the program that grows (piece 7).
- P8 helps: its exam holds the agent tests P25 builds against. P15 helps: hot reload makes building
  inside fabrika faster, and no decided rule of the four relies on it.

## How it is built now

**Each pull request in [the split](#the-pull-requests-one-at-a-time) goes through the same steps the pipeline enforces, run by the lead session's agents, by hand** (owner, 2026-11-05). One agent per step, and no agent does two steps on one pull request.

```text
plan          an agent writes the PR's plan: what changes, its laws by detail number, its files,
              and what its piece records, with the fact that would be lost if it did not
              the lead agent approves a plan that only builds a decided note; a new design call goes to the owner
tests first   a second agent's commit, first on the branch: the tests, as new *.test.ts files, and any exam
              change they need; run on the base: red
build         a third agent writes the product code and never touches the tests or the exam
mutation      the fast check, as fast-and-daily-mutation sets it: changed lines, 5 minutes at most, advice only
review        one review, by an agent that wrote none of it
merge         the lead agent reads the whole diff, waits for green CI, runs the leak grep, then merges
log           one row per agent run, with the sha of the commit it made, and a note per step that went
              by hand, in field/; P32's check reads them
```

- **Every plan says what its piece records** (owner, 2026-11-07). Its list names each span, health row and fact the piece writes, and for each one the fact that would be lost if it did not. A reviewer rejects a plan without that list. Why: "nothing is lost" is a Tier 1 goal ([monitoring is in Tier 1](#monitoring-is-in-tier-1)), and a fact can only be added before the entries that lack it are written.
- **The laws stay in the detail file.** Tier 1 has about 81 laws and 17 criteria (p67 to p69 added 2026-11-05, from the inputs note; p70 to p82 added 2026-11-06, for hot reload, processes, supervision, the brain restart and version agreement; p91 added 2026-11-07, nothing is lost). Each pull request names the ones it owns as "detail p26", and its own plan writes them out in full.
- **Each pull request lands alone.** Its checks are green when it lands. From the first working demo on, the demo keeps working after every pull request.
- **A unit of work is a commit, not a pull request** ([the note](../direction/a-unit-of-work-is-a-commit.md), owner, 2026-11-05). An exam change is its own commit, by an agent that is not the builder, inside the same pull request. The test writer's commit comes first on the branch and may touch exam paths: a boundary row, a ledger line, a catalog line a test needs, an exam test moved to Rolldown. The builder's commits never do. Each step's agent signs its commits with its own key (the same SSHSIG shape as the door), into a git note on `refs/notes/fabrika`, not git's own signature slot, and CI decides from that signature. Each step's run also records the commit it made, as a `committed` entry, kept wide and never deciding; in Tier 1 its `field/` row stands in, with the commit's sha. *Changed 2026-11-05 (owner): this plan first had the lead agent write each boundary row inside its build, then split every exam change into its own pull request, ten small rows with a letter. Both are gone.*
- **A new `next/` package's boundary row and its bare `package.json` come in its first pull request's test writer commit:** P7 for `@kampus/libfabrika` (it lands before P6), P11 for `@kampus/counter`, P13 for `@kampus/notes`, P14 for `@kampus/tuval` and P17 for `@kampus/chaos`. code-graph 0.12.0 refuses a `libraries` row for a folder with no `package.json` ("is no package root"), and a glob row fails the same way, so the rows cannot all land up front ([demlik 868](https://github.com/kamp-us/demlik/issues/868), filed to declare a library before it exists). `next/apps/fabrika` got its row, `next-app`, in P2.
- **P32 builds the check for `next/`.** CI walks a pull request's commits and verifies the signature in each one's note against the step keys: a commit with no valid signature from a known step key is `stuck: unsigned_commit`, and a `build` commit that touches an exam path is `stuck: build_touched_exam`. A `Step: tests` or `Step: build` trailer is for people reading `git log`; CI trusts the signature. Any pull request that touches an exam path asks the owner to read it, flagged by path from one list of exam paths. Until P32 lands, the lead agent's read of each diff is the guard.
- **Step commits come from the bot** (owner, 2026-11-07, in use from 2026-11-08). From T246 and P10 on, step commits are authored by `fabrikalfa[bot]`, with the person as `Co-authored-by`, and pushed to `fabrikalfa/<name>` with a token that lasts one hour. The pull request opens as the person ([agents commit as a bot](../direction/agents-commit-as-a-bot.md)).
- **A merge never waits on the owner** ([autonomy is measured trust](../direction/autonomy-is-measured-trust.md), decided 2026-11-03). The merge row and break row that note proposes (its M1 and M2) are not written yet: `field/README.md` gives them no file or fields, and after the merge `land.ts merged` only comments on each ticket it closes with the pull request and its merge commit (`.agents/skills/lead/scripts/pr/Queue.ts`). A break found later gets a fix forward. Still the owner's: each exam pull request (P1, P2, P8, P32 and P35), the read of any pull request whose test writer commit touches an exam path, each new edge comment, the yes after reading `alchemy plan`, a real finger on Approve, and any new design call. *Changed 2026-11-08 (owner): `ask owner exam_read` stays a warning and auto-merge stays on for hand pull requests, exam ones included, so the owner's read of an exam path can come after the merge. The lead agent never writes "owner read" unless the owner did, and each such merge gets a field note ([how a change lands](./README.md#how-a-change-lands)).*
- **The owner closes Tier 1 by hand,** on [the checks below](#what-done-looks-like), in a run logged in `field/`. No single pull request can prove the whole project.

## The exam on main

**Added 2026-11-05. P1 and P2 landed, so every `next/` pull request is held to these from its first line.** Nothing is red on main: `next/` has no package yet, so each scan of the real tree finds nothing, and each rule was first seen to fire on planted code inside its own test.

```text
P1, PR 402, the frame
  pnpm-workspace.yaml, vitest.config.ts   next/{packages,programs,apps}/* are packages; pnpm test runs their src/**/*.test.ts
  .github/workflows/check.yaml            a `next` job: vitest run next/, Chromium once an e2e file exists, then the runner
  next/apps/fabrika/e2e.ts                the thin runner over next/apps/fabrika/e2e/*.test.ts, one file at a time; passes while there are none
  layer-rules.json                        11 next-* layers, so pnpm lint:layers fails an upward import (p32)
  boundary-rules.json                     4 library types for next/ and libraryRoots: ["next"]; each package's row comes in its first PR's test writer commit
  src/exam/layers.test.ts                 each part imports only what the detail's table allows (p32, p65)
  src/exam/deps.test.ts                   next/ stands alone, and each top level bundles for a browser (p65), with esbuild for now
  src/exam/laws-scan.test.ts              every file that makes a machine has a laws file beside it
  fixtures/next/sshsig/                   real ssh-keygen vectors, namespace fabrika-client (p27, p44)
  .gitattributes                          * text=auto eol=lf

P2, PR 401, the rules (blocking in next/**, tests left out unless it says)
  no-promises                  async, await, new Promise, Promise.x(), .then, Effect.promise, import(), a .catch not on Effect
  no-effect-run-outside-edge   Effect's run functions; until P35, only in the 18 edge files the rule named
  no-of                        no bare `of` and no xOf name, tests included
  no-hand-tag                  no hand-written _tag; one exception, data/log.ts
  one-store-hook               useSyncExternalStore imported nowhere in next/; a dropped store value fires. P30 removes the retired file allowance
  react/refs, react/immutability, react/display-name, react/purity     next/**/*.tsx, oxlint 1.90.0
  no-clock-in-view             next/**/*.tsx: no Date.now(), new Date(), performance.now(), Math.random(), crypto.randomUUID(), handlers included
  pnpm lint:compiler           src/exam/compiler.ts, the compile step build.ts will call; compiler-ledger.json is empty
  catalog                      oxc-parser and oxc-transform-react 0.157.0

P35, PR 435, edges as comments and the sync test
  no-promises                  also Effect.tryPromise, typed calls, Schema's ...Promise calls, Stream's async iterable calls
  no-effect-run-outside-edge   every next/ file; also runtimePromise and makeRuntimePromise; the 18-path list is gone
  edge-comment                 a disable of either rule is `// oxlint-disable-next-line <rule> -- edge: <why>`, edge rules only
  src/exam/edge-comment.test.ts  no .oxlintrc.json override turns an edge rule off for a next/ file that is not a test
  src/exam/edges.ts            CI's `edges` step: each new edge comment, one line with its reason, [ok] [no]; never blocks
  src/exam/laws-scan.test.ts   each machine's laws call syncTest( or say `// sync test left out: <why>` (S2, p88)
```

- **PR 223's tree, read by hand in P2:** `no-promises` 225 fires on 195 lines, 63 of them on 57 lines of the slice's Promise plumbing and 162 in its Playwright script; `no-effect-run-outside-edge` 3, the `useRuntime` handle in `window/main.tsx`; `no-of` 1, `sizeOf`; `react/purity` 1 and `no-clock-in-view` 2, both in `window/main.tsx`; `lint:compiler` 0. No false alarm by each rule's own words.
- **`no-clock-in-view` was added by the owner on 2026-11-05.** oxc-transform-react 0.157.0 stopped refusing a clock read in a handler a view passes down, which 0.156.0 refused. `react/purity` refuses a read in render, and our rule holds the handlers.
- **What P2 could not measure:** false alarms for `no-hand-tag` and `one-store-hook`, since the slice gives them nothing to fire on. The first landings with schemas and a window count them.
- **One exam file still changes later:** `deps.test.ts` moves to Rolldown in P12's test writer commit. P30 removes the retired `use-model.ts` allowance here. P30 is all exam work, written and signed by the tests role, with no build step.

## What a builder can read

- **Everything.** A builder works in its own worktree off current main, with git and the network. PR 223 is read with `git fetch origin pull/223/head`, and nothing from it is imported or merged.
- **On main, `next/` holds only the exam:** `next/apps/fabrika`, with `src/exam/` and `e2e.ts`, since P1 and P2. Each layer's first pull request makes its package, already on Effect, already in `_tag`, with its tests ([what lands](#still-open-how-next-reaches-the-lane), lean 60%).
- **Today's code is on main,** so the sources of the three named copies can be read: `programs/markdown/src/`, `packages/fabrika/src/mcp/tools.ts`, `apps/fabrika/src/window/window.css`. A copy names the commit it really came from.
- **Read the notes your pull request builds.** Each row of [the split](#the-pull-requests-one-at-a-time) names them, and [Rules that bind](#rules-that-bind) names the rest.

**PR 223 in numbers, as of 2026-11-01:** 3,323 added lines in 43 files, none deleted. It conflicts with main. It uses `kind`, `is` and 53 lines that say `peer`, has no `_tag` and no `xOf` names, and has about 60 lines that use Promises, by plan-115's rough count; P2 counted 57 lines of its plumbing. So it fails the exam's rules as it stands, and no pull request carries its code across unchanged.

## Who it is for

**One person and their agents.** A second person comes in Tier 3. Each person answers for their own agents, so this tier does not defend against them. The door stays real all the same: an unknown key is refused, on the laptop and on the cloud.

**The moments, in the order they happen:**

1. **The first open.** The owner opens the one app, types their name and clicks Start. A window comes up with no prompt. The menu bar is part of the app, and the app starts the brain as a plain service.
2. **A new browser.** A tab shows a code and waits. The menu bar shows a row with the same code. Approve and a finger, and the tab is online with no reload. A second tab of that browser needs nothing.
3. **Every day.** Opening fabrika asks nothing.
4. **An agent checks an item.** The owner adds an item to the checklist, adds the agent once with `claude mcp add`, and approves its name once. The agent reads the items through MCP and checks one with a short note, and its name stays on what it writes. It can never add an item, let anyone in or write as the owner.
5. **The owner reads the note,** in another window, or on a phone tab on Cloudflare.
6. **The agent checks it again.** A second `check` on a checked item changes nothing, and the first note stays. To change a note, the item is unchecked and checked again. The saved letters keep every note, with who wrote it and when.
7. **Something goes wrong.** The Wi-Fi drops or the brain restarts, and a press still lands once. If the app dies, the other windows keep working, and only new approvals wait.
8. **Taking one back.** Remove in the menu bar takes out a let-in window or agent, with the same check as Approve.
9. **A lost Mac.** The checklist is safe on Cloudflare. A backup sheet brings the same checklist back on a new Mac.
10. **Breaking it on purpose.** A run with a seed, on a throwaway ledger, ends with a verdict on the screen, and can be read back months later.

*Changed 2026-11-11 (owner, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): moments 4, 5, 6 and 9, stories s9 and s13, and checks 3, 5 and 7 were about notes, which is now Tier 2's first real app. They are told on the checklist.*

**Stories:**

- **s1:** the owner wants the brain built on Effect with strict layers, so nothing rests on Promises and every layer can be replaced.
- **s2:** the owner wants laws they can read, so a green run means something without reading the diff.
- **s3:** a person at a window wants the same speed and the same recovery as before.
- **s4:** the owner wants nothing to join their fabrika unless they said so, on the laptop and on the cloud alike.
- **s5:** the owner wants a browser tab and an Electron window to be the same client in different clothes.
- **s6:** the owner wants the same stack one command from Cloudflare.
- **s7:** the owner wants to break the running thing on purpose, watch it recover, and read what happened months later.
- **s8:** a person wants to open one app and have everything run, with one click and a finger when a new window asks in, and no prompt when opening fabrika.
- **s9:** the owner wants to add an item, have an agent check it with a short note, and read the note in any window, a phone included.
- **s10:** a person wants to remove a let-in window or agent from the menu bar, without a terminal.
- **s11:** the owner wants to let a named agent in once, see its name on what it writes, and know it cannot let anyone in or write as them.
- **s12:** the owner wants the library, the desktop and each program to stand as packages, so a program can only use what the library really offers, and nothing in `next/` can lean on today's code.
- **s13 (new, since the backup had no story):** the owner wants to lose a Mac and get the same checklist and the same fabrika back on a new one, from a sheet they keep, without a new ledger.

## What done looks like

**Tier 1 is done when each check below passes where it says, and the whole demo works in a browser tab and an Electron window, on the laptop and on Cloudflare** ([the rule](./tiers.md#the-rules)). Each half starts in a named pull request and stays working after it: the browser tab with P14, the first window; the Electron window with P19, the app; Cloudflare with P24 and P26, for the checklist. Each runs with `pnpm typecheck`, `pnpm lint` and `pnpm test` green. Every law in [the detail file](./tier-1-detail.md#properties) has to pass too, named below or not. These commands do not exist yet. Tier 1 builds them.

```sh
pnpm exec vitest run next/                 # the laws that run on Node
node next/apps/fabrika/e2e.ts              # the exam's thin runner, over each landing's e2e/*.test.ts
node next/apps/fabrika/dev.ts --port=N --founder=<key.pub>    # a brain for agents and tests
alchemy plan                               # read by the owner, and a yes, before any deploy
node next/apps/fabrika/chaos-drill.ts      # a run on a throwaway ledger, to a verdict
```

1. **The door.** Two tabs of one browser show one code, and one terminal command lets both in, on the local instance. An unknown key gets `not_granted` and writes nothing. (p26 to p29, p43)
2. **The speed and recovery bar.** A press in one window shows in the other, a restart loses nothing, and the numbers are measured on the new instance, base and head in one sitting. The first instance landing has no base, so its own run sets the first numbers. (p10 to p15, p17, p22)
3. **The app.** A temp home: founding screen, a window, "Open in browser" brings a tab online, a tab typed by hand comes in with Approve, Remove takes it out. Kill the app, and the checklist keeps working. The owner opens the built app twice and sees no prompt. (p31, p44 to p51, p66, c13)
4. **Cloud.** The same, on Cloudflare, with the same approval flow, in one built file, after the owner reads `alchemy plan` and says yes. (p33, p41, c10)
5. **The checklist.** On Cloudflare: the owner adds an item, and an agent, let in once, reads `checklist_items` and runs `checklist_check` with a note through MCP. The note shows in another window and on a phone tab. The agent has no tool for `add`, `rename` or `remove`. (p58, p59, p63, p64, c15, c17)
6. **Backup.** See [The backup](#the-backup-needs-a-design-pass-first). Its checks are written in that pass.
7. **Chaos.** A run with a seed ends in a verdict on each instance, adding and checking items on the checklist while faults fire. A planted bug is caught. A build for the real ledger has no chaos in it. (p34 to p39, p60, c11, c12)
8. **The shape.** Each package stands alone, nothing in `next/` imports today's code, layers point one way, and no Promise or Effect run outside an edge line, no hand-written `_tag`, no `xOf` name, no clock read in a view and no Compiler finding passes lint. (p24, p32, p65, [the exam's rules](#the-exam-on-main))

**Only a person can pass these:** the real finger, "no prompt appeared", and the first real use on the phone. Tests use a test `PersonCheck`, and the run goes in `field/`.

**A deploy is not a pull request step.** No builder holds a key. So a check on Cloudflare runs after its pull request lands, from main, by hand, with the owner's yes, and it is logged. The pull request ends with the local half green. My call, 80%.

**Laws that Tier 1 cannot run.** T0 deletes the desk program, so plan-115's p6 and p7 test nothing and come back with the desk in Tier 2. p4 and p9 change with it. [The detail file](./tier-1-detail.md#properties) says how.

## What is out

*Changed 2026-11-13, approved by the owner that day ([the four primitives first](#the-four-primitives-first), 0159): `fabsh`, pipes for its built-ins, the desk with split, close and prefix keys, hands far enough to run a turn, the agent link, `summon`, `@name`, the inbox past its thin row and rooms are now in. The tracker and the rest of this list stay out.*

- **Later tiers:** `fabsh`, pipes, the tracker, the desk, split and close, prefix keys (2). A second person, invites, the full Windows list, typed codes (3). Hands, leases, `kill -9` through real hands (4). Agents in a box, spend, the `claude` and `codex` programs (5). Drag, workspaces, palette, reconnect tested hard, typing in place, tabs and search for notes (6). Apple signing, auto-update, Windows and Linux as an app, others' programs (7).
- **Coordination past Tier 1's slice** (owner, 2026-11-06): supervision trees, sibling strategies (one_for_all, rest_for_one), links and trap exit, a parent's `EXIT` reason and dropping a temporary child's spec wait for Tier 4, since Tier 1 has no process that starts another. Leases wait too, since Tier 1 has no claims: the object id is the one writer. Tier 1 builds dead letters, one crashed program restarted with a brake and backoff, exit, info and monitors, each start a new process with its own id, who is online and a brain restart (P12, P19, P33, P34), as [the five layers](../direction/a-local-first-sync-engine.md)' header says. *Amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)): P34c turns P34 into OTP's top-level supervisor, so one root per brain, child specs with restart types, and dropping a temporary child's spec come into Tier 1; restarts are at once, with no backoff, and past the brake a name is `failed` until a person restarts it. Nested trees, sibling strategies, links and trap exit still wait for Tier 4.*
- **The schema diff check in CI** (T4's "like `buf breaking`"): Tier 2. Letters are already held by p55's saved fixture, and wire messages are not stored, so nothing is lost. Sure 60%.
- **A trace view window and a dashboard program:** Tier 2 and later. Monitoring itself is in Tier 1 (owner, 2026-11-07; [below](#monitoring-is-in-tier-1)). *It said monitoring through tea's `./otel` was out of Tier 1, sure 55%.*
- **D6's "drop the views, replay, compare" law and S5's divergence report:** the row that first adds a view table, a members cache or a notes model cache, adds the law with it. Sure 75%.
- **In notes:** formatted typing in place, tabs, comments, search, sharing, live co-editing, any CRDT, and deleting a note.
- **Security:** no defense against a person's own agents, and no passphrase key.
- **Accounts:** nothing new to pay for. Dev builds use a self-made card, and the cloud stays on the account already in use.
- **Publishing:** nothing is published. Real package names, one workspace.
- **Today's version:** no change but one: P31 makes the design package, which today's app and `next/` both import (owner, 2026-11-05; [one design package](../direction/fabrika-design-package.md)). `next/` never imports anything else of today's. *Changed 2026-11-05: this named guarding the exam files (ticket 122) and the planner gap as today's work Tier 1 needs. With Tier 1 built by hand, neither blocks it.*

No fact is lost by waiting on any of these. The check is in [Later tiers](./tier-1-detail.md#later-tiers).

## Monitoring is in Tier 1

**Decided by the owner on 2026-11-07: full monitoring from Tier 1, and "nothing is lost" is a Tier 1 goal.** [Record wide](../../AGENTS.md#before-you-design-anything) holds for traces too. Chaos is one of the most important programs, and it is how Tier 1 proves the goal (p91).

```ts
// A sketch; P37's plan picks the names. The runner wraps each step in Effect's own span,
// outside the box, and the sink writes the ended span into its process's JobRecord.
const msg = (letter: Letter) =>
	step(letter).pipe(
		Effect.withSpan("runner.step", {
			attributes: {"fab.process": process, "fab.letter.id": letter.id, "fab.build": build},
		}),
	);
```

- **Where spans come from.** tea 0.23.0's `./otel` traces agent runs only (`traceAgent`), and Tier 1 runs no agent inside fabrika. So spans for a step, a Msg and a Cmd come from Effect's own `Effect.withSpan`, in the runner. Today's `runTraced` (`packages/fabrika/src/program/trace.ts`) shows it works; it is evidence, not the shape. *Corrected 2026-11-07: this page said "monitoring through tea's `./otel`", which names the wrong tool.*
- **Where spans land: a thin JobRecord.** One object per process, holding that process's spans, kept forever, as [a JobRecord holds its trace](../direction/a-job-record-holds-its-trace.md) says. A restart is a new process with its own id (P33), so it gets a new record, and each span carries `fab.process`, that id. In Tier 1 no process starts another, so a job is one process. The letters stay in the ledger forever, and any state rebuilds by replay. Later tiers add the rest of the record.
- **Health has two levels** ([the five layers](../direction/a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first)). A raw health row per ended span is kept locally about 2 weeks, then in R2, forever. *Changed 2026-11-07 (owner, in P37's plan): it said each ring and each renew, kept about 2 weeks.* Hourly summaries per piece are kept forever. Anything someone decides with stays a ledger fact forever.
- **The same on both instances.** Our own records, read by our own programs: `trace`, `ps`, later a dashboard program. Alchemy's local stage has no trace viewer. Cloudflare's own tracing, turned on in P24, is a second opinion on the cloud only.
- **What each piece records.** Every Tier 1 piece records RED: rate, errors and duration. Anything that delivers events also records consumer lag. For the ledger's doorbell: rings sent, reads per ring, each reader's lag behind the newest entry, and the time from a write to a reader seeing it.
- **Each object records its own size,** since Cloudflare shows only a namespace total, and at 10 GB writes fail.
- **Three facts that were lost are now recorded:** `dead` keeps each throw's error class, `down` gains `until`, and a failed Cmd always comes back as a letter with a `why` (p35, p80; [the detail](./tier-1-detail.md#what-fact-is-lost-forever-if-we-dont-record-it-now)). *Amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)): `down {until}` goes; past its brake a name is `failed` until a person restarts it.*
- **Size:** P37, the span sink, is 450 to 600 lines with tests. Spans in ten other rows add the rest: about 700 to 1,000 lines in all, 1.2 to 1.7 agent hours, plus the thin JobRecord, not yet sized. Sure 60 to 70%: [the study that sized it](../../experiments/273-observability-in-tier-1.md) read code and docs and ran nothing.

## Rules that bind

Read [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) first. It holds for all of this. Where two notes clash, the newer holds, and the clash goes in `questions`.

**How `next/` is written:**

- **Effect all the way.** A Promise appears only in a one-line edge the platform demands ([no Promises](../direction/no-promises.md)). The word stays **edge**, Effect's own. **An edge is a line marked with an edge comment, opted in where it stands** (owner, 2026-11-05, [question 13](#open-questions)): `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`. Without it, `Effect.tryPromise`, `Effect.promise`, Promise syntax and Effect's run functions fail everywhere in `next/`. A build commit that adds an edge comment does not block: the pull request asks the owner, one line each with its reason, `[ok] [no]`. P35 builds it. [The glossary](../../.glossary/TERMS.md#shared-names) has the word. *Changed 2026-11-05 (owner): earlier that day an edge was a file on a written list, the 18 whole paths in P2's `no-effect-run-outside-edge`, and this plan leaned on holding `Effect.tryPromise` to that list. Both are walked back: a list of files let a whole file wrap Promises, and a comment marks the one line.*
  - **What P2's rules do not hold yet.** `no-promises` sees Promise syntax, not Promise values, so today `Effect.tryPromise(() => fetch(url))` passes it in any file. P35 closes that: `Effect.tryPromise` fails like `Effect.promise` unless an edge comment stands over it. A Promise reached with no Promise syntax at all, such as a platform call returned from a helper, still passes; only types would see it.
- **Secrets are `Redacted` at the read** ([secrets are redacted](../direction/secrets-are-redacted.md)). The lint rules catch only `process.env` and `Redacted.value`, so each row that reads a secret names it in its plan and adds a law that it stays home: a search over frames, ledger rows and log lines, as the recovery note's is. The rows: P19 (sealed key bytes), P21 and P23 (the one-time link's pass), P25 (an agent's key file) and P28 (the 12 words). Lean 70%, from the audit of 2026-11-06.
- **An object class stays thin:** what the platform gives it and a one-line handoff. The logic runs on Node in tests ([the note](../direction/object-classes-stay-thin.md)).
- **A window reads state through tea's own React hook.** State lives in a tea machine, never `useState` ([Elm first](../direction/elm-first.md)). *Changed 2026-11-02:* tea 0.22.0 fixed `useMachine` under Strict Mode ([demlik PR 774](https://github.com/kamp-us/demlik/pull/774)), so the reason for our own hook is gone. tea's hook does not take the Effect engine yet ([demlik 852](https://github.com/kamp-us/demlik/issues/852)). Until it does, one `useSyncExternalStore` hook in one file stands in, and it goes when tea's lands. PR 223's `window/main.tsx` still uses `useRuntime`, whose dispatch is a Promise, so this has to change. *Changed 2026-11-03:* tea 0.23.0's `useRuntime` takes an Effect-engine run, returns a `send` that returns nothing, and takes a selector ([demlik PR 856](https://github.com/kamp-us/demlik/pull/856), [PR 859](https://github.com/kamp-us/demlik/pull/859)), so it is the hook and no stand-in is written. PR 223's `useRuntime` call stays, and its awaited dispatch becomes a plain `send`.
- **React Compiler from day one.** Owner rule, decided 2026-11-02; the how is decided 2026-11-03 in [the note](../direction/react-compiler.md), strict: every Compiler finding fails the build, with no setting and no advice level, and the only exit is `"use no memo"` with an owner-approved `compiler-ledger.json` row. No Babel (owner, 2026-11-02): `build.ts` compiles every `.tsx` file with oxc's native port of the Compiler, in Rolldown. The build owns the check, and `lint:compiler` calls the same step: either fails on any function the Compiler skips that `compiler-ledger.json` does not name. A view never reads the clock; the time comes through a Cmd. `react/refs`, `react/immutability`, `react/display-name`, `react/purity` and our `no-clock-in-view` block in `next/**/*.tsx`, and `one-store-hook` in all of `next/**`. The rules, the check and the packages landed in the exam PR (P2, [as built](#the-exam-on-main)); the Compiler goes into the instance's build in P12 (the detail's T6) ([the detail](./tier-1-detail.md#the-exam-pr-not-in-this-plan)).
- **One bundler in `next/`: Rolldown** (owner, 2026-11-05; it was a lean at 85%, from [experiment 195](../../experiments/195-oxc-toolchain.md)). P1's `deps.test.ts` bundles each top level with esbuild, copied from today's `lint:browser`, and `esbuild` sits in `next/apps/fabrika/package.json`. P12's test writer commit pins `rolldown` in the catalog, moves that exam to Rolldown and drops `esbuild` from `next/`; P12's build commits bring Rolldown into the build. *Changed 2026-11-05 (owner): this was an exam half inside P12, then its own pull request, P12a.* The root keeps `esbuild` for today's `lint:browser`. Everything that builds in `next/` uses Rolldown from P12 on, and nothing in `next/` bundles before P12 but that exam. Where Rolldown's way is not yet proven here is in [the detail's Packages](./tier-1-detail.md#packages). PR 223's two `.tsx` files compile whole: 5 functions, 0 skips ([experiment 194](../../experiments/194-react-compiler.md), and [195](../../experiments/195-oxc-toolchain.md) on oxc's port).
- **`_tag`, written by Effect Schema, for every union we define.** tea's Msgs and Cmds keep `type`. PR 223's `kind` and `is` move ([Tags](./tier-1-detail.md#tags)).
- **No bare `of`, and no `xOf` names.** The copies bring about 55, so they get fixed on the way in.
- **Words:** hands, a window and an agent dial the brain. `client` means any of them at the door, and `host` is a place hands can run ([the note](../direction/brain-hands-window-agent.md)). No `peer`, and no `node` for a thing that connects. PR 223's 53 `peer` lines go when it moves. The shell is `fabsh`.
- **Layers go one way,** and programs have no power of their own. A Cmd is data, and the runtime does it.
- **Every keybinding is configurable from day one.** Owner rule ([the note](../direction/keybindings-are-configurable.md), decided 2026-11-01). The first window reads its keys from the person's own file, `~/.fabrika/keybindings.toml`, and no key is wired into a handler. That covers `e` on a note, and every other key Tier 1 shows. How a browser tab, which has no files, gets that table is in [the note](../direction/keybindings-are-configurable.md#a-browser-tab-has-no-files). See [the questions](#open-questions).
- **Hot reload from day one.** Owner rule, decided 2026-11-01 ([the note](../direction/hot-reload.md)). Under `dev.ts`, saving a program's file swaps that program's code in its running processes at their next step, through each one's mailbox. The model is kept when the new state schema decodes it, and only that process is refused when it does not. No other process stops, and the brain restarts only for a core change. A window swaps that program's view the same way. Every record a process writes names the build that wrote it. Size: about 400 to 600 product lines and 300 to 500 test lines, 50% sure, not in the approved size yet. At the measured rate that is about 1.2 to 1.8 agent hours, a `2` on the scale (0.4 to 0.7 at 1,660 an hour, a `1`).
- **Never copied, with three named exceptions from the owner:** styling, `programs/markdown`, and the MCP tools. Each copy carries a comment naming its source path and commit.

**How it is built:**

- **Every pull request takes the pipeline's steps, by hand:** plan, tests first, build, mutation, one review, each by its own agent, and the lead agent's check before merge ([how it is built now](#how-it-is-built-now)). *Changed 2026-11-05: this said every pull request goes through today's pipeline, with a step that cannot run going by hand. Today's pipeline is paused, so for `next/` every step goes by hand, and each is logged in `field/`.*
- **The test writer only adds new `*.test.ts` files.** A helper goes in such a file too. It does not move a test, change one, delete one, or write a data fixture. The builder never touches the tests or the exam, and the lead agent checks both in the diff before merge. So a saved vector or a fixture comes from an exam PR, or sits inside a test file. A later law goes in a new test file rather than a bigger old one, so each landing adds its own e2e file, and the exam holds a thin runner that finds them (my call, 80%). A test that renders React uses `createElement` in a `.ts` file.
- **A law on a real window or a real service can go red first now.** In the lane, the test writer ran vitest in a box with a temp home and no network, so laws on real Chromium, real Electron, launchd or the cloud (p29, p31, p46 to p48, p50, the live halves of p51, p58, p59, p62, p41) had no red-to-green step. By hand, the test writer runs on the laptop, so Chromium and Electron laws are written and run red on the base like the rest, one Electron test app at a time, with `FABRIKA_HOME` set to a short temp path. Laws on launchd from a dev build, the real finger and the cloud still run by hand and are logged. Lean, 70%; the first Electron law tells.
- **The catalog lives in `pnpm-workspace.yaml`, an exam file.** A new dependency lands in the test writer's commit of the pull request that needs it (P12 for `rolldown`), so the owner reads it. A package's own `package.json` is the builder's, and so is `pnpm-lock.yaml`. Today's catalog already has Electron, `@modelcontextprotocol/server`, `@pierre/highlights` and the mdast packages, and P2 added `oxc-transform-react` and `oxc-parser` at 0.157.0. `@effect/platform-browser` and `rolldown` are ones it lacks; `rolldown` comes with P12's test writer commit.
- **A rule or law that lives in the exam is written by the exam PR.** A pull request that "owns" it (p24, p32, p65) only turns it green. Everything else is the test writer's: each machine's `*.laws.test.ts`, and the ported tests for the copies. The small exam holds their fixtures and rules.
- **On main, every law is `new`.** There is no `next/` to pass an `existing` test on. So plan-115's `existing` laws go red first like the rest, and p16 means PR 223's tests come over, fitted.
- **Guarding the exam files in today's lane no longer blocks Tier 1.** Tracker ticket 122 adds `next/**/*.test.ts`, `fixtures/next/**`, the exam folder, `boundary-rules.json`, `vitest.config.ts` and `pnpm-workspace.yaml` to the lane's `RULES` (`packages/pipeline/src/stages/exam/machine.ts`). No lane builds `next/` now, so the lead agent's read of each diff is the guard. Ticket 122 stays for when a lane does.
- **Long checks do not block a pull request.** Decided 2026-11-01 in [fast and daily mutation](../direction/fast-and-daily-mutation.md): "A check that cannot finish inside the per-pull-request budget does not gate the pull request. It runs on a schedule, and what it finds becomes a ticket." The checks that stop the wrong thing from merging never move to the daily side: typecheck, lint, the leak checks, the dead-export ledger and the tests of changed files. Tier 1's likely long ones: real launchd, the cloud smoke run, chaos. The daily run itself is not in Tier 1: the note puts `next/`'s mutation queue in Tier 6, and [experiment 197](../../experiments/197-daily-checks-on-cloudflare.md) sizes running it on Cloudflare. Until then a long check runs by hand and is logged. *Changed 2026-11-05: this said "new direction, with no note on main yet", which was wrong since 2026-11-01.*
- **Mutation on a pull request is the fast check, as the note sets it.** Changed lines first, one mutant per line, then the rest; a 5-minute cap, a 10 s test limit, static mutants off, the end-to-end tests left out; a survivor is advice and never stops the pull request. Fixed seed, `nice -n 15`. [The detail's mutation step](./tier-1-detail.md#the-mutation-step) says which files each part covers. *Old guess, wrong for this rule: 10 to 25 machine minutes per PR.*
- **Exact versions, never a range.** Today's catalog: Effect 4.1.1, pnpm 12.16.1, Node 26.13.0, Electron 45.2.1, React 19.3.1, since [PR 258](https://github.com/usirin/tea-fabrika/pull/258) landed on 2026-11-01; tea 0.23.0 since [PR 363](https://github.com/usirin/tea-fabrika/pull/363), 2026-11-05; oxlint 1.90.0, and oxc-parser and oxc-transform-react 0.157.0 since P2. The design was read on Effect 4.0.6, so the plan of each pull request re-checks its `Schema` sketches against 4.1.1.
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
- **No clash with the copy:** today's app moved to Radix steps in [PR 308](https://github.com/usirin/tea-fabrika/pull/308) (ticket 144), so the [styling exception](./tier-1-detail.md#styling) copies tokens that already follow these rules. The owner called it moot on 2026-11-02 ([question 5](#open-questions)).

**Windows.** [The note](../direction/windows-in-next.md) is proposed. Plan with [the lean](#open-questions) on it.

## Words that look like a clash

These were checked. The first one was [open question 9](#open-questions), decided by the owner on 2026-11-05.

- **`hello` and `initialize`.** The wire method is `initialize`, as LSP's and MCP's first request is, and as PR 223 has it (owner, 2026-11-05). `Hello` stays the schema's name, as the detail has it, and "hello" is the plain word. The sync note's sketch now says `initialize` too. Tier 1 adds one thing the note does not name: the brain's first frame, `challenge`, carries the nonce the hello signs. The detail's old `ping: Schema.Number` was wrong: it is a string such as `"30s"`, as in PR 223 and the note. The hello also records the OS ([question 3](#open-questions)), and the detail's `Hello` sketch has no field for it yet; its name and values are P10's plan to set.
- **Keychain and `safeStorage`.** Same thing on a Mac. Keys are made with Node's WebCrypto, and `safeStorage`'s async API seals each private half into `userData`, using a master key in the Keychain. The sync API is removed in Electron 46. The capability word `keychain` means "can seal" (renamed `seal` by [question 3](#open-questions)). If the Keychain asks when opening fabrika, the window key moves to WebCrypto in a hidden page. *P4 told, 2026-11-05 ([experiment 214](../../experiments/214-mac-app-four-unknowns.md)):* seal and two opens on one unsigned binary blocked on nothing, so that way out is not needed for this pass. A rebuilt or re-signed app is a new binary to the Keychain and may ask once, which the owner's "open the built app twice" check in P19 still tests.
- **`port` and `pid`.** The sync note's T2 sketch says `{port: "tile:t3", m}`, as `link.ts` once did. Tier 1 and PR 223 name the process: `pid`, as in `Mailbox.send("counter:1", ...)`. A tile is a window's view of a process. "Ports" in this plan means Elm ports, a program's typed inputs and outputs. Nothing named `port` goes on the wire.
- **"Menu bar" and "menu bar extra".** Decided 2026-11-03 in [the frame](../direction/the-frame.md#9-menu-bar-in-next): `next/`'s icon and its rows are the **menu bar extra**, Apple's word, since on macOS "the menu bar" is the system's bar. This page and the detail still say "menu bar" in older lines. New code, tests and pull request titles say menu bar extra. The same note decided that no frame part is called a panel: the menu bar extra's rows are its **popover**, where the detail says "panel" (`panel-preload.ts` is a file name for P21's plan to rethink). It also renamed `next/`'s `fabrika/desk` to `fabrika/tezgah`, which the detail's Tier 2 lines still call the desk.

## A starting guess at the pieces

**Milestones, not pull requests.** These six pieces and their exam PRs were the first cut. They show the order of the demos, and they are too big for small pull requests. PR A carries PR 223's 3,323 lines plus T1 to T6, and PR D is about 1,500 to 2,000 product lines. [The split below](#the-pull-requests-one-at-a-time) cuts them into pull requests a builder takes one at a time. [The tasks T0 to T22](./tier-1-detail.md#tasks) are finer, and each pull request names the ones it carries.

| Piece | The demo at its end | Tasks |
|---|---|---|
| Exam | Rules red on PR 223's tree, each fire read by hand | see the detail |
| A, door and plumbing | Check 1, 2 and 8 | T0 to T6 |
| B, the app | Check 3 | T7, T8, T15, T9 |
| C, cloud | Check 4 | T10, T11 |
| Small exam, then D, notes | Check 5 | T16, T17, T18, T20, T21, T19 |
| D2's design pass, then D2, backup | Check 6 | T22 |
| E, chaos | Check 7 | T12, T13, T14 |

**Names-only tasks do not land alone.** T1 and T16 add names whose bodies only die, so the next task's tests load. That suited one pull request with local commits. On main, it would be a stub sitting in the code. Drop them as tasks: each landing adds the names it uses, and each of their laws moves to the landing that first adds its code. A test that cannot load because a name is missing counts as red, so this loses nothing, and c1 reads per landing. My call, 80%.

**The dead-export check on a bottom-up landing.** Names in a package's `exports` count as public, so they pass. An internal name has to be used already. Nobody has run this on the new shape, which is why the first package landing tries it.

**The whole size: 5,360 to 7,440 product lines and 4,940 to 7,200 test lines, a guess at 50%, which is about 17 to 24 agent hours at the measured full-lane rate of 600 lines an agent hour** (6 to 9 at this repo's median of 1,660, mostly builders alone). Restated 2026-11-01 by [agent hours](../direction/agent-hours.md), from [experiment 187](../../experiments/187-agent-hours.md); sure of the hours: 55%, and [the detail](./tier-1-detail.md#size) has each part on the doubling scale. The by-hand steps are the same steps, so 600 an hour still leads. [The split](#the-pull-requests-one-at-a-time) adds up to more: see there. *Old guess, wrong: 63 to 92 agent hours, at an unsourced "about 150 lines an hour". Before that, also wrong: 44 to 70.*

## The pull requests, one at a time

**Added 2026-11-05. A builder takes one row.** Each row is one pull request that lands alone, with its checks green. It builds on the lean that [PR 223 is read and each layer lands already fixed](#still-open-how-next-reaches-the-lane) (60%), so T0, the move, goes away: each layer's first pull request makes its package. Rows are numbered P1 to P29 in the order they can start, and P30, added later, is now only an exam change with no release wait, since A1, C2 or D5 already name things in the notes. P31 and P32 came later the same day, and each sits in the table where it lands. "Piece" is [the milestone](#a-starting-guess-at-the-pieces) a row belongs to. An exam pull request is written by an agent that is not the builder and read by the owner. A build row's exam changes are its test writer's commit ([how it is built now](#how-it-is-built-now)). A spike ends in an answer, not a merge. "Detail" means [the detail's tasks](./tier-1-detail.md#tasks), and its laws are named there.

| PR | Piece | What it builds | The note it builds | Needs first | Files | Agent hours |
|---|---|---|---|---|---|---|
| P1 | exam | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-05, [PR 402](https://github.com/usirin/tea-fabrika/pull/402).** The exam's frame: `pnpm-workspace.yaml` and `vitest.config.ts` globs for `next/`, a `next` CI job with a thin e2e runner, `layer-rules.json` and `boundary-rules.json` rows, the layers, deps and laws-scan tests, the `sshsig` vectors in `fixtures/next/`, `.gitattributes` (detail, exam items 7 to 10 and 12) | [every pull request takes the steps](../direction/next-is-a-pipeline-pre-run.md), [windows in next](../direction/windows-in-next.md) | nothing | about 12 | 0.5 to 1 |
| P2 | exam | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-05, [PR 401](https://github.com/usirin/tea-fabrika/pull/401).** The exam's rules, each with planted tests and its fire count on PR 223's tree: `no-promises`, `no-effect-run-outside-edge`, `no-of`, `no-hand-tag`, four React rules with `react/purity`, `one-store-hook`, `no-clock-in-view` (added by the owner), `lint:compiler` with an empty `compiler-ledger.json`, and `oxc-transform-react` and `oxc-parser` in the catalog (exam items 1 to 6, 11, 13) | [no Promises](../direction/no-promises.md), [schema classes](../direction/schema-classes-not-of-helpers.md), [React Compiler](../direction/react-compiler.md) | nothing; rebases on P1's catalog lines | about 14 | 1 to 1.5 |
| P3 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-05, yes ([experiment 215](../../experiments/215-browser-key-survives-reload.md), [PR 398](https://github.com/usirin/tea-fabrika/pull/398)).** Spike: does a non-extractable Ed25519 key survive a reload in IndexedDB in Chromium on 127.0.0.1? It survives a reload and a browser restart, and every export is refused. The key belongs to the exact origin, port included, and `localhost` is another origin, so the person's brain listens on one fixed port (P12, P14) (detail T5) | [a browser is always a client](../direction/a-browser-is-always-a-client.md) | nothing | throwaway | 0.25 |
| P4 | B | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-05, all four yes ([experiment 214](../../experiments/214-mac-app-four-unknowns.md), [PR 399](https://github.com/usirin/tea-fabrika/pull/399)).** Spike, T8's four, on a dev build: launchd from an unsigned build, `safeStorage` under Playwright in a temp home, whether the Keychain asks on open, Touch ID. No way out is needed for this pass; what each answer changes is in P19 and P21 | [the desktop layer](../direction/the-desktop-layer.md) | nothing | throwaway | 0.5 to 1 |
| P5 | D2 | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-06 for the sheet:** the backup's design pass is the account recovery note on [PR 404](https://github.com/usirin/tea-fabrika/pull/404), decided by the owner for the sheet. Its rank rule is replaced by "every device is a master" (owner, 2026-11-06), which P9 and P10 build. The email path stays open ([experiment 217](https://github.com/usirin/tea-fabrika/pull/406)) | [every update builds every layer](../direction/every-update-builds-every-layer.md) | nothing | 1 or 2 docs | 0.25 to 0.5 |
| P32 | exam | 0159: **waits** ([the four primitives first](#the-four-primitives-first)); from [0161](../../.decisions/0161-no-step-signing-by-hand.md), today's hand-run tooling makes plain commits, so this check stops gating a merge until `next/`'s own pipeline signs. **Done 2026-11-07, tracker ticket 229, [PR 451](https://github.com/usirin/tea-fabrika/pull/451).** The commit check for `next/`, from [a unit of work is a commit](../direction/a-unit-of-work-is-a-commit.md). One Ed25519 key per step role that commits, `tests`, `build` and `lead` (the lead agent's own commits, such as a merge from main), each made once and kept in the lead session's home, outside the repo. Their public halves in one file, `allowed_signers` at the repo root (OpenSSH's own name for the format; *changed 2026-11-07 by P32's plan: it was the made-up `.github/step-keys`*), in git's allowed-signers format with the role as the name: an exam path the owner reads. The exam's paths are listed in `exam-paths.json`, beside it. The laws are p83 to p87 and p89 in [the detail](./tier-1-detail.md#properties). Each step's agent signs its commit with its role's key into a git note on `refs/notes/fabrika`, not git's own signature slot, so GitHub shows no "Unverified" (owner, tested 2026-11-06). *Changed 2026-11-07 (owner, from [experiment 221](../../experiments/221-signed-steps-and-rebases.md)): a step signs the link, not the commit: its step, its ticket or lane, the tree before and the tree after. A rebase is carried by replay (Gerrit's trivial-rebase check: does `merge-tree` give the new tree?), with old heads kept under kept refs, and GitHub's force-push event is only a cross-check. Only a step's newest signature for this ticket counts. It said: each step's agent signs its commit.* *Added 2026-11-08 (owner): a person signs too, with git's own SSH commit signing, against a `person:<id>` line with `namespaces="git"` in `allowed_signers`, copied from GitHub's list of their signing keys into a pull request the owner approves; this walks back p87's "a fourth role" plant, and ticket 251 builds it ([a unit of work is a commit](../direction/a-unit-of-work-is-a-commit.md)).* Stacks and merges: [0004](../../.decisions/0004-squash-merges-and-native-stacks.md). One file that lists the exam's paths (the detail's [exam files](./tier-1-detail.md#the-exam-pr-not-in-this-plan)). The check is our own program and the workflow only calls it, so moving to our own CI changes nothing; in `next/`, reading check results goes through a `Ci` service ([services](../direction/services-and-our-own-ci.md)). A CI step that verifies each commit's note signature against the keys file and maps the key to its step: no valid signature from a known step key is `stuck: unsigned_commit`, a `build` commit on an exam path is `stuck: build_touched_exam`, and any exam path touched asks the owner to read it. Squash merges stay (owner, 2026-11-05), so each step also signs a link from tree to tree, `{_tag: "attested", step, from, to, by, key, sig, arrivedAt, parent, traceId}`, and CI checks the chain from `main`'s tree to the squash commit's tree (`stuck: broken_chain`); no transparency-log server, the ledger is the log. In Tier 1 each link sits in the step's `field/` row, with every field [the note](../direction/a-unit-of-work-is-a-commit.md#squash-merges-stay-each-step-signs-a-link-from-tree-to-tree) lists, so tracker tickets 227 and 228 lose nothing. Planted commits and links for each answer. Its own row, not in P8: P8 is the notes and agents exam, a different job, and one row does one job; P6 merges after it, so every build is checked | [a unit of work is a commit](../direction/a-unit-of-work-is-a-commit.md), [nobody writes their own exam](../direction/nobody-writes-their-own-exam.md) | P1, P2 | about 8 | 0.7 to 1 |
| P35 | exam | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-07, tracker ticket 230, [PR 435](https://github.com/usirin/tea-fabrika/pull/435).** Split out of P8, and before any product code. Edges as comments ([question 13](#open-questions)): `fabrika/no-promises` also refuses `Effect.tryPromise`; `fabrika/no-effect-run-outside-edge` drops its 18-path list; a line passes either only under `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>` or the same for the run rule, and a disable of either without `edge:` fails; planted lines for each; and the CI ask: a build commit that adds an edge comment asks the owner, one line each with its reason, `[ok] [no]`. The two edges P8 once listed by file come as comments in P25 and P22. The sync test (S2): the laws scan requires each machine's laws file to run it, or to name its reason for leaving it out, with a planted machine that has none | [no Promises](../direction/no-promises.md), [saved state, S2](../direction/saved-state.md) | P1, P2 | about 7 | 0.4 to 0.6 |
| P7 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-07, tracker ticket 231, [PR 429](https://github.com/usirin/tea-fabrika/pull/429).** `transport/sshsig.ts`: SSHSIG written and checked, Ed25519 only, on P1's vectors (p27's vectors, p44) | the detail's call 2, settled by the owner | P1, P2; merges after P35, since its one edge comment fails lint before P35 lands. Its test writer's commit makes `@kampus/libfabrika`'s boundary row, `next-library`, and its bare `package.json`, the package's first pull request (*changed 2026-11-06: it said it rebases on P6's package, but the wave table puts P7 first*) | about 4 | 0.3 to 0.5 |
| P31 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-07, tracker ticket 232, [PR 431](https://github.com/usirin/tea-fabrika/pull/431).** **In today's version.** `@kampus/fabrika-design` in `packages/fabrika-design`: the colors from `apps/fabrika/src/themes.ts`, the `:root` tokens in `window.css` they point at, and the Manti mapping in `window/theme.css`, each read again against [themes](../direction/themes.md) and [color principles](../direction/color-principles.md) and fixed or dropped where those do not back it, never copied as is. Today's app imports it, and its old copies go in the same pull request. The test writer's commit comes first: the package's boundary row, with a type that today's types and `next/`'s may import, its layer if `lint:layers` needs one, its bare `package.json`, and `themes.test.ts` and `themes.frame.test.ts` moved into it, red until the build commit. The text roles wait for the typography study. *Added 2026-11-05 (owner): P14 imports the package, so it is built first* | [one design package](../direction/fabrika-design-package.md), [themes](../direction/themes.md), [color principles](../direction/color-principles.md) | P1, P2 | about 10 | 0.5 to 1, unsure: the note says about half an hour to move, and the rethink is sized nowhere (40%) |
| P6 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-07, tracker ticket 233, [PR 459](https://github.com/usirin/tea-fabrika/pull/459).** `@kampus/libfabrika` and the data layer: the log's `Entry` with `arrivedAt`, `by`, `for`, `sentAt`, `seen`, `cause` and `build` (*`cause` renamed `parent`, with `traceId` beside it, 2026-11-07: [question 15](#open-questions)*), each with a law that a writer cannot leave it out (`build` from hot reload H6, "the one fact that cannot come back later", and `for` from the detail's facts list, both moved here from P15 and P25 so no later row reopens the entry) (owner, 2026-11-05: `cause` as `CauseText`, read back for reading and never turned into an `InputId`, whose type lands here and whose maker is P10's door; [where it lands](#where-inputs-carry-their-sender-lands)); the package's boundary row, `next-library`, and its bare `package.json` come in P7, which lands first (*changed 2026-11-06: P6's test writer made them*); the `Ledger` service (one ledger, a Durable Object everywhere: Miniflare on the laptop, Cloudflare in the cloud), `Ledger.sql` on `node:sqlite` for tests only, never a ledger file of its own, the referee's logic on one synchronous `Sql`, a wait that answers at once, `ready` or `parked`, with a ring row the next append past it rings once, and one span per call (detail T2's data half, p18 to p20, p68, p92 to p95). *Changed 2026-11-07 by P6's plan: p21 moves to P9, which builds what it tests, and the thin `Project` object class, the real `Doorbell` and workerd's `Sql` move to P12, three one-line handoffs tested only over the real wire* | [the five layers](../direction/a-local-first-sync-engine.md#layer-2-data-decided-2026-10-30), [saved state, S1](../direction/saved-state.md#s1-every-entry-says-what-its-writer-had-seen), [ledger behind a service](../direction/ledger-behind-a-service.md), [inputs carry their sender](../direction/inputs-carry-their-sender.md) | P32's keys made; merges after P32 and P35 | about 12; built in 15 | 1.2 to 1.8; P6's plan said 2.1 to 2.6, since the spans and rings came after the row was sized |
| P37 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-07, tracker ticket 238, [PR 475](https://github.com/usirin/tea-fabrika/pull/475).** The span sink, in `next/packages/libfabrika/src/data/` (`trace.ts`, `sink.ts`, `health.ts`, `records.ts`, `archive.ts`): every object installs one Effect `Tracer`, `SpanSink.layer(sql, {object})`, and a span that ends writes a raw health row and an `unsent` row in one SQLite step before `end` returns. `SpanSink.flush` sends `unsent` to the span's record and deletes each row only after a good answer: `job/<process>/<part>` for a span with `fab.process` on itself or an ancestor, `spans/<part>` for every span outside a process. A part rolls at its cap (1 GB, a guess) and writes `rolled`; a reader walks the parts in order. Every row keeps OTLP's span fields, its `links`, and the object that ended it as its `resource` (`fab.object`). A failure's class is the tag `error.type`; its message is the record part's `content`, the one part a person can delete. A write that meets a full disk is held and fails the next `flush` with `storage`: no span is dropped. Health in two levels: a raw row per ended span, joined to it by `spanId`, and an hourly summary per piece, both kept forever. A day of raw rows older than 336 hours goes to R2 as `health/<object>/<day>.jsonl` and is deleted locally only when R2's hash matches and the rows read still count the same; rows that land after their day left go as `<day>.2.jsonl` and on. Each archive try writes a `sink.archive` health row, so a day that cannot leave is seen. Each object writes its own size row at most once an hour. Laws p98 to p102. *Changed 2026-11-07 by P37's plan, with the owner's answers: raw health rows go to R2, never deleted; every span, not only rings and renews, writes one; spans outside a process get their own record in parts. `spans.read` at the door moves to P10, and the record object classes, the R2 binding and the wiring in `brain.ts` to P12. It said: a ring or a renew writes a raw health row, kept about 2 weeks.* Then each row adds its own spans and their laws in its own pull request: P6 (append, read, wait, rings), P10 (the door's envelope, and the inputs note's span link), P11 (the step, each Cmd, a failed Cmd's `why`), P12 (the sink wired in `brain.ts`, the brain's restart), P17 and P27 (each fault fired), P24 (Cloudflare's tracing turned on), P25 (the bridge's calls), P33 (process spans, `down`'s `until`) and P34 (each throw, `dead`'s error classes) | [a JobRecord holds its trace](../direction/a-job-record-holds-its-trace.md), [design for bounded objects](../direction/design-for-bounded-objects.md), [the five layers' two places for records](../direction/a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first) | P6; lands before P10 and P11. The process id is P33's, so P37's laws pass one in, and P33 feeds the real one | 16 | 2.6 to 3.1 planned (the row said 0.75 to 1); built about 3,500 lines, 2,130 of them tests |
| P9 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-07, tracker ticket 236, [PR 473](https://github.com/usirin/tea-fabrika/pull/473).** `Mailbox` (`send`, and `receive` as `Letter`s), `ProcessManager.start` (one `started` line per build hash) and `CoordinationLayer`; `members.ts`, pure: the fact shapes with `Revoke`, the grant's twin, the one rule `allows`, `foldMembers` and `admitted`; `ClientManager`, whose `write` answers `Written` (`applied`, `ignored` or `refused`) and folds again after its append, and whose Layer takes the founder with `person`, `by` and `build`; one `From` for every write in the layer; laws p21 (restated for P6's `append`), p28 (widened), p96 and p97 ([as built](./tier-1-detail.md#coordination-as-p9-built-it)). It checks no `to`: P10's door does. P9 does not wait on [question 19](#open-questions) (owner, 2026-11-07). *What follows is the row as planned.* Coordination: Mailbox, ProcessManager's start, who belongs (`MemberFact`, `foldMembers`), `granted`, `denied` and `revoked` facts (detail T2's coordination half). **Every device the person owns is a master** (owner, 2026-11-06, replacing the recovery note's rank rule): any device may let in or remove any other. The fold takes the grant tree in `admitted`: the person's own devices are equal roots and never hang under another device, so dropping one device never drops another; only tabs and agents hang under the device that let them in, and drop with it (owner, 2026-11-06). Also `added` with `Adds` and `AddSaw`, the spent sheet set and one live sheet: a sheet belongs to the person, not a device, so removing a device leaves the live sheet alone, and only using it or making a new one spends it (owner, 2026-11-06), and the limits: an agent is never a master, a browser tab joins and works but cannot approve (lean 70%), and a recovery key lets in one new device, once (p28, widened). Also p21, the coordination suite over `Mailbox`, `ProcessManager` and `CoordinationLayer` (*moved here from P6 on 2026-11-07 by P6's plan*) | [the five layers](../direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31), [account recovery](https://github.com/usirin/tea-fabrika/pull/404), decided for the sheet 2026-11-06 | P6 | about 10; built in 17 | 1.35 to 1.9; P9's plan said 3.1 to 3.8, since the grant tree, the sheet rules, p21 and spans came after the row was sized |
| P10 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-08, [PR 502](https://github.com/usirin/tea-fabrika/pull/502).** Its five WebCrypto edges (two hashes in `door.ts`; import, sign and verify in `door-nonce.ts`) were read and approved by the owner on 2026-11-08, each one `Effect.tryPromise` with a typed error, and a crypto failure gets the `why` `crypto`, not `storage` ([no Promises](../direction/no-promises.md#edges-the-owner-has-read)). Its `InputId` moves to a TypeID ([question 20](#open-questions)). *What follows is the row as planned.* The door: the signed hello, `initialize`, with `has`, `platform` and the OS, `challenge`, `answerFrame`, `waiting`, the client manager; an unknown key gets `not_granted` and writes nothing; the input envelope `{id, by, arrivedAt, input}` and the `InputId` maker, a client-sent `id` or `by` refused and the refusal recorded (*changed 2026-11-12, ticket 844, PR 1027: refused, counted by the hour, nothing kept, as [0140](../../.decisions/0140-gateway-refuses-client-id-and-by.md) and [0143](../../.decisions/0143-a-refused-write-is-counted-never-a-row.md) decided*), and each envelope in the brain's own log (detail T4, p23, p26, p42, p43, p67); `/grant` takes `added`, and the door holds the limits P9 folds: no approve or remove signed by an agent's key or a browser tab's, a recovery key's one use; the `to` of every `granted`, `revoked` and `added` is this ledger's name, or the fact is refused and nothing reaches `ClientManager.write`, since P9's fold reads no `to` (P9's review, 2026-11-07; plant: `to` ignored); version agreement: the highest shared version picked, none shared refused, unknown fields ignored (p82); `verify` and `seal` as the capability words | [the five layers, T4 and T5](../direction/a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31), [brain, hands, window, agent](../direction/brain-hands-window-agent.md), [a key per client](../direction/a-key-per-client-and-no-github-trust.md), [inputs carry their sender](../direction/inputs-carry-their-sender.md) | P7, P9 | about 10 | 1.3 to 1.7 |
| P33 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-08, tracker ticket 252, [PR 507](https://github.com/usirin/tea-fabrika/pull/507)** ([as built](./tier-1-detail.md#processes-as-p33-built-it)). Processes, Tier 1's slice of C4 and C5, in `coordination/`. `ProcessManager` gains `exit`, `info` (the list `ps` reads), `monitor` and `demonitor`. Each start is a new process with its own id, `process_<26 chars>`; the name (`counter`) stays the registered name, and `ps` counts restarts from `restarted` facts. New facts: `exited {why}`, `restarted {process, after, name, why, build}`, where `after` is the id of the process it replaced, `down {why, crashes, until}`, where `until` is when it tries again (owner, 2026-11-07). `DOWN {process, why, to}` reaches monitors, and a stale `DOWN` never lands in a later process. *Proposed by the lead 2026-11-07, 75%: a start is a new process (OTP); the `run` field goes. Doubt: whether `after` is a link rather than a field; P33's plan settles it.* *Settled by P33's plan: `after` is a field, since `parent` already names the input that caused the write.* `<pid>/dead`, one stream per process start, and the `dead {process, program, name, tries, limit, m, build, errors}` fact's shape, `errors` holding each throw's error class (owner, 2026-11-07; identity added 2026-11-08, ticket 319). A small gateway list per key in the project object, so who is online folds from last pings (T6). First step: draw the line between a Durable Object's wake after sleep and its restart after a crash, since whether a start is a new process rests on it. Laws (p79): the four OTP fixes that apply (`to` on `DOWN`, `noproc`, demonitor flush, the restart window's edge), each with a plant; names are never freed; only the parent sends exit signals; and C5's owed check that ours matches OTP's own docs, since experiment 99 came before experiment 107. Links, trap exit and leases stay in Tier 4: Tier 1 has no process that starts another, and no claims | [five layers, C2, C4, C5](../direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31), [the desktop layer, W3](../direction/the-desktop-layer.md) | P9 | about 8 | 0.9 to 1.4 |
| P11 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-08, tracker ticket 255, [PR 508](https://github.com/usirin/tea-fabrika/pull/508)** ([as built](./tier-1-detail.md#programs-as-p11-built-it)). Programs: `Program` with its Cmd type, `refuse`, `inputs` and `outputs`; the runner and stepper, whose plan first picks whether it steps before or after it appends (PR 223 steps first; the detail's notes section says append, then update), since that decides whether a poison letter reaches the log; `Program` declares its state with `v` and a chain of named upgrades (S3), and each `stepped` record carries `build`; a sync-test helper in libfabrika's test kit until tea ships one (S2); `Write` as `caused` or `own`, the cause carried in the Msg, the Model's queue and the Cmd's input, and the runner's signer with its four refusals; a failed Cmd always comes back as a letter with a `why` (owner, 2026-11-07, p35); the `counter` package, whose boundary row, `next-program`, and bare `package.json` come in the test writer's commit (detail T3, p14, p22, p25, p35, p69). *From P33 (2026-11-08):* the runner writes P33's `Activity` marker around each step and must call `storage.sync()` right after writing `stepping`, since [experiment 231](../../experiments/231-process-wakes.md) lost the marker twice when the object aborted right after the put; it reads fresh mail through `ProcessManager.receive`, not `Mailbox.receive`, and puts the real process ID on runner spans. *Settled by P11's plan: it steps first, then appends, so a fresh step that throws leaves no letter.* *As built:* the runner reads its inbox through P11's new `Mailbox.read`, not `ProcessManager.receive`, and it writes the marker, but no wake reads it yet: that is P34's work. Ticket 893 slice 1 saves view watchers across sleep and prunes missing routes ([pattern](../../.patterns/durable-objects-sleep.md)). | [the app layer, A1 to A3](../direction/the-cloud-is-one-more-host.md#decided-2026-10-31-the-app-layer), [Elm first](../direction/elm-first.md), [inputs carry their sender](../direction/inputs-carry-their-sender.md), [saved state, S2 and S3](../direction/saved-state.md) | P10, P33; questions 16 and 17 before merge | about 12 | 1.5 to 2 |
| P12 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-09, tracker ticket 270, [PR 530](https://github.com/usirin/tea-fabrika/pull/530).** The local instance: `brain.ts`, the gateway, `dev.ts`, the local `alchemy.run.ts`, `grant.ts`, `build.ts` on Rolldown with the React Compiler, a wait as data on the socket; **the local twin check** ([local is the cloud](../direction/local-is-the-cloud.md), walked when Tier 1 started, 2026-11-08): `pnpm lint` fails on a stack resource with no local provider, and its false alarms are counted on the stack before it blocks; the person's brain on one fixed port, since a tab's key is per origin (experiment 215); the bar measured on the base first. **The brain restarts** (M5): `dev.ts` restarts a dead brain with backoff and a brake, kills its process group, restarts it at the 500 MB mark, and writes a start fact with the build. First step: see whether Alchemy's local stage already restarts workerd. Laws: workerd killed mid-burst comes back alone, and a crash loop stops at the brake (p81). Its test writer's commit makes `next/` one bundler: `rolldown` pinned in the catalog, `deps.test.ts` bundling each top level on Rolldown, `rolldown` in and `esbuild` out of `next/apps/fabrika/package.json`; the root keeps `esbuild` for today's `lint:browser` (detail T6's instance half, p10 to p13, p15, p17). Also the thin `Project` object class, the real `Doorbell` (a call to the gateway's stub) and workerd's `Sql` (`ctx.storage.sql`, `transactionSync`, `databaseSize`), each a one-line handoff to P6's data layer (*moved here from P6 on 2026-11-07 by P6's plan*) Ticket 893 slice 1 saves view watchers across sleep and prunes missing routes ([pattern](../../.patterns/durable-objects-sleep.md)). | [local is the cloud](../direction/local-is-the-cloud.md), [React Compiler](../direction/react-compiler.md), [tea is the engine](../direction/tea-is-the-engine.md) | P10, P11 | about 17 | 1.6 to 2.3 |
| P34 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-08, tracker ticket 271, [PR 535](https://github.com/usirin/tea-fabrika/pull/535).** Supervision in the runner, in `app/`. A fresh letter whose step throws is counted per letter id in the process's own storage; at its delivery limit, 3 by default, it moves to `<pid>/dead`, keeping each throw's error class while the message goes to the trace (owner, 2026-11-07), and its sender gets `{why: "dead"}`, so the outbox stops. Each dead entry carries `process`, `program` and registered `name`, filled by `ProcessManager` from the checked historical process, including after replacement (owner, 2026-11-08, ticket 319). A process that crashes N times in T seconds goes `down`, with backoff and the `until` it tries again, and is not woken by resends. Each wake after a crash writes `restarted`. The `[Restart]` act: exit, then start, with the new `init`. A wake that fails on a saved letter is a crash like any other: it restarts with backoff inside the budget, only the brake writes `down`, and every letter is kept (owner, 2026-11-08, following [OTP's supervisor restart intensity](https://www.erlang.org/doc/system/sup_princ.html); it said `down` at once, owner 2026-11-06); p25 rewritten to match, p80. P17, the chaos program, adds `fail_step`'s "three times" case, since chaos is P17's (2026-11-08). *From P33 (2026-11-08):* `ProcessManager.down` and `canRestart` are built (the window counts a restart on its edge); P34 supplies the policy, writes `dead` and starts the successor with `Start.cases.again`. *Amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)): its backoff, `down {until}` and retry at `until` go; P34c makes it OTP's top-level supervisor.* *Wired on the Worker 2026-11-10, tracker ticket 402, [PR 760](https://github.com/usirin/tea-fabrika/pull/760) ([as built](./tier-1-detail.md#p34-on-the-worker-as-built)): PR 535 proved it on Node only; now the runner requires its recovery options and `ProcessManager`, a Process object is keyed by its name so a successor keeps its receipts, and a trusted `restart` reaches the runner through the Process binding.* | [five layers, C2, C4, C5](../direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31), [hot reload, H3 and H6](../direction/hot-reload.md), [tea is the engine](../direction/tea-is-the-engine.md) | P11, P33 | about 6 | 0.8 to 1.2 |
| P34c | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 4 as draft [PR 1092](https://github.com/usirin/tea-fabrika/pull/1092).* **Plan approved, tracker ticket 404, cut into a stack of 10 slices ([0087](../../.decisions/0087-a-pull-request-caps-product-lines.md)); slice 1, structured exit reasons, merged 2026-11-11 as [PR 896](https://github.com/usirin/tea-fabrika/pull/896), and slice 2, the runner's recovery journal as one tea machine (ticket 728), as [PR 926](https://github.com/usirin/tea-fabrika/pull/926). Slice 3, each isolate call's CPU and wall time recorded (ticket 852), merged 2026-11-12 as [PR 1031](https://github.com/usirin/tea-fabrika/pull/1031). Slice 4, quotas per program and the brain's reserved room for its own recovery writes ([0147](../../.decisions/0147-the-brain-keeps-reserved-room-for-recovery-writes.md)), has an approved plan and waits on a host measurement of its default numbers.** *It said, earlier on 2026-11-11: slice 1 is being built, no pull request yet. Before that: plan drafted 2026-11-09, no pull request yet; the owner reads the plan first ([0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)).* P34 turned into OTP's top-level supervisor ([supervisor behaviour](https://www.erlang.org/doc/system/sup_princ.html)). *Amended 2026-11-09 (owner, [0018](../../.decisions/0018-one-application-per-program.md)): each program is its own OTP application with its own top-level supervisor, so past intensity only that program stops and asks the person, and no program's failure stops another; read "root" below as each program's top supervisor.* *Amended 2026-11-09 (owner, [0020](../../.decisions/0020-programs-get-hard-walls.md)): isolation gets hard walls in the same row: quotas per program (writes per minute, storage, time per step), each program's supervisor in its own object, told of a crash by a letter deduped by the exit's id, and `limits.cpuMs` per isolate from a measured step, with a local step watchdog, a guess until measured.* As first written: one root per brain, in the project object beside the process tree, whose children are the brain's named programs; `one_for_one`; a child spec per name with `permanent`, `transient` or `temporary`; intensity and period, OTP's 1 in 5 s unless a reason is written; a restart at once, with no backoff; past intensity the root stops its children in reverse start order and then itself, and the brain marks each name `failed`, logs it and asks the person, who restarts it. `exited` gains a reason a restart type can read (part of ticket 406). Each difference from OTP is written with its reason in the plan's opening table and in C5. p80's restart bullets are rewritten. | [five layers, C4, C5](../direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31), [a browser is always a client](../direction/a-browser-is-always-a-client.md), [experiment 239](../../experiments/239-supervision-vs-otp.md) | P34; the owner's read of the plan | not sized yet | not sized yet |
| P8 | exam | 0159: **helps** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-10, tracker ticket 274, its pull request named in "Where we are now".** The exam is in `next/apps/fabrika/src/exam/` (notes fixture, notes contract, notes laws, markdown, highlight, agents, `agent-may`, `bytes`) with `fixtures/next/notes-letters.jsonl`: 55 laws green on today's main, and 25 pending as `not built: P13`, `P22` or `P25 agent policy`, each skipped only while its target's sources are absent and failing once they exist but are incomplete. The p64 agent method table is written and pending; P25 builds it. The notes small exam, and only that: p22's wording, `notes-letters.jsonl` in the letter's final shape, the ported Markdown, highlight and agents tests, `agent-may` and `bytes` tests (detail, the small exam). *Changed 2026-11-06: its edges half moved to P35, which must land before any product code, while the letters fixture must wait for the letter's shape* | the detail's small exam | P11, P33; lands before P13 | about 9 | 0.5 to 1 |
| P13 | D | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 2, safe input recording, as [PR 1044](https://github.com/usirin/tea-fabrika/pull/1044), past its budget stop with red laws; the pick is the owner's ([0076](../../.decisions/0076-a-lane-stops-at-its-budget.md)).* **Re-planned as a stack of 4 slices ([0087](../../.decisions/0087-a-pull-request-caps-product-lines.md)), tracker ticket 281; slice 1, durable terminal replies, merged 2026-11-11 as [PR 887](https://github.com/usirin/tea-fabrika/pull/887). The old branch, `fabrikalfa/p13`, is not continued ([0072](../../.decisions/0072-a-churning-lane-is-redone.md)).** *It said, earlier on 2026-11-11: slice 1 is being built on a fresh branch, no pull request yet. Before that: tests on `fabrikalfa/p13`, no pull request yet.* **Durable replies.** *Changed 2026-11-11 (owner, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): P13 is cut to its two platform slices, durable terminal replies and safe input recording, and renamed; slices 3 and 4, the notes program, go to Tier 2 with notes. It said: the notes program: its package, with its boundary row and bare `package.json` in the test writer's commit, save on a `base`, a stale save refused and writing nothing, fold; a wake recorded at 1,000 and 10,000 saves (detail T16, T17, p52 to p56).* | the detail's [Notes](./tier-1-detail.md#notes), for its platform half | P11, P8 | about 7 | 0.8 to 1.2 |
| P14 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 2 as [PR 1028](https://github.com/usirin/tea-fabrika/pull/1028), past its budget stop with red laws; the pick is the owner's ([0076](../../.decisions/0076-a-lane-stops-at-its-budget.md)).* **Cut into a stack of 9 slices; [PR 810](https://github.com/usirin/tea-fabrika/pull/810) (ticket 286) was closed 2026-11-11. Slice 1, a real browser page in the build and the counter's typed view (ticket 698), merged as [PR 912](https://github.com/usirin/tea-fabrika/pull/912). Slice 2, ticket 828, has tests on `fabrikalfa/p14c-s2-wip`, no pull request yet. [0125](../../.decisions/0125-the-example-program-is-a-checklist.md) makes the checklist the example program in place of the counter. Slice 2 draws an item's note as plain text (2026-11-11, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)).** *It said: PR 810, open, too large for the 600-line cap ([0087](../../.decisions/0087-a-pull-request-caps-product-lines.md)), so it is being cut into slices, and a restack plan is being written (2026-11-11).* The first window, in a browser tab: `@kampus/tuval`, whose test writer's commit adds its boundary row, `next-tuval`, its bare `package.json`, and p65's one named exception, so a `next/` package may depend on `@kampus/fabrika-design` and on nothing else outside `next/` ([AGENTS.md's one exception](../../AGENTS.md#two-versions-side-by-side)); its browser key, the waiting view, tea 0.23.0's `useRuntime` as the one store hook, the counter's view, its styles from `@kampus/fabrika-design` (the colors, the tokens and the Manti mapping, from P31) plus a copy of only what the package lacks: the tile, title bar, frame and slot rules ([the detail's Styling](./tier-1-detail.md#styling); owner, 2026-11-05: the design package note wins over the copy), the keys read from the keybindings table, the window machine's `now` Cmd (the time never read in a view, about 40 lines by the React Compiler note). No stand-in hook is written ([PR 363](https://github.com/usirin/tea-fabrika/pull/363), [experiment 213](../../experiments/213-tea-react-select.md)). Lean from experiment 215: call `navigator.storage.persist()` once after the grant, one line, its effect not measured. Demo: checks 1, 2 and 8, the success bar's browser half (detail T5, T6's window half, p24, p29, p32) | [Elm first](../direction/elm-first.md), [UI on Manti](../direction/ui-on-manti.md), [keybindings are configurable](../direction/keybindings-are-configurable.md), [one design package](../direction/fabrika-design-package.md) | P12, P3, P31; ticket 893 slice 1 ([saved watchers](../../.patterns/durable-objects-sleep.md)); first-window lane proves a real press after idle without reload | about 14 | 0.9 to 1.2 |
| P16 | C | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Built 2026-11-09, tracker ticket 282, [PR 687](https://github.com/usirin/tea-fabrika/pull/687).** One built file: programs and window scripts inside it, the program table; the local bar must not get worse. Rolldown carries each built script as text through a plugin's `load` hook that answers `moduleType: "text"` ([as built](./tier-1-detail.md#the-biggest-calls)) (detail T10, p33) | [the cloud is one more host](../direction/the-cloud-is-one-more-host.md), [local is the cloud](../direction/local-is-the-cloud.md) | P12 | about 4 | 0.3 to 0.5 |
| P15 | A | 0159: **helps** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 1 as [PR 1012](https://github.com/usirin/tea-fabrika/pull/1012).* **Tests on `fabrikalfa/p15-wip`, tracker ticket 291, draft [PR 991](https://github.com/usirin/tea-fabrika/pull/991).** *It said: no pull request yet.* Hot reload under `dev.ts`, as the note decided it: a program's new code swaps in at its next step, the model kept when the new schema decodes it, else migrated through S3's chain or that one process refused; the `code.loaded`, `code.refused` and `code.failed` facts; H4's `step.crashed` and `code.rolled_back`; the tile's mark and `[Restart]` through P34; the window swapping a program's view by hash, served by the brain. A view swapped this way goes through the Compiler too, and experiment 195 did not try hot reload with it. Laws p70 to p78, from the note's nine. *Open, 2026-11-09:* H4 rolls a throw after a swap back to the old code, while P34 made a throw a crash that restarts on the same build; which comes first? | [hot reload](../direction/hot-reload.md), [saved state, S3](../direction/saved-state.md) | P14, P34 | about 7 | 1.2 to 1.8 |
| P17 | E | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Split in two. P17a, the door in libfabrika and a revoke that stops writes, built 2026-11-08, tracker ticket 287, [PR 537](https://github.com/usirin/tea-fabrika/pull/537). P17b, the rest, lands in three slices on the same ticket. Slice 1, the history checker and the off contract, merged 2026-11-12 as [PR 1037](https://github.com/usirin/tea-fabrika/pull/1037): the `Fault`, `Start`, `Fire`, `Fired` and `Report` schemas and the pure count and recovery folds in `runtime/Chaos.ts`, the `Nemesis` contract with its own nested errors, `NemesisNone.layer`, which refuses fire and check with `Off`, `NemesisLedger.layer`, which checks real history and takes its fire operation from the caller, and `ProcessHistory` in `processes/`, the bounded read of one name's inbox and restart facts. Slice 2, the bounded chaos program, merged 2026-11-12 as [PR 1046](https://github.com/usirin/tea-fabrika/pull/1046): the `@kampus/chaos` package (`next/programs/chaos`) with its boundary row, one tea machine in `runtime/ChaosMachine.ts` with its `now`, `fire` and `inspect` Cmds, the saved `pure-rand` schedule in `runtime/ChaosSchedule.ts`, which draws one fault per timer and keeps its four words in the Model, the loader's `fire` owner as the exact name `fabrika/chaos`, and the runner's refusal of a start whose target is the chaos process itself. Its laws run the real runner on real SQLite with a controlled fire handler; the app still selects no chaos program and no live fault fires. Slice 3, the checklist faults and the real local p90 revoke, merged 2026-11-12 as [PR 1058](https://github.com/usirin/tea-fabrika/pull/1058): a step hook that does nothing unless a test arms it, laws that a failed checklist step and a lost reply recover, and the real local revoke scenario, where no input from the old key lands after a signed revoke while another client keeps working. All three slices are on main and p90 passes there, so P17 is done as of 2026-11-12. p90 was red on main for 47 minutes that day: its worker fixture lacked the `IsolateTail` export that [PR 1031](https://github.com/usirin/tea-fabrika/pull/1031) made every process load need, and [PR 1073](https://github.com/usirin/tea-fabrika/pull/1073) added it. *It said, earlier on 2026-11-12: slice 3 is not built; P17b is done only when all three land and p90 passes.* *It said: P17b has its tests on `fabrikalfa/p17b-wip`, no pull request yet; those old tests were read for their laws and not kept.*** The chaos program: its package, with its boundary row and bare `package.json` in the test writer's commit, `Fault` cases, the nemesis's check, the checklist as its target (*changed 2026-11-11, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md): it said notes and the counter*) (detail T12, p34, p36, p90; c11 moves to P27, since live faults come there). Its tile's "when it recovered" folds from P34's `restarted`. *New 2026-11-07 (owner):* one more case, a key revoked mid-run while its client is writing: the door refuses every write from that key once the `revoked` fact lands, even from a client on old code, so a stop works at the door, not by message (p90) | the detail's [Chaos monkey](./tier-1-detail.md#chaos-monkey) | P11, P44, P34 | about 6 | 0.5 to 0.7 |
| P18 | B | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Four slices, tracker ticket 290. Slice 1, one window client for the browser and headless, is [PR 1208](https://github.com/kamp-us/tea-fabrika/pull/1208), built 2026-11-13:** the window parent, the start and the hello exchange (`transport/Handshake.ts`, one tea machine) move into the library as `@kampus/libfabrika/client/*`; the browser tab and `Headless.start` run the same machine and the same start on Effect's own socket, and Tuval only draws; a closed dial's connect row keeps its close code; CI's end-to-end job runs one round-trip suite against both. Slice 2 is monitors and `DOWN` on a tile, slice 3 tiles that read only their part, slice 4 `keep` and closing a tile, after the focus walk. *It said, earlier: tests on `fabrikalfa/p18-wip`, no pull request yet.* *2026-11-11: a layout plan was drafted and is kept for Tier 2, per [0279](../../.decisions/0279-tuval-is-a-package-desk-in-tier-2.md).* The client cores: `tuval` dom, browser and headless, the Effect socket, tiles that read their part with a selector and no `memo` ; a tile follows its `keep` on its process's `DOWN` and shows the reason (detail T7, p30, p50, c8). *From P33 (2026-11-08):* a window's monitor names its exact client session as its recipient, and its `DOWN` lands in `client:<id>/inbox`. *Answered by OTP, 2026-11-13, built in slice 2:* each restart is a new process id and a monitor never follows the name (P33, P34), so a surviving tile looks `processes/<name>` up again and monitors the process it finds with a fresh reference, as `erlang:monitor/2` resolves a registered name once. *It said, 2026-11-09: open, does a tile watch the name, or monitor the successor again?* The desktop note's W3 is updated to the built `DOWN` shape. **The browser client in CI** ([a browser is always a client](../direction/a-browser-is-always-a-client.md), walked when Tier 1 started, 2026-11-08): the CI job starts its own Miniflare and a headless browser, which connects, signs a hello, pings, sends one message and reads the answer; every transport runs the same suite | [the desktop layer](../direction/the-desktop-layer.md), [React Compiler, C6](../direction/react-compiler.md) | P14, P33 | about 10 | 0.8 to 1.2 |
| P19 | B | 0159: **needed** ([the four primitives first](#the-four-primitives-first)); built beside the browser page (owner, 2026-11-13). *Open 2026-11-13: slice 1 as draft [PR 1079](https://github.com/usirin/tea-fabrika/pull/1079).* **Open, three slices, parent tracker ticket 294.** Slice 1, ticket 881, is built on its branch in `next/`, awaiting review: reusable brain-service contracts, one lifecycle machine and a launchd adapter. Its real-brain host check is still owed. Slice 2 adds sealed identities and atomic founding storage. Slice 3 adds the complete Electron client and recovery with both windows, after the shared P18 client lands. No `childBrain`; Quit confirms label absence and owned-child cleanup before removing the plist. Crash-only restart keeps P12's brake. Tests use a stand-in seal; the one real-seal law owns and removes its exact Keychain item. The p81 recovery bar and the owner's twice-open check remain required. | [the desktop layer](../direction/the-desktop-layer.md) | P18, P4 | about 9 | 1.1 to 1.6 |
| P21 | B | 0159: **needed** ([the four primitives first](#the-four-primitives-first)), in part: the thin version, approve and deny, right behind P19 (owner, 2026-11-13); the rest waits. *Open 2026-11-13: slice 1 as [PR 1097](https://github.com/usirin/tea-fabrika/pull/1097).* **Slice 1 in build, tracker ticket 887.** The pure menu bar extra machine, `Menu.view`, `PersonCheck` contract and `desktop.link-ttl` in `next/`. P21 stays open for slices 2 to 4: the gateway list, the Mac check, then the real extra. Approve, Deny and Remove (detail T15, p45, p49, p51). P4 found `canPromptTouchID()` true on an unsigned build; whether `promptTouchID` shows and answers needs a person in slice 3. The let-in list's tab count comes from `Connections.online(key)`, computed on each ask and never written; a failed probe answers `unknown` | [the desktop layer](../direction/the-desktop-layer.md), [the frame, item 9](../direction/the-frame.md#9-menu-bar-in-next) | P19, P33; slice 1 needs no P19 code | slice 1: 3 product files and docs | slice 1: about 310 product lines |
| P23 | B | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Tests on `fabrikalfa/p23`, tracker ticket 327, no pull request yet.** The app's demo: routes, "Open in browser" and its one-time link, shots in five layouts. Check 3 (detail T9, p31, p47, p48) | [the desktop layer](../direction/the-desktop-layer.md) | P21 | about 4 | 0.4 to 0.6 |
| P24 | C | 0159: **needed** ([the four primitives first](#the-four-primitives-first)); built alongside once the window works (owner, 2026-11-13). **Tests on `fabrikalfa/p24`, no pull request yet.** *A ticket clash to fix:* the tracker gives ticket 331 to P28, but P24's branch commits and its field rows from PR 553 say ticket 331 too; field note 2026-11-09-02 and the 2026-11-08 note on lanes 331 and 329 say P24's tracker ticket is 329. The cloud instance and the menu bar extra's second link. The owner reads `alchemy plan` and says yes. Check 4 (detail T11, p41). It carries chaos's off build for the real ledger, with p38 and p60's build half, since it is the first cloud deploy after P17. *Changed 2026-11-11 ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md), with [0125](../../.decisions/0125-the-example-program-is-a-checklist.md)'s amendment): check 4 proves the checklist there, not the counter* | [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md), [local is the cloud](../direction/local-is-the-cloud.md) | P16, P17, P21 | about 6 | 0.6 to 1 |
| P25 | D | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 1 as draft [PR 1099](https://github.com/usirin/tea-fabrika/pull/1099).* **Tests on `fabrikalfa/p25`, tracker ticket 328, no pull request yet.** Agents through MCP: the copied tools, `fabrika mcp --as`, the bridge as a client with a key, Approve once per agent name; `ps` reads P33's process list, the industry's word, which today's tsh uses too, *Changed 2026-11-07 (owner): it said `runs`.*; the agent's key file read as `Redacted`; spike first on Claude Code listing tools while it waits (detail T21, p63, p64, c17). *Changed 2026-11-11 ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): the bridge is handed `[checklist]`, not `[notes]`, and the demo is an agent's `checklist_check` with a note* | the detail's [Agents through MCP](./tier-1-detail.md#agents-through-mcp) | P13, P44, P21, P8, P33 | about 12 | 1.1 to 1.6 |
| P26 | D | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). The checklist goes real on Cloudflare: the phone spike, the owner's yes on `alchemy plan`, the deploy. Check 5 (detail T19, p58, p59, c15). *Changed 2026-11-11 ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): it said notes go real* | [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md) | P44, P25, P24 | about 6 | 0.3 to 0.5 |
| P27 | E | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **P27a's tests on `fabrikalfa/p27a`, tracker ticket 330, no pull request yet.** Live faults on each instance, with p37 and c11: each fault shown can really fire there. "When it recovered" folds from P34's `restarted`. Nothing is lost: for every fault fired, the ledger and the JobRecord alone say what broke, when, why and how it recovered (owner, 2026-11-07) (detail T13, p37, p91) | the detail's Chaos monkey | P17, P24 | about 6 | 0.4 to 0.6 |
| P28 | D2 | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Tests on `fabrikalfa/p28`, tracker ticket 331; its build is parked until P19, P21 and P26 land.** *P24's commits and field rows use 331 too, a clash to fix (see P24's row).* The sheet, on P9's and P10's shapes: its own small exam in the test writer's commit, then the 12 words, the sheet's screens and words, recovery on a new Mac, and the menu bar's quiet row. "Check my sheet" writes a record of when, on which device, and whether it matched, never the words (owner, 2026-11-06). Check 6 (detail T22) | [account recovery](https://github.com/usirin/tea-fabrika/pull/404), decided 2026-11-06 | P26, P9, P10 | about 8 | 0.3 to 0.6 |
| P36 | D2 | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: its exam as [PR 1032](https://github.com/usirin/tea-fabrika/pull/1032).* **Tests on `fabrikalfa/p36-email`, tracker ticket 332, no pull request yet.** Email recovery, for the Cloudflare setup (owner, 2026-11-06): a 6-digit code to the person's checked address, good for 10 minutes and 5 tries, only its hash kept and never in the ledger; the right code lets the device in at once, and its drops apply with it; a key the brain holds for this one job that signs only that `added`, never leaves the brain, and has its public half on the ledger; the facts `verified` (at setup) and `added`. *Changed 2026-11-11 (owner, [0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)): no 24-hour wait, no Cancel and no `requested` or `canceled` facts. Every live device shows a plain notice with nothing to act on, and the recovered device is in the list of let-in devices, where its Remove works as on any device. The branch's tests were written for the wait and change in an exam pull request (tracker ticket 840). It said: a 24-hour wait any live device can cancel with no finger, the drops waiting with it, and the facts `requested` and `canceled`.* It sends through Cloudflare's free `send_email` binding on the cloud instance. First steps, the note's two unknowns: whether the no-domain route (Access's one-time PIN) works, and whether the code reaches the inbox. Its own row, not in P28: it needs the cloud instance and an email send, and together they would be the plan's largest row | [account recovery](https://github.com/usirin/tea-fabrika/pull/404), decided 2026-11-06, [experiment 217](https://github.com/usirin/tea-fabrika/pull/406) | P28 | about 6 | 1 to 2, sure 45% |
| P29 | E | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). The drill on the MCP client, with the checklist as its target (*changed 2026-11-11, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)*), the owner's yes on `alchemy plan --stage drill`, a verdict on screen; `kill_brain` comes back through P12's brain restart. Check 7 (detail T14, p39) | the detail's Chaos monkey | P27, P25 | about 4 | 0.5 to 0.6 |
| P30 | exam | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Done 2026-11-08, [PR 497](https://github.com/usirin/tea-fabrika/pull/497):** written and signed by the tests role, reviewed merge-ready, and the mutation step added six laws. **Shrunk 2026-11-06:** tea's own hook came early. [PR 363](https://github.com/usirin/tea-fabrika/pull/363) moved the workspace to tea 0.23.0, whose `useRuntime` takes the Effect engine and a selector, so no stand-in is written and nothing is deleted ([experiment 213](../../experiments/213-tea-react-select.md)). P30 removes the exam's allowance for `window/use-model.ts`, so `useSyncExternalStore` is imported nowhere in `next/`, as the React Compiler note now says. *It said: bump tea to 0.24.0 once out, move the window to `useMachine`, and delete `use-model.ts`.* | [Elm first](../direction/elm-first.md), [React Compiler, C4](../direction/react-compiler.md) | nothing | about 6 | 0.1 to 0.2 |
| P38 | A | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 3b-1 as [PR 1054](https://github.com/usirin/tea-fabrika/pull/1054).* **Planned in 7 slices, tracker ticket 664; slice 1, the local port as a declared setting read from the two settings files, merged 2026-11-11 as [PR 901](https://github.com/usirin/tea-fabrika/pull/901), and slice 2, `fabrika settings` showing each value and where it came from (ticket 730), as [PR 954](https://github.com/usirin/tea-fabrika/pull/954). Slice 3 is cut in three on ticket 753; slice 3a, one codec per declaration for the settings files and the snapshot, with a strict snapshot read that checks its hash, merged as [PR 1039](https://github.com/usirin/tea-fabrika/pull/1039). Slice 3b, the Worker handoff, the start record and `limits.record`, comes next, then slice 3c, the remaining declarations. P38 is not done until the whole settings stack lands. [0086](../../.decisions/0086-settings-are-declared-once.md) and [the settings note](../direction/settings.md) are on main. The owner added it to Tier 1 on 2026-11-10 ([0069](../../.decisions/0069-choices-are-settings.md)).** *It said, earlier on 2026-11-11: slice 1 is being built, no pull request yet. Before that: not planned yet; plan to come.* The foundation for loading settings in `next/`: the read of `.fabrika/fabrika.toml` and `~/.fabrika/fabrika.toml`, each setting declared once as an Effect `Config` with its schema and default, and the providers (the file, the environment, a flag, a test). Plus the settings for what Tier 1 already builds or changes. Which settings come first is the plan's call; the lead's sketch is the list of programs an instance loads, then the flags `dev.ts` takes today | [0069](../../.decisions/0069-choices-are-settings.md), [one fabrika.toml per repo](../direction/one-fabrika-toml-per-repo.md) | P12, P16 | not sized yet | not sized yet |
| P39 | to be planned | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). *Open 2026-11-13: slice 2 as [PR 1074](https://github.com/usirin/tea-fabrika/pull/1074).* **Planned in 5 slices; slice 1, a durable job service (ticket 732), merged 2026-11-11 as [PR 917](https://github.com/usirin/tea-fabrika/pull/917), and [0102](../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md) names its first job, `git --version` on one host. The owner added it to Tier 1 on 2026-11-10 ([0088](../../.decisions/0088-six-slices-in-tier-1.md)).** *It said: to be planned.* The thin slice of hands: a program can ask for a command and see it run | [0068](../../.decisions/0068-tiers-carry-every-part.md), [0088](../../.decisions/0088-six-slices-in-tier-1.md), [brain, hands, window, agent](../direction/brain-hands-window-agent.md) | to be planned | not sized yet | not sized yet |
| P40 | A | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Planned in 4 slices, tracker ticket 715; slice 1, qualified program identities, merged 2026-11-11 as [PR 939](https://github.com/usirin/tea-fabrika/pull/939): the core counter builds and runs as `fabrika/counter` through the real builder, embedded table and Worker Loader, its registered name still `counter:1`, and a window's route keeps the whole name. Slice 2, ticket 878, merged 2026-11-12 as [PR 1072](https://github.com/usirin/tea-fabrika/pull/1072): explicit repo selection pins the advertised default-branch commit, checks its settings through P38 and saves repository trust through the local instance. P38 slices 1, 2 and 3a satisfy this slice's foundation. [0132](../../.decisions/0132-a-path-pack-may-sit-anywhere.md) permits source folders anywhere on disk. Slice 3, the listed pack build and its settings, is shared with P38's slice 5 and waits on that shared settings work and P34c; slice 4, the person's start and the cold-author check, waits on P42, P14 and P18. P40 is not done until slice 4's cold-author check passes. The owner added it to Tier 1 on 2026-11-10 ([0088](../../.decisions/0088-six-slices-in-tier-1.md)).** *It said, earlier on 2026-11-11: slice 1 is being built, no pull request yet. Before that: to be planned.* The thin slice of programs written outside fabrika's own source: a person can run a program the app's source does not list, as a repo's own pack listed by a `./` path ([0083](../../.decisions/0083-every-program-in-a-pack.md), [0084](../../.decisions/0084-own-pack-listed-by-path.md)), checked by a cold author ([0075](../../.decisions/0075-cold-author-checks-outside-programs.md)) | [0068](../../.decisions/0068-tiers-carry-every-part.md), [0088](../../.decisions/0088-six-slices-in-tier-1.md), [packs are programs](../direction/packs-are-programs.md) | P11, P12, P16 for slice 1; P38 slices 1, 2 and 3a for slice 2; P38 slice 5, P34c, P42, P14 and P18 for the later slices | about 30 for slice 1, its tests included | not sized yet |
| P41 | to be planned | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Planned in 3 slices; slice 1, a request to another program by a named mailbox and its reply (ticket 744), merged 2026-11-11 as [PR 929](https://github.com/usirin/tea-fabrika/pull/929). Slice 2, the same request and reply between two real Process objects (ticket 764), merged 2026-11-12 as [PR 1029](https://github.com/usirin/tea-fabrika/pull/1029): the sender's object asks the Project to save the letter, and the target's `mailed` sets its one alarm. Slice 3, the example a person sees from a pack, waits on P40's pack path, P34c's walls and how a pack asks for its grant. The owner added it to Tier 1 on 2026-11-10 ([0088](../../.decisions/0088-six-slices-in-tier-1.md)).** *It said: to be planned.* The thin slice of programs working together: one program can reach another | [0068](../../.decisions/0068-tiers-carry-every-part.md), [0088](../../.decisions/0088-six-slices-in-tier-1.md) | to be planned | not sized yet | not sized yet |
| P42 | to be planned | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Planned; slice 1, ticket 770, merged as [PR 1011](https://github.com/usirin/tea-fabrika/pull/1011): a program asks the host to start a child. The owner added it to Tier 1 on 2026-11-10 ([0088](../../.decisions/0088-six-slices-in-tier-1.md)).** *It said: to be planned.* The thin slice of a person starting a program: a person can start a program while the app runs | [0068](../../.decisions/0068-tiers-carry-every-part.md), [0088](../../.decisions/0088-six-slices-in-tier-1.md) | to be planned | not sized yet | not sized yet |
| P43 | to be planned | 0159: **waits** ([the four primitives first](#the-four-primitives-first)). **Planned in 5 slices; slice 1, the merger alone (ticket 765), merged 2026-11-12 as [PR 1030](https://github.com/usirin/tea-fabrika/pull/1030): mailed `land`, it reads the change, brings it up to date, waits for its kind's named checks on that head and merges pinned to it, then mails back one reply. It comes with the `CodeHost` and `Ci` contracts in libfabrika, each with an in-memory Layer, and the pack's five settings; `queue.checks` is empty by default, so nothing lands until a repo names its checks. Slice 2, the queue program and the merger's last look at main, merged as [PR 1096](https://github.com/usirin/tea-fabrika/pull/1096); slice 3, both in Durable Objects, builds on P41's slice 2, on main since [PR 1029](https://github.com/usirin/tea-fabrika/pull/1029); slice 4 puts GitHub behind the contracts; slice 5 is the switch. The owner added it to Tier 1 on 2026-11-11 ([0111](../../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md)).** *It said: to be planned.* The merge queue, stage 1: one queue program holds the line and one merger per change brings it up to date, waits for its checks on that head and merges through `CodeHost`; one merger at a time; tracker ticket 765 | [0107](../../.decisions/0107-fabrika-provides-the-merge-queue.md), [0110](../../.decisions/0110-merge-queue-is-fabrika-programs.md), [experiment 266](../../experiments/266-what-a-merge-queue-must-do.md), [0078](../../.decisions/0078-agent-and-flow-slices-start-early.md), [0068](../../.decisions/0068-tiers-carry-every-part.md) | P34c, P41 | not sized yet | not sized yet |
| P44 | D | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Added 2026-11-11 by the owner ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)). 0125's slice 1, the checklist program (ticket 806), merged as [PR 987](https://github.com/usirin/tea-fabrika/pull/987). The agent's half, slice 1 (ticket 839), merged as [PR 1019](https://github.com/usirin/tea-fabrika/pull/1019): the `items` read port, an optional `note` of 1 to 256 characters (`NOTE_MOST`) on `check`, where a checked item keeps its first note, and ticket 847's three gaps in the laws closed.** The checklist, Tier 1's program: [0125](../../.decisions/0125-the-example-program-is-a-checklist.md)'s slices, plus `items` and `note`. A person adds an item, an agent reads the items and checks one with a note through P25's MCP door, and the person reads the note on screen; ticket 828's window draws it as plain text | [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md), [0125](../../.decisions/0125-the-example-program-is-a-checklist.md) | P11 | 6 in slice 1 | about 0.4 for slice 1 |
| P45 | D | 0159: **needed** ([the four primitives first](#the-four-primitives-first)). **Planned in 3 slices. Slice 1 (ticket 884) merged as [PR 1089](https://github.com/usirin/tea-fabrika/pull/1089): `@kampus/inbox`, one row per fact in first-arrival order, no client or agent input, and no window or boot entry. Brain letters use the notice id space and reach programs without ports; client entry points refuse those ids. Refused or throwing notices are skipped and counted on the span. Only slice 1 is approved; slices 2 and 3 wait on the owner.** A thin `inbox` program: it shows only notices from the brain, read from facts already in the ledger. Its first row is the email recovery notice of [0138](../../.decisions/0138-email-recovery-lets-in-at-once.md), so no toast is built. A dismissal is kept on that device only. Asks, messages, replies, the top bar glance and the phone slice stay in their later tiers | [0151](../../.decisions/0151-a-thin-inbox-is-a-tier-1-row.md), [0480](../../.decisions/0480-the-inbox-is-one-program-two-views.md), [0521](../../.decisions/0521-an-agents-message-is-an-inbox-row.md) | P11, P36 | 120 in slice 1, including about 25 for brain mail | about 0.2 for slice 1 |

**44 rows: 6 exams, 2 spikes, 1 design pass and 35 builds, one of them in today's version (P31).** *Changed 2026-11-12 (owner, [0151](../../.decisions/0151-a-thin-inbox-is-a-tier-1-row.md)): P45, a thin inbox, was added, not planned or sized; it was 43 rows and 34 builds.* *Changed 2026-11-11 (owner, [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): P20, the notes tile, and P22, drawing a note, left for Tier 2 with notes, and P44, the checklist, was added; it was 44 rows and 35 builds.* *Changed 2026-11-11 (owner, [0111](../../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md)): P43, the merge queue's first stage, was added, not planned or sized; it was 43 rows and 34 builds.* *Changed 2026-11-10 (owner, [0088](../../.decisions/0088-six-slices-in-tier-1.md)): P39 to P42, the thin slices of hands, outside programs, programs working together and a person starting a program, were added, none planned or sized; it was 39 rows and 30 builds. 0078's two slices have no row yet; theirs come with their plans.* *Changed 2026-11-10 (owner, [0069](../../.decisions/0069-choices-are-settings.md)): P38, the settings foundation, was added, not yet sized; it was 38 rows and 29 builds.* *Changed 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)): P34c was added, not yet sized; it was 37 rows and 28 builds.* *As of 2026-11-09:* 19 are on main (P1 to P7, P9 to P12, P16, P30 to P35 and P37, with P5 done for the sheet), and P17a, half of P17. P17b and eleven more rows have tests on a branch and no pull request yet. *It said: five are done, P1 to P4, and P5 for the sheet.* *Changed 2026-11-07 (owner): P37, the span sink, was added, and spans land in ten other rows. That adds about 1.2 to 1.7 agent hours, plus the thin JobRecord, not yet sized, to the total below, which does not count them yet.* *Changed 2026-11-06, after an audit the owner walked: P33 and P34 build Tier 1's slice of coordination, P35 takes P8's edges half, and 15 rows changed. It was 32 rows and 23.7 to 35.3 hours. Later that day P36, email recovery, was added, and P30 shrank to an exam change after PR 363; the hours below still count its old 0.4 to 0.7.* *Changed 2026-11-05: P30, tea's own hook, was added (it was 29 rows); then the owner's calls added the design package (P31), put the inputs note in P6, P10 and P11, and made the commit the unit of work, so each exam change is the test writer's commit inside its build and P32 builds the check. For a short while the plan had ten small exam rows instead (41 rows, 23.7 to 35.5 hours); none is left. It was 30 rows and 21.8 to 32 hours.* The rows add up to about 27.7 to 41.8 agent hours at 600 lines an hour, sure 45%: nobody has built OTP's slice on Durable Objects, and experiment 99's full supervisor in today's version is 1,012 lines, of which this is a guessed fraction. That is above the plan's 17 to 24 for five reasons: the coordination slice and the brain restart were never in it (about 2.5 to 3.5); hot reload, configurable keys, `seen` and Manti were never in that total (about 1.75 to 2.7 more, from their own sizes above); the exams, spikes and design pass were never counted (about 3.5 to 6); the design package, the inputs note and the commit check were never in it (about 1.5 to 2.5); and splitting adds a plan and a review to each small piece. Each row's hours are my split of [the detail's size rows](./tier-1-detail.md#size), sure 50%; the row's own plan writes its real estimate, and P6's real `spent` is the first number to check this against.

**What can run at once.** At most 5 agents build at a time, and one Electron test app runs at a time ([AGENTS.md](../../AGENTS.md#go-easy-on-the-machine)). Each wave starts when what it needs has merged, and a free slot takes the next row.

```text
wave 1, first      P1   P2   P3   P4   P5      all done: P1 to P4 2026-11-05, P5 2026-11-06 for the sheet
wave 2             P32  P35  P7   P31           P6 starts once P32's step keys are made
wave 3             P6                           merges after P32 and P35
wave 4             P9   P37                     P9 with the grant tree and every device a master; P37, the span sink
wave 5             P10  P33
wave 6             P11                          needs P10 and P33
wave 7             P12  P34  P8                 P8 is the notes small exam only
wave 8             P13  P14  P16  P44           P44, the checklist, needs P11
wave 9             P15  P17  P18                P15 needs P14 and P34; P17 needs P34
wave 10            P19
wave 11            P21
wave 12            P23  P24  P25                P24 carries chaos's off build
wave 13            P26  P27
wave 14            P28  P29
wave 15            P36                          email recovery, on P28's recovery screen and the cloud instance
any time           P30                          the exam's half only, since PR 363
```

*Changed 2026-11-11 ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): P20 and P22 left the waves for Tier 2, and P44 joined wave 8.*

- **The long pole is the door, then the app:** P32, P6, P9, P10, P11, P12, P14, P18, P19, P21, then P24 and P25, P26, P28 and P36. Nothing on it can run beside itself, so more builders do not make it shorter. P37 runs beside P9, P33 beside P10, P34 beside P12, and P35 and P31 beside P32, so none is on it unless it runs long. *Changed 2026-11-06: two rows longer, since P11 now needs P10's envelope and P33's processes, and P36 comes after P28; it had 12 waves.*
- **P13 and P17 start before the cloud lands.** My call, 70%. Order rules 5 and 7 are about where real notes live and about chaos's target list; the notes program and the chaos program touch neither until P26 and P27. If the owner reads rule 5 as "no notes code before check 4", P13 moves to after P24, and the plan loses about three waves of overlap.
- **Each row's plan names its laws in full** from the detail, and the lead agent approves it if it builds only decided notes. P5 goes to the owner. P6's `cause` (now `parent`) and P10's `initialize` and keys were decided by the owner on 2026-11-05, so their plans build decided notes. P11's plan was approved with p69 as it writes it ([question 17](#open-questions), owner, 2026-11-08). A scheduled walk whose answer is a test of an already-decided note is not asked: the lead agent approves it in one line (owner, 2026-11-08).
- **A row may start on its parent's branch before the parent merges:** see [0004](../../.decisions/0004-squash-merges-and-native-stacks.md).

## The order of work

Most of the order above is a choice. **These parts are not, and each says why:**

1. **The exam lands before any builder works in `next/`.** A builder cannot be held to rules that do not exist. An exam pull request has no build step, and the owner reads it. *Changed 2026-11-05: rule 1 was "ticket 117, then the planner gap, then this plan", and this rule began with guarding the exam files in today's lane (ticket 122). With today's pipeline paused for `next/`, neither waits: the lead agent's read of each diff guards the exam.*
2. **The door before the app, the app before the cloud.** The menu bar extra signs what the door checks, and the cloud proves the same flow. The terminal command `grant.ts` lets windows in until Approve exists.
3. **The cloud before the checklist goes real.** The real checklist lives on Cloudflare. Check 4 proves the checklist there first, on data nobody minds losing. The split reads this as "before the checklist goes real" (P26), and builds the checklist program earlier (my call, 70%, [the split](#the-pull-requests-one-at-a-time)). *Changed 2026-11-11 ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md)): rules 3, 5 and 6 said notes.*
4. **Words and fact shapes are settled before real facts get written,** which is the first real note. A fact written then lives forever: `has`, `saw`, `as`, what `granted` keeps, `parent` and `traceId` (decided 2026-11-05 as `cause`, renamed 2026-11-07), the entry's `arrivedAt` and `sentAt`, and any OS or capability word.
   - *Added 2026-11-01:* `seen` lands on every ledger entry before Tier 1's first real entry, and the app layer's A3 `saw` moves into it ([saved state, S1](../direction/saved-state.md#s1-every-entry-says-what-its-writer-had-seen)). About 50 to 80 lines, 0.1 to 0.15 agent hours at the measured 600 an hour, a `0.25` on the scale (under 0.05 at 1,660), not in the total above. It lands in P6.
5. **The checklist before chaos.** Chaos needs a real target, its drill dials through the MCP client, and doing it first would write its target list, driver and p39 twice (biggest call 10).
6. **Backup right after the checklist goes real.** Settled by the owner: once its data is real, a lost Mac would otherwise mean a new ledger.
7. **Each new `next/` law lands before the code it checks.** The test writer's tests must fail first, on the base.

*Changed 2026-11-05: the old rule 3, "how `next/` reaches the lane is answered before the first `next/` lane", no longer blocks anything. No lane builds `next/` now. What lands still follows [the lean](#still-open-how-next-reaches-the-lane).*

**Free to change:** the split inside any piece, the order of rows inside a piece (except that P21 needs P19's keys), and where the shared names land. Today's other work waits for nothing here.

**Each pull request:** its plan, approved; the test writer adds its tests and runs them red on the base; the builder works with local commits and cannot touch the tests; the fast mutation check; one review by another agent; screenshots for a window; the lead agent's read of the diff, green CI and the leak grep; then GitHub's merge queue, and after the merge `land.ts merged`'s comment naming the pull request and its merge commit on each ticket it closes (`.agents/skills/lead/scripts/pr/Queue.ts`). Runs and notes go to `field/` the same day.

### One ticket per pull request

- **Each row gets a ticket in today's tracker, filed by the lead agent when its plan starts,** with `from` pointing at this plan ([a ticket says where it came from](../direction/a-ticket-says-where-it-came-from.md)). Decided by the owner on 2026-11-05 ([question 12](#open-questions)). So each row's field rows and its merge comment have an id. P1 to P4 were done before this and have none. *It said: the planner was going to file them after the owner's yes ([PR 279](https://github.com/usirin/tea-fabrika/pull/279)), a flow paused for `next/`, and whether the lead agent files them by hand was open.*
- **These tickets move onto `next/`'s ledger in Tier 2,** as part of building its tracker, with nothing lost: who filed, when, comments and links ([tiers](./tiers.md)). What that needs from tickets filed now: only `from` pointing at this plan, and the pull request's link and its merge written on the ticket, as a comment the day it lands. Today's tracker keeps who and when already, so nothing else changes now.
- **Exam pull requests go by hand and are logged.** That covers P1, P2, P8, P30, P32 and P35. An exam change inside a build is its test writer's commit, logged with that step.

## What the notes of 2026-11-03 to 2026-11-05 change

**Two notes change what Tier 1 builds, two change its words, one changes how a pull request lands, and none changes its order or the approved size.** *Changed later on 2026-11-05, with the owner's last calls that day: three more change rows, the inputs note (P6, P10, P11), the design package (P31 before P14) and a unit of work is a commit (each exam change the test writer's commit, and P32's check). The order of the demos still holds.* Every note dated in that span in [the index](../direction/README.md) was read for this, plus one that changed in it. *Checked again later on 2026-11-05,* after PRs 391 to 403 landed, with the owner's calls that day: the exam as built, one bundler, the edge list, tea's hook, and the two spikes. Those change P12, P14, P19, P20, P21 and P22 and add P30, and still not the order of the demos.

| Note | State | What it changes in Tier 1 |
|---|---|---|
| [Programs: one job, a location](../direction/program-guidelines.md) | decided 2026-11-03 | Nothing. "Tier 1 adds refuse, inputs and outputs", as the detail has it; "`location` and the focus history go in with Tier 2's desk". |
| [Designs are drawn on Claude Design](../direction/design-on-claude-design.md) | decided 2026-11-03 | Nothing built. A Tier 1 screen that gets a design pass is drawn there, on the shared design package. |
| [Autonomy is measured trust](../direction/autonomy-is-measured-trust.md) | decided 2026-11-03, measures proposed | How a pull request lands: "A merge never waits on the owner". Its row per merge (M1) is proposed and nothing writes it yet. See [how it is built now](#how-it-is-built-now). |
| [We follow Domain-Driven Design](../direction/we-follow-ddd.md) | decided 2026-11-03 | Words: "The glossary is `next/`'s language". A pull request that coins a word adds its row under its context: ledger for layers 2 and 3, clients for layer 1, runtime for layer 4, frame for Tuval. |
| [Use the industry's names](../direction/use-the-industrys-names.md) | changed 2026-11-03 | Nothing beyond the DDD note, which replaced its two-domains rule. |
| [A ticket says where it came from](../direction/a-ticket-says-where-it-came-from.md) | decided 2026-11-03, shape proposed | Nothing. "`next/`'s tracker carries the same key when it is built", in Tier 2. |
| [React Compiler from day one](../direction/react-compiler.md) | decided 2026-11-03 | What Tier 1 builds, already in this plan: the rules and `lint:compiler` in P2, Rolldown with the Compiler in P12, the time through a Cmd. Size: about 230 lines in the exam, by the detail; about 60 lines changed in `build.ts` and about 40 for the `now` Cmd, by the note. |
| [The frame](../direction/the-frame.md) | decided 2026-11-03, parts proposed | Words: `next/`'s menu bar is the **menu bar extra** (item 9): "words only; nothing is built". |
| [Layers](../direction/layers.md) | decided 2026-11-03 | Nothing. "`next/`: all of it, with tezgah, the window manager, in Tier 2." |
| [Areas](../direction/areas.md) | proposed, parts decided 2026-11-03 and 2026-11-04 | Nothing. "Nothing about areas is in `next/` yet"; its tracker is a later tier. |
| [Shared tiles](../direction/shared-tiles.md) | proposed, parts decided 2026-11-04 and 2026-11-05 | Nothing. `next/` "reads it as a lesson", and presence rides the ephemeral lane in a later tier. |
| [Inputs carry their sender](../direction/inputs-carry-their-sender.md) | direction decided 2026-11-04, `cause` in `next/` decided 2026-11-05 | What Tier 1 builds: `parent` (it was `cause`) and `traceId` on `next/`'s ledger `Entry` in P6, the envelope at the door in P10, and the signer in P11 ([where it lands](#where-inputs-carry-their-sender-lands)). Question 17, the test-kit law's walk, was approved by the owner 2026-11-08 as P11's plan writes p69. |
| [Talk where you work](../direction/talk-where-you-work.md) | proposed, parts decided 2026-11-04 and 2026-11-05 | Nothing in Tier 1: no row touches talk or threads, and talking to agents is Tier 5. *Changed 2026-11-05:* this quoted "the spot needs a design in `next/` first", which [PR 403](https://github.com/usirin/tea-fabrika/pull/403) replaced: talking at a spot is the box, then one thread tile that opens only from a spot, and a spot is a program's `location` plus the version it came from, "written for both". The network allow list and each harness's permission words in `fabrika.toml` (PRs 391 and 393) are today's started `claude`. Tier 5's "chat tile" in the detail and in [the tiers](./tiers.md) changes with this note once it settles, as the note says. |
| [Principles](../direction/principles.md) | proposed 2026-11-05 | Nothing until settled. Tier 1 already keeps its first and fourth in part: an agent writes under its own key, and MCP tools are made from a program's inputs. Principle 5, unsure is a setting, came 2026-11-05 ([PR 392](https://github.com/usirin/tea-fabrika/pull/392)); if it settles, its own line "a wall is never a setting an agent can turn off" keeps the exam's rules, the Compiler check included, out of `fabrika.toml`. |
| [Pipeline strategies](../direction/pipeline-strategies.md) | proposed 2026-11-05 | Nothing. "`next/`'s pipeline would take the same words when it is built", in Tier 6. |
| [Design language](../direction/design-language.md) | proposed 2026-11-04 | Nothing until settled. Its pages sort notes for both versions, and the design package stays the one thing today's app and `next/` share. |

### Where inputs carry their sender lands

*Renamed 2026-11-07 (owner, [question 15](#open-questions)): the entry's `cause` is now `parent`, and `traceId` joins it. The code rename in P6's and P9's files is its own ticket, through the steps.*

**Decided by the owner, 2026-11-05: `cause` goes on `next/`'s ledger `Entry` in P6, and the rest of [the note](../direction/inputs-carry-their-sender.md) lands in P10 and P11.** The note is written in today's words. In `next/`'s, its host is the brain's door, its run is a process, and its cell is the runner.

```ts
// A sketch, next/. P10 stamps, P6 keeps, P11 signs.
interface Envelope<A> {          // P10: made in memory at the door, never decoded, so no schema
	readonly id: InputId;        // "input_01m6ye20k9fhnav1pe07y14pms": a TypeID (2026-11-08; it said "in-process_<26>-41")
	readonly by: Writer;         // from the checked key, never from params
	readonly arrivedAt: number;  // the referee's clock as it came
	readonly input: A;
}
// P6: the entry keeps its parent as text (field `parent`, it was `cause`). Read back for reading, never turned into an InputId.
const CauseText = Schema.String.check(Schema.isPattern(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/)); // TypeID, 2026-11-08
// P11: what a program asks the runner to sign. `own` is the honest "I don't know": the process owner's.
const Write = Schema.TaggedUnion({caused: {cause: CauseText, fact: Schema.Unknown}, own: {fact: Schema.Unknown}});
// The runner's signer. It holds many causes, so it is a <Thing>Manager; P11's plan names it.
// signer(cause, process, tag) -> the writer to sign as, or refused when:
//   the cause was never told to this process      a program cannot borrow another process's press
//   the cause is spent for this tag               one press, one `answered`
//   the tag is person-only and the cause's input  a person's comment cannot become
//     is not a person-only input sent by a person an `answered` by a program's mistake
//   the process has ended                         a kept cause dies with its process
```

| Part of the note | Row | Law |
|---|---|---|
| The envelope `{id, by, arrivedAt, input}`, an interface made in memory at the door | P10 | p67 |
| `InputId`, `input_<26 chars>`, a TypeID (owner, 2026-11-08, [question 20](#open-questions); it said `in-<process>-<n>`, and before that `in-<run>-<n>`), with the door's process and count as their own fields on the entry, branded: its type in P6, and only the door makes one. A fresh UUIDv7 per input, so no id repeats across restarts | P6, P10 | p67 |
| A client that sends its own `id` or `by` is refused, the refusal is counted by the hour and nothing of it is kept (mass assignment, OWASP API Security Top 10 2023, API3). *Changed 2026-11-12 ([0140](../../.decisions/0140-gateway-refuses-client-id-and-by.md), [0143](../../.decisions/0143-a-refused-write-is-counted-never-a-row.md); ticket 844, PR 1027): it said "and the refusal is recorded".* | P10 | p67 |
| Record first: the door logs each envelope in the brain's own log, who sent it and where it went, never a raw key's text, a `Redacted` value hidden ([secrets are redacted](../direction/secrets-are-redacted.md)) | P10 | p67 |
| `parent` on the entry (it was `cause`), null for an `own` write, and `traceId` beside it | P6 | p68 |
| `Write` as `caused` or `own`. In P11, not P6: the data layer stores a cause and knows no program, and the runner is what asks to sign | P11 | p69 |
| The program carries the cause in its Msg, in any queue in its Model and in the Cmd's input, never the sender; the runner signs "as whoever sent input X" from the door's table | P11 | p69 |
| The signer's four refusals, above | P11 | p69 |
| The test-kit law: for any input told by sender S, every write it causes is signed S; random inputs, both senders, interleaved, across queued writes | P11 | p69 |
| An OpenTelemetry span link mirrors the cause and never decides who signs | P10, P11 | With their spans, on P37's sink. *Changed 2026-11-07 (owner): it said Tier 1 has no traces, so this waited.* |

- **The glossary already has both envelopes:** `envelope (runtime)` for this one and the ledger's for an entry's wrapper, with how they meet.
- **A queued press across a restart.** The note says today's version loses it: the Model comes back, and the cause table does not. In `next/`, a process wakes by folding its inbox, so the table could come back from the log if each inbox letter keeps the `InputId` the door gave it. Lean, 60%: P11's plan checks that fold and, if it holds, adds "a restart between a press and its queued write still signs by the press" to p69. If the fold cannot tell a spent cause from a live one, it stays a known gap, written down in P11's pull request.
- **The door cannot check a cause yet.** A known gap, as the note says: the entry records it now, so a later step can.
- **The test-kit law's walk** ([question 17](#open-questions)) was approved by the owner 2026-11-08, as P11's plan writes p69. The signing service was decided 2026-11-07 as the door's `SessionManager`, and an agent's stated reason as `traceId` (questions 16 and 15).
| [Every update builds every layer](../direction/every-update-builds-every-layer.md), [the tiers](./tiers.md) | changed 2026-11-06 (owner) | Tier 1 builds a slice of C2 to C5: P33, P34, and the brain restart in P12 and P19. They gave Tier 1's coordination only the mailbox, who belongs and grants, against [the five layers](../direction/a-local-first-sync-engine.md)' header; the owner decided the header holds. |
| [Account recovery](https://github.com/usirin/tea-fabrika/pull/404) | decided 2026-11-06, the sheet and email | P5 is done. Every device the person owns is a master, replacing the note's rank rule: P9's fold and P10's door take the grant tree, with devices as equal roots and only tabs and agents under them, `added`, the spent sheet set, one live sheet that belongs to the person, and two limits; P28 keeps the sheet's screens and "Check my sheet"'s record; P36 builds email recovery. |
| [Agents commit as a bot](../direction/agents-commit-as-a-bot.md) | proposed, direction decided 2026-11-05 | Nothing. No agent commits from `next/` until Tier 5. |
| [The ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md) | changed 2026-11-05 | Nothing. Its new part, talk between agents not tied to tickets, is Tiers 3 and 5. Its header now says GitHub is never a keys source in `next/`. |
| [A key per client, and GitHub is never a way in](../direction/a-key-per-client-and-no-github-trust.md) | decided 2026-11-05 | Nothing in its shape: P9 and P10 already build a key per client and a person-signed grant. It closes [question 10](#open-questions) and takes "GitHub as a keys source" out of Tier 3. |
| [One design package](../direction/fabrika-design-package.md) | decided 2026-11-02, held to on 2026-11-05 | P14 imports `@kampus/fabrika-design`, and P31 builds it in today's version first. The styling copy shrinks to what the package lacks ([the detail's Styling](./tier-1-detail.md#styling)). |
| [Nobody writes their own exam](../direction/nobody-writes-their-own-exam.md) | decided 2026-10-22; its CI half replaced 2026-11-05 | The builder never touches the exam, and the owner reads every change to it. Its CI half is now the next note's. |
| [A unit of work is a commit](../direction/a-unit-of-work-is-a-commit.md) | decided 2026-11-05 | Each exam change is the test writer's commit inside its build pull request, and P32 builds the check that walks the commits. Closes [question 18](#open-questions). |
| [Every pull request takes the steps](../direction/next-is-a-pipeline-pre-run.md) | order changed 2026-11-05 ([PR 396](https://github.com/usirin/tea-fabrika/pull/396)) | How it is built: `next/` no longer waits on the pipeline, and each step goes by hand. This plan already followed it. Its "how a change lands" now follows the [autonomy](../direction/autonomy-is-measured-trust.md) note: a merge does not wait on the owner, except exam pull requests, the exam asks and new design calls (owner, 2026-11-05; it said "the owner's yes"). |
| [A browser tab's key survives](../../experiments/215-browser-key-survives-reload.md), [T8's four unknowns](../../experiments/214-mac-app-four-unknowns.md) | experiments 215 and 214, 2026-11-05 | P3 and P4, done: a fixed port for the person's brain, and P19's and P21's lines from P4. |

## The backup needs a design pass first

**Done 2026-11-06: the design pass is the account recovery note ([PR 404](https://github.com/usirin/tea-fabrika/pull/404)), decided by the owner for the sheet and for email.** Experiments 216 ([PR 405](https://github.com/usirin/tea-fabrika/pull/405)) and 217 ([PR 406](https://github.com/usirin/tea-fabrika/pull/406)) are behind it. Where it lands: the fold and the door in P9 and P10 (every device a master, devices as equal roots, one live sheet that belongs to the person), the sheet's screens and "Check my sheet"'s record in P28, and email recovery in P36. *What follows is the section as it stood before the note, kept for the record.*

**Nothing is designed.** The owner moved it up from Tier 3, and no note holds a design, only one line in [every update builds every layer](../direction/every-update-builds-every-layer.md). What is known: the person key lives on the Mac, the text lives on Cloudflare, `founded.keys` stays a list so keys can join, and a new fact `added` goes on it. `added` is not yet in `MemberFact`, `foldMembers` or p28.

```ts
// A sketch and a starting guess, not settled. Two moments.
// While the old Mac lives: make a recovery key, print its private half on a sheet.
{_tag: "added", key: recovery.publicKey, for: person, signed: sign(personKey, text), saw: {how: "sheet", check: "touch"}}
// On a new Mac: type the sheet in, and sign the new person key with it. The door's one signature shape.
{_tag: "added", key: newMac.personKey, for: person, signed: sign(recovery, text), saw: {how: "recovery", check: "none"}}
```

**The design pass answers,** and the owner reads it before any test writer starts: what is on the sheet, and on paper or in a file. Whether recovery revokes the old Mac's keys. What the new Mac's window key does. What happens with a wrong or a used sheet. How the door reads `added`, in one signature shape. How `founded.keys` folds with it.

**Its done check, as a guess:** a temp home with the sheet and the Cloudflare address comes back to the same checklist and the same name, with no new ledger. Without the sheet, it gets a waiting screen and nothing else. The sheet's secret is never on the wire or in the ledger. Plan it as one design task and one PR after it, and put any design choice with a real trade-off in `questions`.

## Known risks

Each has a way out, or a first step that tells. More in [the detail](./tier-1-detail.md#what-this-plan-cannot-tell-us).

- **Launchd from an unsigned build, Touch ID from it, and the Keychain asking on open.** *P4 answered yes to all four on 2026-11-05 ([experiment 214](../../experiments/214-mac-app-four-unknowns.md)), so no way out is needed for this pass.* What is left: a rebuilt or re-signed app may still meet a Keychain prompt once (the owner's "open the built app twice" in P19); `promptTouchID` from an unsigned build was never called; a "Background Items Added" notice would not have shown in the run; and a test that seals touches the real login Keychain unless it seals through a stand-in.
- **A non-extractable key in IndexedDB over a reload.** *P3 answered yes on 2026-11-05 in Chromium 156, over a reload and a restart ([experiment 215](../../experiments/215-browser-key-survives-reload.md)).* What is left: the key is per origin, port included, so a brain on a new port means a new Approve for every tab; Safari, Firefox and a phone were not run; eviction under disk pressure was not tried. A phone's browser may also clear it after seven days without a visit, which means one more Approve.
- **The new package shape.** Nobody has run code-graph or the build on it. P7, the first package landing, runs both first, and stops if either is off. *Changed 2026-11-06: it said P6, but P7 makes `@kampus/libfabrika`'s bare package.*
- **Rolldown's equivalents are not proven here.** Experiment 195 bundled `next/`'s brain, window and programs with Rolldown, and nothing else. Carrying a script or CSS as text in the one built file, a generated entry in place of esbuild's `stdin`, the highlighter's split, `sideEffects: false` across packages, and Electron's main and preload were all not tried with it. Each is named in [the detail's Packages](./tier-1-detail.md#packages), and the pull request that needs it tries it first.
- **The copies carry bugs.** `programs/markdown` was written for a program that showed one text and quit.
- **A wake with a long history.** Each wake folds every save, and the object sleeps quickly on Cloudflare. T17 records it at 1,000 and 10,000 saves.
- **The cloud is first seen late.** Cold load, `abort_all`, a redeploy mid-run: all first seen at p39 and p41.
- **This plan itself.** Only the exam is built so far. No project this size has gone through every step by hand here, with a separate agent per step. P5 to P7 tell.
- **A big landing is a weak review.** If PR 223 lands whole, nobody really reads it.

## Open questions

The owner answers these. **As of 2026-11-05, nothing here stops the first wave.** Questions 1 and 2 no longer block anything, since no lane builds `next/`. Questions 3, 5, 6, 7 and 8 were answered on 2026-11-02. Question 4 is mostly settled by a note. Questions 9 to 12 were answered by the owner on 2026-11-05. Questions 13 and 18 were answered the same day. Question 14 is open, 15 to 17 came from the inputs note, and 19 from the owner's call of 2026-11-06 on devices; each names the pull request that needs its answer. What the audit of 2026-11-06 could not tell lands as the first step of the row that needs it: step before or after append (P11), whether Alchemy restarts workerd (P12), a brain crash under launchd (P19), a wake after sleep against one after a crash (P33). Plan with the lean. Also open, and not a question here: P5's backup design pass.

**The two questions that blocked the first `next/` lane,** with the pipeline no longer driving `next/`:

- **Can the planner split a plan into small tickets (question 1)?** Blocks nothing in Tier 1 now; it stays a gap in today's pipeline for when a lane builds `next/` again.
- **How does `next/` reach the lane (question 2)?** The lane half blocks nothing now; the "what lands" half is a lean the split already follows, and P6 tests it.

1. **Can the plan step turn out small tickets yet?** *Changed 2026-11-05: no longer blocks Tier 1.* In the lane, a yes on a plan sends it on to the exam and the builder, as one giant pull request, and no stage files a new ticket. [The flow](../direction/free-form-plan-to-planner.md) sizes that gap at about 7 files, about 1.4 to 2.4 agent hours at 600 lines an hour, sure 50% (*old guess there, wrong: 6 to 10*). It is today's version's work, for when a lane builds `next/`.
2. **[How `next/` reaches the lane](#still-open-how-next-reaches-the-lane).** *Changed 2026-11-05: the route no longer blocks anything.* What lands still leans 60% on "each layer lands already fixed", and the split is built on it.
3. **Windows' words and OS.** **Answered by the owner, 2026-11-02: yes.** `touch-id` becomes `verify` (WebAuthn's word, since `check` is taken), `keychain` becomes `seal`, and the hello records the OS, before real facts are written. The CI job and the pipe still wait on the owner's word on Windows. The question as it was asked: should `touch-id` become `check`, `keychain` become `seal`, and the hello record the OS, before real facts are written? [The note](../direction/windows-in-next.md) leans yes at 75%. Its other parts: a `next-windows` CI job, `.gitattributes`, one way to stop a brain, about 320 lines, sure 50%: about 0.5 agent hours at 600 an hour, a `1` on the scale (0.2 at 1,660, a `0.25`). *Old guess, wrong: 3 to 5 agent hours.* **Lean:** the OS field lands with the door, and `.gitattributes` with the first exam, since a later hello can never get the field back, and they cost a few lines. Tasks use today's words, `touch-id` and `keychain`, until the owner answers, and nothing is real until notes, so a rename is still cheap then. If renamed, pick another word than `check`, which already means three things in this plan (`saw.check`, chaos's `check`, the menu's `check`). Leave the CI job and the pipe to the owner's word on Windows. Sure: 70%. A walk of the Approve screen settles it.
4. **What runs the daily checks, what do its tickets go to, and how does mutation get fast?** *Mostly settled, noted 2026-11-05.* [Fast and daily mutation](../direction/fast-and-daily-mutation.md), decided 2026-11-01, sets the check on each pull request (changed lines, 5 minutes at most, advice only) and puts `next/`'s mutation queue in Tier 6; [experiment 197](../../experiments/197-daily-checks-on-cloudflare.md) sizes the daily run on Cloudflare. What is left for Tier 1: by hand, the real-browser and Electron laws run red first on the laptop ([Rules that bind](#rules-that-bind)), and launchd, the finger, the cloud and chaos run by hand and are logged. The mutation queue stays out of Tier 1, since the note puts it in Tier 6. The question as it was asked: Tier 1 did not include this, so it is a scope question. It also asks which pile holds the real-window laws: the first exam's `next` CI job runs Chromium and e2e, which looks like blocking. **Lean:** tests that spawn `dev.ts` stay in vitest and block. Real-browser e2e runs in CI without blocking. Laptop-only laws run by hand and are logged. The daily run is the smallest thing on the owner's laptop, as the scheduled-jobs note has it (decided 2026-11-01), and it files tracker tickets. Plan with today's mutation step as it is, and promise no time. Why: a check that blocks nothing and runs nowhere is worse than none. Sure: 60%. The cost is unknown, and a sized proposal settles it.
5. **Tile rules and the styling copy.** **Answered by the owner, 2026-11-02: moot.** Today's app already moved to the Radix fabrika theme, dark and light, in [PR 308](https://github.com/usirin/tea-fabrika/pull/308) (ticket 144). So copying today's styles copies Radix steps: slate for grays, indigo for the turn, as the rules want. The copy is taken from main after PR 308, and c7 reads "tokens match the named commit", as before. The question as it was asked: do the tile rules change the styling copy? The copy brings today's graphite tokens, and the rules want Radix slate steps. **Lean:** copy spacing, type and the meaning of colors, and take a plain tile's colors from the rules, since `next/` would otherwise copy what today's version is about to change (ticket 124). c7 then reads "tokens match the rules". Sure: 70%. Cost: a few more token lines. What settles it: a look at one real tile.
6. **Manti in `next/`.** **Answered by the owner, 2026-11-02: yes.** `next/` uses Manti, as today's app does ([UI on Manti](../direction/ui-on-manti.md), decided 2026-10-30). The styling exception was about copying styles, not about leaving Manti out. What it adds: `@manti-ui/react` and `@manti-ui/styles` as `catalog:` lines in `next/`'s packages, with the patch today's app uses; the one catalog already pins both at 0.13.0 and the patch already applies across the workspace, so no exam PR is needed for it. The style build also takes Manti's stylesheet and today's `theme.css`, which maps Manti's tokens to ours (139 lines, under the styling exception). Size: T6 grows by about 150 lines, about 0.25 agent hours at 600 an hour, inside the total's doubt; T20 keeps `Kbd`, a few lines. More bytes on a phone tab, as the lean said. The question as it was asked: does `next/` use Manti? The detail says `next/` has no Manti, and copies today's styles instead. [AGENTS.md](../../AGENTS.md#changing-the-product) says all in on Manti, and the [UI on Manti](../direction/ui-on-manti.md) note agrees. The tile is ours either way, as [the tile guidelines](../direction/tile-guidelines.md#tokens) say. **Lean:** Manti for the buttons and fields on the founding, waiting, panel and notes screens, since the newer rule holds. Cost: a dependency for those screens, a catalog change, and more bytes on a phone tab. Sure: 60%. The doubt is whether the owner's styling exception meant no Manti. The owner's word settles it.
7. **Saved vectors and letters.** **Answered by the owner, 2026-11-02: yes, on the lean.** The `sshsig` vectors and `notes-letters.jsonl` come in the exam PRs, so the owner reads them. The sshsig vectors move into the first exam PR, and the letters stay in the small exam PR before PR D. The question as it was asked: where do saved vectors and letters come from? `sshsig` vectors and `notes-letters.jsonl` live in `fixtures/next/`, and the test writer can only add `*.test.ts`. **Lean:** from the exam PRs, so the owner reads them. Sure: 85%. Cost: the sshsig vectors move into the first exam PR.

8. **Configurable keys.** **No owner call needed; the note settles it.** [Keybindings are configurable](../direction/keybindings-are-configurable.md) was decided 2026-11-01. The size below is the builder's estimate, not an owner call, and the lean holds: no pull request of its own, and the table lands with the first window that takes a key. The question as it was asked: what does configurable keys add? The owner's new rule was not in the approved size. It adds no pull request of its own, on the lean: the table lands with the first window that takes a key. **Lean:** a small addition to the door's window work. A guess, 50 to 150 product lines and about the same in tests, about 0.2 to 0.5 agent hours at 600 an hour, a `0.5` on the scale (0.1 to 0.2 at 1,660, a `0.25`), not in the total above. *Old guess, wrong: 1 to 2 agent hours.* Sure: 50%. The note's shape settles it. The keys are the person's, in `~/.fabrika/keybindings.toml`, not the repo's `.fabrika/fabrika.toml` ([the note](../direction/keybindings-are-configurable.md)).

9. **The hello's method: `hello` or `initialize`?** **Decided (owner, 2026-11-05): `initialize`,** LSP's and MCP's word for the same first request. `Hello` stays the schema's name, as the detail has it, and "hello" the plain word. The sync note's sketch and [a browser is always a client](../direction/a-browser-is-always-a-client.md) now say `initialize`. *It was asked because the sync note's sketch sent `"method": "hello"` while PR 223 said `initialize`; the lean was `initialize`, 75%.*
10. **How a person signs in: SSH keys checked against GitHub, or one key pair per client?** **Decided (owner, 2026-11-05): a key pair per client signs `initialize`, and the person key grants each new client in SSHSIG's shape. No automatic GitHub trust, ever** ([a key per client, and GitHub is never a way in](../direction/a-key-per-client-and-no-github-trust.md)). GitHub's key list is at most a way to look up a key, never a pass in. A second person joins in Tier 3 by invite and approval, the same flow as a new tab. `next/` depends on GitHub as little as it can. Today's version keeps its GitHub sign-in until `next/` replaces it. *The lean was the same two layers with GitHub as a keys source in Tier 3, 70%; the owner's answer drops that source.*
11. **Does `next/`'s ledger `Entry` get `cause` now?** **Decided (owner, 2026-11-05): yes, in P6,** and every other part of [the note](../direction/inputs-carry-their-sender.md) lands in a named row with its law ([where it lands](#where-inputs-carry-their-sender-lands)). *The lean was yes, 80% on the field.*
12. **Does each pull request get a tracker ticket?** **Decided (owner, 2026-11-05): yes.** The lead agent files each row as a ticket in today's tracker when its plan starts, with `from` pointing at this plan ([one ticket per pull request](#one-ticket-per-pull-request)). In Tier 2 these tickets move onto `next/`'s ledger with nothing lost. *The lean was yes, 65%.*
13. **Does the exam hold a Promise to the edge list?** **Decided (owner, 2026-11-05): edges are opt-in comments at the line, not a path list.** `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`. `Effect.tryPromise` and `Effect.promise` fire everywhere unless that comment is there, which closes the loophole. The 18-path list goes. A build commit that adds such a comment does not block: the pull request asks the owner, one line each with its reason, `[ok] [no]`; the owner chose the ask over a list a reviewer judges, to start with. P35 builds it. *The lean was to hold `Effect.tryPromise` to the 18-path list, 70%; this walks back the list itself.* The doubt that stays: a Promise reached with no Promise syntax still passes; only types would see it.
14. **Does a clock read at a view file's top level fail?** **Decided (owner, 2026-11-07): yes, strictly.** A view file reads no clock at all, per [Elm first](../direction/elm-first.md). The tab's name comes from the key's edge (`tuval/browser/key.ts`) or through a Cmd.
    *Added 2026-11-05. Needed before P14, the first `.tsx` file.* P2's `no-clock-in-view` fires on any read in a `next/**/*.tsx` file, so on PR 223's tree it fired on `main.tsx:19`, a module-level `crypto.randomUUID()` naming the tab, which is in a view file but in no view. P2's body left it as a later call. **Lean, the lead session's:** keep it failing, so a view file reads no clock at all, and the tab's name comes from where the key is kept (`tuval/browser/key.ts`, an edge) or through a Cmd. Cost: none now; a stray read moves to another file. No number was given.
15. **An agent's stated reason: a second link beside `cause`?** **Decided (owner, 2026-11-07): yes, and `cause` becomes `parent`.** The entry keeps two links, in OpenTelemetry's names, which Effect's Tracer uses (`traceId`, `spanId`, `parent`). `parent` is the input that directly made this write, and it signs. `traceId` is the whole request, the same id P37's spans carry. `traceId` is shown and checked for delivery only, and it never decides. Why the rename: in an Effect codebase `cause` already means a failure (`Cause<E>`, and every `TaggedError`'s `cause` field), so it broke one word, one meaning. Erlang's `seq_trace` carries the same pair: a label for the chain, and the previous serial for the direct cause. Effect's own `EventJournal.Entry` (effect 4.1.1) stores neither and leaves it to tracing. The code rename in P6's and P9's files is its own ticket, through the steps.

    ```ts
    // Before, P6 as built:  {by, for, sentAt, seen, cause, build, _tag, body}
    // After:                {by, for, sentAt, seen, parent, traceId, build, _tag, body}
    ```

    ```text
    entry_a1  by person:p1     "@claude run the tests"   parent: null             traceId: t1 (new)
    entry_b2  by agent:claude  turn started              parent: input_01m6ye20k9fhnav1pe07y14pms   traceId: t1
    entry_c4  by agent:claude  line "pnpm test"          parent: input_01m6ye21rsedksvnmvq1esbpn6   traceId: t1
    ```

    The door stamps the person's ask as `input_01m6ye20k9fhnav1pe07y14pms` and the agent's next input as `input_01m6ye21rsedksvnmvq1esbpn6`. The agent's line has `parent: input_01m6ye21rsedksvnmvq1esbpn6`, so it is signed as the agent, and `traceId: t1` ties it back to the person's ask. *Ids changed 2026-11-08 ([question 20](#open-questions)): an input id is a TypeID, `input_<26 chars>`. This example said `in-process_<26 chars>-<n>`, the shape main's door still makes until a build pull request moves it.* *It was, below:*
    *Added 2026-11-05, from [the inputs note](../direction/inputs-carry-their-sender.md#open-an-agents-stated-reason). Needed before any agent's line carries a person's message as its reason; no Tier 1 row does, so it blocks nothing here.* A line claude runs because the person asked cannot be signed by its cause's sender and also carry the person's message as its cause. **Lean, the note's (70%):** two links, as event stores keep two ids. `cause` is the direct one and signs, so claude's line is claude's; the person's message rides as its stated reason (`asked` in the note's sketch), checked only for delivery, shown, and never deciding. The owner's call is the key's name and whether a reason is worth keeping at all.
16. **The signing service.** **Decided (owner, 2026-11-07): `SessionManager`, owned by the door.** The door stamped every input, so it is the one authority over "who sent input X", the way one gen_server owns a table in OTP. A process asks it over one RPC. The four refusals stay as the inputs note writes them, with `cause` now named `parent`. The doubt: one extra round trip per write. A cache in the process could cut it, but would go stale.

    ```ts
    // A sketch, next/.
    signer(parent: InputId, process: ProcessId, kind) -> the writer to sign as, or refused
    ```

    *Added 2026-11-05. Needed before P11 merges.* The note left it "not walked". What P11 needs: where it lives (the runner, which reads the door's table), its `<Thing>Manager` name, and what it hands back to sign as. **Lean, this plan's (60%):** in the app layer beside the runner, holding the causes told to each process, with the four refusals as written. The doubt: on Cloudflare the door and a process are different objects, so the table crosses a call, and nobody has drawn that call.
17. **The test-kit law's walk.** *Added 2026-11-05. Needed before P11 merges.* p69 is written from the note's one paragraph, and the owner has not walked it. **Lean:** walk it at P11's plan, with the plants p69 lists. No number: it is a walk, not a choice. **Approved by the owner 2026-11-08,** as P11's plan writes p69, and built by P11.
18. **Who builds the CI half of "nobody writes their own exam" for `next/`?** **Decided (owner, 2026-11-05): a unit of work is a commit, not a pull request** ([the note](../direction/a-unit-of-work-is-a-commit.md)). An exam change is its own commit by an agent that is not the builder, inside the same pull request; each step records the commit it made; CI walks the commits and stops a `build` commit on an exam path; any exam path touched asks the owner to read it. P32 builds it. *Then, the same day (owner):* each step's agent signs its commits with its own key, and CI decides from the signature, so an unsigned commit or one from an unknown key is `stuck: unsigned_commit`; the `committed` entry is still recorded. This walks back the note's "an exam change goes in a pull request of its own". *The lean was a CI step that fails when a builder's commit touches an exam path, 60%, close to what was decided. Left for P32's plan: where the step keys live and who can read them, rebases, and squash merges, as the note lists.*
19. **Can a browser tab approve a new device?** **Decided (owner, 2026-11-07): yes, with a passkey.** A tab can approve or remove a device only when the approval is signed by a passkey (WebAuthn) made with user verification required (face, finger or PIN). That makes the tab a person key and an equal master, like a Mac. A tab with only its window key cannot approve. Why: the main browser case is a few friends on browsers and phones with no Mac, so a phone must be able to let a pal in. Still open: the door must verify P-256 passkey signatures beside Ed25519; and since synced passkeys make Apple or Google a way in, the grant records the passkey's backup flags (BE and BS) when it is made. *Decided 2026-11-08 (owner): synced passkeys are accepted, as GitHub accepts them and as NIST SP 800-63B counts them strong enough for AAL2; the flags are still recorded. Two things follow from this answer: a tab whose storage the browser cleared lets itself back in with its own passkey, and the recovery sheet may let in a passkey tab as the recovered device.*
    *Added 2026-11-06. Needed before P10 merges (owner, 2026-11-07: P9 does not wait on it, since its fold changes nothing either way; it said before P9 merges).* The owner decided every device the person owns is a master, and agents never are. **Lean (70%), the owner's.** A browser tab joins and works but cannot approve or remove. Why, as this plan reads it: its key sits in a browser profile that any page's bug or a shared computer can reach, and the menu bar's Approve has a finger behind it. The doubt: the phone tab of Tier 1's demo then cannot let anyone in, which may be the one device a person has with them. A walk of the phone's flow settles it.
20. **What names the door's start in `InputId`?** **Decided by the owner, 2026-11-08: nothing in the id. An input id is a TypeID, `input_<UUIDv7 in 26 base32 chars>`, like every other thing** ([one id per thing](../../.decisions/0211-one-typeid-per-thing.md)). The door's process and its count stay, as their own fields on the entry. Main's door (P10, [PR 502](https://github.com/usirin/tea-fabrika/pull/502)) still makes `in-<process>-<n>`; a build pull request moves it and the entry's `parent` pattern. *Replaced: the 2026-11-07 answer was the door's own process id inside the id, `in-<process>-<n>`, as OTP gives a restart a new pid. "Run" stays an agent run only.*
    *Added 2026-11-07. Needed before P10 merges.* `run` in `in-<run>-<n>` names a start of the door's object, not an agent run; the part needs a new name (owner, 2026-11-07). **Lean (70%):** OTP gives a restart a new pid, so the door's own process id carries the start, as P33 does for programs.

### Still open: how `next/` reaches the lane

*Changed 2026-11-05: no longer blocks anything.* With Tier 1 built by hand, a builder reads PR 223 with git, so the route below is kept only for when a lane builds `next/` again. What lands still leans 60% on "each layer lands already fixed", [the split](#the-pull-requests-one-at-a-time) is built on it, and P6 is its first test. The text below is as it was: two parts, how the steps can read PR 223, and what lands.

**How the steps read it.** In today's version, a lane starts only from `origin/main` (`packages/pipeline/src/stages/pipeline/work.ts:244`, `:274`, `:276`), and `next/` is not on main. A read-only step, and the test writer's box, get a copy with no history, so they cannot read 223's commit at all.

```text
main -> first `next/` lane, like any other
          plan         names PR 223's commit, and cannot read it
          test writer  adds tests at their new paths, as new files, and cannot read 223's either
          builder      adds the product code, if its box can read those git objects
```

**What lands.** PR 223 cannot land as it is. It breaks `no-promises`, and p65 fires until the packages exist. The lane's checks run the whole of `pnpm lint`, so no slice carrying its old code gets through. And 3,323 lines do not fit a small pull request.

- **Lean, 60%: PR 223 is read, and each layer lands already fixed.** Data, then coordination, then transport, then app and desktop, each already on Effect, in packages, with its tests. Why: the rules hold from the first day, and each piece is small. Cost: rewriting done work, about five landings before the first demo, and that is a real strain on the walking-skeleton idea.
  - **Under this lean T0 goes away.** Nothing is moved. Each layer's first landing makes its package, and the desk never arrives. The T numbers and [the moves table](./tier-1-detail.md#packages) read as "where each thing ends up".
  - **Wire laws move.** p10 to p15 and p17 run on the real instance, so they belong to the landing that first brings up `dev.ts`. Put that landing as early as you can.
  - **Unknown: can a test that starts `dev.ts` run in the test writer's box,** with a temp home and no network? If not, those laws join the by-hand pile. Make this a spike, `ends: "answer"`, before that landing. *Moot by hand, 2026-11-05: the test writer runs on the laptop, so P12's wire laws go red first there.*
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

- **Little was built or run for this plan.** The exam (P1, P2) and two spikes (P3, P4) are the only runs; the rest rests on reading, plan-115's probes and past experiments.
- **Whether small pull requests fit this work.** A walking skeleton wants each piece whole, and small pull requests want each piece small. [The split](#the-pull-requests-one-at-a-time) is the first test: six landings (P6, P7, P9, P10, P11, P12) before P14 brings the first demo. In two cold reads of this page, readers agreed on the stories, goal, order of the demos and questions, and their task lists differed, so another reader may cut it differently.
- **Whether the split's hours hold.** Each row is my split of the detail's size rows, 50% sure, and it adds up to more than the approved size. P6's real `spent` is the first check.
- **Which of Tier 1's long checks the daily side would take.** The per-PR mutation check is set ([fast and daily mutation](../direction/fast-and-daily-mutation.md)); the daily run is not in Tier 1, so its long checks run by hand.
- **How the email path holds up.** The backup's pass is done for the sheet (P5); email recovery (P36) rests on [experiment 217](https://github.com/usirin/tea-fabrika/pull/406) and has not been run.
- **How long the whole thing takes.** The size is 50% sure.
- **Facts about PR 223 are as of 2026-11-01, except P2's fire counts, and the notes list is as of 2026-11-05, through PR 403.** A later push or note changes them. Check the links.
