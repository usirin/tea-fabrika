// P33 / p79. The manager is rebuilt over the same SQLite file for each reopen check.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { Ledger } from "../data/ledger.ts";
import { lineFor } from "../data/log.ts";
import { ProcessId } from "../data/trace.ts";
import { fcProcessIds } from "../id.test-support.ts";
import { ProcessIdGenerator } from "./process-id.ts";
import { ProcessManager } from "./process-manager.ts";
import {
  A,
  B,
  W,
  X,
  again,
  BRAIN,
  brain,
  CODE,
  facts,
  first,
  from,
  ids,
  manager,
  storage,
  type Storage,
  watcher,
} from "./process.test-support.ts";
import { Activity, Dead, Owner, ProcessFact, ProcessTable, Recipient, recoverActivity } from "./process.ts";

const check = <A, E, R>(arb: fc.Arbitrary<A>, examples: NoInfer<A>[], law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        {
          seed: 119120,
          numRuns: 40,
          includeErrorInReport: true,
          examples: examples.map((a): [A] => [a]),
        },
      ),
    );
  });

const hash = fc.string({ minLength: 1, maxLength: 256 });

describe("P33, saved state and process authority", () => {
  it("a process owner requires its valid process id", () => {
    fc.assert(
      fc.property(fcProcessIds, (process) => {
        expect(Schema.is(Owner)({ _tag: "process" }), "missing process owner id").toBe(false);
        expect(Schema.decodeUnknownSync(Owner)({ _tag: "process", process })).toEqual({
          _tag: "process",
          process,
        });
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
  it("dead letters keep exactly one error class per try", () => {
    fc.assert(
      fc.property(
        fc.array(hash, { minLength: 1, maxLength: 32 }),
        hash,
        hash,
        fc.record({
          process: fcProcessIds,
          program: hash,
          name: fc.stringMatching(/^p:[a-z0-9._:-]{1,254}$/),
        }),
        (errors, m, build, identity) => {
          const dead = {
            ...identity,
            _tag: "dead",
            tries: errors.length,
            limit: 32,
            m,
            build,
            errors,
          };
          expect(Schema.is(Dead)(dead), "one error class per try is accepted").toBe(true);
          expect(Schema.is(Dead)({ ...dead, errors: errors.slice(1) })).toBe(false);
          expect(Schema.is(Dead)({ ...dead, tries: errors.length + 1 })).toBe(false);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });
  it("an idle saved marker recovers as idle with the same process", () => {
    fc.assert(
      fc.property(fcProcessIds, (process) => {
        const idle = Activity.cases.idle.make({ process });
        expect(() => recoverActivity(idle)).not.toThrow();
        const recovered = recoverActivity(idle);
        expect(recovered._tag).toBe("Success");

        if (recovered._tag === "Success") {
          expect(recovered.success).toEqual(idle);
        }
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
  it.effect("down replay retains the full state and refuses a missing or foreign child", () =>
    check(
      fc.record({
        why: hash,
        crashes: fc.integer({ min: 1, max: 32 }),
        until: fc.integer(),
        build: hash,
      }),
      [],
      ({ build, ...policy }) => {
        const store = storage();
        return Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(undefined, undefined, { ...CODE, hash: build }), from());
          yield* processes.exit(A, policy.why, from());
          const table = new ProcessTable(store.rows(), BRAIN);
          expect(() => table.down(B, policy.why, brain().owner), "missing child is a typed refusal").not.toThrow();
          expect(table.down(B, policy.why, brain().owner)).toMatchObject({
            _tag: "Failure",
            failure: { why: "ended" },
          });
          expect(table.down(A, policy.why, watcher(W).owner)).toMatchObject({
            _tag: "Failure",
            failure: { why: "not_parent" },
          });
          yield* processes.down(A, policy, from());
          store.reopen();
          expect(() => new ProcessTable(store.rows(), BRAIN), "down state still decodes").not.toThrow();
          const life = new ProcessTable(store.rows(), BRAIN).life(A);
          expect(life).toMatchObject({
            _tag: "Some",
            value: { state: { _tag: "down", process: A, code: { ...CODE, hash: build }, ...policy } },
          });
        }).pipe(Effect.provide(manager(store)));
      },
    ),
  );
  it.effect("exit retries ignore fresh caller metadata but refuse a different reason", () =>
    check(fc.uniqueArray(hash, { minLength: 2, maxLength: 2 }), [], ([why, other]) => {
      const store = storage();
      return Effect.gen(function* () {
        const processes = yield* ProcessManager;
        yield* processes.start(first(), from());
        yield* processes.exit(A, why!, from());
        const before = store.rows();
        const retried = yield* Effect.exit(processes.exit(A, why!, from({ parent: null, for: "retry-person" })));
        expect(retried._tag, "ended exit is a no-op even with fresh caller metadata").toBe("Success");
        const changed = yield* Effect.result(processes.exit(A, other!, from()));
        expect(changed).toMatchObject({ _tag: "Failure", failure: { why: "ended" } });
        expect(store.rows()).toEqual(before);
      }).pipe(Effect.provide(manager(store)));
    }),
  );
});

describe("p79, process identity", () => {
  it.effect("plant, key by build: actual starts use P10's distinct valid IDs on the same build", () =>
    check(fc.integer({ min: 1, max: 40 }), [24], (count) =>
      Effect.gen(function* () {
        const generated = yield* ProcessIdGenerator;
        const store = storage();
        yield* Effect.gen(function* () {
          const processes = yield* ProcessManager;
          const answers = yield* Effect.forEach(
            Array.from({ length: count }, (_, i) => i),
            (i) => processes.start(first(`start:${i}`, `counter:${i}`), from()),
            { concurrency: 1 },
          );
          expect(new Set(answers.map((answer) => answer.process)).size).toBe(count);

          for (const answer of answers) {
            expect(Schema.is(ProcessId)(answer.process)).toBe(true);
          }
        }).pipe(Effect.provide(manager(store, brain(), generated.next)));
      }).pipe(Effect.provide(ProcessIdGenerator.layer)),
    ),
  );
  it.effect("plant, accept a generated collision: no reservation or start is partially written", () =>
    check(hash, [CODE.hash], (build) => {
      const store = storage();
      return Effect.gen(function* () {
        yield* ProcessManager.use((p) => p.start(first(undefined, undefined, { ...CODE, hash: build }), from())).pipe(
          Effect.provide(manager(store, brain(), ids(A).next)),
        );
        store.reopen();
        const before = store.rows();
        expect(
          (yield* Effect.flip(
            ProcessManager.use((p) => p.start(first("start:other", "counter:2"), from())).pipe(
              Effect.provide(manager(store, brain(), ids(A).next)),
            ),
          )).why,
        ).toBe("id_collision");
        expect(store.rows()).toEqual(before);
      });
    }),
  );
  it.effect("plant, reuse a request ID with changed code or name: both changes are refused", () => {
    return check(
      fc.tuple(
        fc
          .stringMatching(/^[a-z][a-z0-9:]{0,20}$/)
          .filter((name) => !["counter:1", "processes", "door"].includes(name) && !name.startsWith("client:")),
        hash.filter((build) => build !== CODE.hash),
      ),
      [["counter:2", "build-b"]],
      ([name, build]) => {
        const store = storage();
        return Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(), from());
          const before = store.rows();

          for (const changed of [
            first("start:counter:1", name),
            first("start:counter:1", "counter:1", { ...CODE, hash: build }),
          ]) {
            expect((yield* Effect.flip(processes.start(changed, from()))).why).toBe("id_reused");
          }

          expect(store.rows()).toEqual(before);
        }).pipe(Effect.provide(manager(store, brain(), ids(A).next)));
      },
    );
  });
  it.effect("plant, retry allocates after wake: a rebuilt manager returns the saved answer without IDs", () =>
    check(
      fc.record({ sentAt: fc.string(), build: hash, seen: fc.nat() }),
      [{ sentAt: "future", build: "new-writer", seen: 999 }],
      (retryFrom) => {
        const store = storage();
        const unused = ids();
        return Effect.gen(function* () {
          const answer = yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
            Effect.provide(manager(store, brain(), ids(A).next)),
          );
          store.reopen();
          const retry = yield* ProcessManager.use((p) => p.start(first(), from(retryFrom))).pipe(
            Effect.provide(manager(store, brain(), unused.next)),
          );
          expect(retry).toEqual(answer);
          expect(unused.calls()).toBe(0);
        });
      },
    ),
  );
});

describe("p79, predecessors and live info", () => {
  it.effect("plant, restart a live process: an ended current predecessor is required", () => {
    return check(hash, [CODE.hash], (build) => {
      const store = storage();
      return Effect.gen(function* () {
        const processes = yield* ProcessManager;
        yield* processes.start(first(undefined, undefined, { ...CODE, hash: build }), from());
        const before = store.rows();
        expect((yield* Effect.flip(processes.start(again(A), from()))).why).toBe("alive");
        expect(store.rows()).toEqual(before);
      }).pipe(Effect.provide(manager(store)));
    });
  });
  it.effect("plant, restart under another program: the name stays its program's", () => {
    return check(
      fc.string({ minLength: 1 }).filter((program) => program !== CODE.program),
      ["other"],
      (program) => {
        const store = storage();
        return Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(), from());
          yield* processes.exit(A, "crashed", from());
          const before = store.rows();
          const error = yield* Effect.flip(
            processes.start(again(A, "restart:other", { program, hash: "build-a" }), from()),
          );
          expect(error.why).toBe("name_taken");
          expect(store.rows()).toEqual(before);
          expect((yield* facts("counter:1")).filter((row) => row._tag === "restarted")).toEqual([]);
        }).pipe(Effect.provide(manager(store)));
      },
    );
  });
  it.effect("plant, two successors: concurrent attempts accept only one and reject a stale predecessor", () =>
    check(
      fc.uniqueArray(
        fc.string().map((s) => `restart:${s}`),
        { minLength: 2, maxLength: 2 },
      ),
      [["restart:one", "restart:two"]],
      (requests) => {
        const store = storage();
        return Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(), from());
          yield* processes.exit(A, "crashed", from());
          const answers = yield* Effect.forEach(requests, (id) => Effect.exit(processes.start(again(A, id), from())), {
            concurrency: 2,
          });
          expect(answers.filter(Exit.isSuccess)).toHaveLength(1);
          expect(answers.filter(Exit.isFailure)).toHaveLength(1);
          const live = yield* processes.info;
          expect(live).toHaveLength(1);
          const current = live[0]!;
          yield* processes.exit(current.process, "crashed", from());
          expect((yield* Effect.flip(processes.start(again(A, "restart:stale"), from()))).why).toBe("stale");
          expect((yield* facts("counter:1")).filter((row) => row._tag === "restarted")).toHaveLength(1);
        }).pipe(Effect.provide(manager(store)));
      },
    ),
  );
  it.effect("plant, omit after or count retries: predecessor and exact restart total survive reopen", () =>
    check(hash, ["build-b"], (build) => {
      const store = storage();
      return Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(), from());
          yield* processes.start(first("watcher:start", "watcher:1", { program: "watcher", hash: "build-a" }), from());
          yield* processes.exit(A, "crashed", from());
          const b = yield* processes.start(again(A, "restart:a", { ...CODE, hash: build }), from());
          expect(b.process).toBe(B);
          expect(yield* processes.start(again(A, "restart:a", { ...CODE, hash: build }), from())).toEqual(b);
          yield* processes.exit(B, "crashed", from());
          const x = yield* processes.start(again(B), from());
          expect(x.process).toBe(X);
          const restarts = (yield* facts("counter:1")).filter((row) => row._tag === "restarted");
          expect(restarts.map((row) => row.body)).toEqual([
            {
              process: B,
              after: A,
              name: "counter:1",
              why: "crashed",
              build,
              asked: BRAIN,
            },
            {
              process: X,
              after: B,
              name: "counter:1",
              why: "crashed",
              build: "build-a",
              asked: BRAIN,
            },
          ]);
          expect(restarts.every((row) => row.parent === from().parent && row.build === "writer-build")).toBe(true);
        }).pipe(Effect.provide(manager(store, brain(), ids(A, W, B, X).next)));
        store.reopen();
        yield* Effect.gen(function* () {
          const processes = yield* ProcessManager;
          expect(
            (yield* processes.info)
              .map(({ process, name, program, build, restarts }) => ({
                process,
                name,
                program,
                build,
                restarts,
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          ).toEqual([
            { process: X, name: "counter:1", program: "counter", build: "build-a", restarts: 2 },
            { process: W, name: "watcher:1", program: "watcher", build: "build-a", restarts: 0 },
          ]);
          expect(yield* processes.isLive(A)).toBe(false);
          expect(yield* processes.isLive(B)).toBe(false);
          expect(yield* processes.isLive(X)).toBe(true);
          expect(yield* processes.isLive(W)).toBe(true);
        }).pipe(Effect.provide(manager(store, brain(), ids().next)));
      });
    }),
  );
  it.effect("plant, overwrite exit reason: the first exact reason is durable and written once", () =>
    check(fc.string({ minLength: 1, maxLength: 256 }), ["shutdown:requested"], (why) => {
      const store = storage();
      return Effect.gen(function* () {
        const processes = yield* ProcessManager;
        yield* processes.start(first(), from());
        yield* processes.exit(A, why, from());
        yield* processes.exit(A, why, from());
        yield* Effect.exit(processes.exit(A, "crashed", from()));
        const exits = (yield* facts("counter:1")).filter((row) => row._tag === "exited");
        expect(exits.map((row) => row.body)).toEqual([{ process: A, why, asked: BRAIN }]);
        expect(yield* processes.info).toEqual([]);
      }).pipe(Effect.provide(manager(store)));
    }),
  );
});

describe("p79, names, parents and replay", () => {
  it.effect("plant, free a name on exit: reservation keeps its original program and owner", () => {
    return check(hash, [CODE.hash], (build) => {
      const store = storage();
      return Effect.gen(function* () {
        yield* ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager(store)));
        yield* ProcessManager.use((p) => p.exit(A, "normal", from())).pipe(Effect.provide(manager(store)));
        store.reopen();
        const before = store.rows();

        for (const code of [
          { ...CODE, hash: build },
          { program: "other", hash: "build-a" },
        ]) {
          const error = yield* Effect.flip(
            ProcessManager.use((p) => p.start(first("new:first", "counter:1", code), from())).pipe(
              Effect.provide(manager(store)),
            ),
          );
          expect(error._tag).toBe("ProcessError");
          expect(error.why).toBe("name_taken");
        }

        expect(store.rows()).toEqual(before);
      });
    });
  });
  it.effect("plant, trust From.by: a sibling cannot spoof the parent to exit or restart", () => {
    return check(fc.string({ minLength: 1 }), [BRAIN], (by) => {
      const store = storage();
      return Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const processes = yield* ProcessManager;
          yield* processes.start(first(), from());
          yield* processes.start(first("sibling:start", "sibling:1"), from());
        }).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));
        const before = store.rows();
        expect(
          (yield* Effect.flip(
            ProcessManager.use((p) => p.exit(A, "killed", from({ by }))).pipe(
              Effect.provide(manager(store, watcher(W))),
            ),
          )).why,
        ).toBe("not_parent");
        expect(store.rows()).toEqual(before);
        yield* ProcessManager.use((p) => p.exit(A, "normal", from())).pipe(Effect.provide(manager(store)));
        expect(
          (yield* Effect.flip(
            ProcessManager.use((p) => p.start(again(A), from({ by }))).pipe(Effect.provide(manager(store, watcher(W)))),
          )).why,
        ).toBe("not_parent");
      });
    });
  });
  it.effect("plant, reject additive tags or keep authority only in memory: replay skips unknown facts", () =>
    check(fc.jsonValue(), [{ v: 2 }], (body) => {
      const store = storage();
      return Effect.gen(function* () {
        yield* ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager(store)));
        const before = store.rows();
        const stream = before.find((row) => row._tag === "registered")!.stream;
        yield* Ledger.use((ledger) =>
          ledger.append(stream, "future", {
            ...from(),
            _tag: "future_process_fact",
            body: Schema.decodeUnknownSync(Schema.Json)(body),
          }),
        ).pipe(Effect.provide(manager(store)));
        store.reopen();
        const replayed = yield* Effect.exit(
          ProcessManager.use((p) => p.isLive(A)).pipe(Effect.provide(manager(store))),
        );
        expect(Exit.isSuccess(replayed) && replayed.value).toBe(true);
        expect(store.rows().some((row) => row._tag === "future_process_fact")).toBe(true);
      });
    }),
  );
});

// P33: the fold trusts a ProcessFact only from the brain's own writer, `from().by` here.
const OTHER = "SHA256:not-the-brain";
const toW = Recipient.cases.process.make({ process: W });

const forger = (store: Storage, by: string, streamForLife: string) => ({
  forge: (stream: string, fact: { readonly _tag: string } & Schema.JsonObject) =>
    Ledger.use((ledger) =>
      ledger.append(
        stream === "counter:1" ? streamForLife : stream,
        `forged:${fact._tag}`,
        lineFor(from({ by }), fact),
      ),
    ).pipe(Effect.provide(manager(store))),
  live: (process: string) => ProcessManager.use((p) => p.isLive(process)).pipe(Effect.provide(manager(store))),
  downs: () => store.rows().filter((row) => row._tag === "send"),
});

const lawsFor = (
  store: Storage,
  by: string,
  stream: string,
): Record<keyof typeof ProcessFact.cases, Effect.Effect<void, unknown>> => {
  const { forge, live, downs } = forger(store, by, stream);
  return {
    registered: Effect.gen(function* () {
      yield* forge("processes", {
        _tag: "registered",
        name: "counter:2",
        program: "counter",
        owner: Owner.cases.process.make({ process: W }),
      });
      const answer = yield* Effect.exit(
        ProcessManager.use((p) => p.start(first("start:counter:2", "counter:2"), from())).pipe(
          Effect.provide(manager(store, brain(), ids(B).next)),
        ),
      );
      expect(Exit.isSuccess(answer)).toBe(true);
    }),
    started: Effect.gen(function* () {
      yield* forge("counter:1", { _tag: "started", process: B, name: "counter:1", ...CODE });
      expect(yield* live(B)).toBe(false);
    }),
    exited: Effect.gen(function* () {
      yield* forge("counter:1", { _tag: "exited", process: A, why: "crashed" });
      expect(yield* live(A)).toBe(true);
    }),
    restarted: Effect.gen(function* () {
      yield* forge("counter:1", {
        _tag: "restarted",
        process: A,
        after: B,
        name: "counter:1",
        why: "crashed",
        build: CODE.hash,
      });
      const info = yield* ProcessManager.use((p) => p.info).pipe(Effect.provide(manager(store)));
      expect(info.find((row) => row.process === A)?.restarts).toBe(0);
    }),
    down: Effect.gen(function* () {
      yield* forge("counter:1", { _tag: "down", process: A, why: "crashed", crashes: 1, until: 0 });
      expect(yield* live(A)).toBe(true);
    }),
    monitored: Effect.gen(function* () {
      yield* forge("processes", { _tag: "monitored", ref: "watch:1", process: A, to: toW });
      yield* ProcessManager.use((p) => p.exit(A, "crashed", from())).pipe(Effect.provide(manager(store)));
      expect(downs()).toEqual([]);
    }),
    demonitored: Effect.gen(function* () {
      yield* ProcessManager.use((p) => p.monitor("watch:1", A, from())).pipe(
        Effect.provide(manager(store, watcher(W))),
      );
      yield* forge("processes", { _tag: "demonitored", ref: "watch:1", to: toW, why: "canceled" });
      yield* ProcessManager.use((p) => p.exit(A, "crashed", from())).pipe(Effect.provide(manager(store)));
      expect(downs()).toHaveLength(1);
    }),
  };
};

describe("P33, the process fold ignores facts not written by the brain", () => {
  for (const tag of Object.keys(ProcessFact.cases) as Array<keyof typeof ProcessFact.cases>) {
    it.effect(`the fold ignores a fact tagged ${tag} whose by is not the brain's writer`, () => {
      return check(
        fc.tuple(
          fc.string({ minLength: 1 }).filter((by) => by !== BRAIN),
          fc.constantFrom("counter:1", "processes/counter:1"),
        ),
        [[OTHER, "counter:1"]],
        ([by, stream]) => {
          const store = storage();
          return Effect.gen(function* () {
            yield* Effect.gen(function* () {
              const processes = yield* ProcessManager;
              yield* processes.start(first(), from());
              yield* processes.start(
                first("watcher:start", "watcher:1", { program: "watcher", hash: "build-a" }),
                from(),
              );
            }).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));
            yield* lawsFor(store, by, stream)[tag];
          });
        },
      );
    });
  }
});

describe("P33, names and client ids are checked against a pattern", () => {
  for (const name of ["processes", "a/b", "counter:1/inbox"]) {
    it.effect(`a start named ${JSON.stringify(name)} is refused with a typed error`, () => {
      return check(
        fc.oneof(
          fc.constant("processes"),
          fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}/${b}`),
        ),
        [name],
        (name) => {
          const store = storage();
          return Effect.gen(function* () {
            const error = yield* Effect.flip(
              ProcessManager.use((p) => p.start(first(`start:${name}`, name), from())).pipe(
                Effect.provide(manager(store)),
              ),
            );
            expect(error._tag).toBe("ProcessError");
            expect(store.rows()).toEqual([]);
          });
        },
      );
    });
  }

  for (const client of ["processes", "w/x", "counter:1"]) {
    it.effect(`a client recipient id ${JSON.stringify(client)} is refused with a typed error`, () =>
      check(
        fc.oneof(
          fc.constant("processes"),
          fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}/${b}`),
          fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}:${b}`),
        ),
        [client],
        (client) => {
          const store = storage();
          return Effect.gen(function* () {
            yield* ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager(store)));
            const before = store.rows();
            const caller = {
              owner: Owner.cases.brain.make({}),
              recipient: Recipient.cases.client.make({ client, session: X }),
            };
            const error = yield* Effect.flip(
              ProcessManager.use((p) => p.monitor("window:1", A, from())).pipe(Effect.provide(manager(store, caller))),
            );
            expect(error._tag).toBe("ProcessError");
            expect(store.rows()).toEqual(before);
          });
        },
      ),
    );
  }
});

describe("P33, the brain writes process facts and `parent` keeps who asked", () => {
  it.effect("a start by caller X is written as the brain's key, with a parent that leads to X", () =>
    check(fc.string({ minLength: 1 }), ["SHA256:caller-x"], (X_KEY) => {
      const store = storage();
      const asked = `in-${W}-7`;
      return Effect.gen(function* () {
        yield* Ledger.use((ledger) =>
          ledger.append(
            "caller-x/inbox",
            asked,
            lineFor(from({ by: X_KEY }), { _tag: "send", m: { start: "counter:1" } }),
          ),
        );
        yield* ProcessManager.use((p) => p.start(first(), from({ by: X_KEY, parent: asked })));
        const written = store.rows().filter((row) => Object.hasOwn(ProcessFact.cases, row._tag));
        expect(written.map((row) => row._tag)).toEqual(["registered", "started"]);

        for (const row of written) {
          expect(row.by).toBe(brain().by);
          const cause = store.rows().find((entry) => entry.id === row.parent);
          expect(cause?.by).toBe(X_KEY);
        }
      }).pipe(Effect.provide(manager(store, watcher(W))));
    }),
  );
});
