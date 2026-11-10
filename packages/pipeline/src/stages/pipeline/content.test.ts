import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layer as nodeFileSystem } from "@effect/platform-node/NodeFileSystem";
import { layer as nodePath } from "@effect/platform-node/NodePath";
import type { Agent } from "@kampus/fabrika-old";
import { RecordRead } from "@kampus/fabrika-old";
import { reader } from "@kampus/fabrika-old/agents/claude";
import { recordTracing } from "@kampus/fabrika-old/otel";
import { sqliteRecords } from "@kampus/fabrika-old/records";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { criterionId } from "../../ids.ts";
import { Builder } from "../build/form.ts";
import { type Held, LaneAgents, laneBuilder, laneNow, LaneNow } from "./agents.ts";

// Record wide (docs/plan/pipeline-self-fix.md, PR 7), end to end inside one lane step: the builder's
// run goes through the lane's own path to its agents, under a step span traced into a job's record
// on SQLite. What the agent read and wrote lands in that record's `content`, by span, with any
// key-shaped string cut first; and the step's `session` fact is written when the session opens, with the
// harness's own id for it. The agent is a stand-in that says what a Codex run says. Today's version.

const dir = mkdtempSync(join(tmpdir(), "content-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Made up, and put together at run time, so no key-shaped text sits in this file.
const MADE_UP_GITHUB = ["gh", "p_", "madeUpNotAKey".repeat(3)].join("");

/** The builder's answer, as JSON says it: what the turn's schema reads. */
const BUILT = {
  summary: "Names are read in one form.",
  deviations: [],
  ran: [{ command: "pnpm test", passed: true }],
  left: [],
  disputed: null,
  gaps: null,
};

/** A run that reads a file holding a key, says so, and answers, read by the turn's own schema. */
const said = <A>(turn: Agent.Turn<A>): Stream.Stream<Agent.Heard<A>> =>
  Stream.make<readonly Agent.Heard<A>[]>(
    { _tag: "started", session: turn.session },
    { _tag: "tool", id: "i1", title: "cat .env", status: "in_progress" },
    {
      _tag: "tool",
      id: "i1",
      title: "cat .env",
      status: "completed",
      output: `TOKEN=${MADE_UP_GITHUB}`,
    },
    { _tag: "said", text: "I read the file and built it." },
    {
      _tag: "ended",
      stop: "end_turn",
      answer: Option.getOrNull(reader(turn.answer)(BUILT)),
      tokens: { input: 120, cached: 0, output: 30 },
      counted: "turn",
      usd: null,
      requests: 1,
    },
  );

const held: Held = {
  run: said,
  knows: () => Effect.succeed(null),
  own: (session) => Effect.succeed(`thread-of-${session}`),
};

const agents = Layer.succeed(LaneAgents, { agents: Effect.succeed(held) });

describe("a lane step's agent run, traced into its job's record", () => {
  it("keeps what the agent read and wrote in `content`, its key cut, and writes the thread as its session", async () => {
    const sessions: string[] = [];
    const read = await Effect.runPromise(
      Effect.gen(function* () {
        const records = yield* sqliteRecords({ dir, by: "user:owner" });
        const trace = yield* Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          yield* records.calls(span.traceId, {
            op: "began",
            n: 1,
            text: "pipeline 1",
            host: "laptop",
            at: 0,
          });
          const now = yield* LaneNow;
          yield* now.set({
            picked: { harness: "codex", model: "gpt-5.5", effort: "low", usd: 0 },
            brief: { name: "build", hash: "0", slots: [], body: "Build it." },
            slots: {},
            folder: dir,
            access: "write",
          });
          yield* now.session.set((id) => Effect.sync(() => void sessions.push(id)));
          const builder = yield* Builder;
          const drafted = yield* builder.build(
            {
              ticket: "t-1",
              number: 1,
              title: "Read names in one form",
              body: "",
              criteria: [
                {
                  id: criterionId("c1"),
                  version: 1,
                  text: "Lower case.",
                  checked: false,
                  evidence: null,
                },
              ],
              round: 1,
              open: [],
              rules: [],
              tree: dir,
              branch: "fabrika/1",
              session: "s-build-1",
            },
            // The lane's builder takes who runs it from the step, not from here.
            { model: "gpt-5.5", effort: "low", budget: 0 },
          );
          expect(drafted.answer).toBe("built");
          return span.traceId;
        }).pipe(
          Effect.withSpan("lane_step build"),
          Effect.provide(laneBuilder.pipe(Layer.provideMerge(laneNow), Layer.provide(agents))),
          Effect.provide(recordTracing(records)),
        );
        return yield* Effect.flatMap(records.calls(trace, { op: "read" }), Schema.decodeUnknownEffect(RecordRead));
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath))),
    );

    expect(sessions).toEqual(["thread-of-s-build-1"]);
    const content = JSON.stringify(read.content);
    // The tool's result, the agent's message and its prompt are there, with only the key cut.
    expect(content).toContain("TOKEN=[key cut]");
    expect(content).toContain("I read the file and built it.");
    expect(content).toContain("Build it.");
    expect(content).not.toContain(MADE_UP_GITHUB);
    // The step's span, its agent folded in as the view shows it, and each part that kept content.
    // The spans keep names and ids; the words are only in `content`.
    expect(read.spans.map((s) => s.name).toSorted()).toEqual([
      "chat gpt-5.5",
      "execute_tool command",
      "lane_step build · 1 turn",
    ]);
    expect(JSON.stringify(read.spans)).not.toContain("I read the file");
  });
});
