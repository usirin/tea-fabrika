// P14 slice 1, next/ (ticket 698): S1.6, seen from outside. Slice 2 (ticket 828) extends it as L16 to
// the first-window suite, whose fixture (`p14.test-support.ts`) keeps the same trace and faults. The browser suite runs as a child
// process, and this supervising process checks what only an outside process can: the child exits
// on its own after success, a setup failure, a test failure or an interruption, and leaves no owned
// browser process, server listener or temp home behind (0061). Later browser suites reuse it.
//
// The child is `one-file.test.ts`'s S1.5 suite. Its fixture appends one JSON row per acquisition
// and release to `P14_E2E_TRACE`, and takes `P14_E2E_FAULT` (`{at, kind}`): fail setup right after
// acquiring `at`, fail the test once set up, or hold after `at` until this process signals it.
//
// The walk's state is what a plain run of the child really acquires. Each step picks a fault only at
// an acquisition that run reached, then runs the child with it.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, type TestContext } from "vitest";
import { suite as scopedSuite } from "./p14.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
const VITEST = join(APP, "node_modules/vitest/vitest.mjs");

const Row = Schema.Struct({
  acquired: Schema.optionalKey(Schema.String),
  released: Schema.optionalKey(Schema.String),
  holding: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(Schema.Number),
  port: Schema.optionalKey(Schema.Number),
  home: Schema.optionalKey(Schema.String),
});
type Row = typeof Row.Type;
type Fault = { readonly at: string; readonly kind: "setup" | "test" | "hold" | "timeout" };
const KINDS = ["setup", "test", "hold", "timeout"] as const;
type Ended = { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly ms: number };

const rows = (file: string): ReadonlyArray<Row> =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Row))(line))
    : [];

/** A folder for one child's trace, given back by the scope. */
const traceFolder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync("/tmp/p14t.")),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

/** The child suite. The scope's release is only the supervisor's own guard: the law observes the
 *  child's natural exit before it ever runs. */
/** A child suite: its file, the test it runs, and what a plain run of it must acquire. */
type Target = { readonly file: string; readonly test: string; readonly label: string };
const ONE_FILE: Target = { file: "one-file.test.ts", test: "S1.5", label: "P14 slice 1" };
const FIRST_WINDOW: Target = { file: "first-window.test.ts", test: "L11", label: "P14 slice 2" };

const suite = (trace: string, fault: Fault | undefined, target: Target) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const started = Date.now();
      const child = spawn(
        process.execPath,
        [
          VITEST,
          "run",
          "--root",
          import.meta.dirname,
          "--maxWorkers=1",
          "--testTimeout=180000",
          "--hookTimeout=180000",
          target.file,
          "-t",
          target.test,
        ],
        {
          cwd: APP,
          env: {
            ...process.env,
            P14_E2E_TRACE: trace,
            ...(fault === undefined ? {} : { P14_E2E_FAULT: JSON.stringify(fault) }),
          },
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        },
      );
      const ended = Effect.callback<Ended>((resume) => {
        child.once("exit", (code, signal) => resume(Effect.succeed({ code, signal, ms: Date.now() - started })));
      });
      return { child, ended };
    }),
    ({ child }) =>
      Effect.sync(() => {
        // Natural exit is checked first. This guard runs only after the observation.
        for (const pid of [...rows(trace).flatMap((row) => (row.pid === undefined ? [] : [row.pid])), child.pid]) {
          if (pid !== undefined && alive(pid)) {
            process.kill(pid, "SIGKILL");
          }
        }

        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* the process group already ended */
          }
        }

        for (const row of rows(trace)) {
          if (row.home !== undefined) {
            rmSync(row.home, { recursive: true, force: true });
          }
        }
      }),
  );

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const listening = (port: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Effect.acquireRelease(
        Effect.sync(() => connect({ host: "127.0.0.1", port })),
        (socket) => Effect.sync(() => socket.destroy()),
      );
      return yield* Effect.callback<boolean>((resume) => {
        socket.once("connect", () => resume(Effect.succeed(true)));
        socket.once("error", () => resume(Effect.succeed(false)));
      });
    }),
  );

/** Wait up to 10 s for what the child owned to be gone: its processes, listeners and homes. */
const leftBehind = (trace: ReadonlyArray<Row>) =>
  Effect.gen(function* () {
    const pids = trace.flatMap((r) => (r.pid === undefined ? [] : [r.pid]));
    const ports = trace.flatMap((r) => (r.port === undefined ? [] : [r.port]));
    const homes = trace.flatMap((r) => (r.home === undefined ? [] : [r.home]));
    const look = Effect.gen(function* () {
      const open: Array<number> = [];

      for (const port of ports) {
        if (yield* listening(port)) {
          open.push(port);
        }
      }

      return {
        pids: pids.filter(alive),
        ports: open,
        homes: homes.filter((home) => existsSync(home)),
      };
    });
    const gone = (left: Effect.Success<typeof look>) =>
      left.pids.length === 0 && left.ports.length === 0 && left.homes.length === 0;
    const deadline = Date.now() + 10_000;
    let left = yield* look;

    while (!gone(left) && Date.now() < deadline) {
      yield* Effect.sleep("250 millis");
      left = yield* look;
    }

    return left;
  });

/** Wait for the child to note that it holds `at`, then signal it. */
const interrupt = (child: ChildProcess, trace: string, signal: NodeJS.Signals) =>
  Effect.gen(function* () {
    while (!rows(trace).some((r) => r.holding !== undefined)) {
      yield* Effect.sleep("200 millis");
    }

    child.kill(signal);
  });

/** One child run and every check the law makes of it. Returns what it acquired, in order. */
const run = (fault: Fault | undefined, signal: NodeJS.Signals, target: Target = ONE_FILE) =>
  Effect.scoped(
    Effect.gen(function* () {
      const dir = yield* traceFolder;
      const trace = join(dir, "trace.jsonl");
      const { child, ended } = yield* suite(trace, fault, target);

      if (fault?.kind === "hold") {
        yield* interrupt(child, trace, signal).pipe(Effect.timeout("240 seconds"));
      }

      // The child must end by itself: a forced exit or the runner's own limit does not pass.
      const end = yield* ended.pipe(Effect.timeout("240 seconds"));
      const seen = rows(trace);
      const acquired = seen.flatMap((r) => (r.acquired === undefined ? [] : [r.acquired]));
      const released = seen.flatMap((r) => (r.released === undefined ? [] : [r.released]));
      const label = JSON.stringify(fault ?? "plain");
      expect(acquired.length, `${label}: the child reached its first acquisition`).toBeGreaterThan(0);

      if (fault !== undefined) {
        expect(acquired, `${label}: the selected acquisition was reached`).toContain(fault.at);

        if (fault.kind === "hold" || fault.kind === "timeout") {
          expect(
            seen.some((row) => row.holding === fault.at),
            `${label}: the fault actually held the scope`,
          ).toBe(true);
        }
      }

      if (fault === undefined) {
        expect(end, `${label}: a passing suite exits 0 by itself`).toMatchObject({ code: 0, signal: null });
      } else if (fault.kind === "hold") {
        expect(end.code !== null || end.signal !== null, `${label}: an interrupted suite exits`).toBe(true);
      } else {
        expect(end.signal, `${label}: a failing suite exits by itself`).toBeNull();
        expect(end.code, `${label}: a failing suite exits non-zero`).not.toBe(0);
      }

      if (fault?.kind !== "hold") {
        // Every acquisition is released, the last acquired first.
        expect(released, `${label}: every resource released in reverse order`).toEqual([...acquired].reverse());
      }

      expect(yield* leftBehind(seen), `${label}: no owned process, listener or home outlives the child`).toEqual({
        pids: [],
        ports: [],
        homes: [],
      });
      return acquired;
    }),
  );

/** The fault walk over one child suite: a plain run first, then faults only at what it reached. */
const walk = async (target: Target, context: TestContext) => {
  const reached = await scopedSuite(run(undefined, "SIGTERM", target), context);
  expect(reached, "the plain run acquires its home, server, browser, context and page").toEqual(
    expect.arrayContaining([
      "home",
      "server",
      "browser",
      "context",
      "page",
      ...(target === FIRST_WINDOW ? ["port", "socket"] : []),
    ]),
  );
  const kinds = new Set<string>();
  const available = target === FIRST_WINDOW ? KINDS : KINDS.filter((kind) => kind !== "timeout");
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          pick: fc.nat(),
          kind: fc.nat(),
          signal: fc.constantFrom("SIGTERM", "SIGINT"),
        }),
        { minLength: 1, maxLength: 2 },
      ),
      async (steps) => {
        for (const { pick, kind: pickKind, signal } of steps) {
          // A kind the walks have not reached yet comes first, so a short walk still meets all three.
          const pending = available.filter((k) => !kinds.has(k));
          const kind =
            pending.length > 0 ? pending[pickKind % pending.length]! : available[pickKind % available.length]!;
          // Only an acquisition the real run reached is a fault point; a test failure comes after all.
          const at = kind === "test" ? reached[reached.length - 1]! : reached[pick % reached.length]!;
          kinds.add(kind);
          await scopedSuite(run({ at, kind }, signal as NodeJS.Signals, target), context);
        }
      },
    ),
    { seed: 119120, numRuns: target === FIRST_WINDOW ? 10 : 3 },
  );
  expect([...kinds].sort(), "the walks reached every kind of fault").toEqual([...available].sort());
};

describe("P14 slice 1: S1.6 browser and server resources close and the child suite exits", () => {
  it(
    "generated fault walks: success, setup failure, test failure and interruption after each reached acquisition",
    // A child run builds, starts a brain and a browser: about a minute each, so 3 walks of up to 2 faults.
    { timeout: 20 * 60_000 },
    (context) => walk(ONE_FILE, context),
  );
});

describe("P14 slice 2, L16: the first-window suite's resources close and its child exits", () => {
  it("pinned: a Vitest timeout releases the first-window fixture's temp home before the worker exits", (context) =>
    scopedSuite(run({ at: "home", kind: "timeout" }, "SIGTERM", FIRST_WINDOW), context));

  it(
    "generated fault walks over the first-window suite: success, setup failure, test failure and interruption after each reached acquisition",
    // A child run starts dev.ts and a browser: about a minute each, 10 walks of up to 2 faults.
    { timeout: 60 * 60_000 },
    (context) => walk(FIRST_WINDOW, context),
  );
});
