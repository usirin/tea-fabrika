import {
  arbMsg,
  arbRecordMsg,
  foldEvents,
  type MsgArbitraryTable,
  propertyInvariant,
  stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import { Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MsgOf } from "../program/program.ts";
import { earlierFor, type Job, type Jobs, Jobs as JobsSchema, jobsMachine, ownedBy, type StageRecord } from "./jobs.ts";

// Whose a job is, as a tsh asks it: which jobs it owns, and which earlier ones it says are
// waiting when it starts. And who wrote it (tracker 185): each job keeps its writer, `by`, for
// life, and who asked it to stop, and why, once (`stop`).
//
//   began     {..., by: "agent:claude for:github:7"}           the job's `by`, never changed after
//   stopping  {n: 1, by: "user:github:7", why: "wrong ticket"}  the job's `stop`, set once

const job = (n: number, owner: Job["owner"], state: Job["state"] = "detached"): Job => ({
  n,
  text: "counter",
  stages: [{ program: "counter", flags: {}, run: `counter:${n}`, wire: null, ended: false }],
  state,
  background: false,
  owner,
  by: null,
  stop: null,
});

/** t1's job and t2's, both detached; t2's running one; and one kept before jobs had owners. */
const TABLE: Jobs = {
  jobs: [job(1, "t1"), job(2, "t2"), job(3, "t2", "running"), job(4, null)],
  next: 5,
};

const numbers = (jobs: readonly Job[]) => jobs.map((one) => one.n);

describe("whose a job is", () => {
  it("a tile's tsh owns the jobs that name it, and a tsh with no name owns every one", () => {
    expect(numbers(ownedBy(TABLE, "t2"))).toEqual([2, 3]);
    expect(numbers(ownedBy(TABLE, "t3"))).toEqual([]);
    expect(numbers(ownedBy(TABLE, null))).toEqual([1, 2, 3, 4]);
  });

  it("a tsh that starts is told of its own detached jobs, and of any whose owner is not known", () => {
    expect(numbers(earlierFor(TABLE, "t1"))).toEqual([1, 4]);
    // t2's running job is not waiting: it runs.
    expect(numbers(earlierFor(TABLE, "t2"))).toEqual([2, 4]);
    // A tile that never ran a job is told of none of another's.
    expect(numbers(earlierFor(TABLE, "t3"))).toEqual([4]);
    expect(numbers(earlierFor(TABLE, null))).toEqual([1, 2, 4]);
  });
});

// ---------------------------------------------------------------- who wrote it

type Machine = typeof jobsMachine;
type Msg = MsgOf<Machine>;

const CLAUDE = "agent:claude for:github:7";
const PERSON = "user:github:7";

const ctx = stubCtxThrowingProxy<undefined>();

/** The table after `msgs`, from `loaded` (a fresh one: `null`). */
const after = (msgs: readonly Msg[], loaded: Jobs | null = null): Jobs => {
  const { states } = foldEvents(jobsMachine, ctx, loaded, msgs);
  const last = states.at(-1);

  if (last === undefined) {
    throw new Error("no state");
  }

  return last;
};

const counter = (run: string): StageRecord => ({
  program: "counter",
  flags: {},
  run,
  wire: null,
  ended: false,
});

const began = (run: string, by: string): Msg => ({
  type: "began",
  text: "counter",
  stages: [counter(run)],
  background: false,
  owner: "t1",
  by,
});

describe("a job keeps its writer", () => {
  it("began keeps `by`, and a new job has no stop", () => {
    const s = after([began("r1", CLAUDE), began("r2", PERSON)]);
    expect(s.jobs.map((j) => [j.n, j.by, j.stop])).toEqual([
      [1, CLAUDE, null],
      [2, PERSON, null],
    ]);
  });

  it("a table kept before jobs had a writer reads back with `by` and `stop` null: not known", () => {
    const kept = {
      jobs: [
        {
          n: 3,
          text: "counter",
          stages: [counter("r3")],
          state: "detached",
          background: false,
          owner: "t1",
        },
      ],
      next: 4,
    };
    const read = Schema.decodeUnknownSync(JobsSchema)(kept);
    expect(read.jobs[0]?.owner).toBe("t1");
    expect(read.jobs[0]?.by).toBeNull();
    expect(read.jobs[0]?.stop).toBeNull();
  });

  it("stopping keeps who asked and why, once: a second ask does not write over the first", () => {
    const s = after([
      began("r1", CLAUDE),
      { type: "stopping", n: 1, by: PERSON, why: "wrong ticket" },
      { type: "stopping", n: 1, by: CLAUDE, why: "again" },
    ]);
    expect(s.jobs[0]?.stop).toEqual({ by: PERSON, why: "wrong ticket" });
    // Who started it is not who stopped it.
    expect(s.jobs[0]?.by).toBe(CLAUDE);
  });

  it("a person's own stop keeps them as `by`, and `why` null", () => {
    const s = after([began("r1", PERSON), { type: "stopping", n: 1, by: PERSON, why: null }]);
    expect(s.jobs[0]?.stop).toEqual({ by: PERSON, why: null });
  });

  it("stopping a job the table does not hold changes nothing", () => {
    const before = after([began("r1", CLAUDE)]);
    const s = after([{ type: "stopping", n: 9, by: PERSON, why: "no such job" }], before);
    expect(s).toEqual(before);
  });

  it("keeps both through the table's schema, as storage keeps it", () => {
    const s = after([began("r1", CLAUDE), { type: "stopping", n: 1, by: PERSON, why: "done" }]);
    const round = Schema.decodeUnknownSync(JobsSchema)(Schema.encodeSync(JobsSchema)(s));
    expect(round.jobs[0]).toMatchObject({ by: CLAUDE, stop: { by: PERSON, why: "done" } });
  });
});

// ---------------------------------------------------------------- the laws of a job's writer

const run = fc.constantFrom("r1", "r2", "r3", "r4");

const stage: fc.Arbitrary<StageRecord> = fc.record({
  program: fc.constantFrom("counter", "seq"),
  flags: fc.constant({}),
  run,
  wire: fc.constant(null),
  ended: fc.constant(false),
});

const n = fc.integer({ min: 1, max: 4 });
const owner = fc.constantFrom("t1", "t2", null);
const writer = fc.constantFrom(CLAUDE, PERSON, "agent:lead for:github:7", "user:owner");

/** One entry per Msg type: leaving one out does not compile. */
const arbs: MsgArbitraryTable<Msg> = {
  began: arbRecordMsg("began", {
    text: fc.constantFrom("counter", "seq --to 3 | counter"),
    stages: fc.tuple(stage, fc.array(stage, { maxLength: 1 })).map(([first, rest]) => [first, ...rest] as const),
    background: fc.boolean(),
    owner,
    by: writer,
  }),
  stage_ended: arbRecordMsg("stage_ended", {
    run,
    how: fc.constantFrom("done", "failed", "stopped"),
  }),
  detached: arbRecordMsg("detached", { n: fc.option(n, { nil: null }) }),
  attached: arbRecordMsg("attached", { n, background: fc.boolean(), owner }),
  foreground: arbRecordMsg("foreground", { n }),
  dropped: arbRecordMsg("dropped", { n }),
  stopping: arbRecordMsg("stopping", {
    n,
    by: writer,
    why: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  }),
};

const lists = fc.array(arbMsg(arbs, { weights: { began: 3, stopping: 2 } }), {
  maxLength: 30,
  size: "max",
});

/** Seed 119120: the shared one (AGENTS.md). */
const OPTS = { numRuns: 300, seed: 119120 };

/** A table an earlier host kept: claude's job detached, and one kept before jobs had a writer. */
const KEPT: Jobs = {
  next: 5,
  jobs: [
    {
      n: 1,
      text: "counter",
      stages: [counter("r1")],
      state: "detached",
      background: false,
      owner: "t1",
      by: CLAUDE,
      stop: null,
    },
    {
      n: 3,
      text: "counter &",
      stages: [counter("r3")],
      state: "running",
      background: true,
      owner: "t2",
      by: null,
      stop: null,
    },
  ],
};

type JobStep = { readonly prev: Jobs; readonly msg: Msg; readonly next: Jobs };
const byNumber = (s: Jobs, at: number): Job | undefined => s.jobs.find((j) => j.n === at);

/** No Msg changes the writer of a job already in the table: `attached` and `stopping` included. */
const byForLife = ({ prev, next }: JobStep) =>
  prev.jobs.every((j) => {
    const now = byNumber(next, j.n);
    return now === undefined || now.by === j.by;
  });

/** A job that begins is written by the `began` that made it. */
const byFromBegan = ({ prev, msg, next }: JobStep) => msg.type !== "began" || byNumber(next, prev.next)?.by === msg.by;

/** A stop is set only by `stopping`, on that job, and once set it never changes. */
const stopOnce = ({ prev, msg, next }: JobStep) =>
  prev.jobs.every((j) => {
    const now = byNumber(next, j.n);

    if (now === undefined) {
      return true;
    }

    if (j.stop !== null) {
      return JSON.stringify(now.stop) === JSON.stringify(j.stop);
    }

    if (now.stop === null) {
      return true;
    }

    return msg.type === "stopping" && msg.n === j.n && now.stop.by === msg.by && now.stop.why === msg.why;
  });

describe("the laws of a job's writer", () => {
  for (const [name, holds] of [
    ["no Msg changes a job's by", byForLife],
    ["a job that begins is written by its began", byFromBegan],
    ["a stop is set once, by stopping, and never changes", stopOnce],
  ] as const) {
    it(name, () => {
      propertyInvariant(jobsMachine, ctx, lists, holds, OPTS);
      propertyInvariant(jobsMachine, ctx, lists, holds, { ...OPTS, loaded: KEPT });
    });
  }

  it("catches a stopping that writes the stopper over the job's writer", () => {
    const planted: Machine = {
      ...jobsMachine,
      update: {
        ...jobsMachine.update,
        stopping: (s, m) => [{ ...s, jobs: s.jobs.map((j) => (j.n === m.n ? { ...j, by: m.by } : j)) }, []],
      },
    };
    expect(() => propertyInvariant(planted, ctx, lists, byForLife, OPTS)).toThrow();
  });
});
