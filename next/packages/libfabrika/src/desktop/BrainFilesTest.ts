// L6, next/. The driver owner supplies real files and the adapter; desktop imports no platform.
import { describe, expect, it } from "@effect/vitest";
import type { Scope } from "effect";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import type { BrainControl, BrainControlError } from "./BrainControl.ts";
import type { BrainSpec } from "./BrainSpec.ts";

export type Fault = "none" | "compile" | "sync" | "publish" | "directory-sync";

/** What a competing writer puts at the plist path. A path holds more than regular files. */
export const Competing = Schema.TaggedUnion({
  file: { bytes: Schema.String, mode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0o777 })) },
  // `dangling` is a link whose target does not exist.
  symlink: { path: Schema.Literals(["relative", "absolute"]), dangling: Schema.Boolean },
  // A directory with one file inside.
  directory: { bytes: Schema.String },
});
export type Competing = typeof Competing.Type;

/** A directory entry as it is on disk. A symlink is its own target text, never what it points at. */
export const Dirent = Schema.TaggedUnion({
  file: { bytes: Schema.String, mode: Schema.Int },
  symlink: { target: Schema.String },
  directory: { files: Schema.Record(Schema.String, Schema.String) },
});
export type Dirent = typeof Dirent.Type;

export const Replacement = Schema.Struct({
  // Removal captures the plist with one rename. The swap lands right before it, or right after it.
  checkpoint: Schema.Literals(["before-capture", "after-capture"]),
  competing: Competing,
});
export type Replacement = typeof Replacement.Type;

// A file holds UTF-8, so a lone surrogate is compared as the text the disk gives back.
const utf8 = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text));

/** A refusal is a typed error. A defect is a crash, and it is never a refusal. */
const refusal = (exit: Exit.Exit<void, BrainControlError>) =>
  Exit.isFailure(exit)
    ? {
        defect: Cause.hasDies(exit.cause),
        error: Option.getOrNull(Cause.findErrorOption(exit.cause))?._tag ?? null,
      }
    : null;

type Files = {
  readonly control: BrainControl["Service"];
  readonly spec: BrainSpec;
  readonly read: Effect.Effect<string | null>;
  /** The entry at the plist path now, whatever its kind. */
  readonly dirent: Effect.Effect<Dirent | null>;
  /** The competing entry, read at the moment the swap put it at the plist path. */
  readonly swapped: Effect.Effect<Dirent | null>;
  readonly seed: (text: string) => Effect.Effect<void>;
  readonly entries: Effect.Effect<ReadonlyArray<string>>;
  readonly events: Array<string>;
  readonly recover: Effect.Effect<void>;
  readonly failDirectorySync: Effect.Effect<void>;
};

export type Open = (fault: Fault, replacement?: Replacement) => Effect.Effect<Files, unknown, Scope.Scope>;

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

    for (const checkpoint of ["before-capture", "after-capture"] as const) {
      // No directory-sync failure is generated here: both swaps end the removal before it syncs the
      // home, so that choice reached no code. The directory-sync law below covers a removal's sync.
      it.effect.prop(
        `L2/L6 removal preserves a competing plist ${checkpoint}`,
        [Competing, Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))],
        ([competing, installs]) =>
          Effect.gen(function* () {
            const disk = yield* open("none", { checkpoint, competing });

            for (let n = 0; n < installs; n++) {
              yield* disk.control.install;
            }

            expect(yield* disk.read).not.toBeNull();

            const exit = yield* Effect.scoped(disk.control.remove).pipe(Effect.exit);
            expect(disk.events.filter((event) => event === `replace:${checkpoint}`)).toHaveLength(1);
            const swapped = yield* disk.swapped;

            // The swap really put the generated kind at the path.
            if (competing._tag === "symlink") {
              expect(
                swapped?._tag === "symlink" && swapped.target.startsWith("/") === (competing.path === "absolute"),
              ).toBe(true);
            } else {
              expect(swapped).toEqual(
                competing._tag === "file"
                  ? Dirent.cases.file.make({ bytes: utf8(competing.bytes), mode: competing.mode })
                  : Dirent.cases.directory.make({ files: { kept: utf8(competing.bytes) } }),
              );
            }

            // The competing entry is still there as it was put: same kind, and the same link target
            // or the same contents and mode. The removal refuses with its typed error, never a defect.
            expect({ refusal: refusal(exit), dirent: yield* disk.dirent }).toEqual({
              refusal: { defect: false, error: "BrainControlError" },
              dirent: swapped,
            });
            // Our own plist is gone: no captured copy of it outlives the removal.
            expect((yield* disk.entries).filter((name) => name.startsWith(".brain-"))).toEqual([]);
            yield* disk.recover;
            expect({
              refusal: refusal(yield* Effect.scoped(disk.control.remove).pipe(Effect.exit)),
              dirent: yield* disk.dirent,
            }).toEqual({ refusal: { defect: false, error: "BrainControlError" }, dirent: swapped });
            expect((yield* disk.entries).filter((name) => name.startsWith(".brain-"))).toEqual([]);
          }),
        // 300 runs, so each of the three kinds gets about the 100 the one kind had. Each run is real
        // disk work, so the law brings its own time limit instead of leaning on the config's.
        { arbitrary: { seed: 119120, runs: 300 }, timeout: 180_000 },
      );
    }

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
