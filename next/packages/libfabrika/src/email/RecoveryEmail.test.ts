// P36, next/: the asking-device child starts at init and waits only for an appended added.
import { acceptedTypes, applyCell } from "@demlik/tea";
import { arbMsg, arbGuidedSequence, type MsgArbitraryTable } from "@demlik/tea/pbt";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import {
  EPOCH,
  EFFECT,
  RecoveryFlow,
  binding,
  input,
  pureLaw,
  pureModule,
  loadParent,
  parentAnswers,
  started,
  type Binding,
  type Made,
  type NoticeView,
} from "./Email.test-support.ts";

// The asking device's child, as the plan gives it. The laws read a state's tag, and `added` once in.
type Model =
  | { readonly _tag: "off" | "asking" | "checking" | "failed" }
  | { readonly _tag: "in"; readonly added: string };

type Msg =
  | { readonly type: "recover" }
  | { readonly type: "issued"; readonly challenge: { readonly id: string; readonly until: number } }
  | { readonly type: "code"; readonly secret: string }
  | { readonly type: "old"; readonly old: "lost" | "kept" }
  | { readonly type: "checked"; readonly check: "touch" }
  | { readonly type: "redeemed"; readonly added: string }
  | {
      readonly type: "failed";
      readonly reason: "wrong_code" | "expired" | "exhausted" | "send" | "storage";
    }
  | { readonly type: "tick"; readonly now: number };

// What the child asks its parent to do. Each has one answer below.
type Command = { readonly type: "issue" | "old" | "check" | "redeem" };
type Ctx = { readonly cloud: boolean; readonly binding: Binding };

const email = pureModule<{
  readonly recoveryEmail: Made<Model, Msg, Command, Ctx>;
  readonly noticeView: NoticeView;
}>("RecoveryEmail.ts");

// A strict table means a new message needs a generator before CI accepts it.
const messages: MsgArbitraryTable<Msg> = {
  recover: fc.constant({ type: "recover" }),
  issued: fc.record({
    type: fc.constant("issued"),
    challenge: fc.record({ id: fc.string(), until: fc.integer() }),
  }),
  code: fc.record({ type: fc.constant("code"), secret: fc.string() }),
  old: fc.record({ type: fc.constant("old"), old: fc.constantFrom("lost", "kept") }),
  checked: fc.record({ type: fc.constant("checked"), check: fc.constant("touch") }),
  redeemed: fc.record({ type: fc.constant("redeemed"), added: fc.string({ minLength: 1 }) }),
  failed: fc.record({
    type: fc.constant("failed"),
    reason: fc.constantFrom("wrong_code", "expired", "exhausted", "send", "storage"),
  }),
  tick: fc.record({ type: fc.constant("tick"), now: fc.integer() }),
};

const msg = arbMsg(messages);

// The answers are chosen only for commands the real child has sent, including failures.
const walk = (cloud: boolean) =>
  arbGuidedSequence(
    email().recoveryEmail,
    { cloud, binding: binding() },
    {
      outside: { recover: messages.recover, code: messages.code, tick: messages.tick },
      answers: {
        issue: { draw: fc.oneof(messages.issued, messages.failed), make: (_command, answer) => answer },
        old: { draw: fc.oneof(messages.old, messages.failed), make: (_command, answer) => answer },
        check: { draw: fc.oneof(messages.checked, messages.failed), make: (_command, answer) => answer },
        redeem: { draw: fc.oneof(messages.redeemed, messages.failed), make: (_command, answer) => answer },
      },
    },
  );

// Plant after build: init resets a reachable failed/asking/checking/in state.
it("not built: P36 / P36.10 RecoveryEmail restores every saved state without admitting another device", (ctx) => {
  started(ctx);
  const machine = email().recoveryEmail;
  fc.assert(
    fc.property(
      fc.boolean().chain((cloud) => walk(cloud).map((sequence) => ({ cloud, sequence }))),
      ({ cloud, sequence }) => {
        const ctx = { cloud, binding: binding() };
        let [saved] = machine.init(null, ctx);
        const restore = () => {
          const codec = Schema.fromJsonString(machine.model);
          const back = Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(saved));
          const [restored] = machine.init(back, ctx);
          expect(restored).toEqual(saved);
          return restored;
        };
        restore();

        for (const message of sequence) {
          const restored = restore();
          const expected = applyCell(machine, saved, message);
          expect(applyCell(machine, restored, message)).toEqual(expected);
          [saved] = expected;
          restore();
        }
      },
    ),
    { seed: 119120 },
  );
});

// Plants after build: enter in on checked alone; on issued alone; or on a timer.
it("not built: P36 / P36.10 no generated Msg makes RecoveryEmail in without an appended added", (ctx) => {
  started(ctx);
  const machine = email().recoveryEmail;
  fc.assert(
    fc.property(
      arbGuidedSequence(
        machine,
        { cloud: true, binding: binding() },
        {
          outside: { recover: messages.recover, code: messages.code, tick: messages.tick },
          answers: {
            issue: { draw: messages.issued, make: (_command, answer) => answer },
            old: { draw: messages.old, make: (_command, answer) => answer },
            check: { draw: messages.checked, make: (_command, answer) => answer },
            redeem: { draw: messages.redeemed, make: (_command, answer) => answer },
          },
        },
      ),
      (sequence) => {
        const ctx = { cloud: true, binding: binding() };
        let [model] = machine.init(null, ctx);
        expect(model._tag).not.toBe("in");
        const appended = new Set<string>();

        for (const message of sequence) {
          // Tea drops a message with no cell. This uses tea's table, not a copy of its rules.
          if (!acceptedTypes(machine, model).includes(message.type)) {
            continue;
          }

          if (message.type === "redeemed") {
            appended.add(message.added);
          }

          [model] = applyCell(machine, model, message);
          expect(model._tag === "in" ? appended.has(model.added) : true).toBe(true);
        }
      },
    ),
    { seed: 119120 },
  );
});

pureLaw("not built: P36 / P36.10 local setup keeps the sheet path and offers no email action", RecoveryFlow, (flow) => {
  const machine = email().recoveryEmail;
  const ctx = { cloud: false, binding: binding() };
  const [start] = machine.init(null, ctx);
  const [next, commands] = applyCell(machine, start, { type: "recover" });
  expect(next._tag).toBe("off");
  expect(commands).toEqual([]);
  void flow;
});

// The success control stops a child that refuses all messages from passing the negative law.
it.effect.prop(
  "not built: P36 / P36.26 P28 parent steps email and asks about the old device before PersonCheck",
  { flow: RecoveryFlow },
  ({ flow }, test) =>
    Effect.gen(function* () {
      started(test);
      const parent = yield* loadParent;
      const { calls, services } = parentAnswers(flow);
      const [model] = parent.Recovery.init({ cloud: true });
      const [next, commands] = parent.Recovery.update(model, {
        type: "email",
        msg: { type: "code", secret: "secret-holder-ref" },
      });

      for (const command of commands) {
        yield* parent.recoveryHandlers(services)(command);
      }

      expect(calls).toEqual(["old", "check"]);
      expect(next.email).toBeDefined();
      const machine = email().recoveryEmail;
      const ctx = { cloud: true, binding: binding() };
      let [child] = machine.init(null, ctx);

      for (const message of [
        { type: "recover" },
        { type: "issued", challenge: { id: input(1), until: EPOCH + 600000 } },
        { type: "code", secret: "secret-holder-ref" },
        { type: "old", old: flow.old },
        { type: "checked", check: "touch" },
      ] satisfies Msg[]) {
        [child] = applyCell(machine, child, message);
        expect(child._tag).not.toBe("in");
      }

      [child] = applyCell(machine, child, { type: "redeemed", added: input(100) });
      expect(child).toMatchObject({ _tag: "in", added: input(100) });
    }),
  EFFECT,
);

// The live-device notice is a view, not a third control machine. A host passes ordinary
// messages to the view's handler; none may write toward the brain.
// Plant after build: add a cancel/not-me action or emit a Cmd for any notice message.
it("not built: P36 / 0138 every generated message on the live-device notice yields no Cmd", (ctx) => {
  started(ctx);
  fc.assert(
    fc.property(msg, (message) => {
      const notice = email().noticeView({
        added: input(100),
        label: "test device",
        location: "test location",
        at: EPOCH,
      });
      expect(notice.actions).toEqual([]);
      expect(notice.update(message)[1]).toEqual([]);
    }),
    { seed: 119120 },
  );
});
