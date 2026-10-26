# 148. Remote programs: a project's host on Cloudflare, each job on its starter's key

The question: can fabrika programs run as jobs on a project's host on Cloudflare, each job on the
Claude Code key of the person who started it, with that key never inside a box? The direction
changed while this ran ([tea-host.md](../docs/direction/tea-host.md), 2026-10-25): the host is
not a long-lived container. It is a Durable Object that wakes on a message or an alarm, steps its
programs, writes the ledger and sleeps. A container is only for a job that needs a real machine,
one per job.

**Answer: yes, locally and on Cloudflare, the box included. Real Claude Code ran in a box on
Cloudflare on its starter's own subscription token. Confidence 80%.**

- **tsh and its programs run inside the project's object.** The counter, `jobs`, `tell` and
  `attach` work as on the laptop. The Worker bundle is 1.26 MB (1.38 MB with the live box round's
  additions) with no `node:` import. On Cloudflare the same object ran tsh and the counter, slept
  when idle, and every wake brought the counter back where it left off.
- **A job that needs a machine gets a box of its own.** Locally (workerd and Docker) a box starts
  in 0.4 to 0.7 s. On Cloudflare the first box after a deploy took 8 to 10 s (once 30 s), and
  later boxes 0.5 to 2.2 s (once 9.3 s), from start to the box's first call out. The box goes when
  the job ends.
- **On the stand-in path, the key stays out of the box.** The box's call to the model is caught
  outside it, and a Worker adds the starter's key. Live: each person's call carried their own key,
  a person with no key got 403, and a probe as root and as the job's user read 7,249 files, every
  process's environment and 769 MB of memory, and found no key, no sealing secret and no session.
- **The decided design ran once: Claude Code 2.1.310, unmodified, in a box on Cloudflare, on its
  starter's own `CLAUDE_CODE_OAUTH_TOKEN`.** It answered "Hi there!" in 1.6 s (1.3 s of it the
  API), the whole job 4.8 s. The box reached `api.anthropic.com` and nothing else. See Q6.
- **Facts carry the starter's stamp.** Every job's change lands on the project's ledger as
  `agent:host for:github:1`: 53 rows in the local run, 17 to 48 live.
- **One rule, now seen live: a job's object stays awake while its box runs.** With the 5 s beat, a
  40 s job ended right with 8 beats. With no beat, Cloudflare cut the box at 26 s, twice, as
  workerd did locally. The project's host still sleeps, and a job's end woke it 0.3 s later.
- **A destroyed stack leaves its image behind.** Alchemy's destroy removes the Worker, its
  namespaces and the container application, not the registry image. The cleanup deletes the
  image's tags; one platform-made layer per deploy cannot be deleted through the registry (409).
- **Spent: about $0.05 at most.** Nine live deploys in the box round (two refused by Alchemy
  before any upload), all destroyed. One real model call, on the owner's subscription; every
  other model call went to a stand-in.

```ts
// The whole idea (148-remote-programs/worker.ts), as it ran.
//   laptop, WebSocket -> door (Worker) -> ProjectHost (one object per project)
//                                         tsh per person, programs, sleeps when idle
//   box --run 'node /app/ask.mjs hi'      a job that needs a machine
//     ProjectHost -> JobBox (one object per job) -> start a box (Docker locally)
//     box: POST http://model.internal/v1/messages     no key, a placeholder
//       caught outside the box -> ModelRelay (props: project, who, job)
//         Person(who).open(): the key, sealed at rest -> x-api-key -> the model
//     box: POST http://host.internal/done {said, code} -> JobBox.finish -> ProjectHost.jobDone
//   every change -> Ledger(project): jobs/<who>/inbox, writer "agent:host for:<who>"
```

## What 127, 128 and 137 already showed

This run reuses them. It does not measure them again.

- [127](./127-agent-in-a-box.md): Claude Code as a whole runs in a box (srt and Docker), with a
  token, a settings folder of its own and `CLAUDE_CODE_TMPDIR`.
- [128](./128-program-in-a-box.md): a fabrika program runs in a box behind a runner, values
  checked with the program's own shapes on both sides, and the host's key stays outside.
- [137](./137-key-outside-the-box.md): the model's calls go through a relay outside the box. A
  placeholder in the box, the relay drops every credential header and adds its own. A
  subscription login worked that way, with a per-box cap.
- 144 ([pull request 99](https://github.com/usirin/tea-fabrika/pull/99)): a Durable Object is
  evicted after about 10 s idle.

New here: the host is a Durable Object; one box per job, started by the object; the relay is a
Worker that the box's calls are caught into; each person's key lives in their own object; the
job's facts on the ledger; sleep and wake.

## Who did what

All of it was this repo's code. No fabrika agent and no fabrika ledger took part. The ledger is
`packages/fabrika`'s own `Ledger` Durable Object, unchanged. The people were made-up sign-ins
played by the driver, `github:1` and `github:2`, and `github:3` with no key.

In the live box round: the driver `148-remote-programs/live-box.ts`, the Worker and the box files
are this repo's. Alchemy 2.0.0-beta.84 built and pushed the image and deployed. The one real
model call ran Claude Code 2.1.310 from npm, unmodified, inside the box, on the owner's own
subscription token. Nothing of today's fabrika took part.

## How it was measured

```sh
# local: workerd and Docker through `alchemy dev`, a stand-in model, made-up keys
env -u TYPESAFE_API_KEY nice -n 15 node experiments/148-remote-programs.ts
# live: the same stack on Cloudflare, from code, without the box
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live
# the live box round: small (a first box, the asks) or full; with TF_CLAUDE_TOKEN, Claude Code too
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live-box full
#   then `live-box sweep`: list by the tf-exp-148 prefix and delete what is there
```

- The live box round's answers are in `results/148-remote-programs-live-box.json` (full),
  `-live-box-2.json` (a second full run), `-live-box-token.json` (the real call) and
  `-live-box-token-probe.json` (the probe with the token in the box, no model call).

- `148-remote-programs/stack.ts` is the one stack, with a `local` and a `cloud` stage
  ([local-is-the-cloud](../docs/direction/local-is-the-cloud.md)). No `Alchemy.remote()`.
- The live part deploys from code as 147 ([pull request 100](https://github.com/usirin/tea-fabrika/pull/100)) does: `deploy({stack, stage: "cloud"})`
  from a fresh temp folder, credentials through the stack's `secrets` Layer, `DO_NOT_TRACK=1`.
  The temp folder, with Alchemy's state in it, is deleted at the end.
- Every secret is made up per run, in a shape the probe looks for: `fake-key-<32 hex>`,
  `seal-<32 hex>`, `sess-<32 hex>`.
- The stand-in model (`standin.ts`) answers `standin answered <who>` for a key it knows, and logs
  which header names came.
- Eviction locally: the driver calls `ctx.abort()` through `/evict`, which throws the object away
  and keeps its storage. Live: nothing but waiting.

## Q1. Real programs on the host, the ledger is the project's

```ts
// host/session.ts: one person's tsh, on the object's own storage. No platform names in it.
const s = await openSession({who: "github:1", kv: ctx.storage.kv, boxes, out, fact});
await s.line("counter &");          // [1] counter:6d958f6a
await s.line("tell %1 press plus"); // the count is kept in the object's storage
await s.line("box --run 'node /app/ask.mjs hello'"); // a box for this one job
```

| What | Local (workerd) | Live (Cloudflare) |
|---|---|---|
| `counter &`, prompt back | 10 ms | 78 to 147 ms (from the laptop) |
| `jobs` after 3 presses | `[1] running counter / 3 so far` | the same |
| a model call from a box, start to answer | 2.5 s (box start 0.4 to 0.7 s) | 1.6 to 3.0 s (stand-in); the first box after a deploy 8 to 10 s, once 30 s |
| ledger rows, writer | 53, all `agent:host for:<who>` | 17 to 48, the same; none refused |

- **The program that calls a model is `box`**, a small program in `host/session.ts`. Its flag is
  the command. It keeps the job's id in its own machine, so a reattach after an eviction asks the
  same box again, never a second one.
- **The ledger write needed one change.** The ledger denies a write under a name nobody
  registered, and a registered name takes writes only under a lease. A lease needs renewing, and
  renewing keeps the object awake. So the host registers `jobs/<who>` once per wake and writes to
  that name's inbox, which is open. First run: 44 of 44 writes refused, `unknown`. After: 50 of
  50 written.
- **A wake writes its jobs again.** Each wake noted the reattached counter as `job_began` and two
  `job_moved`. That is noise on the ledger, and a reader should not count it as new work.

## Q2. tsh on the laptop, a job on the remote host

```ts
// attach.ts, the laptop side. The line editor stays on the laptop.
//   up:    {type: "line", text: "counter &"}
//   down:  {type: "opened", ms, attached, born, fresh}   the host opened this person's tsh
//          {type: "printed", text}                       what tsh printed
//          {type: "ready"}                               the prompt is back
const a = await attach("https://<host>", "p1", session);
a.line("counter &");   // [1] counter:4f82a41f
a.line("jobs");        // [1] running counter / 3 so far
```

- **What crosses the wire:** whole lines up, printed text down, as JSON on a WebSocket. No
  keys, no screen. The session rides in the query string on attach, because a browser's
  WebSocket can set no header.
- **It is not PR 90's link.** PR 90 (merged as `apps/fabrika`'s host) speaks NDJSON on a Unix
  socket with a version handshake; the host owns the line editor, gets every key and sends the
  screen. Over the internet each key would wait a round trip (143: 0.4 ms on the laptop; here a
  status call took 110 to 530 ms). So for a remote host the line editor should stay on the
  laptop, and only lines cross.
- **Recommendation: one link schema, two transports.** Keep PR 90's message shapes and
  handshake, and add a "line" mode for a remote host. Effect's `Socket` covers a Unix socket and
  a WebSocket alike. Cost: one more mode in `link.ts`. **How sure: 65%.** The doubt is whether
  full-screen programs on a remote host need keys, not lines. A run of a full-screen program on
  the live host would settle it.

## Q3. The key stays outside the box

This is the stand-in measurement: a made-up key, added by a relay outside the box. It is not the
decided design for the model login any more. A job now runs on its starter's own subscription
token inside its box (Q6). The relay stays the measurement of how a key can be kept out.

```ts
// worker.ts, JobBox.begin: the box can reach two names, both caught outside it.
this.box.start({image: this.box.images.Job, enableInternet: false, env: {JOB_CMD, JOB}});
await this.box.interceptOutboundHttp("model.internal", ctx.exports.ModelRelay({props}));
await this.box.interceptOutboundHttp("host.internal", ctx.exports.JobDone({props}));
// ModelRelay.fetch: POST /v1/messages only; the job's call cap; the starter's key; three headers carried
headers.set("x-api-key", await env.PEOPLE.getByName(who).open(who));
```

| Check | Local | Live (Cloudflare) |
|---|---|---|
| github:1's call | `standin answered github:1`, with `x-api-key`, no `authorization` | the same; headers `anthropic-version, content-length, content-type, x-api-key` |
| github:2's call | `standin answered github:2` | the same |
| github:3, no key | `403 github:3 has no key yet` | the same |
| probe as root | 6,691 files, nothing found; other users' `/proc` refused (EACCES) | 7,249 files, 3 processes' environment and 769 MB of memory, nothing found; no `/proc` refused |
| probe as the job's user | 3 processes' environment, command line and 1.19 GB of memory, 6,676 files, nothing found | 7,249 files, 769 MB, nothing found |
| key at rest | the row holds `who`, `iv`, `sealed`; not the key text | not read again live |

- **Live, the stand-in is the Worker's own second entrypoint** (`Standin` in `worker.ts`). The
  relay calls it through `ctx.exports`, so no model call left Cloudflare. It names the header
  names it got: no `authorization`, so the box's placeholder was dropped.
- **Live, root in the box could read the job's processes.** Locally root was refused another
  user's `/proc` (EACCES); on Cloudflare it read all three. The box runs as one user in one
  container either way, so the job's user can read them too.

- **The props are the job's identity.** `ModelRelay` gets `{project, who, job}` from the object
  that started the box, not from the box. The box cannot say whose key to use.
- **Root in the box cannot read the job's memory.** Root has no `CAP_SYS_PTRACE` there. The probe
  runs a second time as the job's own user to read it. *Wrong live: on Cloudflare root read every
  process. True of local Docker only.*
- **A box with 256 MiB was too small for the probe.** It was killed (137). The box now asks for
  1/4 vCPU and 1 GiB. Locally workerd refuses the name `"basic"`, so the size goes in numbers.
  Live, the size goes in numbers too: Alchemy refuses `instanceType` (and `name`) on a container
  application owned by a Durable Object, and says to pass the size to `start()`. 1/4 vCPU and
  1 GiB at start worked on Cloudflare.

**Where each person's key lives: in their own Durable Object, sealed.** `Person(who)` keeps
`{who, iv, sealed}`: AES-GCM under a key made with HKDF from one Worker secret (`KEY_SEAL`) and
the person's id. Only `ModelRelay` opens it, per call.

- **Why:** one object per person, so a person's key is read only on their own job's calls. A
  Worker secret never reaches a box or the ledger. It costs nothing to run and needs no new
  service.
- **Other options:** Secrets Store is per account, set by API, not per person at run time. A key
  kept on the laptop and relayed from there stops working when the laptop sleeps, and a job runs
  while it does. Workers KV gives nothing a Durable Object does not.
- **Cost:** one secret to rotate (`KEY_SEAL`), and whoever holds it and the storage can open
  every key.
- **How sure: 65%.** The doubt is not the code. Anthropic's terms forbid a platform to "collect,
  store, or intermediate Claude.ai credentials". A Console API key fits this design. A
  subscription token (`claude setup-token`) probably does not. What would settle it: ask
  Anthropic, or use only Console API keys on the cloud host and subscriptions only on laptops.
  *Decided the same day: no Console API keys, on the cloud host either. A job runs on its
  starter's own subscription token, so the second way out is closed. How that token reaches
  Claude Code within Anthropic's rules is open, in
  [programs run in a box](../docs/direction/programs-run-in-a-box.md#still-open).*

## Q4. Sleep and wake

| What | Local | Live |
|---|---|---|
| idle, page closed: evicted after | (driver, `ctx.abort`) | 15 s, 30 s, 70 s: evicted each time |
| idle 30 s, page open | | evicted; a line on the same page woke it |
| reopen tsh and attach every job | 2 to 11 ms (inside) | `opened.ms` 0, see below |
| attach from the laptop, host asleep | 5 to 15 ms | 330 to 720 ms (one outlier: 14.4 s) |
| attach from the laptop, host awake | | 240 to 430 ms |
| live timers between messages | 0 | 0 |
| alarms on the host | none | none |
| a box job's end wakes an evicted host | yes, 4.5 to 5 s after (the job slept 4 s) | yes: the job ended at 41.2 s, the host woke at 41.5 s |

- **Everything comes back.** After each wake the counter was `attached` again with its count, and
  `press done` printed the right number. A job of a box comes back with the same job id and
  finds its box done.
- **On Cloudflare the clock stands still while code runs.** `Date.now()` moves only on I/O, so
  the object cannot time its own rebuild (`opened.ms` was 0 every time). The laptop's numbers say
  a wake adds about 100 to 300 ms over an awake host, and that includes the WebSocket handshake.
- **The first `jobs` after a wake can come before the job's state.** It printed
  `[1] running counter` without `3 so far` once. The next `jobs` had it.
- **One first attach took 14.4 s,** in one of three live runs. The others took 1.0 and 1.2 s. Not
  explained.
- **Output printed while no page is open is lost to the page.** The box's output is kept on the
  ledger (`box_ended`, `said`), so a page can read it there.
- **Live, a box job's end sometimes never reached a page that stayed open.** Twice in the live
  box round: once for a 61 s job, once for an 8 s `echo`. The job's row said `done`, with its
  output; the page waited 90 s and heard nothing. After the second, tsh on that page stopped
  answering. The driver then read the job's row instead of the page. Not explained: the host may
  have been evicted with the page's socket in between, and the end then went to no one.
- **How the wake was seen.** `ProjectHost` keeps the time of each of its wakes (`/status`,
  `wakes`). In the beat run it woke at -1.3 s, 41.5 s and 79.1 s, around a job that ended at
  41.2 s. So the job's end woke it, 0.3 s later.

**The job's object beats while its box runs.** Locally, a 25 s job never ended: the job object
was dropped while idle, and the box with it. Now `JobBox` sets an alarm every 5 s while its box
runs. It checks the box is there and the job has time left. A 40 s job had 8 beats and ended
right. Cloudflare's own `Container` class keeps an alarm going the same way, by its docs. Only the
job's object stays awake, and only while its box runs.

Live, the same. With the beat, the 40 s job ended at about 42 s with 8 beats. With the beat off
(`/nobeat`, one job, run twice in two rounds), Cloudflare cut the box at about 26 s: exit -1,
no output. So the beat is needed on Cloudflare too.

```ts
// worker.ts, JobBox.alarm: the beat, and the timeout, in one alarm.
async alarm() {
	const row = this.row();
	if (row?.state !== "running") return;
	if (Date.now() >= row.until) return this.finish({said: "the job ran out of time", code: 124});
	if (!this.box.running) return this.finish({said: "the box stopped before the job ended", code: 137});
	await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
}
```

### What does not fit in a Durable Object

- **Platform imports:** none. The host code (`host/session.ts`) and `@kampus/fabrika`'s
  programs bundle to 1.26 MB with no `node:` import.
- **CPU and memory:** not measured. The clock does not move, so CPU time is not visible from
  inside. The bundle loads in the 128 MB of an object.
- **Rebuild on wake:** 2 to 11 ms locally for one person with one or two jobs. Live, under
  300 ms more than an awake attach, from the laptop.
- **Alarms:** the host sets none, because nothing it runs today waits on a clock. A program with
  a timer would need the earliest timer as the host's one alarm. Not built. Each job object has
  one alarm, its beat.
- **Leases:** a ledger lease would need renewing and keep the host awake. The host writes to an
  inbox instead (Q1).

## The container-host build, dropped

The first build ran PR 90's whole host in one container. It was smoke-tested only: `/health`,
`PUT /people` and `/status` answered. Then the direction changed, and it was removed. What its
spike measured locally, kept:

- A container started by an object in about 1.5 to 1.8 s, cold.
- The catch reached a `WorkerEntrypoint` with its props. Any other name: `ENOTFOUND`.
- A snapshot took 37 ms, destroy 43 ms, a wake from the snapshot about 1.27 s, and the files came
  back.

## The local twin

| Piece | Its twin here | How alike |
|---|---|---|
| Worker and Durable Objects | workerd through `alchemy dev` | Same code. Close. |
| Eviction | `ctx.abort()` from the driver; workerd also evicts idle objects on its own | Close. Real hibernation of a page's socket ran only live. |
| Clock | moves on the laptop | Live it stands still while code runs, so timings from inside are local only. |
| A box per job | Docker, through workerd | The same API and the same code. Cold start 0.4 to 0.7 s here, 0.5 to 2.2 s live (once 9.3 s), and 8 to 30 s for the first box after a deploy. |
| Box size | numbers at start, `{vcpu: 0.25, memoryMib: 1024, diskMb: 4000}` | The same live. *Wrong guess: "live it is the application's `instanceType: "basic"`". Alchemy refuses a size on an application owned by a Durable Object.* |
| The catch of the box's calls | workerd's `proxy-everything` helper | Same API. On an arm64 Mac the helper's image had to be set by hand. Live, the HTTPS catch (Q6) was run on Cloudflare only. |
| `/proc` in the box | root is refused other users' `/proc` | Not the same: live, root read every process. |
| The beat | needed: no beat, the box goes at about 10 s idle | The same live: no beat, the box was cut at 26 s. |
| A box destroyed | the box goes, its helper container stays up until `alchemy dev` stops | Not the same. Live the box goes; the registry image stays (see Q5). |
| The model | `standin.ts` | Live: the Worker's own `Standin` entrypoint, and once real Claude Code (Q6). |
| Sign-in | a JSON table of made-up sessions | No twin of PR 92's door. |
| Registry | none: the image is built locally | Live, Alchemy cross-builds it for `linux/amd64` and pushes it to Cloudflare's registry. |

## Q5. The live box round, as run

```ts
// live-box.ts, the round's shape, cut down: deploy, play, and always clean up.
const stack = stackOf({boxes: true, standin: true, secrets});
try {
	await deploy({stack, stage: "cloud"});            // 39 to 105 s, image cross-built for amd64
	await smallRound(url);                             // a first box, the three asks
	await fullRound(url);                              // cold starts, probe, beat on, beat off, wake
	if (token && standinPassed) await tokenRound(url); // Q6
} finally {
	await destroy({stack, stage: "cloud"});
	await sweep(await ours());                         // everything with the tf-exp-148 prefix
}
```

The plan above this round said: the same play with `stackOf({boxes: true})`, the three asks, the
probe, cold starts, the wake and the beat, then destroy and list by prefix. All of it ran. Nine
deploys, two refused by Alchemy before any upload (a `name`, then an `instanceType`, on the
application).

| What | Live |
|---|---|
| deploy, with the image build and push | 39 to 105 s |
| first box after a deploy, start to first call | 8.3 to 10.2 s; once 30 s |
| later boxes, start to first call | 0.5 to 2.2 s; once 9.3 s |
| the asks, and the probe | as Q3's live column |
| 40 s job, beat on | ended at about 42 s, 8 beats |
| the same, beat off | cut at about 26 s, exit -1, no output |
| a job's end, host asleep | the host woke 0.3 s after |
| facts written / refused | 16 to 48 / 0 |

- **When a cold start was slow, the start itself was slow.** In the 9.3 s case, `start()` and
  setting the catches took 8.2 s of it. The box's own first call came 1.1 s after.
- **The token needed Containers Edit**, as planned. With it, every listing and the registry
  answered.
- **What a destroyed stack leaves behind.** Alchemy's destroy removed the Worker, its four
  namespaces and the container application every time. It left the image in Cloudflare's
  registry. The sweep (`live-box sweep`) deletes the tags through the registry API. One
  platform-made artifact per deploy (`application/vnd.cloudchamber.btrfs-chain.v1`) answers 409
  `SINGLETON_ARTIFACT_EXISTS` and cannot be deleted that way. Seven such repositories are left,
  one artifact each, all under the run's prefix.
- **The containers instances listing did not help.** `/containers/dash/applications/<id>/instances`
  answered with `instances` and `durable_objects`, count 0, even while a box ran.
- **The cost guess held.** It said under $0.05 for a round. The boxes ran a few minutes in all
  (see What it costs).

## Q6. Claude Code in the box, on its starter's token (the decided design)

The decided design ([programs run in a box](../docs/direction/programs-run-in-a-box.md)): a job
runs on its starter's own subscription token, and the token goes into the job's box, the way
Anthropic's docs set Claude Code up. No relay adds it. This ran once on Cloudflare, after the
stand-in round passed.

```ts
// worker.ts, JobBox.begin, when the starter has a token: it goes in the box's environment,
// and the box can reach api.anthropic.com and nothing else.
this.box.start({image, enableInternet: false, env: {
	JOB_CMD, JOB,
	CLAUDE_CODE_OAUTH_TOKEN: token,          // Person(who).open(who, "token"), sealed at rest
	NODE_EXTRA_CA_CERTS: CATCH_CA,           // trust the catch's certificate
	CLAUDE_CONFIG_DIR: "/work/.claude",
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
}});
await this.box.interceptOutboundHttps("api.anthropic.com", ctx.exports.AnthropicPass({props}));
// AnthropicPass.fetch(req) { return fetch(req); }   passed on as it came
// JobBox.finish: output that holds the token as it is becomes "[withheld: ...]"

// The job, as run:
// claude -p "say hi in two words" --model haiku --max-turns 1 --output-format json
// -> {"is_error": false, "result": "Hi there!", "duration_ms": 1646, "duration_api_ms": 1289, "num_turns": 1}
```

| Check | Live |
|---|---|
| Claude Code from Cloudflare's network, on a subscription token | worked: `is_error` false, "Hi there!" |
| latency: Claude Code's own, the API's, the whole job | 1.6 s, 1.3 s, 4.8 s (6.4 s from the driver) |
| the box's network: `api.anthropic.com` | answered (404 on `/`) |
| the box's network: example.com (http and https), claude.ai, statsig.anthropic.com, 1.1.1.1 (https and TCP 53) | all refused |
| `printenv` as the job | its output was withheld; the token reached no row, no ledger and no page |
| the probe, as root and as the job's user | the token: found |
| the stand-in key, the sealing secret, a session | not found |

- **A subscription token works from Cloudflare.** This was the open doubt. One call, one turn,
  the cheapest model. Claude Code reported a cost of $0.0013, which a subscription does not
  bill.
- **The network lock is a catch, not a plain allow list.** With `enableInternet: false`, the only
  way out is a name the JobBox catches. For HTTPS the catch ends TLS at Cloudflare, so the box
  trusts Cloudflare's certificate, and the request goes through our Worker on its way. The Worker
  passes it on as it came and reads nothing. Cloudflare has no allow list that passes TLS
  through untouched. Its own `allowedHosts` uses the same catch.
- **The probe now finds the token, as it should.** The token is in the box by design. Where the
  probe found it is kept out of this public write-up and went to the owner.
- **The output check.** Output that holds the token as it is gets withheld before it leaves the
  JobBox. It was tried with `printenv` and once base64-encoded. What the second try showed is
  kept out of this public write-up and went to the owner.
- **The relay in Q3 stays as the stand-in measurement.** It shows a key can be kept out of the
  box. For the model login it is replaced by this.
- **How sure: 75%.** It worked once. The doubts: one call is not a load, and the rules for a
  token inside a platform's box are read from Anthropic's docs, not confirmed by Anthropic.

## What it costs

- **Money, first live round:** under $0.01 for three live deploys of a few minutes each, no box,
  a stand-in model.
- **Money, live box round:** about $0.05 at most. Nine deploys, the boxes a few minutes in all
  (at about $0.005 for 10 minutes of a box, under $0.01), Workers and Durable Objects
  negligible. One real Claude Code call on the owner's subscription, not billed by the call
  (Claude Code showed $0.0013). Registry storage for the seven leftover artifacts is not counted.
- **Code:** `worker.ts` holds the door, the four objects and the two entrypoints; the host itself
  (`host/session.ts`) has no platform name in it.

## Verdict

The project's host can be a Durable Object. tsh and its programs run in it, it sleeps, and a wake
brings every job back from storage. A job that needs a machine gets a box of its own, and the key
stays outside it. Take forward: the per-person sealed key, the catch-and-add relay with the job's
identity in its props, the beat while a box runs, and inbox writes to the ledger. **How sure:
75%.** The doubts: the box was not run live, and the subscription terms (Q3). *Updated after the
live box round: the box ran live and behaved as locally, the beat included, and real Claude Code
ran in it on its starter's token (Q6). For the model login the token now goes in the box, so the
relay is a measurement, not the design. How sure: 80%. The doubts left: one real call, no load,
the leftover registry artifacts, and the open page that missed a job's end (Q4).*

## Sources

- Cloudflare: [Durable Object container API](https://developers.cloudflare.com/containers/api/durable-object-container/),
  [Container class](https://developers.cloudflare.com/containers/api/container-class/),
  [outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/),
  [limits](https://developers.cloudflare.com/containers/platform/limits/),
  [pricing](https://developers.cloudflare.com/containers/platform/pricing/),
  [snapshots](https://developers.cloudflare.com/containers/guides/snapshots/),
  [local development](https://developers.cloudflare.com/containers/guides/local-dev/),
  [image management](https://developers.cloudflare.com/containers/guides/image-management/),
  [Claude Code in a Sandbox](https://developers.cloudflare.com/sandbox/tutorials/claude-code/),
  [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
  [Secrets Store](https://developers.cloudflare.com/secrets-store/integrations/workers/),
  [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/),
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Anthropic: [authentication](https://code.claude.com/docs/en/authentication),
  [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web),
  [LLM gateway](https://code.claude.com/docs/en/llm-gateway).
- How others do it: [Copilot's coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
  runs on Actions with its own firewall; [Cursor's cloud agents](https://cursor.com/docs/cloud-agent)
  run in VMs with secrets as environment variables; Claude Code on the web keeps the GitHub token
  out of the VM, and its model sign-in is Anthropic's own.
- Alchemy: [Cloudflare container](https://v1.alchemy.run/providers/cloudflare/container),
  [local development](https://alchemy.run/cloudflare/local-development).

## What it cannot tell us

- ~~**Whether a box behaves live as it did locally.**~~ Run in the live box round (Q5): it does,
  but for `/proc` (root reads every process live) and cold starts (slower, and 8 to 30 s for the
  first box after a deploy).
- ~~**Whether the beat is needed live.**~~ It is: with no beat the box was cut at 26 s (Q4).
- **Why a job's end sometimes never reached an open page.** Seen twice live (Q4). No cause found.
- **How to delete the platform's own registry artifact.** The registry API refuses it (409).
  Seven are left. A Cloudflare API for it was not found.
- **CPU and memory of the host object** on Cloudflare: the clock does not move, and no metric was
  read. The containers instances listing showed 0 even while boxes ran.
- **A real model with an API key.** Only the subscription token was tried for real, once. The
  stand-in still proves only which key the relay sent.
- **Whether Claude Code holds up past one call.** One turn, the cheapest model, no tools. A real
  job's many calls, tools and long runs in the locked network were not tried. It may need hosts
  that the lock refuses.
- **Many people, many jobs.** Two people and a handful of jobs. No load.
- **The 14.4 s first attach.** One run in three. No cause found.
- **The terms question** (Q3) is not a thing a run can answer.
