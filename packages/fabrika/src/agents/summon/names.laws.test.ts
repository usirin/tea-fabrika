import { arbMsg, arbMsgSequence, arbRecordMsg, type MsgArbitraryTable } from "@demlik/tea/pbt";
import { Effect } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { memoryStorage, type Storage } from "../../program/storage.ts";
import { type Name, openNames } from "./names.ts";

// The laws of `names`, the kept machine of summoned names (the summon tryout, PR 1, ticket 237),
// today's version. The machine is not exported, so it is reached as the manager reaches it:
// through `openNames` on a storage, `take` for its `taken` Msg and `free` for `freed`. The lists
// of Msgs come from tea's pbt, and every step is checked against a plain model: a name is one
// agent until it is freed (S3, Erlang's `register`).
//
//   take scout (run r1)    true    names: [scout r1]
//   take scout (run r2)    false   names: [scout r1]: the clash is refused, the first one kept
//   free scout                     names: []
//
// What this file does not cover, since names.ts does not hold it: the name rule (lower case,
// reserved words), which shell/check.ts and the manager hold; one name list shared by people,
// agents and connectors (decided 2026-11-07), which no code holds yet; a name unique per
// person, since names.ts keeps one list for the host and only records `by`.

const WORDS = ["scout", "researcher", "a", "b-2"] as const;
const PEOPLE = ["user:owner", "user:teammate"] as const;

/** The two Msgs of `names`, as `take` and `free` send them. */
type NamesMsg = { readonly type: "taken"; readonly name: Name } | { readonly type: "freed"; readonly name: string };

const entry = fc.record({
  name: fc.constantFrom(...WORDS),
  agent: fc.constantFrom("fake", "claude"),
  run: fc.constant(""),
  model: fc.record({
    typed: fc.constantFrom(null, "fake-large"),
    resolved: fc.constantFrom(null, "fake-large"),
  }),
  effort: fc.record({ typed: fc.constantFrom(null, "high"), set: fc.constantFrom(null, "high") }),
  folder: fc.constant("/repo"),
  since: fc.integer({ min: 0, max: 1000 }),
  by: fc.constantFrom(...PEOPLE),
});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<NamesMsg> = {
  taken: arbRecordMsg("taken", { name: entry }),
  freed: arbRecordMsg("freed", { name: fc.constantFrom(...WORDS, "nobody") }),
};

const lists = arbMsgSequence(arbMsg(table), { maxLength: 30 });
const OPTS = { numRuns: 100, seed: 1 };

/** Each take gets a run id of its own, as each acp run has one. */
const withRuns = (msgs: readonly NamesMsg[]): readonly NamesMsg[] =>
  msgs.map((m, i) => (m.type === "taken" ? { ...m, name: { ...m.name, run: `acp:${i}` } } : m));

/** The model: names in the order taken, a taken name refused, a freed one gone. */
const modelStep = (s: readonly Name[], m: NamesMsg): readonly Name[] =>
  m.type === "taken"
    ? s.some((n) => n.name === m.name.name)
      ? s
      : [...s, m.name]
    : s.filter((n) => n.name !== m.name);

/** Play `msgs` on names kept in `storage`: after each, take's answer and the names. */
const play = (storage: Storage, msgs: readonly NamesMsg[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kept = yield* openNames(storage);
      const steps: { readonly took: boolean | null; readonly names: readonly Name[] }[] = [];

      for (const m of msgs) {
        const took = m.type === "taken" ? yield* kept.take(m.name) : null;

        if (m.type === "freed") {
          yield* kept.free(m.name);
        }

        steps.push({ took, names: kept.now().names });
      }

      return steps;
    }).pipe(Effect.scoped),
  );

/** The names a fresh open of `storage` finds, as a host started again does. */
const reopened = (storage: Storage) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return (yield* openNames(storage)).now().names;
    }).pipe(Effect.scoped),
  );

describe("the laws of names, the kept summoned names", () => {
  it("refuses a taken name even when the requested run belongs to another name", async () => {
    const first: Name = {
      name: "scout",
      agent: "fake",
      run: "acp:1",
      model: { typed: null, resolved: null },
      effort: { typed: null, set: null },
      folder: "/repo",
      since: 0,
      by: "user:owner",
    };
    const other = { ...first, name: "researcher", run: "acp:2" };
    const steps = await play(memoryStorage(), [
      { type: "taken", name: first },
      { type: "taken", name: other },
      { type: "taken", name: { ...other, name: "scout" } },
    ]);
    expect(steps.at(-1)?.names).toEqual([first, other]);
    expect(steps.map((s) => s.took)).toEqual([true, true, false]);
  });

  it("follows the model after every step: a clash refused, a free taking only that name", async () => {
    await fc.assert(
      fc.asyncProperty(lists, async (raw) => {
        const msgs = withRuns(raw);
        const steps = await play(memoryStorage(), msgs);
        let model: readonly Name[] = [];

        for (const [i, m] of msgs.entries()) {
          model = modelStep(model, m);
          expect(steps[i]?.names).toEqual(model);
        }
      }),
      OPTS,
    );
  });

  it("never holds one name twice", async () => {
    await fc.assert(
      fc.asyncProperty(lists, async (raw) => {
        for (const step of await play(memoryStorage(), withRuns(raw))) {
          const words = step.names.map((n) => n.name);
          expect(new Set(words).size).toBe(words.length);
        }
      }),
      OPTS,
    );
  });

  it("take answers true exactly when the name was free, and a refused take changes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(lists, async (raw) => {
        const msgs = withRuns(raw);
        const steps = await play(memoryStorage(), msgs);
        const befores = [[], ...steps.map((st) => st.names)];
        // Each take: was the name free before, and the names after a refused one.
        const seen = msgs.flatMap((m, i) =>
          m.type === "taken" ? [{ took: steps[i]?.took, after: steps[i]?.names }] : [],
        );
        const want = msgs.flatMap((m, i) => {
          if (m.type !== "taken") {
            return [];
          }

          const before = befores[i] ?? [];
          const free = !before.some((n) => n.name === m.name.name);
          return [{ took: free, after: free ? steps[i]?.names : before }];
        });
        expect(seen).toEqual(want);
      }),
      OPTS,
    );
  });

  // S-9's ground: a host started again finds every name, with the run that opens its session.
  it("keeps the names across a restart: a fresh open finds them as they were", async () => {
    await fc.assert(
      fc.asyncProperty(lists, async (raw) => {
        const storage = memoryStorage();
        const steps = await play(storage, withRuns(raw));
        expect(await reopened(storage)).toEqual(steps.at(-1)?.names ?? []);
      }),
      OPTS,
    );
  });

  it("refuses a second agent under a taken name whoever asks, and keeps the first", async () => {
    const first: Name = {
      name: "scout",
      agent: "fake",
      run: "acp:1",
      model: { typed: null, resolved: null },
      effort: { typed: null, set: null },
      folder: "/repo",
      since: 0,
      by: "user:owner",
    };
    const steps = await play(memoryStorage(), [
      { type: "taken", name: first },
      { type: "taken", name: { ...first, run: "acp:2", agent: "claude", by: "user:teammate" } },
    ]);
    expect(steps.map((s) => s.took)).toEqual([true, false]);
    expect(steps.at(-1)?.names).toEqual([first]);
  });
});
