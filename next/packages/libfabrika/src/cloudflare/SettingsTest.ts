// T753, next/. A caller supplies real entry points, storage and output collectors (0062).
import { describe, expect } from "@effect/vitest";
import { Effect, Exit, Option, type Scope } from "effect";
import * as fc from "fast-check";
import * as StartsTest from "../settings/StartsTest.ts";

export const paths = ["HTTP", "Connection", "Process", "RecordPart", "Project"] as const;
export type Path = (typeof paths)[number];
export type Fault = "none" | "storage" | "refused" | "unreachable" | "malformed" | "lost";

export const channels = [
  "transport",
  "ledger",
  "descriptors",
  "record RPC",
  "spans",
  "content",
  "archives",
  "HTTP replies",
  "RPC failures",
  "stdout",
  "stderr",
  "logs",
  "span attributes",
] as const;

export type Channel = (typeof channels)[number];
export type Outputs = Record<Channel, ReadonlyArray<unknown>>;

export interface Counts {
  readonly calls: number;
  readonly reads: number;
  readonly appends: number;
  readonly consumers: number;
}

export interface Entry {
  readonly enter: (choice: number) => Effect.Effect<unknown, unknown>;
  readonly close: Effect.Effect<void>;
}

export interface Driver {
  readonly deploy: (recipe: StartsTest.Recipe) => Effect.Effect<void, unknown>;
  readonly open: (path: Path, corrupt?: number) => Effect.Effect<Entry, unknown, Scope.Scope>;
  readonly fault: (fault: Fault) => void;
  readonly counts: () => Counts;
  readonly outputs: Effect.Effect<Outputs, unknown>;
}

export type Open = (recipe: StartsTest.Recipe, secret: string) => Effect.Effect<Driver, unknown, Scope.Scope>;

const pick = <A>(items: ReadonlyArray<A>, choice: number) =>
  Option.getOrThrow(Option.fromUndefinedOr(items[choice % items.length]));

export const suite = (open: Open) =>
  describe("L10 L16 entry flows, next/", () => {
    for (const path of paths) {
      StartsTest.law(
        `L16 ${path} counts cold, concurrent, warm and reopened entries`,
        fc.tuple(StartsTest.recipe, StartsTest.sentinel, fc.array(fc.nat(), { minLength: 12, maxLength: 40 })),
        ([recipe, secret, choices]) =>
          Effect.gen(function* () {
            const driver = yield* open(recipe, secret);
            let entry = yield* driver.open(path);
            let ready = false;
            let placed = false;

            for (const [index, choice] of choices.entries()) {
              const moves = ready ? ["warm", "concurrent", "reopen", "deploy"] : ["cold", "concurrent", "failure"];
              const move = pick(moves, choice);

              if (move === "reopen" || move === "deploy") {
                yield* entry.close;

                if (move === "deploy") {
                  yield* driver.deploy({ ...recipe, start: `${recipe.start}-${index}`, port: (choice % 65535) + 1 });
                  placed = false;
                }

                entry = yield* driver.open(path);
                ready = false;
                continue;
              }

              const failure = move === "failure";
              // Project's gate is local SQL. All other paths cross the trusted Project RPC.
              driver.fault(
                failure
                  ? path === "Project"
                    ? "storage"
                    : pick(
                        ["storage", "refused", "unreachable", "malformed"] as const,
                        Math.floor(choice / moves.length),
                      )
                  : "none",
              );
              const before = driver.counts();
              const total = move === "concurrent" ? 2 + (choice % 5) : 1;
              const exits = yield* Effect.forEach(
                Array.from({ length: total }),
                (_, n) => Effect.exit(entry.enter(choice + n)),
                { concurrency: "unbounded" },
              );

              if (failure) {
                expect(exits.every(Exit.isFailure)).toBe(true);
                expect(driver.counts().consumers).toBe(before.consumers);
                // The very next entry reuses this owner, which must not retain a failed build.
                driver.fault("none");
                const retry = driver.counts();
                expect(Exit.isSuccess(yield* Effect.exit(entry.enter(choice)))).toBe(true);
                const afterRetry = driver.counts();
                expect(afterRetry.calls - retry.calls).toBe(path === "Project" ? 0 : 1);
                expect(afterRetry.reads - retry.reads).toBe(placed ? 1 : 2);
                expect(afterRetry.appends - retry.appends).toBe(placed ? 0 : 1);
                ready = true;
                placed = true;
              } else {
                expect(exits.every(Exit.isSuccess)).toBe(true);
                const after = driver.counts();
                expect(after.calls - before.calls).toBe(ready || path === "Project" ? 0 : 1);
                expect(after.reads - before.reads).toBe(ready ? 0 : placed ? 1 : 2);
                expect(after.appends - before.appends).toBe(placed ? 0 : 1);
                ready = true;
                placed = true;
              }

              const warm = driver.counts();

              // Visit every method. The generated walk supplies repeated warm deliveries.
              const methods = path === "Project" ? 3 : path === "Connection" || path === "Process" ? 2 : 4;

              for (let n = 0; n < methods; n++) {
                yield* entry.enter(n);
              }

              const afterWarm = driver.counts();
              expect(afterWarm.calls).toBe(warm.calls);
              expect(afterWarm.reads).toBe(warm.reads);
              expect(afterWarm.appends).toBe(warm.appends);
              const outputs = yield* driver.outputs;

              for (const channel of channels) {
                StartsTest.exclude(outputs[channel], secret);
              }
            }
          }),
      );
    }

    StartsTest.law(
      "L10 [secrets] valid, rejected, failed, lost-answer and reopened flows inspect every named output",
      fc.tuple(StartsTest.recipe, StartsTest.sentinel, fc.array(fc.nat(), { minLength: 20, maxLength: 60 })),
      ([recipe, secret, choices]) =>
        Effect.gen(function* () {
          const driver = yield* open(recipe, secret);
          const owners = new Map<Path, Entry>();
          const ready = new Set<Path>();

          for (const choice of choices) {
            const path = pick(paths, choice);
            const moves = owners.has(path)
              ? ready.has(path)
                ? ["enter", "reopen", "reject"]
                : ["enter", "fail", "reject", "lost"]
              : ["open", "reject"];
            const move = pick(moves, Math.floor(choice / paths.length));

            if (move === "reopen") {
              yield* Option.getOrThrow(Option.fromUndefinedOr(owners.get(path))).close;
              owners.delete(path);
              ready.delete(path);
            } else if (move === "open") {
              // Keep this owner cold so the next move can fail or lose its first answer.
              owners.set(path, yield* driver.open(path));
            } else {
              driver.fault(move === "fail" ? "storage" : move === "lost" && path !== "Project" ? "lost" : "none");
              const entry =
                move === "reject"
                  ? yield* driver.open(path, Math.floor(choice / (paths.length * moves.length)))
                  : (owners.get(path) ?? (yield* driver.open(path)));

              if (move !== "reject") {
                owners.set(path, entry);
              }

              const exit = yield* Effect.exit(entry.enter(choice));

              if (move === "reject") {
                expect(Exit.isFailure(exit)).toBe(true);
                yield* entry.close;
              } else if (move === "fail" || (move === "lost" && path !== "Project")) {
                expect(Exit.isFailure(exit)).toBe(true);
              } else if (Exit.isSuccess(exit)) {
                ready.add(path);
              }
            }

            const outputs = yield* driver.outputs;

            for (const channel of channels) {
              StartsTest.exclude(outputs[channel], secret);
            }
          }
        }),
    );
  });
