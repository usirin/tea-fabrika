// Ticket 806, slice 1, next/: the checklist at the runner (L9, L10), a suite the module that owns a
// real SQLite driver runs (0062, plan amendment A2): `RunnerTest.suite(open)`. It names the shared
// `Sql` type and libfabrika's services, and no driver. Each run opens three database files in a
// fresh folder (the inbox's ledger, the process store, the brain's process table), and a reopen
// closes all three and opens them again.
import { describe, expect, it } from "@effect/vitest";
import { Alarm, CheckedWriter, Id, ProgramLoader, ProgramRunner, Recording, WatcherManager } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import type { Sql } from "@kampus/libfabrika/Sql";
import { Arbitrary, Effect, Layer, Schema, type Scope } from "effect";
import { checklist } from "./program.ts";

const SEED = 119120;
const NAME = "checklist:1";
const BUILD = "checklist-build";
const BRAIN = "SHA256:brain";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
/** The plan's one day, written out here so the law does not read it from the code it checks. */
const DAY = 86_400_000;

/** What the module owning the driver supplies: a fresh folder, and in it, each call opens the
 *  named database file again over a new connection, closed with its scope. */
export type Open = Effect.Effect<(name: string) => Effect.Effect<Sql, never, Scope.Scope>, never, Scope.Scope>;

const person = Writer.cases.person.make({ key: "SHA256:person", for: "person" });
const agent = Writer.cases.agent.make({ key: "SHA256:agent", for: "agent" });

const brainFrom = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE.traceId,
  build: BUILD,
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const nextProcess = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.provide(Id.Generator.layer),
  Effect.orDie,
);

const managerLayer = (sql: Sql) =>
  ProcessManager.layer(
    {
      by: BRAIN,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000003" }),
    },
    nextProcess,
  ).pipe(Layer.provide(LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet))));

/** One session of the runner over the folder's three files. `alarms` keeps every time it sets. */
const session = (files: (name: string) => Effect.Effect<Sql, never, Scope.Scope>, alarms: Array<number | null>) =>
  Effect.gen(function* () {
    const ledger = yield* files("ledger");
    const store = yield* files("process");
    const manager = yield* files("manager");
    const started = Layer.effectDiscard(
      ProcessManager.use((m) =>
        m.status(NAME).pipe(
          Effect.catch(() =>
            m.start(
              Start.cases.first.make({
                id: `boot:${NAME}`,
                name: NAME,
                code: { program: checklist.name, hash: BUILD },
              }),
              brainFrom,
            ),
          ),
        ),
      ).pipe(Effect.orDie),
    ).pipe(Layer.provideMerge(managerLayer(manager)));
    const process = yield* ProcessManager.use((m) => m.status(NAME)).pipe(
      Effect.map((s) => s.state.process),
      Effect.provide(started),
      Effect.orDie,
    );
    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return CheckedWriter.of({
          append: (i) =>
            mailbox.send(NAME, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build: BUILD,
            }),
          commit: () => Effect.die("the checklist declares no write"),
          own: () => Effect.die("the checklist declares no write"),
        });
      }),
    );
    return ProgramRunner.layer(
      { id: process, name: NAME, program: checklist.name, build: BUILD, owner: person },
      { recovery: { sql: store, name: NAME, capacity: 1024 ** 3 } },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          managerLayer(manager),
          ProgramLoader.layer({ [checklist.name]: checklist }, {}),
          ProcessStore.layer(store, { process }),
          checked,
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Alarm, { set: (at: number | null) => Effect.sync(() => void alarms.push(at)) }),
          Layer.succeed(Recording, { flush: Effect.void }),
        ).pipe(
          Layer.provideMerge(
            Mailbox.layer.pipe(
              Layer.provideMerge(LedgerSql.layer(ledger, { reader: "checklist-law" }).pipe(Layer.provide(quiet))),
            ),
          ),
        ),
      ),
    );
  });

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

export const suite = (open: Open) =>
  describe("ticket 806 the checklist at the runner", () => {
    it.live.prop(
      "L9: an agent's add, rename and remove are refused, its check and uncheck accepted, a person's five all accepted",
      [Walk],
      ([steps]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const files = yield* open;
            const r = yield* ProgramRunner.pipe(Effect.provide(yield* session(files, [])));
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
              const walled = by._tag === "agent" && PERSON_ONLY.has(input["type"] ?? "");
              // Until the 0125 code batch names its reason, a walled input is `refused` (bad_msg today).
              expect(sent._tag, `${by._tag} ${JSON.stringify(input)}`).toBe(
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
        // saved stamp matters: before the stamp, after it, and after the item goes late.
        Effect.scoped(
          Effect.gen(function* () {
            const files = yield* open;
            const alarms: Array<number | null> = [];
            const reopen = <A, E>(f: (r: ProgramRunner["Service"]) => Effect.Effect<A, E>) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const r = yield* ProgramRunner.pipe(Effect.provide(yield* session(files, alarms)));
                  return yield* f(r);
                }),
              );
            const view = (r: ProgramRunner["Service"]) => r.open("watch").pipe(Effect.map((o) => shown(o.view)));
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
