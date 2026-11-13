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
  // Our own plist is a regular file with mode 0600, so only such a file passes the ownership check
  // and is told from ours by its bytes. `private` is one with other bytes. `copy` is one with our
  // plist's exact bytes. A generated mode almost never draws 0600, so each has an arm of its own.
  private: { bytes: Schema.String },
  copy: {},
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

const Byte = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 }));

/** A symlink whose target is not valid UTF-8. Text cannot carry it, so it is held as bytes. */
export const Opaque = Schema.TaggedStruct("opaque", { target: Schema.Array(Byte) });
export type Opaque = typeof Opaque.Type;

// A target of any bytes but NUL around one byte that no valid UTF-8 text holds, wherever it sits.
const OpaqueTarget = Schema.Struct({
  before: Schema.Array(Byte).check(Schema.isMaxLength(32)),
  never: Schema.Literals([0xc0, 0xc1, 0xf5, 0xfe, 0xff]),
  after: Schema.Array(Byte).check(Schema.isMaxLength(32)),
});

export const Replacement = Schema.Struct({
  // Removal captures the plist with one rename. The swap lands right before it, or right after it.
  checkpoint: Schema.Literals(["before-capture", "after-capture"]),
  competing: Schema.Union([Competing, Opaque]),
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
  /** Symlink targets as bytes: the link at the plist path, and each link kept in a `.brain-*` folder. */
  readonly links: Effect.Effect<{
    readonly path: ReadonlyArray<number> | null;
    readonly held: ReadonlyArray<ReadonlyArray<number>>;
  }>;
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

            const ours = yield* disk.read;
            expect(ours).not.toBeNull();

            const exit = yield* Effect.scoped(disk.control.remove).pipe(Effect.exit);
            expect(disk.events.filter((event) => event === `replace:${checkpoint}`)).toHaveLength(1);
            const swapped = yield* disk.swapped;
            const typed = { defect: false, error: "BrainControlError" };
            const held = Effect.map(disk.entries, (names) => names.filter((name) => name.startsWith(".brain-")));

            if (competing._tag === "copy") {
              // A 0600 file with our exact bytes is our plist: an existing matching file is reusable.
              // The racing removal may take it or refuse. Either way the file is gone whole or still
              // there as it was put, and no captured copy outlives the removal.
              expect(swapped).toEqual(Dirent.cases.file.make({ bytes: ours ?? "", mode: 0o600 }));
              const first = refusal(exit);
              expect({ first, dirent: yield* disk.dirent }).toEqual(
                first === null ? { first, dirent: null } : { first: typed, dirent: swapped },
              );
              expect(yield* held).toEqual([]);
              // The competing writer wrote once. With no race left, the next removal takes our plist.
              yield* disk.recover;
              expect({
                refusal: refusal(yield* Effect.scoped(disk.control.remove).pipe(Effect.exit)),
                dirent: yield* disk.dirent,
              }).toEqual({ refusal: null, dirent: null });
              expect(yield* held).toEqual([]);
              expect(disk.events.filter((event) => event === `replace:${checkpoint}`)).toHaveLength(1);
              return;
            }

            // The swap really put the generated kind at the path.
            if (competing._tag === "symlink") {
              expect(
                swapped?._tag === "symlink" && swapped.target.startsWith("/") === (competing.path === "absolute"),
              ).toBe(true);
            } else {
              expect(swapped).toEqual(
                competing._tag === "directory"
                  ? Dirent.cases.directory.make({ files: { kept: utf8(competing.bytes) } })
                  : Dirent.cases.file.make({
                      bytes: utf8(competing.bytes),
                      mode: competing._tag === "file" ? competing.mode : 0o600,
                    }),
              );
            }

            // The competing entry is still there as it was put: same kind, and the same link target
            // or the same contents and mode. The removal refuses with its typed error, never a defect.
            expect({ refusal: refusal(exit), dirent: yield* disk.dirent }).toEqual({ refusal: typed, dirent: swapped });
            // Our own plist is gone: no captured copy of it outlives the removal.
            expect(yield* held).toEqual([]);
            yield* disk.recover;
            expect({
              refusal: refusal(yield* Effect.scoped(disk.control.remove).pipe(Effect.exit)),
              dirent: yield* disk.dirent,
            }).toEqual({ refusal: typed, dirent: swapped });
            expect(yield* held).toEqual([]);
          }),
        // 500 runs, so each of the five arms gets about the 100 the one kind had: the 0600 file
        // with other bytes, the only draw before the kinds came, keeps its 100. Each run is real
        // disk work, so the law brings its own time limit instead of leaning on the config's.
        { arbitrary: { seed: 119120, runs: 500 }, timeout: 180_000 },
      );
    }

    it.effect.prop(
      "L2/L6 a failed removal never changes a symlink target that is not valid UTF-8",
      [OpaqueTarget],
      ([{ before, never, after }]) =>
        Effect.gen(function* () {
          const target = [...before, never, ...after];
          const disk = yield* open("none", {
            checkpoint: "before-capture",
            competing: Opaque.make({ target }),
          });
          yield* disk.control.install;
          // Where the competing link is now. Text cannot carry its target, so a restore that reads
          // the target as text can only put a different link back: the link then stays where the
          // capture put it. `changed` is another entry at the path, `lost` is the link nowhere.
          const place = Effect.gen(function* () {
            const links = yield* disk.links;

            if ((yield* disk.dirent) === null) {
              return links.held.some((bytes) => bytes.join() === target.join()) ? "held" : "lost";
            }

            return links.path?.join() === target.join() ? "path" : "changed";
          });
          const typed = { defect: false, error: "BrainControlError" };

          const first = refusal(yield* Effect.scoped(disk.control.remove).pipe(Effect.exit));
          expect(disk.events.filter((event) => event === "replace:before-capture")).toHaveLength(1);
          const kept = yield* place;
          expect(first).toEqual(typed);
          expect(["path", "held"]).toContain(kept);
          // A second removal fails the same way and leaves the link where the first one left it.
          yield* disk.recover;
          expect({
            refusal: refusal(yield* Effect.scoped(disk.control.remove).pipe(Effect.exit)),
            kept: yield* place,
          }).toEqual({ refusal: typed, kept });
        }),
      {
        // Review 10's link on a real disk, target bytes 61 ff fe 62, is one of these: it came back
        // as 61 ef bf bd ef bf bd 62 and the captured link was deleted.
        arbitrary: { seed: 119120, runs: 100 },
        timeout: 60_000,
      },
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
