---
date: "2026-11-11"
summary: "`next/`, `alchemy` 2.0.0-beta.85, local state in a temp folder, no account. Yes for setting hands up: two made-up resources (`HandsGrant`, a stand-in grant file; `HandsProcess`, a detached, unref'd child through Effect's `ChildProcess`) created, updated, replaced and destroyed in 22 to 40 ms. No for keeping them alive: a deploy after the child was killed made no provider call and still printed the dead pid; only `Drift.detect` saw it `missing`, and a `diff` that checks the pid caught it. Alchemy's own `Command.Dev` does nothing at deploy. A replace with the record keyed by logical id deleted the new grant; keyed by instance id it was right. Browser hands, by reading: the page is deploy-time, the grant is an enrollment after the tab makes its key; beta.85 has a Browser Rendering binding, not a resource. Lean, about 70%: install a launchd or systemd unit, let the cloud keep cloud hands, grant after the key exists. No unit was installed. No model, $0."
---

# 264. Can one Alchemy stack, owned by the library, provision hands through custom resources of our own?

Run on 2026-11-11 against `alchemy` 2.0.0-beta.85 and `effect` 4.1.2, the installed versions. No
account, no network, no key, no model: **$0**. It is about `next/`. Nothing here touched a real
ledger, a real grant or a real key.

**The answer: yes, it works, and it is all Effect, but only for setting hands up, not for keeping
them alive.** Two custom resources took about 120 lines. Create, change, replace and destroy all
did what they should, in 22 to 40 ms each. What a deploy cannot do is notice that a process died:
a second deploy said "no change" and printed the dead pid. Alchemy only looks again through
`drift`. Alchemy's own long-running process resource, `Command.Dev`, does nothing at all during a
deploy, which says the same thing. So the stack should install hands and their supervisor (launchd,
systemd, Docker's restart policy or the cloud), and leave the keeping-alive to that supervisor.

```ts
// The whole idea, as run (names made up for this sketch: HandsGrant, HandsProcess).
interface HandsProcess extends Alchemy.Resource<"Fabrika.HandsProcess", ProcessProps, ProcessAttrs> {}
const HandsProcess = Resource<HandsProcess>("Fabrika.HandsProcess");

const HandsProcessProvider = Provider.effect(HandsProcess, Effect.gen(function* () {
  return {
    read: ...,       // `kill -0 <pid>` through effect/process ChildProcess
    diff: ...,       // a changed prop is "update"
    reconcile: ...,  // spawn detached, `yield* child.unref`, return { pid, heartbeat }
    delete: ...,     // `kill -TERM <pid>`
  };
}));

const stack = Alchemy.Stack("hands-exp", { providers, state: Alchemy.localState() },
  Effect.gen(function* () {
    const grant = yield* HandsGrant("LaptopGrant", { ledger, key, for: "stand-in-person", to: "stand-in-ledger" });
    const hands = yield* HandsProcess("LaptopHands", { home, label: "v1", every: 500 });
    return { grant: grant.path, pid: hands.pid };
  }));
```

## How Alchemy declares a resource in beta.85

All paths are under `node_modules/alchemy/src/` unless named.

- **A resource is a typed tag.** `Resource<R>(type)` makes the constructor (`Resource.ts:348`). The
  type is an interface: `Resource<Type, Props, Attributes>`. Yielding it in a stack program
  registers it under its logical id; a second type with the same id dies with
  `DuplicateLogicalIdError` (`Resource.ts:372`).
- **A provider is a Layer.** `Provider.effect(cls, Effect.gen(...))` (`Provider.ts:470`) or
  `Provider.succeed` (`Provider.ts:515`). The stack takes them as one Layer in `providers`.
- **The lifecycle.** `reconcile` is required and does both create and update (`Provider.ts:372`);
  it gets `news`, `olds` and `output`, and must be idempotent. `delete` is required and idempotent
  (`Provider.ts:387`). `read` (`:261`), `diff` (`:285`), `observe` (`:326`) and `precreate`
  (`:338`) are optional; `list` defaults to an empty list (`Provider.ts:467`). `diff` answers
  `noop`, `update` or `replace`, with `deleteFirst` on a replace (`Diff.ts:11-35`).
- **When `read` runs.** On a plain deploy, only when there is no old state, as a cold-start
  probe for adoption (`Plan.ts:1434`), or to recover an interrupted create (`Plan.ts:1572`). When
  state exists, the plan calls `diff` with the stored `output` and never `read`
  (`Plan.ts:1646-1660`). `read` is what `Drift.detect` and `Drift.repair` call (`Drift.ts:535`,
  `:541`).
- **State.** `localState()` writes one JSON file per resource at
  `<dotAlchemy>/state/<stack>/<stage>/<fqn>.json`, plus `__stack_output__.json`
  (`State/LocalState.ts:34`, `:86-94`), written atomically. Each row holds `props`, `attr`,
  `instanceId`, `status` and `removalPolicy`. The run's row for the process was 20 lines and kept
  `"attr": { "pid": 30557, ... }`.
- **What Alchemy already ships.** `Command.Exec` runs a command once at deploy for its side
  effect, memoized by a hash of its files; its `delete` does nothing (`Command/Exec.ts:96-130`).
  `Command.Dev` is the long-running one, and it is **a no-op during `alchemy deploy`**: "`Dev`
  resources only run in dev mode" (`Command/Dev.ts:59-62`; its live provider's `reconcile` returns
  `{ url: undefined }` at `:154-160`). In dev, the child lives in the dev sidecar
  (`Local/Sidecar.ts`), so it lives exactly as long as `alchemy dev` does. Neither fits hands:
  one runs and exits, the other dies with the dev session.

## What the run did

The script made a temp folder for Alchemy's state, a stand-in ledger folder and the hands' home.
`HandsGrant` writes `{ key, for, to, as: "hands", writtenAt }` as a JSON file, the shape 0102
gives a grant, with made-up values. `HandsProcess` starts `node -e` with a one-line loop that
writes `{ pid, label, at }` to a heartbeat file every 500 ms. It spawns through Effect's
`ChildProcess` with `detached: true` and no pipes, then calls `child.unref`. Liveness and stop go
through `ChildProcess.make("kill", ...)`, so the script has no `node:child_process` import.

| Step | What Alchemy did | What was true after |
|---|---|---|
| 1. deploy | `grant.read` (cold probe): missing. Both `reconcile` as create. 39 ms | grant file written; child pid 30557 running, PPID 1, heartbeat ticking |
| 2. deploy, no change | no provider call at all. 27 ms | same pid, still running |
| 3. kill the child by hand, deploy | no provider call. Result still says `"pid":30557`. 26 ms | **no child running**; state says it is |
| 4. `Drift.detect` | `grant.read`: found. `process.read`: "pid 30557 gone". Result `LaptopHands: "missing"` | nothing changed |
| 5. `Drift.repair` | `process.reconcile` as create, under the same instance id. Result `"recreated"` | new pid 53418 running |
| 6. kill again, deploy with a `diff` that checks the pid | `process.diff`: "pid 53418 gone", answers `update`; `reconcile` starts pid 54026 | caught on deploy |
| 7. change `label` to v2 | `diff`: `update`; `reconcile` stops 54026, starts 58975. 40 ms | heartbeat says `"label":"v2"` |
| 8. change the grant's `key` | `diff`: `replace`. Create replacement, then delete the old one. 35 ms | **the grant file was gone** (see below) |
| 9. `Drift.detect` | `LaptopGrant: "missing"` | state says a grant exists; the ledger has none |
| 10. destroy | `grant.delete`, `process.delete`: "pid 58975 stopped". 35 ms | no child; state folder empty |

Steps 2 and 3 are the honest limit. A plain deploy does not look at the world, it looks at its
own state. Step 6 shows a `diff` can look, but then `diff` does `read`'s job, and every deploy pays
one `kill -0` per process.

**Step 8 was a bug in my provider, and an easy one to write.** A replace runs create-before-delete
by default (`deleteFirst` unset). My record's path was the logical id alone, so the new grant and
the old one were the same file, and the old one's `delete` removed the new one. The fix is
Alchemy's own rule: the physical name comes from the instance id, which is new per generation. A
second run with the path keyed by `instanceId` did it right: create
`LaptopGrant-c1e370ff….json`, delete `LaptopGrant-0190ff3c….json`, one record left with
`"key": "stand-in-public-key-2"`. `deleteFirst: true` would also fix it, with a moment where no
grant exists. A real grant is a ledger fact, not a file, so a real `delete` is a revoke and the
same rule applies: a new key is a new grant, never an edit.

**What happens to the child when the deploy exits.** Three runs settle it:

- Spawned and unref'd: the child survives, reparented to PID 1, its own process group. Effect's
  spawner skips the kill when the scope closes on an unref'd child (`@effect/platform-node-shared`
  4.1.2, `NodeChildProcessSpawner.ts:690`).
- Spawned without `unref`: the child is killed when `reconcile`'s scope closes, before the deploy
  even returns. `pgrep` found nothing 0.5 s later.
- Unref'd, and the deploy left to exit on its own (no `process.exit`): it exited with code 0 and
  the child kept running.

Should it survive? Only if something owns it afterwards. In this run nothing did: a survivor is an
orphan whose only record is a pid in a state file, and a pid can be reused by another program, so
a later `delete` could stop a stranger. That is exactly the leak 0061 warns about.

## The limits

- **Who keeps the process alive.** Alchemy acts at deploy time and then leaves. On a Mac the
  keeper is launchd, on Linux systemd, in Docker the restart policy, in the cloud the platform.
  So the resource should install a service, not spawn: `reconcile` writes a LaunchAgent plist or
  a systemd user unit and loads it, `read` asks `launchctl print` or `systemctl --user is-active`,
  `delete` unloads and removes it. That gives `read` a real name to ask about instead of a pid.
  This was not built or run: no unit was written or loaded on this machine.
- **Another computer.** Our custom resource runs where the deploy runs. Nothing in `alchemy` src
  reaches another machine by ssh (a search for `ssh` found nothing). `@alchemy.run/docker` does:
  its context takes `host=ssh://user@host` (`docker/src/Context.ts:19`), and `Docker.Container`
  has `restart: "always" | "unless-stopped"` (`docker/src/Container.ts:52`). So a deploy on one
  computer can put containerized hands on another, with Docker as their keeper. Native hands on a
  second Mac need that Mac to run its own deploy, or a person there.
- **A cloud hand** is the easy case: the platform is the supervisor. A Cloudflare Container is a
  resource Alchemy already ships (`@alchemy.run/cloudflare/src/Containers/Container.ts:870`), and
  experiment 261 sketched one started per job from a Durable Object. There the "process" is not a
  deploy-time thing at all: the brain starts the box when there is work.
- **The grant is not deploy-time either.** In `next/` a grant is a fact signed by a person key,
  with `saw`, what the person saw when they let the key in (`libfabrika/src/access/Access.ts:12-34`).
  Only a person key signs one. A deploy that writes the grant must hold the person key, or ask the
  person, as `next/apps/fabrika/grant.ts` does with a code and `ssh-keygen -Y sign`. And each
  client makes its own key ([a key per client](../docs/direction/a-key-per-client-and-no-github-trust.md)),
  so the hands key exists only once the hands do.

## Browser hands

Reading only, nothing built. Settled already: a browser tab can be a `hands` client, since the
jobs methods need JSON, signing and a WebSocket only (0102, binding constraints). A host can be a
browser profile, and only one tab in a profile should act as the hands, picked with Web Locks
([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)). Capabilities
(`has`) keep a job a tab cannot run away from it.

1. **Deploy-time, and fits a resource:** the code a tab runs as hands is served by the brain's
   Worker, or by its static assets. That is one more file in the Worker Alchemy already deploys,
   not a new resource. Nothing about the grant is deploy-time.
2. **Not deploy-time: right, and the code agrees.** A person opens the tab. The tab makes its own
   WebCrypto key, which never leaves the profile (a key per client, line 18 of that note). The
   person then lets it in: today's `Grant` has `as: "window" | "agent"` (`Access.ts:30`; 0102 adds
   `"hands"` in a later slice) and a `saw` with the code, the label and `how: "compare" | "link" |
   "command"`. That is an enrollment step after the tab exists, the same one a window goes through
   now. A deploy cannot do it, because the key it would grant does not exist yet.
3. **A headless browser the stack can start:** beta.85 ships a Browser Rendering *binding*, not a
   resource. `Cloudflare.Browser("BROWSER")` is "a Worker-only binding with no backing cloud
   resource" (`@alchemy.run/cloudflare/src/Workers/Browser.ts:98-99`, defined at `:165-171`). Its
   client offers `raw`, `fetch` and quick actions such as `content`, `screenshot` and `markdown`
   (`Browser.ts:56-94`). So the brain can start a headless browser per job from a Worker or a
   Durable Object, but the stack does not start a standing one. Such a browser would be a job's
   tool inside a cloud hand, not a hands client dialing in. How long a session may stay open was
   not checked.

## How it fits `Fabrika.make` and one stack owned by the library

0126 (not on main yet) says the library offers `Fabrika.make`, and the brain's object classes and
the deploy stack move into libfabrika. A sketch of that stack with brain and hands:

```ts
// SKETCH, not built. Made up for this sketch: Fabrika.make's options, Fabrika.Hands.Service,
// Fabrika.Hands.Container, HandsService, settings.hands, the "hands" binding. Real names:
// Alchemy.Stack, Alchemy.localState, Cloudflare.Workers.Worker, Cloudflare.DurableObject,
// Cloudflare.Browser, Cloudflare.Container, Docker.Container.
export const stack = Fabrika.make({ name: settings.name, state: Alchemy.localState() },
  Effect.gen(function* () {
    // The brain, as alchemy.run.ts has it today, plus the hands page in its assets.
    const brain = yield* Cloudflare.Workers.Worker("Brain", {
      main: built.brain,
      env: { PROJECT: Cloudflare.DurableObject("Project"), BROWSER: Cloudflare.Browser() /* ... */ },
    });

    // Laptop hands: a service unit launchd or systemd keeps alive. No key and no grant here:
    // the process makes its key on first start, and a person lets it in (the grant command).
    const laptop = yield* Fabrika.Hands.Service("LaptopHands", { brain: brain.url, has: ["git"] });

    // Cloud hands: started by the brain per job, so only the image is a resource.
    const box = yield* Cloudflare.Container("HandsBox", { main: "./hands-box" });

    // A second computer: Docker over ssh, with Docker as the keeper.
    // const vm = yield* Docker.Container("VmHands", { restart: "unless-stopped", ... });

    // Browser hands: nothing here. A person opens the tab from brain.url and lets its key in.
    return { url: brain.url, laptop: laptop.unit };
  }));
```

The three kinds side by side:

| Kind | Deploy-time part | Who keeps it alive | Who makes the key, and when it is let in |
|---|---|---|---|
| Laptop process | the service unit and its install | launchd or systemd | the process, on first start; then a person grants it |
| Cloud | the image, plus the code that starts a box per job | the platform, per job | the box, or the brain on its behalf (not decided) |
| Browser tab | the hands code, served by the brain | the person, by keeping the tab open | the tab, in its profile; then a person grants it |

## What Erlang/OTP would do

In OTP a supervisor owns its child: it starts it, links to it, gets an `EXIT` the moment it dies,
and restarts it by its strategy, within an intensity limit. The owner is alive for as long as the
child is. A deploy-time resource is the opposite shape: it starts the child and leaves, and finds
out about a death only when someone runs `drift`. It is closer to OTP's release handling, which
installs a new release and then hands it to the running supervisors, than to a supervisor. So the
OTP answer here is: the deploy installs the supervisor's config (a unit, a restart policy), and the
supervisor (launchd, systemd, Docker) does the OTP part. Inside the hands process, our own
supervisor tree still owns each job.

## Options

| Option | What it buys | What it costs |
|---|---|---|
| A. The resource spawns the process (this run) | smallest; all Effect; works today | an orphan nobody watches; deploys miss deaths; pid reuse can stop a stranger |
| B. The resource installs a service unit | the OS keeps hands alive and restarts them; `read` asks the OS by name; destroy is clean | one provider per OS (launchd, systemd); `launchctl` and `systemctl` are edges to wrap |
| C. No hands resource; hands is a command a person runs | nothing new to build | no single entry point, which is the question's goal |

**Lean: B for laptop hands, the platform for cloud hands, nothing at deploy for browser hands, and
the grant always an enrollment step after the hands key exists.** Why: it is how the makers do it.
Alchemy's own long-running resource refuses to run at deploy, and Docker's resource leans on a
restart policy. It also keeps the person key out of the deploy. Cost: two small providers (one
per OS), each about the size of this run's `HandsProcess`, plus wrapping `launchctl` or
`systemctl` as edges. **How sure: about 70%.** The doubt: whether a launchd LaunchAgent installed
by a deploy behaves well on a Mac that sleeps and wakes, and whether a person accepts a deploy
installing a login item. One run would settle it: write and load a real LaunchAgent under a test
label, sleep the Mac, and read it back with `read`. That needs the owner's yes, since it changes
this machine.

## What it cannot tell us

- No service unit was written or loaded, so option B is untested. Its `read` and `delete` are
  reasoned, not run, and their man pages were not read for this write-up.
- The grant was a JSON file, not a signed ledger fact. How a deploy would ask a person to sign,
  and whether the brain could grant cloud hands on its own, is not shown.
- One Mac, one tiny child, local state only. Remote state (`HttpStateStore`), a second computer
  and Docker over ssh were not tried.
- The pid-reuse danger is from reading, not seen in the run.
- Browser Rendering's session limits and price were not checked, and no browser was started.
- The 22 to 40 ms per deploy is for two trivial resources and says nothing about a real stack.

The script `experiments/264-hands-resource/hands.ts` is on the branch
`fabrikalfa/exp-hands-resource` only, not on main
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)). To run it, link that
folder's `node_modules` to `next/apps/fabrika/node_modules`, set `HANDS_HOME` to a temp folder, and
pass `deploy`, `destroy`, `detect` or `repair`. The raw output of every step is under `runs/264/`
on the owner's machine, not in git.
