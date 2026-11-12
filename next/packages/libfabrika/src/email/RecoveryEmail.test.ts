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
} from "./Email.test-support.ts";
import type { Msg } from "./RecoveryEmail.ts";

const email = pureModule(() => import("./RecoveryEmail.ts"));

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

// Plant after build: init resets a saved failed/asking/checking/in state.
pureLaw(
  "P36.10 RecoveryEmail restores every saved state without admitting another device",
  RecoveryFlow,
  email,
  (flow) => {
    const machine = email().recoveryEmail;
    const states = [
      { _tag: "off" },
      { _tag: "asking", challenge: input(1), until: EPOCH + 600000 + flow.skew },
      { _tag: "checking", challenge: input(1) },
      { _tag: "in", added: input(100) },
      ...["wrong_code", "expired", "exhausted", "send", "storage"].map((reason) => ({ _tag: "failed", reason })),
    ];

    for (const state of states) {
      const saved = Schema.decodeUnknownSync(machine.model)(state);
      const encoded = Schema.encodeSync(machine.model)(saved);
      const back = Schema.decodeUnknownSync(machine.model)(JSON.parse(JSON.stringify(encoded)));
      const [restored] = machine.init(back, { cloud: true, binding: binding() });
      expect(restored).toEqual(saved);
      const message = { type: "tick" as const, now: EPOCH + flow.time };
      expect(applyCell(machine, restored, message)).toEqual(applyCell(machine, saved, message));
    }
  },
);

// Plants after build: enter in on checked alone; on issued alone; or on a timer.
it("P36.10 no generated Msg makes RecoveryEmail in without an appended added", () => {
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

pureLaw("P36.10 local setup keeps the sheet path and offers no email action", RecoveryFlow, email, (flow) => {
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
  "P36.26 P28 parent steps email and asks about the old device before PersonCheck",
  { flow: RecoveryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
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
it("0138 every generated message on the live-device notice yields no Cmd", () => {
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
