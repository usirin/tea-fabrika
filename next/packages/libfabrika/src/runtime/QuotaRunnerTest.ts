// P34c, next/. Node and live-object fixtures supply real runners and real stores to these laws.
// The fixture may supply transport and an archive double. It must not implement quota decisions.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import { Appended } from "../coordination/index.ts";
import { Supervision } from "./internal/supervisor.ts";
import { Checkpoint } from "./ProcessStore.ts";
import type { ProgramRunner } from "./Runner.ts";

export interface Limits {
  readonly writes: number;
  readonly storage: number;
  readonly recovery: {
    readonly project: {
      readonly writes: number;
      readonly bytes: number;
      readonly letter: { readonly writes: number; readonly bytes: number };
    };
    readonly process: {
      readonly writes: number;
      readonly bytes: number;
      readonly letter: { readonly writes: number; readonly bytes: number };
    };
  };
}

export const defaults: Limits = {
  writes: 13_760,
  storage: 1_000_000_000,
  recovery: {
    project: { writes: 160, bytes: 74_080, letter: { writes: 10, bytes: 5_469 } },
    process: { writes: 290, bytes: 207_410, letter: { writes: 50, bytes: 18_790 } },
  },
};

export interface Use {
  readonly writes: number;
  readonly bytes: number;
  readonly ahead: { readonly writes: number; readonly bytes: number };
}

export interface Local {
  readonly program: { readonly writes: number; readonly bytes: number };
  readonly recovery: {
    readonly writes: number;
    readonly bytes: number;
    readonly total: { readonly writes: number; readonly bytes: number };
  };
  readonly fault: unknown;
}

export interface World {
  readonly runner: (name: string) => Effect.Effect<ProgramRunner["Service"]>;
  readonly input: (name: string, id: string, m: unknown) => Effect.Effect<unknown, unknown>;
  readonly program: (name: string) => Effect.Effect<Use, unknown>;
  readonly local: (name: string) => Effect.Effect<Local, unknown>;
  readonly projectRecovery: (name: string) => Effect.Effect<Local["recovery"], unknown>;
  readonly replace: (name: string, saved: Checkpoint) => Effect.Effect<void, unknown>;
  readonly checkpoint: (name: string) => Effect.Effect<unknown, unknown>;
  readonly journal: (name: string) => Effect.Effect<unknown, unknown>;
  readonly entries: Effect.Effect<ReadonlyArray<Readonly<Record<string, unknown>>>, unknown>;
  readonly snapshot: Effect.Effect<unknown, unknown>;
  readonly reopen: Effect.Effect<void>;
  readonly cut: (boundary: number | null) => void;
  readonly limits: (next: Limits) => void;
  readonly restart: (name: string, id: string, person: boolean) => Effect.Effect<unknown, unknown>;
  readonly drain: (name: string) => Effect.Effect<void, unknown>;
}

export const supervision = Supervision;

const required = <A>(value: A | undefined): A => Option.getOrThrow(Option.fromUndefinedOr(value));

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }));
const Cell = Schema.Struct({ pick: Nat, amount: Nat, reopen: Schema.Boolean });
const Tape = Schema.Array(Cell).check(Schema.isMinLength(5), Schema.isMaxLength(25));
const options = { timeout: 600_000, arbitrary: { seed: 119120, runs: 40, size: 100 } };
const names = ["alpha:1", "alpha:2", "beta:1"];

const call = Effect.fnUntraced(function* (
  w: World,
  name: string,
  use: (runner: ProgramRunner["Service"]) => Effect.Effect<unknown, unknown>,
) {
  return yield* use(yield* w.runner(name));
});

export const suite = (open: (limits: Limits) => Effect.Effect<World, unknown, Scope.Scope>) =>
  describe("P34c runner quota laws", () => {
    it.effect.prop(
      "Q5 replacements, deletion of replaceable content and unchanged saves charge exact byte deltas",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(defaults);
            yield* w.input("alpha:1", "first", { type: "inc" });
            yield* w.drain("alpha:1");
            const encode = Schema.encodeSync(Schema.fromJsonString(Checkpoint));
            let previous = Schema.decodeUnknownSync(Checkpoint)(yield* w.checkpoint("alpha:1"));

            for (const c of tape) {
              const old = yield* w.local("alpha:1");
              const model = c.pick % 3 === 0 ? previous.saved.model : { payload: "😀é\n".repeat(c.amount % 120) };
              const next = { ...previous, saved: { ...previous.saved, model } };
              const delta =
                new TextEncoder().encode(encode(next)).length - new TextEncoder().encode(encode(previous)).length;
              yield* w.replace("alpha:1", next);
              const use = yield* w.local("alpha:1");
              expect(use.program.bytes - old.program.bytes).toBe(delta);
              expect(use.program.writes - old.program.writes).toBe(encode(next) === encode(previous) ? 0 : 1);
              expect(use.recovery).toEqual(old.recovery);
              yield* w.reopen;
              expect(yield* w.checkpoint("alpha:1")).toEqual(next);
              expect(yield* w.local("alpha:1")).toEqual(use);
              previous = next;
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q16 ordinary inputs, timers and command answers never spend recovery room",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const baseline = new Map<string, { project: Local["recovery"]; process: Local["recovery"] }>();

            for (const name of names) {
              yield* call(w, name, (r) => r.open("watcher"));
              baseline.set(name, { project: yield* w.projectRecovery(name), process: (yield* w.local(name)).recovery });
            }

            for (const [n, c] of tape.entries()) {
              const name = required(names[c.pick % names.length]);
              const m = required([{ type: "inc" }, { type: "work" }, { type: "schedule", at: 1001 + n }][c.amount % 3]);
              expect(yield* w.input(name, `healthy:${n}`, m)).toHaveProperty("_tag", "placed");
              yield* w.drain(name);
              yield* call(w, name, (r) => r.due(1001 + n));

              if (c.reopen) {
                yield* w.reopen;
              }

              for (const registered of names) {
                expect(yield* w.projectRecovery(registered)).toEqual(required(baseline.get(registered)).project);
                expect((yield* w.local(registered)).recovery).toEqual(required(baseline.get(registered)).process);
              }

              const state = yield* w.local(name);
              expect(state.program.writes).toBeGreaterThan(0);
              expect(state.fault).toBeNull();
            }

            // Refusal must occur before any step or any Process-local save.
            const used = yield* w.program("sample/alpha");
            w.limits({ ...defaults, writes: used.writes });
            const before = yield* w.snapshot;
            expect(yield* w.input("alpha:1", "never-admitted", { type: "inc" })).toEqual(
              Appended.cases.refused.make({ reason: "quota" }),
            );
            expect(yield* w.snapshot).toEqual(before);
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q17 an admitted letter settles its step once at the exact cap and after reopen",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open({ ...defaults, writes: 2 });

            for (const [n, c] of tape.entries()) {
              yield* TestClock.setTime(1_000 + n * 60_001);
              const name = required(names[c.pick % 2]);
              const before = yield* w.program("sample/alpha");
              expect(yield* w.input(name, `pair:${n}`, { type: "inc" })).toHaveProperty("_tag", "placed");
              const admitted = yield* w.program("sample/alpha");
              expect(admitted.writes).toBe(2);
              expect(admitted.ahead.writes).toBe(before.ahead.writes + 1);
              yield* w.reopen;
              yield* w.drain(name);
              const settled = yield* w.program("sample/alpha");
              expect(settled.writes).toBe(2);
              expect(settled.ahead.writes).toBe(before.ahead.writes);
              expect((yield* w.entries).filter((e) => e._tag === "stepped" && e.id === `step:pair:${n}`)).toHaveLength(
                1,
              );
              const saved = yield* w.snapshot;
              expect(yield* w.input(name, `refused:${n}`, { type: "inc" })).toEqual(
                Appended.cases.refused.make({ reason: "quota" }),
              );
              expect(yield* w.snapshot).toEqual(saved);
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q7 a full program still records failure, dead letter, signals, cleanup and successor checkpoint",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open({ ...defaults, writes: 2 });

            for (const [n, c] of tape.entries()) {
              yield* TestClock.setTime(1_000 + n * 60_001);
              const name = required(names[c.pick % 2]);
              expect(yield* w.input(name, `poison:${n}`, { type: "throw" })).toHaveProperty("_tag", "placed");
              const full = yield* w.program("sample/alpha");
              expect(full.writes).toBe(2);
              w.cut(c.amount % 8);
              yield* Effect.result(w.drain(name));
              w.cut(null);
              yield* w.reopen;
              yield* w.drain(name);
              expect((yield* w.program("sample/alpha")).writes).toBe(full.writes);
              expect((yield* w.local(name)).fault).toBeNull();
              expect((yield* w.local(name)).recovery.total.writes).toBeGreaterThan(0);
              expect((yield* w.projectRecovery(name)).total.writes).toBeGreaterThan(0);
              const entries = yield* w.entries;
              expect(entries.some((e) => e._tag === "exited")).toBe(true);
              expect(entries.some((e) => e._tag === "restarted")).toBe(true);
              expect(yield* w.checkpoint(name)).not.toBeNull();
              expect(yield* w.input("beta:1", `other:${n}`, { type: "inc" })).toHaveProperty("_tag", "placed");
              yield* w.drain("beta:1");
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q8 reserve exhaustion keeps saved work, faults durably, and only checked person restart resumes",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(defaults);
            expect(yield* w.input("alpha:1", "pending", { type: "throw" })).toHaveProperty("_tag", "placed");
            const old = yield* w.program("sample/alpha");
            const tight = { writes: 1, bytes: 1, letter: { writes: 50, bytes: 18_790 } };
            w.limits({ ...defaults, recovery: { project: tight, process: tight } });
            yield* Effect.result(w.drain("alpha:1"));
            const stopped = yield* w.local("alpha:1");
            expect(stopped.fault).toHaveProperty("_tag", "RecoveryReserveExhausted");
            const saved = yield* w.journal("alpha:1");
            const checkpoint = yield* w.checkpoint("alpha:1");
            const entries = yield* w.entries;

            for (const [n, c] of tape.entries()) {
              yield* TestClock.setTime(120_000 + n * 60_001);

              if (c.reopen) {
                yield* w.reopen;
              }

              yield* Effect.result(
                call(w, "alpha:1", (r) => (c.pick % 2 === 0 ? r.due(120_000 + n * 60_001) : r.open("poll"))),
              );
              expect((yield* w.local("alpha:1")).fault).toEqual(stopped.fault);
              expect(yield* w.journal("alpha:1")).toEqual(saved);
              expect(yield* w.checkpoint("alpha:1")).toEqual(checkpoint);
              expect(yield* w.entries).toEqual(entries);
            }

            w.limits(defaults);
            expect(yield* Effect.result(w.restart("alpha:1", "agent-restart", false))).toHaveProperty(
              "_tag",
              "Failure",
            );
            expect((yield* w.local("alpha:1")).fault).toEqual(stopped.fault);
            yield* w.restart("alpha:1", "person-restart", true);
            yield* w.drain("alpha:1");
            expect((yield* w.local("alpha:1")).fault).toBeNull();
            expect((yield* w.program("sample/alpha")).bytes).toBe(old.bytes);
            expect(yield* w.input("beta:1", "unaffected", { type: "inc" })).toHaveProperty("_tag", "placed");
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q18 accepted history brings replay room, independent of exhausted program and recovery windows",
      { tape: Schema.Array(Cell).check(Schema.isMinLength(1), Schema.isMaxLength(3)) },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(defaults);
            const letters: string[] = [];

            for (const [n, c] of tape.entries()) {
              // Beyond the measured 350: generated histories include up to 1,001 accepted letters.
              const length = 1 + (c.amount % 1001);

              for (let j = 0; j < length; j++) {
                const id = `history:${n}:${j}`;
                expect(yield* w.input("alpha:1", id, { type: "inc" })).toHaveProperty("_tag", "placed");
                letters.push(id);
              }

              yield* w.drain("alpha:1");
              const full = yield* w.program("sample/alpha");
              w.limits({
                ...defaults,
                writes: full.writes,
                recovery: {
                  project: { ...defaults.recovery.project, writes: 16 },
                  process: { ...defaults.recovery.process, writes: 28 },
                },
              });

              if (c.reopen) {
                yield* w.reopen;
              }

              yield* w.restart("alpha:1", `restart:${n}`, true);
              yield* w.drain("alpha:1");
              expect((yield* w.local("alpha:1")).fault).toBeNull();
              expect((yield* w.program("sample/alpha")).writes).toBe(full.writes);
              const before = yield* w.entries;
              yield* w.restart("alpha:1", `restart:${n}`, true);
              yield* w.drain("alpha:1");
              expect(yield* w.entries).toEqual(before);
              const after = yield* w.entries;

              for (const id of letters) {
                expect(
                  after.filter((e) => e._tag === "stepped" && e.id === `step:${id}`).length,
                ).toBeGreaterThanOrEqual(1);
              }

              w.limits(defaults);
              yield* TestClock.setTime((n + 1) * 60_001);
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q19 quota-refused timers and command answers keep saved work and land after the window opens",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open({ ...defaults, writes: 2 });

            for (const [n, c] of tape.entries()) {
              const at = 1_000 + n * 120_002;
              yield* TestClock.setTime(at);
              const m = c.pick % 2 === 0 ? { type: "work" } : { type: "schedule", at: at + 1 };
              expect(yield* w.input("alpha:1", `deferred:${n}`, m)).toHaveProperty("_tag", "placed");
              yield* w.drain("alpha:1");
              const saved = yield* w.checkpoint("alpha:1");
              const journal = yield* w.journal("alpha:1");
              const usage = yield* w.local("alpha:1");

              for (let attempt = 0; attempt < 2 + (c.amount % 5); attempt++) {
                yield* call(w, "alpha:1", (r) => r.due(at + 1));

                if (c.reopen) {
                  yield* w.reopen;
                }

                expect(yield* w.checkpoint("alpha:1")).toEqual(saved);
                expect(yield* w.journal("alpha:1")).toEqual(journal);
                expect((yield* w.local("alpha:1")).recovery).toEqual(usage.recovery);
                expect((yield* w.entries).filter((e) => e._tag === "dead" || e._tag === "exited")).toEqual([]);
              }

              yield* TestClock.setTime(at + 60_001);
              yield* call(w, "alpha:1", (r) => r.due(at + 60_001));
              yield* w.drain("alpha:1");
              const after = yield* w.checkpoint("alpha:1");
              expect(after).not.toEqual(saved);
              expect((yield* w.local("alpha:1")).fault).toBeNull();
            }
          }),
        ),
      options,
    );
  });
