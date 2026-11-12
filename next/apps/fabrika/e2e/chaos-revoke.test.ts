// next/, P17b p90. Lead runs this on the host with the final-admission plant.
// workerd cannot run in a step box. Ticket 866 may stop the second checklist input;
// this scenario intentionally keeps that input and does not substitute a Node checklist.
import { Outcome } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { chaos } from "@kampus/chaos";
import { Chaos, type Handler } from "@kampus/libfabrika";
import { grantText, revokeText } from "@kampus/libfabrika/access/Text";
import { Ledger, type LedgerCalls } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerRemote from "@kampus/libfabrika/ledger/LedgerRemote";
import * as ChaosTest from "@kampus/libfabrika/node/Chaos.test-support";
import * as ProcessHistoryLedger from "@kampus/libfabrika/processes/ProcessHistoryLedger";
import * as ChaosSchedule from "@kampus/libfabrika/runtime/ChaosSchedule";
import { Nemesis } from "@kampus/libfabrika/runtime/Nemesis";
import * as NemesisLedger from "@kampus/libfabrika/runtime/NemesisLedger";
import { Clock, Effect, Layer, Schema, Stream } from "effect";
import * as RevokeTest from "./chaos-revoke.test-support.ts";

const NAME = "chaos:revoke";
const TARGET = "checklist:1";
const SEED = 119120;

it.live(
  "scenario: p90 signed revoke over real WebSocket, gateway, Alchemy and workerd rejects an ignored-close client while another client writes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* RevokeTest.served;
        const { instance, old: oldKey, other: otherKey, root, pid } = fixture;
        const project = instance.project(RevokeTest.PROJECT);
        // The private Alchemy binding already implements the project's public ledger-call protocol.
        const ledger = LedgerRemote.layer(project as LedgerCalls, { reader: "p17b-revoke-audit" });
        const rows = (stream: string) =>
          Ledger.use((service) => Stream.runCollect(service.read(stream, 0))).pipe(Effect.provide(ledger));
        const old = yield* RevokeTest.connect(instance.url, oldKey, "old");
        expect(old.first.error).toBeUndefined();
        const grant = grantText({
          id: "grant-other",
          key: otherKey.raw,
          for: RevokeTest.PERSON,
          to: RevokeTest.PROJECT,
          as: "window",
          sentAt: RevokeTest.SENT,
          saw: {
            code: "123456",
            label: "Other test client",
            location: "local",
            method: "command",
            check: "none",
            has: [],
          },
        });
        expect(
          yield* RevokeTest.invoke(project, "grant", [{ text: grant, armored: yield* root.proof(grant) }]),
        ).toMatchObject({ _tag: "applied" });
        const other = yield* RevokeTest.connect(instance.url, otherKey, "other");
        expect(other.first.error).toBeUndefined();
        const input = (letter: string, name: string) => ({
          pid,
          letter,
          m: { type: "add", name },
          sentAt: RevokeTest.SENT,
          seen: 0,
        });
        const before = yield* old.call("process.send", input("old-before", "before"));
        expect(before.error).toBeUndefined();
        expect(before.result).toMatchObject({ _tag: "accepted" });
        const delayed = old.delayed("process.send", input("old-delayed", "must-not-land"));
        const binding = Chaos.Target.make({
          program: "fabrika/checklist",
          name: TARGET,
          process: pid,
          client: oldKey.fingerprint,
          key: oldKey.raw,
        });
        const id = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000017");
        const start = Chaos.Start.make({ id, seed: SEED, target: binding, most: 64, gap: 1000 });
        let schedule = ChaosSchedule.seed(start.seed);
        let most = 0;

        // Select the cap from the actual saved schedule, without replacing any selected fault.
        while (most < start.most) {
          const draw = ChaosSchedule.draw(schedule, start);
          schedule = draw.schedule;
          most++;

          if (draw.fault._tag === "revoke_key") {
            break;
          }
        }

        expect(most).toBeLessThan(start.most);
        const world = yield* ChaosTest.open;
        const fire: Handler<never> = (raw) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(Schema.toType(Chaos.Fire))(raw);

            if (request.fault._tag !== "revoke_key") {
              return Outcome.ok(Chaos.Fired.cases.refused.make({ reason: "off" }));
            }

            expect(request.target).toEqual(binding);
            expect(request.fault.key).toBe(oldKey.raw);
            const model = yield* world.snapshot(NAME);
            const saved = Schema.decodeUnknownSync(chaos.state.schema)(model.model);
            expect(saved.phase._tag).toBe("checking");

            if (saved.phase._tag !== "checking") {
              return yield* Effect.die(new Error("the revoke was not saved before firing"));
            }

            expect(saved.phase.experiment.asked.at(-1)).toMatchObject({
              ordinal: request.ordinal,
              fault: request.fault,
            });
            const text = revokeText({
              id: `revoke-${request.id}-${request.ordinal}`,
              key: request.fault.key,
              for: RevokeTest.PERSON,
              to: RevokeTest.PROJECT,
              sentAt: RevokeTest.SENT,
              saw: { label: "Old test client", location: "local", method: "command", check: "none" },
            });
            expect(
              yield* RevokeTest.invoke(project, "grant", [{ text, armored: yield* root.proof(text) }]),
            ).toMatchObject({ _tag: "applied" });
            return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
          });
        const nemesis = NemesisLedger.layer(() => Effect.die("only the host fire handler revokes")).pipe(
          Layer.provide(ProcessHistoryLedger.layer),
          Layer.provide(ledger),
        );
        const handlers: Readonly<Record<string, Handler<never>>> = {
          now: () => Clock.currentTimeMillis.pipe(Effect.map(Outcome.ok)),
          fire,
          inspect: () =>
            Nemesis.use((service) => service.check(binding)).pipe(Effect.provide(nemesis), Effect.map(Outcome.ok)),
        };
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
            expect((yield* runner.msg(world.letter(1, { type: "start", ...start, most })))._tag).toBe("accepted");

            for (let n = 0; n < most; n++) {
              const saved = Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model);
              const deadline = chaos.wake(saved);

              if (deadline === null) {
                return yield* Effect.die(new Error("the revoke experiment lost its timer"));
              }

              yield* runner.due(deadline);
            }
          }),
        );
        const final = Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model);
        expect(final.phase._tag).toBe("done");
        const revoked = (yield* rows("gateway/access")).find((row) => row._tag === "revoked");
        expect(revoked).toBeDefined();

        if (revoked === undefined) {
          return yield* Effect.die(new Error("signed revoke is absent from real history"));
        }

        yield* delayed;
        const late = yield* old
          .call("process.send", input("old-ignored-close", "also-must-not-land"))
          .pipe(Effect.exit);

        if (late._tag === "Success") {
          expect(late.value.result).not.toMatchObject({ _tag: "accepted" });
          expect(late.value.error).toBeDefined();
        }

        expect(old.closes.length).toBeGreaterThan(0);
        const fresh = yield* RevokeTest.connect(instance.url, oldKey, "fresh-old-key");
        expect(fresh.first.error).toMatchObject({ data: { reason: "not_granted" } });
        const live = yield* other.call("process.send", input("other-after", "other-still-works"));
        expect(live.error).toBeUndefined();
        expect(live.result).toMatchObject({ _tag: "accepted" });
        const inbox = yield* RevokeTest.until(rows(`${TARGET}/inbox`), (entries) =>
          entries.some((entry) => entry.id === "other-after"),
        );
        expect(inbox.filter((row) => row._tag === "send").map((row) => row.id)).toEqual(["old-before", "other-after"]);
        const surviving = inbox.find((row) => row.id === "other-after");
        expect(surviving?.rev).toBeGreaterThan(revoked.rev);
        expect(surviving?.arrivedAt).toBeGreaterThanOrEqual(revoked.arrivedAt);
        const gateway = yield* rows("gateway/inputs");
        const process = yield* rows(pid);
        const after = [...gateway, ...inbox, ...process].filter((row) => row.rev > revoked.rev);
        expect(after.filter((row) => row.by === oldKey.fingerprint)).toEqual([]);
        const oldInputs = new Set(gateway.filter((row) => row.by === oldKey.fingerprint).map((row) => row.id));
        expect(after.filter((row) => row.parent !== null && oldInputs.has(row.parent))).toEqual([]);
        expect(inbox.find((row) => row.id === "old-before")?.rev).toBeLessThan(revoked.rev);
        const viewed = yield* other.call("view.open", { pid });
        expect(viewed.error).toBeUndefined();
        expect(viewed.result).toMatchObject({
          view: {
            items: expect.arrayContaining([{ name: "other-still-works", state: expect.any(String), note: null }]),
          },
        });
        // Reopening the host runner must not submit a second signed revoke.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
            yield* runner.open("reopen");
            yield* runner.due(Number.MAX_SAFE_INTEGER);
            expect(Schema.decodeUnknownSync(chaos.state.schema)((yield* world.snapshot(NAME)).model)).toEqual(final);
          }),
        );
        expect((yield* rows("gateway/access")).filter((row) => row._tag === "revoked")).toHaveLength(1);
        // Compact reproducible facts only. Signing keys, proofs and item text never enter this record.
        yield* Effect.logInfo("p17b-revoke", {
          seed: SEED,
          build: fixture.built,
          most,
          expected: ["old-before", "other-after"],
          revoke: revoked.rev,
          verdict: "passed",
        });
      }),
    ),
  { timeout: 120_000 },
);
