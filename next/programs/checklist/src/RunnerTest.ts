// Ticket 806, slice 1, next/: the checklist at the runner (L9, L10), a suite the part that owns a
// real SQLite driver runs (0062, plan amendment A2): `RunnerTest.suite(open, fresh)`. A program may
// import only the library's front, so the runner's wiring over the library's inner pieces is the
// app's (`checklist-runner.laws.test.ts`); this file holds the laws. Each run opens three database
// files in a fresh folder, and a reopen closes all three and opens them again.
import { describe, expect, it } from "@effect/vitest";
import type { ProgramRunner } from "@kampus/libfabrika";
import { Arbitrary, Effect, Schema, type Scope } from "effect";
import { checklist } from "./program.ts";

const SEED = 119120;
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
/** The plan's one day, written out here so the law does not read it from the code it checks. */
const DAY = 86_400_000;

type Runner = ProgramRunner["Service"];

/** A writer as the door stamps it on a letter, made by the part that supplies it: the suite only
 *  carries it, and knows a person's from an agent's by which one it was given. */
export type Writer = unknown;

/** What the part owning the driver and the library's inner pieces supplies, in a fresh folder of
 *  three database files: `start` runs one session of the runner over them, each time on new
 *  connections closed with its scope, with `program` loaded and every alarm it sets pushed to
 *  `alarms`; and the two writers it stamps. */
export type Open = Effect.Effect<
  {
    readonly start: (
      program: typeof checklist,
      alarms: Array<number | null>,
    ) => Effect.Effect<Runner, never, Scope.Scope>;
    readonly person: Writer;
    readonly agent: Writer;
  },
  never,
  Scope.Scope
>;

/** What the module owning the process supplies: the program loaded again from its module, as a
 *  restarted process loads it, so a reopen keeps only what the program saved. */
export type Fresh = Effect.Effect<typeof checklist>;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A delivered input with a fresh id: the `n`th of its run. */
const letter = (n: number, by: Writer, input: unknown) => ({
  id: `checklist-${n}`,
  envelope: {
    id: `input_0000000000e0080000000000${ALPHABET[(n >> 5) % 32]}${ALPHABET[n % 32]}`,
    by,
    arrivedAt: n,
    input,
  },
  sentAt: "writer clock",
  seen: 0,
  span: TRACE,
});

/** What a law reads of the view: each item's name and state word, by name, and the count left. */
const View = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String })),
  left: Schema.Int,
});

const shown = (view: unknown) => {
  const v = Schema.decodeUnknownSync(View)(view);
  return {
    items: v.items.map((i) => ({ name: i.name, state: i.state })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    left: v.left,
  };
};

const NAMES = ["git", "node", "pnpm", "volta"] as const;
const INPUTS = ["add", "rename", "remove", "check", "uncheck"] as const;
/** A wall, not a setting (plan, "Settings"): only a person may add, rename or remove. */
const PERSON_ONLY: ReadonlySet<string> = new Set(["add", "rename", "remove"]);

/** One move's entropy: which input, whose, and which item. What it names is read off the record. */
const Step = Arbitrary.all({
  input: Arbitrary.schema(Schema.Literals(INPUTS)),
  by: Arbitrary.schema(Schema.Literals(["agent", "person"])),
  pick: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))),
});
type Step = typeof Step extends Arbitrary.Arbitrary<infer A> ? A : never;
const Walk = Arbitrary.array(Step, { minLength: 4, maxLength: 16 });

/** The record's view: no timer fires in L9, so an item is `new` until it is checked. */
const recorded = (items: ReadonlyMap<string, boolean>) => ({
  items: [...items]
    .map(([name, done]) => ({ name, state: done ? "checked" : "new" }))
    .sort((a, b) => (a.name < b.name ? -1 : 1)),
  left: [...items.values()].filter((done) => !done).length,
});

/** The input a step sends, named from what the record holds; `null` when nothing fits it. */
const named = (items: ReadonlyMap<string, boolean>, step: Step): Record<string, string> | null => {
  const here = [...items.keys()];
  const free = NAMES.filter((n) => !items.has(n));
  const name = here[step.pick % Math.max(here.length, 1)];
  const fresh = free[(step.pick >> 2) % Math.max(free.length, 1)];

  switch (step.input) {
    case "add":
      return fresh === undefined ? null : { type: "add", name: fresh };
    case "rename":
      return name === undefined || fresh === undefined ? null : { type: "rename", name, to: fresh };
    default:
      return name === undefined ? null : { type: step.input, name };
  }
};

/** The record after an accepted input. */
const apply = (items: Map<string, boolean>, input: Record<string, string>) => {
  const name = input["name"] ?? "";

  switch (input["type"]) {
    case "add":
      items.set(name, false);
      return;
    case "rename": {
      const done = items.get(name) ?? false;
      items.delete(name);
      items.set(input["to"] ?? "", done);
      return;
    }
    case "remove":
      items.delete(name);
      return;
    default:
      items.set(name, input["type"] === "check");
  }
};

export const suite = (open: Open, fresh: Fresh) =>
  describe("ticket 806 the checklist at the runner", () => {
    it.live.prop(
      "L9: an agent's add, rename and remove are refused, its check and uncheck accepted, a person's five all accepted",
      [Walk],
      ([steps]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { start, person, agent } = yield* open;
            const r = yield* start(checklist, []);
            const items = new Map<string, boolean>();
            let n = 0;

            // Two items, one checked, so an agent's first move has something to name.
            for (const input of [
              { type: "add", name: "git" },
              { type: "add", name: "node" },
              { type: "check", name: "node" },
            ]) {
              expect((yield* r.msg(letter(++n, person, input)))._tag).toBe("accepted");
              apply(items, input);
            }

            for (const step of steps) {
              const input = named(items, step) ?? { type: "add", name: "git" };
              const by = step.by === "agent" ? agent : person;
              const before = shown((yield* r.open("before")).view);
              const sent = yield* r.msg(letter(++n, by, input));
              const refusable = items.has(input["name"] ?? "") && input["type"] === "add";
              const walled = step.by === "agent" && PERSON_ONLY.has(input["type"] ?? "");
              // Until the 0125 code batch names its reason, a walled input is `refused` (bad_msg today).
              expect(sent._tag, `${step.by} ${JSON.stringify(input)}`).toBe(
                walled || refusable ? "refused" : "accepted",
              );

              if (!walled && !refusable) {
                apply(items, input);
              }

              const after = shown((yield* r.open("after")).view);
              expect(after, "the view is the record's").toEqual(recorded(items));
              expect(walled || refusable ? after : before, "a refused input changes nothing").toEqual(before);
            }
          }),
        ),
      { timeout: 600_000, arbitrary: { seed: SEED, runs: 12 } },
    );

    it.live(
      "L10 scenario: a restart between an add and its timer keeps the items and states, and a fired alarm after it still stamps",
      () =>
        // The plan's scenario: close the three files mid-list and reopen, at each point where the
        // saved stamp matters: before the stamp, after it, and after the item goes late. Each reopen
        // runs a fresh load of the program, as a new process would, so nothing it kept in memory stays.
        Effect.scoped(
          Effect.gen(function* () {
            const { start, person } = yield* open;
            const alarms: Array<number | null> = [];
            const reopen = <A, E>(f: (r: Runner) => Effect.Effect<A, E>) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const r = yield* start(yield* fresh, alarms);
                  return yield* f(r);
                }),
              );
            const view = (r: Runner) => r.open("watch").pipe(Effect.map((o) => shown(o.view)));
            const both = (git: string) => ({
              items: [
                { name: "git", state: git },
                { name: "node", state: "checked" },
              ],
              left: 1,
            });

            yield* reopen((r) =>
              Effect.gen(function* () {
                yield* r.msg(letter(1, person, { type: "add", name: "git" }));
                yield* r.msg(letter(2, person, { type: "add", name: "node" }));
                yield* r.msg(letter(3, person, { type: "check", name: "node" }));
                expect(yield* view(r)).toEqual(both("new"));
                expect(alarms.at(-1), "a new item asks for the alarm at once").toBe(0);
              }),
            );
            yield* reopen((r) =>
              Effect.gen(function* () {
                expect(yield* view(r), "the items and states come back").toEqual(both("new"));
                expect(alarms.at(-1), "the reopened runner asks for the alarm at once again").toBe(0);
                yield* r.due(1000);
                expect(yield* view(r), "the alarm fired after the reopen stamps").toEqual(both("open"));
                expect(alarms.at(-1)).toBe(1000 + DAY);
              }),
            );
            yield* reopen((r) =>
              Effect.gen(function* () {
                expect(yield* view(r)).toEqual(both("open"));
                expect(alarms.at(-1), "the stamp is saved, not held in memory").toBe(1000 + DAY);
                yield* r.due(1000 + DAY - 1);
                expect(yield* view(r), "not late a millisecond early").toEqual(both("open"));
                yield* r.due(1000 + DAY);
                expect(yield* view(r)).toEqual(both("late"));
              }),
            );
            yield* reopen((r) =>
              Effect.gen(function* () {
                expect(yield* view(r)).toEqual(both("late"));
                expect(alarms.at(-1), "nothing is left to wake for").toBeNull();
              }),
            );
          }),
        ),
      { timeout: 600_000 },
    );
  });
