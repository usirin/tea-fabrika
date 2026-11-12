// T878, next/, L4 and L6. Every cell chooses from the real pending work in the folded prefix.
// After build plants: drop selection/request matching; enter ready on answer; treat a failure as saved.
import { applyCell } from "@demlik/tea";
import { propertyInvariant } from "@demlik/tea/pbt";
import { expect, it } from "@effect/vitest";
import type { Schema } from "effect";
import { Arbitrary, Effect } from "effect";
import * as fc from "fast-check";
import { InputId } from "../../Id.ts";
import { Event, TrustDecision } from "../RepositoryTrust.ts";
import * as Open from "./open.ts";

type Model = typeof Open.machine.model.Type;
type Msg = typeof Open.machine.msg.Type;
type Phase = "closed" | "checking" | "history" | "awaiting_trust" | "saving" | "ready" | "refused";

const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0]!);

const ids = generated(InputId);

const tape = fc.record({
  selections: fc.uniqueArray(ids, { minLength: 3, maxLength: 6 }),
  answers: fc.uniqueArray(ids, { minLength: 3, maxLength: 6 }),
  snapshots: fc.array(generated(Open.CheckedSelection), { minLength: 3, maxLength: 6 }),
  receipts: fc.array(generated(Open.Receipt), { minLength: 3, maxLength: 6 }),
  failures: fc.array(generated(Open.Refusal), { minLength: 1, maxLength: 3 }),
  cells: fc.array(fc.record({ move: fc.nat(), pick: fc.nat(), yes: fc.boolean() }), { minLength: 10, maxLength: 60 }),
});

it("L4/L6: saved history replays through the machine, with a matching new save required for accepted trust", () => {
  fc.assert(
    fc.property(tape, fc.uniqueArray(ids, { minLength: 63, maxLength: 63 }), (draw, requests) => {
      let model: Model = Open.machine.init(null, undefined)[0];
      const snapshot = draw.snapshots[0]!;
      const events: Array<Event> = [];
      const selected: Array<typeof Event.cases.selected.Type> = [];
      const messages: Array<Msg> = [];
      let decision: typeof TrustDecision.Type | undefined;
      let writes = 0;
      const send = (msg: Msg) => {
        messages.push(msg);
        model = applyCell(Open.machine, model, msg)[0];
        return model;
      };
      const select = (pick: number) => {
        const past = draw.snapshots[pick % draw.snapshots.length]!;
        const event = Event.cases.selected.make({
          repository: snapshot.repository,
          key: snapshot.key,
          label: past.label,
          branch: past.branch,
          commit: past.commit,
          hash: past.hash,
          present: past.present,
          settings: past.settings,
          request: draw.selections[selected.length]!,
        });
        selected.push(event);
        events.push(event);
        return event;
      };
      const answer = (past: typeof Event.cases.selected.Type, yes: boolean) => {
        decision = yes ? TrustDecision.cases.accepted.make({}) : TrustDecision.cases.denied.make({});
        events.push(
          Event.cases.decision.make({
            repository: past.repository,
            key: past.key,
            commit: past.commit,
            hash: past.hash,
            selection: past.request,
            request: requests[writes++]!,
            decision,
            actor: snapshot.person,
            method: "terminal",
          }),
        );
      };
      const replay = (pick: number) => {
        const selection = draw.selections[pick % draw.selections.length]!;
        send({ type: "select", selection });
        expect(model._tag).toBe("checking");
        send({ type: "checked", selection, snapshot });
        expect(model._tag).toBe("checking");
        const result = send({ type: "history", selection, events: [...events] });
        expect(result._tag).toBe(
          decision?._tag === "accepted" ? "saving" : decision?._tag === "denied" ? "refused" : "awaiting_trust",
        );

        if (result._tag === "saving") {
          expect(result.snapshot).toEqual(snapshot);
          expect(result.request).toBe(selection);
          const other = draw.selections.find((id) => id !== selection)!;
          const receipt = draw.receipts[pick % draw.receipts.length]!;
          expect(send({ type: "saved", selection: other, request: selection, receipt })).toEqual(result);
          expect(send({ type: "saved", selection, request: other, receipt })).toEqual(result);
          const ready = send({ type: "saved", selection, request: selection, receipt });
          expect(ready._tag).toBe("ready");

          if (ready._tag === "ready") {
            expect(ready.snapshot).toEqual(snapshot);
            expect(ready.receipt).toEqual(receipt);
          }
        } else if (result._tag === "refused") {
          expect(result.reason).toBe("denied");
        }

        send({ type: "close" });
        expect(model._tag).toBe("closed");
      };

      replay(0);

      for (const cell of draw.cells) {
        const moves = selected.length === 0 ? ["select"] : ["answer", "opened"];

        if (selected.length > 0 && selected.length < draw.selections.length) {
          moves.push("select");
        }

        const move = moves[cell.move % moves.length];

        if (move === "select") {
          select(cell.pick);
        } else {
          const past = selected[cell.pick % selected.length]!;

          if (move === "answer") {
            answer(past, cell.yes);
          } else {
            events.push(
              Event.cases.opened.make({
                repository: past.repository,
                key: past.key,
                commit: past.commit,
                hash: past.hash,
                selection: past.request,
                request: requests[writes++]!,
                settings: past.settings,
                result: cell.yes ? "ready" : "refused",
              }),
            );
          }
        }

        replay(cell.pick);
      }

      const past = selected[0]!;
      answer(past, true);
      replay(0);
      answer(past, false);
      replay(1);
      answer(past, true);
      replay(2);
      propertyInvariant(
        Open.machine,
        undefined,
        fc.constant(messages),
        ({ prev, next, msg }) =>
          next._tag !== "ready" || prev._tag === "ready" || (prev._tag === "saving" && msg.type === "saved"),
        { seed: 119120, numRuns: 1 },
      );
    }),
    { seed: 119120, numRuns: 300 },
  );
});

it("L4/L6: only the active selection's acknowledged acceptance reaches ready; every prefix rejects stale work", () => {
  fc.assert(
    fc.property(tape, (draw) => {
      let model: Model = Open.machine.init(null, undefined)[0];
      let phase: Phase = "closed";
      let selection = draw.selections[0]!;
      let request = draw.answers[0]!;
      let snapshot = draw.snapshots[0]!;
      let accepted = false;
      const old: Array<Msg> = [];
      const messages: Array<Msg> = [];
      const send = (msg: Msg, expected: Phase) => {
        const [next] = applyCell(Open.machine, model, msg);
        messages.push(msg);
        expect(next._tag).toBe(expected === "history" ? "checking" : expected);

        if (next._tag !== "closed") {
          expect(next.selection).toBe(selection);
        }

        if (next._tag === "ready") {
          expect(accepted).toBe(true);
          expect(msg.type === "saved" || model._tag === "ready").toBe(true);
          expect(next.snapshot).toEqual(snapshot);
        }

        model = next;
        phase = expected;
      };
      const select = (pick: number) => {
        if (model._tag !== "closed") {
          old.push({ type: "checked", selection, snapshot });
          old.push({ type: "history", selection, events: [] });
          old.push({ type: "saved", selection, request, receipt: draw.receipts[pick % draw.receipts.length]! });
          old.push({ type: "failed", selection, request, reason: draw.failures[pick % draw.failures.length]! });
        }

        const alternatives = draw.selections.filter((id) => id !== selection);
        selection = alternatives[pick % alternatives.length]!;
        snapshot = draw.snapshots[pick % draw.snapshots.length]!;
        accepted = false;
        send({ type: "select", selection }, "checking");
      };
      const advance = (pick: number, yes: boolean) => {
        if (phase === "closed" || phase === "ready" || phase === "refused") {
          select(pick);
        } else if (phase === "checking") {
          send({ type: "checked", selection, snapshot }, "history");
        } else if (phase === "history") {
          send({ type: "history", selection, events: [] }, "awaiting_trust");
        } else if (phase === "awaiting_trust") {
          request = draw.answers[pick % draw.answers.length]!;
          accepted = yes;
          send(
            {
              type: "answer",
              selection,
              request,
              decision: yes ? TrustDecision.cases.accepted.make({}) : TrustDecision.cases.denied.make({}),
            },
            "saving",
          );
        } else {
          send(
            { type: "saved", selection, request, receipt: draw.receipts[pick % draw.receipts.length]! },
            accepted ? "ready" : "refused",
          );
        }
      };

      for (const cell of draw.cells) {
        const moves = ["advance", "replace", "close"];

        if (old.some((msg) => "selection" in msg && msg.selection !== selection)) {
          moves.push("late");
        }

        if (phase === "saving") {
          moves.push("failed", "wrong-request", "duplicate-answer");
        }

        if (phase === "awaiting_trust") {
          moves.push("early-ack");
        }

        const move = moves[cell.move % moves.length];

        if (move === "advance") {
          advance(cell.pick, cell.yes);
        } else if (move === "replace") {
          select(cell.pick);
        } else if (move === "close") {
          send({ type: "close" }, "closed");
        } else if (move === "late") {
          const late = old.filter((msg) => "selection" in msg && msg.selection !== selection);
          const before = model;
          send(late[cell.pick % late.length]!, phase);
          expect(model).toEqual(before);
        } else if (move === "failed") {
          send(
            { type: "failed", selection, request, reason: draw.failures[cell.pick % draw.failures.length]! },
            "refused",
          );
        } else if (move === "wrong-request") {
          const other = draw.answers.find((id) => id !== request)!;
          const before = model;
          send(
            { type: "saved", selection, request: other, receipt: draw.receipts[cell.pick % draw.receipts.length]! },
            phase,
          );
          expect(model).toEqual(before);
        } else if (move === "duplicate-answer") {
          const before = model;
          send(
            {
              type: "answer",
              selection,
              request,
              decision: accepted ? TrustDecision.cases.accepted.make({}) : TrustDecision.cases.denied.make({}),
            },
            phase,
          );
          expect(model).toEqual(before);
        } else {
          const before = model;
          send({ type: "saved", selection, request, receipt: draw.receipts[cell.pick % draw.receipts.length]! }, phase);
          expect(model).toEqual(before);
        }
      }

      // Require the named transitions in every run, rather than a safety-only walk that never opens.
      select(draw.cells[0]!.pick);

      for (let n = 0; n < 4; n++) {
        advance(n, true);
      }

      expect(model._tag).toBe("ready");
      const receipt = model;
      send({ type: "saved", selection, request, receipt: draw.receipts[0]! }, "ready");
      expect(model).toEqual(receipt);
      select(draw.cells[0]!.pick);

      for (let n = 0; n < 4; n++) {
        advance(n, false);
      }

      expect(model._tag).toBe("refused");
      // tea's own runner checks the same list from the actual init as well.
      propertyInvariant(
        Open.machine,
        undefined,
        fc.constant(messages),
        ({ prev, next, msg }) =>
          next._tag !== "ready" || prev._tag === "ready" || (prev._tag === "saving" && msg.type === "saved"),
        { seed: 119120, numRuns: 1 },
      );
    }),
    { seed: 119120, numRuns: 1000 },
  );
});
