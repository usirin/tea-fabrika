# 148. Remote programs: a project's host on Cloudflare, each job on its starter's key

The question: can fabrika programs run as jobs on a project's host on Cloudflare, each job on the
Claude Code key of the person who started it, with that key never inside a box? The direction
changed while this ran ([tea-host.md](../docs/direction/tea-host.md), 2026-10-25): the host is
not a long-lived container. It is a Durable Object that wakes on a message or an alarm, steps its
programs, writes the ledger and sleeps. A container is only for a job that needs a real machine,
one per job.

**Answer: yes, locally in full and on Cloudflare without the box. Confidence 75%.**

- **tsh and its programs run inside the project's object.** The counter, `jobs`, `tell` and
  `attach` work as on the laptop. The Worker bundle is 1.26 MB with no `node:` import. On
  Cloudflare the same object ran tsh and the counter, slept when idle, and every wake brought the
  counter back where it left off.
- **A job that needs a machine gets a box of its own.** Locally (workerd and Docker) the host
  starts one box per job, in 0.4 to 0.7 s, and the box goes when the job ends.
- **The key stays out of the box.** The box's call to the model is caught outside it. A Worker
  adds the starter's key. A probe as root and as the job's user read every file, every process's
  environment and 1.2 GB of memory, and found no key, no sealing secret and no session.
- **Facts carry the starter's stamp.** Every job's change lands on the project's ledger as
  `agent:host for:github:1`, 53 rows in the local run, 17 live.
- **One new rule: a job's object stays awake while its box runs.** With no beat, an idle job
  object was dropped after about 10 s locally, and its box went with it. A 5 s alarm fixed it. The
  project's host still sleeps.
- **Not tested live: the box.** Today's token may not use Containers (its listing answers 403).
  A live box round needs Containers Edit added to the token.
- **Spent: under $0.01.** Three live deploys, each destroyed in a `finally`. The model was a
  stand-in. No real key was used anywhere.

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
`packages/fabrika`'s own `Ledger` Durable Object, unchanged. The people were two made-up sign-ins
played by the driver, `github:1` and `github:2`, and `github:3` with no key.

## How it was measured

```sh
# local: workerd and Docker through `alchemy dev`, a stand-in model, made-up keys
env -u TYPESAFE_API_KEY nice -n 15 node experiments/148-remote-programs.ts
# live: the same stack on Cloudflare, from code, without the box
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live
```

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
| a model call from a box, start to answer | 2.5 s (box start 0.4 to 0.7 s) | not run: no Containers |
| ledger rows, writer | 53, all `agent:host for:<who>` | 17, the same |

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

```ts
// worker.ts, JobBox.begin: the box can reach two names, both caught outside it.
this.box.start({image: this.box.images.Job, enableInternet: false, env: {JOB_CMD, JOB}});
await this.box.interceptOutboundHttp("model.internal", ctx.exports.ModelRelay({props}));
await this.box.interceptOutboundHttp("host.internal", ctx.exports.JobDone({props}));
// ModelRelay.fetch: POST /v1/messages only; the job's call cap; the starter's key; three headers carried
headers.set("x-api-key", await env.PEOPLE.getByName(who).open(who));
```

| Check | Result |
|---|---|
| github:1's call | `standin answered github:1`, with `x-api-key`, no `authorization` |
| github:2's call | `standin answered github:2` |
| github:3, no key | `403 github:3 has no key yet` |
| probe as root | 6,691 files, nothing found; other users' `/proc` refused (EACCES) |
| probe as the job's user | 3 processes' environment, command line and 1.19 GB of memory, 6,676 files, nothing found |
| key at rest | the row holds `who`, `iv`, `sealed`; not the key text |

- **The props are the job's identity.** `ModelRelay` gets `{project, who, job}` from the object
  that started the box, not from the box. The box cannot say whose key to use.
- **Root in the box cannot read the job's memory.** Root has no `CAP_SYS_PTRACE` there. The probe
  runs a second time as the job's own user to read it.
- **A box with 256 MiB was too small for the probe.** It was killed (137). The box now asks for
  1/4 vCPU and 1 GiB. Locally workerd refuses the name `"basic"`, so the size goes in numbers.

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
| a box job's end wakes an evicted host | yes, 4.5 to 5 s after (the job slept 4 s) | not run |

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

**The job's object beats while its box runs.** Locally, a 25 s job never ended: the job object
was dropped while idle, and the box with it. Now `JobBox` sets an alarm every 5 s while its box
runs. It checks the box is there and the job has time left. A 40 s job had 8 beats and ended
right. Cloudflare's own `Container` class keeps an alarm going the same way, by its docs. Only the
job's object stays awake, and only while its box runs.

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
| A box per job | Docker, through workerd | The same API. Cold start not compared. |
| Box size | numbers at start, `{vcpu: 0.25, memoryMib: 1024, diskMb: 4000}` | Live it is the application's `instanceType: "basic"`. Local workerd refuses the name. |
| The catch of the box's calls | workerd's `proxy-everything` helper | Same API. On an arm64 Mac the helper's image had to be set by hand. |
| A box destroyed | the box goes, its helper container stays up until `alchemy dev` stops | Not the same. Unknown live. |
| The model | `standin.ts` | No real model. Header names checked, not the API. |
| Sign-in | a JSON table of made-up sessions | No twin of PR 92's door. |
| Registry | none: the image is built locally | Live it is pushed to Cloudflare's registry. Not run. |

## Q5. The live box round, planned

What ran live today: everything but the box. What is still to run:

- **Token:** add **Containers Edit** to today's token (Workers Scripts Edit, Account Settings
  Read, Account Analytics Read). Today the containers listing answers 403.
- **The image:** Alchemy builds `box/Dockerfile` for `linux/amd64` and pushes it to Cloudflare's
  registry. On an arm64 laptop that is a cross build.
- **Steps:** `node experiments/148-remote-programs.ts live` with `stackOf({boxes: true})`. The
  same play, plus: the three asks with a stand-in model as a second entrypoint (no real key), the
  probe as root and as the job's user, a box cold start, a job's end waking a sleeping host, and
  the beat. Then destroy in a `finally`, and list Workers, namespaces, container applications and
  registry images by the `tf-exp-148` prefix.
- **Cost:** a 10 minute job in a basic box, at list price before the free amounts: memory
  600 s × 1 GiB × $0.0000025 = $0.0015, CPU at most 600 s × 0.25 × $0.00002 = $0.003, disk
  600 s × 4 GB × $0.00000007 = $0.0002. About $0.005 a job. The job object's 120 beats cost
  well under $0.001. A round of a few short jobs: under $0.05.

## What it costs

- **Money:** under $0.01 for three live deploys of a few minutes each. Containers and the model
  cost nothing: the first was not run live, the second was a stand-in.
- **Code:** `worker.ts` holds the door, the four objects and the two entrypoints; the host itself
  (`host/session.ts`) has no platform name in it.

## Verdict

The project's host can be a Durable Object. tsh and its programs run in it, it sleeps, and a wake
brings every job back from storage. A job that needs a machine gets a box of its own, and the key
stays outside it. Take forward: the per-person sealed key, the catch-and-add relay with the job's
identity in its props, the beat while a box runs, and inbox writes to the ledger. **How sure:
75%.** The doubts: the box was not run live, and the subscription terms (Q3).

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

- **Whether a box behaves live as it did locally:** cold start, the catch, the size, the beat,
  and whether a destroyed box leaves anything behind. Not run.
- **Whether the beat is needed live.** It was needed locally. Cloudflare's docs suggest the same,
  but this run did not see it.
- **CPU and memory of the host object** on Cloudflare: the clock does not move, and no metric was
  read.
- **A real model and a real key.** The stand-in proves which key went out, not that the API
  takes it.
- **Many people, many jobs.** Two people and a handful of jobs. No load.
- **The 14.4 s first attach.** One run in three. No cause found.
- **The terms question** (Q3) is not a thing a run can answer.
