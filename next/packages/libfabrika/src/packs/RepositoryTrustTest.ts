// T878, next/, L5/L6. Shared laws take a scoped real SQL driver (0062).
// No second trust reducer lives here: the opening machine consumes these saved events.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Exit, Layer, Schema, type Scope, Stream } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { Appended, Entry as EntrySchema, type Entry, type Line } from "../ledger/Log.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as LoadSnapshot from "../settings/Snapshot.ts";
import * as Sources from "../settings/Sources.ts";
import type { Sql } from "../Sql.ts";
import * as Open from "./Open.ts";
import { Event, RepositoryTrust, TrustDecision } from "./RepositoryTrust.ts";
import * as RepositoryTrustLedger from "./RepositoryTrustLedger.ts";

export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

// Effect 4 owns schema generation; fast-check chooses its seed and the operation tape.
const generated = <S extends Schema.ConstraintDecoder<unknown>>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => {
    return Schema.decodeUnknownSync(schema)(
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's generator is synchronous
      Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0],
    );
  });

const input = generated(Id.InputId);
const repository = generated(Id.make("repository"));
const person = generated(Id.make("person"));
const trace = fc.stringMatching(/^[1-9a-f][0-9a-f]{31}$/);
const digest = fc.stringMatching(/^[0-9a-f]{64}$/);
const tape = fc.array(fc.record({ move: fc.nat(), pick: fc.nat() }), { minLength: 1, maxLength: 12 });

const settings = Effect.gen(function* () {
  const empty = { value: {}, spans: [] };
  const resolved = yield* Sources.resolve(Declarations.all, {
    flags: Sources.flags({}),
    env: Sources.env({}),
    repo: Sources.file(".fabrika/fabrika.toml", empty),
    person: Sources.file("~/.fabrika/fabrika.toml", empty),
  });
  return yield* LoadSnapshot.make(Declarations.all, resolved);
});

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  const run = <A, E2, R2>(
    body: (store: Store, trust: RepositoryTrust["Service"], ledger: Ledger["Service"]) => Effect.Effect<A, E2, R2>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* open;
        const context = yield* Layer.build(
          RepositoryTrustLedger.layer.pipe(
            Layer.provideMerge(LedgerSql.layer(store.sql, { reader: "brain" })),
            Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
          ),
        );
        return yield* body(store, Context.get(context, RepositoryTrust), Context.get(context, Ledger));
      }),
    );

  describe("T878 repository trust history", () => {
    it.effect("L5: reopening preserves exact location/person consent; another clone or destination gets none", () =>
      Effect.gen(function* () {
        const property = fc.asyncProperty(
          repository,
          person,
          input,
          input,
          digest,
          trace,
          tape,
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check requires an asynchronous property callback
          async (repoId, operator, selection, request, key, traceId, cells) => {
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each real store operation
            return Effect.runPromise(
              run((store, trust) =>
                Effect.gen(function* () {
                  const snapshot = yield* settings;
                  const recorded = {
                    by: "brain",
                    for: operator,
                    sentAt: "2026-11-12T00:00:00.000Z",
                    seen: 0,
                    parent: null,
                    traceId,
                    build: "fixture-build",
                  };
                  const selected = Event.cases.selected.make({
                    repository: repoId,
                    key,
                    label: "same-basename",
                    branch: "release",
                    commit: "a".repeat(40),
                    hash: "b".repeat(64),
                    present: true,
                    settings: snapshot,
                    request: selection,
                  });
                  const first = yield* trust.write(selected, recorded);
                  const accepted = Event.cases.decision.make({
                    repository: repoId,
                    key,
                    selection,
                    request,
                    commit: selected.commit,
                    hash: selected.hash,
                    decision: TrustDecision.cases.accepted.make({}),
                    actor: operator,
                    method: "terminal",
                  });
                  yield* trust.write(accepted, { ...recorded, seen: first.rev, parent: selection });

                  for (const cell of cells) {
                    yield* store.reopen;
                    const same = yield* trust.history(key, operator);
                    expect(same).toContainEqual(selected);
                    expect(same).toContainEqual(accepted);
                    // Fingerprints distinguish another clone and a changed destination, even with the same safe label.
                    const otherKey = `${cell.move % 2 === 0 ? "c" : "d"}${key.slice(1)}`;
                    const distinct =
                      otherKey === key ? `${key.slice(0, -1)}${key.endsWith("0") ? "1" : "0"}` : otherKey;
                    const otherLocation = yield* trust.history(distinct, operator);
                    expect(otherLocation).toEqual([]);
                    const otherPerson = Schema.decodeUnknownSync(Id.make("person"))(
                      `${operator.slice(0, -1)}${operator.endsWith("0") ? "1" : "0"}`,
                    );
                    const otherIdentity = yield* trust.history(key, otherPerson);
                    expect(otherIdentity).toEqual([]);
                    // New commits do not change the lookup identity or rewrite the answered commit.
                    expect(same.filter((event) => event._tag === "decision")).toEqual([accepted]);
                    const reopened = Schema.decodeUnknownSync(Id.InputId)(
                      `${selection.slice(0, -1)}${selection.endsWith("0") ? "1" : "0"}`,
                    );

                    for (const candidate of [
                      { key, person: operator, events: same, known: true },
                      { key: distinct, person: operator, events: otherLocation, known: false },
                      { key, person: otherPerson, events: otherIdentity, known: false },
                    ]) {
                      const session = yield* Open.session();
                      yield* session.send({ type: "select", selection: reopened });
                      yield* session.send({
                        type: "checked",
                        selection: reopened,
                        snapshot: {
                          repository: repoId,
                          label: selected.label,
                          branch: selected.branch,
                          hash: selected.hash,
                          present: selected.present,
                          settings: snapshot,
                          key: candidate.key,
                          person: candidate.person,
                          commit: (cell.pick % 2 === 0 ? "c" : "d").repeat(40),
                        },
                      });
                      const state = yield* session.send({
                        type: "history",
                        selection: reopened,
                        events: candidate.events,
                      });
                      expect(state._tag).toBe(candidate.known ? "saving" : "awaiting_trust");

                      if (state._tag === "saving") {
                        const ready = yield* session.send({
                          type: "saved",
                          selection: reopened,
                          request: reopened,
                          receipt: first,
                        });
                        expect(ready._tag).toBe("ready");
                      }
                    }
                  }
                }),
              ).pipe(Effect.provide(Digest.layerWebCrypto)),
            );
          },
        );
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's runner returns a Promise
        const check = async () => fc.assert(property, { seed: 119120, numRuns: 300 });
        // oxlint-disable-next-line fabrika/no-promises -- edge: await fast-check within the scoped test
        yield* Effect.tryPromise({ try: check, catch: (cause: unknown) => new Error("trust law failed", { cause }) });
      }),
    );

    it.effect(
      "L6: retry and lost acknowledgment keep one decision/opening, and preserve stored parents and trace",
      () =>
        Effect.gen(function* () {
          const property = fc.asyncProperty(
            repository,
            person,
            input,
            input,
            input,
            digest,
            trace,
            tape,
            // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check requires an asynchronous property callback
            async (repoId, operator, selection, answer, opening, key, traceId, cells) => {
              // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each real store operation
              return Effect.runPromise(
                run((store, trust, ledger) =>
                  Effect.gen(function* () {
                    const snapshot = yield* settings;
                    const recorded = {
                      by: "brain",
                      for: operator,
                      sentAt: "2026-11-12T00:00:00.000Z",
                      seen: 0,
                      parent: null,
                      traceId,
                      build: "fixture-build",
                    };
                    const selected = Event.cases.selected.make({
                      repository: repoId,
                      key,
                      label: "repo",
                      branch: "release",
                      commit: "a".repeat(40),
                      hash: "b".repeat(64),
                      present: true,
                      settings: snapshot,
                      request: selection,
                    });
                    const receipt = yield* trust.write(selected, recorded);
                    const envelope = { ...recorded, seen: receipt.rev, parent: selection };
                    const decision = Event.cases.decision.make({
                      repository: repoId,
                      key,
                      selection,
                      request: answer,
                      commit: selected.commit,
                      hash: selected.hash,
                      decision: TrustDecision.cases.accepted.make({}),
                      actor: operator,
                      method: "terminal",
                    });
                    const opened = Event.cases.opened.make({
                      repository: repoId,
                      key,
                      selection,
                      request: opening,
                      commit: selected.commit,
                      hash: selected.hash,
                      settings: snapshot,
                      result: "ready",
                    });
                    const decisions = yield* trust.write(decision, envelope);
                    const openings = yield* trust.write(opened, envelope);

                    for (const cell of cells) {
                      const event = cell.pick % 2 === 0 ? decision : opened;
                      const saved = yield* trust.write(event, envelope);
                      expect(saved).toEqual(cell.pick % 2 === 0 ? decisions : openings);

                      if (cell.move % 2 === 0) {
                        yield* store.reopen;
                      }

                      const history = yield* trust.history(key, operator);
                      expect(history.filter((fact) => fact._tag === "decision")).toEqual([decision]);
                      expect(history.filter((fact) => fact._tag === "opened")).toEqual([opened]);
                    }

                    // The adapter's actual writes, observed before the real ledger sees them.
                    const lines: Array<{ stream: string; id: string; line: Line }> = [];
                    const captured = {
                      ...ledger,
                      append: (stream: string, id: string, line: Line) => {
                        lines.push({ stream, id, line });
                        return ledger.append(stream, id, line);
                      },
                    };
                    const service = yield* RepositoryTrust.pipe(
                      Effect.provide(RepositoryTrustLedger.layer),
                      Effect.provideService(Ledger, captured),
                    );
                    yield* service.write(selected, recorded);
                    yield* service.write(decision, envelope);
                    yield* service.write(opened, envelope);
                    expect(lines).toHaveLength(3);
                    expect(lines[0]?.line.parent).toBeNull();

                    for (const row of lines.slice(1)) {
                      expect(row.line.parent).toBe(selection);
                      expect(row.line.traceId).toBe(traceId);
                      expect(row.line.for).toBe(operator);
                    }
                  }),
                ).pipe(Effect.provide(Digest.layerWebCrypto)),
              );
            },
          );
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's runner returns a Promise
          const check = async () => fc.assert(property, { seed: 119120, numRuns: 300 });
          // oxlint-disable-next-line fabrika/no-promises -- edge: await fast-check within the scoped test
          yield* Effect.tryPromise({ try: check, catch: (cause: unknown) => new Error("trust law failed", { cause }) });
        }),
    );

    it.effect("L6: failed/refused writes and corrupt known history fail explicitly", () =>
      Effect.gen(function* () {
        const property = fc.asyncProperty(
          repository,
          person,
          input,
          digest,
          trace,
          tape,
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check requires an asynchronous property callback
          async (repoId, operator, selection, key, traceId, cells) => {
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each real store operation
            return Effect.runPromise(
              run((_store, trust, ledger) =>
                Effect.gen(function* () {
                  const snapshot = yield* settings;
                  const selected = Event.cases.selected.make({
                    repository: repoId,
                    key,
                    label: "repo",
                    branch: "release",
                    commit: "a".repeat(40),
                    hash: "b".repeat(64),
                    present: true,
                    settings: snapshot,
                    request: selection,
                  });
                  const event = Event.cases.decision.make({
                    repository: repoId,
                    key,
                    selection,
                    request: selection,
                    commit: "a".repeat(40),
                    hash: "b".repeat(64),
                    decision: TrustDecision.cases.accepted.make({}),
                    actor: operator,
                    method: "terminal",
                  });
                  const recorded = {
                    by: "brain",
                    for: operator,
                    sentAt: "2026-11-12T00:00:00.000Z",
                    seen: 0,
                    parent: selection,
                    traceId,
                    build: "fixture-build",
                  };
                  const receipt = yield* trust.write(selected, { ...recorded, parent: null });

                  for (const cell of cells) {
                    let appends = 0;
                    const broken = {
                      ...ledger,
                      append: () => {
                        appends++;
                        return cell.move % 2 === 0
                          ? Effect.fail(new LedgerError({ reason: "storage" }))
                          : Effect.succeed(Appended.cases.refused.make({ reason: "bad_parent" }));
                      },
                    };
                    const failed = yield* RepositoryTrust.pipe(
                      Effect.provide(RepositoryTrustLedger.layer),
                      Effect.provideService(Ledger, broken),
                    );
                    const result = yield* failed.write(event, { ...recorded, seen: receipt.rev }).pipe(Effect.exit);
                    expect(appends).toBe(1);
                    expect(Exit.isFailure(result)).toBe(true);

                    if (Exit.isFailure(result)) {
                      const failure = result.cause.reasons.find((reason) => reason._tag === "Fail");
                      expect(failure?._tag).toBe("Fail");

                      if (failure?._tag === "Fail") {
                        expect(failure.error.reason._tag).toBe("Storage");
                      }
                    }

                    const corrupt: Entry = Schema.decodeUnknownSync(EntrySchema)({
                      id: selection,
                      stream: "fixture",
                      pos: 1,
                      rev: 1,
                      arrivedAt: 1,
                      ...recorded,
                      ...Schema.encodeSync(Event)(event),
                      body: { repository: repoId, key, request: selection, decision: cell.pick },
                    });
                    const bad = { ...ledger, read: () => Stream.make(corrupt) };
                    const reader = yield* RepositoryTrust.pipe(
                      Effect.provide(RepositoryTrustLedger.layer),
                      Effect.provideService(Ledger, bad),
                    );
                    expect(Exit.isFailure(yield* reader.history(key, operator).pipe(Effect.exit))).toBe(true);
                  }
                }),
              ).pipe(Effect.provide(Digest.layerWebCrypto)),
            );
          },
        );
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's runner returns a Promise
        const check = async () => fc.assert(property, { seed: 119120, numRuns: 300 });
        // oxlint-disable-next-line fabrika/no-promises -- edge: await fast-check within the scoped test
        yield* Effect.tryPromise({ try: check, catch: (cause: unknown) => new Error("trust law failed", { cause }) });
      }),
    );
  });
};
