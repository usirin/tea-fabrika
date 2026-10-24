# 128. A program in a box: the box goes around the whole program

The question: today a fabrika program runs as a fiber inside the host's own Node process. Can
the host start a whole program as a child process inside a box instead (none, srt or Docker),
and still tell it inputs, hear its outputs and see its end? Can a service that holds a key be
used from inside the box while the key stays outside? And how big is fabrika's own part of it?

**Answer: yes, in all three boxes, and the key stayed out of both real boxes. Confidence 80%.**

- **It works.** `double` and a program that calls a `Greeter` service ran right in none, srt and
  Docker, every run.
- **Start costs about a third of a second.** From `startBoxed` to the first output, median of 5:
  215 ms with no box, 321 ms in srt, 329 ms in Docker. In-process `start` takes 0.4 ms. About
  155 ms of every boxed start is Node loading `@kampus/fabrika` itself.
- **A service call through the wall is under 1 ms.** Median of 20, measured inside the box
  around the call: 0.23 ms none, 0.23 ms srt, 0.71 ms Docker. In-process: 0.01 ms.
- **The key stays out.** In srt and Docker, the probe found no key in its environment, in
  `/proc/self/environ` or in any file it could reach, and could not read the host's key file.
  Its Greeter call still came back signed with the key. With no box, the probe read the key
  file: a plain child process is no box.
- **The edges hold.** A wrong-shaped input is refused before it crosses (0 frames written). A
  killed runner ends the host's handle in 3 to 7 ms (91 ms in Docker, most of it the
  `docker exec` that did the kill). When the host's scope closes, the box is gone in all three.
- **Neither real box needs a network.** Every service call goes over stdio, so Docker ran with
  `--network none` and srt with no allowed host. The probe's request to `example.com` failed in
  both, and went through with no box.
- **fabrika's part is 353 lines of code; the box's `boxed()` is 116.** fabrika's part is the
  frames and walls (100), the runner (78) and the host side (175). It is not smaller than the box
  part: it is three times bigger. Most of it restates `start`'s handle and its types.
- **$0.** No model, no agent, no real key. Docker's set-up (image, with its layers already
  cached, and the Linux `node_modules` volume) took about 7 s.

```ts
// The whole idea (experiments/128-program-in-a-box/), as it runs.
// Host: start the program in a box; the handle is shaped like start's.
const started = yield* startBoxed(place, greet, {});   // place: {box: none | srt | docker, ...}
yield* started.run.tell("name", "ada");                // checked with the input's shape, then a stdin line
started.run.listen("greeting", show);                  // a stdout line, checked with the output's shape
started.close("name");
yield* started.run.ended;                              // {kind: "ended"}

// Box: one runner loads the program, starts it with fabrika's own `start`, and speaks lines.
//   node runner.ts programs.ts greet '{}'
// The program asks for Greeter as usual. It gets a stand-in that sends each call out over
// stdout, as Effect RPC; the host answers with the real Greeter, which holds the key.
```

## Who did what

- **This repo's code:** `@kampus/fabrika`'s `defineProgram`, `start`, `readFlags` and
  `memoryStorage`, as they are. Nothing of today's fabrika ran: no agent, no ledger, no ticket.
- **New, in `experiments/128-program-in-a-box/`:**
  - `wall.ts`: the frames, the `Wall` type, `standIn` (the box side of a service) and `serve`
    (the host side);
  - `runner.ts`: the runner inside the box;
  - `host.ts`: `startBoxed`;
  - `box.ts`: experiment 127's `boxed()`, copied with four changes (below), plus the srt
    settings and the Docker image;
  - `programs.ts`: `double`, `greet`, `probe` and the `Greeter` service.
- **The script** `experiments/128-program-in-a-box.ts` runs every measurement and writes
  `results/128-program-in-a-box.json`.
- **srt** is `@anthropic-ai/sandbox-runtime` 0.0.81, installed in a scratch folder outside the
  repo, as in 127.
- **Docker** builds `node:26.12.0-slim` plus pnpm from a Dockerfile on stdin. The Linux
  `node_modules` come from a named volume filled once by experiment 98's
  `install.sh`. Every container, the image and the volume carry the label `exp128`; all were
  removed at the end (0 left).
- **Effect** 4.0.6: `effect/rpc` for the service, `NodeStdio` and `NodeStream` for the pipes.

## How it fits together

### What crosses the wall

One channel: the child's stdin and stdout, one JSON line per frame. Each side reads them with an
Effect Schema (`Down` and `Up` in `wall.ts`).

```ts
// host -> box
{kind: "tell", name: "n", value: 21}
{kind: "close", name: "n"}
{kind: "stop"}
{kind: "rpc", wall: "greeter", msg: {_tag: "Exit", requestId: "0", exit: ...}}   // an RpcServer answer

// box -> host
{kind: "hi", pid: 4242}                       // the runner is up; its process id
{kind: "out", name: "n", value: 42}
{kind: "rpc", wall: "greeter", msg: {_tag: "Request", id: 0, tag: "greet", payload: {name: "ada"}, ...}}
{kind: "end", how: "ended"}                   // or "stopped", "failed" with why, "bad_shape" with why
```

- Every value is checked with the program's own shapes on both sides. The host checks a told
  value before it writes it. The program's own `start` checks it again inside. The host checks
  every output as it comes out, and fails the run if the box sends one its output refuses.
- Shapes only check, never convert (`shape.ts`), so a value's JSON is the value. Nothing to
  encode beyond `JSON.stringify`.
- stdin's end stops the run inside, as an Erlang peer halts when its connection drops. A host
  that dies leaves no runner behind.

### A service crosses the wall; the key does not

A `Wall` names one service, the Effect RPC group it is called through, and two small maps.

```ts
export class Greeter extends Context.Service<Greeter, {
	readonly greet: (name: string) => Effect.Effect<string>
}>()("exp128/Greeter") {}

export const GreeterRpcs = RpcGroup.make(
	Rpc.make("greet", {payload: {name: Schema.String}, success: Schema.String}),
);

export const greeterWall: Wall<Greeter, Greeter["Service"], RpcGroup.Rpcs<typeof GreeterRpcs>> = {
	name: "greeter",
	tag: Greeter,
	group: GreeterRpcs,
	inside: (client) => Greeter.of({greet: (name) => client.greet({name}).pipe(Effect.orDie)}),
	outside: (greeter) => GreeterRpcs.of({greet: ({name}) => greeter.greet(name)}),
};
```

- **Inside the box,** `standIn(wall, write, routes)` is a `Layer<Greeter>`. It builds an Effect
  `RpcClient` whose protocol writes each request as an `rpc` frame, and hands each `rpc` frame
  the runner reads back to the client. The program does `yield* Greeter` as it always does.
- **On the host,** `serve(wall, write, routes)` runs an Effect `RpcServer` for that box, with the
  real `Greeter` from the host's own context, and writes each answer down as an `rpc` frame.
- **The real Greeter** is made on the host only. It reads the key from the host's environment
  and signs each greeting with it (an HMAC). The box is handed a short environment of its own
  (`PATH`, `TMPDIR`; nothing in Docker), never the host's.
- Each side's protocol is about 15 lines, made with Effect's own `Protocol.make`. The request
  ids, encoding, interrupts and span ids are Effect's.

### Why stdio, and not a socket or HTTP

- **Both boxes already give stdio.** `docker run -i` forwards stdin, stdout and stderr, and no
  other file descriptor. srt passes them through. Nothing new is opened.
- **Every other transport opens a hole for what the box is meant to close.** A socket needs a
  network path out (srt's allow list, Docker's host gateway) or a Unix socket shared into the box.
  HTTP and websocket need a network. With stdio, Docker runs with `--network none`.
- **It is what Erlang does.** `peer:start(#{connection => standard_io, exec => ...})` runs the
  whole distribution protocol over the child's stdio, with `docker run -i` as the `exec`.
- **The cost:** Effect's stdio protocol exists only for a server, and it takes the whole of
  stdin and stdout. Inputs and outputs share the channel here, so the two protocols are small
  hand-made ones that put Effect's encoded messages in `rpc` frames. No other transport was
  tried, so "simplest that works" is reasoning, not a measurement.

### The runner

```ts
// node runner.ts <programs file> <export name> <flags as JSON>
const entry = (yield* Effect.promise(() => import(file)))[name];          // {program, walls}
const services = yield* Layer.build(Layer.mergeAll(...entry.walls.map((w) => standIn(w, write, routes))));
yield* write({kind: "hi", pid: process.pid});
const started = yield* start(entry.program, JSON.parse(raw), outs, {id, storage: memoryStorage()})
	.pipe(Effect.provideContext(services));                                 // fabrika's own start
yield* stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(toRun),
	Effect.andThen(started.stop), Effect.forkScoped);                       // stdin's end stops it
yield* done(endFrame(yield* started.run.ended));
```

### The host side

```ts
export const startBoxed = <P extends AnyProgram>(place: Place, entry: Boxable<P>, flags: unknown, listeners?)
	: Effect.Effect<BoxedRunning<P> | BadShape, never, Scope.Scope | ServicesOf<P>>

interface BoxedRunning<P> {
	kind: "running";
	run: {
		id: string;
		tell(name, value): Effect.Effect<Word>;        // "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"
		listen(name, listener): () => void;
		ended: Effect.Effect<BoxEnded>;                // ended | stopped | failed {why} | gone {why}
	};
	close(name): void;
	stop: Effect.Effect<BoxEnded>;                     // asks with a `stop` frame; after 5 s, takes the box away
}
```

- The flags are read with `readFlags` before anything starts. A bad one answers `bad_shape`, and
  no box is started.
- The box is acquired in the caller's scope; its release is the box's `kill`.
- **`gone`** is new: the box's stdout ended with no `end` line. Its `why` is the exit code or
  signal and the tail of stderr.

## What came back

| | none | srt | Docker |
|---|---|---|---|
| `double` and `greet` work | yes, yes | yes, yes | yes, yes |
| Start to first output, median of 5 | 215 ms | 321 ms | 329 ms |
| One service call, inside, median of 20 | 0.23 ms | 0.23 ms | 0.71 ms |
| Tell to heard, with the call, median of 20 | 0.42 ms | 0.42 ms | 1.37 ms |
| Key in env, `/proc` env or files reached | no | no | no |
| Host's key file readable | **yes** | no | no |
| Call still works, signed with the key | yes | yes | yes |
| `example.com` reachable | yes | no | no |
| Wrong shape: frames that crossed | 0 | 0 | 0 |
| Runner killed: handle ended | `gone`, 3.4 ms | `gone`, 6.9 ms | `gone`, 91 ms |
| Scope closed: box gone | yes | yes | yes |

In-process `start` on the host, for scale: 0.37 ms to the first output, 0.01 ms a Greeter call.

### Start time

- 215 ms with no box. Most of it is Node loading the program's imports: in a fresh Node,
  `import("@kampus/fabrika")` took 155 ms and `effect/rpc` 24 ms more.
- srt adds about 105 ms, Docker about 115 ms (image already built, a fresh container each start).
  127 saw the same size of cost: 175 ms for srt, 140 ms for Docker.
- A guess, not measured: a runner bundled to one file would cut most of the 155 ms.

### The service call

- Inside the box, a Greeter call is a frame out, the host's RPC server, the real Greeter, and a
  frame back: 0.23 ms over pipes, 0.71 ms through Docker's stdio forwarding.
- Tell to heard adds one more crossing each way: 0.42 ms and 1.37 ms.
- So a wall costs well under a millisecond a call. A real service (GitHub, a model) takes 100 ms
  to minutes, so the wall is lost in it.

### The key

- The key was a random `fake-key-<32 hex>`, made at each start. It sat in the host process's
  environment and in a file in the home folder, the two places a real key sits.
- The probe program got only the key's SHA-256 as a flag, never the key. Inside the box it looked
  for the pattern in its environment, in `/proc/self/environ` (Docker), in the host's key file by
  its path, and in up to 1,000 files under its temp folder and home. It compared each match's hash.
- srt: the home folder is denied, so the key file could not be read; the box's temp folder
  (`/tmp/claude`, set by srt) showed no files.
- Docker: the key file is not in the container at all; home and `/tmp` are fresh tmpfs.
- With no box: not in the environment (the host hands the child a short one), but the key file
  was read. A plain child process can read what the host can. That is the baseline, not a bug.
- In every box the Greeter call came back signed with the key: the host used it, the box never
  saw it.

### The edges

- **Wrong shape.** `tell("n", 1.5)` and `tell("n", "two")` answered `bad_shape`, a tell to an
  input the program does not have answered `no_cell`, and none of them wrote a frame. Bad flags
  (`hash: 7`) answered `bad_shape` before any box started.
- **Killed mid-run.** After one output, the runner's own process got `SIGKILL` (in Docker, from
  inside the container with `docker exec`). The handle ended `gone` with the signal or exit code.
  A tell after it answered `stopped`. Nothing hung. srt itself noticed and exited 1 ("Process
  killed by signal: SIGKILL").
- **Scope closed.** The runner, the box's own process (srt, or the `docker run` client) and the
  container were all gone a second later. none and srt start the child in its own process group
  and kill the group. Docker removes the container by name. Killing only the `docker run` client
  can leave its container running; that is why `kill` does `docker rm -f`.

## What fabrika owns, what the box tool owns

Lines of code: not blank, not only a comment, counted by the script after `pnpm format`.

| Part | File | Lines |
|---|---|---|
| fabrika: frames, `Wall`, `standIn`, `serve`, `boxable` | `wall.ts` | 100 |
| fabrika: the runner | `runner.ts` | 78 |
| fabrika: `startBoxed` and its handle | `host.ts` | 175 |
| **fabrika in all** | | **353** |
| box tool: `boxed()` and its types | `box.ts` | 116 |
| box tool: with srt settings, Docker image and clean-up | `box.ts` | 197 |

- **fabrika owns the language of the wall:** the frames, checking each value with the program's
  shapes, the runner, the handle, and how a service crosses (stand-in and server).
- **The box tool owns the wall itself:** how a child is started inside srt or Docker, what it
  may read, write and reach, and how the whole box is taken away.
- **The line between them is one function.** `boxed(box, {command, args, env, cwd})` gives back a
  child with pipes and a `kill`. fabrika's side never asks which box it is in. The runner and the
  frames were the same in all three.
- **fabrika's part is not small.** About half of `host.ts` is the handle and its types, which
  restate what `start` already has. Built into `@kampus/fabrika`, the handle could use `start`'s
  own types, and the part left might be nearer 250 lines. That is a guess.
- **The four changes to 127's `boxed()`:** it hands back a `kill`; Docker mounts are a list with
  a read-only mark and may name a volume; Docker gets `--network none`; the srt settings and the
  Docker image are made for this runner.

## Verdict

- **Boxing a whole program works, with fabrika's `start` unchanged inside.** Worth building as
  `startBoxed` beside `start`. Confidence 80%.
  - Why: three boxes, one runner, one set of frames; every measure held; the box costs about
    110 ms at start and under 1 ms a call.
  - Cost: about 350 lines here, of which perhaps 250 would stay once the handle reuses `start`'s
    types. Plus each service a program uses needs a `Wall` (an RPC group and two small maps).
- **Prefer srt or Docker over none.** A plain child process kept the key out of its environment
  only because the host chose what to hand it. It could still read the key file.
- **Under 80% on one point: whether stdio is the transport to keep.** It worked and needs no
  hole. A program that writes to stdout itself (`console.log`) writes into the frame channel; the
  host skips any line that is not a frame, but half a line would break the next frame. A second
  pipe would fix that, and Docker's `-i` does not forward one. What would settle it: a run with a
  real program that logs, and a try of a Unix socket mounted into both boxes.

## What it cannot tell us

- **Toy programs only.** `double`, `greet` and the probe. No program with machines, no kept run:
  the runner gives every run a memory storage inside the box, so nothing outlives the box. How a
  kept run's storage crosses the wall (as another service?) is open.
- **The boxed handle is smaller than `start`'s.** It has no `offer`, no `Full` (a full line inside
  the box becomes a pipe that waits), no `machines`, no `queues()`, and `failed` carries a `why`
  string, not Effect's `Cause`. `pipe` and `call` were not tried across the wall.
- **The host reads a program's declarations by loading its file.** A real host would take the
  listing (names, shapes, walls) from inside the box, or from a file it does not run.
- **The probe looked where a program would look first.** An attempt to get out by other means
  (other files, other system services, the RPC server's own inputs) was not tried. Four checks
  passing is not a sealed box.
- **One Mac, srt on Seatbelt only.** srt on Linux uses bubblewrap, with other rules. Docker
  Desktop's stdio forwarding goes through its VM, which a Linux host does not have.
- **Start time is to the first output of `double`,** with Docker's image already built and the
  repo's `node_modules` in a volume. A real program loads more.
- **One service, one method, one call at a time.** No streams, no concurrent calls, no service
  that fails, no call cut off by a kill.
- **Every number is from five or twenty runs** on one quiet machine.
