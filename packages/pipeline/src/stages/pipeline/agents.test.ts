import type { Agent, Writer } from "@kampus/fabrika-old";
import { jsonSchema, reader } from "@kampus/fabrika-old/agents/claude";
import { strictOk } from "@kampus/fabrika-old/agents/codex";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { criterionId } from "../../ids.ts";
import type { FactOf } from "../../tickets/ticket.ts";
import { memoryTickets, Tickets, TicketsFailed, ticketsInMemory } from "../../tickets/tickets.ts";
import { Builder, Built } from "../build/form.ts";
import { ExamWritten } from "../exam/machine.ts";
import { PlanDraft } from "../plan/plan.ts";
import { Form } from "../review/sheet.ts";
import { SortReply } from "../sort/answer.ts";
import { Answered } from "../test-writer/mutants.ts";
import { Written } from "../test-writer/written.ts";
import { type Held, LaneAgents, laneBuilder, laneNow, LaneNow, listUsdOf, stepStarted } from "./agents.ts";

// Today's version. A schema that strict mode would refuse is not handed to Codex at all, and the agent
// is only asked in words. So each answer a lane's agent gives has to pass, or its step gets no
// `--output-schema`.

describe("the answer schema of every step that runs an agent", () => {
  const SCHEMAS = [
    ["triage", jsonSchema(SortReply)],
    ["plan", jsonSchema(PlanDraft)],
    ["exam", jsonSchema(ExamWritten)],
    ["test writer", jsonSchema(Written)],
    ["mutants", jsonSchema(Answered)],
    ["build", jsonSchema(Built)],
    ["review", jsonSchema(Form)],
  ] as const;

  it("passes strict mode, so every step gets --output-schema", () => {
    const refused = SCHEMAS.filter(([, schema]) => !strictOk(schema)).map(([step]) => step);
    expect(refused).toEqual([]);
  });
});

// A step's `started` is written at once, before its setup, so the ticket shows it running and a
// crash in setup leaves it behind. The agent's session id is a fact of its own, `session`, written
// once when the session opens. A last message that does not fit gets one more try on the same
// session, and that try opens it again: still one `session`.

/** The builder's answer, as JSON says it: what the turn's schema reads. */
const BUILT = {
  summary: "Names are read in one form.",
  deviations: [],
  ran: [{ command: "pnpm test", passed: true }],
  left: [],
  disputed: null,
  gaps: null,
};

/** A run that answers in words the first time, and with the answer on the try after. */
const misfitThenAnswer = () => {
  let runs = 0;
  return <A>(turn: Agent.Turn<A>): Stream.Stream<Agent.Heard<A>> => {
    runs += 1;
    const fits = runs > 1;
    return Stream.make<readonly Agent.Heard<A>[]>(
      { _tag: "started", session: turn.session },
      { _tag: "said", text: fits ? JSON.stringify(BUILT) : "I built it." },
      {
        _tag: "ended",
        stop: "end_turn",
        answer: fits ? Option.getOrNull(reader(turn.answer)(BUILT)) : null,
        tokens: { input: 120, cached: 0, output: 30 },
        counted: "turn",
        usd: null,
        requests: 1,
      },
    );
  };
};

const owner: Writer = { kind: "user", id: "owner" };
const lane: Writer = { kind: "agent", id: "lane", for: "owner" };

/** Ticket 1, filed by its owner, in memory: where a step writes its facts. */
const ticketOne = ticketsInMemory(lane).pipe(
  Layer.provide(memoryTickets([{ ticket: 1, by: owner, fact: { type: "filed", title: "Read names", body: "" } }])),
);

const STARTED: FactOf<"started"> = {
  type: "started",
  run: "r-build-1",
  stage: "build",
  task: null,
  log: null,
};

/** A step, on a builder whose agent runs `run`, and ticket 1: what it wrote, in order. */
const stepOn = async (run: Held["run"], step: Effect.Effect<void, unknown, LaneNow | Builder | Tickets>) => {
  const held: Held = {
    run,
    knows: () => Effect.succeed(null),
    own: (session) => Effect.succeed(`thread-of-${session}`),
  };
  const agents = Layer.succeed(LaneAgents, { agents: Effect.succeed(held) });
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.ignore(step);
      // The step's own end: the session a failed write kept, if any.
      yield* (yield* LaneNow).session.left;
      return (yield* (yield* Tickets).read(1)).timeline.map((e) => e.fact);
    }).pipe(
      Effect.provide(
        laneBuilder.pipe(Layer.provideMerge(laneNow), Layer.provide(agents), Layer.provideMerge(ticketOne)),
      ),
    ),
  );
};

/** The builder's turn on ticket 1. */
const build = Effect.gen(function* () {
  const now = yield* LaneNow;
  yield* now.set({
    picked: { harness: "codex", model: "gpt-5.5", effort: "low", usd: 0 },
    brief: { name: "build", hash: "0", slots: [], body: "Build it." },
    slots: {},
    folder: "/nowhere",
    access: "write",
  });
  const builder = yield* Builder;
  return yield* builder.build(
    {
      ticket: "t-1",
      number: 1,
      title: "Read names in one form",
      body: "",
      criteria: [{ id: criterionId("c1"), version: 1, text: "Lower case.", checked: false, evidence: null }],
      round: 1,
      open: [],
      rules: [],
      tree: "/nowhere",
      branch: "fabrika/1",
      session: "s-build-1",
    },
    { model: "gpt-5.5", effort: "low", budget: 0 },
  );
});

describe("a step's started and its session", () => {
  it("writes started before the session opens, then the session once, with the harness's id, across a misfit's second try", async () => {
    const before: string[] = [];
    const facts = await stepOn(
      misfitThenAnswer(),
      Effect.gen(function* () {
        yield* stepStarted(1, STARTED);
        // Setup has not run, and no agent has: the ticket already shows the step.
        before.push(...(yield* (yield* Tickets).read(1)).timeline.map((e) => e.fact.type));
        const built = yield* build;
        expect(built.answer).toBe("built");
      }),
    );
    expect(before).toEqual(["filed", "started"]);
    expect(facts.map((f) => f.type)).toEqual(["filed", "started", "session"]);
    expect(facts[2]).toEqual({ type: "session", run: "r-build-1", id: "thread-of-s-build-1" });
  });

  it("leaves started and no session when the step crashes in setup", async () => {
    const facts = await stepOn(
      misfitThenAnswer(),
      Effect.gen(function* () {
        yield* stepStarted(1, STARTED);
        return yield* Effect.fail("the worktree could not be made");
      }),
    );
    expect(facts.map((f) => f.type)).toEqual(["filed", "started"]);
  });

  it("keeps the id of a session write that failed, for the step's own write at its end", async () => {
    const ids: string[] = [];
    const tries = await Effect.runPromise(
      Effect.gen(function* () {
        const now = yield* LaneNow;
        let calls = 0;
        yield* now.session.set((id) =>
          Effect.suspend(() => {
            calls += 1;
            return calls === 1
              ? Effect.fail(new TicketsFailed({ ticket: 1, why: "unreachable", says: "down" }))
              : Effect.sync(() => void ids.push(id));
          }),
        );
        const first = yield* Effect.result(now.session.opened("thread-1"));
        yield* now.session.left;
        yield* now.session.left;
        return first._tag;
      }).pipe(Effect.provide(laneNow)),
    );
    expect(tries).toBe("Failure");
    expect(ids).toEqual(["thread-1"]);
  });

  it("writes no session at the end when none opened", async () => {
    const ids: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const now = yield* LaneNow;
        yield* now.session.set((id) => Effect.sync(() => void ids.push(id)));
        yield* now.session.opened(null);
        yield* now.session.left;
      }).pipe(Effect.provide(laneNow)),
    );
    expect(ids).toEqual([]);
  });

  it("leaves the next step's writer in place when the last step's write lands after it was set", async () => {
    const ids: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const now = yield* LaneNow;
        const landing = yield* Deferred.make<void>();
        yield* now.session.set(() =>
          Deferred.await(landing).pipe(Effect.andThen(Effect.sync(() => void ids.push("first")))),
        );
        const late = yield* Effect.forkChild(now.session.opened("s-1"));
        yield* Effect.yieldNow;
        yield* now.session.set(() => Effect.sync(() => void ids.push("next")));
        yield* Deferred.succeed(landing, undefined);
        yield* Fiber.join(late);
        yield* now.session.opened("s-2");
      }).pipe(Effect.provide(laneNow)),
    );
    expect(ids).toEqual(["first", "next"]);
  });
});

// Ticket 141: gpt-6-astra's list price, so its steps stop reading "no price". OpenAI's pricing page
// (https://developers.openai.com/api/docs/pricing), read 2026-11-02, standard tier, up to 272K
// input: $10 in, $1 cached in, $50 out per 1M tokens. Past 272K it is $20 / $2 / $75, but a step
// keeps only its token totals, never each request's size, so the long rate can never be applied:
// the short rate is the floor, the same gap gpt-6.1-sol has.
describe("a model's list price", () => {
  const M = 1_000_000;

  it("prices gpt-6-astra at its short-context rates: $10 in, $1 cached, $50 out per 1M", () => {
    expect(listUsdOf("gpt-6-astra", { input: M, cached: 0, output: 0 })).toBeCloseTo(10, 9);
    expect(listUsdOf("gpt-6-astra", { input: M, cached: M, output: 0 })).toBeCloseTo(1, 9);
    expect(listUsdOf("gpt-6-astra", { input: 0, cached: 0, output: M })).toBeCloseTo(50, 9);
    expect(listUsdOf("gpt-6-astra", { input: 120_000, cached: 100_000, output: 4_000 })).toBeCloseTo(
      (10 * 20_000 + 1 * 100_000 + 50 * 4_000) / M,
      9,
    );
  });

  it("keeps gpt-6.1-sol at $2 in, $0.10 cached, $10 out per 1M", () => {
    expect(listUsdOf("gpt-6.1-sol", { input: M, cached: 0, output: 0 })).toBeCloseTo(2, 9);
    expect(listUsdOf("gpt-6.1-sol", { input: M, cached: M, output: 0 })).toBeCloseTo(0.1, 9);
    expect(listUsdOf("gpt-6.1-sol", { input: 0, cached: 0, output: M })).toBeCloseTo(10, 9);
  });

  it("gives a model the table does not hold no price, never another's and never $0", () => {
    expect(listUsdOf("made-up-model", { input: M, cached: 0, output: M })).toBeNull();
  });
});
