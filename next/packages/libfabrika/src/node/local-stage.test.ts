import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import * as fc from "fast-check";
import { BrainEvent } from "../app/brain-event.ts";
import { processId } from "../id.test-support.ts";
import { brainOutbox, checkMemory } from "./local-stage.ts";

const SEED = 119120;

const runNode = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(work.pipe(Effect.provide(NodeServices.layer)));

const firstStart: typeof BrainEvent.Type = {
  id: "brain-start-1",
  _tag: "started",
  start: Effect.runSync(processId),
  after: null,
  build: "build-a",
  reason: "open",
  pid: 417,
  at: 42,
};

const life = {
  id: fc.string({ minLength: 1 }),
  start: fc.string({ minLength: 1 }),
  at: fc.integer({ min: 0 }),
  exitCode: fc.option(fc.integer(), { nil: null }),
  signal: fc.option(fc.string(), { nil: null }),
  bytes: fc.integer({ min: 0 }),
  backoff: fc.integer({ min: 0 }),
};

const reason = fc.constantFrom("open", "crash", "memory", "core");

const brainEvent: fc.Arbitrary<typeof BrainEvent.Type> = fc.oneof(
  fc.record({
    ...life,
    _tag: fc.constant("started"),
    after: fc.option(fc.string(), { nil: null }),
    build: fc.string(),
    reason,
    pid: fc.integer({ min: 1 }),
  }),
  fc.record({ ...life, _tag: fc.constant("exited"), reason }),
  fc.record({
    ...life,
    _tag: fc.constant("braked"),
    reason: fc.constantFrom("intensity", "restart_failed"),
  }),
  fc.record({ ...life, _tag: fc.constant("stopped"), reason: fc.constant("stop") }),
);

describe("P12 local brain life", () => {
  const homes: Array<string> = [];
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), "p12-l-"));
    homes.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of homes.splice(0)) {
      rmSync(h, { recursive: true, force: true });
    }
  });
  it("p81 plant: sample workerd RSS, replace at 500000000, never measure the Node parent", async () => {
    const child = fc.integer({ min: 1 }).filter((pid) => pid !== process.pid);
    const belowCap: [number, number] = [499_999_999, 417];
    const atCap: [number, number] = [500_000_000, 417];
    const aboveCap: [number, number] = [500_000_001, 417];
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), child, (bytes, pid) =>
        runNode(
          Effect.gen(function* () {
            const sampled: Array<number> = [],
              requests: Array<unknown> = [];
            yield* checkMemory({
              pid,
              sample: (pid: number) =>
                Effect.sync(() => {
                  sampled.push(pid);
                  return bytes;
                }),
              replace: (reason: unknown) =>
                Effect.sync(() => {
                  requests.push(reason);
                }),
            });
            expect(sampled).toEqual([pid]);
            expect(sampled).not.toContain(process.pid);
            expect(requests).toEqual(bytes < 500_000_000 ? [] : [{ reason: "memory", pid, bytes }]);
          }),
        ),
      ),
      { seed: SEED, examples: [belowCap, atCap, aboveCap] },
    );
  });
  it("p81/content plant: remove a pending event before acknowledgement or leak error text", async () => {
    await fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const folder = home();
            let outbox = yield* brainOutbox(folder);
            yield* outbox.add(event);
            yield* Effect.exit(outbox.flush(() => Effect.fail(new Error("private control failure"))));
            outbox = yield* brainOutbox(folder);
            expect(yield* outbox.pending).toEqual([event]);
            expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain("private control failure");
            const sent: Array<unknown> = [];
            yield* outbox.flush((row: unknown) =>
              Effect.sync(() => {
                sent.push(row);
              }),
            );
            expect(sent).toEqual([event]);
            expect(yield* outbox.pending).toEqual([]);
            yield* outbox.add(event);
            yield* outbox.flush((row: unknown) =>
              Effect.sync(() => {
                sent.push(row);
              }),
            );
            expect(sent).toEqual([event, event]); // Same stable id lets Project deduplicate a lost reply.
            expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain("private control failure");
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    );
  });
});

describe("P12 durable brain outbox", () => {
  const homes: Array<string> = [];
  const home = () => {
    const folder = mkdtempSync(join(tmpdir(), "p12-m-"));
    homes.push(folder);
    return folder;
  };
  afterEach(() => {
    for (const folder of homes.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  for (const reader of ["pending", "last"] as const) {
    it(`malformed saved ${reader} returns BrainError without a defect`, async () => {
      const schema = reader === "pending" ? BrainEvent : Schema.NonEmptyString;
      await fc.assert(
        fc.asyncProperty(
          fc.jsonValue().filter((raw) => !Schema.is(schema)(raw)),
          async (raw) => {
            const folder = home();
            writeFileSync(
              join(folder, reader === "pending" ? "brain.pending.jsonl" : "brain.last.json"),
              JSON.stringify(raw),
            );
            const exit = await runNode(
              Effect.gen(function* () {
                const outbox = yield* brainOutbox(folder);
                return yield* outbox[reader];
              }).pipe(Effect.exit),
            );
            expect(Exit.isFailure(exit)).toBe(true);
            const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
            expect(Cause.hasDies(cause)).toBe(false);
            expect(Cause.hasFails(cause)).toBe(true);
            expect(Cause.findErrorOption(cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "BrainError", reason: "bad_row" },
            });
          },
        ),
        { seed: SEED, numRuns: 20, examples: [[null], [{}], [17]] },
      );
    });
  }

  it("FileSystem writes each pending and last file in durable order, including acknowledgement", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(brainEvent, { minLength: 1, maxLength: 4, selector: (row) => row.id }),
        async (rows) => {
          const folder = home();
          const files = new Map<string, string>();
          const calls: Array<unknown> = [];
          const joins: Array<ReadonlyArray<string>> = [];
          const note = (call: unknown) =>
            Effect.sync(() => {
              calls.push(call);
            });
          const fs = FileSystem.layerNoop({
            exists: (path) => Effect.sync(() => files.has(path)),
            readFileString: (path) => Effect.sync(() => files.get(path) ?? ""),
            makeDirectory: () => Effect.void,
            open: (path) =>
              Effect.acquireRelease(
                Effect.sync((): FileSystem.File => {
                  calls.push(["open", path]);
                  return {
                    [FileSystem.FileTypeId]: FileSystem.FileTypeId,
                    stat: Effect.die("unused stat"),
                    seek: () => Effect.die("unused seek"),
                    read: () => Effect.die("unused read"),
                    readAlloc: () => Effect.die("unused readAlloc"),
                    truncate: () => Effect.die("unused truncate"),
                    write: () => Effect.die("use writeAll"),
                    sync: note(["sync", path]),
                    writeAll: (data) =>
                      Effect.sync(() => {
                        const text = new TextDecoder().decode(data);
                        calls.push(["write", path, text]);
                        files.set(path, text);
                      }),
                  };
                }),
                () => note(["close", path]),
              ),
            rename: (from, to) =>
              Effect.sync(() => {
                calls.push(["rename", from, to]);
                files.set(to, files.get(from)!);
                files.delete(from);
              }),
          });
          const path = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));
          const paths = Layer.succeed(Path.Path, {
            ...path,
            join: (...parts) => {
              joins.push(parts);
              return path.join(...parts);
            },
          });
          const file = join(folder, "brain.pending.jsonl"),
            last = join(folder, "brain.last.json");
          const durable = (target: string, text: string) => [
            ["open", `${target}.tmp`],
            ["write", `${target}.tmp`, text],
            ["sync", `${target}.tmp`],
            ["close", `${target}.tmp`],
            ["rename", `${target}.tmp`, target],
            ["open", folder],
            ["sync", folder],
            ["close", folder],
          ];
          const encoded = (rows: ReadonlyArray<typeof BrainEvent.Type>) =>
            rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const outbox = yield* brainOutbox(folder);
                const expected: Array<unknown> = [];

                for (const [index, row] of rows.entries()) {
                  yield* outbox.add(row);
                  expected.push(...durable(file, encoded(rows.slice(0, index + 1))));

                  if (row._tag === "started") {
                    expected.push(...durable(last, JSON.stringify(row.start)));
                  }

                  expect(calls).toEqual(expected);
                }

                const latest = rows.filter((row) => row._tag === "started").at(-1);
                const sent: Array<typeof BrainEvent.Type> = [];
                yield* outbox.flush((row) =>
                  Effect.sync(() => {
                    sent.push(row);
                  }),
                );

                if (latest !== undefined) {
                  expected.push(...durable(last, JSON.stringify(latest.start)));
                }

                for (let n = 1; n <= rows.length; n++) {
                  expected.push(...durable(file, encoded(rows.slice(n))));
                }

                expect(calls).toEqual(expected);
                expect(sent).toEqual(rows);
                expect(yield* outbox.pending).toEqual([]);
                expect(yield* outbox.last).toBe(latest?.start ?? null);
                expect(joins).toContainEqual([folder, "brain.pending.jsonl"]);
                expect(joins).toContainEqual([folder, "brain.last.json"]);
              }),
            ).pipe(Effect.provide(fs), Effect.provide(paths)),
          );
        },
      ),
      {
        seed: SEED,
        numRuns: 20,
        examples: [
          // Empty-after-ack and last-start writes must both keep the durability order.
          [[firstStart]],
          [[firstStart, { ...firstStart, id: "next", start: "next-start", at: 43 }]],
        ],
      },
    );
  });
  it("an event with an excess property is a bad_row on add and on a saved pending row", async () => {
    await fc.assert(
      fc.asyncProperty(brainEvent, fc.string({ minLength: 1 }), (event, extra) =>
        runNode(
          Effect.gen(function* () {
            const folder = home();
            const outbox = yield* brainOutbox(folder);
            const excess = { ...event, [`x-${extra}`]: extra };
            expect(yield* Effect.flip(outbox.add(excess))).toMatchObject({
              _tag: "BrainError",
              reason: "bad_row",
            });
            expect(yield* outbox.pending).toEqual([]);
            writeFileSync(join(folder, "brain.pending.jsonl"), `${JSON.stringify(excess)}\n`);
            expect(yield* Effect.flip(outbox.pending)).toMatchObject({
              _tag: "BrainError",
              reason: "bad_row",
            });
          }),
        ),
      ),
      { seed: SEED, numRuns: 20 },
    );
  });
  it("an outbox id accepts an exact retry once and rejects changed content", async () => {
    await fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const folder = home();
            const outbox = yield* brainOutbox(folder);
            yield* outbox.add(event);
            yield* outbox.add(event);
            expect(yield* outbox.pending).toEqual([event]);

            if (event._tag === "started") {
              const build = event.build === "build-b" ? "build-c" : "build-b";
              expect(yield* Effect.flip(outbox.add({ ...event, build }))).toMatchObject({
                _tag: "BrainError",
                reason: "id_reused",
              });
            }

            expect(yield* Effect.flip(outbox.add({ ...event, start: `${event.start}-changed` }))).toMatchObject({
              _tag: "BrainError",
              reason: "id_reused",
            });
            expect(yield* (yield* brainOutbox(folder)).pending).toEqual([event]);
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    );
  });

  it("outbox writes release both the pending file and its directory handle", async () => {
    await fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const outbox = yield* brainOutbox(home());
            const before = readdirSync("/dev/fd").sort();
            yield* outbox.add(event);
            expect(readdirSync("/dev/fd").sort()).toEqual(before);
            yield* outbox.flush(() => Effect.void);
            expect(readdirSync("/dev/fd").sort()).toEqual(before);
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    );
  });
});
