// L6, next/. The driver owner supplies real files and the adapter; desktop imports no platform.
import { describe, expect, it } from "@effect/vitest";
import type { Scope } from "effect";
import { Effect, Exit, Schema } from "effect";
import type { BrainControl } from "./BrainControl.ts";
import type { BrainSpec } from "./BrainSpec.ts";

export type Fault = "none" | "compile" | "sync" | "publish" | "directory-sync";

type Files = {
  readonly control: BrainControl["Service"];
  readonly spec: BrainSpec;
  readonly read: Effect.Effect<string | null>;
  readonly seed: (text: string) => Effect.Effect<void>;
  readonly entries: Effect.Effect<ReadonlyArray<string>>;
  readonly events: Array<string>;
  readonly recover: Effect.Effect<void>;
  readonly failDirectorySync: Effect.Effect<void>;
};

export type Open = (fault: Fault) => Effect.Effect<Files, unknown, Scope.Scope>;

export const suite = (open: Open) =>
  describe("P19 shared atomic publication laws", () => {
    it.effect.prop(
      "L2/L6 failed install or removal leaves foreign bytes untouched",
      [Schema.Literals(["compile", "sync", "publish"]), Schema.String, Schema.Literals(["install", "remove"])],
      ([fault, tail, action]) =>
        Effect.gen(function* () {
          const disk = yield* open(fault);
          yield* disk.seed(`foreign-job-${tail}`);
          const original = yield* disk.read;
          expect(original).not.toBeNull();
          const exit = yield* disk.control[action].pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
          expect(yield* disk.read).toBe(original);
          expect(disk.events).not.toContain("replaced");
        }),
      { arbitrary: { seed: 119120, runs: 100 } },
    );

    it.effect.prop(
      "L6 a fresh failed publication never acknowledges an unsynced file",
      [Schema.Literals(["compile", "sync", "publish"])],
      ([fault]) =>
        Effect.gen(function* () {
          const disk = yield* open(fault);
          expect(Exit.isFailure(yield* disk.control.install.pipe(Effect.exit))).toBe(true);
          expect(yield* disk.read).toBeNull();
          expect((yield* disk.entries).filter((name) => name !== "records")).toEqual([]);
        }),
      { arbitrary: { seed: 119120, runs: 100 } },
    );

    it.effect.prop(
      "L6 a directory-sync failure keeps matching bytes and retry confirms durability",
      [Schema.Literals(["install", "remove"])],
      ([action]) =>
        Effect.gen(function* () {
          const disk = yield* open(action === "install" ? "directory-sync" : "none");

          if (action === "remove") {
            yield* disk.control.install;
          }

          if (action === "install") {
            expect(Exit.isFailure(yield* disk.control.install.pipe(Effect.exit))).toBe(true);
            const bytes = yield* disk.read;
            expect(bytes).not.toBeNull();
            yield* disk.recover;
            const from = disk.events.length;
            yield* disk.control.install;
            expect(yield* disk.read).toBe(bytes);
            expect(disk.events.slice(from)).toContain("directory-sync");
          } else {
            const bytes = yield* disk.read;
            yield* disk.failDirectorySync;
            expect(Exit.isFailure(yield* disk.control.remove.pipe(Effect.exit))).toBe(true);
            expect(yield* disk.read).toBe(bytes);
            yield* disk.recover;
            const from = disk.events.length;
            yield* disk.control.remove;
            expect(yield* disk.read).toBeNull();
            expect(disk.events.slice(from)).toContain("directory-sync");
          }
        }),
      { arbitrary: { seed: 119120, runs: 100 } },
    );

    it.effect.prop(
      "L6 concurrent same-job creators converge and a later matching install preserves bytes",
      [Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 }))],
      ([count]) =>
        Effect.gen(function* () {
          const disk = yield* open("none");
          const exits = yield* Effect.forEach(
            Array.from({ length: count }),
            () => disk.control.install.pipe(Effect.exit),
            { concurrency: "unbounded" },
          );
          expect(exits.every(Exit.isSuccess)).toBe(true);
          const original = yield* disk.read;
          expect(original).not.toBeNull();
          yield* disk.control.install;
          expect(yield* disk.read).toBe(original);
          const sync = disk.events.indexOf("sync"),
            publish = disk.events.indexOf("publish");
          expect(sync).toBeGreaterThanOrEqual(0);
          expect(publish).toBeGreaterThan(sync);

          for (const [at, event] of disk.events.entries()) {
            if (event.startsWith("publish:")) {
              const synced = disk.events.indexOf(`sync:${event.slice("publish:".length)}`);
              expect(synced >= 0 && synced < at).toBe(true);
            }
          }
        }),
      { arbitrary: { seed: 119120, runs: 100 } },
    );
  });
