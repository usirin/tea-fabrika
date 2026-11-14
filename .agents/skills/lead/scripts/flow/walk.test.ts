// runFlow on the real tea engine and tea's own file store, in a temp folder, with fake runners
// through `Runners.layer`: no git, network or agent.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Flow from "./Flow.ts";
import { landDecision } from "./flows/land-decision.ts";
import * as FlowMachine from "./machine.ts";
import * as Outcome from "./Outcome.ts";
import * as Runners from "./Runners.ts";
import * as Step from "./Step.ts";
import { ending, runFlow } from "./walk.ts";

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** Fake runners: each answers from `answers` by step name, and every call is written down. */
const fakes = (answers: Readonly<Record<string, (n: number) => Outcome.Outcome>>) => {
  const calls: string[] = [];
  const table = Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => [
      name,
      (step: Step.Step) =>
        Effect.sync(() => {
          calls.push(step.name);
          return Outcome.answer(answer(calls.filter((c) => c === name).length));
        }),
    ]),
  );
  return { calls, layer: Runners.layer(table) };
};

const tempState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "flow-" });
  return `${dir}/state.json`;
});

const readModel = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    return Schema.decodeUnknownSync(Schema.fromJsonString(FlowMachine.Model))(text);
  });

const three = Flow.make("three", [Step.act("a"), Step.check("b"), Step.act("c")]);

describe("runFlow", () => {
  it("scenario: a flow runs to done and its state file holds every attempt, since a resume reads only the file", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* tempState;
        const { calls, layer } = fakes({
          a: () => Outcome.done("a"),
          b: () => Outcome.skip("b"),
          c: () => Outcome.done("c"),
        });
        const model = yield* runFlow(three, { state, resume: false, lead: false }).pipe(Effect.provide(layer));
        expect(ending(model)).toMatchObject({ outcome: "done", exit: 0 });
        expect(calls).toEqual(["a", "b", "c"]);
        const saved = yield* readModel(state);
        expect(saved).toEqual(model);
        expect(saved.history.map((h) => h.outcome?._tag)).toEqual(["done", "skip", "done"]);
      }),
    ));

  it("scenario: a parked flow resumes at the asked step and never runs the steps before it again", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* tempState;
        const { calls, layer } = fakes({
          a: () => Outcome.done("a"),
          b: (n) => (n === 1 ? Outcome.ask("may I?") : Outcome.done("yes")),
          c: () => Outcome.done("c"),
        });
        const parked = yield* runFlow(three, { state, resume: false, lead: false }).pipe(Effect.provide(layer));
        expect(ending(parked)).toEqual({ outcome: "ask", reason: "b asks: may I?", exit: 20 });
        expect((yield* readModel(state))._tag).toBe("parked");
        const resumed = yield* runFlow(three, { state, resume: true, lead: false }).pipe(Effect.provide(layer));
        expect(resumed._tag).toBe("done");
        expect(calls).toEqual(["a", "b", "b", "c"]);
      }),
    ));

  it("scenario: a first run refuses a state file that exists, and a resume refuses a changed flow, since either would mix two flows' records", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* tempState;
        const { layer } = fakes({
          a: () => Outcome.stuck("no"),
          b: () => Outcome.done("b"),
          c: () => Outcome.done("c"),
        });
        const stuck = yield* runFlow(three, { state, resume: false, lead: false }).pipe(Effect.provide(layer));
        expect(ending(stuck).exit).toBe(30);
        const again = yield* runFlow(three, { state, resume: false, lead: false }).pipe(
          Effect.provide(layer),
          Effect.flip,
        );
        expect(again._tag).toBe("Usage");
        const changed = Flow.make("three", [Step.act("a"), Step.act("c")]);
        const other = yield* runFlow(changed, { state, resume: true, lead: false }).pipe(
          Effect.provide(layer),
          Effect.flip,
        );
        expect(other._tag === "Usage" ? other.reason : "").toContain("changed");
      }),
    ));

  it("scenario: a flow with a step no runner knows is refused before anything runs, since it could only end stuck midway", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* tempState;
        const { calls, layer } = fakes({ a: () => Outcome.done("a") });
        const refused = yield* runFlow(three, { state, resume: false, lead: false }).pipe(
          Effect.provide(layer),
          Effect.flip,
        );
        expect(refused._tag === "Usage" ? refused.reason : "").toBe("no runner for steps b, c");
        expect(calls).toEqual([]);
        expect(yield* FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.exists(state)))).toBe(false);
      }),
    ));
});

const decision = landDecision({
  ticket: "656",
  dir: "worktree",
  branch: "fabrikalfa/adr-x",
  paths: [".decisions/0000-x.md"],
  subject: "T656 lead: x",
  title: "x",
  body: "y",
});

describe("the land-decision flow", () => {
  it("pinned: its steps, kinds and lead marks, in order, since the lead reads this list to know what it lands", () => {
    expect(decision.steps.map((s) => [s._tag, s.name, s.lead])).toEqual([
      ["act", "format", false],
      ["check", "lint", false],
      ["gather", "governance", false],
      ["act", "lead-commit", true],
      ["check", "leak-grep", false],
      ["act", "bot-push", false],
      ["act", "open-pr", false],
      ["listen", "ci", false],
      ["act", "queue", true],
    ]);
  });

  it("scenario: started without --lead it parks on the lead sign after the checks, since only the lead session signs", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* tempState;
        const ok = () => Outcome.done("ok");
        const { calls, layer } = fakes(Object.fromEntries(decision.steps.map((s) => [s.name, ok])));
        const model = yield* runFlow(decision, { state, resume: false, lead: false }).pipe(Effect.provide(layer));
        expect(calls).toEqual(["format", "lint", "governance"]);
        expect(model._tag === "parked" ? model.position : -1).toBe(3);
        const led = yield* runFlow(decision, { state, resume: true, lead: true }).pipe(Effect.provide(layer));
        expect(led._tag).toBe("done");
        expect(calls.slice(3)).toEqual(decision.steps.slice(3).map((s) => s.name));
      }),
    ));
});
