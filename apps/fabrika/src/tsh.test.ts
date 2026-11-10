import { execFileSync } from "node:child_process";
import { layer as nodeFileSystem } from "@effect/platform-node/NodeFileSystem";
import {
  type Entry,
  Ledger,
  memoryStorage,
  openJobs,
  runTraceId,
  Shell,
  type Storage,
  streams,
  Traces,
} from "@kampus/fabrika-old";
import { summonManager } from "@kampus/fabrika-old/agents/summon";
import { memoryService } from "@kampus/fabrika-old/memory";
import { fileStorage } from "@kampus/fabrika-old/storage/node";
import { type CodeFact, nameOf } from "@kampus/pipeline/tickets/ticket";
import { Tickets, ticketsOnLedger } from "@kampus/pipeline/tickets/tickets";
import { memoryTraces } from "@tea-fabrika/trace/memory";
import { Author, PullRequests, tracker } from "@tea-fabrika/tracker";
import { LANE, SEVEN, SEVEN_BODY, SEVEN_TITLE, SEVEN_TRACE } from "@tea-fabrika/tracker/seven";
import { Clock, Deferred, Effect, FileSystem, Layer, Logger, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BINDINGS, type Does, wordOf } from "./desk/keys.ts";
import { deskWords } from "./desk/words.ts";
import { gridOf } from "./editor/grid.ts";
import { type History, memoryHistory, type SharedHistory, sharedHistory } from "./editor/history.ts";
import { jobLines } from "./job-lines.ts";
import type { TileJobs } from "./tile-jobs.ts";
import { appPrograms, type Placed, type Runs, startTsh, tshList, type WindowScreen } from "./tsh.ts";

// One tile's tsh, with a fake terminal page and a fake tile and no Electron: what a person would see
// in the terminal, read off its grid (editor/grid.ts), and what each program's view is shown.
// The ledger is in memory.

/** How many times tsh was told `signal`: one Ctrl-C is one interrupt, whichever path it took. */
const signals = vi.hoisted(() => ({ told: 0 }));

const lineGate = vi.hoisted(() => ({
  wait: undefined as Effect.Effect<void> | undefined,
  entered: false,
}));

// `tell` as it is, counted when it tells tsh's `signal`. Nothing else changes.
vi.mock("@kampus/fabrika-old", async (importOriginal) => {
  const real = await importOriginal<typeof import("@kampus/fabrika-old")>();
  const tell: typeof real.tell = (run, name, value) => {
    if (name === "signal") {
      signals.told += 1;
    }

    return real.tell(run, name, value);
  };
  const offer: typeof real.offer = (run, name, value) =>
    Effect.suspend(() => {
      if (name !== "line" || lineGate.wait === undefined) {
        return real.offer(run, name, value);
      }

      lineGate.entered = true;
      return lineGate.wait.pipe(Effect.andThen(real.offer(run, name, value)));
    });
  return { ...real, tell, offer };
});

/** What the fake tile saw, in order. */
type Seen =
  | { readonly kind: "open"; readonly run: string; readonly program: string; readonly placed: Placed }
  | { readonly kind: "forward"; readonly run: string }
  | { readonly kind: "line"; readonly runs: readonly string[] }
  | { readonly kind: "view"; readonly run: string; readonly data: unknown }
  | { readonly kind: "close"; readonly run: string }
  | { readonly kind: "running"; readonly count: number; readonly jobs: TileJobs };

/** Records nobody wrote: every trace id reads as an empty record. */
const noTraces = Effect.runSync(
  Effect.gen(function* () {
    return yield* Traces;
  }).pipe(Effect.provide(memoryTraces([]))),
);

const session = (
  opts: {
    /** Where the host keeps its job table, kept between hosts as the home's folder is. */
    readonly jobs?: Storage;
    /** Kept between hosts, as the history file is. Each host shares it with no other. */
    readonly history?: History;
    /** Shared with another host, as two tiles share it. */
    readonly shared?: SharedHistory;
    readonly ledger?: Ledger["Service"];
    /** The desk's words, as a tile's tsh lists them (desk/words.ts); none by default. */
    readonly words?: readonly Entry[];
    /** The jobs' records `trace` reads. None written, unless a test hands its own. */
    readonly traces?: Layer.Layer<Traces>;
    /** Who the tsh runs as: the person, unless a test hands an agent (tracker 185b, PR 3). */
    readonly author?: Author["Service"];
  } = {},
) =>
  Effect.gen(function* () {
    const seen: Seen[] = [];
    const screens = new Map<string, WindowScreen>();
    const runs: Runs = {
      began: (run, program, placed, screen) => {
        screens.set(run, screen);
        seen.push({ kind: "open", run, program, placed });
        screen.show((m) => seen.push({ kind: "view", run, data: m.data }));
      },
      forward: (run) => seen.push({ kind: "forward", run }),
      line: (runs) => seen.push({ kind: "line", runs }),
      ended: (run) => {
        const screen = screens.get(run);

        if (screen === undefined) {
          return;
        }

        screens.delete(run);
        seen.push({ kind: "close", run });
        // As a real view does: taking it away says `closed`, whoever took it away.
        screen.closed();
      },
      jobs: (jobs) => seen.push({ kind: "running", count: jobs.running.length, jobs }),
    };
    // Each session is a host of its own: it opens the host's table, on the storage it is handed.
    const jobs = yield* openJobs(opts.jobs ?? memoryStorage());
    // The host's job lines, as the host hands them to each tile: what the agents' `job` tool reads.
    const lines = yield* jobLines(jobs.table);
    const host = yield* startTsh({
      tile: "t1",
      jobs,
      history: opts.shared ?? (yield* sharedHistory(opts.history ?? memoryHistory())),
      runs,
      words: opts.words ?? [],
      lines,
    }).pipe(
      Effect.provideService(Ledger, opts.ledger ?? memoryService()),
      Effect.provideService(Author, opts.author ?? { kind: "user", id: "owner" }),
      // No pull requests: no test reads GitHub.
      Effect.provideService(PullRequests, { open: Effect.succeed([]) }),
      Effect.provide(opts.traces ?? memoryTraces([])),
    );
    let bytes = "";
    host.terminal.show((m) => {
      // The plan's status and reply regions share the terminal's port: only `write` is bytes.
      if (m.type === "write") {
        bytes += m.data;
      }
    });
    const rows = () => gridOf(bytes, 80, 1000).rows;
    /** Wait until `check` holds, for at most five seconds. */
    const until = <T>(what: string, check: () => T | undefined) =>
      Effect.gen(function* () {
        for (let i = 0; i < 1000; i += 1) {
          const got = check();

          if (got !== undefined) {
            return got;
          }

          yield* Effect.sleep("5 millis");
        }

        return yield* Effect.die(`waited for ${what}; the terminal shows:\n${rows().join("\n")}`);
      });
    /** Wait until the terminal's last row is the prompt, after `n` prompts in all. */
    const prompts = (n: number) =>
      until(`prompt ${n}`, () => {
        const all = rows();
        return all.filter((r) => r.startsWith("tsh$")).length >= n && all.at(-1) === "tsh$" ? all : undefined;
      });
    const type = (data: string) => host.terminal.heard({ type: "keys", data });
    const opened = (n = 1) => until(`window ${n}`, () => seen.filter((s) => s.kind === "open").at(n - 1));
    const viewed = (run: string, data: unknown) =>
      until(`${run} at ${JSON.stringify(data)}`, () =>
        seen.find((s) => s.kind === "view" && s.run === run && JSON.stringify(s.data) === JSON.stringify(data)),
      );
    const closed = (run: string) => until(`${run} closed`, () => seen.find((s) => s.kind === "close" && s.run === run));
    /** The run's window, or one that refuses all it hears: a test pressing on no window fails on what it is told. */
    const window = (run: string): WindowScreen =>
      screens.get(run) ?? {
        show: () => () => {},
        heard: () => ({ kind: "refused", why: `no window for ${run}` }),
        closed: () => {},
        kill: Effect.void,
      };
    const press = (run: string, value: unknown) => window(run).heard({ type: "msg", msg: { type: "press", value } });
    return {
      host,
      jobs,
      lines,
      rows,
      until,
      prompts,
      type,
      opened,
      viewed,
      closed,
      window,
      press,
      seen,
    };
  });

/** Ticket 7 on `ledger`, as a lane left it (@tea-fabrika/tracker/seven). */
const seedSeven = (ledger: Ledger["Service"]) =>
  Effect.gen(function* () {
    yield* ledger.register(nameOf(7), "user:owner");
    yield* ledger.send(streams(nameOf(7)).inbox, "filed", {
      kind: "filed",
      writer: "user:owner",
      data: { type: "filed", title: SEVEN_TITLE, body: SEVEN_BODY },
    });
    const tickets = yield* Tickets;

    for (const e of SEVEN.slice(1)) {
      yield* tickets.write(7, `w/${e.pos}`, e.fact as CodeFact);
    }
  }).pipe(Effect.provide(ticketsOnLedger(LANE)), Effect.provide(Layer.succeed(Ledger, ledger)));

const go = <A, E>(test: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(test.pipe(Effect.provide(nodeFileSystem)));

/** The last view the run's window was shown names `text`, wherever its data holds it. */
const mentions = (seen: readonly Seen[], run: string, text: string): true | undefined => {
  const last = seen.filter((x) => x.kind === "view" && x.run === run).at(-1);
  return last?.kind === "view" && JSON.stringify(last.data).includes(text) ? true : undefined;
};

describe("the terminal", () => {
  // Plan: Enter stamps `said` before a line waits; turn_began keeps the job and typed line too.
  it("T237-7: a delayed line keeps its Enter clock and execution clock in turn_began", async () => {
    const logs: Record<string, unknown>[] = [];
    const caught = Logger.make((o) => {
      const row = Logger.formatStructured.log(o);

      if (row.message === "turn_began") {
        logs.push({ at: Date.parse(row.timestamp), ...row.annotations });
      }
    });
    const text = "  @scout why #7? don't cut a | b &";
    await go(
      Effect.gen(function* () {
        const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
        execFileSync("git", ["init", "-q"], { cwd: folder });
        const clock = yield* Clock.Clock;
        let now = 1_000;
        yield* Effect.gen(function* () {
          const manager = yield* Shell.SummonManager;
          yield* manager.summon({ agent: "fake", settings: [], name: "scout", by: "user:owner" });
          const s = yield* session();
          yield* s.prompts(1);
          const release = yield* Deferred.make<void>();
          lineGate.wait = Deferred.await(release);
          lineGate.entered = false;
          s.type(`${text}\r`);
          yield* s.until("the line at the door", () => (lineGate.entered ? true : undefined));
          now = 2_000;
          yield* Deferred.succeed(release, undefined);
          yield* s.prompts(2);
        }).pipe(
          Effect.scoped,
          Effect.provide(summonManager({ storage: memoryStorage(), folder })),
          Effect.provideService(Clock.Clock, {
            currentTimeMillisUnsafe: () => now,
            currentTimeMillis: Effect.sync(() => now),
            currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
            currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            monotonicTimeNanos: clock.monotonicTimeNanos,
            sleep: (duration) => clock.sleep(duration),
          }),
          Effect.provide(Logger.layer([caught])),
        );
      }).pipe(
        Effect.scoped,
        Effect.ensuring(
          Effect.sync(() => {
            lineGate.wait = undefined;
          }),
        ),
      ),
    );
    expect(logs).toHaveLength(1);
    const began = logs[0]!;
    expect({ ...began, job: began.job ?? began.n }).toMatchObject({
      name: "scout",
      agent: "fake",
      turn: 1,
      job: 1,
      line: text,
      said: 1_000,
      at: 2_000,
    });
    expect(began.run).toMatch(/^acp:/);
  });

  it("runs a typed line, and shows what tsh printed under it", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        expect(s.type("seq --to 3 | double\r")).toEqual({ kind: "read" });
        return yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ seq --to 3 | double", "double 2", "double 4", "double 6", "tsh$"]);
  });

  it("draws the screen once on a terminal that still holds it, as after the app reconnects", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("seq --to 3 | double\r");
        yield* s.prompts(2);
        // One page's terminal, shown the screen on its first port, then again on the next.
        let page = "";
        const first = s.host.terminal.show((m) => {
          if (m.type === "write") {
            page += m.data;
          }
        });
        first();
        s.host.terminal.show((m) => {
          if (m.type === "write") {
            page += m.data;
          }
        });
        return gridOf(page, 80, 1000).rows;
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ seq --to 3 | double", "double 2", "double 4", "double 6", "tsh$"]);
  });

  it("completes a program's name on Tab", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("cou\t");
        return yield* s.until("counter on the line", () => (s.rows()[0] === "tsh$ counter" ? s.rows() : undefined));
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ counter"]);
  });

  it("refuses what does not read, and tells tsh nothing of it", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        const refused = [
          s.host.terminal.heard({ type: "line", value: "say --text no" }),
          s.host.terminal.heard({ type: "keys", data: "say --text no\r", to: "tsh:p1" }),
          s.host.terminal.heard({ type: "size", cols: 0, rows: 24 }),
          s.host.terminal.heard("say --text no\r"),
        ];
        s.type("say --text yes\r");
        return { refused, rows: yield* s.prompts(2) };
      }).pipe(Effect.scoped),
    );
    expect(seen.refused.map((r) => r.kind)).toEqual(Array(4).fill("refused"));
    expect(seen.rows).toEqual(["tsh$ say --text yes", "yes", "tsh$"]);
  });

  it("ends when tsh ends, on Ctrl-D", async () => {
    const ended = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("\x04");
        yield* s.host.ended;
        return true;
      }).pipe(Effect.scoped),
    );
    expect(ended).toBe(true);
  });
});

describe("a program's window", () => {
  it("opens for counter, is told a press, and closing it ends counter: tsh prints its count", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter\r");
        const open = yield* s.opened();
        yield* s.viewed(open.run, { n: 0 });
        const busy = s.rows();
        expect(s.press(open.run, "plus")).toEqual({ kind: "read" });
        yield* s.viewed(open.run, { n: 1 });
        // tsh's own input is not counter's: a line sent on counter's window is refused.
        const wrong = s.window(open.run).heard({ type: "msg", msg: { type: "line", value: "x" } });
        const bad = s.press(open.run, "minus");
        const named = s.window(open.run).heard({ type: "msg", to: "tsh:p1", msg: null });
        s.window(open.run).closed();
        const rows = yield* s.prompts(2);
        yield* s.closed(open.run);
        return { open, busy, wrong, bad, named, rows };
      }).pipe(Effect.scoped),
    );
    expect(seen.open.program).toBe("counter");
    expect(seen.open.placed).toBe("foreground");
    // The prompt waits while counter runs in the foreground: the cursor is on a fresh row.
    expect(seen.busy).toEqual(["tsh$ counter", ""]);
    expect(seen.wrong).toEqual({ kind: "refused", why: "counter has no input line" });
    expect(seen.bad.kind === "refused" && seen.bad.why).toMatch(/^counter's press does not fit/);
    expect(seen.named.kind).toBe("refused");
    expect(seen.rows).toEqual(["tsh$ counter", "1", "tsh$"]);
  });

  it("opens for the tracker, files a ticket from it, and a new host on the same ledger lists it", async () => {
    const isShown = Schema.is(tracker.view.data);
    /** The titles the tracker's window was shown last, once it had read the ledger. */
    const titles = (seen: readonly Seen[], run: string) => {
      const last = seen.filter((s) => s.kind === "view" && s.run === run).at(-1);
      const data = last?.kind === "view" ? last.data : undefined;
      return isShown(data) && data.ready && data.page.kind === "list"
        ? data.page.tickets.map((t) => t.title)
        : undefined;
    };
    const ledger = memoryService();
    const seen = await go(
      Effect.gen(function* () {
        const first = yield* Effect.gen(function* () {
          const s = yield* session({ ledger });
          s.type("tracker\r");
          const open = yield* s.opened();
          const empty = yield* s.until("the empty list", () => titles(s.seen, open.run));
          const told = s.window(open.run).heard({
            type: "msg",
            msg: { type: "file", value: { title: "Login fails", body: "" } },
          });
          const filed = yield* s.until("the ticket on the list", () =>
            titles(s.seen, open.run)?.length === 1 ? titles(s.seen, open.run) : undefined,
          );
          // Closing its window is the person's "done": the tracker ends once its writes are saved.
          s.window(open.run).closed();
          yield* s.closed(open.run);
          return { program: open.program, empty, told, filed, rows: yield* s.prompts(2) };
        }).pipe(Effect.scoped);

        // A new host, with a new tsh, on the same ledger: the ticket is there.
        const s = yield* session({ ledger });
        s.type("tracker\r");
        const open = yield* s.opened();
        return { first, again: yield* s.until("the list again", () => titles(s.seen, open.run)) };
      }).pipe(Effect.scoped),
    );
    expect(seen).toEqual({
      first: {
        program: "tracker",
        empty: [],
        told: { kind: "read" },
        filed: ["Login fails"],
        rows: ["tsh$ tracker", "tsh$"],
      },
      again: ["Login fails"],
    });
  });

  it("closes when counter is done, pressed in its window", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter\r");
        const open = yield* s.opened();
        s.press(open.run, "plus");
        s.press(open.run, "plus");
        s.press(open.run, "done");
        yield* s.closed(open.run);
        return yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ counter", "2", "tsh$"]);
  });

  it("is stopped by Ctrl-C in the terminal, and closes", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter\r");
        const open = yield* s.opened();
        yield* s.viewed(open.run, { n: 0 });
        s.type("\x03");
        yield* s.closed(open.run);
        return yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
    expect(rows.slice(0, 2)).toEqual(["tsh$ counter", "^C"]);
    expect(rows.at(-1)).toBe("tsh$");
  });

  it("opens for `counter &` and gives the prompt back at once, as a background job", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter &\r");
        const open = yield* s.opened();
        const back = yield* s.prompts(2);
        const counted = yield* s.until("one running job", () =>
          s.seen.find((x) => x.kind === "running" && x.count === 1),
        );
        s.type("say --text meanwhile\r");
        yield* s.prompts(3);
        s.press(open.run, "plus");
        s.press(open.run, "done");
        yield* s.closed(open.run);
        const rows = yield* s.until("counter's count", () =>
          s.rows().some((r) => r.includes("1")) && s.rows().at(-1) === "tsh$" ? s.rows() : undefined,
        );
        const none = yield* s.until("no running job", () =>
          s.seen.findLast((x) => x.kind === "running" && x.count === 0),
        );
        return { open, back, rows, counted, none };
      }).pipe(Effect.scoped),
    );
    expect(seen.open.placed).toBe("background");
    expect(seen.counted.kind === "running" && seen.counted.jobs.running).toEqual([
      { n: 1, text: "counter", since: expect.any(Number), foreground: false },
    ]);
    // It ended on its own, after `done`: the tile is told so, in a job record's words.
    expect(seen.none.kind === "running" && seen.none.jobs).toEqual({
      running: [],
      ended: {
        n: 1,
        text: "counter",
        how: "done",
        since: expect.any(Number),
        at: expect.any(Number),
        foreground: false,
      },
    });
    expect(seen.back[0]).toBe("tsh$ counter &");
    expect(seen.back.at(-1)).toBe("tsh$");
    expect(seen.rows).toContain("meanwhile");
    expect(seen.rows.at(-1)).toBe("tsh$");
  });

  it("comes to the foreground on `attach %n`, as bash's fg, and the prompt waits for its end", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter &\r");
        const open = yield* s.opened();
        yield* s.prompts(2);
        const before = s.seen.some((x) => x.kind === "forward");
        s.type("attach %1\r");
        const forward = yield* s.until("counter forward", () => s.seen.find((x) => x.kind === "forward"));
        s.press(open.run, "plus");
        s.press(open.run, "done");
        yield* s.closed(open.run);
        const rows = yield* s.prompts(3);
        return { open, before, forward, rows };
      }).pipe(Effect.scoped),
    );
    expect(seen.open.placed).toBe("background");
    expect(seen.before).toBe(false);
    expect(seen.forward).toEqual({ kind: "forward", run: seen.open.run });
    expect(seen.rows).toContain("tsh$ attach %1");
    expect(seen.rows.at(-1)).toBe("tsh$");
  });

  it("closes: its programs get the end of their inputs and end on their own, then tsh ends", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("tally &\r");
        yield* s.prompts(2);
        s.type("counter &\r");
        const open = yield* s.opened();
        yield* s.prompts(3);
        yield* s.host.close;
        // Said again: nothing more happens.
        yield* s.host.close;
        yield* s.closed(open.run);
        yield* s.host.ended;
        // The terminal draws what tsh said last a moment after tsh ended.
        return yield* s.until("both ends", () =>
          s.rows().includes("[1] ended  tally") && s.rows().includes("[2] ended  counter") ? s.rows() : undefined,
        );
      }).pipe(Effect.scoped),
    );
    // Each ended on its own, as on stdin's end: not "stopped".
    expect(rows).toContain("[1] ended  tally");
    expect(rows).toContain("[2] ended  counter");
    expect(rows.some((r) => r.includes("stopped") || r.includes("stop with tsh"))).toBe(false);
  });

  it("closes, and a program that does not end on its inputs' end keeps tsh running", async () => {
    const still = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("sleep --ms 600000 &\r");
        yield* s.until("one running job", () => s.seen.find((x) => x.kind === "running" && x.count === 1));
        yield* s.host.close;
        const ended = yield* s.host.ended.pipe(Effect.timeoutOption("300 millis"));
        return ended._tag;
      }).pipe(Effect.scoped),
    );
    expect(still).toBe("None");
  });

  it("tells the tile a job it waits for with no view, and how each job ended: stopped, failed", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        // One program, no view, in the foreground: tsh `call`s it, and holds no handle to it.
        s.type("sleep --ms 600000\r");
        const waiting = yield* s.until("the sleep, waited for", () =>
          s.seen.find((x) => x.kind === "running" && x.count === 1),
        );
        s.type("\x03");
        const stopped = yield* s.until("the sleep, stopped", () =>
          s.seen.find((x) => x.kind === "running" && x.jobs.ended?.how === "stopped"),
        );
        yield* s.prompts(2);
        s.type("false &\r");
        const failed = yield* s.until("false, failed", () =>
          s.seen.find((x) => x.kind === "running" && x.jobs.ended?.how === "failed"),
        );
        return { waiting, stopped, failed };
      }).pipe(Effect.scoped),
    );
    const jobsOf = (x: (typeof seen)["waiting"]) => (x.kind === "running" ? x.jobs : null);
    expect(jobsOf(seen.waiting)?.running).toEqual([
      { n: 1, text: "sleep --ms 600000", since: expect.any(Number), foreground: true },
    ]);
    expect(jobsOf(seen.stopped)).toMatchObject({
      running: [],
      ended: { n: 1, text: "sleep --ms 600000", how: "stopped", foreground: true },
    });
    expect(jobsOf(seen.failed)).toMatchObject({
      running: [],
      ended: { n: 2, text: "false", how: "failed", foreground: false },
    });
  });

  it("does not open for a line tsh refuses", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter --missing yes\r");
        const rows = yield* s.prompts(2);
        return { rows, seen: [...s.seen] };
      }).pipe(Effect.scoped),
    );
    expect(seen.seen.filter((x) => x.kind !== "running")).toEqual([]);
    expect(seen.rows[1]).toMatch(/^tsh: /);
  });

  it("carries the pick down `tracker | ticket | trace`, and one window closed ends its one process", async () => {
    // Ticket 141: `trace` is the ticket's view, and `runs` is gone. The trace's view names a
    // lane by its trace id, so a ticket with a lane shows that id once its facts are read.
    const ledger = memoryService();
    const got = await go(
      Effect.gen(function* () {
        yield* seedSeven(ledger);
        const s = yield* session({ ledger });
        s.type("tracker | ticket | trace\r");
        yield* s.opened(3);
        // The windows open from the end of the line back: each found by its program.
        const of = (program: string) =>
          s.until(`${program}'s window`, () => {
            const one = s.seen.find((x) => x.kind === "open" && x.program === program);
            return one?.kind === "open" ? one : undefined;
          });
        const [picker, page, view] = [yield* of("tracker"), yield* of("ticket"), yield* of("trace")];
        const pick = (ticket: number) =>
          s.window(picker.run).heard({ type: "msg", msg: { type: "query", value: { ticket } } });
        pick(7);
        yield* s.until("trace shows ticket 7's lane", () => mentions(s.seen, view.run, SEVEN_TRACE));
        // The ticket's window closes: that one process gets the end of its inputs, and ends.
        s.window(page.run).closed();
        yield* s.closed(page.run);
        // Its input from the ticket ended, and the trace goes on showing the last ticket.
        const traceOpen = !s.seen.some((x) => x.kind === "close" && x.run === view.run);
        // The tracker's next pick goes down a pipe whose reader is gone: the send fails, and it ends.
        // A second ticket, since the tracker sends only a new pick (`pickOf`).
        pick(8);
        yield* s.closed(picker.run);
        // The last window closed: the line is over, and the prompt is back.
        s.window(view.run).closed();
        yield* s.closed(view.run);
        const rows = yield* s.prompts(2);
        return { programs: [picker.program, page.program, view.program], traceOpen, rows };
      }).pipe(Effect.scoped),
    );
    expect(got).toMatchObject({ programs: ["tracker", "ticket", "trace"], traceOpen: true });
    // The ticket had ended, so the pipe answered `stopped`: tsh says why the tracker failed.
    expect(got.rows).toEqual([
      "tsh$ tracker | ticket | trace",
      "tsh: tracker failed: tracker sent ticket down a pipe that answered stopped",
      "tsh$",
    ]);
  });
  it("is the first stage of a pipe: closing it sends the count on", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter | double\r");
        const open = yield* s.opened();
        s.press(open.run, "plus");
        yield* s.viewed(open.run, { n: 1 });
        s.window(open.run).closed();
        return yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ counter | double", "double 2", "tsh$"]);
  });

  it("opens ticket 7 on `trace --ticket 7`: the lane its facts name shows", async () => {
    const ledger = memoryService();
    const seen = await go(
      Effect.gen(function* () {
        yield* seedSeven(ledger);
        const s = yield* session({ ledger });
        s.type("trace --ticket 7\r");
        const open = yield* s.opened(1);
        yield* s.until("trace shows ticket 7's lane", () => mentions(s.seen, open.run, SEVEN_TRACE));
        s.window(open.run).closed();
        yield* s.prompts(2);
        return { open };
      }).pipe(Effect.scoped),
    );
    expect([seen.open.program, seen.open.placed]).toEqual(["trace", "foreground"]);
  });

  it("takes the ticket a pipe sends on `ticket --ticket 7 | trace`", async () => {
    const ledger = memoryService();
    await go(
      Effect.gen(function* () {
        yield* seedSeven(ledger);
        const s = yield* session({ ledger });
        s.type("ticket --ticket 7 | trace\r");
        yield* s.opened(2);
        const view = s.seen.find((x) => x.kind === "open" && x.program === "trace");

        if (view?.kind !== "open") {
          return yield* Effect.die("trace did not open");
        }

        yield* s.until("trace shows ticket 7's lane", () => mentions(s.seen, view.run, SEVEN_TRACE));

        for (const o of s.seen) {
          if (o.kind === "open") {
            s.window(o.run).closed();
          }
        }

        yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
  });

  it("takes the tracker's pick on `tracker | trace`", async () => {
    const ledger = memoryService();
    await go(
      Effect.gen(function* () {
        yield* seedSeven(ledger);
        const s = yield* session({ ledger });
        s.type("tracker | trace\r");
        yield* s.opened(2);
        const find = (program: string) => {
          const one = s.seen.find((x) => x.kind === "open" && x.program === program);
          return one?.kind === "open" ? one.run : "";
        };
        s.window(find("tracker")).heard({ type: "msg", msg: { type: "query", value: { ticket: 7 } } });
        yield* s.until("trace shows ticket 7's lane", () => mentions(s.seen, find("trace"), SEVEN_TRACE));

        for (const o of s.seen) {
          if (o.kind === "open") {
            s.window(o.run).closed();
          }
        }

        yield* s.prompts(2);
      }).pipe(Effect.scoped),
    );
  });
  it("ends `seq --to 3 | tally | trace` on trace's window, showing that line's own job", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("seq --to 3 | tally | trace\r");
        yield* s.opened(1);
        const open = s.seen.find((x) => x.kind === "open");

        if (open?.kind !== "open") {
          return yield* Effect.die("trace did not open");
        }

        const read = yield* s.until("trace read its job's record", () =>
          s.seen.find((x) => x.kind === "view" && x.run === open.run && (x.data as { read?: string }).read === "read"),
        );
        const job = s.jobs.table.getState().jobs[0];
        s.window(open.run).closed();
        yield* s.prompts(2);
        return { open, read, job };
      }).pipe(Effect.scoped),
    );
    expect([seen.open.program, seen.open.placed]).toEqual(["trace", "foreground"]);
    // tally's total fits no typed input of trace, so it went to `any`: the line is one job.
    expect(seen.job?.stages.map((st) => st.program)).toEqual(["seq", "tally", "trace"]);
    // Its trace id is its first run's, seq's: the record trace follows is the line's own.
    const first = seen.job?.stages[0].run ?? "";
    expect((seen.read as { data: { id: string } }).data.id).toBe(runTraceId(first));
  });
});

describe("what a pipe can feed", () => {
  const apps = appPrograms(memoryService(), { kind: "user", id: "owner" }, { open: Effect.succeed([]) }, noTraces);
  const list = tshList(apps);
  const takes = (name: string) => {
    const entry = apps.find((e) => e.program.name === name);

    if (entry === undefined) {
      throw new Error(`no program ${name}`);
    }

    return Shell.fedBy(entry.program, list);
  };

  it("is each program's data, never its commands: the frame's takes", () => {
    expect(takes("tracker")).toEqual([]);
    expect(takes("ticket")).toEqual(["ticket"]);
    // `any` takes whatever no typed input does (`anyInput`): a pipe feeds it from anything.
    // Ticket 141: trace takes a ticket too, and its window's inputs are no pipe's.
    expect(takes("trace")).toEqual(expect.arrayContaining(["ticket", "any"]));

    for (const own of ["toggle", "choose", "quit", "seek", "step"]) {
      expect(takes("trace")).not.toContain(own);
    }
  });

  /** The input of trace a line feeds, as the shell's fit check wires it. */
  const fedInto = (text: string, program: string) => {
    const parsed = Shell.parse(text);

    if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run") {
      throw new Error(text);
    }

    const checked = Shell.check(parsed.statements[0].pipeline, Shell.programList(list), text);

    if (checked.kind !== "line") {
      throw new Error(`${text}: ${JSON.stringify(checked)}`);
    }

    return checked.line.stages.find((stage) => stage.entry.program.name === program)?.fed;
  };

  it("wires a ticket into trace's `ticket` input, never into `any` (J1)", () => {
    expect(fedInto("tracker | trace", "trace")).toBe("ticket");
    expect(fedInto("ticket | trace", "trace")).toBe("ticket");
    expect(fedInto("pipeline --ticket 7 | trace", "trace")).toBe("ticket");
    expect(fedInto("trace --ticket 7", "trace")).toBeNull();
  });

  it("keeps every line into trace that works today (J1)", () => {
    // tally's total fits no typed input of trace: it goes to `any`, taken and let go.
    expect(fedInto("seq --to 3 | tally | trace", "trace")).toBe("any");
    // Alone on a line, it is fed by nothing: it checks as a line of its own.
    expect(fedInto(`trace --id ${SEVEN_TRACE}`, "trace")).toBeNull();
  });

  it("is what a line wires each stage's pipe into", () => {
    const text = "tracker | ticket | trace";
    const parsed = Shell.parse(text);

    if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run") {
      throw new Error(text);
    }

    const checked = Shell.check(parsed.statements[0].pipeline, Shell.programList(list), text);

    if (checked.kind !== "line") {
      throw new Error(text);
    }

    for (const stage of checked.line.stages.slice(1)) {
      expect(takes(stage.entry.program.name)).toContain(stage.fed);
    }
  });
});

describe("what is kept for the next start", () => {
  it("keeps the history: Up at the next start shows the last line", async () => {
    const history = memoryHistory();
    const rows = await go(
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const s = yield* session({ history });
          s.type("say --text one\r");
          yield* s.prompts(2);
          s.type("seq --to 2\r");
          yield* s.prompts(3);
        }).pipe(Effect.scoped);
        const s = yield* session({ history });
        s.type("\x1b[A");
        return yield* s.until("the last line", () => (s.rows()[0] === "tsh$ seq --to 2" ? s.rows() : undefined));
      }).pipe(Effect.scoped),
    );
    expect(history.kept()).toEqual(["say --text one", "seq --to 2"]);
    expect(rows).toEqual(["tsh$ seq --to 2"]);
  });

  it("shares the history between two tiles: a line typed in one is in the other's Up", async () => {
    const rows = await go(
      Effect.gen(function* () {
        const shared = yield* sharedHistory(memoryHistory());
        const one = yield* session({ shared });
        const two = yield* session({ shared });
        one.type("say --text from-one\r");
        yield* one.prompts(2);
        two.type("\x1b[A");
        return yield* two.until("tile one's line", () =>
          two.rows()[0] === "tsh$ say --text from-one" ? two.rows() : undefined,
        );
      }).pipe(Effect.scoped),
    );
    expect(rows).toEqual(["tsh$ say --text from-one"]);
  });

  it("keeps jobs in a folder: the app quits with counter's window up, the next host attaches it at 1", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
        // The first host: counter, +1, then the host stops with counter's window up, as the app
        // quits. Its window closes as the host stops, and says `closed`: that must not end counter.
        const first = yield* Effect.gen(function* () {
          const s = yield* session({ jobs: fileStorage(dir) });
          s.type("counter\r");
          const open = yield* s.opened();
          s.press(open.run, "plus");
          yield* s.viewed(open.run, { n: 1 });
          return open.run;
        }).pipe(Effect.scoped);

        // The next host, on the same folder: a new tsh, which finds the table the first one left.
        const s = yield* session({ jobs: fileStorage(dir) });
        const found = yield* s.until("the earlier job", () => s.rows().find((r) => r.startsWith("tsh: 1 job")));
        s.type("attach %1\r");
        const open = yield* s.opened();
        yield* s.viewed(open.run, { n: 1 });
        s.press(open.run, "plus");
        yield* s.viewed(open.run, { n: 2 });
        s.press(open.run, "done");
        yield* s.closed(open.run);
        yield* s.prompts(2);
        s.type("jobs\r");
        const rows = yield* s.prompts(3);
        return { first, found, attached: open.run, rows };
      }).pipe(Effect.scoped),
    );
    expect(seen.found).toMatch(/^tsh: 1 job from an earlier tsh, not running: %1\./);
    // The same run, under its id, found where it was left.
    expect(seen.attached).toBe(seen.first);
    // Then it ends on its own, so it leaves the table: `jobs` lists nothing.
    expect(seen.rows.slice(-2)).toEqual(["tsh$ jobs", "tsh$"]);
    expect(seen.rows).toContain("2");
  });
});

describe("the desk's words", () => {
  it("runs each key's word, which tells the desk what that key does", async () => {
    const said: Does[] = [];
    const editors: string[] = [];
    const words = [...BINDINGS.map((b) => wordOf(b.does)), "focus --to t3", "workspace --to 12"];
    await go(
      Effect.gen(function* () {
        const s = yield* session({
          words: deskWords((does) => {
            said.push(does);
            return null;
          }),
        });

        for (const [i, word] of words.entries()) {
          s.type(`${word}\r`);

          if (word === "keys") {
            const open = yield* s.opened();
            editors.push(open.program);
            yield* s.viewed(open.run, { open: true });
            s.window(open.run).closed();
            yield* s.closed(open.run);
          }

          yield* s.prompts(i + 2);
        }
      }).pipe(Effect.scoped),
    );
    expect(editors).toEqual(["keys"]);
    // C-b J's word is tsh's own `jobs`, which prints the list in the tile and tells the desk nothing.
    // C-b A's `agents` is tsh's own too: the plan's grammar lists `agents` among tsh's built-ins.
    const own = new Set(["jobs", "agents"]);
    const toDesk = BINDINGS.filter((b) => !own.has(wordOf(b.does)));
    expect(toDesk).toHaveLength(BINDINGS.length - 2);
    expect(said).toEqual([...toDesk.map((b) => b.does), { kind: "go", tile: "t3" }, { kind: "pick", at: 12 }]);
  });

  it("prints why the desk did nothing, and tells it nothing of a word it cannot read", async () => {
    const said: Does[] = [];
    const rows = await go(
      Effect.gen(function* () {
        const s = yield* session({
          words: deskWords((does) => {
            said.push(does);
            return does.kind === "go" ? `no tile ${does.tile}` : null;
          }),
        });
        s.type("focus --to t9\r");
        yield* s.prompts(2);
        s.type("focus --to sideways\r");
        return yield* s.prompts(3);
      }).pipe(Effect.scoped),
    );
    expect(rows).toContain("tsh: focus failed: no tile t9");
    expect(said).toEqual([{ kind: "go", tile: "t9" }]);
  });
});

// An agent's tsh (tracker 185b, PR 3). Today's version. Its Author is the agent's, so it lists only
// `forAgent`'s inputs and runs the lines the agent hands it with `Tsh.line`. Each line is written
// on the screen first, as typed, so the person sees what ran, and none goes in the shared history:
// the person's Up and Ctrl-R stay theirs. A line the person types there is refused with one line,
// and runs nothing: a person's line never runs as the agent. Ctrl-C is still the person's.
//
//   tsh.line("tally &")           "$ tally &"; {_tag: "job", job: {n: 1, tile: "t1", ...}}
//   tsh.line("counter")           {_tag: "job", ...}: it answers as the job begins
//   tsh.line("tally")             refused: claude's tile runs %2 in the foreground: stop it, or end the line with &
//   the person: "ls" Enter        lines here run as claude: split for your own tile (C-b |)

const CLAUDE = { kind: "agent", id: "claude", for: "owner" } as const;
const AS_CLAUDE = "agent:claude for:owner";

describe("an agent's tsh", () => {
  it("runs a line the agent hands it, shows it as typed, and keeps it out of the person's history", async () => {
    const history = memoryHistory(["git log --oneline -3"]);
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE, history });
        yield* s.prompts(1);
        // made up: `Tsh.line`, answering the tool's `LineAnswer`.
        const job = yield* s.host.line("tally &");
        const shown = yield* s.until("the line as typed", () => s.rows().find((r) => r.includes("$ tally &")));
        const said = yield* s.host.line("jobs");
        return {
          job,
          shown,
          said,
          by: s.jobs.table.getState().jobs.map((j) => [j.n, j.by]),
        };
      }).pipe(Effect.scoped),
    );
    expect(seen.job).toMatchObject({ _tag: "job", job: { n: 1, text: "tally &", tile: "t1" } });
    expect(seen.shown).toContain("$ tally &");
    expect(seen.said).toEqual({ _tag: "said", lines: ["[1] running   tally"], status: 0 });
    expect(seen.by).toEqual([[1, AS_CLAUDE]]);
    expect(history.kept()).toEqual(["git log --oneline -3"]);
  });

  it("refuses a second line while one runs in the foreground, and the person's Ctrl-C stops that one", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        const first = yield* s.host.line("counter");
        yield* s.opened();
        const second = yield* s.host.line("tally").pipe(Effect.flip);
        const behind = yield* s.host.line("tally &");
        s.type("\x03");
        // Stopped, not ended on its own: the screen says so. A job that ended leaves the table.
        const stopped = yield* s.until("the foreground job stopped, and left the table", () =>
          s.jobs.table.getState().jobs.some((j) => j.n === 1)
            ? undefined
            : s.rows().find((r) => r === "[stopped] counter"),
        );
        const after = yield* s.host.line("jobs");
        return { first, second, behind, stopped, after };
      }).pipe(Effect.scoped),
    );
    expect(seen.stopped).toBe("[stopped] counter");
    expect(seen.first).toMatchObject({ _tag: "job", job: { n: 1, text: "counter" } });
    expect(seen.second).toMatchObject({
      _tag: "LineRefused",
      why: "claude's tile runs %1 in the foreground: stop it, or end the line with &",
    });
    // A line in the background is no line in the foreground: it runs beside it.
    expect(seen.behind).toMatchObject({ _tag: "job", job: { n: 2, text: "tally &" } });
    expect(seen.after).toMatchObject({ _tag: "said", status: 0 });
  });

  it("refuses a line the person types there, with one line, and runs nothing", async () => {
    const history = memoryHistory();
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE, history });
        yield* s.prompts(1);
        s.type("tally &\r");
        const note = yield* s.until("the note", () => s.rows().find((r) => r.includes("lines here run as claude")));
        return { note, jobs: s.jobs.table.getState().jobs.length };
      }).pipe(Effect.scoped),
    );
    expect(seen.note).toBe("lines here run as claude: split for your own tile (C-b |)");
    expect(seen.jobs).toBe(0);
    expect(history.kept()).toEqual([]);
  });

  it("takes no person-only input: tracker's answer is no input here (d16)", async () => {
    const said = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        return yield* s.host.line("tracker answer=1");
      }).pipe(Effect.scoped),
    );
    expect(said._tag).toBe("said");
    expect(said._tag === "said" ? said.status : 0).not.toBe(0);
    expect(said._tag === "said" && said.lines.some((l) => l.includes("tracker has no input named answer"))).toBe(true);
  });
});

// Owed by PR 3's mutation step (tracker 185b). Today's version. Each pins one rule of an agent's
// line that no test above reached: the line's own shape, a person's tsh, Ctrl-C on either tile, a
// line beside the foreground that names no program, and a table's rows.
//
//   tsh.line("")                       refused: a line is 1 to 4096 characters on one line, ...
//   person's tsh.line("tally &")       refused: t1 is the person's tile: an agent's line runs only in its own
//   counter runs; tsh.line("nosuch &") {_tag: "said", lines: [...], status: 127}
//   tsh.line("experiments")            the table on the person's screen, its rows as text for the agent

/** What `Tsh.line` refuses for the line's own shape (packages/fabrika/src/mcp/line.ts). */
const SHAPE = "a line is 1 to 4096 characters on one line, with no control character";

describe("an agent's tsh: what the mutation step found untested", () => {
  it("refuses a line that is empty, has a newline, is past 4096 characters or holds a control character, and writes nothing; 4096 is taken", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        const refused = [];

        for (const text of ["", "a\nb", "x".repeat(4097), "\x1b[2J"]) {
          refused.push(yield* s.host.line(text).pipe(Effect.flip));
        }

        const before = s.rows().filter((r) => r.startsWith("$ "));
        const jobs = s.jobs.table.getState().jobs.length;
        const longest = yield* s.host.line("x".repeat(4096));
        return { refused, before, jobs, longest };
      }).pipe(Effect.scoped),
    );
    expect(seen.refused).toEqual(Array(4).fill(expect.objectContaining({ why: SHAPE })));
    expect(seen.refused.map((r) => r._tag)).toEqual(Array(4).fill("LineRefused"));
    expect(seen.before).toEqual([]);
    expect(seen.jobs).toBe(0);
    // Taken: no program has that name, so tsh says so, and the line is done.
    expect(seen.longest).toMatchObject({ _tag: "said", status: 127 });
  });

  it("refuses a line in a person's tsh, and prints and starts nothing", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        yield* s.prompts(1);
        const refused = yield* s.host.line("tally &").pipe(Effect.flip);
        yield* Effect.sleep("50 millis");
        return { refused, rows: s.rows(), jobs: s.jobs.table.getState().jobs.length };
      }).pipe(Effect.scoped),
    );
    expect(seen.refused).toMatchObject({
      _tag: "LineRefused",
      why: "t1 is the person's tile: an agent's line runs only in its own",
    });
    expect(seen.rows).toEqual(["tsh$"]);
    expect(seen.jobs).toBe(0);
  });

  it("reads a resize in an agent's tile, and the person's Ctrl-C there stops the foreground job with one interrupt", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        const resized = s.host.terminal.heard({ type: "size", cols: 100, rows: 30 });
        yield* s.host.line("counter");
        yield* s.opened();
        const before = signals.told;
        s.type("\x03");
        const stopped = yield* s.until("counter stopped", () => s.rows().find((r) => r === "[stopped] counter"));
        yield* Effect.sleep("50 millis");
        return { resized, stopped, interrupts: signals.told - before };
      }).pipe(Effect.scoped),
    );
    expect(seen.resized).toEqual({ kind: "read" });
    expect(seen.stopped).toBe("[stopped] counter");
    expect(seen.interrupts).toBe(1);
  });

  it("tells tsh one interrupt for one Ctrl-C in a person's tile, as the editor sends it while busy", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session();
        s.type("counter\r");
        yield* s.opened();
        const before = signals.told;
        s.type("\x03");
        const stopped = yield* s.until("counter stopped", () => s.rows().find((r) => r === "[stopped] counter"));
        yield* Effect.sleep("50 millis");
        return { stopped, interrupts: signals.told - before };
      }).pipe(Effect.scoped),
    );
    expect(seen.stopped).toBe("[stopped] counter");
    expect(seen.interrupts).toBe(1);
  });

  it("answers a line beside the foreground that names no program with its status, and does not hang", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        yield* s.host.line("counter");
        yield* s.opened();
        return yield* s.host
          .line("nosuch &")
          .pipe(Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.die("it hung") }));
      }).pipe(Effect.scoped),
    );
    expect(seen).toMatchObject({ _tag: "said", status: 127 });
    expect(seen._tag === "said" && seen.lines.some((l) => l.includes("nosuch"))).toBe(true);
  });

  it("shows a program's table, run by the agent's line, on the person's screen", async () => {
    const shown = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        yield* s.host.line("experiments");
        return yield* s.until("the table on the screen", () => s.rows().find((r) => r.includes("Experiments")));
      }).pipe(Effect.scoped),
    );
    expect(shown).toContain("Experiments");
  });

  // The line's program begins a job, so its answer is `job` (the plan, PR 3), and the agent reads
  // the table as the job's lines, with the `job` tool (`lines.job`, job-lines.ts).
  // Red on PR 3a's build: tsh keeps a table's rows only for the line's `said` (`speaking()`), never
  // as the job's lines, so the job's lines never hold them.
  it("answers the agent with a table's rows as text", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        const answer = yield* s.host.line("experiments");
        const row = yield* s.until("the table in job 1's lines", () =>
          s.lines.job(1)?.lines.find((l) => l.includes("Experiments")),
        );
        return { answer, row };
      }).pipe(Effect.scoped),
    );
    expect(seen.answer).toMatchObject({ _tag: "job", job: { n: 1 } });
    expect(seen.row).toContain("Experiments");
  });
});

// `attach %n` with no & (PR 381's review, finding 1). Today's version. The job keeps the number it
// had, so it never begins since the line was sent: the line answers with that job as it comes to
// the foreground, as a fresh foreground line answers at its job's start, so the call never waits on
// the job's end and the next line is not held behind it.
//
//   tsh.line("counter &"); tsh.line("attach %1")   {_tag: "job", job: {n: 1, text: "counter", ...}}
//   the next host: tsh.line("attach %1")           the same answer, for the detached job

/** The `line` call's own bound in these cases: a hang fails here, not at the test's timeout. */
const answered = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.die("it hung") }));

describe("an agent's tsh: attach %n in the foreground", () => {
  it("answers with the job as a job of the background comes to the foreground, and takes the next line", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const s = yield* session({ author: CLAUDE });
        yield* s.prompts(1);
        yield* s.host.line("counter &");
        yield* s.opened();
        const attached = yield* answered(s.host.line("attach %1"));
        const next = yield* answered(s.host.line("tally &"));
        return { attached, next };
      }).pipe(Effect.scoped),
    );
    expect(seen.attached).toEqual({
      _tag: "job",
      job: { n: 1, text: "counter", tile: "t1", state: { _tag: "running" }, lines: [] },
    });
    expect(seen.next).toMatchObject({ _tag: "job", job: { n: 2, text: "tally &" } });
  });

  it("answers with the job as a detached job is attached again, and takes the next line", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
        // The first host: the agent's counter, left running as the host stops.
        yield* Effect.gen(function* () {
          const s = yield* session({ author: CLAUDE, jobs: fileStorage(dir) });
          yield* s.prompts(1);
          yield* s.host.line("counter &");
          yield* s.opened();
        }).pipe(Effect.scoped);

        const s = yield* session({ author: CLAUDE, jobs: fileStorage(dir) });
        yield* s.until("the earlier job", () => s.rows().find((r) => r.startsWith("tsh: 1 job")));
        const attached = yield* answered(s.host.line("attach %1"));
        const next = yield* answered(s.host.line("tally &"));
        return { attached, next };
      }).pipe(Effect.scoped),
    );
    expect(seen.attached).toEqual({
      _tag: "job",
      job: { n: 1, text: "counter", tile: "t1", state: { _tag: "running" }, lines: [] },
    });
    expect(seen.next).toMatchObject({ _tag: "job", job: { n: 2, text: "tally &" } });
  });
});
