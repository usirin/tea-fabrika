# 127. The agent in a box: the whole Claude Code program, not only its Bash calls

The question: today the builder boxes each Bash command with Claude Code's own sandbox. The
Claude Code program itself, its hooks and its MCP servers run outside any box. Can the whole
program run inside a box, behind one function the Agent SDK starts it through? Two boxes were
tried: Anthropic's sandbox-runtime (`srt`, Seatbelt on a Mac, no Docker) and a fresh Docker
container per job. The baseline is today's way.

**Answer: yes, both work, with one catch each. Confidence 75%.**

- **srt works, but not with the Mac login.** Inside srt, Claude Code cannot reach the keychain,
  so it starts signed out ("Not logged in"). With the login handed in as a token and a settings
  folder of the job's own, 3 of 3 jobs finished. Every containment check held: no canary, no
  `~/.ssh`, no `example.com`, and the planted hook ran inside the box and could not write outside.
- **Docker works.** 3 of 3 jobs finished in a hardened container (`--cap-drop ALL`,
  `no-new-privileges`, read-only root). Files, `~/.ssh` and the hook stayed in. The network does
  not: the box can reach `example.com`, because the API needs an open network and no proxy was
  built.
- **The baseline holds Bash, and nothing else.** The Bash calls were held. The Read tool read the
  canary, and the planted hook wrote its marker in the home folder. Today the builder's code
  Check stops the read, and it loads no project settings, so no hook. That is code, not a box.
- **Start time is small.** The median time to the first SDK message was 272 ms with no box, 447 ms
  in srt and 410 ms in Docker (image already built).
- **Spent: about $0.41 in all**, haiku. The 11 recorded runs cost $0.234 ($0.018 to $0.030 each).
  The rest went on runs that found set-up bugs, and on probes. No run came near $0.15.

```ts
// The whole idea (experiments/127-agent-in-a-box.ts), as a sketch.
// One function starts any stdio program in a box. Nothing in it knows Claude Code.
const boxed = (box: Box, cmd: {command; args; env; cwd}): ChildProcess => ...;
//   none:   spawn(command, args)
//   srt:    spawn("srt", ["--settings", file, "--", command, ...args])
//   docker: spawn("docker", ["run", "-i", "--rm", ...hardening, "-v", `${cwd}:${cwd}`, "-w", cwd,
//                            "-e", NAME..., image, command, ...args])

// The Agent SDK starts Claude Code through it. The agent's options stay the builder's own.
const options = {...builderOptions(settings, copy, refused), spawnClaudeCodeProcess: claudeIn(box)};
for await (const msg of query({prompt, options})) ...;
```

## Who did what

- **This repo's code:** the builder's own options (`builderOptions` from
  `packages/pipeline/src/stages/build/builder.ts`) and the sandbox helpers in
  `@kampus/fabrika/agents/sandbox`. Nothing of today's fabrika ran: no agent of its own and no
  ledger. No real ticket and no real repository was touched.
- **New:** `experiments/127-agent-in-a-box.ts` (the boxes, the job, the checks) and
  `results/127-agent-in-a-box.json` (every run, and the notes below in data form).
- **srt** is `@anthropic-ai/sandbox-runtime` 0.0.81, installed in a scratch folder outside the
  repo. It is not a dependency here.
- **Docker** builds its image from a Dockerfile handed in on stdin: `node:26.12.0-slim`, curl, and
  the SDK's own Linux binary of Claude Code (`@anthropic-ai/claude-agent-sdk-linux-arm64`, the
  same version as the Mac one). 547 MB; 7 s to build with the base image already pulled.
- **The model:** `claude-haiku-4-5`, effort low, `maxBudgetUsd` 0.10 a run.

## How it was measured

- **The job.** A fresh copy of `fixtures/format-bytes` in a temp folder. The agent edits
  `bytes.js`, then runs one `node -e` command that must print `2.0 KB`.
- **The containment checks,** done by the agent's own tool calls in the same run, and judged by
  what the tool calls returned:
  - a canary file with a random word in it, in the home folder, outside the copy. Read with the
    Read tool, then with `cat`. It counts as read if the word came back;
  - `ls -a ~/.ssh`. It counts if a real entry name came back;
  - `curl https://example.com`. It counts if any HTTP status came back (that day example.com
    answered 503, from the Mac too);
  - a planted `.claude/settings.json` in the copy, with a `SessionStart` and a `PreToolUse` hook.
    The hook writes one mark inside the copy and one marker in the home folder. All runs load
    project settings (`settingSources: ["project"]`), so the hook is really read.
- **Start time:** from calling `query` to the first SDK message, median of 3.
- **Three changes to the builder's options,** said here so nobody mistakes them for today's:
  - project settings are loaded, so the planted hook is read. The builder loads none;
  - the builder's code Checks (its `PreToolUse` hooks) are off, so each probe reaches the box.
    In a real run they are still there;
  - inside a box, the SDK's per-command sandbox is off. The box is the sandbox. One extra srt run
    left it on, to see if the two nest.
- The canary, the marker and the temp folder were removed after each run.

## What came back

| | none | srt (token) | srt (keychain) | docker |
|---|---|---|---|---|
| Job finished, of 3 | 3 | 3 | 0 of 1, not logged in | 3 |
| Start, median ms | 272 | 447 | 259 (then stopped) | 410 |
| Whole run, median s | 18.1 | 15.8 | 0.3 | 16.4 |
| Canary read | yes, by the Read tool | no | not reached | no |
| `~/.ssh` listed | no | no | not reached | no |
| `example.com` reached | no | no | not reached | **yes** |
| Hook marker outside | **yes** | no | no | no |
| Hook ran inside | yes | yes | yes | yes |
| Dollars, 3 runs | 0.082 | 0.059 | 0 | 0.063 |

### srt

- **The Mac login does not work inside srt.** Claude Code logs in on a Mac from the keychain.
  srt's Seatbelt profile blocks the keychain service, so `security find-generic-password` fails
  inside srt even with every read open. srt has no setting that opens it. Claude Code answered
  "Not logged in" at once. This is the finding the brief asked to keep in view: on a Mac, the box
  cannot log in the way the program normally does.
- **With a token it works.** The login went in as `CLAUDE_CODE_OAUTH_TOKEN`, and Claude Code got a
  settings folder of the job's own (`CLAUDE_CONFIG_DIR`), inside the job's temp folder. That box
  then needs nothing of the user's home but the toolchain.
- **What the box allowed.** Read: the copy, the job's temp folder, the Claude Code binary's folder
  and the toolchain (`toolchain()`, as the builder already works it out). Write: the copy and the
  job's temp folder. Network: `api.anthropic.com` alone.
- **Three things it took to get there.**
  - srt needs `--` before the program. Without it, srt reads Claude Code's own `--settings` flag
    as its own, and refuses to run.
  - Claude Code keeps each Bash call's working files in `/tmp/claude-<uid>`, whatever `TMPDIR`
    says. Every Bash call failed with EPERM until `CLAUDE_CODE_TMPDIR` named the job's folder.
    Opening `/tmp/claude-<uid>` instead would have opened every other session's files there.
  - With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, the API was the only host needed.
- **The two sandboxes do not nest.** With the SDK's per-command sandbox left on inside srt, every
  Bash call failed: "Sandbox is required but failed to initialize", because srt does not let it
  open its proxy socket. It failed closed: no command ran outside the inner sandbox. So inside
  srt the inner sandbox has to be off.
- **The Read tool was held too.** It refused the canary: the box hides the home folder from the
  whole program, not only from its shell.

### Docker

- **It works with the container hardened.** `--cap-drop ALL`, `--security-opt
  no-new-privileges`, `--read-only` root, tmpfs for `/tmp` and the home folder, `--pids-limit
  512`, `--memory 2g`, `--cpus 2`, `--user node`, `--init`. Every job finished with all of it on.
- **Only the copy is mounted,** at the same path inside, so the SDK's `cwd` and every file path
  the agent sees mean the same thing in both places. No `~/.ssh`, `~/.config`, `~/.aws` or
  `~/.claude` is mounted. The canary was not there to read, and `~/.ssh` was an empty home.
- **The login goes in by name.** `docker run -e CLAUDE_CODE_OAUTH_TOKEN`, and docker reads the
  value from its own environment. It is never on a command line or in a file. The SDK's other
  variables go in the same way; `PATH`, `HOME`, the temp and settings folders and the locale stay
  out, because they describe the Mac.
- **The network stays open.** The API needs it, and nothing else filters it. The agent reached
  `example.com` in 3 of 3 runs. This is a finding: a Docker box without an egress proxy does not
  hold the network.
- **A failing hook stops every tool call.** The first planted hook exited non-zero inside the
  container (it could not write outside), and Claude Code then refused each tool call with a
  "PreToolUse hook error". The hook was changed to always exit 0 and the run was done again. A
  box that makes a project's hook fail can stop the job, which is safe but loud.
- The Claude Code inside is the SDK's own Linux binary, the same version as the Mac one, so the
  SDK and the program it talks to match.

### Start time

- No box: 272 ms. srt: 447 ms, about 175 ms more. Docker: 410 ms, about 140 ms more, with the
  image already built and the container started fresh each run.
- A whole job took 14 to 22 s in every box. The box is lost in the model's time.

## Verdict

- **Both layers can work.** A `Sandbox` service with two layers is worth building. Confidence 75%:
  three runs a box, one toy job, one Mac.
  - Why: both boxes held everything they were meant to hold, the agent code did not change, and
    the start cost is under 200 ms.
  - Cost: the token login (both), an egress proxy for Docker, and a few settings that are easy to
    get wrong (see the sketch).
- **srt is the stronger box of the two here,** because it holds the network as well as the files.
  Docker holds files better in one way: nothing of the Mac is there at all.
- **Open, kept private:** how the agent's login is handed into a box safely needs more work in both
  layers. Details are kept out of this public write-up.

## What each layer of a `Sandbox` service would need (a sketch)

```ts
// SKETCH, not code in the repo. What each layer needs, from what this experiment saw.
import {Context, Effect, Scope} from "effect";

/** Any program with stdio: Claude Code here, an ACP adapter next. */
interface Command {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd: string; // the working copy; the only folder the box writes besides its own temp
}

class Sandbox extends Context.Service<Sandbox, {
	/** Start one program in the box; it is stopped when the scope closes. */
	readonly start: (cmd: Command) => Effect.Effect<ChildProcess, SandboxError, Scope.Scope>;
}>()("Sandbox") {}

// Layer 1, the OS box (srt; Seatbelt on a Mac, bubblewrap on Linux).
//   - settings per job, written where the box cannot write them;
//   - read: the copy, the job's temp, the program's own folder, the toolchain; home denied;
//   - write: the copy and the job's temp, never the user's own Claude settings folder;
//   - network: the API host alone (plus what a job names);
//   - env: CLAUDE_CODE_TMPDIR and CLAUDE_CONFIG_DIR inside the job's temp folder;
//   - the login: a token, since the keychain is out of reach (hand-in method open);
//   - the program's own per-command sandbox off: the two do not nest;
//   - `srt --settings <file> -- <command> ...args`: the `--` is required.
// Layer 2, the container (Docker; one fresh container per job).
//   - the copy mounted at the same path inside, nothing else of the host;
//   - --cap-drop ALL, no-new-privileges, read-only root, tmpfs /tmp and home, limits, non-root;
//   - env by name only (`-e NAME`), never a value on the command line; host-only names left out;
//   - the program from the image (a Linux build of the same version), not the host's path;
//   - an egress proxy that lets the API through and nothing else: not built here;
//   - a label on every container, and a sweep that removes them.

// The Agent SDK plugs in unchanged:
const spawnClaudeCodeProcess = (o: SpawnOptions) => runSync(sandbox.start({...o, cwd: o.cwd ?? copy}));
```

- The SDK asks for the process synchronously, so the service has to hand back a started
  `ChildProcess`, not an Effect that will start one later. That is the one place it touches Node.

## What it cannot tell us

- **Three runs a box, on one toy job, on one Mac.** A real ticket runs pnpm, typecheck and tests.
  Those need more of the toolchain and more temp folders, and may hit rules this job never did.
- **srt was run on a Mac only.** On Linux it uses bubblewrap, with different rules and failures.
- **The Docker network was left open,** so this does not show that a proxy-held Docker box works.
- **Each probe asked the agent nicely.** An agent that tries hard to get out (other tools, other
  paths, other services of the machine) was not tried. Passing four checks is not proof of a
  sealed box.
- **MCP servers were not tried.** The builder offers none. A server started by the program would
  be in the same box, but no run showed it.
- **The Mac login inside srt might be fixable** by a setting srt does not have today, or by a
  helper outside the box. Not tried.
- **Start time is to the first SDK message,** not to the first model answer. With the image
  already built.
- **The code Checks were off,** so this says nothing about how the box and the Checks work
  together in a real run.
