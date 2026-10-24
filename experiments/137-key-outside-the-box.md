# 137. The key outside the box: the model's calls go through a relay on the host

The question: can an agent harness run in one of our boxes with no credential inside the box,
its model calls going out through a relay on the host that adds the credential? Today triage's
agent is fenced only by `tools: []` in `packages/pipeline/src/stages/sort/sorter.ts`, and in
[127](./127-agent-in-a-box.md) the login went into the box with the agent.
[Programs run in a box](../docs/direction/programs-run-in-a-box.md) says the box is the fence and
no real key goes in. It left two questions open: does a subscription login work through a relay
on the host, and what is the model's network path? The same note now says triage runs in a box
too, with no login in it, and names this experiment as the check on the model's way out.

**Answer: yes, in srt and in Docker. Nothing in either box held the key, and a subscription login
worked through the relay with no change to Claude Code. Confidence 80%.**

- **Part 1, the wall, a fake key only ($0).** Claude Code ran in each box with Bash and Read on.
  Its tool calls probed for the key by its hash. In srt and Docker the key was in no environment,
  in no file the box could read (its settings folder included), and the host's key file could not
  be opened by Bash or by the Read tool. No host but the relay could be reached. With no box, both
  tools read the key file, and the key then went out to the "model" in the next request.
- **Part 2, the real login, tools off.** One triage turn from inside each box, through the relay to
  the API, with only the relay holding the login. Both worked: `yes`, `plan`, one request each,
  $0.0072 in srt and $0.0078 in Docker. No file the box could write held the login afterwards.
- **A subscription login works through a relay.** The box holds a placeholder,
  `CLAUDE_CODE_OAUTH_TOKEN=box-holds-no-key`. Claude Code then talks as a subscriber does: a bearer
  token and the `oauth-2025-04-20` beta. The relay drops the box's bearer and adds the real one.
  No API key was needed. To the relay's address Claude Code sent only `POST /v1/messages?beta=true`.
- **The model's path is the relay and nothing else.** srt: the relay listens on one port of the
  host's `127.0.0.1`, and that IP and port is the only entry in srt's allow list. Docker:
  `--network none`, with the relay's unix socket mounted in. Each box needed one fix to get there
  (below).
- **The relay can cap spend per box.** It forwards one path and only the models it is told,
  refuses a `max_tokens` over its limit, and drops every header that could carry a credential. Its
  token count matched the SDK's exactly, so it can price each box's spend and stop it.
- **What stays open:** anything in the box can use the relay. The probe's own call went through,
  up to the box's cap. The cap is the guard against that, not the box.
- **Spent: $0.0314**, all of it part 2's four haiku turns (each box twice). Part 1 and the
  relay's checks ran against a stand-in, $0.

```ts
// The whole idea (experiments/137-key-outside-the-box.ts), as it runs.
// Host: one relay for each box. Only the relay holds the login: read once from a file, kept in memory.
const relay = await startRelay({
	listen: box === "docker" ? {kind: "socket", path: job.sock} : {kind: "port"},
	upstream: "https://api.anthropic.com",
	credential: bearer(login), // authorization: Bearer <login>, plus the oauth beta
	models: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
	cap: {requests: 12, tokens: 300_000, maxTokens: 64_000},
});

// Box: Claude Code believes it is signed in, and its model is the relay.
const env = {
	...agentEnv(),
	ANTHROPIC_BASE_URL: "http://127.0.0.1:<port>", // srt: the relay's port. Docker: fwd.mjs inside.
	CLAUDE_CODE_OAUTH_TOKEN: "box-holds-no-key",
};
// The sort stage's own options, as they are; only env and the spawn change.
const options = {...sorterOptions(settings, cwd), env, spawnClaudeCodeProcess: claudeIn(box, job, relay)};

// The relay, for each request: POST /v1/messages only, an allowed model, max_tokens under the
// limit, the box's cap not reached. Drop authorization, x-api-key, cookie. Add the login. Send on.
```

## Who did what

- **This repo's code:** the sort stage's `sorterOptions`, `promptOf` and `sortDraft.schema` (as
  the `outputFormat` its runner asks for), `agentEnv` and `toolchain` from
  `@kampus/fabrika/agents/sandbox`, and 128's `boxed()` for none and srt. Nothing of today's
  fabrika ran: no agent of its own, no ledger, no real ticket. The ticket was made up.
- **New, in `experiments/137-key-outside-the-box/`:**
  - `relay.ts`: the relay (228 lines);
  - `standin.ts`: part 1's stand-in for the Messages API (165);
  - `probe.mjs`: the probe Claude Code's Bash tool runs in the box (105);
  - `fwd.mjs`: the forwarder inside a Docker box (21);
  - `box.ts`: 128's Docker start with `--group-add 0` and the forwarder in front (80).
- **The script** `experiments/137-key-outside-the-box.ts` runs both parts and writes
  `results/137-key-outside-the-box.json`.
- **srt** is `@anthropic-ai/sandbox-runtime` 0.0.81, in a scratch folder outside the repo, as in
  127. **Docker** is 127's image (`node:26.12.0-slim`, curl, the SDK's own Linux build of Claude
  Code 0.3.296) and 127's hardening, on Docker Desktop 4.43.2.
- **The model:** `claude-haiku-4-5`, effort low.

## How it was measured

### Part 1: the wall, with a fake key

- **The key.** A random `fake-key-<32 hex>`, made each run. It sits in a file in the home folder,
  where a real login sits, and the relay reads it from there. The real login is not read in this
  part.
- **The stand-in.** The relay's upstream is a stand-in for the Messages API on the host. It answers
  as the API does (a stream of events) and asks for two tool calls, one a turn: Bash runs
  `node probe.mjs <hash> <key file> <port>`, then the Read tool reads the key file. So Claude Code's
  real tools run in the box, but no real model picks them. The probes are the same in every box.
- **The probe** is handed the key's SHA-256, never the key, and prints booleans, counts and HTTP
  statuses only. It looks where 128's probe looked:
  - its own environment, and `/proc/self/environ` where there is one;
  - the host's key file, by its path;
  - up to 1,700 files under its temp folder, home, Claude Code's settings folder and its working
    folder;
  - `api.anthropic.com` and `example.com`, from Node (no proxy) and from curl (the box's proxy, if
    any), and another port on the host's loopback (the stand-in's);
  - the relay: things it should refuse, and one call it should let through.
- **The stand-in checks** that every request came with the key (the relay added it), that no other
  credential reached it, and whether any request body held the key.
- **Claude Code's options:** Bash and Read, `dontAsk` with both allowed, no settings files, no MCP,
  no connectors, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, a settings folder and temp folder of
  the job's own. Inside a box the SDK's own Bash sandbox is off, as in 127: the two do not nest.

### The relay's refusals, from the host

Raw requests to a relay with a cap of two requests: a host in the target, a `CONNECT`, a path with
dots, an unknown query, a request carrying the box's own `x-api-key` and `authorization`, then a
second and a third request.

### Part 2: one triage turn, with the real login

- **The turn** is the sort stage's, unchanged: `sorterOptions` (`tools: []`, no settings, no MCP,
  $0.10 cap), `promptOf` with a made-up ticket ("`formatBytes(2048)` prints `2048 B`"), and the
  answer's shape as `outputFormat`, as `sdkRunner` asks for it. Only `env` and
  `spawnClaudeCodeProcess` change.
- **The login.** The relay reads it once from a file outside the repo, named by `LOGIN_FILE`, into
  its own memory. It is never in an environment variable, on a command line, in a file the run
  writes, or in anything sent to the box. The host's environment must hold no login and no key:
  the script stops if `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN` or
  `TYPESAFE_API_KEY` is set.
- **After the turn,** with the box gone, the host read every file the box could write (its working
  folder, temp folder and settings folder) for the login.
- Nothing of the home folder is mounted into Docker; srt denies the home folder.

## What came back

### Part 1: the wall

| | none | srt | Docker |
|---|---|---|---|
| Claude Code finished its 3 turns | yes | yes | yes |
| Key in its environment or `/proc/self/environ` | no | no | no |
| Host's key file read by Bash | **yes** | no | no |
| Host's key file read by the Read tool | **yes** | no | no |
| Files looked at (of them, settings folder) | 506 (5) | 6 (4) | 7 (5) |
| Files holding the key | 0 | 0 | 0 |
| Key sent on to the model | **yes**, once | no | no |
| `api.anthropic.com` or `example.com` reached | **yes** | no | no |
| Another port on the host's loopback reached | **yes** | no, srt's proxy said 403 | no |
| Every request through the relay had the key, and only it | yes | yes | yes |

- **With no box**, both tools read the key file. The Read tool's answer went to the model in the
  next request, as any tool result does. That is the path a real login would leak by.
- **In srt and Docker** the home folder is not there to read, and neither box had a way out but the
  relay.
- **The probe saw no login variable at all, in any box.** Claude Code takes
  `CLAUDE_CODE_OAUTH_TOKEN` out of what its Bash tool sees. The Claude Code process itself still has
  it. Whether a program in the box can read that process's environment was not tried. Here it would
  find only the placeholder.

### The relay's answers

| Asked | Answer |
|---|---|
| From the box: `GET /v1/models`, `POST /v1/complete` | 403, not forwarded |
| From the box: `POST /v1/messages` for `claude-opus-4-1` | 403, model not allowed |
| From the box: `POST /v1/messages` with `max_tokens` 100,000 | 403, over 64,000 |
| From the box: `POST /v1/messages`, haiku, no credential | 200: sent on, with the relay's key |
| From the host: `GET http://example.com/` (a proxy's request) | 403 |
| From the host: `CONNECT example.com:443` | 403 |
| From the host: `/v1/messages/../models` | 403, read as `/v1/models` |
| From the host: `/v1/messages?x=1` | 403 |
| From the host: the box's own `x-api-key` and `authorization` | dropped; the upstream saw only the relay's key |
| From the host: a third request, cap of two | 403 before it left |

The answer in every box was the same. The relay never sent the key back: no answer the box got
held it.

### What Claude Code sent

- To the relay, in every box and both parts: `POST /v1/messages?beta=true`, nothing else. Each
  carried its own `authorization` (the placeholder), which the relay dropped.
- The betas it asked for included `oauth-2025-04-20` and `claude-code-20250219`: it believed it
  was a signed-in subscriber.
- **srt's own proxy log** (one more part-1 run with `SRT_DEBUG=1`, not the kept row): 8
  connections let through, all to the relay's port (Claude Code's 3 model calls and the probe's 5
  asks); 3 refused, all the probe's own tries. Claude Code asked the proxy for no other host.
  Seatbelt's refusals of direct connections are not in that log.

### Part 2: one triage turn

| | srt | Docker |
|---|---|---|
| Turn finished | yes | yes |
| Answer | `yes`, `plan` | `yes`, `plan` |
| Requests through the relay | 1 | 1 |
| Tokens in and out, the relay's count (same as the SDK's) | 2,933 and 852 | 2,936 and 981 |
| Dollars | 0.0072 | 0.0078 |
| Whole run | 8.8 s | 9.8 s |
| Files the box could write that held the login | 0 of 4 | 0 of 1 |

- Each box ran the turn twice: once before the code was formatted ($0.0087 and $0.0077), and once
  on the code as committed, the rows above. Same answer all four times.
- The relay's count is the SDK's: 2,933 input tokens at $1 a million and 852 output at $5 is
  $0.007193, the SDK's own figure.

## The way out of each box

### srt: one port, through srt's own proxy

- The relay listens on `127.0.0.1:<port>`. srt's allow list is `["127.0.0.1:<port>"]`, an IP and a
  port. srt resolves names and refuses loopback unless the IP itself is listed, so a name cannot
  get around it. Seatbelt lets the box connect only to srt's proxy.
- **The catch: srt names loopback in `NO_PROXY`.** So Claude Code went to the relay's port
  straight, Seatbelt refused it (EPERM), and Claude Code retried for 3 minutes before it failed.
  The box's launch now takes `NO_PROXY` away (`env -u NO_PROXY -u no_proxy claude ...`), and the
  request goes through srt's proxy. A program in the box could put `NO_PROXY` back. Its request then
  goes straight, and Seatbelt refuses it. Either way, only the relay's port is open.
- **Why not a socket here:** srt can allow one unix socket by path on a Mac, but Claude Code does
  not speak HTTP over a socket. A forwarder inside srt would need `allowLocalBinding`, which on a Mac
  opens every local port. One IP and port is narrower.
- A probe problem, not a hole: Node's `execFileSync("curl")` failed with EPERM inside srt, from a
  shell `curl` worked. Probably Node's own `PATH` search stopping at a folder under the denied home.
  The probe calls `/usr/bin/curl` by its full path.

### Docker: no network, one socket

- `--network none`: the container has its own loopback and nothing else. The relay listens on a
  unix socket on the Mac, mounted at `/relay.sock`. `fwd.mjs` listens on the container's own
  `127.0.0.1:8137`, pipes each connection to the socket, then starts Claude Code.
- **The catch: Docker Desktop shows the socket as `root:root`, mode 0660,** whatever its mode on the
  Mac. User `node` got EACCES, the forwarder dropped every connection, and Claude Code retried for
  3 minutes. The fix is `--group-add 0`: the user joins the root group. The root folder is read-only
  and home and `/tmp` are the user's own tmpfs, so it opens little. What else the root group can
  read in the image was not checked.
- **Why a socket, not a port:** a port means the container has a network, and Docker has no flag
  that allows one host port alone; that takes a proxy or a firewall in its VM. With a socket the box has no
  network at all. That fixes 127's open network for the model's path.

### A cap per box

- One relay listens for one box, so its count is that box's. Nothing the box says changes it.
- The count matches the SDK's, so a dollar cap is a sum of tokens times prices.
- The cap is checked before each request, so a box can go over by one request at most: with
  `max_tokens` held to 64,000, about $0.32 of haiku output. A lower `max_tokens` limit makes that
  smaller.
- A cap reached in the middle of a real run was not tried.

## Verdict

- **Build the relay as each box's only way to its model, and put no real login in any box.**
  Confidence 80%.
  - Why: both boxes held every check, a subscription login worked through it, Claude Code needed
    no change, and Claude Code uses one path only.
  - Cost: a relay of about 230 lines here, one for each box; a forwarder of 21 lines for Docker;
    and two settings that are easy to get wrong (srt's `NO_PROXY`, the socket's group in Docker).
    Get either wrong and the run fails closed, but only after 3 minutes of retries.
  - Not higher, because part 1's probes were scripted and part 2 had tools off: a long tool-using
    run through the relay is the next test.
- **Cap spend in the relay.** Anything in the box can call the model through it, as the probe did.
  The box cannot take the login, but it can spend. The relay is where that is counted.
- **Prefer this to srt's own credential masking for the model.** srt 0.0.81 can put a placeholder
  in a variable and swap the real value back in its proxy (`credentials`, mode `mask`), but that
  needs srt to open the TLS, and it is srt-only. A relay works the same in every box. Not tried,
  so this is reasoning: confidence 60%. The doubt: srt's mask might be simpler for srt alone. One
  srt run with the login masked, against this relay, would settle it.

## What it cannot tell us

- **Part 1 used a fake key and a scripted stand-in, not a real model.** The probes are the ones we
  asked for. A model that tries hard to get out, by other paths or other services of the machine,
  was not tried.
- **Part 2 had tools off and one turn a box.** A long run with tools, many requests and streams of
  minutes, through the relay, was not tried. Nor was a cap reached mid-run.
- **The probe did not look into other processes,** such as Claude Code's own environment. Here it
  would have found only the placeholder.
- **One Mac.** srt on Seatbelt only; on Linux srt uses bubblewrap and its own network namespace.
  Docker Desktop's socket forwarding and its `root:root` view are Docker Desktop's; a Linux host may
  differ.
- **What Seatbelt refused directly is not logged,** so we know only that the turn did not need it.
- **The relay speaks plain HTTP** on the Mac's loopback and a socket. That is fine on one machine;
  across machines it would need TLS.
- **Whether this use of a subscription login fits its terms** was not looked at.
- **haiku only, effort low,** with the SDK and Claude Code at 0.3.296. A new version may call other
  paths; the relay would refuse them, and that would show at once.
