// Ticket 806, slice 1, next/: the checklist at the runner (L9, L10), a suite the part that owns a
// real SQLite driver runs (0062, plan amendment A2): `RunnerTest.suite(open, fresh)`. A program may
// import only the library's front, so the runner's wiring over the library's inner pieces is the
// app's (`checklist-runner.laws.test.ts`); this file holds the laws. Each run opens three database
// files in a fresh folder, and a reopen closes all three and opens them again.
// Ticket 839, slice 1 (0137): L9 sends `check` with and without a note, L16 resends a letter by its
// id (p53's checklist form), L17 reads the saved letter's note and writer back (p52's checklist form).
import { describe, expect, it } from "@effect/vitest";
import type { ProgramRunner } from "@kampus/libfabrika";
import { Arbitrary, Effect, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { checklist } from "./program.ts";

const SEED = 119120;
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
/** The plan's one day, written out here so the law does not read it from the code it checks. */
const DAY = 86_400_000;
/** The plan's longest note, written out as `DAY` is. */
const MOST = 256;

type Runner = ProgramRunner["Service"];

/** A writer as the door stamps it on a letter, made by the part that supplies it: the suite only
 *  carries it, and knows a person's from an agent's by which one it was given. */
export type Writer = unknown;

/** A letter as the process's inbox saved it: its id, its input, its writer's checked key and clock. */
export type Saved = { readonly id: string; readonly m: unknown; readonly by: string; readonly sentAt: string };

/** What the part owning the driver and the library's inner pieces supplies, in a fresh folder of
 *  three database files: `start` runs one session of the runner over them, each time on new
 *  connections closed with its scope, with `program` loaded and every alarm it sets pushed to
 *  `alarms`; the two writers it stamps and the checked key of each; and `letters`, every letter
 *  the process's inbox holds, read on a connection of its own. */
export type Open = Effect.Effect<
  {
    readonly start: (
      program: typeof checklist,
      alarms: Array<number | null>,
    ) => Effect.Effect<Runner, never, Scope.Scope>;
    readonly person: Writer;
    readonly agent: Writer;
    readonly key: (writer: Writer) => string;
    readonly letters: Effect.Effect<ReadonlyArray<Saved>>;
  },
  never,
  Scope.Scope
>;

/** What the module owning the process supplies: the program loaded again from its module, as a
 *  restarted process loads it, so a reopen keeps only what the program saved. */
export type Fresh = Effect.Effect<typeof checklist>;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A delivered input with a fresh id: the `n`th of its run, sent on the writer's own clock. */
const letter = (n: number, by: Writer, input: unknown, sentAt = "writer clock") => ({
  id: `checklist-${n}`,
  envelope: {
    id: `input_0000000000e0080000000000${ALPHABET[(n >> 5) % 32]}${ALPHABET[n % 32]}`,
    by,
    arrivedAt: n,
    input,
  },
  sentAt,
  seen: 0,
  span: TRACE,
});

/** What a law reads of the view: each item's name, state word and note, by name, and the count left. */
const View = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String, note: Schema.NullOr(Schema.String) })),
  left: Schema.Int,
});

const shown = (view: unknown) => {
  const v = Schema.decodeUnknownSync(View)(view);
  return {
    items: v.items
      .map((i) => ({ name: i.name, state: i.state, note: i.note }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    left: v.left,
  };
};

/** Only the letters this suite sent: the runner's own timers are not a writer's. */
const sent = (letters: ReadonlyArray<Saved>) => letters.filter((l) => l.id.startsWith("checklist-"));

const NAMES = ["git", "node", "pnpm", "volta"] as const;
const INPUTS = ["add", "rename", "remove", "check", "uncheck"] as const;
/** A wall, not a setting (plan, "Settings"): only a person may add, rename or remove. */
const PERSON_ONLY: ReadonlySet<string> = new Set(["add", "rename", "remove"]);

/** A `check`'s note: none, 1 character, exactly `MOST`, or one past it, which no writer may send. */
const NOTES = { none: undefined, one: "n", most: "m".repeat(MOST), over: "o".repeat(MOST + 1) } as const;

/** One move's entropy: which input, whose, which item, and a `check`'s note. What it names is read
 *  off the record. */
const Step = Arbitrary.all({
  input: Arbitrary.schema(Schema.Literals(INPUTS)),
  by: Arbitrary.schema(Schema.Literals(["agent", "person"])),
  pick: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))),
  note: Arbitrary.schema(Schema.Literals(["none", "one", "most", "over"])),
});
type Step = typeof Step extends Arbitrary.Arbitrary<infer A> ? A : never;
const Walk = Arbitrary.array(Step, { minLength: 4, maxLength: 16 });

/** An item as the record keeps it: checked or not, and the note its first `check` wrote. */
type Kept = { readonly done: boolean; readonly note: string | null };

/** The record's view: no timer fires in L9 or L16, so an item is `new` until it is checked. */
const recorded = (items: ReadonlyMap<string, Kept>) => ({
  items: [...items]
    .map(([name, { done, note }]) => ({ name, state: done ? "checked" : "new", note: done ? note : null }))
    .sort((a, b) => (a.name < b.name ? -1 : 1)),
  left: [...items.values()].filter((i) => !i.done).length,
});

/** The input a step sends, named from what the record holds; `null` when nothing fits it. A `check`
 *  may name a checked item: it is accepted and changes nothing. */
const named = (items: ReadonlyMap<string, Kept>, step: Step): Record<string, string> | null => {
  const here = [...items.keys()];
  const free = NAMES.filter((n) => !items.has(n));
  const name = here[step.pick % Math.max(here.length, 1)];
  const fresh = free[(step.pick >> 2) % Math.max(free.length, 1)];

  switch (step.input) {
    case "add":
      return fresh === undefined ? null : { type: "add", name: fresh };
    case "rename":
      return name === undefined || fresh === undefined ? null : { type: "rename", name, to: fresh };
    case "check": {
      const note = NOTES[step.note];
      return name === undefined ? null : note === undefined ? { type: "check", name } : { type: "check", name, note };
    }
    default:
      return name === undefined ? null : { type: step.input, name };
  }
};

/** Whether an input is outside the Msg's shape: a note past `MOST`. */
const malformed = (input: Record<string, string>) => (input["note"]?.length ?? 0) > MOST;

/** The record after an accepted input. A `check` on a checked item keeps the first note. */
const apply = (items: Map<string, Kept>, input: Record<string, string>) => {
  const name = input["name"] ?? "";
  const was = items.get(name) ?? { done: false, note: null };

  switch (input["type"]) {
    case "add":
      items.set(name, { done: false, note: null });
      return;
    case "rename":
      items.delete(name);
      items.set(input["to"] ?? "", was);
      return;
    case "remove":
      items.delete(name);
      return;
    case "check":
      items.set(name, was.done ? was : { done: true, note: input["note"] ?? null });
      return;
    default:
      items.set(name, { done: false, note: null });
  }
};

/** L16's moves: a fresh input as L9 draws it, or a retry of an accepted letter, `pick` choosing which. */
const Retried = Arbitrary.array(
  Arbitrary.all({ step: Step, retry: Arbitrary.schema(Schema.Literals(["fresh", "fresh", "retry"])) }),
  { minLength: 6, maxLength: 20 },
);

/** L17's note: any text of 1 to `MOST` characters, or `MOST` characters of four UTF-8 bytes each. */
const AnyNote = Arbitrary.flatMap(Arbitrary.schema(Schema.Literals(["any", "any", "wide"])), (kind) =>
  kind === "wide"
    ? Arbitrary.Constant("\u{1F642}".repeat(MOST / 2))
    : Arbitrary.schema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MOST))),
);

/** A writer's clock, skewed from the referee's by up to a day either way. */
const Skew = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: -DAY, maximum: DAY })));
const BASE = Date.parse("2026-11-11T00:00:00.000Z");

export const suite = (open: Open, fresh: Fresh) =>
  describe("ticket 806 the checklist at the runner", () => {
    it.live.prop(
      "L9: an agent's add, rename and remove are refused, its check with or without a note and uncheck accepted, a note past the wall bad_msg and unwritten, a person's five all accepted",
      [Walk],
      ([steps]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { start, person, agent, letters } = yield* open;
            const r = yield* start(checklist, []);
            const items = new Map<string, Kept>();
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
              const saved = (yield* letters).length;
              const answer = yield* r.msg(letter(++n, by, input));
              const refusable = items.has(input["name"] ?? "") && input["type"] === "add";
              const walled = step.by === "agent" && PERSON_ONLY.has(input["type"] ?? "");
              const bad = malformed(input);
              // Until the 0125 code batch names its reason, a walled input is `refused` (bad_msg today).
              expect(answer._tag, `${step.by} ${JSON.stringify(input)}`).toBe(
                walled || refusable || bad ? "refused" : "accepted",
              );

              if (bad) {
                expect(answer._tag === "refused" ? answer.reason : null, "a note past the wall does not decode").toBe(
                  "bad_msg",
                );
              }

              if (!walled && !refusable && !bad) {
                apply(items, input);
              }

              const after = shown((yield* r.open("after")).view);
              expect(after, "the view is the record's").toEqual(recorded(items));
              expect(walled || refusable || bad ? after : before, "a refused input changes nothing").toEqual(before);
              expect((yield* letters).length - saved, "a refused input writes no letter").toBe(
                walled || refusable || bad ? 0 : 1,
              );
            }
          }),
        ),
      { timeout: 600_000, arbitrary: { seed: SEED, runs: 12 } },
    );

    it.live.prop(
      "L16: a letter sent again with its id, after later letters, is one accepted row and its first answer, and keeps its first note",
      [Retried],
      ([moves]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { start, person, agent, letters } = yield* open;
            const r = yield* start(checklist, []);
            const items = new Map<string, Kept>();
            const accepted: Array<{ readonly sent: ReturnType<typeof letter>; readonly answer: unknown }> = [];
            let n = 0;

            for (const input of [
              { type: "add", name: "git" },
              { type: "add", name: "node" },
              { type: "check", name: "node", note: "first" },
            ]) {
              const sent = letter(++n, person, input);
              const answer = yield* r.msg(sent);
              expect(answer._tag).toBe("accepted");
              accepted.push({ sent, answer });
              apply(items, input);
            }

            for (const { step, retry } of moves) {
              const before = shown((yield* r.open("before")).view);
              const rows = sent(yield* letters).length;

              if (retry === "retry") {
                const first = accepted[step.pick % accepted.length];

                if (first !== undefined) {
                  // The same letter, id and body, sent again after later letters.
                  expect(yield* r.msg(first.sent), `a retry of ${first.sent.id}`).toEqual(first.answer);
                  expect(shown((yield* r.open("after")).view), "a retry changes nothing").toEqual(before);
                  expect(sent(yield* letters).length, "a retry writes no row").toBe(rows);
                  continue;
                }
              }

              const input = named(items, step) ?? { type: "add", name: "git" };
              const fresh = letter(++n, step.by === "agent" ? agent : person, input);
              const answer = yield* r.msg(fresh);
              const ok =
                !(step.by === "agent" && PERSON_ONLY.has(input["type"] ?? "")) &&
                !(items.has(input["name"] ?? "") && input["type"] === "add") &&
                !malformed(input);
              expect(answer._tag, `${step.by} ${JSON.stringify(input)}`).toBe(ok ? "accepted" : "refused");

              if (ok) {
                accepted.push({ sent: fresh, answer });
                apply(items, input);
              }

              expect(shown((yield* r.open("after")).view), "the view is the record's").toEqual(recorded(items));
              expect(sent(yield* letters).length, "a fresh accepted letter is one new row").toBe(rows + (ok ? 1 : 0));
            }

            // Every accepted id is in the inbox exactly once, holding the body it was first sent with.
            const ids = sent(yield* letters).map((l) => l.id);
            expect([...ids].sort()).toEqual(accepted.map((a) => a.sent.id).sort());
            const saved = new Map(sent(yield* letters).map((l) => [l.id, l.m]));

            for (const { sent: first } of accepted) {
              expect(saved.get(first.id), first.id).toEqual(first.envelope.input);
            }
          }),
        ),
      { timeout: 600_000, arbitrary: { seed: SEED, runs: 50 } },
    );

    it.effect.prop(
      "L17: a saved check keeps its note's exact bytes and its writer's checked key, and a writer clock skewed up to a day never changes the model",
      [AnyNote, Skew, Arbitrary.schema(Schema.Literals(["agent", "person"]))],
      ([note, skew, side]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { start, person, agent, key, letters } = yield* open;
            const alarms: Array<number | null> = [];
            const r = yield* start(checklist, alarms);
            const writer = side === "agent" ? agent : person;
            const clock = new Date(BASE + skew).toISOString();
            const view = r.open("watch").pipe(Effect.map((o) => shown(o.view)));
            const one = (state: string, n: string | null) => ({
              items: [{ name: "git", state, note: n }],
              left: state === "checked" ? 0 : 1,
            });

            expect((yield* r.msg(letter(1, person, { type: "add", name: "git" }, clock)))._tag).toBe("accepted");
            yield* TestClock.setTime(1000);
            yield* r.due(0);
            expect(yield* view, "the referee's time stamps it, not the writer's").toEqual(one("open", null));
            expect(alarms.at(-1), "since is the timer's arrivedAt").toBe(1000 + DAY);
            expect((yield* letters).find((l) => !l.id.startsWith("checklist-"))?.m).toEqual({
              type: "timer",
              at: 0,
              arrivedAt: 1000,
            });

            const check = letter(2, writer, { type: "check", name: "git", note }, clock);
            expect((yield* r.msg(check))._tag).toBe("accepted");
            expect(yield* view).toEqual(one("checked", note));
            expect(alarms.at(-1), "nothing is left to wake for").toBeNull();

            const saved = (yield* letters).find((l) => l.id === check.id);
            const m = Schema.decodeUnknownSync(Schema.Struct({ note: Schema.String }))(saved?.m);
            expect(new TextEncoder().encode(m.note), "the note's exact bytes").toEqual(new TextEncoder().encode(note));
            expect(saved?.by, "the writer's checked key").toBe(key(writer));
            expect(saved?.sentAt, "the writer's own clock, kept as it came").toBe(clock);

            expect((yield* r.msg(letter(3, person, { type: "uncheck", name: "git" }, clock)))._tag).toBe("accepted");
            yield* TestClock.setTime(5000);
            yield* r.due(5000);
            expect(yield* view).toEqual(one("open", null));
            expect(alarms.at(-1), "a second stamp is the second timer's arrivedAt").toBe(5000 + DAY);
          }),
        ),
      { timeout: 600_000, arbitrary: { seed: SEED, runs: 50 } },
    );

    it.effect(
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
                { name: "git", state: git, note: null },
                { name: "node", state: "checked", note: null },
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
                yield* TestClock.setTime(1000);
                yield* r.due(0);
                expect(yield* view(r), "the alarm fired after the reopen stamps").toEqual(both("open"));
                expect(alarms.at(-1)).toBe(1000 + DAY);
              }),
            );
            yield* reopen((r) =>
              Effect.gen(function* () {
                expect(yield* view(r)).toEqual(both("open"));
                expect(alarms.at(-1), "the stamp is saved, not held in memory").toBe(1000 + DAY);
                yield* TestClock.setTime(1000 + DAY - 1);
                yield* r.due(1000 + DAY - 1);
                expect(yield* view(r), "not late a millisecond early").toEqual(both("open"));
                yield* TestClock.setTime(1000 + DAY);
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
