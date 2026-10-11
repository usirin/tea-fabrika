import { applyCell } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { ShipFacts } from "./facts.ts";
import { enqueue, finish, MAX_MOVES, type QueueSub, queueSub, readShipFacts, type Ship, type ShipCmd, type ShipMsg, ship } from "./machine.ts";
import type { ShipOutcome } from "./outcome.ts";

// The ship machine, driven on the Effect engine against a scripted world:
// every Cmd is answered from a script, and the merge queue's Listen answers
// once with what the script says. No code host, no network, no agent.

const PR = "https://github.com/example/repo/pull/7";

/** A pull request with nothing in its way. */
const clear: ShipFacts = {
  head: "abc1234",
  state: "open",
  ours: true,
  ticket: "closes_it",
  approval: "not_needed",
  reviews: "passed",
  checks: "green",
  mergeable: "clean",
  comments: [],
};
const facts = (patch: Partial<ShipFacts> = {}): ShipFacts => ({ ...clear, ...patch });

type Fails = "fails";
interface Script {
  /** Each read's answer, in order. */
  readonly facts: readonly (ShipFacts | Fails)[];
  /** Each enqueue's answer, in order. */
  readonly enqueue?: readonly ("queued" | "head_moved" | "conflicts" | Fails)[];
  /** How the pull request leaves the queue. Left out: the queue never answers. */
  readonly queue?: "landed" | "ejected";
  readonly finish?: "ok" | Fails;
}

const broke = Effect.fail({ _tag: "unknown" as const });
/** The next answer of a script. A Cmd no script names fails the test. */
function next<A>(answers: A[], what: string): A {
  const answer = answers.shift();
  if (answer === undefined) throw new Error(`${what} was sent, and no script names it`);
  return answer;
}

/** Run the machine on one pull request to its end. `sent`: every Cmd, in order. `listened`: each time the Listen opened. */
async function drive(script: Script) {
  const sent: ShipCmd[] = [];
  const listened: QueueSub["deps"][] = [];
  const reads = [...script.facts];
  const enqueues = [...(script.enqueue ?? [])];
  const program = Effect.gen(function* () {
    const handle = yield* run(ship, {
      ctx: undefined,
      interpret: {
        ship_facts: (cmd: ReturnType<typeof readShipFacts>) =>
          Effect.suspend(() => {
            sent.push(cmd);
            const answer = next(reads, "a read");
            return answer === "fails" ? broke : Effect.succeed(answer);
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
        ship_queue: (sub: QueueSub): Stream.Stream<ShipMsg> => {
          listened.push(sub.deps);
          return script.queue === undefined ? Stream.never : Stream.make({ type: "ship_queue", pr: sub.deps.pr, reading: script.queue });
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
  // Every scripted answer was used: the machine asked for nothing less than the script says.
  expect([reads, enqueues]).toEqual([[], []]);
  return { outcome: end.outcome, sent, types: sent.map((cmd) => cmd.type), listened };
}

const READ = { type: "ship_facts", pr: PR };
const enqueueOf = (head: string) => ({ type: "ship_enqueue", pr: PR, head, intent: `ship/${PR}/enqueue/${head}` });
const finishOf = (head: string) => ({ type: "ship_finish", pr: PR, intent: `ship/${PR}/finish/${head}` });

describe("a pull request with nothing in its way", () => {
  it("is read, queued, landed and tidied up, and the answer is a whole landing", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["queued"], queue: "landed", finish: "ok" });

    expect(outcome).toEqual({ kind: "landed", commit: "abc1234", cleanup: "done" });
    expect(sent).toEqual([READ, enqueueOf("abc1234"), finishOf("abc1234")]);
    expect(listened).toEqual([{ pr: PR, head: "abc1234" }]);
  });

  it("lands as a part when the pull request is only part of its ticket", async () => {
    const { outcome, types } = await drive({ facts: [facts({ ticket: "part_of_it" })], enqueue: ["queued"], queue: "landed", finish: "ok" });

    expect(outcome).toEqual({ kind: "landed_part", commit: "abc1234", cleanup: "done" });
    expect(types).toEqual(["ship_facts", "ship_enqueue", "ship_finish"]);
  });
});

describe("a stop at the gate ends the run at once", () => {
  it.each<[string, Partial<ShipFacts>, ShipOutcome]>([
    ["already merged", { state: "merged" }, { kind: "landed", commit: "abc1234", cleanup: "not_run" }],
    ["already merged, as a part", { state: "merged", ticket: "part_of_it" }, { kind: "landed_part", commit: "abc1234", cleanup: "not_run" }],
    ["a closed pull request", { state: "closed" }, { kind: "nothing_to_ship", why: "closed" }],
    ["a draft", { state: "draft" }, { kind: "nothing_to_ship", why: "draft" }],
    ["not ours", { ours: false }, { kind: "not_ours" }],
    ["conflicts with main", { mergeable: "conflicts" }, { kind: "back_to_builder", why: "conflicts_with_main" }],
    ["a failed review", { reviews: "failed" }, { kind: "back_to_builder", why: "review_failed" }],
    ["a missing review", { reviews: "missing" }, { kind: "back_to_reviewer" }],
    ["red checks", { checks: "red" }, { kind: "back_to_builder", why: "checks_red" }],
    ["a person's open comment", { comments: [{ id: "c1", by: "person" }] }, { kind: "waiting_on_person", forWhat: "resolve_comment" }],
    ["a bot's open comment", { comments: [{ id: "c2", by: "bot" }] }, { kind: "back_to_builder", why: "bot_comment" }],
    ["a missing approval", { approval: "missing" }, { kind: "waiting_on_person", forWhat: "owner_approval" }],
    ["checks still running", { checks: "pending" }, { kind: "cannot_tell", why: "checks_pending" }],
    ["stuck checks", { checks: "stuck" }, { kind: "cannot_tell", why: "checks_stuck" }],
    ["mergeable not known", { mergeable: "unknown" }, { kind: "cannot_tell", why: "mergeable_unknown" }],
  ])("%s: the one read, and no Cmd after it", async (_name, patch, expected) => {
    const { outcome, sent, listened } = await drive({ facts: [facts(patch)] });

    expect(outcome).toEqual(expected);
    expect(sent).toEqual([READ]);
    expect(listened).toEqual([]);
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

    expect(outcome).toEqual({ kind: "landed", commit: "def5678", cleanup: "done" });
    expect(sent).toEqual([READ, enqueueOf("abc1234"), READ, enqueueOf("def5678"), finishOf("def5678")]);
    expect(listened).toEqual([{ pr: PR, head: "def5678" }]);
  });

  it("stops at the gate when the fresh read finds something in the way", async () => {
    const { outcome, types } = await drive({ facts: [clear, facts({ head: "def5678", checks: "red" })], enqueue: ["head_moved"] });

    expect(outcome).toEqual({ kind: "back_to_builder", why: "checks_red" });
    expect(types).toEqual(["ship_facts", "ship_enqueue", "ship_facts"]);
  });

  it("takes the kind of landing from the fresh read, not the first one", async () => {
    const { outcome } = await drive({
      facts: [clear, facts({ head: "def5678", ticket: "part_of_it" })],
      enqueue: ["head_moved", "queued"],
      queue: "landed",
      finish: "ok",
    });

    expect(outcome).toEqual({ kind: "landed_part", commit: "def5678", cleanup: "done" });
  });

  it("gives up when the head has moved more times than the cap, and says so", async () => {
    const heads = Array.from({ length: MAX_MOVES + 1 }, (_, i) => `head-${i}`);
    const { outcome, sent, listened } = await drive({
      facts: heads.map((head) => facts({ head })),
      enqueue: heads.map(() => "head_moved" as const),
    });

    expect(MAX_MOVES).toBe(3);
    expect(outcome).toEqual({ kind: "cannot_tell", why: "head_kept_moving" });
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

    expect(outcome).toEqual({ kind: "landed", commit: `head-${MAX_MOVES}`, cleanup: "done" });
  });
});

describe("what the queue does", () => {
  it("a conflict found at the enqueue goes back to the builder", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["conflicts"] });

    expect(outcome).toEqual({ kind: "back_to_builder", why: "conflicts_with_main" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([]);
  });

  it("a pull request thrown out of the queue goes back to the builder, with no tidy-up", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["queued"], queue: "ejected" });

    expect(outcome).toEqual({ kind: "back_to_builder", why: "thrown_out_of_queue" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([{ pr: PR, head: "abc1234" }]);
  });
});

describe("a Cmd that fails", () => {
  it("a failed read ends as cannot tell, with nothing else sent", async () => {
    const { outcome, sent } = await drive({ facts: ["fails"] });

    expect(outcome).toEqual({ kind: "cannot_tell", why: "read_failed" });
    expect(sent).toEqual([READ]);
  });

  it("a failed enqueue ends as cannot tell: nobody knows whether it is in the queue", async () => {
    const { outcome, sent, listened } = await drive({ facts: [clear], enqueue: ["fails"] });

    expect(outcome).toEqual({ kind: "cannot_tell", why: "enqueue_failed" });
    expect(sent).toEqual([READ, enqueueOf("abc1234")]);
    expect(listened).toEqual([]);
  });

  it("a failed tidy-up is still a landing, and the answer says the tidy-up broke", async () => {
    const whole = await drive({ facts: [clear], enqueue: ["queued"], queue: "landed", finish: "fails" });
    const part = await drive({ facts: [facts({ ticket: "part_of_it" })], enqueue: ["queued"], queue: "landed", finish: "fails" });

    expect(whole.outcome).toEqual({ kind: "landed", commit: "abc1234", cleanup: "failed" });
    expect(part.outcome).toEqual({ kind: "landed_part", commit: "abc1234", cleanup: "failed" });
    expect(whole.types).toEqual(["ship_facts", "ship_enqueue", "ship_finish"]);
  });
});

// ---------------------------------------------------------------- one step at a time

/** A Msg as a parent hands it on: its own, the Listen's, or a Cmd's answer. */
type AnyMsg = { readonly type: string; readonly [field: string]: unknown };
const step = (s: Ship, msg: AnyMsg) => applyCell<Ship, AnyMsg, ShipCmd>(ship, s, msg);

const readCmd = readShipFacts({ pr: PR });
const enqueueCmd = enqueue({ pr: PR, head: "abc1234", intent: `ship/${PR}/enqueue/abc1234` });
const finishCmd = finish({ pr: PR, intent: `ship/${PR}/finish/abc1234` });
const going = { pr: PR, head: "abc1234", landing: "whole" } as const;

/** One state of each phase. */
const STATES = {
  idle: { phase: "idle" },
  reading: { phase: "reading", pr: PR, moves: 0, asked: readCmd },
  enqueueing: { phase: "enqueueing", ...going, moves: 0, asked: enqueueCmd },
  queued: { phase: "queued", ...going },
  finishing: { phase: "finishing", pr: PR, commit: "abc1234", landing: "whole", asked: finishCmd },
  over: { phase: "over", pr: PR, outcome: { kind: "not_ours" } },
} as const satisfies { readonly [P in Ship["phase"]]: Extract<Ship, { phase: P }> };

/** Every Msg the machine has a cell for, and the one phase that listens to it. */
const MSGS: readonly { readonly msg: AnyMsg; readonly heardIn: Ship["phase"] }[] = [
  { msg: { type: "start", pr: PR }, heardIn: "idle" },
  { msg: { type: readShipFacts.okType, cmd: readCmd, value: clear }, heardIn: "reading" },
  { msg: { type: readShipFacts.errType, cmd: readCmd, error: { _tag: "unknown" } }, heardIn: "reading" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "queued" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.okType, cmd: enqueueCmd, value: "conflicts" }, heardIn: "enqueueing" },
  { msg: { type: enqueue.errType, cmd: enqueueCmd, error: { _tag: "unknown" } }, heardIn: "enqueueing" },
  { msg: { type: "ship_queue", pr: PR, reading: "landed" }, heardIn: "queued" },
  { msg: { type: "ship_queue", pr: PR, reading: "ejected" }, heardIn: "queued" },
  { msg: { type: finish.okType, cmd: finishCmd, value: null }, heardIn: "finishing" },
  { msg: { type: finish.errType, cmd: finishCmd, error: { _tag: "unknown" } }, heardIn: "finishing" },
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

    // 11 Msgs, each ignored in the 5 phases that are not its own.
    expect(checked).toBe(55);
  });

  it("sends nothing once it is over, whatever arrives", () => {
    for (const { msg } of [...MSGS, { msg: { type: "resume" } }]) {
      expect(step(STATES.over, msg)).toEqual([STATES.over, []]);
    }
  });

  it("ignores the queue's word about another pull request", () => {
    expect(step(STATES.queued, { type: "ship_queue", pr: "https://github.com/example/repo/pull/8", reading: "landed" })).toEqual([STATES.queued, []]);
  });

  it("ignores a late answer to an enqueue of an older head", () => {
    const now: Ship = { ...STATES.enqueueing, head: "def5678", moves: 1, asked: enqueue({ pr: PR, head: "def5678", intent: `ship/${PR}/enqueue/def5678` }) };

    expect(step(now, { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" })).toEqual([now, []]);
    expect(step(now, { type: enqueue.errType, cmd: enqueueCmd, error: { _tag: "unknown" } })).toEqual([now, []]);
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
    expect(after).toEqual({ phase: "enqueueing", pr: PR, head: "def5678", landing: "part", moves: 0, asked: enqueueOf("def5678") });
  });

  it("queued sends nothing: the machine waits on its Listen", () => {
    expect(step(STATES.enqueueing, { type: enqueue.okType, cmd: enqueueCmd, value: "queued" })).toEqual([STATES.queued, []]);
  });

  it("a moved head sends a fresh read and counts the move", () => {
    const [after, cmds] = step(STATES.enqueueing, { type: enqueue.okType, cmd: enqueueCmd, value: "head_moved" });

    expect(cmds).toEqual([READ]);
    expect(after).toEqual({ phase: "reading", pr: PR, moves: 1, asked: READ });
  });

  it("landed sends the tidy-up, once", () => {
    expect(step(STATES.queued, { type: "ship_queue", pr: PR, reading: "landed" })).toEqual([STATES.finishing, [finishOf("abc1234")]]);
  });
});

describe("after a restart", () => {
  it("resume sends the Cmd that was in flight again, with the same intent", () => {
    expect(step(STATES.reading, { type: "resume" })).toEqual([STATES.reading, [readCmd]]);
    expect(step(STATES.enqueueing, { type: "resume" })).toEqual([STATES.enqueueing, [enqueueCmd]]);
    expect(step(STATES.finishing, { type: "resume" })).toEqual([STATES.finishing, [finishCmd]]);
  });

  it("resume sends nothing where no Cmd is in flight", () => {
    expect(step(STATES.idle, { type: "resume" })).toEqual([STATES.idle, []]);
    expect(step(STATES.queued, { type: "resume" })).toEqual([STATES.queued, []]);
  });
});

describe("the queue's Listen", () => {
  it("is open only while the pull request is in the queue", () => {
    const open = Object.values(STATES).filter((state) => queueSub.deps(state) !== null);

    expect(open).toEqual([STATES.queued]);
    expect(queueSub.deps(STATES.queued)).toEqual({ pr: PR, head: "abc1234" });
    expect(ship.subs).toEqual([queueSub]);
  });
});
