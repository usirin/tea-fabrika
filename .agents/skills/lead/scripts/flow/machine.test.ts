// The flow machine's laws, on its pure init and update: no runner, no file, no clock.
import { step } from "@demlik/tea/testing";
import { Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Flow from "./Flow.ts";
import * as FlowMachine from "./machine.ts";
import * as Outcome from "./Outcome.ts";
import * as Step from "./Step.ts";

type Verb = "done" | "skip" | "ask" | "stuck";
type Machine = ReturnType<typeof FlowMachine.make>;
type Cmd = ReturnType<typeof FlowMachine.stepRun>;

const AT = 1_000;

const verbOutcome = (verb: Verb, name: string): Outcome.Outcome =>
  verb === "done"
    ? Outcome.done(`${name} ok`)
    : verb === "skip"
      ? Outcome.skip(`${name} had nothing to do`)
      : verb === "ask"
        ? Outcome.ask(`${name} wants the lead`)
        : Outcome.stuck(`${name} broke`);

/**
 * Drive the machine as the engine would: each Cmd's answer comes from `answer`, one tick of the
 * clock later. Every Model on the way is kept, and the positions that ran, in order.
 */
const drive = (
  machine: Machine,
  flow: Flow.Flow,
  answer: (cmd: Cmd) => Outcome.Outcome,
  loaded: FlowMachine.Model | null = null,
) => {
  const ctx = { flow, at: AT };
  let [model, cmds] = machine.init(loaded, ctx);
  const models = [model];
  const ran: number[] = [];
  let at = AT;

  for (let guard = 0; cmds.length > 0 && guard < 1_000; guard += 1) {
    const cmd = cmds[0];

    if (cmd === undefined) {
      break;
    }

    ran.push(cmd.position);
    at += 1;
    [model, cmds] = step(machine, model, FlowMachine.stepRun.ok(cmd, Outcome.answer(answer(cmd)), at), ctx);
    models.push(model);
  }

  return { model, models, ran };
};

const KINDS = [Step.gather, Step.act, Step.listen, Step.draft, Step.check, Step.judge] as const;

/** A flow of 1 to 8 steps of any kind, named s0, s1, ..., with each step's lead mark. */
const arbFlow = (lead: fc.Arbitrary<boolean> = fc.constant(false)) =>
  fc
    .array(fc.tuple(fc.integer({ min: 0, max: KINDS.length - 1 }), lead), { minLength: 1, maxLength: 8 })
    .map((specs) => {
      const steps = specs.map(([kind, marked], i) => (KINDS[kind] ?? Step.act)(`s${i}`, { i }, { lead: marked }));
      const [first, ...rest] = steps;
      return Flow.make("arb", [first ?? Step.act("s0"), ...rest]);
    });

/** A flow with a verb per step. */
const arbScripted = arbFlow().chain((flow) =>
  fc
    .array(fc.constantFrom<Verb>("done", "skip", "ask", "stuck"), {
      minLength: flow.steps.length,
      maxLength: flow.steps.length,
    })
    .map((verbs) => ({ flow, verbs })),
);

const scripted = (verbs: ReadonlyArray<Verb>) => (cmd: Cmd) =>
  verbOutcome(verbs[cmd.position] ?? "done", cmd.step.name);

const asLead = FlowMachine.make({ lead: true });
const notLead = FlowMachine.make({ lead: false });

/** The state file's trip: the Model as JSON text and back, through its schema. */
const saved = (m: FlowMachine.Model) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(FlowMachine.Model))(
    JSON.stringify(Schema.encodeSync(FlowMachine.Model)(m)),
  );

describe("the flow machine", () => {
  it("a flow ends at its first ask or stuck, and runs no step after it", () => {
    fc.assert(
      fc.property(arbScripted, ({ flow, verbs }) => {
        const { model, ran } = drive(asLead, flow, scripted(verbs));
        const first = verbs.findIndex((v) => v === "ask" || v === "stuck");

        if (first === -1) {
          expect(model._tag).toBe("done");
          expect(ran).toEqual(flow.steps.map((_, i) => i));
          return;
        }

        expect(ran).toEqual(Array.from({ length: first + 1 }, (_, i) => i));
        expect(model._tag).toBe(verbs[first] === "ask" ? "parked" : "stuck");
        expect(model._tag !== "done" && model._tag !== "running" ? model.position : -1).toBe(first);
      }),
    );
  });

  it("a resumed flow never runs a step again whose outcome is recorded done or skip", () => {
    fc.assert(
      fc.property(arbScripted, ({ flow, verbs }) => {
        const first = drive(asLead, flow, scripted(verbs));

        if (first.model._tag === "done") {
          // A done flow resumes to itself and runs nothing.
          expect(drive(asLead, flow, () => Outcome.done("again"), saved(first.model)).ran).toEqual([]);
          return;
        }

        const stopped = first.model._tag === "running" ? -1 : first.model.position;
        const again = drive(asLead, flow, () => Outcome.done("now it passes"), saved(first.model));
        expect(again.ran[0]).toBe(stopped);
        expect(again.ran.every((p) => p >= stopped)).toBe(true);
        expect(again.model._tag).toBe("done");
        // Every attempt of the first process is kept, as it was.
        expect(again.model.history.slice(0, first.model.history.length)).toEqual(first.model.history);
      }),
    );
  });

  it("the state file always parses back to the same Model", () => {
    fc.assert(
      fc.property(arbScripted, ({ flow, verbs }) => {
        for (const m of drive(asLead, flow, scripted(verbs)).models) {
          expect(saved(m)).toEqual(m);
        }
      }),
    );
  });

  it("without the lead, a lead step never runs and the flow parks on the first one", () => {
    fc.assert(
      fc.property(arbFlow(fc.boolean()), (flow) => {
        const { model, ran } = drive(notLead, flow, () => Outcome.done("ok"));
        const first = flow.steps.findIndex((s) => s.lead);
        expect(ran.every((p) => flow.steps[p]?.lead === false)).toBe(true);

        if (first === -1) {
          expect(model._tag).toBe("done");
          return;
        }

        expect(model._tag).toBe("parked");
        expect(model._tag === "parked" ? model.position : -1).toBe(first);
        expect(model.history.at(-1)?.outcome?._tag).toBe("ask");
      }),
    );
  });

  it("every attempt that ran holds its start, its end and its outcome", () => {
    fc.assert(
      fc.property(arbScripted, ({ flow, verbs }) => {
        const { model, ran } = drive(asLead, flow, scripted(verbs));
        expect(model.history.map((a) => a.position)).toEqual(ran);

        for (const a of model.history) {
          expect(a.name).toBe(flow.steps[a.position]?.name);
          expect(a.outcome).not.toBeNull();
          expect(a.endedAt ?? 0).toBeGreaterThan(a.startedAt);
        }
      }),
    );
  });

  it("scenario: a send goes to the named step, and runs a done step again on purpose", () => {
    const flow = Flow.make("send", [Step.act("build"), Step.check("review"), Step.act("land")]);
    let reviews = 0;
    const { model, ran } = drive(asLead, flow, (cmd) => {
      if (cmd.step.name !== "review") {
        return Outcome.done("ok");
      }

      reviews += 1;
      return reviews === 1 ? Outcome.send("build", "one fix") : Outcome.done("merge-ready");
    });
    expect(ran).toEqual([0, 1, 0, 1, 2]);
    expect(model._tag).toBe("done");
  });

  it("scenario: a send to a name the flow lacks is stuck, since a typo must not end a flow done", () => {
    const flow = Flow.make("typo", [Step.act("build"), Step.check("review")]);
    const { model } = drive(asLead, flow, (cmd) =>
      cmd.step.name === "review" ? Outcome.send("biuld", "fix") : Outcome.done("ok"),
    );
    expect(model._tag).toBe("stuck");
    expect(model._tag === "stuck" ? model.reason : "").toContain("biuld");
  });

  it("scenario: a send loop stops stuck at the flow's attempt cap, so no flow runs forever", () => {
    const flow = Flow.make("loop", [Step.act("a"), Step.act("b")], { attempts: 5 });
    const { model, ran } = drive(asLead, flow, (cmd) =>
      cmd.step.name === "b" ? Outcome.send("a", "again") : Outcome.done("ok"),
    );
    expect(ran).toHaveLength(5);
    expect(model._tag).toBe("stuck");
  });

  it("scenario: a runner that fails ends the flow stuck with its reason, since nothing answered", () => {
    const flow = Flow.make("fails", [Step.act("push"), Step.act("land")]);
    const ctx = { flow, at: AT };
    const [running, cmds] = asLead.init(null, ctx);
    const cmd = cmds[0];

    if (cmd === undefined) {
      throw new Error("init started no step");
    }

    const [model, next] = step(
      asLead,
      running,
      FlowMachine.stepRun.err(cmd, { _tag: "StepFailed", reason: "no gh" }, 2_000),
      ctx,
    );
    expect(next).toEqual([]);
    expect(model._tag === "stuck" ? model.reason : "").toBe("push failed: no gh");
    expect(model.history[0]?.outcome?._tag).toBe("stuck");
  });

  it("scenario: an answer for a step that is not in flight changes nothing, since a late echo must not move the flow", () => {
    const flow = Flow.make("late", [Step.act("a"), Step.act("b")]);
    const ctx = { flow, at: AT };
    const [running] = asLead.init(null, ctx);
    const late = FlowMachine.stepRun({ position: 1, step: Step.act("b") });
    const [model, cmds] = step(
      asLead,
      running,
      FlowMachine.stepRun.ok(late, Outcome.answer(Outcome.done("x")), 2_000),
      ctx,
    );
    expect(model).toEqual(running);
    expect(cmds).toEqual([]);
  });

  it("scenario: a process that died mid-step keeps that attempt open and runs the step again on resume", () => {
    const flow = Flow.make("died", [Step.act("a"), Step.act("b")]);
    const [running] = asLead.init(null, { flow, at: AT });
    const again = drive(asLead, flow, () => Outcome.done("ok"), saved(running));
    expect(again.ran).toEqual([0, 1]);
    expect(again.model.history[0]?.outcome).toBeNull();
    expect(again.model.history).toHaveLength(3);
  });

  it("scenario: Flow.make refuses two steps of one name, since a send must name one step", () => {
    expect(() => Flow.make("twice", [Step.act("a"), Step.check("a")])).toThrow();
  });
});
