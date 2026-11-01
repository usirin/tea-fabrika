# Tier 1: the plan for the first pass of the new fabrika

**Proposed, not approved, as of 2026-11-01.** No builder starts until the owner approves it. Nothing here is built. [The plan's way in](./README.md) says where this sits, and [the tiers](./tiers.md) say what comes after.

Every claim here is about `next/` at PR 223's head (`7c1d073`), unless it says "today's version". A path with no `next/` in front starts inside its package: see [Packages](#packages).

Three words to know. **Plan-115** is [ticket 115's plan](./ticket-115.md): laws p1 to p24, c1 to c6 and part of the public interface carry over from it, so read it too. **"My call"** means the agent that wrote this plan made that choice, and the owner may overturn it. **The note** usually means [the sync-engine note](../direction/a-local-first-sync-engine.md), and T1 to T7 there are not the T0 to T21 tasks here. Known risks are sorted into tiers, and the list is kept private. This file keeps the design of what protects things.

```ts
// The whole idea, as one sketch. A window proves who it is, its person lets it in, a press lands
// once, a note's save is one fact, and a program that breaks things on purpose only asks; code does the breaking.
const key = yield* ClientKey;                              // WebCrypto in a tab, the app's window key in Electron
send(hello({key: key.publicKey, signed: yield* key.sign(nonce)})); // unknown key: {why: "not_granted"}, then a code
// the person, once per browser: same code in the tab and the menu bar, Approve, a finger. One `granted` fact.
yield* Mailbox.send("counter:1", id, {type: "plus"}, who);  // Effect<Place, LedgerError>, `by` from the key
// the first real program. An agent saves through MCP and a person reads it drawn. A save on an old version
// is refused and writes nothing, for a window and an agent alike:
yield* Mailbox.send("notes:1", id, {type: "save", value: {note: "n-7f3a", base: 3, body}}, who);
// the chaos program stays pure Elm. Its update only returns data:
return [armed, [{type: "fire", fault: Fault.cases.abort.make({target: "gateway", name}), tick}]]; // the runner saves it, then a service fires it
```

## Summary

- **This plan is Tier 1 of seven.** All later work sits in the other six, in an order that is proposed, not settled, and each tier is one pass across all five layers. See [Later tiers](#later-tiers).
- **Tier 1 only has to work, in a shape later tiers can harden.** Each person answers for their own agents, so this tier does not defend against them. The door stays real: an unknown key is refused, on the laptop and on the cloud.
- **One walking skeleton through all five layers, in five pull requests.** Each one ends with the demo working and better than before.
- **The demo.** An agent starts the app, and the owner clicks. The app starts the brain. The owner gets one Electron window and one browser tab, each with a counter, presses in one and sees it in the other. Same stack on Alchemy's local stage and on the owner's Cloudflare account, one command apart. **It ends with a real job:** an agent saves a doc through MCP. The owner sees it drawn in another window, a phone tab on Cloudflare included, and adjusts it. The agent's next save, on the old `base`, is refused.
- **Notes are Tier 1's first real program,** a sealed program beside the counter and chaos, and this is dogfooding: agents write the owner's docs, and the owner reads and adjusts them. The counter stays as the test. Every save is one fact and is never overwritten. A stale save is refused, and the writer's text stays where it was. See [Notes](#notes).
- **Notes draw Markdown,** by copying today's `programs/markdown` under a second named exception to "never copy across". A note opens drawn; `e` shows the plain text box. The fact keeps the raw text, and the window parses it. See [Drawing a note](#drawing-a-note).
- **Agents reach notes through MCP,** by a bridge that is one more client with its own key. It comes in by the same door and the same Approve row, once per agent name. See [Agents through MCP](#agents-through-mcp).
- **Real notes live on the Cloudflare copy,** since a phone needs it and it survives a lost Mac. The laptop stage stays for tests and development. One small file in the app's home says which stage the app dials.
- **A let-in window can be removed from the menu bar.** Remove signs one `revoked` fact with the person key, with the same person check as Approve.
- **One fabrika Electron app.** The person opens only the app. The menu bar is part of it, and so is starting the brain as a plain launchd service. Quit stops the brain. `node next/apps/fabrika/dev.ts` stays for agents and tests.
- **The door is the sync-engine note's T5, built thin and real:** signed hello, the person's key grants each new client, an unknown key is refused. A tab shows a code, the menu bar shows a row with the same code, and a click plus a finger writes one `granted` fact. Same door and same flow on both stages.
- **`Backend` becomes `Host`, and each hello says what its host can do.** A host is a place hands can run: a Mac, a VM or a browser profile. Each platform Layer lists its capabilities, the hello's `has` carries that list, and `saw` on a grant keeps what the host claimed. Nothing reads it yet. The menu bar shows hosts, so approval stays once per host. See [Platform pieces](#platform-pieces).
- **No new accounts.** Dev builds are signed with a self-made card. The cloud stays on the Cloudflare account already in use.
- **`next/` becomes real packages in the same workspace, with real names from day one:** `@kampus/libfabrika`, `@kampus/tuval`, one package per program, and `@kampus/fabrika`, the app. Today's two already are `-old`. Nothing is published. See [Packages](#packages).
- **Plumbing moves to Effect** with thin objects and laws, as plan-115 worked out. Layers go strict.
- **Chaos monkey is a real program** in the same box as any other: no network, no new binding. It returns Cmds as plain data. Its results are letters in its own stream. By default it runs on a throwaway ledger, never on the one holding real notes.
- **Size, a guess, all 50% sure unless it says so:**

| Part | Product lines | Test lines | Agent hours |
|---|---|---|---|
| The plan before today | 3,300 to 4,500 | 3,350 to 4,800 | 25 to 40 |
| Notes | 350 to 550 | 370 to 590 | about 5 to 8 |
| Remove | 60 to 100 | 65 to 110 | about 1 |
| Drawing a note, mostly copied | 800 to 950 | 450 to 550 | 3 to 6 |
| Agents through MCP, part copied | 310 to 470 | 350 to 500 | 4 to 6 |
| Packages: moving the slice, six `package.json` and `tsconfig.json`, public names, config | 250 to 350 | 60 to 120 | 2 to 3 |
| Host and capabilities | 60 to 100 | 65 to 110 | about 1 |
| Tags: `no-hand-tag`, and the slice's `kind` and `is` moved to schemas | 80 to 120 | 70 to 100 | about 1 |
| **Total** | **5,210 to 7,140** | **4,780 to 6,880** | **42 to 66** |

- **Total agent hours: 42 to 66,** builder and test writer, plus mutation runs (50 to 125 machine minutes). **The steps stay as they are.** Nothing is cut to fit a date: plan, test writer, build, mutation sample and one review, for each PR.
- **How the size is worked out.** Written lines use the plan's own rate, about 150 lines an hour. Tests on written code keep its ratio of about 1.06 to 1. A copied line is guessed at a third of a written line's time, about 450 an hour, since it needs reading and fitting, not thinking up. How sure of that third: 40%. The doubt is what a copy carries over. If copied lines cost the same as written ones, the total rises by about 6 hours. The bigger doubt is still the menu bar and launchd, which nobody has built here, and how many laws break on the new stage. PR B's real numbers settle those, and PR D's the rest.

**The biggest calls.**

1. **A window's name is `<fingerprint>/<tab>`, and the key belongs to the browser profile.** Why: two tabs in one browser share one IndexedDB key. With one name per key, the second tab would close the first (gateway's code 4000). The code is per key too, so two tabs share one row. Cost: `tab` joins the signed hello. Sure: 85%.
2. **A new window comes in from the menu bar, and the door reads one signature shape.** Settled by the owner. The person key writes SSHSIG, the same shape `ssh-keygen -Y sign` makes. Why: the door keeps one check, and anyone can re-check a grant with `ssh-keygen -Y verify` later. PR A keeps the terminal command `grant.ts` as the way in until PR B brings Approve. After B it stays only as a developer path. Cost: about 30 lines to write SSHSIG, and one more test vector. Sure: 85%.
3. **One built file with programs and window scripts inside it, not env values.** Why: Cloudflare caps each env var at 5 KB ([limits](https://developers.cloudflare.com/workers/platform/limits/)), and the slice passes 664 KB of `WINDOW_JS`. It cannot deploy as is. Cost: esbuild text loader, about 40 lines. Sure: 90%.
4. **A program never gets a stub for its power.** Elm's answer: Cmds are data, the runtime does them. Why: `globalOutbound: null` and an empty env stay true for every program, so nothing new has to be checked in the box. Cost: `Program` gets a Cmd type, and `step` answers `{model, view, cmds, wake}`. Sure: 85%.
5. **Fault replay can never fire a fault.** A fold ignores `cmds`; only a fresh letter fires them, and the letter is saved first. Why: otherwise every wake re-kills everything. Cost: two paths in the runner. Sure: 90%.
6. **Laptop-only kills stay outside the program for now.** `kill -9` needs hands and C3's routing. The drill (`next/apps/fabrika/chaos-drill.ts`) does them and posts the result as a letter, so history stays in one stream. Why: no dead button in the window. Cost: one more script. Sure: 75%. The doubt is whether a button is wanted sooner. It waits with the items in [what can wait](#dropped-from-plan-115-and-what-can-wait), and nothing is lost: the facts have the same shape.
7. **The app starts the brain as a plain launchd service, not through Electron's login-item call.** Settled by the owner. Why: the brain outlives an app crash, and it works on a dev build with a self-made card. Cost: about 60 lines and one spike. Sure: 75%. The doubt is launchd on an unsigned build. If T8's spike fails, the app starts the brain as a child process for this pass, and the owner is told.
8. **The menu bar's three jobs need no new layer.** Settled by the owner. Who may let whom in is the door plus ledger facts: the brain decides, the menu bar signs. Holding the key is a `PersonKey` service with platform Layers. The menu is a pure Elm view in the desktop core. Why: everything stays a Msg, a Cmd or a fact, so it can be tested with no Electron. Cost: one small machine and two services. Sure: 85%.
9. **A program declares its typed inputs and outputs now, and nothing carries them yet.** A program in `next/` today has `msg` and `view`, which face its window, and nothing that faces another program. Elm's answer is ports. `Program` gains `inputs` and `outputs`: named Effect schemas, both required, so every program says what it has, even if that is `{}`. A value on input `x` reaches the machine as the Msg `{type: "x", value}`, so `msg` stays the one list of what `update` takes. **Now something does carry inputs: MCP tools are made from them in PR D,** which also gives each input its `description`, `writes` and `personOnly`. Why: Tier 2's `tracker | ticket` then adds a wire, not a rewrite of each program. Pipes and `fabsh` are not in this plan. Cost: about 10 lines, and a small edit to `counter` and `chaos`. Sure: 75%. The doubt is whether one Msg per input is the right shape. Only `tracker | ticket` settles it, and if it is wrong, two programs change.
10. **Notes land as their own PR, after Cloudflare and before chaos.** Why: PR C still proves the counter there, and chaos gets a real target from its first run. With chaos first, its target list, its driver and p39 would be written twice. Cost: chaos waits one more review. Sure: 85%.
11. **A stale save offers "Keep mine as a new note".** Why: it asks for no reading and no decision while the person is mid-thought, and both texts survive. Saving over would take one click to bury the newer version. Cost: an extra note to tidy by hand. Sure: 80%. The doubt is how often this happens; use tells.
12. **One small file says which stage the app dials:** `<home>/stage.json`. Why: the owner sets it once, and a menu choice would be a daily button for a thing that never changes. Cost: going back means deleting a file. Sure: 75%. The doubt is whether a person ever wants to switch often.
13. **Chaos is not in the build on the real ledger.** Why: code not there cannot be reached, so no flag or slip can aim it at real notes. Cost: a second stage to deploy and remove for a cloud run. Sure: 85%.
14. **The window parses Markdown; the sealed program never does.** Why: the fact keeps raw text, blocks are derived, a wake would otherwise parse every note, and a program's box stays small. Cost: each window parses for itself. Sure: 90%.
15. **The bridge is a client with a key, not a local socket with a name.** Why: a handshake lets an agent just say who it is, and real notes live on Cloudflare, where a local socket cannot reach. Cost: one Approve per agent name, and a key file. Sure: 85%.
16. **On notes, an agent's "own run" is its own client, not its own process.** Today's rule gives each agent its own run because a run in a tile writes as the person. In `next/`, `by` comes from the checked key, so that danger is gone, and a process of its own would hide the agent's doc from the list. Cost: this differs from today's `drive.ts`, and a later program with private state gets a real run of its own. Sure: 75%. The doubt is the first such program, in Tier 2.
17. **Real packages now, not folders.** Settled by the owner. "Two people first" argues against publishing, not against package boundaries. Real boundaries prove the library is enough, because a missing tool shows up as an import that doesn't resolve. A program package is already the shape a pack has. Cost: a `package.json` and a `tsconfig.json` per package, and a few config lines. Sure: 85%. The doubt was code-graph's dead-export check and esbuild across packages; [Packages](#packages) says what each forces.
18. **`@kampus/libfabrika`'s top level holds only the app layer's names.** Lower layers are on subpaths that only named importers may use. Why: with one top level, an import name could not tell a program reaching `app` from one reaching `transport`, and the strict one-layer-down rule would have nothing to read. It also keeps a program's box small. Cost: three more lines in an `exports` map, and a law. Sure: 80%. The doubt is how many names the app layer ends up saying again.
19. **Fabrika is the logic, and Tuval is the projection of it.** Settled by the owner. `@kampus/tuval` holds everything a client does. `next/apps/fabrika` is only wiring and the deploy stack. Tuval may import `@kampus/libfabrika`, and never the other way. Why: a client's logic then has one home, and the library can't come to lean on a screen. Cost: tuval holds Electron code, on a subpath, and its `electron` row needs two named exceptions. Sure: 85%. The doubt is what counts as "dialing": see [Packages](#packages).
20. **Tier 1 has no desk process.** Settled by the owner: the desk is a program, and it arrives in Tier 2 with split and close. Tier 1 has one fixed layout at wiring, and each window keeps its own focus. Why: nothing in Tier 1 moves a tile, so a process would only hold one constant. Cost: PR 223 mirrors focus between two windows, and that goes away until Tier 2. Sure: 85%.
21. **`Backend` becomes `Host`, and `has` carries what the host can do.** Settled by the owner, in `brain-hands-window-agent.md`. Why: old hellos can never get the list back, so it goes in now, even with nothing reading it. Cost: 60 to 100 product lines, and one more field in each grant. Sure: 70%, as that note says. The doubt is capabilities that change, since a hello is said once.
22. **The hello's `backend` becomes `platform`, and so does the `Host` field that holds it.** My call. Why: it is a plain field, not a tag, and `{platform: "browser", has: ["screen"]}` reads out loud. The hello and the service carry the same value, so they use one word. Cost: one word, and no fact has been written with the old one. Sure: 80%.
23. **The tag key is `_tag`, and Effect Schema writes it.** Settled by the owner. Why: `Schema.TaggedUnion` gives makers, `match` and guards, and `catchTag` reads the same key, so data and errors share one word. Cost: the slice's `kind` and `is` move, and one new lint rule. Sure: 90%. See [Tags](#tags).

## Stories

- **s1:** the owner wants the brain built on Effect with strict layers, so nothing rests on Promises and every layer can be replaced.
- **s2:** the owner wants laws they can read, so a green run means something without reading the diff.
- **s3:** a person at a window wants the same speed and the same recovery as before.
- **s4:** the owner wants nothing to join their fabrika unless they said so, on the laptop and on the cloud alike.
- **s8:** a person wants to open one app and have everything run, with one click and a finger when a new window asks in, and no prompt when opening fabrika.
- **s5:** the owner wants a browser tab and an Electron window to be the same client in different clothes.
- **s6:** the owner wants the same stack one command from Cloudflare.
- **s7:** the owner wants to break the running thing on purpose, watch it recover, and read what happened months later.
- **s9:** the owner wants an agent to write a doc, to read it drawn in any window, a phone included, and to adjust it, and never lose saved text, even if two writers disagree.
- **s10:** a person wants to remove a let-in window or agent from the menu bar, without a terminal.
- **s11:** the owner wants to let a named agent in once, see its name on what it writes, and know it cannot let anyone in or write as them.
- **s12:** the owner wants the library, the desktop and each program to stand as packages, so a program can only use what the library really offers, and nothing in `next/` can lean on today's code.

## The order of work

1. The owner approves this plan. Two questions are still open, and the rest are settled: see [Settled by the owner](#settled-by-the-owner).
2. Start from main at `05a43d0` or later. PR 226 (oxlint and oxfmt replace Biome) and PR 229 (the `-old` rename) are merged.
3. The docs PR lands, as the list below says. The notes it names were first brought in line on 2026-11-01, in the same change that added this file. Re-check them against this plan before PR A.
4. The exam PR lands, by an agent that is not the builder. See [The exam PR](#the-exam-pr-not-in-this-plan).
5. **PR A, door and plumbing:** PR 223 rebased on the exam and moved into packages (T0), then T1 to T6. Demo: two tabs of one browser show one code, and one terminal command lets both in, on the local stage.
6. **PR B, the app:** T7, T8, T15, T9, in that order. Demo: the owner opens the app, types their own name (the person a grant's `for` points at), and gets a window. "Open in browser" brings a tab online, and a tab typed by hand comes in with Approve. Remove takes a let-in window out.
7. **PR C, cloud:** T10 and T11. Demo: the same on Cloudflare, with the same approval flow, after the owner reads `alchemy plan` and says yes. It still proves the counter.
8. **PR D, notes:** a small exam PR for p22's new wording and the copies' laws, then T16, T17, T18, T20, T21 and T19, in that order. Demo: on Cloudflare, an agent runs `notes_save` through MCP, let in once by Approve. The doc shows drawn in another window and in a phone tab. The owner presses `e`, adjusts it, and saves. The agent's next save, on the old `base`, is refused, and it reads and saves again. From here the Cloudflare ledger holds real notes.
9. **PR E, chaos:** T12 to T14. Demo: a run with a seed, a verdict on the screen, on a throwaway ledger on each stage, pressing the counter and saving notes while faults fire.

Each PR: test writer first (a separate agent, adds its tests, runs them on the base), builder with local commits (cannot touch the tests), mutation sample, one review by another agent, screenshots, the owner's yes. Runs and notes go to `field/` the same day.

**The docs PR,** before the exam, since those notes differ from this plan (gap 9). It holds:

- Real notes on the cloud, chaos on a throwaway ledger, and `refuse`.
- **The sketches that still show `kind` on ledger entries,** in `a-local-first-sync-engine.md` and `the-cloud-is-one-more-host.md`. They move to `_tag` when the owner approves this plan, as [Tags](#tags) says. Ticket 32 tracks it.

The pull request that added this folder already made the rest of this list: `where-each-piece-lives.md` and `the-desktop-layer.md` on `@kampus/tuval` and the desk, the line in `AGENTS.md` on no `of` names, the `useSyncExternalStore` wording by version, and the tag examples in `AGENTS.md`. Today's version keeps `useMachine`, `nameOf` and `outcomesOf` until that code goes.

**Why five PRs, not one:** 9,700 and more lines in one review is not a review. Each cut is a whole visible thing, and every layer still moves when it needs to. Cost: a rebase per landing, and five reviews instead of one. Sure: 75%.

**Why notes come before chaos:** see biggest call 10. Chaos keeps its T numbers, so T16 to T21 run before T12. PR D is the largest, at about 1,500 to 2,000 product lines, roughly half of them copied. Its copied files land as a commit of their own, unchanged, so the review reads the fitting as a diff.

## How the lock works (the note's T5)

**Sources:** T5 in `docs/direction/a-local-first-sync-engine.md` (line 258), `a-browser-is-always-a-client.md`, and `the-ledger-goes-to-cloudflare.md` (access starts from an invitation; members are facts). Tailscale's device approval and Signal's linked devices are the shape T5 names ([Tailscale](https://tailscale.com/kb/1099/device-approval)).

**Two sets of T numbers.** "The note's T5" is that note's decision. A bare T5 is this plan's task.

**The gap in PR 223:** the hello in `next/packages/libfabrika/src/transport/wire.ts` is unsigned (its comment says "`key` and `signed` wait for T5"), and the door checks only the origin.

**A first browser tab, step by step, and an Electron window goes the same way:**

```text
1  tab opens the brain's url. Page and scripts are public, and hold no secret.
2  first time only: tab makes an Ed25519 key, not extractable, keeps it in IndexedDB.
3  tab dials /client/<fingerprint>/<tab>.
4  brain says  {method: "challenge", params: {nonce}}, the first frame.
5  tab says    initialize {versions, has, ping, key, tab, platform, said, signed}.
6  brain checks: the signature is good for this nonce, this url, this tab; the key hashes to the
   name it dialed. The key is unknown, so:  err {why: "not_granted", fingerprint}.
   Nothing is written. Every method but door.knock gets no_hello.
7  tab says door.knock {label: "Chrome"}. Brain keeps the key and its has in memory and picks a code for it:
   {method: "door.waiting", params: {code: "482109", until}}. A second tab with this key gets the
   same code, so both share one row.
8  tab shows "This window is waiting for you. Code 482 109. Open fabrika in your menu bar to let it
   in." No other buttons.
9  menu bar shows a row: "Chrome on this Mac, 1 tab, says code 482 109. [Deny] [Approve]". Approve has no
   default focus, and Enter does not approve.
10 person clicks Approve and gives a finger. Where Touch ID cannot prompt, the click alone counts.
11 the app's main process signs the grant with the person key, as SSHSIG, and posts to /grant.
12 door checks: signer is one of the keys of the person the grant names, right ledger, key not
   revoked. It writes one fact, `granted`, keeping the signed text whole. It tells that key's gateways.
13 gateway says {method: "client.granted", params: {nonce}}. Tab says hello again. It is online,
   with no reload.
14 next time: the key is still there, so step 6 passes and no one is asked.
```

**A rule on the door.** The signer is one of this person's keys, never "is it the menu bar". The door has no idea what signed. So a browser or a phone can become an approver later with no change here.

**In PR A, before Approve exists.** Steps 9 to 11 are a command the waiting window prints, with a copy button:

```text
node next/apps/fabrika/grant.ts client <url> SHA256:ab12... --code=482109 --label=Chrome
```

It asks the door for the ledger's name, prints what it will sign, calls `ssh-keygen -Y sign -n fabrika-client` with an ordinary key named in `founded.keys`, and posts to `/grant`. It writes the same fact, with `saw.how: "command"`. In PR B the waiting words change to the ones above, and the command stays only as a developer path.

**Deny.** The row's Deny writes one `denied` fact and needs no finger, because saying no should be easy. It goes over the menu bar's own link as `door.deny`, so `by` comes from the checked key and no signature is needed. Only a person's own client can call it, so an unknown key cannot grow the log. The tab shows "Denied. [Ask again]".

**The code.** The brain picks it fresh, per key. It is for eyes only and carries no power: the door checks the key, and `saw` records what the person looked at. Waiting keys are kept in the brain's memory, in the project object, with a small cap (64, a guess) that drops the oldest, and a 10-minute life, then a new code. Nothing is written for an unknown key.

**The first Electron window.** It needs no approve. Electron's main process makes two keys when the app is first opened: a person key and a window key. The first window is named at founding. The private halves stay in the main process, and the page never sees them. A tab's grant does not carry over, because a window is its own client (the note's T3).

**Why two keys.** A window signs every hello, silently. The person key only signs when a person says yes. One key cannot do both. It also lets a person remove a window without touching themselves. Cost: one more field at founding. Sure: 85%.

**The very first fact.** The app shows a founding screen, with one name field and a Start button. It is drawn from a local file, since no brain runs yet. Start writes the public halves and the name to the app's home and then starts the brain. The stack reads them at start or deploy (`--founder=<founder.json>`), so they are not in the repo. When `door/members` is empty, the door writes `founded {name, keys, window}`. After that the ledger's facts rule, not the config. So the first person to connect never gets to claim anything, as the ledger note says. A founding screen never appears when data exists. A key that fails to open is an error in plain words, never a reason to make a new key. `founded.keys` stays a list, so more keys can join later.

**When an agent runs the demo.** An agent starts the app, and the owner clicks. In tests, `e2e` uses a temp home and a test `PersonCheck`, and a throwaway key in a temp folder for the real `ssh-keygen` path. The cloud smoke run goes the same way as the demo.

**Revoke.** Stays one fact, `revoked {key}`. The door tells the gateways and they close with 4003. A revoked key stays dead forever, so a replayed grant does nothing. The tab shows "This window was removed. [Ask again]", and Ask again makes a new key. In Tier 1 a person revokes with [Remove in the menu bar's panel](#the-menu-bar), so a ledger the app founded can remove a window from PR B on. `grant.ts revoke` stays as a developer path. It signs with an ordinary key named in `founded.keys`, so it works on a ledger founded with `--founder`. The full Windows list tile stays in Tier 3.

**Chaos answers to the same identity.** Only a client the door let in can send to `chaos:*`, and `who` comes from the checked key. With one person in Tier 1, every such client is that person's own, so no per-grant limit is needed. Who may start a run among two people is decided with invites, in Tier 3.

**What differs between local and cloud:** nothing in the door, and the same approval flow. `saw.where` is "this Mac" on the laptop and comes from Cloudflare's `request.cf` on the cloud. The one extra check is local: the HTTP header `Host` must be the bound address. On Cloudflare, routing does that job. A knock gains nothing without Approve. Typed codes arrive in Tier 3.

```ts
// A sketch of the stage value. One door; a union, so "cloud with an address check" cannot be said.
const Stage = Schema.TaggedUnion({
	local: {address: Schema.String, ledger: Schema.String, founder: Founder, chaos: Chaos},
	cloud: {ledger: Schema.String, founder: Founder, chaos: Chaos}, // Chaos: see Chaos monkey
});
```

## The menu bar

**The answer:** one Electron app. An Electron Tray plus a small panel window, drawn from a local file, never from the brain's page. It lands in PR B. It has three jobs and one small check of the person, and no new layer.

```ts
// next/packages/tuval/src/desktop/menu.ts, a sketch. The Elm answer: model in, items out. Touch ID and signing are Cmds.
export const menuView = (m: MenuModel): ReadonlyArray<MenuItem> => [
	MenuItem.cases.status.make({words: m.brain}),
	...m.rows.map((r) => MenuItem.cases.row.make({key: r.key, words: `${hostWords(r)}, says code ${r.code}`})),
	...m.clients.map((c) => MenuItem.cases.client.make({key: c.key, words: hostWords(c), removable: !c.own})), // the app's own window has no Remove
	MenuItem.cases.action.make({id: "open_browser", words: "Open in browser"}),
	MenuItem.cases.action.make({id: "quit", words: "Quit"}),
];
const update = (m, msg) =>
	msg.type === "approve" || msg.type === "remove"
		? [keepShown(m, msg.key, msg.type), [check(msg.key)]]        // a click keeps what the row showed and which act, and asks for a finger
	: msg.type === "checked" ? [m, [sign(msg.key, {...shown(m, msg.key), check: msg.check})]] // the kept act says grant or revoke
	: msg.type === "not_checked" ? m                                 // no finger, no fact
	: m;
// hostWords: "Chrome on this Mac, 2 tabs". An agent is not a host, so it stays "Agent claude, this Mac".
// One value: approve "SHA256:ab12" -> check -> {check: "touch"} -> sign -> /grant -> the row is gone.
// Another:   remove  "SHA256:cd34" -> check -> {check: "touch"} -> sign -> /grant -> one `revoked` fact, the tab closes with 4003.
```

| Job | Where it lives | In a test |
|---|---|---|
| Who may let whom in | The door plus ledger facts: the brain decides, the menu bar signs | Node, with `answerFrame` and `foldMembers` |
| Holding the key | `PersonKey`, with platform Layers | `tuval/headless`, a key in memory |
| The menu | `menuView`, drawn by `tuval/electron`, an array in headless | An array to read |
| Checking the person | `PersonCheck`: the Mac version only in Tier 1, plus a test version | Answers given by the test |

- **`PersonCheck` on a Mac:** Touch ID where `canPromptTouchID` is true, a plain click otherwise. No Swift helper. Sure: 85%. The doubt is Touch ID from a dev build signed by a self-made card. T8's spike settles it, and the plain click is the way out.
- **Its link.** Main dials the brain as one more client, `<window fingerprint>/menubar`, signing its hello with the window key. It reads rows with `door.watch`. Reading rows never touches the person key, so opening fabrika asks nothing.
- **The law: kill the menu bar and the counter keeps working; only new approvals wait.** In one Electron app, killing the menu bar means killing the app. The brain is its own service, so tabs stay online. A new tab shows its code and waits. Reopen the app, and the row is there.

**Remove.** The panel keeps a small list of let-in windows under the waiting rows: label, where, and how many tabs are online. The list folds from `granted` and `revoked` facts, and the brain sends it as `door.clients` on the same `door.watch`, so reading it never touches the person key. Remove asks for the same check as Approve, Enter does nothing, and it has no default focus. A yes signs one `revoked` fact with the person key, and it goes to `/grant`, the door's one way in for signed facts. No finger, no fact. The fact keeps what the person saw: label, where, and the check.

- **The app's own window has no Remove.** Its key also signs the menu bar's link, so removing it would end approvals with no way back in this tier. A command can still do it, on purpose.
- **An agent is on the same list,** named as one, from PR D.
- **The panel shows hosts.** A window's row reads "Chrome on this Mac, 2 tabs". The key belongs to the browser profile, so three tabs are one host, one row and one Approve. On Cloudflare, `saw.where` comes from `request.cf`, so it reads like "Chrome from <city>, 2 tabs".
- **Why here, in PR B, and not in the Tier 3 tile:** otherwise the real app could let a window in and never take it out. Cost: 60 to 100 product lines, a guess at 50%. Sure of the shape: 85%, since it reuses the check, the signature and the fact.
- **How Linear would do this, as opinion:** a device list under the account's settings, with a revoke and a confirm. We keep it in the panel, because that is where a window came in, and the finger is the confirm. The full list with last seen waits for Tier 3.

**The one-time link stays.** It is made only when the person clicks "Open in browser" in the menu bar. It is single use, lasts 60 seconds, keeps its secret after the `#`, and works on both stages. No agent call can ask for one, because no brain method and no bridge call makes one: only the click does.

```text
1 person clicks "Open in browser". Main picks a secret, keeps it in the menu's model with `until`,
  and opens <url>/#pass=<secret> in the default browser.
2 tab makes its key, says hello, gets not_granted, clears the address, and says
  door.knock {label, pass: <secret>}.
3 the row reaches the menu bar with that pass. It is live and unused, so the menu machine drops it
  and asks to sign, with saw {how: "link", check: "none"}. No finger: the click was the person's say.
4 door writes one `granted` fact, the same path as Approve. Tab is online with no reload.
stale, used or unknown pass: the row is a normal row, and the tab shows its code.
```

Why this shape: the door gains no second way in and no new state, since it only ever reads a signed grant. Cost: about 40 lines in the pure machine. Sure: 80%.

**The brain as a service.** The person opens only the app.

```text
open   write <home>/brain.plist, then  launchctl bootstrap gui/<uid> <home>/brain.plist
       unless the brain already answers, for example after a crash
quit   launchctl bootout gui/<uid>/fabrika.brain
crash  nothing: launchd keeps the brain, and the next open finds it
```

- The plist stays in the app's home, not in `LaunchAgents`, so nothing starts at login. It runs `next/apps/fabrika/dev.ts`, so one program is under test. `node next/apps/fabrika/dev.ts` stays for agents and tests, on a temp home and its own port.
- It sits behind `BrainService`, with Layers `launchdBrain`, `childBrain` and a test one.
- **Spike first, on an unsigned build (T8).** If it fails, `childBrain` carries this pass, and the owner is told.
- Stopping must take workerd with it, and that is part of the spike.
- The app keeps its own home, apart from today's version, so both run side by side.

**Signing.** Dev builds are signed with a self-made card, so the Keychain sees the same app after a rebuild. Cost: one setup step on the machine. Sure: 70%. The doubt is whether the Keychain still asks. If it asks when opening fabrika, the window key moves to a browser-style WebCrypto key, so the plan does not stop. See [Electron window](#electron-window).

**What this tier does not do.** It does not defend against a person's own agents, because each person answers for theirs. PR B's README and body say so in that one sentence.

## Notes

**The answer:** a list of notes, each with a raw Markdown body, drawn when read and a plain text box when edited. A save comes after a short pause, on leaving the box, or from an agent's tool. Full history is kept, and everything reads back after a restart. It is a sealed program in the same box as the counter, with no network and no binding. It lands as PR D, for the reason in biggest call 10.

```ts
// next/programs/notes/src/program.ts, a sketch. `@kampus/notes`'s top level. One process, one inbox, one fold. It asks for no power, so its Cmd is never.
const Save = Schema.Struct({
	note: Schema.String,                                 // a short id the writer picks for a new note
	base: Schema.Number,                                 // the version this text was typed on; 0 for a new note
	body: Schema.String,                                 // raw Markdown. Never blocks: those are derived.
	how: Schema.optional(Schema.Literals(["pause", "leave", "done", "kept"])), // a window's; an agent's save has none
	from: Schema.optional(Schema.Struct({note: Schema.String, version: Schema.Number})), // the note a kept text came from
});
type Msg = {readonly type: "save"; readonly value: typeof Save.Type}; // a value on input `save`, as biggest call 9 says
type Model = {readonly notes: ReadonlyArray<{readonly note: string; readonly version: number; readonly body: string}>}; // last saved first

const refuse = (m: Model, {value: s}: Msg) =>
	s.body.length > MOST ? {why: "too_long", most: MOST}
	: versionNow(m, s.note) !== s.base ? {why: "changed_elsewhere", now: versionNow(m, s.note)}
	: null;
const update = (m: Model, {value: s}: Msg): Model => putFirst(m, {note: s.note, version: s.base + 1, body: s.body});

export const notes: Program<Model, Msg, View, never> = {
	name: "notes", machine, msg, view, refuse,
	inputs: {                                            // each becomes an MCP tool, in Agents through MCP
		save: {schema: Save, writes: true, personOnly: false, description: "Save a note's whole text, on the version you read."},
		read: {schema: Schema.Struct({note: Schema.String}), writes: false, description: "A note's text and version.", answer: oneNote},
		list: {schema: Schema.Struct({}), writes: false, description: "Every note: its id, version and name.", answer: everyNote},
	},
	outputs: {},
};

// The note is on version 3. One real value, before and after:
yield* Mailbox.send("notes:1", id, {type: "save", value: {note: "n-7f3a", base: 3, body: "# Ideas for Tier 2\n..."}}, who);
// notes:1/inbox  {id, m: {type: "save", value: {base: 3, ...}}, by, for, said, at, rev, pos}     this becomes version 4
// An old window or an agent, still on version 3, saves too:
// {why: "changed_elsewhere", now: 4}. No line is written. Its text stays with it, and nothing is overwritten.
```

**Three changes from the first sketch, and why.**

- **One inbox, `notes:1/inbox`, not one per note.** A program never holds the log, and Topic is not in this pass. A process per note would leave nothing able to fold the list. Cost: a wake folds every save of every note, see [the doubt below](#notes). Sure: 80%.
- **`note` is a short id the writer picks, not a number.** Two windows with no link cannot pick the same one, a new note with no text yet writes nothing, and an id already used is refused like any stale `base`. Sure: 85%.
- **The letter is the Msg, so it reads `save`, not `saved`.** That is how this plan's letters already work: the fold sends the same Msg back through `update`. Sure: 85%.

**The program needs a way to say no, and `Program` gets one.** Today a refusal only means a bad shape. So `Program` gains a required `refuse`, a pure check of a fresh Msg against the model. The counter and chaos answer `() => null`. Elm has no refusal, since its Msgs come from its own view; ours come from a window that may be out of date. Cost: about 10 lines, and a change to p22 in a small exam PR. Sure: 80%.

**In the runner, a fresh letter takes these steps, one letter at a time.**

```text
1  the id is already in the log?   answer as the first time. Never look at `base`.
2  refuse(model, m) says no?       answer its {why, ...}. No line, no view change.
3  append, then update.            one more version.

on a wake: letters from the log go through update only. refuse never runs on what was already saved.
```

- **Step 1 comes first, or a lost answer turns into a false alarm.** The save landed, the answer was lost, and the window resends. By then its `base` is old, so a check of `base` alone would say "changed elsewhere" about its own text. p53 holds this.
- **One at a time** is plan-115's permit (p22). It is also what makes two saves on one `base` end with one winner.
- **Refuse never runs on a wake,** and that changes plan-115's stand for real text. Its p25 lets old letters the new code refuses "count for nothing". With notes, that would make a saved version vanish after a deploy. So a stored `save` always folds. p55 holds it, with saved letters kept in `fixtures/next/` for good.

**How a write reaches the ledger.** The window never touches it, as [Strict layers](#strict-layers) requires:

```text
window (layer 5)     window.msg over its link
transport            gateway hands it on, with `by` from the checked key
app                  ProgramRunner.msg: the steps above; the program stays pure
coordination         Mailbox.send
data                 Ledger.append
```

A window reads old versions with `ledger.read`, a read it already has. It has no way to write except a Msg. An agent's bridge takes the same road, from the top.

**Who needs it picks the home,** as the three homes in `the-cloud-is-one-more-host.md` say:

| State | Home | Why |
|---|---|---|
| Every saved version, who, when | The log | Others need it |
| Which note is open, the draft, the scroll | The window's machine | Only this window needs it |
| Nothing | Program storage | See below |

**Which note is open stays out of program storage.** A process is shared by every window, so with one open note there, a phone opening a note would move the laptop's too. `keep` stays out of this pass as well. Cost: a reload opens the note saved last, and a filter of this kind is gone. Sure: 80%.

**The tile's own machine.** It is a union, so "saving with nothing sent" cannot be said.

```ts
// next/programs/notes/src/tile.ts, a sketch. Pure. `draft` lives here until a save's ok.
const Open = {note: Schema.String, base: Schema.Number};
const Box = Schema.TaggedUnion({
	reading: Open,                                     // drawn
	editing: {...Open, draft: Schema.String},          // the plain text box
	saving: {...Open, draft: Schema.String, sent: Schema.Struct({id: Schema.String, body: Schema.String}), then: Schema.Literals(["reading", "editing"])},
	stale: {...Open, draft: Schema.String, now: Schema.Number},
	too_long: {...Open, draft: Schema.String, most: Schema.Number},
});
// reading + `e` or Edit: editing, with the saved text as the draft. Done or `Mod-Enter`: save now, then reading.
// saving + ok: base becomes base + 1. If the draft moved on, send again; if not, go where `then` says.
// saving + link lost: stays saving, and the same id goes again, so the log keeps it once.
// reading + a newer version in the view: redraws at once. That is the demo.
// editing + a newer version in the view: the text does not move. The next save goes stale, as already planned.
```

- **One save at a time per note.** A window that sent a second save before the first answered would be refused by its own first save.
- **The pause is 1.5 s, a guess.** Use settles it. Leaving the box, closing its tile, and the page going away each save at once. Done with no change writes nothing.
- **"Saved" only shows after the ok.** Until then the text is only in this window, and the screen says so.

**Each state is real.**

| State | What the person sees | What they can do |
|---|---|---|
| Empty | "No notes yet." | New note. The box takes the cursor. |
| Reading | The list, last saved first, each named by its first heading or line. The note drawn. | Edit or `e`. Scroll with `j`, `k`, space. Open another. Open history. |
| Editing | The same list. The plain text box. | Type. Done or `Mod-Enter`. |
| Saving | "Saving" then "Saved", small, in the bottom line | Keep typing |
| No link | "Not saved yet. This text is only in this window until the link is back." | Keep typing. It saves by itself. |
| Stale | "This note changed in another window. Your text is still here, and nothing was overwritten." | Keep mine as a new note. Drop mine and show the newer one. |
| Too long | "This note is too long to save. Your text is still here." | Cut it, or keep typing |
| Read failure | "Could not read your notes. Nothing is lost. Trying again." | Try again now. A draft stays on screen. |
| History | Each version: when, who wrote it (a window, or an agent and who it works for), its raw text, read-only | Read it, select it, copy it |

**The stale screen.** It only shows in the box. Lean: "Keep mine as a new note", plus a way out. Keep writes a new note, `how: "kept"` and `from` naming the note and version it came from. Neither button has default focus. Drop is the only act here that loses text, the words say so, and it writes nothing. Why not save over: see biggest call 11. Cost: no delete in Tier 1, so a kept note stays. Sure: 80%.

**`MOST` is 256 KB, a guess.** Why: a limit a person sees beats a socket that dies. It is checked in the pure program, so it is the same on both stages. Cloudflare's own frame limit is the thing to read before PR D sets it. Sure: 60%. The doubt is the true limit, and T17 reads it.

**Not in Tier 1:** formatted typing in place, tabs, comments, search, sharing, live co-editing, any CRDT, and deleting a note. Nothing is lost by waiting: a later `archived` fact can hide a note, and the raw text is what any later editor reads. See [Later tiers](#later-tiers).

**Where real notes live.** On the Cloudflare copy, once PR D lands. The laptop stage stays for tests and development.

```json
// <home>/stage.json. One file, two shapes, read through a Schema.TaggedUnion. No file means local.
{"_tag": "local"}
{"_tag": "cloud", "url": "https://<the worker's address>"}
```

- **Who writes it:** a deploy of `--stage cloud`, right after the owner's yes, since it knows the address. A deploy of `drill` never does. Agents and tests keep `--url` for one run, which wins and writes nothing. To go back, delete the file.
- **What it changes:** the window dials that stage. On `cloud`, the app does not start the launchd brain, and Quit has none to stop. The founding screen, the keys and the home are the same for both.
- **What the person sees:** the panel's status line and the tile's bottom line name the stage, as "Cloudflare" or "this Mac, for tests". So nobody types a real note in the wrong place by not knowing.
- **Why not a menu choice:** see biggest call 12. **One command apart still holds:** one stack, one deploy, and the file is its result.

**From PR D, this ledger is real.** `next/` stays a lab everywhere else. The cloud ledger is not wiped or renamed, the Worker keeps `RemovalPolicy.retain()`, and a change to a letter's shape only adds. Sure: 90%.

**The doubt: a long history and a sleeping object.** Each wake folds every save, and on Cloudflare the object sleeps after about 10 s. If saves run at 500 a day, that is about 180,000 letters a year, and old bodies are read just to be replaced. Lean: measure it first. T17 records a wake at 1,000 and 10,000 saves of 5 KB, and p58 records the real one, into `field/`. If it is too slow, the object keeps the folded model in its own storage as a cache, since it is derived, and rebuilds from the log when the cache's rev is behind. Cost if needed: about 30 lines and one more law. Sure the fold is fine for Tier 1's first weeks: 70%. Only the numbers settle how long that lasts.

**How Linear would do this, as opinion, per screen.**

| Screen | What Linear would likely do | Where we differ, and why |
|---|---|---|
| The list | Quiet rows, keyboard first, one key for new | The same quiet rows. A key for new waits, since Mod-N is on a tab's `cannot` list. |
| Reading | A calm page of one column, the doc drawn | The same. Today's `.markdown` rules already follow it. |
| Editing | Formatted typing in place, no mode, no save button | Two modes, reading and a plain box, as Obsidian's [reading and editing views](https://obsidian.md/help/edit-and-read) split them. Typing in place needs an editor this tier does not build. |
| Saving | Says nothing while all is well | We show one small word. Trust in a new tool is not earned yet. |
| Stale | Would not exist, since their editor syncs live | Live editing is out, so a refusal has to be honest. |
| Empty | One line and a key | One line and a button |
| Read failure | A small banner that retries alone | The same, plus Try again now |
| History | A side panel of versions | A list in the tile, since a tile may be a quarter of a window |

**On a phone.** A phone tab is a browser tab: same door, same Approve in the menu bar, same tile. At phone width the list and the note take turns on screen, and the tile saves when the page goes to the background. T19's spike opens it on the owner's phone first. If its browser does not keep the key, the phone asks again with a new Approve: tiresome, not unsafe. No fallback is planned.

## Drawing a note

**The answer:** a note opens drawn. `e` or an Edit button shows the plain text box, and saving goes back to drawn. The fact keeps the raw `body`. Blocks are derived, never stored. The drawing comes from today's `programs/markdown`, copied by a named exception.

```ts
// next/programs/notes/src/view.tsx, a sketch. Parsed here, in the window, only when reading.
const Reading = ({body}: {readonly body: string}) => {
	const root = useMemo(() => Root.fromMarkdown(body), [body]);  // "# Hi\n\n**bold**" -> [{type: "heading", ...}, {type: "paragraph", ...}]
	return <Blocks blocks={root.children} />;                     // React elements, one per node, never an HTML string
};
```

**The second named exception to "never copy across", by the owner.** It is written as the styling one is: a comment in each copied file names the source path and commit, and c7's read checks it. From main at `2c29c13`, today's version:

| From `programs/markdown/src/` | Lines | What happens |
|---|---|---|
| `root.ts` | 237 | Copied to `programs/notes/root.ts`, with `blockOf`, `inlineOf` and `webOf` renamed. It imports only `effect` and the mdast packages. |
| `window.tsx` | 303 | The drawing parts go to `programs/notes/drawn.tsx`, about 240 lines: `keyed`, `Phrasing`, `Drawn`, `CodeBlock`, the scroll keys, with `spanOf` and `scrollOf` renamed. `WindowProps` and today's library import stay behind. |
| `highlight.ts` | 111 | The colors and token logic go to `programs/notes/highlight.ts`, about 60 lines, with `colorsOf` renamed. The loader is written fresh. |
| `index.ts` | 84 | Not copied. Notes is the program. |
| `markdown.test.ts`, `highlight.test.ts` | 290, 77 | Ported by the test writer, as exam files. |
| `index.laws.test.ts` | 99 | What applies, ported by the test writer. |
| `.markdown*` in `apps/fabrika/src/window/window.css` | lines 1347 to 1561, 215 | Under the styling exception, into `window/style.css`. 11 of these lines read old names the styling copy drops, and an unknown CSS variable fails silently, so each is rewritten to a token that exists. p62 checks it. |

**What each copy gives up.**

- **`q` means nothing here.** In the markdown program it quits as `less` does. A notes tile does not end when a note is read, so it goes, and `e` joins `j`, `k`, space, `b`, `g` and `G`.
- **`Kbd` from `@manti-ui/react` goes.** `next/` has no Manti, so the keys are in the bottom line as plain words, by the frame rules.
- **Names change.** Every `xOf` name is renamed as it lands, in the commit after the plain copy: `colorsOf` to `colors`, `spanOf` to `span`, `scrollOf` to `scroll`, `blockOf` to `block`, `inlineOf` to `inline`, `webOf` to `web`. `no-of` fails on any it misses. The `biome-ignore` comment takes oxlint's form, and `console.warn` goes.
- **Links.** `target="_blank"` stays. In Electron, main hands an http or https URL to the person's browser and opens no window, which is the one change to "new windows denied".

**The highlighter's loader, rewritten.** Today it is built on a Promise, with a module-level `loading`, and the window calls `void loadColors()`. Neither may cross under `no-promises`. The Elm answer: a Cmd and a Msg, with colors as plain data.

```ts
// next/programs/notes/src/tile.ts, a sketch. Colors are data in the tile's model, per block, keyed by language and text.
| {readonly type: "color"; readonly key: string; readonly code: string; readonly lang: string}          // a Cmd
| {readonly type: "colored"; readonly key: string; readonly lines: ReadonlyArray<ReadonlyArray<Span>> | null} // the Msg back. null: stays plain.

// next/programs/notes/src/highlight.ts. The Cmd's body. `import()` is the platform's own edge, one line, named in the exam.
const load = Effect.cached(Effect.tryPromise(() => import("./highlighter.ts")));
```

Why: no module state, no function in a model, and the tile's laws run with no WebAssembly. Cost: about 40 to 60 lines, and spans held in the model while a note is open. Sure: 75%. The doubt is memory on a doc with many large code blocks.

**Where parsing runs: the window, as biggest call 14 says.** It fits the layer rules with no new row, since npm packages are not layers. `@kampus/notes/window` holds the view and the drawing, and the app's view table reaches it, as the counter's and chaos's do. `@kampus/notes`, what the box loads, is `program.ts` alone, and a law checks its bundle holds no `micromark`, `mdast` or `@pierre`.

**What was checked, and what it asks of the plan.**

- **Dependencies.** All are already pinned exactly in the catalog, so `next/programs/notes/package.json` adds only `catalog:` lines: `@pierre/highlights` 0.3.0 (a beta, held exact), `mdast-util-from-markdown` 2.1.0, `mdast-util-gfm` 3.1.0, `micromark-extension-gfm` 3.0.0, `@types/mdast` 4.0.4. No new entry, and the `^19.0.0` range in `programs/markdown/package.json` does not come along. If a later highlighter breaks, code is plain, and nothing else depends on it.
- **The page's content security policy.** `next/`'s page has none today, and agent-written text is drawn in a real tab, so PR D adds one, as a header from the brain, the same on both stages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. `'wasm-unsafe-eval'` lets in WebAssembly and nothing else. So `style.css` is served as a file, not put inline in the page. A span's color still works, since React sets it as a property. Today's `apps/fabrika/src/files.ts` shows the same policy without `connect-src`. Sure: 85%. The doubt is `connect-src 'self'` and the socket on a phone's browser; T19 tries it.
- **The page script's size.** The slice's script was 664 KB, and today about 400 KiB of `programs/markdown`'s script is the highlighter. A phone should not fetch that for a note with no code. Lean: the highlighter is its own script, `/highlight.js`, kept in the one built file and fetched when the first code block with a language asks. It needs no third export on the package: the app's `build.ts` splits on the `import()` inside `@kampus/notes/window`. Why: today's own note says text draws first and colors come after anyway. Cost: esbuild splitting, one route, and p33's law covers two scripts. Sure: 75%. T20 prints both sizes in the PR. No size blocks, since no bar is measured.
- **`no-tea-react` and the React rule.** `drawn.tsx` imports no tea React. Colors as data also remove its own `useSyncExternalStore`, so the one hook stays the one hook. React stays 19.3.1 from the catalog, and Strict Mode stays on, which `void loadColors()` in an effect would have run twice.
- **`useState`, which A3 forbids.** Checked: `programs/markdown/src/window.tsx` has none. It uses `useMemo` for derived lines, and `useRef` and one `useEffect` to focus the page, which hold no state of ours. So the copy brings none in. Today's `frame.tsx`, `pop.tsx` and `desk.tsx` do use it, and they are not copied here.

**Laws kept, because agent-written text is drawn in a real tab:** raw HTML is never drawn, links are only http or https, images show as alt text and load nothing, and code is text children. See p61.

**Formatted typing in place is later,** in [Tier 6](#later-tiers). No fact is lost, since the body stays raw text.

**The doubt: what the copied code carries over, and whether reading then pressing edit is enough.** Copies carry their own bugs and their shape from a program that showed one text and quit, not a note that changes while read. Reading then editing may feel like a step too many when adjusting one word. Use of it will tell. Cost if it is not enough: the tier for typing in place moves up. Sure: 70%.

## Agents through MCP

**The answer:** an agent adds one line, and it has tools made from each program's inputs.

```text
claude mcp add fabrika -- fabrika mcp --as claude
```

```ts
// What the agent sees. One tool per input, from its schema. None is written by hand.
//   runs            what runs, your own run, and tiles as a list you cannot drive
//   notes_list      read-only
//   notes_read      read-only
//   notes_save      {value: {note, base, body}}
yield* tools.call("notes_save", {value: {note: "n-7f3a", base: 3, body: "# Plan\n..."}});
// {version: 4}.                         one line in notes:1/inbox: by the agent's key, for the owner
// the owner adjusts it, and that is version 5. The agent saves again, on base 4:
// {isError: true, text: "changed_elsewhere: this note is on version 5. Read it, then save on that."}
```

**The shape, and where MCP stops.**

```text
agent client  --MCP over stdio-->  the bridge  --the same WebSocket and door-->  the brain, on either stage
                                   a headless client, `as: "agent"`
```

MCP runs only between the agent client and the bridge. On the wire, the bridge is a client like any other, so a browser could be this client too. The bridge lives on `@kampus/libfabrika/mcp` and names no program. `next/apps/fabrika/mcp.ts` starts it and hands it `[notes]`, and `fabrika` is a one-line command that calls that. The stage comes from `stage.json`, so an agent writes where real notes live, and `--url` wins for one run.

**Let in once.** The first time a name is used, the bridge makes a key file in the app's home (`<home>/agents/<name>.key`, mode 0600) and knocks with `{label: "claude", as: "agent"}`. The menu bar shows the usual row: "Agent claude, this Mac, says code 482 109". **How often: once per agent name, one click on Approve with the same check as any row, never again.** The grant says `as: "agent"` and `for` the person, signed. Until then, every tool call answers in words:

```text
Waiting for the owner. Look for code 482 109 in the fabrika menu bar.
```

Tools are listed at once, from the program table, so adding the line never fails. Remove in the panel works on an agent as on a window.

**What an agent can do, in one table in the door.**

```ts
// next/packages/libfabrika/src/transport/answer.ts, a sketch. A grant's `as` picks the list. Anything else answers {why: "not_for_agents"}.
const agentMay = ["initialize", "view.open", "window.msg:notes", "ledger.read", "ledger.wait"];
```

- **No tool can grant, approve or remove.** Those are door acts and not program inputs, so no tool is made from them. `door.watch` and `door.deny` refuse `as: "agent"`, and a signature by an agent's key does not count at `/grant`. p27 already refuses any signer outside `founded.keys`.
- **An agent never writes as the person.** `by` is its checked key. `for` comes from its grant. It has no person key, and its tools take no name.
- **Chaos is not listed.** The bridge's program table holds only `notes`, chaos has no inputs, and the door refuses it. An input with `personOnly: true` gets no tool at all; none exists yet, and a law holds it for the first.
- **A retry is one row.** An MCP call has no id, so the bridge makes one from the key, note, base and body. Running the same call again repeats that id, which p53 keeps once.
- **This tier still does not defend against a person's own agents,** as the menu bar's section says. These are the door's rules for an honest client, and each person answers for theirs.

**An agent's "own run", in `next/`.** See biggest call 16. An agent never drives a tile, since a tile is a window onto a process and it has no window Msgs. `runs` only lists what is running. Tier 1 has no desk, so that means processes, and tiles join the list when the desk arrives in Tier 2.

**What moves from today's version, from main at `2c29c13`.** The copies are marked as the styling exception is, read at c7.

| From `packages/fabrika/src/mcp/` | Lines | What happens |
|---|---|---|
| `tools.ts` | 139 | Copied to `next/packages/libfabrika/src/mcp/tools.ts`, about 120 lines. It stays pure. Its three type imports fit `Program`. Renamed as it lands: `toolsOf` to `listTools`, `callOf` to `readCall`, `toolNameOf` to `toolName`, `toolNamesOf` to `toolNames`, `toolInputsOf` to `toolInputs`. Its `Call` moves from `kind` to `_tag`, through `Schema.TaggedUnion`. |
| `drive.ts` | 142 | Its lessons stay: calls one at a time, tiles only as a list, `runs`' shape. Written fresh for `next/` at `mcp/drive.ts`, 70 to 100 lines. `AnyRun`, `memoryStorage` and `run.offer` cannot come. |
| `serve.ts` | 145 | The use of `@modelcontextprotocol/server` stays. Written fresh at `mcp/serve.ts`, 60 to 90 lines, over stdio. No handshake. |
| `handshake.ts`, the bridge's Unix socket, `host/mcp` in `apps/fabrika/src/host/socket.ts` | | **Not copied.** A handshake lets an agent just say its name, with only a file's mode behind it. And today's connected home has no agents' socket at all (`apps/fabrika/src/host/agents.ts`), while real notes live on Cloudflare. |
| `apps/fabrika/src/host/agents.test.ts` | 340 | What applies, about 150 to 200 lines, ported by the test writer. The top bar's count does not apply. |

**The SDK stays in the bridge.** `serveStdio` reads Node's `process`, so `@modelcontextprotocol/server` 2.4.0, already exact in the catalog, is a dependency of `@kampus/libfabrika` that only `./mcp` reaches. It never reaches the top level, the brain or the Worker, and a law checks those bytes. The SDK's async transport and `Effect.runPromiseWith` go on the exam's edge list by name.

**One headless client, shared with the drill.** `mcp/client.ts`, on `@kampus/libfabrika/client`: key file, signed hello, knock, wait for a grant, send, read. It sits in the library, not in `@kampus/tuval/headless`, since the bridge needs it and tuval imports the library, not the other way. It lands in PR D, and PR E's drill uses it instead of its own, which saves 40 to 60 product lines there. A `tuval/headless` memory key stays for tests.

**The size, my own.** 370 to 510 product lines before that saving, 310 to 470 after it, about 120 of them copied. Tests 350 to 500. 4 to 6 agent hours. Why more than a thin command: one input declaration grows, the door learns `as`, and MCP brings its own edges. Sure: 50%.

**Moved up from Tier 5, and what stays.**

| Moved up to Tier 1 | Stays for later |
|---|---|
| A real `as: "agent"` grant, once per name, on one program | The agent box, Tier 5 |
| Tools made from a program's inputs | Spend, Tier 5, and leases, Tier 4 |
| The bridge as a headless client | The `claude` and `codex` programs, and hands running agents, Tier 5 |
| | Work queues and terminal tile, Tier 4; chat tile and asks list, Tier 5 |

**A limit, in one plain sentence.** An agent reaches real notes before the box exists, which is the condition under which the plan said the box might move up. The door's rules keep it to notes, and whether that is enough is for the owner to weigh after real use.

## Chaos monkey

**Known ways I read:**

- [Netflix Chaos Monkey](https://netflix.github.io/chaosmonkey/): randomly ends instances in production on a daily schedule, opt-in per app, with a limit per group and working hours only.
- [Principles of Chaos](https://principlesofchaos.org/): state a steady state first, use real events, automate, keep the blast small.
- [Jepsen](https://github.com/jepsen-io/jepsen): clients do the work, a separate "nemesis" breaks things, a history is recorded, and a checker judges the history later.
- Toxiproxy: latency, down, reset_peer and slow_close as faults on a link, made for test and dev.
- [FoundationDB](https://apple.github.io/foundationdb/testing.html) and [Antithesis](https://antithesis.com/docs/): deterministic simulation. That needs a runtime we do not control, so we borrow the seed only. **Our run is a seeded sequence, not a deterministic simulation:** the same seed gives the same list of faults, not the same interleaving.
- Cloudflare: [`ctx.abort()`](https://developers.cloudflare.com/durable-objects/api/state/) resets an object at once; alarms are at-least-once ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)); stubs can break and should not be reused ([errors](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)).

**Lean: Jepsen's split.** The window and test driver are clients. The `chaos` program is the nemesis's schedule. `chaos:1/inbox` is the history. A pure `check` is the checker. Why: it fits one Elm program and one log, and history readable later is the point. Cost: the program sees only what reached the log (e2e compares against what the clients pressed). Sure: 85%.

**How it gets power without a hole, the Elm way:**

```ts
// next/packages/libfabrika/src/app/nemesis.ts. Nemesis: Jepsen's word, the thing that breaks things on purpose.
export const Fault = Schema.TaggedUnion({
	drop_socket: {client: Schema.String},
	drop_answer: {client: Schema.String},
	delay: {client: Schema.String, ms: Schema.Number},
	abort: {target: Schema.Literals(["gateway", "process", "project"]), name: Schema.String},
	abort_all: {},
	fail_step: {pid: Schema.String},
});
export type Fault = typeof Fault.Type;

export type NemesisCmd = // a Cmd, so it stays on `type`: see Tags
	| {readonly type: "fire"; readonly fault: Fault; readonly tick: string}
	| {readonly type: "check"; readonly pid: string}
	| {readonly type: "now"};

export class Nemesis extends Context.Service<Nemesis, {
	readonly fire: (fault: Fault) => Effect.Effect<Fired>;
	readonly check: (pid: string) => Effect.Effect<Checked, LedgerError>;
}>()("next/Nemesis") {
	/** The off build's Layer. Fire and check answer {why: "off"}. */
	static readonly none: Layer.Layer<Nemesis>;
}
```

- The box does not change: `globalOutbound: null`, no stub in its env. The isolate returns `cmds`. `ProgramRunner` in the process object reads them.
- The wiring (`brain.ts`) holds one table: `{chaos: Nemesis}`. A `fire` from any other program is refused and logged as `bad_cmd`, and the letter stays.
- `Nemesis`'s live Layer is built at wiring, on stubs. It is not in `app/`, so `app/` never imports transport.
- Each object class gets one line, `abort(why) { this.ctx.abort(why); }`, and only in the build with chaos on.

**The faults.**

| Fault | What it tests | Laptop | Cloudflare |
|---|---|---|---|
| `drop_socket` | window comes back, outbox resends | gateway closes with a code | same |
| `drop_answer` | saved, answer lost: the id keeps it once | gateway drops the frame and closes | same |
| `delay` | a slow link is not a lost link | gateway waits before sending | same |
| `abort` one object | wake from the log | `ctx.abort` | same |
| `abort_all` | closest to a brain restart | all objects in the run's list | same; unmeasured |
| `fail_step` | a failure is not a refusal (p25) | the runner fails one step, once | same |
| `kill_brain`, `hang_brain` | process death, a hung brain | the drill: `kill -9`, `SIGSTOP` | none: nothing there can do it |
| redeploy mid-run | old object, new Worker, up to 5 min (exp 144) | none | the drill, by the owner, after a plan |

**Time.** Elm's answer is a Sub on the clock. On workerd it is a deadline that is a pure function of the saved state, the same idea as tea's `durableTimer`: `wake(model)` gives an absolute `at` or null, and the process sets its alarm to it. When it rings, the runner sends a letter with id `tick:<at>`, so at-least-once alarms save once.

**A run.**

```text
start {seed, target, most, gap}   by any client the door let in; the log's own clock starts it, by the `now` Cmd
tick:<at>                         saved first: this is the "asked" fact
did {tick, ok | why}              a letter too. Asked with no did is itself a fact: the fire died with it.
... until `most` is reached, or `stop`
checked {letters, doubled, gaps}  from the victim's stream, through Nemesis.check; the program keeps the summary
```

- **Limits, all in the pure program:** `most` is required, with a floor on `gap`, a run ends itself, the target comes from a list (`counter` and `notes`), `chaos` never targets itself, and `stop` always wins.
- **Why not random forever, as Netflix does?** No steady traffic yet to judge. A run with an end is what a checker can judge. Cost: it is not always on. Sure: 80%.

**What a person sees.** A tile: pick target, seed and length, press start with a plain "this breaks things" line, and stop stays visible while running. A list of faults, each with asked, did and when it recovered. A verdict at the end, in the meaning colors: amber while running, red broken, green done. Filtering the list is window-machine state only.

**Should it exist in production builds?** Build it two ways at build time. The off build has no program, no abort methods and `Nemesis.none`, and a law checks those bytes. **Real notes are `next/`'s first real work, so the real ledger gets the off build from PR D on.** Why at build time: code not there cannot be reached. Cost: two flavors to build. Netflix's "run in production" is an argument for doing it on purpose later, and the way to do that is below. Sure: 85%. The owner settled that chaos never runs on real notes by default.

**Chaos runs on a throwaway ledger.**

```ts
// next/packages/libfabrika/src/app/nemesis.ts, a sketch. `build.ts`, `dev.ts` and the stack read this one value. A union, so
// "chaos on, ledger not named" cannot be said. Off is the default everywhere.
export const Chaos = Schema.TaggedUnion({
	off: {},
	throwaway: {ledger: Schema.TemplateLiteral(["throwaway-", Schema.String])}, // a fresh ledger, gone after the run
	real: {typed: Schema.String},                                               // must equal this ledger's name, or the start stops
});
export type Chaos = typeof Chaos.Type;
```

| Stage | Holds | Build | Who starts chaos |
|---|---|---|---|
| `cloud` | Real notes | Off | Nobody, unless on purpose, below |
| `local`, the app's own | Tests and development | Off | Nobody |
| A temp brain, `--chaos=throwaway` | Nothing kept: a temp folder and a fresh ledger | On | `node next/apps/fabrika/chaos-drill.ts` |
| `drill`, its own Worker and objects | Nothing kept | On | `node next/apps/fabrika/chaos-drill.ts --stage drill` |

**How a person starts a normal run.** `node next/apps/fabrika/chaos-drill.ts` starts the temp brain and founds it with the same keys as the app. The app dials it for that run with `--url`, and the bar says "throwaway". The chaos tile is there, and only there. The drill makes some notes and counter presses first, so a run has text to protect. Then it stops the brain and removes the folder. On the cloud: the owner reads `alchemy plan --stage drill` and says yes, the run goes the same way, and `alchemy destroy --stage drill` removes it afterward.

**How a person runs it on real notes, on purpose.** Only by a deploy with the ledger's name typed out:

```text
alchemy plan --stage cloud --chaos=real:<the ledger's name>
```

The owner reads the plan and says yes. The tile then shows one red line, "This is your real ledger", and when the run is done, a plain deploy puts the off build back. Why a deploy, not a button: it takes a plan, a yes and a typed name, so a slip cannot do it. Cost: two deploys. A wrong name stops the start. Sure: 80%.

## Packages

**The answer:** `next/` becomes real packages in the same pnpm workspace, with real names from day one, by the owner's call. Why, cost and how sure: biggest call 17.

```text
next/packages/libfabrika   @kampus/libfabrika: transport, data, coordination, app, as folders; platform code on subpaths; /mcp holds tools and the bridge
next/packages/tuval        @kampus/tuval: desktop and window folders; platform-free core at the top; /browser, /electron, /headless, /dom on subpaths
next/programs/notes        @kampus/notes: one package per program, . and ./window
next/programs/counter      @kampus/counter
next/programs/chaos        @kampus/chaos
next/apps/fabrika          @kampus/fabrika: only wiring and the deploy stack: entries, brain.ts, dev.ts, launchd start, alchemy.run.ts
```

**Fabrika is the logic, and Tuval is the projection of it.** Settled by the owner (biggest call 19).

- **`@kampus/tuval` holds everything a client does:** dialing, the waiting screen, drawing tiles, folding to size, the prefix keys when they come, the menu view, the `PersonKey` and `PersonCheck` services, and the `dom`, `browser`, `electron` and `headless` parts on subpaths. So the tray, the panel, the keys, Touch ID and the founding screen live in `tuval/electron/`.
- **`next/apps/fabrika` holds what starts things:** `entry/*`, `brain.ts`, `table.ts`, `launchd.ts` (the start), `build.ts`, `dev.ts`, `grant.ts`, `chaos-drill.ts`, `mcp.ts`, `alchemy.run.ts`, and the end-to-end test. It picks Layers and hands them in. If a file there holds a decision, it moves.
- **Tuval may import `@kampus/libfabrika`, and never the other way.** The layer rules and p65 hold it. The law "kill the app and the counter keeps working in other windows" stays, as p48.
- **Where "dialing" stops.** `transport/link.ts`, the wire's own state machine, stays in the library, since the MCP bridge is a client and dials too, and it can't import tuval. Tuval's window opens the socket, runs that machine and shows the waiting screen. So does `mcp/client.ts`, with no screen. Sure: 75%. The doubt is whether the owner meant the link too; if so, the bridge needs its own, or a lower package.

**Tier 1 needs no desk process (biggest call 20).** Layout, focus and later workspaces are a program under W1: `next/programs/desk`, built in as `fabrika/desk`, arriving in Tier 2 with split and close. It uses the same Cmds as any program, and any start or monitor power it needs comes with a grant. Until then:

```ts
// next/apps/fabrika/src/entry/views.ts, a sketch. Wiring. One constant, handed to the window with the view table.
// PR 223's two counters at T0. T18 adds notes, and T12 adds chaos.
export const layout: Split = {dir: "row", parts: [
	{percent: 50, inner: {id: "t1", shows: "counter:1", keep: "failed"}},
	{percent: 50, inner: {id: "t2", shows: "counter:2", keep: "failed"}},
]};
// next/packages/tuval/src/desktop/layout.ts keeps Split, Tile, isTile and tilesIn. `fold` still reads them.
// window/machine.ts: `focus` is in the window's model, and `opened` comes from tilesIn(layout), not from a DESK view.
```

Nothing is lost. A focus move was never kept for its own sake, and PR 223's `desk:owner` log holds no one's real data. The desk's first letter in Tier 2 starts its own log.

- **One workspace.** The root `pnpm-workspace.yaml` gains `next/packages/*`, `next/programs/*` and `next/apps/*`. One lockfile, one catalog, exact pins. Everything stays private at 0.0.0, and nothing is published.
- **Names.** Today's library is `@kampus/fabrika-old` and today's app `@kampus/fabrika-app-old`, from PR 229. When today's version retires, its `-old` packages are deleted, and no rename happens. `@kampus/pipeline` stays until the pipeline is rebuilt here, in Tier 6. `@kampus/notes`, `@kampus/counter` and `@kampus/chaos` clash with nothing, since today's programs are `@tea-fabrika/*`.
- **The Cloudflare names follow.** The Worker and stack are `fabrika`, not `fabrika-next`, and the launchd label is `fabrika.brain`. Why now: from PR D a Worker holds real notes, and renaming one that holds objects is not worth doing later. Sketches keep short `next/` service tags; a real tag takes its package's name.
- **Where a short path starts.** `transport/`, `data/`, `coordination/`, `app/`, `mcp/`: in `next/packages/libfabrika/src/`. `desktop/`, `window/`: in `next/packages/tuval/src/`. `tuval/browser/` and its siblings: `next/packages/tuval/src/browser/`, the path that matches the import `@kampus/tuval/browser`. `programs/notes/`: `next/programs/notes/src/`, and the same for each program. `brain.ts`, `entry/`, `launchd.ts`, `table.ts`: in `next/apps/fabrika/src/`. `build.ts`, `dev.ts`, `grant.ts`, `chaos-drill.ts`, `mcp.ts`, `alchemy.run.ts`, `e2e.ts`: in `next/apps/fabrika/`.
- **Inside a package, parts import by relative path. Across packages, by name only,** through an `exports` map, as today's packages do.

```jsonc
// next/packages/libfabrika/package.json, a sketch. Sure of the shape: 80% (biggest call 18).
"sideEffects": false,
"exports": {
	".": "./src/index.ts",                   // the app layer's names, no platform: what a program may see
	"./transport": "./src/transport/index.ts", // no platform; for tuval's named exception and wiring
	"./coordination": "./src/coordination/index.ts", // no platform; for wiring
	"./data": "./src/data/index.ts",         // no platform; for wiring
	"./workers": "./src/workers.ts",         // the object classes; `cloudflare:workers`
	"./box": "./src/app/entry.ts",           // `entrypoint`, what the box loads; `cloudflare:workers`
	"./sqlite": "./src/data/sqlite.ts",      // `Ledger.sql` on node:sqlite, for tests
	"./mcp": "./src/mcp/index.ts",           // tools and the bridge; Node and the SDK
	"./client": "./src/mcp/client.ts"        // the headless client; Node
}
// next/packages/tuval/package.json: "." the desktop core and the window's names; "./page" the page and its style;
//   "./browser", "./electron", "./headless", "./dom". Its dependencies list @kampus/libfabrika. libfabrika's never list tuval.
// next/programs/notes/package.json: "." "./src/program.ts", "./window" "./src/view.tsx". Nothing else.
```

**What notes needs, as the library's first customer.** A missing tool shows up as an import that doesn't resolve. That is the pipeline's lesson (`docs/direction/where-each-piece-lives.md`), and it stops the builder at the door, not after the fact.

```ts
// next/programs/notes/src/program.ts: the box's side. The whole list.
import {defineProgram, type Input, type Letter, type Program, type Refusal, Saw} from "@kampus/libfabrika";
import {Cmd, defineMachine} from "@demlik/tea";

// next/programs/notes/src/view.tsx and tile.ts: the window's side. The whole list.
import {type Handle, send, useModel, type ViewProps} from "@kampus/tuval"; // ViewProps: data, press, and read for ledger.read
```

`Letter` and `LedgerError` reach the top level because the app layer says them again, as [Strict layers](#strict-layers) already has it. T16 proves this list: if notes needs one more name, the name is added on purpose and the PR says so.

**No program has an `entry.ts`, so a package stays `.` and `./window`.** Today each program has nine lines that only say "this, as Worker Loader takes it". `build.ts` makes that line instead, and it is the one place that knows about Cloudflare:

```ts
// next/apps/fabrika/build.ts, a sketch. esbuild's `stdin`. A program never imports `cloudflare:workers`.
const box = (pkg: string, name: string) => forWorkerd(`
	import {entrypoint} from "@kampus/libfabrika/box";
	import {${name}} from "${pkg}";
	export const Program = entrypoint(${name});
	export default {fetch: () => new Response("${name}; call its entrypoint")};`);
```

Why: a program package is the shape a pack has, and it should not know its host. Cost: about 8 lines, against 9 per program. Sure: 80%.

**The tables move to wiring, since the library and tuval name no program.** The program table goes from `app/process.ts` to `table.ts`, handed in through `ProgramLoader`. The view table goes from `window/main.tsx` to `entry/views.ts`, handed in as a prop. Only the app imports `@kampus/notes/window`.

**A law: `next/` stands alone (p65).** No `package.json` under `next/` may depend on anything ending in `-old`, or on any workspace package outside `next/`. **That alone does not make an import fail, so the law has a second half.** The root `package.json` depends on today's library, `@kampus/pipeline` and every `@tea-fabrika/*`, so an import from `next/` walks up to the root's `node_modules` and resolves. So `layers.test.ts` keeps the slice's check: an import in `next/` names a package its own `package.json` lists, and never one outside. A relative path out is `relative-import-crosses-workspace` in `boundary-rules.json`. Cost: about 25 lines of test. Sure: 90%.

**The root scripts, checked by reading.**

| Script | Reaches `next/`? | What it needs |
|---|---|---|
| `pnpm typecheck` (`pnpm -r`) | Yes | A `typecheck` script and a `tsconfig.json` in each package |
| `pnpm test` (`vitest run`) | Only with new globs | `next/packages/*/src/**/*.test.{ts,tsx}`, and the same for `next/programs/*` and `next/apps/*` |
| `lint:layers`, `lint:boundaries`, `lint:dead` (`code-graph .`) | Yes | `layer-rules.json` rows, and `boundary-rules.json` rows for each package |
| `lint:browser` | No, today's library only | p65's bundling law does this job here |

Each `tsconfig.json` extends `tsconfig.base.json` and is a few lines. `@kampus/libfabrika`'s has no DOM lib; tuval's, each program's and the app's add DOM and JSX.

**The two doubts, and what each forces. I read both; neither was run, since this plan runs nothing.**

- **code-graph's dead-export check forces no change of layout.** In 0.12.0's source, any file named in `exports` counts as public, and its exports are never dead. Today's `packages/fabrika` works the same way. So an unused public name goes unflagged, and "first customer" only catches a missing name, not a spare one. The way out: each PR prints `code-graph . --interface-width`, which lists exports with no outside user, and someone reads it. It blocks nothing, since no bar is measured. Sure: 80%.
- **esbuild across packages forces two small things.** `exports` pointing at `.ts` already bundles by name in `experiments/173-worker-loader`. But esbuild keeps a module whose top level calls something, and `Schema.Struct(...)` counts. So each package sets `"sideEffects": false`, and `.` stays small, or a program's box drags in every layer. And `build.ts` takes the generated entry above. A change to used library code gives a program a new hash, the same as with folders. Sure: 80%.
- **T0 runs both first.** If either is off, stop and tell the owner.

**What moves from PR 223's slice.** One commit of `git mv` plus import fixes, T0, before T1, so the rest of PR A reads as change and not as move.

| At `7c1d073` | Goes to |
|---|---|
| `next/src/{transport,data,coordination,app}/` | `next/packages/libfabrika/src/` |
| `next/src/{desktop,window}/` | `next/packages/tuval/src/` |
| `next/src/programs/counter/entry.ts` | Deleted, for the generated entry |
| `desk-entry.ts` and the program half of `desk.ts`, in `next/src/` under `desktop` | Deleted in T0's second commit. Their types go to `desktop/layout.ts` |
| `next/src/programs/counter/{program.ts,view.tsx}` | `next/programs/counter/src/` |
| `next/src/brain.ts`, `next/src/workers.d.ts` | `next/apps/fabrika/src/` |
| `next/{dev,build,e2e,brain-host}.ts`, `next/docs/` | `next/apps/fabrika/` (`brain-host.ts` goes in T6) |
| `next/src/layers.test.ts` | `next/apps/fabrika/src/exam/` |
| `next/package.json` (`@fabrika/next`), `next/tsconfig.json` | Replaced by six of each |
| `next/README.md` | Stays, as the map of the six |

**T0's second commit: the desk leaves.** The first commit only moves. The second takes the desk program out, as the sketch above shows, and drops the lines in `e2e.ts` that check focus moving in both windows (lines 247 to 255). That check comes back with the desk in Tier 2, and it is the one thing Tier 1 gives up from the slice.

Sure: 90%. The doubt is PR 223 itself: this plan reads it at `7c1d073`, so a later push changes this table.

## Platform pieces

**What I read:** `@effect/platform-node` 4.0.6 and `@effect/platform-browser` 4.0.6 source. The core defines the services (`effect/socket/Socket`, `effect/FileSystem`, `effect/Runtime`). A platform gives Layers, one module per service, and a `runMain`. Node has a `NodeServices` union plus `layer`, and shared code in `platform-node-shared`. Browser has no aggregate. Effect publishes no Electron platform.

**Effect's shape, in one package.** `@kampus/tuval` has a platform-free core at the top and one subpath per platform, as [Packages](#packages) shows. A bundling law still proves the core is platform-free, since `package.json` does not stop a Node import at a top level.

```text
next/packages/tuval/src/dom/         shared, like platform-node-shared: DOM screen, clipboard, the page's frame
next/packages/tuval/src/browser/     the Layers for a tab
next/packages/tuval/src/electron/    the Layers for a window's page and the app: keys, Touch ID, tray, panel, preloads, founding, what the menu's Cmds do
next/packages/tuval/src/headless/    the Layers for tests: no DOM, a memory key, an array for a menu
next/apps/fabrika/src/launchd.ts     starts the brain, the BrainService Layer
next/apps/fabrika/src/entry/         wiring: browser.tsx, electron.tsx, and electron-main.ts, the app's main process, which picks Layers and starts them
```

```ts
// next/packages/tuval/src/desktop/services.ts, the core. No platform.
// Grows only when a Layer really provides a new one. The wire keeps plain strings, since other hosts add words.
export type Capability = "screen" | "touch-id" | "keychain" | "open-link";

export class Host extends Context.Service<Host, {
	readonly platform: "browser" | "electron" | "headless"; // a plain field, and the hello's `platform`
	readonly has: ReadonlyArray<Capability>; // what this host can do; the hello sends it
	readonly cannot: ReadonlyArray<string>; // W5
	readonly tab: string;
}>()("next/Host") {}

export class Screen extends Context.Service<Screen, {
	readonly size: Effect.Effect<Size>;
	readonly resized: Stream.Stream<Size>;
}>()("next/Screen") {}

export class ClientKey extends Context.Service<ClientKey, {
	readonly publicKey: Effect.Effect<string, KeyDown>;
	readonly sign: (hello: {readonly nonce: string; readonly url: string; readonly tab: string}) => Effect.Effect<string, KeyDown>;
}>()("next/ClientKey") {} // desktop imports only app, so this is a plain shape, the same as transport's HelloBytes

export type WindowServices = Host | Screen | ClientKey | Socket.WebSocketConstructor;

// next/packages/tuval/src/browser/index.ts
export const layer: Layer.Layer<WindowServices> = Layer.mergeAll(
	Layer.succeed(Host, {platform: "browser", has: ["screen"], cannot: ["Mod-W", "Mod-T", "Mod-N", "Mod-Q"], tab: tabId()}),
	domScreen,                                 // tuval/dom
	webCryptoKey,                              // IndexedDB, extractable: false
	BrowserSocket.layerWebSocketConstructor,
);
export const runMain = BrowserRuntime.runMain;

// next/packages/tuval/src/electron/index.ts
export const layer: Layer.Layer<WindowServices> = Layer.mergeAll(
	Layer.succeed(Host, {platform: "electron", has: window.fabrika.has, cannot: ["Cmd-Q", "Cmd-H"], tab: tabId()}), // main works out the list at start
	domScreen,
	bridgeKey,                                 // window.fabrika, through the preload
	BrowserSocket.layerWebSocketConstructor,   // the page is Chromium
);
export const runMain = BrowserRuntime.runMain;

// next/apps/fabrika/src/entry/browser.tsx: three lines, and electron.tsx differs only in its import
windowApp.pipe(Effect.provide(layer), runMain);
```

**Same on all:** machine, link, wire, fold, views, frame, styles. **Different:** `has`, `cannot`, where the key lives, and the process edge.

**What each Layer says it can do.** `Host` replaces `Backend`. A host is a place hands can run: a Mac, a VM or a browser profile. `has` is its capabilities, and it lists only what this Layer really provides. The words above are the real list for Tier 1, so `clipboard` and `notify` wait until a Layer provides them.

- **browser:** `screen`, from `domScreen`.
- **electron:** `screen`, plus three named extras. `touch-id` is `PersonCheck`, listed only where `canPromptTouchID` is true. `keychain` is `PersonKey` and the window key, listed only where `safeStorage` can seal. `open-link` is main handing a link to the person's browser. Their services stay. The names only tie them to `has`.
- **headless:** none. A test hands in the list it wants. The bridge is an agent, not a host, so its hello says `has: []`.
- **The list comes from the Layer, and the hello carries it (p66).** Main works out Electron's list at start and hands it over through the preload, and the menu bar's link sends the same list. Nothing reads `has` yet, and `door/hellos` records it. In PR A a tab has no Layer until T7, so its hello says `has: []`. No real ledger exists before PR D, so nothing is lost.
- **A word says "can", never "may".** A client can claim anything. Whether it may do something is a grant.
- **Not in Tier 1:** a queue, leases, or a tab that runs a job. They are in Tier 4.

**The Elm answer.** Flags at start and ports: the machine knows `sign` and `send_text` as Cmds and socket and size as Subs. The Layers are the runtime that does them. No new tea abstraction, and tea stays small.

**The window in React.** React 19.3.1, from a study with probes on Chromium 156. Strict Mode is on. One `useSyncExternalStore` hook reads the Effect engine, with `memo` per tile. No tea `useMachine`: it dies under Strict Mode.

```tsx
// next/packages/tuval/src/window/use-model.ts, a sketch. All three arguments, or headless throws. Dispatch is a one-line edge.
export const useModel = (h: Handle) => useSyncExternalStore(h.subscribe, h.getState, h.getState);
export const send = (h: Handle, m: Msg) => Effect.runFork(h.dispatch(m).pipe(Effect.ignore));

const Tile = memo(TileView); // Elm's Html.Lazy
<Tile key={t.id} tile={t} view={m.views[t.id]}>
	{t.folded ? <Strip tile={t} /> : null}
	<Activity mode={t.folded ? "hidden" : "visible"}>   {/* mode comes from the model */}
		<ProgramView tile={t} />
	</Activity>
</Tile>
```

- **`useEffectEvent`** for reads an effect must not depend on. It ends the `exhaustive-deps` fight.
- **`<Activity>` for hidden tiles.** A hidden tile keeps its state. Focus is not restored by React, so a layout effect sets it from the model on reveal. A socket stays a tea Sub, outside React.
- **The model keeps references for parts that did not change,** or `memo` does nothing.
- Why: the probe gave 1 tile render per patch against 16, and dispatch to DOM at p95 0.3 ms on a tiny model. It is the Elm answer. Cost: one small hook, and one wrapper per tile. Sure: 90% on the hook, 85% on `<Activity>`, whose memory with many hidden tiles is not measured.
- **Not decided:** native `<dialog>` and `popover` against Zag. Tier 1 needs neither, so it is left out and stays open for later.

**New dependency:** `@effect/platform-browser` in the catalog. Not installed today; I read it by `npm pack`, outside the repo. Why: rely on Effect, not a handwritten socket. One gotcha from its source: every close fails the socket's reader with `SocketError`, so the Sub maps that to the `closed` Msg, which today's handwritten Stream does by hand.

## Electron window

- **The page comes from the brain.** Main calls `loadURL(url + "/electron")`, so the origin check passes as a tab's does. No custom scheme, and no second copy of the page.
- **The app starts the brain,** as [a plain launchd service](#the-menu-bar). `dev.ts` runs Alchemy's local stage, under launchd for the person and by hand for agents and tests. If the brain is down, main shows plain words and retries on a `Schedule`. Settled by the owner. Sure: 75%, for the spike.
- **Which stage it dials:** `<home>/stage.json` from PR D, [as Notes says](#notes). With no file, local. `--url` points at another stage for one run, for agents, tests and the drill.
- **The founding screen and the panel come from local files,** since the first runs before a brain exists and the second must never come from the brain's page. Each gets a small preload of its own.
- **Security flags as in today's `apps/fabrika/src/main.ts`:** `sandbox: true, contextIsolation: true, nodeIntegration: false`; `titleBarStyle: "hiddenInset"`, traffic lights at `{x: 14, y: 11}`; new windows denied; navigating off the brain's origin blocked.
- **A small preload after all.** I first leaned to none, but the key in the note's T3 forces one. `contextBridge` gives `publicKey()` and `signHello({nonce, tab})`. Main builds the bytes itself, so the page cannot get arbitrary text signed. It also gives `has`, the list main worked out at start. `ipcMain.handle` checks `senderFrame`'s origin.
- **The keys.** Main makes two Ed25519 keys with Node's WebCrypto: the person key and the window key. Each private half is sealed by [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)'s async API and kept in `userData`. The sync API is on its way out, "will be removed in Electron 46"; the catalog has 45.0.0. Async means one-line edges in the key files. The person key is read only when it signs. The window key is read on every open.
- **If the Keychain still asks when opening fabrika,** the plan does not stop. The window key moves to a browser-style WebCrypto key: not extractable, in IndexedDB, in a small hidden page from a local file. Main forwards sign calls to that page, so `window.fabrika` and the menu bar's link do not change. The person key stays sealed, since a prompt at Approve is fine. Why a hidden page: main has no IndexedDB, and the window may be closed. Cost: about 40 lines. Sure: 70%. Whether IndexedDB holds such a key in a local page is a guess, and T8's spike tries it.
- **Platform defaults:** Mac close keeps it running, Cmd-Q quits and stops the brain, activate reopens.
- **Tests:** Playwright's `_electron.launch`, as today's `apps/fabrika/e2e.ts` does, with a temp home and a test `PersonCheck`. A mock keychain flag may be needed. This is a guess. T8 settles it.

## Cloudflare

**The stack.** New `next/apps/fabrika/alchemy.run.ts`, one file for both stages. `brain-host.ts` goes away.

```ts
// A sketch, on Alchemy 2.0.0-beta.84, the names in exp 147 and today's packages/ledger-server/src/stack.ts.
export default Alchemy.Stack("fabrika", {providers: Cloudflare.providers(), state: Alchemy.localState()},
	Effect.gen(function* () {
		const brain = yield* Cloudflare.Worker("Brain", {
			name: "fabrika",
			main: "dist/brain.mjs",
			bundle: false,                        // served byte for byte on both stages
			compatibility: {date: DATE},
			observability: {enabled: true},
			dev: {host: "127.0.0.1", port, strictPort: true},
			env: {
				GATEWAY: Cloudflare.DurableObject("Gateway"),
				PROCESS: Cloudflare.DurableObject("Process"),
				PROJECT: Cloudflare.DurableObject("Project"),
				LOADER: Cloudflare.WorkerLoader(),
				STAGE: JSON.stringify(stage),      // under 5 KB; a public key, no secret
			},
		}).pipe(RemovalPolicy.retain());
		return {url: brain.url};
	}));
```

- **Does Worker Loader need anything on the account?** Yes, one thing: Cloudflare's plan must include Dynamic Workers ([docs](https://developers.cloudflare.com/dynamic-workers/)), and the account's plan does. Our `hash:pid` id is stable, so only a new build counts as a new one.
- **The address:** Cloudflare's default address for a Worker. Why: no DNS to set up, and the door does the same job. Cost: a domain later means a new origin, so each browser asks again; the ledger's name stays a stable id, so grants stay good. Sure: 85%. Settled by my call, as the owner asked.
- **The approval flow is the same here.** PR C gives the menu bar a second link, to the cloud stage, and each row says which stage it is from. `founded` on the cloud ledger names the same person key and window key, read from the app's home at deploy. The one-time link works here too. Remove works here too. When `stage.json` says `cloud`, the app starts no local brain and keeps only the cloud link.
- **A waiting row and a sleeping object.** The project object sleeps after about 10 s, and waiting keys live in its memory. So a waiting tab repeats `door.knock` every 5 s, which keeps the object awake only while someone waits. Cost: a little object time on the cloud. Sure: 70%. T11 measures it.
- **Commands:** the app for a person, `node next/apps/fabrika/dev.ts` for agents and tests. For cloud, `alchemy plan --stage cloud`, the owner reads it, then deploy after their yes, and `drill` the same way. No builder runs either. Never `Alchemy.remote()`.
- **Local wording.** Alchemy's local stage runs workerd through its own runtime and a TCP relay (exp 171), not the `miniflare` package. All wire tests spawn `dev.ts`, so one runtime is under test. Exp 171's lean was to keep tests on Miniflare; I argue against it, because the owner's rule is one stack. Cost: start 1.2 to 1.4 s, 395 MB against 0.3 to 0.4 s, 285 MB. Sure: 75%. Doubt: load on the laptop; run with `--maxWorkers=3`, and if a suite takes over 3 minutes, share one brain per file.
- **Differences to expect, and where each is watched:**

| Difference | Source | Watched by |
|---|---|---|
| Objects sleep alone after about 10 s; wake 100 to 300 ms | exp 144 | p41's numbers |
| Redeploy: a busy object keeps old code up to 5 min | exp 144 | `code` fact on each hello; the versions from the note's T4 refuse a mismatch |
| Isolate cold load on Cloudflare | never measured | p41 records it first time |
| `limits: {cpuMs}` is enforced there, not locally | exp 173, [docs](https://developers.cloudflare.com/dynamic-workers/usage/limits/) | not set in this pass: no measured number |
| Real alarms, at-least-once | Cloudflare docs | p35, p39 |
| `kill -9` does not exist | | fault table above |

- **`DO_NOT_TRACK=1`** in every Alchemy call, and stop by process group with the guard from exp 171, since killing Node orphans workerd.

## What fact is lost forever if we don't record it now

**Recorded from day one:**

- `by`: the checked key's fingerprint, stamped at the door. Anything the params say is dropped. The person behind it folds from the grant, which is kept forever.
- `granted` and `revoked`: the signed text and the signature whole, in `door/members`. So anyone can re-check them later, with no trust in the door.
- `saw` on each grant: code, label, where, how and `has`, plus `check`. What the person looked at when they said yes exists only at that moment. The label and where are recorded, never trusted.
- `saw.check`: `"touch"`, `"click"` or `"none"`. **It is kept in Tier 1 because of the later-tiers check:** once other `PersonCheck` versions arrive, no old grant could say how its person was checked. Cost: one field.
- `saw.has`: what the host claimed when the person said yes. It exists only at that moment. It's recorded, never trusted, and the row doesn't print it in Tier 1. Cost: one field.
- `as: "window" | "agent"` on each grant. Later rules need it, and an old grant could never tell.
- `denied`, with what the person saw. A Deny is a person's act, so it costs nothing to keep.
- `founded.keys` as a list, and `founded.window`.
- `door/hellos`, one fact per online hello: key, tab, platform, versions, has, nonce, signature, `said`, `where`, brain code hash. Why: which window on which code at which moment exists only then. Cost: one append per connect. Refused hellos write nothing, so an unknown key cannot fill the log.
- `started` gains the brain's build hash, and each letter's fold can name the program's hash. A chaos letter's `tick`, seed, target, asked and did.
- `saw` on a letter (the slice has it for counter) and `said`, kept out of deciding code's types.
- **On each note's save:** `base`, since which version a writer worked on exists only then. `body` whole and raw, every time, since a version is never overwritten. `how`, since "kept from a stale screen" cannot be worked out later, and `from`, since nothing else ties a kept note to its source. The letter's `by`, `at`, `said` and `saw` come with it, using the plan's existing fields: who wrote it, the log's clock, their own clock, what they had seen. **New on every letter: `for`, the person the writer works for,** from the checked grant, so a fact names both the agent and its person with no fold. The agent's name is its grant's `saw.label`, recorded and shown to the person at Approve. `said` stays out of deciding code's types, and `refuse` sees only the Msg. Cost: one full body per save, about 500 small rows a day at most, a guess.
- **On each `revoked`:** what the person saw and the check, inside the signed text, the same as a grant.

**Can wait, since they rebuild from the log:** durations, recovery times, verdict tables, any view, a note's version number and name, the list's order, a diff between versions, a note's drawn blocks and code colors. `check` is itself a fold, so a better checker later re-judges old runs.

**Written down as lost, on purpose:** who was refused or knocked and never got an answer. Their codes live in memory only, and a refusal count goes to the Worker's logs only. Why: writing it would let anyone grow the log. Sure: 80%. Also lost: a one-time link nobody used. It granted nothing, and a used one shows in its grant as `how: "link"`.

**Also lost, on purpose, with notes:** a refused save, because a refused save writes nothing. Its text stays on that screen until the person keeps it or drops it. Text typed and never saved is lost if that window dies. Why: a keystroke log is a different program, and a person's half-typed words should not sit in a log forever. Which tab of a browser saved is not recorded, only the key. A tool call's own words are not recorded, only its save. Sure: 75%. The doubt is whether a count of stale refusals is wanted while it is in early use; it can go to `field/` by hand if the owner asks.

## Topic and `keep`

- **`Topic`: not in this pass.** The note's open lean was a Topic so a program can read outside its inbox. Here a program's facts live in its own stream, and watchers go through an injected service. A later Topic reads the same streams, so no fact is lost. Sure: 85%. Chaos's `check` goes through `Nemesis.check`, so it never holds the log. Notes fold one inbox, so they need no Topic either.
- **`keep`:** not now. Filters stay in the window's machine, and so does which note is open. The tracker settles it. No fact lost.

## Strict layers

Packages draw some lines now, and these still draw the rest, including the strict one-layer-down rule (A3c). Two checks go strict in the exam PR. `layer-rules.json` gets `next/` layers, so code-graph's `pnpm lint:layers` fails an upward import. `next/apps/fabrika/src/exam/layers.test.ts` stays small and catches only what code-graph cannot yet: an import that skips a layer, and p65's import names. Its skipped-layer half goes when demlik issue 763 lands. Why: the known tool first, and a small test only for its gaps. Cost: about 12 rows in a rules file, and a test that has a known end. Sure: 90%.

```json
// layer-rules.json, a sketch. Top to bottom; a layer may import only what is below it.
"next-apps": ["next/apps"],
"next-programs": ["next/programs"],
"next-tuval": ["next/packages/tuval/src/browser", "next/packages/tuval/src/electron", "next/packages/tuval/src/headless"],
"next-tuval-shared": ["next/packages/tuval/src/dom"],
"next-window": ["next/packages/tuval/src/window"],
"next-desktop": ["next/packages/tuval/src/desktop"],
"next-mcp": ["next/packages/libfabrika/src/mcp"],
"next-app": ["next/packages/libfabrika/src/app"], "next-coordination": ["next/packages/libfabrika/src/coordination"],
"next-data": ["next/packages/libfabrika/src/data"], "next-transport": ["next/packages/libfabrika/src/transport"]
```

```ts
// next/apps/fabrika/src/exam/layers.test.ts: what each one may import. A folder in the same package by name,
// another package by its import name, so the exports map carries the rule across.
const allowed = {
	transport: [],
	data: [],
	coordination: ["data"],
	app: ["coordination"],
	mcp: ["app", "transport"],                 // the named exception: the bridge is a client, as a window is
	desktop: ["@kampus/libfabrika"],           // the app layer's names, nothing lower
	window: ["desktop", "@kampus/libfabrika", "@kampus/libfabrika/transport"], // layer 5; transport is the named exception, a window is a client (the note's T3)
	dom: ["desktop"],
	browser: ["dom", "desktop", "@kampus/libfabrika/transport"], // the same exception: its key signs transport's helloText
	electron: ["dom", "desktop", "@kampus/libfabrika/transport", "@kampus/libfabrika/coordination"], // the same exception: the menu bar signs what the door takes
	headless: ["desktop"],
	program: ["@kampus/libfabrika"],           // `.`, what the box loads: no tuval and no React
	"program-window": ["@kampus/libfabrika", "@kampus/tuval"], // `./window`: public names only
};
// next/apps/fabrika has no row and may import all of it: it is the wiring.
// Across the whole of @kampus/libfabrika, nothing may import @kampus/tuval, a program or the app. The list above never allows it.
```

- Today `app/process.ts` imports data and transport. That goes: `WatcherManager` is an interface in `app/`, its Layer is at wiring, and `Mailbox.receive` yields `Letter`, not `Entry`. `LedgerError` reaches `app/` through coordination, which exports it again, so `app/` never imports `data/`.
- App's view takes `views` as a prop, so `desktop` does not import `programs`.
- Crypto sits in `transport/`. The door at wiring verifies and then calls `ClientManager`, so coordination never verifies.
- `programs/notes/root.ts` and `drawn.tsx` import only `effect`, React and npm packages. `mcp/tools.ts` is pure and reads only `Program`.
- `desktop/menu.ts` only returns Cmds as data. `tuval/electron/menu-cmds.ts` does them: it uses `grantText` from `@kampus/libfabrika/coordination` and `writeSshsig` from `@kampus/libfabrika/transport`, and the `PersonKey` Layer gives only raw signatures. That is `tuval/electron`'s named exception, since doing them is client logic and not wiring. `entry/electron-main.ts` only starts it.
- **A package's bundling law stays.** `package.json` does not stop a Node import at a top level, so p65 bundles each top level for a browser, as today's `lint:browser` does.

## Tags

**The answer:** every union we define is tagged with `_tag`, Effect's own key, and Effect Schema writes it. Nobody writes it by hand. Settled by the owner. `kind`, `is`, `where`, `use` and the rest stop being tag keys. This plan proposes that `kind` on ledger entries becomes `_tag` too. That part settles when the owner approves this plan, and ticket 32 tracks it.

```ts
// A sketch, on effect 4.0.6.
export const Fault = Schema.TaggedUnion({
	abort: {target: Schema.Literals(["gateway", "process", "project"]), name: Schema.String},
	abort_all: {},
});
export type Fault = typeof Fault.Type;

const fault = Fault.cases.abort.make({target: "gateway", name: "counter:1"}); // the maker fills in `_tag`
Fault.guards.abort(fault);                                                    // true
Fault.match(fault, {abort: (f) => f.name, abort_all: () => "all"});           // must name every case
JSON.stringify(fault);                                                        // {"_tag":"abort","target":"gateway","name":"counter:1"}

const Send = Schema.TaggedStruct("send", {m: Schema.Unknown});                // a lone case
class KeyDown extends Schema.TaggedError<KeyDown>()("KeyDown", {why: Schema.String}) {} // errors, for catchTag
```

| Shape | Its key | Why |
|---|---|---|
| A union we define: states, menu rows, faults, stages, facts, wire messages we own | `_tag`, through the schema tools | Makers, `match` and guards come with it |
| A tea Msg or Cmd | `type` stays. Do not "fix" it. | tea's engine reads `msg.type` |
| Someone else's shape: JSON-RPC's `method`, JSON Patch's `op`, mdast's `type`, MCP's fields, the HTTP `Host` header | Its own | It is not ours to rename |
| A plain field, on a struct with the same fields every time | A plain word: `Host.platform`, `Saw.where`, `Who.as` | Nothing picks a shape by it, so it is no tag |

- **Which tool.** `Schema.TaggedUnion` for plain data, `Schema.TaggedStruct` for a lone case, and `Schema.TaggedError` for errors: `KeyDown`, `BrainDown`, `LedgerError`, `ProgramDown`. `Schema.TaggedClass` only when a value has its own methods, and nothing in Tier 1 does.
- **A browser reads it as is.** A tagged value is a plain object, so `_tag` on the wire is plain JSON.
- **The rule is `no-hand-tag`,** in [the exam PR](#the-exam-pr-not-in-this-plan). It has one edge, the log.
- **A line holds both words when it holds a Msg.** `{_tag: "send", body: {m: {type: "plus"}}}`: the line is ours and the Msg is tea's.

```ts
// next/packages/libfabrika/src/data/log.ts, a sketch. The log stores any fact and knows no cases, so `Line` holds `_tag` as an open string.
export const toLine = (fact: {readonly _tag: string}, from: {readonly by: string; readonly said: string}): Line => {
	const {_tag, ...body} = fact;
	return {...from, _tag, body};
};
export const fromLine = (line: Line): unknown => ({_tag: line._tag, ...(line.body as object)});
// A reader decodes through its own union. A tag it doesn't know comes back none: it skips the line and keeps it (T4 of the sync-engine note).
const fact = Schema.decodeUnknownOption(MemberFact)(fromLine(line));
```

- **Not tags, for now.** Refusals stay plain data, `{why}`, beside an answer: `{rev} | {why}`, as plan-115 stands. `Input` stays a union on `writes`: it holds a schema and a function, so it is never data. `Split | Tile` arrives from PR 223 as a union by shape, and goes with the desk in Tier 2. Sure: 70%. The doubt is `{why}`: it reads like a tag, and the owner's pick does not name it. The owner's word settles it, and a change costs one schema per answer.

## The public interface

The tests compile against this block and nothing else of the new code. Plan-115's `Ledger`, `LedgerCalls`, `LedgerError`, `ProcessManager`, `CoordinationLayer` and `ProgramDown` carry over as written. These are the changes and additions.

```ts
// next/packages/libfabrika/src/transport/wire.ts
export const Hello = Schema.Struct({
	versions: Schema.Array(Schema.Number),
	has: Schema.Array(Schema.String), // the Host Layer's list. Says can, never may. Nothing reads it yet.
	ping: Schema.Number,
	key: Schema.String,   // Ed25519 public key, raw, base64url
	tab: Schema.String,
	platform: Schema.Literals(["browser", "electron", "headless"]),
	said: Schema.String,  // the writer's own clock; recorded, never trusted
	signed: Schema.String,
});
/** One message read off the pipe. The frame on the wire stays JSON-RPC's. */
export const Message = Schema.TaggedUnion({
	ask: {id: Schema.String, method: Schema.String, params: Schema.Unknown},
	news: {method: Schema.String, params: Schema.Unknown},
	ok: {id: Schema.String, result: Schema.Unknown},
	err: {id: Schema.String, why: Schema.String},
});

// next/packages/libfabrika/src/transport/link.ts: Link moves from `is` to `_tag`, with its two new states.
const Common = {dial: Schema.Number, seed: Schema.Number, ask: Schema.String, tries: Schema.Number};
export const Link = Schema.TaggedUnion({
	dialing: Common,
	hello: Common,
	challenged: Common,
	waiting_grant: Common,
	waiting: {...Common, wait: Schema.Number},
	online: {...Common, ping: Schema.Number, beat: Schema.Number, pongDue: Schema.Boolean},
});

// next/packages/libfabrika/src/transport/hello.ts (new). Pure but for WebCrypto.
export type HelloBytes = {readonly nonce: string; readonly url: string; readonly tab: string};
export const helloText: (h: HelloBytes) => string; // "fabrika-hello\n<url>\n<tab>\n<nonce>"
export const fingerprint: (key: string) => Effect.Effect<string>; // "SHA256:<base64url>"
export const checkHello: (hello: Hello, at: {readonly nonce: string; readonly url: string; readonly name: string}) =>
	Effect.Effect<{readonly key: string} | {readonly why: "bad_signature" | "wrong_name"}>;

// next/packages/libfabrika/src/transport/sshsig.ts (new). Written fresh, on the SSHSIG format; Ed25519 keys only.
export const checkSshsig: (a: {
	readonly text: string;
	readonly armored: string;
	readonly space: "fabrika-client";
	readonly signers: ReadonlyArray<string>; // key lines
}) => Effect.Effect<{readonly signer: string} | {readonly why: "bad_signature"}>;
/** The same shape `ssh-keygen -Y sign` makes. `sign` is the raw Ed25519 signature, from any key holder. */
export const writeSshsig: <E>(a: {
	readonly text: string;
	readonly space: "fabrika-client";
	readonly line: string;
	readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>;
}) => Effect.Effect<string, E>;

// next/packages/libfabrika/src/transport/waiting.ts (new). Pure. Kept in the brain's memory, never written.
export type Row = {
	readonly key: string; readonly label: string; readonly where: string; readonly code: string;
	readonly until: number; readonly tabs: number; readonly pass: string | null; readonly has: ReadonlyArray<string>;
	readonly as: "window" | "agent"; // from door.knock; a claim the person reads, and only their signature makes it true
};
export type Waiting = {readonly rows: ReadonlyArray<Row>; readonly most: number};
/** A key already here keeps its code. A new one takes `code`, and the oldest goes past `most`. */
export const knock: (w: Waiting, k: {
	readonly key: string; readonly label: string; readonly where: string; readonly pass: string | null; readonly has: ReadonlyArray<string>;
	readonly as: "window" | "agent"; readonly code: string; readonly at: number;
}) => Waiting;
export const leave: (w: Waiting, key: string) => Waiting;

// next/packages/libfabrika/src/transport/answer.ts (new): plan-115's, with the door's states.
export const Who = Schema.Struct({key: Schema.String, person: Schema.String, as: Schema.Literals(["window", "agent"])});
export type Who = typeof Who.Type;
export const Attached = Schema.TaggedUnion({
	new: {client: Schema.String, nonce: Schema.String},
	waiting: {client: Schema.String, key: Schema.String, nonce: Schema.String},
	online: {client: Schema.String, who: Who},
});
export type Attached = typeof Attached.Type;
export type Admit<E> = (key: string) => Effect.Effect<Who | {readonly why: "not_granted"}, E>; // transport imports nothing, so E comes from wiring
export const sameOrigin: (headers: {readonly origin: string | null; readonly host: string | null}) => boolean;
export const answerFrame: <E>(
	text: string,
	attached: Attached,
	admit: Admit<E>,
	route: (method: string, params: unknown, who: Who, client: string) => Effect.Effect<Answer, E>,
) => Effect.Effect<{readonly send: string | null; readonly attached: Attached}>;

// next/packages/libfabrika/src/coordination/client-manager.ts (new)
export const Saw = Schema.Struct({
	code: Schema.String,
	label: Schema.String, // what the tab claims; recorded, never trusted
	where: Schema.String,
	how: Schema.Literals(["compare", "link", "command"]),
	check: Schema.Literals(["touch", "click", "none"]),
	has: Schema.Array(Schema.String), // what the host claimed; recorded, never trusted
});
export const Grant = Schema.Struct({
	id: Schema.String,
	key: Schema.String,
	for: Schema.String,   // the person; the signer must be one of their keys
	to: Schema.String,    // this ledger's name
	as: Schema.Literals(["window", "agent"]),
	saw: Saw,
	said: Schema.String,
});
export const grantText: (grant: typeof Grant.Type) => string;
export const Founder = Schema.Struct({name: Schema.String, keys: Schema.Array(Schema.String), window: Schema.NullOr(Schema.String)});
export type Founder = typeof Founder.Type;
/** What the person saw when they removed a window. In the signed text, as a grant's `saw` is. */
export const Took = Schema.Struct({
	label: Schema.String, where: Schema.String,
	how: Schema.Literals(["panel", "command"]),
	check: Schema.Literals(["touch", "click", "none"]),
});
export const Signed = Schema.Struct({text: Schema.String, armored: Schema.String, signer: Schema.String});
export const MemberFact = Schema.TaggedUnion({
	founded: {id: Schema.String, name: Schema.String, keys: Schema.Array(Schema.String), window: Schema.NullOr(Schema.String)},
	granted: {grant: Grant, signed: Signed},
	denied: {key: Schema.String, saw: Saw, by: Schema.String},
	revoked: {key: Schema.String, saw: Took, signed: Signed},
});
export type MemberFact = typeof MemberFact.Type;
/** Pure. Facts in, who belongs out. */
export const foldMembers: (facts: ReadonlyArray<MemberFact>) => Members;
// The same shape as transport's Who. Coordination does not import transport; wiring joins them.
export const admitted: (members: Members, key: string) => {readonly key: string; readonly person: string; readonly as: "window" | "agent"} | {readonly why: "not_granted"};

export class ClientManager extends Context.Service<ClientManager, {
	readonly members: Effect.Effect<Members, LedgerError>;
	readonly write: (fact: MemberFact) =>
		Effect.Effect<{readonly rev: number} | {readonly why: "not_member" | "revoked"}, LedgerError>;
}>()("next/ClientManager") {
	static readonly layer: (founder: Founder) => Layer.Layer<ClientManager, never, Ledger>;
}

// next/packages/libfabrika/src/coordination/mailbox.ts: as plan-115, and receive yields a Letter
export type Letter = {
	readonly id: string; readonly m: unknown; readonly by: string; readonly for: string; readonly said: string;
	readonly rev: number; readonly pos: number;
};

// next/packages/libfabrika/src/app/program.ts
/** Elm's ports, as data. A value on input `x` reaches the machine as the Msg {type: "x", value}. MCP tools are made from them, from PR D. */
export type Input<V> =
	| {readonly schema: Schema.Top; readonly description: string; readonly writes: true; readonly personOnly: boolean}
	// Writes nothing, so it has no letter: the bridge answers from the view it watches. A union, so a write with an answer cannot be said.
	| {readonly schema: Schema.Top; readonly description: string; readonly writes: false; readonly answer: (view: V, value: unknown) => unknown};
export type Ports<V = unknown> = {readonly [name: string]: Input<V>};
export type Program<S, M extends {readonly type: string}, V, C> = {
	readonly name: string;
	readonly machine: Machine<S, M, C>;   // a sketch: tea's type, with this Cmd
	readonly msg: Schema.Codec<M, unknown>;
	readonly view: {readonly data: Schema.Codec<V, unknown>; readonly select: (state: S) => V};
	readonly inputs: Ports<V>;            // required, so every program says what it has, even {}
	readonly outputs: {readonly [name: string]: Schema.Top};
	readonly refuse: (state: S, m: M) => Refusal | null; // PR D. Required too; runs on fresh letters only, never on a fold.
};
/** A program's own no. Comes back to the window as it is. Plan-115's `Refused` {why: "bad_msg"} stays for a bad shape. */
export type Refusal = {readonly why: string; readonly now?: number; readonly most?: number};
export type Stepped<C> = {
	readonly model: unknown;
	readonly view: unknown;
	readonly cmds: ReadonlyArray<C>;
	readonly wake: number | null; // an absolute time, or idle
};
export const stepper: <S, M extends {readonly type: string}, V, C>(program: Program<S, M, V, C>) => {
	readonly init: () => Stepped<C>;
	readonly step: (model: unknown, m: unknown) => Stepped<C> | Refused | Refusal;
	readonly fold: (model: unknown, m: unknown) => Stepped<C>; // PR D: update only, for what the log already holds
};

// next/packages/libfabrika/src/app/runner.ts: plan-115's, with Cmds, the alarm and a failure that is not a refusal
export class ProgramRunner extends Context.Service<ProgramRunner, {
	readonly open: (client: string) => Effect.Effect<{readonly opened: string} | {readonly why: "no_program"}, LedgerError | ProgramDown>;
	readonly msg: (letter: Omit<Letter, "rev" | "pos">) => Effect.Effect<Sent, LedgerError | ProgramDown>;
	readonly due: (at: number) => Effect.Effect<void, LedgerError | ProgramDown>;
}>()("next/ProgramRunner") {
	static readonly layer: (pid: string) =>
		Layer.Layer<ProgramRunner, never, Mailbox | ProcessManager | ProgramLoader | WatcherManager | Nemesis | Alarm>;
}
export class Alarm extends Context.Service<Alarm, {readonly set: (at: number | null) => Effect.Effect<void>}>()("next/Alarm") {}

// next/programs/chaos/src/program.ts
export const chaos: Program<Model, Msg, View, NemesisCmd>;
export const planRun: (a: {readonly seed: number; readonly most: number; readonly gap: number; readonly from: number; readonly target: Target}) =>
	ReadonlyArray<{readonly at: number; readonly fault: Fault}>;
// Both in app/nemesis.ts, since Nemesis names them and app never imports programs. `check` is pure.
export type Checked = {readonly letters: number; readonly doubled: number; readonly gaps: number};
export const check: (letters: ReadonlyArray<Letter>) => Checked;
// `Chaos` is in app/nemesis.ts too, as the chaos section shows. Reading the flags is pure:
export const chaosFrom: (a: {readonly flag: string | null; readonly stage: "local" | "cloud" | "drill"; readonly ledger: string}) =>
	Chaos | {readonly why: "wrong_name" | "not_here"}; // no flag: off. "real:" with another name: wrong_name.

// next/programs/notes/src/program.ts. As in the Notes section.
export const notes: Program<Model, Save, View, never>;
export type NoteRow = {readonly note: string; readonly version: number; readonly name: string};
export type Version = {readonly version: number; readonly body: string; readonly by: string; readonly at: string; readonly said: string};
/** Pure, for a window, from what `ledger.read` gave. The tile's history view. */
export const history: (letters: ReadonlyArray<Letter>, note: string) => ReadonlyArray<Version>;

// next/programs/notes/src/tile.ts. The tile's own machine: `Box`, as in the Notes section. Pure.
export const tile: Machine<TileModel, TileMsg, TileCmd>;

// next/programs/notes/src/root.ts. Copied, with its name kept. No raw HTML in its tree, links only http or https, an image is its alt.
export class Root { static readonly fromMarkdown: (text: string) => Root; readonly children: ReadonlyArray<Block>; }
// next/programs/notes/src/drawn.tsx. Copied in part.
export const Blocks: (props: {readonly blocks: ReadonlyArray<Block>; readonly colors: ColorsByBlock}) => ReactNode;
// next/programs/notes/src/highlight.ts. Pure but for `load`.
export const colors: (highlights: Highlights, theme: Theme) => (code: string, lang: string) => ReadonlyArray<ReadonlyArray<Span>> | null;

// next/packages/libfabrika/src/mcp/tools.ts, on `@kampus/libfabrika/mcp`. Copied, from today's mcp/tools.ts. Pure.
export type Tool = {readonly name: string; readonly description: string; readonly inputSchema: object; readonly annotations?: {readonly readOnlyHint: true}};
export const listTools: (programs: ReadonlyArray<AnyProgram>) => ReadonlyArray<Tool>; // `runs` first; no tool for personOnly
export const Call = Schema.TaggedUnion({
	runs: {},
	input: {program: Schema.String, input: Schema.String, value: Schema.Unknown},
	refused: {why: Schema.String},
});
export type Call = typeof Call.Type;
export const readCall: (programs: ReadonlyArray<AnyProgram>, name: string, args: unknown) => Call;
// next/apps/fabrika/mcp.ts [--as <name>] [--url <url>]: MCP on stdio, a client on the wire.

// next/packages/tuval/src/desktop/services.ts: more services, for the app only. A tab has none of them.
export class PersonKey extends Context.Service<PersonKey, {
	readonly line: Effect.Effect<string, KeyDown>;              // "ssh-ed25519 AAAA..."
	readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, KeyDown>;
}>()("next/PersonKey") {}
export class PersonCheck extends Context.Service<PersonCheck, {
	readonly ask: (why: string) => Effect.Effect<{readonly check: "touch" | "click"} | {readonly why: "no"}>;
}>()("next/PersonCheck") {}
export class BrainService extends Context.Service<BrainService, {
	readonly up: Effect.Effect<{readonly url: string} | {readonly why: "port_taken"}, BrainDown>;
	readonly stop: Effect.Effect<void, BrainDown>;
}>()("next/BrainService") {}
export type AppServices = PersonKey | PersonCheck | BrainService;
// tuval/headless: memoryPersonKey, answers(["touch", "no"]) for PersonCheck, fakeBrain.

// next/packages/tuval/src/desktop/menu.ts (new). Pure Elm: tea's Effect engine, with `menuView` as its view.
// Desktop imports only app, so these are its own plain types. Wiring maps transport's Row and coordination's Saw.
export type MenuRow = {
	readonly key: string; readonly label: string; readonly where: string; readonly code: string;
	readonly tabs: number; readonly pass: string | null; readonly has: ReadonlyArray<string>;
	readonly as: "window" | "agent";                            // what the client asks to be; the person sees it and signs it
};
export type MenuClient = {
	readonly key: string; readonly label: string; readonly where: string; readonly as: "window" | "agent";
	readonly tabs: number; readonly own: boolean;               // own: the app's window. It shows, with no Remove.
};
export type MenuSaw = {
	readonly code: string; readonly label: string; readonly where: string;
	readonly how: "compare" | "link"; readonly check: "touch" | "click" | "none"; readonly has: ReadonlyArray<string>;
};
export const MenuItem = Schema.TaggedUnion({
	status: {words: Schema.String},
	row: {key: Schema.String, words: Schema.String},
	client: {key: Schema.String, words: Schema.String, removable: Schema.Boolean},
	action: {id: Schema.Literals(["open_browser", "quit"]), words: Schema.String},
});
export type MenuItem = typeof MenuItem.Type;
export type MenuMsg =
	| {readonly type: "rows"; readonly rows: ReadonlyArray<MenuRow>; readonly at: number}
	| {readonly type: "clients"; readonly clients: ReadonlyArray<MenuClient>}
	| {readonly type: "approve" | "deny" | "remove"; readonly key: string}
	| {readonly type: "enter"}                                     // does nothing, by law
	| {readonly type: "checked"; readonly key: string; readonly check: "touch" | "click"}
	| {readonly type: "not_checked"; readonly key: string}
	| {readonly type: "open_browser"; readonly secret: string; readonly at: number}
	| {readonly type: "brain"; readonly words: string}
	| {readonly type: "quit"};
export type MenuCmd =
	| {readonly type: "check"; readonly key: string; readonly why: string}
	| {readonly type: "sign"; readonly key: string; readonly saw: MenuSaw}
	| {readonly type: "sign_revoked"; readonly key: string; readonly label: string; readonly where: string; readonly check: "touch" | "click"}
	| {readonly type: "deny"; readonly key: string; readonly saw: MenuSaw}
	| {readonly type: "open"; readonly secret: string}
	| {readonly type: "stop_brain"};
export const menu: Program<MenuModel, MenuMsg, ReadonlyArray<MenuItem>, MenuCmd>;
export const menuView: (m: MenuModel) => ReadonlyArray<MenuItem>;

// The outside of the brain
// node next/apps/fabrika/dev.ts --port=N --data=<folder> --founder=<key.pub | founder.json>                    "brain up: {...}"
// node next/apps/fabrika/dev.ts --port=N --founder=<key.pub | founder.json> --chaos=throwaway                  a temp folder, a fresh ledger
// node next/apps/fabrika/grant.ts client|revoke <url> <arg> [--code=N] [--label=L] [--as=window|agent] [--key=<path>]
// node next/apps/fabrika/chaos-drill.ts [--stage drill]                                                        starts a run on a throwaway ledger
// <home>/stage.json {_tag: "local"} | {_tag: "cloud", url}; no file means local; --url wins for one run
// GET /door -> {ledger}, never a person's name, since it answers before any hello. `grant.ts` takes `--for <name>`.
// POST /grant -> {rev} | {why}; GET /, /electron, /browser.js, /electron.js
// JSON-RPC: initialize, view.open, window.msg, ledger.read, ledger.wait, door.knock, door.watch, door.deny
// news: challenge, client.granted, door.waiting, door.rows, door.clients
// The bridge a window's page gets: publicKey, signHello. The panel gets: its items, and one send(MenuMsg).
// No brain method and no bridge call makes a one-time link.
```

**Changes to code plan-115 left alone:** `transport/wire.ts` takes the new `Hello`, `transport/link.ts` gains two states (`challenged`, `waiting_grant`), and `window/machine.ts` gains Cmds `sign` and `knock` and `Model.link.{fingerprint, code}`. So p5 and `link.test.ts` change with the exam. `programs/counter/program.ts` declares its ports, and in PR D its `refuse`. **The slice's tags move too:** `Message` in `transport/wire.ts` and `Link` in `transport/link.ts` go from `is` to `_tag`, with their readers in `transport/gateway.ts`, `window/machine.ts` and `window/main.tsx`. `Line` in `data/log.ts` and its SQL column go from `kind` to `_tag`, and `coordination/mailbox.ts` and `coordination/process-manager.ts` make their lines with `toLine`. So `log.test.ts`, `wire.test.ts`, `machine.test.ts` and the line read in `e2e.ts` change with the exam too. Everything else in plan-115's "no edits" list holds, except `window/page.ts`, which takes the new style.

**Choices inside that block:** plan-115's stand. `append` answers `Rev`, numbers and checks share one sync block, one `ManagedRuntime` per object with no finalizers, no Layer fails at build, refusals are plain data. **Q1 and Q2 of plan-115 are now my decisions:** a failed `step` is not `bad_msg`, with no answer and no line, so the letter resends (p25). The skip list is below. **Q3:** speed caps block only on the laptop. Why each: as plan-115 argued. Sure: 85%, 80%, 80%.

## Styling

**Named exception to "never copy across," styling only, by the owner.** From `apps/fabrika/src/window/window.css` at origin/main (`ec7ef72`, which includes PR 225):

- **Copy:** the `:root` block, lines 1 to 168 (graphite `--n-*`, accent `--a-*`, surfaces, text, spacing, radius, type at 22/15/14/13/12/11 px), without lines 118 to 131, the old names. Also the bottom line's rule, and the slot rule.
- **Fit, not copy: `.tile`, `.tile.focused` and `.titlebar`.** Today `.tile` is `position: relative; flex: 1`, and `.titlebar` is an absolute `<button>`. In `next/`, `Tile` draws with `position: absolute` and pixels from `fold`, and the title bar is a `<header>`. So their colors, borders and type carry over, their position and size are written fresh, and the PR names each edit.
- **Keep the meaning rule:** accent is "your turn" only; red stuck or broken; amber running; green done.
- **Keep the frame rules from `frame.tsx`:** bars monospace, plain words joined by ` · `, no item backgrounds, no line under the top bar or over the bottom line.
- **Where:** `next/packages/tuval/src/window/style.css`, embedded by esbuild's text loader, replacing `STYLE` in `page.ts`. Only the tokens and rules in use are copied, about 300 lines of 3,848, plus 215 for the `.markdown*` rules (lines 1347 to 1561 at `2c29c13`) in PR D, without `.markdown-keys`' keys, and with their 11 old-name lines rewritten to tokens that exist. The `compat` names are not copied. A comment gives the source path and commit.
- **Linear's question, per screen,** goes in each PR: the founding screen, the waiting screen ("how would Linear ask you to approve a device?"), the menu bar's panel, the counter tile, the chaos tile, and each notes screen, [answered as opinion in Notes](#notes). Screenshots: each key state in one tile, two side by side, two stacked, 2x2 and about 1024x700. The founding screen, waiting screen and panel come before any tile exists, so they are shot full, narrow and about 1024x700, and the PR says why.
- **Other named exceptions:** the drawing and the MCP tools, each [marked the same way](#drawing-a-note).
- **Notes' shots:** empty, reading a drawn doc with code and a table, editing, saving, no link, stale, too long, read failure and history, each in one tile, two side by side, two stacked, 2x2 and about 1024x700. The phone tab is in the demo, so each key state also gets one shot at phone width. The panel's let-in list and its Remove join PR B's panel shots, and an agent's row joins PR D's.

## Tasks

| Task | PR | Files |
|---|---|---|
| T0 the move | A | `git mv`s as [Packages](#packages) lists, six `package.json` and `tsconfig.json`, `index.ts` per public name set, `build.ts`'s generated entry; code-graph and esbuild tried on the new shape. Second commit: the desk leaves, `desktop/layout.ts`, `entry/views.ts`, `window/machine.ts`. The owner's rows stay in the exam PR |
| T1 the names | A | new `data/ledger.ts`, `app/runner.ts`, `app/nemesis.ts`, `transport/answer.ts`, `transport/hello.ts`, `transport/sshsig.ts`, `transport/waiting.ts`, `coordination/client-manager.ts`; added names in `coordination/*`, `app/program.ts`. Bodies are `Effect.die("not built: tN")` |
| T2 data and coordination | A | `data/log.ts`, `data/ledger.ts`, `data/project.ts`, `coordination/*`; the smallest bridge in `app/process.ts`, gone in T3 |
| T3 the process | A | `app/program.ts`, `app/runner.ts`, `app/entry.ts`, `app/process.ts`, `app/nemesis.ts`, `programs/counter/program.ts` for its ports |
| T4 the door | A | `transport/*`, `brain.ts`, `window/machine.ts` |
| T5 grant | A | `grant.ts`, `tuval/browser` only for its key, the waiting view in `window/main.tsx`, `window/use-model.ts` |
| T6 the stage | A | new `alchemy.run.ts`, `dev.ts`, `build.ts`, delete `brain-host.ts`, `e2e.ts`; `README.md`; style; `docs/*.png` |
| T7 platforms | B | `desktop/services.ts`, `tuval/dom/*`, `tuval/browser/*`, `tuval/headless/*`, `entry/browser.tsx`, `entry/views.ts`, `window/main.tsx`, catalog |
| T8 the app, its keys and the brain | B | `entry/electron-main.ts`, `entry/electron.tsx`, `launchd.ts`, `tuval/electron/{preload,index,key,person-key,founding}.*`, signing setup in `README.md` |
| T15 the menu bar, with Remove (done before T9) | B | `desktop/menu.ts`, `tuval/electron/{tray,panel,panel-preload,person-check,menu-cmds}.*`, `tuval/headless/*`, `entry/electron-main.ts`, `coordination/client-manager.ts` for `Took` and `saw.has`, the waiting words in `window/main.tsx` |
| T9 the demo | B | `brain.ts` routes, `README.md`, `docs/*.png` |
| T10 one file | C | `build.ts`, `brain.ts`, `table.ts` (the program table), `workers.d.ts` |
| T11 cloud | C | `alchemy.run.ts`, the menu bar's second link in `entry/electron-main.ts` and `desktop/menu.ts`, `README.md`; the run in `field/` |
| T16 notes' names | D | new package `next/programs/notes`, with `programs/notes/{program,tile}.ts`; `refuse`, `Refusal` and `fold` in `app/program.ts`; the counter's `refuse`. Bodies are `Effect.die("not built: tN")` |
| T17 the program and the log | D | `programs/notes/program.ts`, `app/program.ts`, `app/runner.ts`, `table.ts` (the program table), `brain.ts` (the wire's answer) |
| T18 the tile | D | `programs/notes/{tile.ts,view.tsx}`, `entry/views.ts` for the view table |
| T20 drawing a note | D | new `programs/notes/{root.ts,drawn.tsx,highlight.ts,highlighter.ts}`, `programs/notes/{tile.ts,view.tsx}`, `window/style.css`, `window/page.ts`, `brain.ts` for the policy and `/highlight.js`, `build.ts`, `entry/electron-main.ts` for links, `next/programs/notes/package.json` |
| T21 agents through MCP | D | new `mcp/{tools,serve,drive,client,index}.ts`, `next/apps/fabrika/mcp.ts`; `programs/notes/program.ts` inputs, `app/program.ts` `Input`, `transport/answer.ts`, `transport/waiting.ts`, `desktop/menu.ts`, `coordination/mailbox.ts` for `for`, `next/packages/libfabrika/package.json` |
| T19 where notes live, and the demo | D | `entry/electron-main.ts`, `launchd.ts`, `desktop/menu.ts` for the status words, `alchemy.run.ts`, `README.md`, `docs/*.png`; the run in `field/` |
| T12 program | E | new package `next/programs/chaos`, `app/nemesis.ts`, the layout in `entry/views.ts` |
| T13 live faults | E | `brain.ts`, `transport/gateway.ts`, `app/process.ts`, `data/project.ts`, `build.ts`, `dev.ts`, `alchemy.run.ts` |
| T14 drill and run | E | `chaos-drill.ts` on `mcp/client.ts`, `README.md`, `docs/*.png`, `field/` |

Red to green, as plan-115: after the names of T1, T7, T15 and T16 everything compiles, and each `new` test fails on "not built". Quick checks per task: typecheck, oxlint on that task's files, that task's tests. Whole `pnpm lint` at each PR's last task. Wire tests stay green at every commit.

### PR A

- **T0.** `ends`: local commit. Scenario p65. The first commit only moves, and the slice's own tests stay green. The second removes the desk and its mirrored-focus check, and nothing else. First step: `code-graph . --unreachable`, `--interface-width` and `build.ts` on the new shape. If either doubt in [Packages](#packages) is off, stop and tell the owner.
- **T1.** `ends`: local commit. Scenario c1. Properties p1 to p9, p16.
- **T2.** `ends`: local commit. Fixture: `Ledger.sql` on node:sqlite. Scenario p18. Other: p10 to p13, p19 to p21, p28. Criterion c2.
- **T3.** `ends`: local commit. Fixture: `ProgramRunner` with real `counter`. Scenario p22. Other: p14, p25, p35. Criteria c2, c3.
- **T4.** `ends`: local commit. Fixture: `answerFrame` with a fake `admit`. Scenario p26, p23. Other: p15, p42, p43. Criterion c2.
- **T5.** `ends`: local commit. Fixture: `sshsig` vectors made by real `ssh-keygen`, saved in `fixtures/next/`. Scenario p27. Other: p29 (needs T6 to run). Strict Mode goes on here, with the hook in `window/use-model.ts` and `Effect.runFork`, on the exam's edge list; probes showed it working on tea's Effect engine, sure 90%. Spike first: does a non-extractable Ed25519 `CryptoKey` survive reload in IndexedDB in Chromium, on 127.0.0.1? The browser note says not tried. If not, stop and tell the owner; no fallback is planned, because the fallback is a key the page can read.
- **T6.** `ends`: PR A. Fixture: whole tree, two Chromium contexts, real `dev.ts`. Scenario p17 on the stage. Other: p24, p32, p29. Criteria c4, c5, c6, c7. **First step: measure 4 runs of the bar on the new stage, on the base,** so caps are set from numbers.

### PR B

- **T7.** Scenario p30. Other: p50, p66's browser and headless half. Criterion c8. `window/main.tsx`: the Effect socket, `memo` per tile, `useEffectEvent` and `<Activity>`, on the hook T5 brought.
- **T8.** Scenario p46. Other: p44, p31 up to the keys, p66's Electron half. Spikes first, all on a dev build: (1) launchd on an unsigned build: start, app crash, Quit. If it fails, `childBrain`, and tell the owner. (2) `safeStorage` under Playwright in a temp home. (3) The self-made card: the owner opens the built app twice. If the Keychain asks on open, the window key moves to WebCrypto in a hidden local page, and tell the owner. (4) Touch ID from that build. If it cannot prompt, the plain click, and tell the owner.
- **T15.** Scenario p45. Other: p49's pure half, p51's pure half, p66's grant half. A Tray and a panel, both drawn from `menuView`.
- **T9.** Scenario p47, p31 whole. Other: p48, p49's live half, p51's live half. Criteria c5, c9, c13. `ends`: PR B. Screenshots from the real app. The owner's own finger is the last check, once, in the demo.

### PR C

- **T10.** Scenario p33. Local bar re-run on the one file: must not get worse.
- **T11.** Scenario p41. The owner reads `alchemy plan`, says yes, and the deploy runs. An agent starts the app, and the owner clicks. Criterion c10. `ends`: PR C.

### PR D

Before it, a small exam PR. See [The exam PR](#the-exam-pr-not-in-this-plan).

- **T16.** `ends`: local commit. Scenario c1 on the new names. Notes imports only the lists in [Packages](#packages), and the PR says what it had to add.
- **T17.** `ends`: local commit. Fixture: `ProgramRunner` with real `notes`. Scenario p52. Other: p53, p54, p55, p56. First step: read Cloudflare's frame limit and set `MOST`. Record a wake at 1,000 and 10,000 saves of 5 KB into `field/`.
- **T18.** `ends`: local commit. Scenario p57. Other: p58's window half. Criterion c14.
- **T20.** `ends`: local commit. First commit: the copied files, unchanged, each with its comment. Scenario p61. Other: p62, p57's reading half. Criterion c16.
- **T21.** `ends`: local commit. Fixture: the bridge against real `dev.ts`, with the SDK's own client. Scenario p63. Other: p64. Spike first: does Claude Code list the tools through `fabrika mcp --as claude` while waiting for Approve. Criterion c17.
- **T19.** Scenario p58, p59. Criteria c9, c15. `ends`: PR D. Spike first: open the tile on the owner's phone, on the deployed stage, with the content security policy on. If its browser does not keep the key, tell the owner. The owner reads `alchemy plan` and says yes before the deploy that makes notes real, and an agent starts the app, and the owner clicks.

### PR E

- **T12.** Scenario p34. Other: p36. Criterion c11.
- **T13.** Scenario p35's live half, p37, p38, p60.
- **T14.** Scenario p39, p41's chaos step. The owner reads `alchemy plan --stage drill` and says yes before the cloud run, and the stage is removed after it. The drill dials on PR D's `mcp/client.ts`, with its own key, and comes in by the same door. Criteria c9, c12. `ends`: PR E.

## Properties

All have `tool: "test"`. Runtime: **node** is vitest on Node, **stage** is the real brain under `dev.ts`, over the wire. **p1 to p24 are plan-115's, unchanged in meaning,** and the test writer copies their full wording from it. There is no p40. The only changes:

- **p5** adds: `waiting_grant` is not stuck. A `client.granted` moves it. A timer does not leave it. Plant: `client.granted` ignored.
- **p10 to p15, p17** run on `stage`, not Miniflare. **p15** adds the checks of p26.
- **p17's bar is measured new** (T6). The old table's start numbers came from raw Miniflare. Known so far: restart 292 to 539 ms, first answer 1.2 to 1.4 s (exp 171). Same rule: base and head in one sitting, the laptop blocks, CI only prints.
- **p22** adds, from PR D: a program's own `refuse` leaves no line and answers with that program's `why`. `bad_msg` stays for a bad shape.
- **p24** runs oxlint on `next/`, with an edge line only in files the exam PR lists.
- **p25** is `new`, no longer waits on the owner. From PR D, its "old letters the new code refuses count for nothing" holds only for the counter and chaos. A saved note always folds (p55).

**p26, the signed hello (scenario of T4).** `new`, node. s4. `transport/hello.ts`, `answer.ts`.
- A known key with a good signature goes online, `who` from the fold. A key that does not hash to the dialed name, a signature over another nonce, url or tab, and a reused nonce are each refused and change nothing. Unknown key: `not_granted`, and every method but `door.knock` gets `no_hello`. Nothing is written before online. `door.watch` and `door.deny` answer only an online client.
- Why: this is the whole door. Plants: nonce not checked; name not checked; a method served while `waiting`; `door.watch` open to a key not let in.

**p27, the grant (scenario of T5).** `new`, node. s4. `transport/sshsig.ts`, door.
- Real `ssh-keygen` vectors: good signature passes. A wrong namespace, other signer, changed text, and non-Ed25519 are refused with the same answer. A grant for another ledger is refused. A signer who is not a key of the person named is refused, and that includes a window key named at founding. Any key in `founded.keys` passes the same way, whatever made the signature. The same grant id twice gives one fact and the same answer.
- Why: this is what makes a person's say real. Plants: namespace ignored; `to` ignored; `for` ignored; verify always true; window key accepted as a signer.

**p28, who belongs (pbt).** `new`, node. s4. `foldMembers`, `admitted`.
- Over any list of facts: `founded` is first and never replaced. Its `window` is admitted with no grant. A revoked key stays out forever, whatever comes later. A `denied` changes who belongs in no way. Adding the same fact twice changes nothing.
- A good thing happens: a grant by a person's key admits that key.
- Why: rules checked on every hello. Plants: last fact wins for revoke; second `founded` accepted; `denied` blocks a later grant.

**p29, the first grant, real browser.** `new`, stage. s4, s3. e2e.
- A fresh tab shows the waiting screen with its code and fingerprint. `node next/apps/fabrika/grant.ts client` with a throwaway key brings it online without a reload. A reload needs no new grant, and the fingerprint stays. Two tabs of one profile are both online, with one `by`. Those two tabs show one code. A grant from another key leaves it waiting. Revoke closes the socket and shows "This window was removed", and Ask again makes a new key and a new wait.
- Why: T5's flow, whole. Plants, once by hand on a temp copy: `client.granted` not sent; key made anew on reload.

**p30, the platforms.** `new`, node and browser. s5. `desktop/services.ts`, `tuval/*`.
- One suite on each Layer: `publicKey` is stable, `sign` verifies with `checkHello`, `cannot` is as W5 says, `Screen.resized` fires. Bundling `window/machine.ts`, `desktop/*`, `transport/*` for a browser with no Node or Electron shim passes, like today's `lint:browser`. The private key cannot be read: `exportKey` fails in a tab, and the page has no way to get it in Electron.
- Plants: an extractable key; `node:fs` in the core.

**p31, the demo.** `new`, real Electron, real Chromium, stage. s5, s3.
- The window is online from founding, and the tab comes in through the menu bar. Press in the window, the tab shows it, and the other way. Quit and reopen Electron: same key, no grant. Kill the brain: both show it, both come back, a press made while lost lands once. In the page, `process` and `require` are undefined, and navigation to another origin is blocked. The key file on disk does not contain the private key in the clear.
- Plants, by hand: `safeStorage` skipped; preload signs anything.

**p32, strict layers.** `existing`-style, in the exam. s1. `pnpm lint:layers` for upward imports, `layers.test.ts` for skipped layers, and the tables above. Red on the base, green at PR A.

**p33, one file.** `new`, node. s6. `build.ts`, `alchemy.run.ts`.
- The stack's `env` values are each under 5 KB. `main` is the file `build.ts` made, the same hash for `local` and `cloud` at the same chaos value. Loader code keeps `globalOutbound: null` with empty env, and no program's bundle reads a binding.
- Plants: `WINDOW_JS` back in env; a program given a binding.

**p34, chaos, the program (pbt).** `new`, node, tea's pbt. s7. `programs/chaos/program.ts`.
- Same seed, same list. Never more than `most`, always at least `gap` apart, never targets chaos. After `stop` no `fire` and `wake` is null. Every fired tick is in the model before its `did`. `wake` depends only on the model. A run always ends (a good thing happens).
- Plants: no cap; `stop` ignored while a tick is open; a random number from outside the seed.

**p35, Cmds in the runner.** `new`, node. s7, s1. `ProgramRunner`.
- A fresh letter saves first, and only then fires. A fold from the log fires nothing, however many ticks it holds. A `tick:<at>` rung twice saves once and fires once. A `fire` from a program other than chaos is refused as `bad_cmd`. A process that dies after the save leaves asked with no did, and the next wake shows that and goes on. Results come back as letters.
- Why: the worst bug here is a wake that re-fires. Plants: fire before save; replay fires; no table check.

**p36, the checker.** `new`, node, pbt. s7. `check`.
- Over any letters: repeats by id count in `doubled`, missing `pos` in `gaps`, and a clean stream gives zeros.
- Plants: `gaps` counted from zero; `doubled` by rev.

**p37, chaos answers to identity.** `new`, stage. s4, s7.
- An unknown key gets nothing, on any Msg. A revoked key stops at once. A forged `by` in params is dropped.
- Plants: guard only on `start`; `by` read from params.

**p38, the off build.** `new`, node. s7. `build --chaos=off`.
- Its bytes hold no `chaos` program, no `abort(` method, no `Nemesis` fire path. Its counter demo still passes p17's first step, and a note saved on it reads back.
- Plants: an abort method left in.

**p39, a real run.** `new`, stage, and read on cloud. s7, s3.
- With a fixed seed, on a throwaway ledger, a driver presses in two real windows and saves notes in both while the run fires. At the end: every press a window got an `ok` for is there once, `doubled` 0, `gaps` 0, the counter's count equals presses, both windows online. The verdict shows on screen. Each fault named has its asked and did.
- **Chaos never loses a saved version.** Every save a window got an `ok` for is in the log once, its text byte for byte, and a fresh fold shows the last one as the note. A save with no `ok` is either there once or still on that window's screen, never neither. A stale refusal under faults writes nothing.
- The drill: `kill_brain` and `hang_brain` on local, and their results land as letters.
- Why: this is the steady-state hypothesis, in Principles of Chaos's words. Plant, by hand: a Mailbox with no id check, which `doubled` must catch.
- Honest: a failure here may be a real bug, and goes to the owner as a finding, not to be smoothed over.

**p41, the cloud smoke.** A run, not in CI. s6.
- On a stage the owner deployed: an agent starts the app, and the owner clicks. A tab in a browser that is not the default comes in by Approve, and the default browser by the one-time link. Tab and window, press both ways. Record first answer, press to count, reconnect, cold wake, isolate cold load. Every number goes to `field/` and the PR.
- Its chaos step waits for chaos to exist, so it runs at T14, not T11: a short run on the `drill` stage ends green, with the same `check`, and the stage is removed after it. By then `cloud` holds real notes, so chaos does not run there.

**p42, the facts.** `new`, node. s2, s7.
- A `granted` fact holds text and signature that re-verify alone, and its text holds `as` and all of `saw`, `check` and `has` included. A `denied` fact holds `saw`, and `by` from the checked key. A hello fact holds `platform`, `has`, code hash, `said`. `by` is never from params. A saved fact holds `_tag` and folds back through `MemberFact`; a line with a tag the fold does not know is skipped and kept.
- Plants: `by` from params; signature dropped; `saw` or its `has` left out of the signed text; a fact saved with `kind` in place of `_tag`.

**p43, waiting (pbt).** `new`, node. s4. `transport/waiting.ts`.
- Over any list of knocks: one row per key, and two tabs of one key share its code. A key's code holds until `until`, then a new one is picked. There are never more than `most` rows, and the oldest goes first. A knock never touches the ledger, and a test with `door/members` watched sees no write. The code never appears in the door's check: an approve with any code lets the key in, and `saw` records it.
- Plants: a code per tab; no cap; a knock that writes; the door reading the code.

**p44, one signature shape.** `new`, node, with real `ssh-keygen`. s4. `writeSshsig`, `PersonKey`.
- What `writeSshsig` makes passes `ssh-keygen -Y verify` and `checkSshsig`, and what `ssh-keygen -Y sign` makes passes `checkSshsig`. One test on both `PersonKey` Layers it can reach: `line` is stable, and the private half is never in the file in the clear.
- Plants: wrong namespace written; padded signature.

**p45, the menu (pbt).** `new`, node, tea's pbt. s8, s4. `desktop/menu.ts`, on `tuval/headless`.
- Over any Msgs: `sign` for a compare row comes only after `checked` for that key. `not_checked` makes no Cmd. `enter` changes nothing and makes no Cmd. `deny` needs no check. Two tabs of a key give one row. `saw` in a `sign` holds what the row showed at the click, `has` included, even if the row changed after. `menuView` depends only on the model.
- Plants: sign on `approve`; `enter` approves; `saw` read at sign time.

**p46, founding.** `new`, real Electron, temp home. s8.
- An empty home shows one name field and Start, from a local file. Start gives `founded {name, keys, window}`, and the window comes online with no approve and no prompt. Reopen: no founding screen, same keys, no second `founded`. With data there and a key that will not open: plain words, and no new key is made.
- Plants: founding screen shown over data; a new key made on a failed open.

**p47, the approval flow.** `new`, real Electron, real Chromium, stage, test `PersonCheck`. s8, s4.
- A tab typed by hand shows a code. The panel shows a row with the same code, Deny and Approve. The panel's own address is a local file. Enter does nothing, and nothing has focus on Approve. Approve with the check at yes: one `granted` fact, and the tab is online with no reload. With the check at no: no fact, and the row stays. Deny: one `denied` fact, and the tab says so, and Ask again gives a new row.
- Plants, by hand: Enter approves; panel loaded from the brain.

**p48, the app and the brain.** `new`, laptop only, real launchd, temp home and its own label. s8.
- Open starts the brain. Kill the app with `kill -9`: the brain lives, a granted tab's counter keeps working, and a new tab shows a code and waits. Reopen: the app finds the running brain and the row appears, and Approve works. Quit: the brain and its workerd are gone, and no plist is left loaded. CI runs the same steps on the test `BrainService` only, and the PR says so. With `childBrain`, the crash step is dropped and the law says so.
- Plants, by hand: Quit leaves the brain; the app starts a second brain.

**p49, the one-time link.** `new`. Pure half on node, live half on stage. s8.
- Pure, over any Msgs: a pass is used once, and 60 seconds on it is dead. Each makes a normal row. A row with a live pass signs with no `check` Cmd, `how: "link"`, `check: "none"`. Only `open_browser` makes a pass.
- Live: the click opens the tab, it comes online with no row to click, the address no longer shows the secret, and a request log holds no secret in any URL. The same link used again shows a code. The list of brain methods and bridge calls holds nothing that makes a link.
- Plants: a pass used twice; no time limit; secret in the query string.

**p50, the window in React.** `new`, real Chromium, stage. s3, s5. `window/use-model.ts`, `window/main.tsx`.
- Under Strict Mode: a patch to one of 16 tiles renders one tile. A folded tile keeps its state across a fold and unfold, sees no work while hidden, and is fresh when shown. Focus comes back from the model on reveal. The hook works with no DOM, by `renderToStaticMarkup`.
- Plants: no `memo`; a tile that unmounts on fold; no third argument to the hook.

**p51, Remove.** `new`. Pure half on node, pbt; live half on real Electron, real Chromium, stage, test `PersonCheck`. s10, s4. `desktop/menu.ts`, door.
- Pure, over any Msgs: `sign_revoked` comes only after `checked` for that key and that act. `not_checked` makes no Cmd. `enter` makes no Cmd. A client with `own` has no Remove in `menuView`. What was shown at the click is what gets signed.
- Live: a let-in tab is in the panel's list. Remove with the check at yes: one `revoked` fact, its signed text holding `saw`, and the tab closes with 4003, then shows "This window was removed". It is gone from the list. With the check at no: no fact. A `revoked` signed by a window key is refused. An approve and a remove in flight for two keys do not cross.
- Why: a mix-up here removes the wrong window. Plants: remove without the check; `own` shown with Remove; a revoke signed by a window key accepted; the act not kept, so a remove signs a grant.

**p52, a save is one fact (pbt, scenario of T17).** `new`, node, tea's pbt, real `ProgramRunner`. s9. `programs/notes/program.ts`, `app/runner.ts`.
- Over any list of good saves: each is exactly one line in `notes:1/inbox`, with `base`, `body`, `how`, `from`, and `by`, `for`, `at`, `said` on the letter. No line is ever changed or removed. A note's version is one more than its `base`. `by` is the checked key, whatever the params say. `update` never sees `said`.
- A good thing happens: a save on the current version always lands.
- Why: this is what "never overwritten" means. Plants: a save that replaces a line; version counted across notes; `by` read from params.

**p53, a repeat with the same id is one row.** `new`, node, real `ProgramRunner`. s9, s3.
- A resend with the same id gives one line and the same answer as the first time, even after the note moved on, so it never reads as stale. A resend of a refused save is still refused and writes nothing. Two different ids with the same body are two lines.
- Why: a lost answer is ordinary, and it must not look like someone else's edit. Plants: `refuse` runs before the id check; the id check by body.

**p54, a stale `base` is refused and writes nothing (pbt).** `new`, node. s9.
- Over any list of saves with any `base`: a `base` other than the note's current version answers `{why: "changed_elsewhere", now}`, with `now` the true version. The log's length and the model do not change, and no view patch goes out. Two saves on one `base`, sent at once through the permit, end with one line and one refusal. A `base` of 0 on a used note id is refused too. A body past `MOST` answers `too_long` and writes nothing.
- Plants: `<` for `!==`; a refused save appended anyway; no permit; `now` read before the append.

**p55, the list and history fold from facts alone (pbt).** `new`, node. s9, s2.
- From the letters alone, with no other input: the list and each note's latest text come out the same, however many times it folds. `history` gives every version in order, with `by`, `at`, `said`. The fold never calls `refuse`. A saved letter from `fixtures/next/`, made by PR D's first code, folds forever, so a later change that breaks old letters fails here.
- Plants: a fold that re-checks `base`; a list order from anything but the log; a letter skipped when its shape is unknown.

**p56, a restart loses no saved text.** `new`, stage. s9, s3.
- Save notes over the wire, kill the brain with `kill -9`, start it on the same folder: the list and every version read back byte for byte. Text with new lines, emoji and a right-to-left line comes back whole. A save made while the brain is down stays on the screen, and lands once when it is back.
- Plants: a model kept only in memory; a body trimmed on save.

**p57, the tile's machine (pbt).** `new`, node, tea's pbt. s9, s3. `programs/notes/tile.ts`.
- Over any Msgs: there is never a second save in flight for a note. A draft is never replaced by a view update, and only "Drop mine" clears it. A note opens as `reading`. `reading` follows a newer version. `e` gives `editing`, with the saved text as the draft. Done with a change saves and then reads; Done with none writes nothing. Reading can never send a save. Stale, too long and no link all keep the draft. `saving` resends with the same id. "Keep mine" sends a new note id, `base: 0`, `how: "kept"`, and `from` naming the note and its `base`. "Saved" shows only after an ok.
- Plants: a draft overwritten by a patch; a new id on resend; a second save sent early; "Saved" shown at send.

**p58, the demo, real windows.** `new`, real Electron, real Chromium, stage, and read on cloud. s9, s5.
- An agent saves a doc through `notes_save`, and it shows drawn in the other window and the tab, with no button pressed. The owner presses `e`, changes a word and saves: it goes back to drawn, and the other window follows. The agent's next save on the old `base` is refused in words, and nothing is written. Its next save, after a read, lands. History names the agent, who it works for, and the owner. Two windows on version 3, both typing: one is refused, its text stays on screen, and nothing changes in the log. "Keep mine as a new note" gives a note with that text, and the first note keeps the other's. Leave a note right after typing: it saves. The empty state, the read failure and history each show as the table says. No button does nothing.
- On a deployed stage, an agent starts the app, and the owner clicks: a phone tab comes in by Approve, and the agent's doc shows there drawn, and an edit there shows on the Mac. Record press to show, cold wake and the wake at the real letter count. Every number goes to `field/` and the PR.
- Plants, by hand: the view not sent to other watchers; "Keep mine" overwriting.

**p59, which stage it dials.** `new`, real Electron, temp home. s9, s6.
- No `stage.json`: the app dials local and starts the brain. `{_tag: "cloud", url}`: it dials that url and starts no brain, and Quit stops nothing. `--url` wins for one run and writes nothing. A file that does not parse gives plain words and no guess. The panel and the tile name the stage. A `drill` deploy's step leaves the file as it was.
- Plants: a bad file read as local; a brain started on `cloud`; `--url` written to the file.

**p60, chaos and the real ledger.** `new`, node, plus a stage run. s9, s7. `chaosFrom`, `build.ts`, `alchemy.run.ts`.
- No flag on any stage gives off, and off's bytes pass p38. `--chaos=throwaway` gives a fresh `throwaway-` ledger and a temp folder, never the app's home, and is refused on `cloud`. `--chaos=real:<name>` with any other name stops the start, and is refused off `cloud`. On a throwaway ledger the run works, and the app's home is the same, byte for byte, afterward. The real-ledger tile shows its red line.
- Plants: off as a runtime check; throwaway reusing the given folder; a wrong name accepted.

**p61, drawing is safe (scenario of T20).** `new`, node, ported from today's `markdown.test.ts` and `highlight.test.ts` by the test writer, plus what applies of `index.laws.test.ts`. s9. `programs/notes/root.ts`, `drawn.tsx`, `highlight.ts`.
- Over any text, with `renderToStaticMarkup`: raw HTML is never drawn as markup, whatever the text holds. A link is drawn only for http or https, and any other is its words alone. An image draws its alt text and loads nothing. Code is text children, with no markup from its text, colored or plain. Any text parses and draws without throwing. A language the highlighter does not know stays plain. A line of 1,000 or more is one span.
- The same text gives the same blocks, and no fact holds a block. The box's bundle of `@kampus/notes` holds no `micromark`, `mdast`, `@pierre`, React or tuval.
- Why: agent-written text is drawn in a real tab. Plants: `dangerouslySetInnerHTML`; `javascript:` kept; an `<img>` drawn; code through `codeToHtml`; `root.ts` imported in `program.ts`.

**p62, the page's policy.** `new`, real Chromium, real Electron, stage, and read on cloud. s9, s5. `brain.ts`, `window/page.ts`.
- On both stages, the page's header is the one policy. Under it: the page runs, the socket connects, `style.css` applies, a code block takes its colors, and an inline script in a note does not run. With WebAssembly blocked, code stays plain and nothing else breaks. `/highlight.js` is not fetched until a block with a language opens. Both script sizes are printed, and block nothing. Every `var(--x)` in `style.css` has a definition in it, since an unknown one fails silently.
- Why: a law, not a hope, for what the copies need and what agent text must not do. Plants, by hand: no `'wasm-unsafe-eval'`; policy on one stage only; the highlighter in the first script; a `var(--ink)` left in.

**p63, an agent through MCP (scenario of T21).** `new`, node with the SDK's own client, and real `dev.ts`; ported where it applies from `agents.test.ts`. s11, s9. `mcp/tools.ts`, `mcp/serve.ts`, `mcp/drive.ts`, `mcp/client.ts`.
- Tools are one per input, from its schema: `runs` first, `notes_list` and `notes_read` read-only, `notes_save` not. An input with `personOnly` has no tool, and a call to it is refused as an unknown tool. A value that does not fit is refused in words. No tool name holds grant, approve, remove, or chaos.
- Before Approve, the list answers, and each call answers in words with the code. No letter is written. After one Approve, the same name needs none again, across restarts of the bridge. A second name gets its own row. A stale `base` is refused in the same words as a window's `why`, and writes nothing. The same call twice is one row. `runs` lists processes and drives none. `by` is the agent's key and `for` is the person, on every letter.
- Plants: a tool for a `personOnly` input; `by` taken from `--as`; a name used without a grant; a retry with a new id.

**p64, an agent stays an agent.** `new`, node. s11, s4. `transport/answer.ts`, door.
- A client granted `as: "agent"` gets `not_for_agents` on `door.watch`, `door.deny`, a Msg to anything but `notes:*`, and any window Msg. A grant, a `revoked` or an Approve signed by an agent's key is refused. A letter's `by` never equals a person key from any agent's call. `as` in a grant cannot be changed by the client after signing, and a knock's claim of `window` shows as such, and only the person's signature makes it true. Remove on an agent ends it at once. `@modelcontextprotocol` is not in the brain's bytes.
- Why: the laws the owner named: no person-only tool, an agent never writes as the person. Plants: `agentMay` left open; `as` read from the hello; a signature by an agent's key accepted.

**p65, `next/` stands alone (scenario of T0).** `new`, node, in the exam. s12, s1. `exam/layers.test.ts`, `exam/deps.test.ts`.
- No `package.json` under `next/` has a dependency ending in `-old`, or a `workspace:` one outside `next/`. Every import in `next/` names a package its own `package.json` lists; a walk up to the root's `node_modules` does not count. A program's `.` imports nothing from `@kampus/tuval`. **`@kampus/tuval` may import `@kampus/libfabrika`, and nothing in `@kampus/libfabrika` imports tuval, a program or the app.** Across packages, an import names a key in that package's `exports`. In `next/apps/fabrika`, only `entry/electron-main.ts` imports `electron`, so the tray, the panel, the keys and `PersonCheck` can only live in tuval.
- Bundled for a browser with no Node shim, like today's `lint:browser`: the top level of `@kampus/libfabrika` and `@kampus/tuval`, and `@kampus/notes` and `/window` of each program, hold no `node:*`, Electron, `cloudflare:*` or `@modelcontextprotocol`.
- Every `next/` package is private at 0.0.0, and each has `sideEffects: false` and a `typecheck` script.
- Why: `package.json` alone stops neither a walk up to the root nor a Node import at a top level. Plants: an import of `@kampus/fabrika-old`, which the root would resolve; `node:fs` in a top level; a program importing `@kampus/libfabrika/transport`; `@kampus/tuval` imported from the library; a deep path into another package's `src/`.

**p66, a host says what it can do.** `new`, node and real Chromium, real Electron for its half. s5, s2. `desktop/services.ts`, `tuval/*`, `transport/wire.ts`, `transport/waiting.ts`.
- On each Layer, the hello that goes out holds exactly that Layer's `Host.has`, and its `door/hellos` fact records the same list. Over any list from a test Layer, the same list reaches the waiting row and the signed text of the grant a click makes.
- Every word in a Layer's list has a service or a platform call behind it in that Layer. With `canPromptTouchID` false, `touch-id` is not listed. With `safeStorage` unable to seal, `keychain` is not listed.
- Nothing reads it yet: any list gets the same answers from the door, and a hello from an unknown key that claims `touch-id` still gets `not_granted`.
- Why: old hellos can never get the list back, and with no reader, nothing else would notice a wrong one. Plants: a list written by hand in the hello, not read from `Host`; `has` dropped from the row; `touch-id` listed where it can't prompt; the door branching on `has`.

## Criteria

- **c1 to c6:** plan-115's, with oxlint in place of Biome, and c5's README also naming the stage.
- **c7, T6, T20, T21.** Styling is what the styling section says: tokens match the named commit, meaning rule holds. From PR D the same read covers the other copies: each copied file has a comment naming its source path and commit, and nothing else was copied. Read: `style.css`, the copies, and shots. s5.
- **c8, T7.** Core has no platform name; `entry/browser.tsx` and `entry/electron.tsx` are three lines; `window/main.tsx` has no socket code of its own. Read: the diff. s5.
- **c9, T9, T14, T19.** PR carries real shots in five layouts, says what looks broken, and answers Linear's question per screen. Read: the PR body. s5, s7.
- **c10, T11.** A run log: plan read, yes given, deploy, p41's numbers, dollars. The repo holds no account name or key. Read: `field/`, a grep. s6.
- **c11, T12.** The chaos tile has no dead button; each fault shown can really fire on that stage. Read: the running tile. s7.
- **c12, T14.** README teaches a run in one page, including how to read an old run back, how a run stays on a throwaway ledger, and how a person aims at real notes on purpose. s7.
- **c13, T9.** README and PR B's body say once, in one plain sentence, that this tier does not defend against a person's own agents. The owner opens the built app twice and sees no prompt on opening. Read: the README, and the owner's word in `field/`. s8.
- **c14, T18, T20.** The notes tile looks finished: no stub, no dead button, and empty, reading, editing, saving, no link, stale, too long, read failure and history are each real, in the meaning colors. Its style follows the styling section. Read: the running tile, and shots. s9.
- **c15, T19.** README says where real notes live, what `stage.json` does, and how to go back. The PR says what's not in Tier 1. The cloud ledger has `RemovalPolicy.retain()`. The owner's first use, with an agent writing real docs, is logged in `field/`, whichever way it goes. Read: the README, the stack, `field/`. s9.
- **c16, T20.** A fresh real doc, long and with code and tables, reads well in one tile and at phone width. The PR says what the copies carried over and what was left behind, and what `q` became. Read: the running tile, the PR. s9.
- **c17, T21.** README teaches `claude mcp add` in one page, including Approve once per name and what an agent cannot do. The PR says what moved up from Tier 5 and what stayed. Read: the README, the PR. s11.

## The mutation step

- **Tool:** as plan-115. Stryker 10.1.1 through today's `MutationRunner`, from outside; `next/` imports none of it. Fixed sample per PR: seed 115, at most 150. `nice -n 15`, `--maxWorkers=3`, concurrency 2. Typecheck on. Survivors go back to the test writer.
- **Covers:** plan-115's list plus `transport/hello.ts`, `transport/sshsig.ts`, `transport/waiting.ts`, `coordination/client-manager.ts`, `desktop/menu.ts`, `programs/chaos/program.ts`, `app/nemesis.ts#check`, `app/nemesis.ts#chaosFrom`, `app/runner.ts`'s Cmd path, and for PR D `programs/notes/program.ts`, `programs/notes/tile.ts`, `programs/notes/root.ts`, `programs/notes/drawn.tsx`, `programs/notes/highlight.ts#colors`, `mcp/tools.ts`, `transport/answer.ts`'s `agentMay`, and `app/runner.ts`'s id, refuse and fold steps. Copied code gets no pass, since it runs here.
- **Skip list by file, my decision:** plan-115's Q2 list, without `brain-host.ts`, plus `alchemy.run.ts`, `grant.ts`, `chaos-drill.ts`, `tuval/browser/*`, `tuval/electron/*`, `tuval/dom/*`, `launchd.ts`, `entry/*`, `programs/chaos/view.tsx`, `programs/notes/view.tsx`, `next/apps/fabrika/mcp.ts`, `mcp/serve.ts`, `mcp/drive.ts`, `mcp/client.ts`, and the live Nemesis in `brain.ts`. Why: none can be mutated in the test's process. p15, p17, p29, p31, p37, p39, p46, p47, p48, p51, p58, p59, p62 and p63 cover them. Cost: a wrong line in `brain.ts`'s door is only caught if a wire test sees it. That is why the logic lives in `answer.ts` and `client-manager.ts`. Sure: 80%.
- **Cost, a guess:** 10 to 25 machine minutes per PR.

## The exam PR, not in this plan

An agent that is not the builder writes it. The owner reads it. It lands after the docs PR, on main at `05a43d0` or later, and holds:

1. An oxlint JS plugin rule, `no-promises`, blocking in `next/**` leaving out tests. It refuses `async`, `await`, `new Promise`, `Promise.<anything>(...)`, `.then(...)`, `Effect.promise(...)`, and `.catch(...)` unless the object is an imported Effect module. JS plugins are alpha and not type-aware, so that check goes by import name: report any miss.
2. An oxlint rule, `no-effect-run-outside-edge`, with edges, written as full paths in the rule: `data/project.ts`, `data/ledger.ts`, `app/process.ts`, `transport/gateway.ts`, `transport/hello.ts`, `transport/sshsig.ts`, `brain.ts`, `build.ts`, `window/use-model.ts`, `tuval/browser/key.ts`, `tuval/electron/preload.ts`, `tuval/electron/panel-preload.ts`, `tuval/electron/key.ts`, `tuval/electron/person-key.ts`, `tuval/electron/person-check.ts`, `launchd.ts`, `entry/electron-main.ts`, `alchemy.run.ts`. `dev.ts`, `grant.ts` and `chaos-drill.ts` use `NodeRuntime.runMain` and should need none.
3. An oxlint rule, `no-tea-react`, blocking in `next/**`: no import of tea's `useMachine` or `useRuntime`. It dies under Strict Mode, so a written rule is not enough. Why: an import name has about no false alarms. Cost: a few lines. Sure: 90%.
4. **An oxlint rule, `no-of`, blocking in `next/**`: no bare `of` and no `xOf` names.** It fires on a name this code declares: a variable, function, type, class, parameter or object key named `of`, or ending in `Of` after a lowercase letter or capital word (`colorsOf`, `IconOf`). It does not fire on a use, so `indexOf` and `for...of` pass. Why: it's a real rule that no check holds, and copies would bring about 55 such names. `next/` at `7c1d073` has none, so its false alarms should be about zero, and the fire count in the PR body measures that. Cost: about 30 lines. Sure: 90%.
5. **An oxlint rule, `no-hand-tag`, blocking in `next/**` leaving out tests: no hand-written `_tag`.** It fires on any object key or type member named `_tag`, `Schema.Struct({_tag: ...})` included. It does not fire on a read, so `x._tag === "a"` and `const {_tag} = x` pass. One edge, by full path in the rule: `data/log.ts`, since the log stores any fact and knows no cases. Tests are left out because a test feeds raw frames. Why: the owner's pick asks for it, and a written rule alone holds nothing. `next/` at `7c1d073` holds no `_tag`, so the fire count there starts with nothing to misfire on. That is no measure of false alarms, and this plan claims no number. Cost: about 30 lines. Sure: 85%. The doubt is an edge beyond the log; a second one comes back to the owner.
6. `next/apps/fabrika/src/exam/no-promises.test.ts`: planted lines, including `Effect.catch(...)`, which must not fire. `exam/no-of.test.ts`: planted `colorsOf`, `IconOf` and `{of: ...}`, which must fire, and `indexOf`, which must not. `exam/no-hand-tag.test.ts`: planted `{_tag: "x"}`, `type X = {readonly _tag: "x"}` and `Schema.Struct({_tag: Schema.Literal("x")})`, which must fire, and `Schema.TaggedUnion({x: {}})`, `Fault.cases.abort.make(...)`, `value._tag === "x"` and `{type: "plus"}`, which must not.
7. `next/apps/fabrika/src/exam/laws-scan.test.ts`, as plan-115.
8. `next/` layers in `layer-rules.json`, for `pnpm lint:layers`, and `exam/layers.test.ts` for skipped layers until demlik issue 763 lands. Both as in the section above. Package rows in `boundary-rules.json`, with new library types, since tuval imports the library and programs import both.
9. `exam/deps.test.ts`, with `exam/layers.test.ts`, for p65.
10. `pnpm-workspace.yaml`'s three globs, `vitest.config.ts`'s new globs, and a `next` job in `.github/workflows/check.yaml`: `pnpm exec vitest run next/`, Chromium, `node next/apps/fabrika/e2e.test.ts`. Electron and launchd run on the laptop first; CI gets Electron once xvfb and the keychain are tried, and the PR says so.
11. PR body: each rule's fire count on PR 223's tree, read by hand. No check blocks until its false alarms are measured.

**Where the exam lives: `next/apps/fabrika/src/exam/`,** since the app may see every package, so a bytes test can bundle by name. Why not a package of its own: one more `package.json` for no gain. Cost: the app's folder holds some files that are not the app. Sure: 80%. Saved letters and vectors stay in `fixtures/next/`, where toy data already lives.

**The small exam PR before PR D,** by an agent that is not the builder. The owner reads it. It holds:

1. p22's new wording, and p25's narrowing. A saved note always folds.
2. `fixtures/next/notes-letters.jsonl`: saved letters p55 reads forever.
3. Ports under the test writer step: `markdown.test.ts`, `highlight.test.ts`, what applies of `index.laws.test.ts`, and what applies of `agents.test.ts`. Each names its source path and commit, as the styling exception does. The laws that must survive: raw HTML never drawn, links only http or https, images as alt text, code as text children; no person-only tool, an agent never writes as the person, a stale base is refused.
4. `next/apps/fabrika/src/exam/agent-may.test.ts`: the door's list for `as: "agent"`, method by method, read by the owner. Any new method defaults to refused.
5. `next/apps/fabrika/src/exam/bytes.test.ts`: the brain's bytes hold no `@modelcontextprotocol`; the box's bundle of `@kampus/notes` holds no `micromark`, `mdast` or `@pierre`.
6. New edge lines, by name: for `no-effect-run-outside-edge`, `mcp/serve.ts`'s `Effect.runPromiseWith`; for `no-promises`, the SDK's async transport in `mcp/serve.ts`, and `import()` in `programs/notes/highlight.ts`. `no-promises`, `no-of`, `no-tea-react` and `no-hand-tag` fire on the copies like any other file: a copy gets no line of its own.

**Exam files for the builder.** Any diff here stops the build and asks the owner: `next/**/*.test.ts`, `fixtures/next/**`, `next/apps/fabrika/src/exam/**`, the oxlint and oxfmt config and plugin folder as PR 226 names them, `vitest.config.ts`, `.github/**`, `layer-rules.json`, `boundary-rules.json`, `pnpm-workspace.yaml`. A package's own `package.json` is the builder's, since its `exports` map says what is public, and p65 reads it. The test versions in `next/packages/tuval/src/headless/` are product code, not exam files; the tests read them only through the names in the interface block.

**Order problems,** plan-115's stand: plan before exam, the exam sees nothing on main, PR 223 goes red when rebased on it, and that is intended. T0 turns p65 green. PR 223's `window/main.tsx` uses `useRuntime`, so `no-tea-react` is red until the hook lands. That is why the hook comes with T5, in PR A, which already changes that file. Later PRs extend the exam only through a small exam PR of their own. `tuval-*` rows are in the table and rules from the start, so B needs none.

## Dropped from plan-115, and what can wait

**Dropped:**

- "Behavior does not change." Hello, grant, client names, stage and style all change, on purpose.
- Biome rules. They become oxlint JS plugin rules.
- Raw Miniflare in `brain-host.ts` and `unsafeDirectSockets`.
- The old speed caps' start numbers.
- Its Q1 and Q2, now my decisions.

**Dropped from this plan's earlier draft:**

- The passphrase founder key, and every rule around it. It is no longer needed in this tier.
- `may: ["chaos"]` on a grant, its founder-only signing rule and `not_founder`. They guarded only against a person's own keys. Nothing is lost: a grant with no `may` still reads the same if a rule arrives later.
- `invited` and `removed`, and `grant.ts invite` and `remove`. Invites and join go to Tier 3.
- `--founder` as the only way to found. It stays for agents and tests, next to the founding screen.
- The agent smoke run in the owner's granted browser profile.
- Folders in `next/`, split ready for later. Real packages replace them, and so does `@fabrika/next`.
- A rename at the end. `next/` has its real names from day one, and today's `-old` packages are deleted when it retires.

**Kept:** `Ledger.sql` and `.remote`, `LedgerError`, Mailbox, ProcessManager, `stepper`, `ProgramRunner`, `answerFrame`, one runtime per object, no failing Layers, no finalizers, laws p1 to p24, the exam's shape, the mutation seed.

**Waits, with no fact lost, and with a tier now. Each tier here is a proposal, marked under Later tiers:** `keep` and Topic in Tier 2; GitHub as a keys source in Tier 3; C2 to C5, leases, hands as a client and `kill_brain` as a button in Tier 4; limits in Tier 5; D4's poke, the note's T7 as a Sub, paging, and native `<dialog>` and `popover` against Zag in Tier 6; packs, `limits: {cpuMs}` and signing each letter in Tier 7.

**Waits, with a tier now, since they had none:** split, close and prefix keys in Tier 2; drag, zoom, workspaces and the palette in Tier 6. Today's version does all of these daily, so handover cannot finish without them.

## Later tiers

There are seven tiers, in a proposed order, 60% sure on Tiers 3 to 6, and each is one pass across all five layers. This plan covers Tier 1 only: it works, with notes as its real program, a counter as the test, the menu bar, Cloudflare and chaos. A concern raised at any time gets a tier, and it's never dropped. The order is not settled. The doubt is whether agents should come before the collaborator. Splitting the old Tier 4 into hands and agents, which makes seven, is proposed too. Tiers can be restructured freely: a tier that grows too big gets split, and size never pushes work out of a tier.

**Where notes might go.** This path is a vision, not a promise. Use of it decides whether they grow at all.

- **Tier 1:** agents write through MCP, the owner reads drawn and adjusts, history, every window. No tabs, comments, search, sharing, live co-editing, any CRDT, delete or typing in place.
- **Tier 3:** a collaborator reads and comments, so sharing and comments land here.
- **Tier 5:** a comment wakes the agent that wrote the page, which then runs in its box.
- **Tier 6:** plans live here, and an approval is tied to the exact version read. `base` and the full history are why that would work. Formatted typing in place lands here, if reading then pressing edit is too slow. As a proposal, so do tabs, search and deleting a note.
- **Tier 7, as a proposal:** live co-editing, any CRDT, and pages that run code in a box.

No fact is lost by waiting on any of these. Each adds a kind of fact, and old saves still fold.

**Replacing the Mac matters once notes are real.** The text is safe on Cloudflare. But the person key is on that Mac, and in this tier a new Mac means a new ledger. **If the owner would miss their notes, the backup sheet and recovery move up from Tier 3,** to right after PR D. Using it tells. Cost: a new fact, `added`, on a list kept for it, plus the sheet. Nothing is lost by the wait except the time it stays a risk. Sure: 70% that it moves up.

**Tier 2, programs that work on tickets.** The first tile runs `tracker | ticket`.

- Tracker as a picker. Its pick is a typed output (biggest call 9); nothing lost.
- Ticket. It takes a ticket on a typed input (biggest call 9); nothing lost.
- `fabsh`, the shell in `next/`. Today's version keeps `tsh`. It reads the ports programs declare; nothing lost.
- A tile can start from a saved line. Records no fact from Tier 1's time; nothing lost.
- Split, close and prefix keys, since `tracker | ticket` beside `fabsh` needs them. They arrive with the desk.
- The desk, `next/programs/desk`, built in as `fabrika/desk`. Layout and focus move into it, on the same Cmds as any program, with a grant for any start or monitor power it needs. Focus mirrors between windows again, and `runs` lists tiles. Tier 1 keeps no layout or focus as facts, and has none to lose.
- `keep`, as a proposal: the tracker's filter is the first thing that needs it. Filters stay in the window's machine until then; nothing lost.
- Topic, as a proposal: `tracker | ticket` is the first case that may need to read outside an inbox. A later Topic reads the same streams; nothing lost.

**Tier 3, two people.**

- Typed codes on Cloudflare. `saw.how` gains a word; nothing lost.
- Invites and join. New facts on a `founded.keys` list; nothing lost.
- Backup sheet and lost-Mac recovery, plus the `added` fact. A new fact, and `founded.keys` is a list; nothing lost. Moves up if the owner would miss their notes, as above.
- Windows list tile, in full: last seen, host, every tab. The panel's small list and Remove land in Tier 1. It folds from grants, `revoked` and `door/hellos`, kept now; nothing lost.
- Docked-Mac password helper. **`saw.check` is kept in Tier 1 for this;** old grants say how their person was checked.
- GitHub Actions releases. Records no fact.
- Who may start chaos. `by` comes from the checked key on every letter, kept now; nothing lost.
- GitHub as a keys source, as a proposal: a collaborator's keys are the first ones not made on this Mac. `founded.keys` is a list; nothing lost.

**Tier 4, hands. Proposed: this splits the old Tier 4 in two, which makes seven tiers.**

- The queue, claims and leases. `by` on each letter is kept now; nothing lost.
- C2 to C5, as a proposal: work queues and running hands are the first to need them. `by` and `for` are kept now; nothing lost.
- Mac and VM hands, and hands as a client, as a proposal. `has` is in every hello from Tier 1; nothing lost.
- A first tab that runs a job, and how a client says it takes jobs. `has` says what a host can do, so it can't also say that. Proposed, not decided, as `brain-hands-window-agent.md` says. Job code beside a window's key needs a sandbox first. Nothing lost.
- `kill -9` from chaos through real hands, and `kill_brain` as a button, as a proposal: the button needs hands to do the kill, as biggest call 6 says. The facts have the same shape; nothing lost.
- Secrets and the terminal tile. They record no fact from Tier 1's time; nothing lost.

**Tier 5, agents join. Proposed, as the other half of that split.**

- Agent box. Records nothing from Tier 1's time; nothing lost. It stays here, though real notes make its trigger closer, as [Agents through MCP](#agents-through-mcp) says.
- Agent grants in wider use. **The first real use moved up to Tier 1,** on notes only; `as` is why old grants say what they let in.
- Spend, limits, the `claude` and `codex` programs, hands running agents, chat tile (not a copy of regular chat), asks list. All stay, and limits are a proposal; `by` and `for` on each letter are kept now, so nothing is lost.
- Repo programs, in `.fabrika/programs`, lean about 60%. Records no fact from Tier 1's time; nothing lost.

**Tier 6, daily use.**

- Today's version hands over its jobs one at a time. Its own logs stay where they are; nothing lost. Its `-old` packages are deleted as it retires, with no rename, and `@kampus/pipeline` is rebuilt here.
- Drag, zoom, workspaces and the palette, since handover needs them. Records no fact from Tier 1's time; nothing lost.
- Formatted typing in place, for notes. The body stays raw text; nothing lost.
- Tabs, search and deleting a note, as a proposal, since daily use asks for them. A later `archived` fact can hide a note; nothing lost.
- D4's poke, the note's T7 as a Sub, and paging, as a proposal: reconnects and long histories under daily use. Records no fact; nothing lost.
- Native `<dialog>` and `popover` against Zag, as a proposal: the palette is the first thing that may need one. Records no fact; nothing lost.

**Tier 7, others use it.**

- Apple signing. Keys and grants are facts already; nothing lost.
- Auto-update. Each hello records its code and versions; nothing lost.
- Windows and Linux `PersonCheck` versions. `saw.check` covers them, and `check` gains a word.
- Phone as approver. `signed.signer` and `saw.where` are kept now; nothing lost.
- QR. `saw.how` gains a word; nothing lost.
- Packs, `limits: {cpuMs}` and signing each letter, as a proposal: they matter once other people's programs and more than two people arrive. `by` comes from the checked key; nothing lost.
- Live co-editing, any CRDT, and pages that run code in a box, for notes, as a proposal. The raw text and every version are kept; nothing lost.

Their open questions wait with them.

**The check.** If adding an item later loses a recorded fact, that fact stays in Tier 1 and this list says so. `saw.check` is the one field the check added. Ports are not a fact: they are in Tier 1 so Tier 2 needs no rewrite (call 9).

## Pointers

- `next/` at PR 223: what is being changed.
- [Plan-115](./ticket-115.md), for p1 to p24 and its gaps.
- Today's version, to learn jobs, never to import: `packages/fabrika/src/host/door.ts`, `keys.ts`, `sshsig.ts`; `packages/ledger-server/src/stack.ts`; `apps/fabrika/src/main.ts`, `apps/fabrika/e2e.ts`; `packages/pipeline/src/stages/mutation/`.
- Today's version, under the named exceptions, at `2c29c13`: `programs/markdown/src/`, `packages/fabrika/src/mcp/tools.ts`, the `.markdown*` rules in `apps/fabrika/src/window/window.css`. To learn from and not copy: `mcp/drive.ts`, `mcp/serve.ts`, `apps/fabrika/src/host/agents.ts`.
- `experiments/144`, `147`, `171`, `173` for the cloud numbers.
- Notes: `a-local-first-sync-engine.md`, `a-browser-is-always-a-client.md`, `the-ledger-goes-to-cloudflare.md`, `the-desktop-layer.md`, `the-cloud-is-one-more-host.md`, `local-is-the-cloud.md`, `object-classes-stay-thin.md`, `no-promises.md`, `next-is-a-pipeline-pre-run.md`.
- `docs/direction/brain-hands-window-agent.md`: what a host, hands and capabilities mean.

## Pipeline gaps

Plan-115's list stands, with these added:

1. **"One plan, one PR" against a pass this large.** No note says how a plan splits into landings. Resolved: tasks name their PR, and the owner settled five.
2. **What a test writer does with a Property that needs a person.** p41's deploy needs a yes, the real finger needs the owner, and only the owner can say no prompt appeared. Resolved: a test `PersonCheck` in the laws, and a run recorded in `field/` for the rest.
3. **Rethink against "copy the styles".** A named exception has no marker a check could read. Resolved: a comment naming source and commit, read at c7.
4. **A law on an outside tool.** `sshsig` vectors come from `ssh-keygen` once and are saved; p29 runs it live. The notes do not say which is right. Both, here.
5. **Tests that hold a port across a stage.** Exp 171 says one process cannot reuse a port. Resolved: tests spawn `dev.ts`.
6. **Where a chaos finding goes.** It may be a real bug in another layer, in the middle of PR E. Resolved: a finding goes to the owner and `field/`; the builder does not fix it in place unless it is in the task's files.
7. **A law that needs the laptop's own service manager.** p48 runs real launchd, and CI has none. Resolved: laptop only, the PR says so, and CI runs the steps on the test `BrainService`.
8. **A later check with an end date.** `layers.test.ts` lives until demlik issue 763 lands. No note says who removes it. Resolved: the small exam PR that adopts the new code-graph.
9. **A plan ahead of the notes.** The plan now differs from notes in `docs/direction/`, and the steps do not say which lands first. Resolved here: those notes get their change in a docs PR of their own, before PR A. That now includes real notes on the cloud, chaos on a throwaway ledger, and `refuse`.
10. **When lab data turns real.** `next/` may be rough until a person opens it for real work, and no note says what happens when one job opens first. Notes make one ledger real while the rest stays a lab. Resolved: from PR D the cloud ledger is kept for good, and the laptop stage stays a lab.
11. **A later PR changes an earlier law's meaning.** Notes change p22 and narrow p25, both written for PR A. Resolved: a small exam PR before PR D, not a builder's edit. No note says a law's old wording must stay readable.
12. **"Only this process" when many windows share the process.** The three homes do not say whether state that looks per-process is really per-window. Which note is open looked like the first and is the second. Resolved: the window's machine. The note should ask "does each window want its own?".
13. **A saved law must also bind to old data.** Every law so far tests code against today's shapes. Real notes need one against yesterday's letters. Resolved: `fixtures/next/` keeps PR D's first letters, which p55 reads forever. No note names this kind of fixture.
14. **How to run the steps on copied code.** The rule is "never copy", with named exceptions. No note says who ports a copied file's tests, or how a builder fits a copy without rewriting it. Resolved: the test writer ports tests, the first commit is the copy unchanged, and the mutation sample treats copied code as any other.
15. **A rule with an owner-allowed exception grows.** Styling, drawing, and now tools. "Never copy across" has three exceptions, each a comment read at c7. No check counts them. Resolved: c7's read, and the owner names each one. A fourth should make us read the note again.
16. **A decision can change after the plan was written, mid-plan-stage.** The agent path changed from a command to MCP in one sitting, and the plan stage has no word for a rework on its own draft. Resolved: edit the plan before any test writer starts; nothing was built.
17. **Today's rule, tomorrow's reason.** "An agent gets its own run" came from a reason that does not hold in `next/`. Porting the rule would have hidden the agent's doc. Resolved: biggest call 16. Rethink-do-not-port covers it, and the plan names the difference.
18. **A written rule with no home.** "No `xOf` names" lived only in private memory. No check held it, and no note or `AGENTS.md` said it, so a copy would have passed every step. Resolved: `no-of` in the exam PR, and a line in the docs PR. The steps have no moment that asks "where does this rule live?".
19. **A plan can't assume what strict `node_modules` stops.** A root `package.json` that depends on a package makes it resolve from every folder below. So a law on `package.json` alone would have looked strong and stopped nothing. Resolved: p65 reads the imports too. Exam laws should plant the thing they claim to stop.
20. **An exam needs a home before the code has one.** The exam PR writes to `next/apps/fabrika/src/exam/` before T0 makes that package. Resolved: it runs from the root's vitest, with the root's tools, until T0.

## What this plan cannot tell us

- **Nothing was built or run for this plan,** except a scratch file that typechecks and runs the [Tags](#tags) schema sketches on effect 4.0.6. It rests on reading, plan-115's probes and past experiments. No fresh number.
- **What `no-hand-tag` cannot see.** A new union hand-written under another key, such as `kind`, passes the rule. Review has to catch it. Whether the rule misfires on real code is not measured yet.
- **Whether a non-extractable key in IndexedDB survives** on Chromium, Safari or Firefox over reload and restart. The browser note says not tried. T5 spikes Chromium only. Whether Safari treats 127.0.0.1 as secure is a guess.
- **Whether `safeStorage` is smooth** under Playwright, and whether a dev Electron signed by a self-made card still prompts for the Keychain. Only a run shows it, and the window key has a way out.
- **Whether launchd takes a brain from an unsigned build,** whether Touch ID prompts from it, and whether IndexedDB holds a key in a local page. T8's spikes tell, and each has a way out.
- **How the menu bar feels.** Nobody has built one here. No mockup and no run.
- **How long a row lasts on Cloudflare,** where objects sleep. T11 measures it.
- **React's memory with many hidden tiles, and all of it on Safari.** The probes covered Chromium, part of Firefox, and toy trees.
- **What Cloudflare really does to this shape:** isolate cold load, `abort_all`, a redeploy mid-run. All first seen at p41 and p39.
- **What the stage does to the speed bar.** Alchemy's relay adds little by exp 171's number, but this exact flow has not been measured.
- **What the copied code carries over.** It was written for a program that showed one text and quit. Its tests come with it, so its bugs may too. Only use and the mutation sample tell.
- **Whether reading then pressing edit is enough** to adjust what an agent wrote. Use of it will tell. If not, typing in place moves up from Tier 6.
- **How often a stale save happens, and whether "Keep mine" feels right.** Use tells, as it does for how an agent takes a refusal in words.
- **How `@pierre/highlights`, a beta, behaves on a phone and under the policy.** The 7 ms color time is from the Electron app. Today's numbers do not carry to a phone.
- **How long a long doc takes to parse and draw,** at phone speed. Nobody has timed it. It only parses while reading, so typing is not slowed.
- **Whether Claude Code and other clients take the tools as made, and take a "waiting for the owner" answer well.** T21's spike tells for the first; nothing here tells for others.
- **Whether the door's agent rules are enough for real notes before the box.** The owner weighs that after real use.
- **How long a wake takes with a real history.** Nothing has measured a fold of many full bodies on a sleeping object. T17 and p58 record it. The 500 saves a day and the 1.5 s pause are guesses.
- **Whether the owner's phone keeps a let-in key,** and how a tile feels at that width with a keyboard up. WebKit has said it can clear such storage after seven days without a visit, which would mean a new Approve. Not tried here.
- **Whether chaos on a throwaway ledger says enough about the real one.** Same code, same stack, but less history. A bug that needs a large log would not show.
- **Whether chaos finds real bugs.** A clean run means little until the plant in p39 shows it can catch one.
- **A seed does not replay a run.** Only the fault list repeats.
- **Whether oxlint's alpha plugins hold.** PR 226's first count is the evidence.
- **Whether code-graph and esbuild behave across the new packages as their source reads.** Neither was run for this plan. T0 runs both first, and code-graph's handling of two-level workspace globs is the part least sure.
- **Whether `.` of `@kampus/libfabrika` stays small,** or a program keeps needing lower names. Notes is one customer. Tier 2's programs tell.
- **Whether a hello's `has` stays true.** A tab can lose the screen when it's hidden, and Touch ID goes on a docked Mac, while a hello is said once. Nothing reads it yet, so nothing breaks. Whoever reads it first settles this.
- **The size.** 50% sure, as above.

## Settled by the owner

**Three questions are still open:**

- **How this plan enters the pipeline:** a plan written by hand meets a pipeline that starts at triage, so how does it go in, and which ticket do Tier 1's pull requests run under? No lean yet.
- **`transport/link.ts`:** does it stay in the library? Lean: yes, since the MCP bridge dials too and can't import tuval. Sure: 75%. T0 moves files, so this needs an answer before PR A.
- **Backup:** does it move up from Tier 3, for real notes? Lean: yes, to right after PR D. Sure: 70%. This needs an answer before PR D ends.

Every other old question closed this way.

- **Q1, the PRs with the demo growing in each:** yes, with the menu bar in PR B. Four then, and five with notes.
- **Q2, the founder key:** the passphrase key is no longer needed in this tier. The founder's key is the app's person key. What stays is the condition, as a law: opening a let-in tab or Electron window, and reopening after a quit, shows no prompt of any kind. If the Keychain asks on open, the window key moves to WebCrypto, and the plan does not stop. Cost: a lost Mac means a new ledger in this tier, since recovery is in Tier 3. With real notes that cost is close, so [the backup can move up](#later-tiers).
- **Q3, how a new window comes in:** the menu bar's row, Approve and a finger, on both stages. The terminal command is the way in only until PR B brings Approve, and a developer path after that. QR is in Tier 7.
- **Q4, chaos:** off on the real ledger, on a throwaway ledger by default, and on the real one only by a deploy with its name typed out. The owner settled the rule, and the shape is my call, 85%. This replaces the earlier "on, on both stages": notes are the real work that answer was waiting for.
- **Q5, the address:** Cloudflare's default address for a Worker. My call, 85%.
- **Q6, the tiers:** seven, in a proposed order under [Later tiers](#later-tiers), not settled, 60% sure on Tiers 3 to 6. The first tile in Tier 2 runs `tracker | ticket`. The shell in `next/` is `fabsh`.
- **Q7, the first real program:** notes, with the counter as the test. The owner settled what it does and what it leaves out, and that it is dogfooding: agents write, the owner reads and adjusts. Its order among the PRs and its stale screen are my calls, 85% and 80%.
- **Q10, Markdown:** notes draw it in Tier 1, copied from `programs/markdown` by the owner's named exception. Reading and editing are two views.
- **Q11, agents:** through MCP, as a headless client let in once per name. Today's MCP work may be copied as [Agents through MCP](#agents-through-mcp) says.
- **Q8, Remove:** in the menu bar's panel, with the same check as Approve. The full list stays in Tier 3.
- **Q9, where real notes live:** on the Cloudflare copy once it exists. The laptop stage stays for tests and development. The setting's shape is my call, 75%.
- **Q12, the layout:** real packages under `next/`, in one workspace, with real names from day one. Today's two are `-old` and are deleted later, with no rename. Which names sit on which subpath is my call, 80%.
- **Q13, where Tuval lives:** fabrika is the logic, and Tuval is the projection of it. `@kampus/tuval` holds all client logic and may import the library, never the other way. The app is only wiring and the deploy stack. The desk is a program in Tier 2, and Tier 1 has no desk process.
- **Q14, hosts:** a host is a place hands can run: a Mac, a VM or a browser profile. Hands and window are jobs, not places. In Tier 1, `Backend` becomes `Host`, the hello's `has` carries each Layer's list, `saw` records it, and the menu bar shows hosts. The hello's `backend` and `Host`'s field becoming `platform` is my call, 80%. Tiers can be restructured, and size never pushes work out of one.
- **Q15, the tag key:** `_tag` for every union we define, never by hand. tea's Msgs and Cmds keep `type`, and third-party shapes keep theirs. A lint rule holds it. See [Tags](#tags).

**Left open until Tier 6, as a proposal, no answer needed now:** native `<dialog>` and `popover` against Zag.
