import { applyCell } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { ShipFacts } from "./facts.ts";
import {
  type ChecksSub,
  checksClock,
  checksSub,
  createShip,
  DEFAULT_WAITS,
  enqueue,
  finish,
  MAX_MOVES,
  type QueueSub,
  queueClock,
  queueSub,
  readShipFacts,
  rerunChecks,
  type Ship,
  type ShipCmd,
  type ShipMsg,
  ship,
  type Waits,
} from "./machine.ts";
import type { ShipOutcome } from "./outcome.ts";

// The ship machine, driven on the Effect engine against a scripted world:
// every Cmd is answered from a script, and each Listen answers once with what
// the script says. The clocks are the engine's own, set to a few milliseconds
// where a test is about a limit. No code host, no network, no agent.

const PR = "https://github.com/example/repo/pull/7";
/** Limits no test reaches unless it means to. */
const WAITS: Waits = { checksMs: 5_000, queueMs: 5_000 };
const patient = createShip({ waits: WAITS });

/** A pull request with nothing in its way. */
const clear: ShipFacts = {
  head: "abc1234",
  state: "open",
  ours: true,
  ticket: "closes_it",
  approval: "not_needed",
  reviews: "passed",
  reviewKinds: [],
  checks: "green",
  mergeable: "clean",
  comments: [],
};
const facts = (patch: Partial<ShipFacts> = {}): ShipFacts => ({ ...clear, ...patch });
const pending = (head = "abc1234") => facts({ head, checks: "pending" });
const red = (head = "abc1234") => facts({ head, checks: "red" });

type Fails = "fails";
interface Script {
  /** Each read's answer, in order. */
  readonly facts: readonly (ShipFacts | Fails)[];
  /** Each re-run's answer, in order. */
  readonly rerun?: readonly ("ok" | Fails)[];
  /** Each wait on the checks, in order: after how many ms the Listen says they settled. `never`: it stays silent. */
  readonly checks?: readonly (number | "never")[];
  /** Each enqueue's answer, in order. */
  readonly enqueue?: readonly ("queued" | "head_moved" | "conflicts" | Fails)[];
  /** How the pull request leaves the queue. Left out: the queue never answers. */
  readonly queue?: "landed" | "ejected";
  readonly finish?: "ok" | Fails;
}

const broke = Effect.fail({ _tag: "unknown" as const });
/** The next answer of a script. A Cmd or a wait no script names fails the test. */
function next<A>(answers: A[], what: string): A {
  const answer = answers.shift();
  if (answer === undefined) throw new Error(`${what} came, and no script names it`);
  return answer;
}

/**
 * Run a machine on one pull request to its end. `sent`: every Cmd, in order.
 * `waitedOn` and `listened`: each time the checks' and the queue's Listen
 * opened. `left`: the scripted answers nobody asked for.
 */
async function drive(script: Script, machine = patient) {
  const sent: ShipCmd[] = [];
  const waitedOn: ChecksSub["deps"][] = [];
  const listened: QueueSub["deps"][] = [];
  const reads = [...script.facts];
  const reruns = [...(script.rerun ?? [])];
  const settles = [...(script.checks ?? [])];
  const enqueues = [...(script.enqueue ?? [])];
  const program = Effect.gen(function* () {
    const handle = yield* run(machine, {
      ctx: undefined,
      interpret: {
        ship_facts: (cmd: ReturnType<typeof readShipFacts>) =>
          Effect.suspend(() => {
            sent.push(cmd);
            const answer = next(reads, "a read");
            return answer === "fails" ? broke : Effect.succeed(answer);
          }),
        ship_rerun_checks: (cmd: ReturnType<typeof rerunChecks>) =>
          Effect.suspend(() => {
            sent.push(cmd);
            return next(reruns, "a re-run") === "fails" ? broke : Effect.succeed(RERAN);
          }),
        ship_enqueue: (cmd: ReturnType<typeof enqueue>) =>
          Effect.suspend(() => {
            sent.push(cmd);
            const answer = next(enqueues, "an enqueue");
            return answer === "fails" ? broke : Effect.succeed(answer);
          }),
        ship_finish: (cmd: ReturnType<typeof finish>) =>
          Effect.suspend(() => {
            sent.push(cmd);
            if (script.finish === undefined) throw new Error("a finish was sent, and no script names it");
            return script.finish === "fails" ? broke : Effect.succeed(null);
          }),
      },
      subscribe: {
        ship_checks: (sub: ChecksSub): Stream.Stream<ShipMsg> => {
          waitedOn.push(sub.deps);
          const after = next(settles, "a wait on the checks");
          const settled: ShipMsg = { type: "ship_checks", pr: sub.deps.pr, head: sub.deps.head };
          return after === "never" ? Stream.never : Stream.fromEffect(Effect.sleep(`${after} millis`).pipe(Effect.as(settled)));
        },
        ship_queue: (sub: QueueSub): Stream.Stream<ShipMsg> => {
          listened.push(sub.deps);
          if (script.queue === undefined) return Stream.never;
          // Landed: the queue names the commit it made on the base branch, which is not the head.
          const left: ShipMsg = script.queue === "landed" ? { type: "ship_queue", ...sub.deps, reading: "landed", commit: MERGE } : { type: "ship_queue", ...sub.deps, reading: "ejected" };
          return Stream.make(left);
        },
      },
      terminal: (s) => s.phase === "over",
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch({ type: "start", pr: PR });
    // A run that never gets there fails the test instead of hanging the suite.
    return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
  });
  const end = await Effect.runPromise(program.pipe(Effect.scoped));
  if (end.phase !== "over") throw new Error(`the run did not end: ${end.phase}`);
  const left = { reads, reruns, settles, enqueues };
  return { outcome: end.outcome, sent, types: sent.map((cmd) => cmd.type), waitedOn, listened, left };
}
/** Every scripted answer was used: the machine asked for nothing less than the script says. */
const NOTHING_LEFT = { reads: [], reruns: [], settles: [], enqueues: [] };

const READ = { type: "ship_facts", pr: PR };
const rerunOf = (head: string) => ({ type: "ship_rerun_checks", pr: PR, head, intent: `ship/${PR}/rerun/${head}` });
const enqueueOf = (head: string) => ({ type: "ship_enqueue", pr: PR, head, intent: `ship/${PR}/enqueue/${head}` });
const finishOf = (head: string) => ({ type: "ship_finish", pr: PR, intent: `ship/${PR}/finish/${head}` });
const AT = { pr: PR, head: "abc1234" };
/** A wait on checks that were not run again. */
const WAIT = { ...AT, after: [] };
/** The commit the queue makes on the base branch. Never the head. */
const MERGE = "m3rg3c0";
/** The one run a scripted re-run starts again, and the try it was on. */
const RERAN = [{ run: 501, attempt: 1 }];
const LANDED: ShipOutcome = { kind: "done", part: false, commit: MERGE, cleanup: "done" };

describe("a pull request with nothing in its way", () => {
  it("is read, queued, landed and tidied up, and the answer is a whole landing", async () => {
    const { outcome, sent, waitedOn, listened, left } = await drive({ facts: [clear], enqueue: ["queued"], queue: "landed", finish: "ok" });

    expect(outcome).toEqual(LANDED);
    expect(sent).toEqual([READ, enqueueOf("abc1234"), finishOf("abc1234")]);
    expect(waitedOn).toEqual([]);
    expect(listened).toEqual([AT]);
    expect(left).toEqual(NOTHING_LEFT);
  });

  it("lands as a part when the pull request is only part of its ticket", async () => {
    const { outcome, types } = await drive({ facts: [facts({ ticket: "part_of_it" })], enqueue: ["queued"], queue: "landed", finish: "ok" });

    expect(outcome).toEqual({ kind: "done", part: true, commit: MERGE, cleanup: "done" });
    expect(types).toEqual(["ship_facts", "ship_enqueue", "ship_finish"]);
  });
});

describe("a stop at the gate ends the run at once", () => {
  it.each<[string, Partial<ShipFacts>, ShipOutcome]>([
    ["already merged", { state: "merged" }, { kind: "done", part: false, commit: "abc1234", cleanup: "not_run" }],
    ["already merged, as a part", { state: "merged", ticket: "part_of_it" }, { kind: "done", part: true, commit: "abc1234", cleanup: "not_run" }],
    ["a closed pull request", { state: "closed" }, { kind: "skip", why: "closed" }],
    ["a draft", { state: "draft" }, { kind: "skip", why: "draft" }],
    ["not ours", { ours: false }, { kind: "skip", why: "not_ours" }],
    ["conflicts with main", { mergeable: "conflicts" }, { kind: "send", to: "builder", why: "conflicts" }],
    ["a failed review", { reviews: "failed" }, { kind: "send", to: "builder", why: "review_failed" }],
    ["a missing review", { reviews: "missing" }, { kind: "send", to: "reviewer", why: "no_review" }],
    ["reviews nobody could read", { reviews: "unknown" }, { kind: "stuck", why: "reviews_unknown" }],
    ["a person's open comment", { comments: [{ id: "c1", by: "person" }] }, { kind: "ask", who: "commenter", for: "comment" }],
    ["a bot's open comment", { comments: [{ id: "c2", by: "bot" }] }, { kind: "send", to: "builder", why: "bot_comment" }],
    ["a missing approval", { approval: "missing" }, { kind: "ask", who: "owner", for: "approval" }],
    ["an approval nobody could read", { approval: "unknown" }, { kind: "stuck", why: "approval_unknown" }],
    ["stuck checks", { checks: "stuck" }, { kind: "stuck", why: "checks_stuck" }],
    ["mergeable not known", { mergeable: "unknown" }, { kind: "stuck", why: "merge_unknown" }],
  ])("%s: the one read, and no Cmd after it", async (_name, patch, expected) => {
    const { outcome, sent, waitedOn, listened } = await drive({ facts: [facts(patch)] });

    expect(outcome).toEqual(expected);
    expect(sent).toEqual([READ]);
    expect([waitedOn, listened]).toEqual([[], []]);
  });

  it("a stop that comes before the checks' line ends the run though the checks still run, or are red", async () => {
    const still = await drive({ facts: [facts({ checks: "pending", approval: "missing" })] });
    const failed = await drive({ facts: [facts({ checks: "red", reviews: "failed" })] });

    expect(still.outcome).toEqual({ kind: "ask", who: "owner", for: "approval" });
    expect(failed.outcome).toEqual({ kind: "send", to: "builder", why: "review_failed" });
    expect([still.sent, failed.sent]).toEqual([[READ], [READ]]);
  });
});

describe("checks that are still running are waited for", () => {
  it("pending, then green: it waits on the checks, reads fresh, and lands", async () => {
    const { outcome, sent, waitedOn, left } = await drive({ facts: [pending(), clear], checks: [0], enqueue: ["queued"], queue: "landed", finish: "ok" });

    expect(outcome).toEqual(LANDED);
    // Nothing is sent to wait. The second read is the fresh one.
    expect(sent).toEqual([READ, READ, enqueueOf("abc1234"), finishOf("abc1234")]);
    expect(waitedOn).toEqual([WAIT]);
    expect(left).toEqual(NOTHING_LEFT);
  });

  it("takes the facts from the fresh read, never from the Listen: a stop found after the wait ends the run", async () => {
    const { outcome, types } = await drive({ facts: [pending(), facts({ comments: [{ id: "c1", by: "person" }] })], checks: [0] });

    expect(outcome).toEqual({ kind: "ask", who: "commenter", for: "comment" });
    expect(types).toEqual(["ship_facts", "ship_facts"]);
  });

  it("waits again, on the new head, when the fresh read finds the checks running on another commit", async () => {
    const { outcome, waitedOn } = await drive({
      facts: [pending(), pending("def5678"), facts({ head: "def5678" })],
      checks: [0, 0],
      enqueue: ["queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual(LANDED);
    expect(waitedOn).toEqual([WAIT, { pr: PR, head: "def5678", after: [] }]);
  });

  it("at the limit, with the checks still running, it cannot tell: they are stuck", async () => {
    const { outcome, sent, waitedOn, listened } = await drive({ facts: [pending()], checks: ["never"] }, createShip({ waits: { checksMs: 10 } }));

    expect(outcome).toEqual({ kind: "stuck", why: "checks_stuck" });
    expect(sent).toEqual([READ]);
    expect(waitedOn).toEqual([WAIT]);
    expect(listened).toEqual([]);
  });
});

describe("red checks are run again once, then the builder", () => {
  it("pending, then red, a re-run, then green: it lands with no builder", async () => {
    const { outcome, sent, waitedOn, left } = await drive({
      facts: [pending(), red(), clear],
      checks: [0, 0],
      rerun: ["ok"],
      enqueue: ["queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual(LANDED);
    expect(sent).toEqual([READ, READ, rerunOf("abc1234"), READ, enqueueOf("abc1234"), finishOf("abc1234")]);
    // The same Listen for the first run of the checks and for the re-run. The second is told which run was started again.
    expect(waitedOn).toEqual([WAIT, { ...AT, after: RERAN }]);
    expect(left).toEqual(NOTHING_LEFT);
  });

  it("red, a re-run, red again at the same head: back to the builder, and no second re-run", async () => {
    const { outcome, sent, waitedOn, left } = await drive({ facts: [red(), red()], rerun: ["ok"], checks: [0] });

    expect(outcome).toEqual({ kind: "send", to: "builder", why: "checks_red" });
    expect(sent).toEqual([READ, rerunOf("abc1234"), READ]);
    expect(waitedOn).toEqual([{ ...AT, after: RERAN }]);
    expect(left).toEqual(NOTHING_LEFT);
  });

  it("red, the head moves, red again: the new head gets a re-run of its own", async () => {
    const { outcome, sent, waitedOn } = await drive({
      facts: [red(), red("def5678"), facts({ head: "def5678" })],
      rerun: ["ok", "ok"],
      checks: [0, 0],
      enqueue: ["queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual(LANDED);
    expect(sent).toEqual([READ, rerunOf("abc1234"), READ, rerunOf("def5678"), READ, enqueueOf("def5678"), finishOf("def5678")]);
    expect(waitedOn).toEqual([
      { ...AT, after: RERAN },
      { pr: PR, head: "def5678", after: RERAN },
    ]);
  });

  it("a re-run that cannot be asked for ends as red checks: it was only a courtesy", async () => {
    const { outcome, sent, waitedOn } = await drive({ facts: [red()], rerun: ["fails"] });

    expect(outcome).toEqual({ kind: "send", to: "builder", why: "checks_red" });
    expect(sent).toEqual([READ, rerunOf("abc1234")]);
    expect(waitedOn).toEqual([]);
  });

  it("a re-run whose checks never settle reaches the checks' limit", async () => {
    const { outcome, types } = await drive({ facts: [red()], rerun: ["ok"], checks: ["never"] }, createShip({ waits: { checksMs: 10 } }));

    expect(outcome).toEqual({ kind: "stuck", why: "checks_stuck" });
    expect(types).toEqual(["ship_facts", "ship_rerun_checks"]);
  });
});

describe("a branch that moves under the enqueue", () => {
  it("is read fresh again, and the new head is the one that lands", async () => {
    const { outcome, sent, listened } = await drive({
      facts: [clear, facts({ head: "def5678" })],
      enqueue: ["head_moved", "queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual(LANDED);
    expect(sent).toEqual([READ, enqueueOf("abc1234"), READ, enqueueOf("def5678"), finishOf("def5678")]);
    expect(listened).toEqual([{ pr: PR, head: "def5678" }]);
  });

  it("stops at the gate when the fresh read finds something in the way", async () => {
    const { outcome, types } = await drive({ facts: [clear, facts({ head: "def5678", reviews: "failed" })], enqueue: ["head_moved"] });

    expect(outcome).toEqual({ kind: "send", to: "builder", why: "review_failed" });
    expect(types).toEqual(["ship_facts", "ship_enqueue", "ship_facts"]);
  });

  it("takes the kind of landing from the fresh read, not the first one", async () => {
    const { outcome } = await drive({
      facts: [clear, facts({ head: "def5678", ticket: "part_of_it" })],
      enqueue: ["head_moved", "queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual({ kind: "done", part: true, commit: MERGE, cleanup: "done" });
  });

  it("gives up when the head has moved more times than the cap, and says so", async () => {
    const heads = Array.from({ length: MAX_MOVES + 1 }, (_, i) => `head-${i}`);
    const { outcome, sent, listened } = await drive({
      facts: heads.map((head) => facts({ head })),
      enqueue: heads.map(() => "head_moved" as const),
    });

    expect(MAX_MOVES).toBe(3);
    expect(outcome).toEqual({ kind: "stuck", why: "head_moving" });
    // Four reads and four tries, and no fifth read.
    expect(sent).toEqual(heads.flatMap((head) => [READ, enqueueOf(head)]));
    expect(listened).toEqual([]);
  });

  it("still lands when the head stops moving on the last try the cap allows", async () => {
    const heads = Array.from({ length: MAX_MOVES + 1 }, (_, i) => `head-${i}`);
    const { outcome } = await drive({
      facts: heads.map((head) => facts({ head })),
      enqueue: [...heads.slice(1).map(() => "head_moved" as const), "queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual(LANDED);
  });
});

describe("what the queue does", () => {
  it("a conflict found at the enqueue goes back to the builder", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["conflicts"] });

    expect(outcome).toEqual({ kind: "send", to: "builder", why: "conflicts" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([]);
  });

  it("a pull request thrown out of the queue goes back to the builder, with no tidy-up", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["queued"], queue: "ejected" });

    expect(outcome).toEqual({ kind: "send", to: "builder", why: "ejected" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([AT]);
  });

  it("a queue that says nothing by its limit: it cannot tell, and leaves the pull request where it is", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["queued"] }, createShip({ waits: { queueMs: 10 } }));

    expect(outcome).toEqual({ kind: "stuck", why: "queue_silent" });
    // No Cmd after the enqueue: nothing takes it out of the queue, and nothing tidies up.
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([AT]);
  });
});

describe("a Cmd that fails", () => {
  it("a failed read ends as cannot tell, with nothing else sent", async () => {
    const { outcome, sent } = await drive({ facts: ["fails"] });

    expect(outcome).toEqual({ kind: "stuck", why: "read_failed" });
    expect(sent).toEqual([READ]);
  });

  it("a failed read after a wait ends the same way", async () => {
    const { outcome, types } = await drive({ facts: [pending(), "fails"], checks: [0] });

    expect(outcome).toEqual({ kind: "stuck", why: "read_failed" });
    expect(types).toEqual(["ship_facts", "ship_facts"]);
  });

  it("a failed enqueue ends as cannot tell: nobody knows whether it is in the queue", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["fails"] });

    expect(outcome).toEqual({ kind: "stuck", why: "enqueue_failed" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([]);
  });

  it("a failed tidy-up is still a landing, and the answer says the tidy-up broke", async () => {
    const whole = await drive({ facts: [clear], enqueue: ["queued"], queue: "landed", finish: "fails" });
    const part = await drive({ facts: [facts({ ticket: "part_of_it" })], enqueue: ["queued"], queue: "landed", finish: "fails" });

    expect(whole.outcome).toEqual({ kind: "done", part: false, commit: MERGE, cleanup: "failed" });
    expect(part.outcome).toEqual({ kind: "done", part: true, commit: MERGE, cleanup: "failed" });
    expect(whole.types).toEqual(["ship_facts", "ship_enqueue", "ship_finish"]);
  });
});

describe("a machine is made with its own settings", () => {
  it("two machines with different limits end the same script differently", async () => {
    // The checks settle after 40 ms.
    const script: Script = { facts: [pending(), clear], checks: [40], enqueue: ["queued"], queue: "landed", finish: "ok" };
    const hasty = await drive(script, createShip({ waits: { checksMs: 5 } }));
    const calm = await drive(script, createShip({ waits: { checksMs: 2_000 } }));

    expect(hasty.outcome).toEqual({ kind: "stuck", why: "checks_stuck" });
    expect(hasty.sent).toEqual([READ]);
    expect(calm.outcome).toEqual(LANDED);
    expect(calm.sent).toEqual([READ, READ, enqueueOf("abc1234"), finishOf("abc1234")]);
  });

  it("a setting left out takes the machine's own default, one by one", () => {
    const started = (machine: typeof ship) => applyCell<Ship, AnyMsg, ShipCmd>(machine, { phase: "idle" }, { type: "start", pr: PR })[0];

    expect(DEFAULT_WAITS).toEqual({ checksMs: 15 * 60_000, queueMs: 60 * 60_000 });
    expect(started(ship)).toMatchObject({ waits: DEFAULT_WAITS });
    expect(started(createShip({}))).toMatchObject({ waits: DEFAULT_WAITS });
    expect(started(createShip({ waits: { checksMs: 7 } }))).toMatchObject({ waits: { checksMs: 7, queueMs: 60 * 60_000 } });
    expect(started(createShip({ waits: { queueMs: 9 } }))).toMatchObject({ waits: { checksMs: 15 * 60_000, queueMs: 9 } });
  });

  it("a run keeps the limits it started with, whatever machine steps it later", () => {
    const hasty = createShip({ waits: { checksMs: 5, queueMs: 6 } });
    const [reading] = applyCell<Ship, AnyMsg, ShipCmd>(hasty, { phase: "idle" }, { type: "start", pr: PR });
    // Saved, and picked up by a machine made with other numbers.
    const [waiting] = applyCell<Ship, AnyMsg, ShipCmd>(patient, reading, { type: readShipFacts.okType, cmd: readCmd, value: pending() });

    expect(checksClock.deps(waiting)).toMatchObject({ ms: 5 });
  });
});

// ---------------------------------------------------------------- one step at a time

/** A Msg as a parent hands it on: its own, a Listen's, a clock's, or a Cmd's answer. */
type AnyMsg = { readonly type: string; readonly [field: string]: unknown };
const step = (s: Ship, msg: AnyMsg) => applyCell<Ship, AnyMsg, ShipCmd>(patient, s, msg);

const readCmd = readShipFacts({ pr: PR });
const rerunCmd = rerunChecks({ ...AT, intent: `ship/${PR}/rerun/abc1234` });
const enqueueCmd = enqueue({ ...AT, intent: `ship/${PR}/enqueue/abc1234` });
const finishCmd = finish({ pr: PR, intent: `ship/${PR}/finish/abc1234` });
const held = { pr: PR, waits: WAITS } as const;
const sofar = { ...held, moves: 0, rerunFor: null, waited: 0 } as const;
const going = { head: "abc1234", landing: "whole" } as const;

/** One state of each phase. */
const STATES = {
  idle: { phase: "idle" },
  reading: { phase: "reading", ...sofar, asked: readCmd },
  rerunning: { phase: "rerunning", ...sofar, head: "abc1234", rerunFor: "abc1234", asked: rerunCmd },
  waiting: { phase: "waiting", ...sofar, head: "abc1234", after: [], waited: 1 },
  enqueueing: { phase: "enqueueing", ...sofar, ...going, asked: enqueueCmd },
  queued: { phase: "queued", ...held, ...going },
  finishing: { phase: "finishing", ...held, commit: MERGE, landing: "whole", asked: finishCmd },
  over: { phase: "over", ...held, outcome: { kind: "skip", why: "not_ours" } },
} as const satisfies { readonly [P in Ship["phase"]]: Extract<Ship, { phase: P }> };

const failure = { _tag: "unknown" };
/** Every Msg the machine has a cell for, and the one phase that listens to it. */
const MSGS: readonly { readonly msg: AnyMsg; readonly heardIn: Ship["phase"] }[] = [
  { msg: { type: "start", pr: PR }, heardIn: "idle" },
  { msg: { type: readShipFacts.okType, cmd: readCmd, value: clear }, heardIn: "reading" },
  { msg: { type: readShipFacts.okType, cmd: readCmd, value: pending() }, heardIn: "reading" },
  { msg: { type: readShipFacts.okType, cmd: readCmd, value: red() }, heardIn: "reading" },
  { msg: { type: readShipFacts.errType, cmd: readCmd, error: failure }, heardIn: "reading" },
  { msg: { type: rerunChecks.okType, cmd: rerunCmd, value: RERAN }, heardIn: "rerunning" },
  { msg: { type: rerunChecks.errType, cmd: rerunCmd, error: failure }, heardIn: "rerunning" },
  { msg: { type: "ship_checks", ...AT }, heardIn: "waiting" },
  { msg: { type: "ship_checks_overdue", ...AT, wait: 1 }, heardIn: "waiting" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "queued" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "conflicts" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.errType, cmd: enqueueCmd, error: failure }, heardIn: "enqueueing" },
  { msg: { type: "ship_queue", ...AT, reading: "landed", commit: MERGE }, heardIn: "queued" },
  { msg: { type: "ship_queue", ...AT, reading: "ejected" }, heardIn: "queued" },
  { msg: { type: "ship_queue_overdue", ...AT }, heardIn: "queued" },
  { msg: { type: finish.okType, cmd: finishCmd, value: null }, heardIn: "finishing" },
  { msg: { type: finish.errType, cmd: finishCmd, error: failure }, heardIn: "finishing" },
];

describe("a Msg that arrives in the wrong phase", () => {
  it("changes nothing and sends nothing, in every phase but its own", () => {
    let checked = 0;
    for (const { msg, heardIn } of MSGS) {
      for (const state of Object.values(STATES)) {
        const [after, cmds] = step(state, msg);
        if (state.phase === heardIn) {
          expect(after, `${msg.type} in ${state.phase}`).not.toBe(state);
          continue;
        }
        expect(after, `${msg.type} in ${state.phase}`).toBe(state);
        expect(cmds).toEqual([]);
        checked += 1;
      }
    }

    // 18 Msgs, each ignored in the 7 phases that are not its own.
    expect(checked).toBe(126);
  });

  it("sends nothing once it is over, whatever arrives", () => {
    for (const { msg } of [...MSGS, { msg: { type: "resume" } }]) {
      expect(step(STATES.over, msg)).toEqual([STATES.over, []]);
    }
  });

  it("ignores a Listen's or a clock's word about another pull request", () => {
    const other = { pr: "https://github.com/example/repo/pull/8", head: "abc1234" };

    expect(step(STATES.waiting, { type: "ship_checks", ...other })).toEqual([STATES.waiting, []]);
    expect(step(STATES.waiting, { type: "ship_checks_overdue", ...other, wait: 1 })).toEqual([STATES.waiting, []]);
    expect(step(STATES.queued, { type: "ship_queue", ...other, reading: "landed", commit: MERGE })).toEqual([STATES.queued, []]);
    expect(step(STATES.queued, { type: "ship_queue_overdue", ...other })).toEqual([STATES.queued, []]);
  });

  it("ignores a Listen's or a clock's word about an older head", () => {
    const older = { pr: PR, head: "0ld0ld0" };

    expect(step(STATES.waiting, { type: "ship_checks", ...older })).toEqual([STATES.waiting, []]);
    expect(step(STATES.waiting, { type: "ship_checks_overdue", ...older, wait: 1 })).toEqual([STATES.waiting, []]);
    expect(step(STATES.queued, { type: "ship_queue", ...older, reading: "landed", commit: MERGE })).toEqual([STATES.queued, []]);
    expect(step(STATES.queued, { type: "ship_queue_overdue", ...older })).toEqual([STATES.queued, []]);
  });

  it("ignores the clock of an earlier wait on the same head", () => {
    const second: Ship = { ...STATES.waiting, waited: 2 };

    expect(step(second, { type: "ship_checks_overdue", ...AT, wait: 1 })).toEqual([second, []]);
    expect(step(second, { type: "ship_checks_overdue", ...AT, wait: 2 })[0]).toMatchObject({ phase: "over", outcome: { kind: "stuck", why: "checks_stuck" } });
  });

  it("ignores a late answer to an enqueue or a re-run of an older head", () => {
    const enqueueing: Ship = { ...STATES.enqueueing, head: "def5678", moves: 1, asked: enqueue({ pr: PR, head: "def5678", intent: `ship/${PR}/enqueue/def5678` }) };
    const rerunning: Ship = { ...STATES.rerunning, head: "def5678", rerunFor: "def5678", asked: rerunChecks({ pr: PR, head: "def5678", intent: `ship/${PR}/rerun/def5678` }) };

    expect(step(enqueueing, { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" })).toEqual([enqueueing, []]);
    expect(step(enqueueing, { type: enqueue.errType, cmd: enqueueCmd, error: failure })).toEqual([enqueueing, []]);
    expect(step(rerunning, { type: rerunChecks.okType, cmd: rerunCmd, value: RERAN })).toEqual([rerunning, []]);
    expect(step(rerunning, { type: rerunChecks.errType, cmd: rerunCmd, error: failure })).toEqual([rerunning, []]);
  });
});

describe("the exact Cmd each step sends", () => {
  it("start sends the read, and only the read", () => {
    expect(step(STATES.idle, { type: "start", pr: PR })).toEqual([STATES.reading, [READ]]);
  });

  it("a go from the gate sends the enqueue of the head the gate named, and keeps the gate's landing", () => {
    const part = facts({ head: "def5678", ticket: "part_of_it" });
    const [after, cmds] = step(STATES.reading, { type: readShipFacts.okType, cmd: readCmd, value: part });

    expect(cmds).toEqual([enqueueOf("def5678")]);
    expect(after).toEqual({ phase: "enqueueing", ...sofar, head: "def5678", landing: "part", asked: enqueueOf("def5678") });
  });

  it("checks still running send nothing: the machine waits, and numbers the wait", () => {
    expect(step(STATES.reading, { type: readShipFacts.okType, cmd: readCmd, value: pending() })).toEqual([STATES.waiting, []]);
  });

  it("red checks send the re-run of that head, once, and remember the head", () => {
    const [after, cmds] = step(STATES.reading, { type: readShipFacts.okType, cmd: readCmd, value: red() });

    expect(cmds).toEqual([rerunOf("abc1234")]);
    expect(after).toEqual(STATES.rerunning);
    // Red again at the head already run again: the builder, and nothing sent.
    const again: Ship = { ...STATES.reading, rerunFor: "abc1234" };
    expect(step(again, { type: readShipFacts.okType, cmd: readCmd, value: red() })).toEqual([{ phase: "over", ...held, outcome: { kind: "send", to: "builder", why: "checks_red" } }, []]);
    // Red at a new head: a re-run of its own.
    expect(step(again, { type: readShipFacts.okType, cmd: readCmd, value: red("def5678") })[1]).toEqual([rerunOf("def5678")]);
  });

  it("a re-run that was taken sends nothing more: the machine waits on the same checks", () => {
    expect(step(STATES.rerunning, { type: rerunChecks.okType, cmd: rerunCmd, value: RERAN })).toEqual([{ ...STATES.waiting, rerunFor: "abc1234", after: RERAN }, []]);
  });

  it("checks that settled send a fresh read, and keep what the run remembers", () => {
    const waiting: Ship = { ...STATES.waiting, rerunFor: "abc1234", moves: 2 };

    expect(step(waiting, { type: "ship_checks", ...AT })).toEqual([{ phase: "reading", ...sofar, rerunFor: "abc1234", moves: 2, waited: 1, asked: READ }, [READ]]);
  });

  it("queued sends nothing: the machine waits on its Listen", () => {
    expect(step(STATES.enqueueing, { type: enqueue.okType, cmd: enqueueCmd, value: "queued" })).toEqual([STATES.queued, []]);
  });

  it("a moved head sends a fresh read and counts the move", () => {
    const [after, cmds] = step(STATES.enqueueing, { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" });

    expect(cmds).toEqual([READ]);
    expect(after).toEqual({ phase: "reading", ...sofar, moves: 1, asked: READ });
  });

  it("landed sends the tidy-up, once", () => {
    expect(step(STATES.queued, { type: "ship_queue", ...AT, reading: "landed", commit: MERGE })).toEqual([STATES.finishing, [finishOf("abc1234")]]);
  });

  it("a limit reached sends nothing", () => {
    expect(step(STATES.waiting, { type: "ship_checks_overdue", ...AT, wait: 1 })).toEqual([{ phase: "over", ...held, outcome: { kind: "stuck", why: "checks_stuck" } }, []]);
    expect(step(STATES.queued, { type: "ship_queue_overdue", ...AT })).toEqual([{ phase: "over", ...held, outcome: { kind: "stuck", why: "queue_silent" } }, []]);
  });
});

describe("after a restart", () => {
  it("resume sends the Cmd that was in flight again, with the same intent", () => {
    expect(step(STATES.reading, { type: "resume" })).toEqual([STATES.reading, [readCmd]]);
    expect(step(STATES.rerunning, { type: "resume" })).toEqual([STATES.rerunning, [rerunCmd]]);
    expect(step(STATES.enqueueing, { type: "resume" })).toEqual([STATES.enqueueing, [enqueueCmd]]);
    expect(step(STATES.finishing, { type: "resume" })).toEqual([STATES.finishing, [finishCmd]]);
  });

  it("resume sends nothing where the machine only waits: its Listens open again by themselves", () => {
    expect(step(STATES.idle, { type: "resume" })).toEqual([STATES.idle, []]);
    expect(step(STATES.waiting, { type: "resume" })).toEqual([STATES.waiting, []]);
    expect(step(STATES.queued, { type: "resume" })).toEqual([STATES.queued, []]);
    expect(checksSub.deps(STATES.waiting)).toEqual(WAIT);
    expect(queueSub.deps(STATES.queued)).toEqual(AT);
  });
});

describe("the Listens and their clocks", () => {
  const openIn = (sub: { readonly deps: (s: Ship) => unknown }) => Object.values(STATES).filter((state) => sub.deps(state) !== null);

  it("the checks' Listen and its clock are open only while the machine waits on the checks", () => {
    expect(openIn(checksSub)).toEqual([STATES.waiting]);
    expect(openIn(checksClock)).toEqual([STATES.waiting]);
    expect(checksSub.deps(STATES.waiting)).toEqual(WAIT);
    expect(checksClock.deps(STATES.waiting)).toEqual({ ms: 5_000, msg: { type: "ship_checks_overdue", ...AT, wait: 1 } });
  });

  it("the queue's Listen and its clock are open only while the pull request is in the queue", () => {
    expect(openIn(queueSub)).toEqual([STATES.queued]);
    expect(openIn(queueClock)).toEqual([STATES.queued]);
    expect(queueSub.deps(STATES.queued)).toEqual(AT);
    expect(queueClock.deps(STATES.queued)).toEqual({ ms: 5_000, msg: { type: "ship_queue_overdue", ...AT } });
  });

  it("each wait on the checks sets a clock of its own", () => {
    const second: Ship = { ...STATES.waiting, waited: 2 };

    expect(checksClock.deps(second)).not.toEqual(checksClock.deps(STATES.waiting));
    expect(patient.subs).toEqual([checksSub, queueSub, checksClock, queueClock]);
  });
});
