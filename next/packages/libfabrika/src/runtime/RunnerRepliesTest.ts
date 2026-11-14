// P13 slice 1, next/. The runner's terminal-reply laws, a suite that the module owning a real
// SQLite driver runs (0062): `RunnerRepliesTest.suite(harness)`. A small drafts program keeps one
// version per note and refuses a save on any other base. Each walk picks its next move from the
// state it has reached (current versions, answered letters, stored refusals whose base is still
// ahead) and checks every answer against an independent record of first answers, accepted letters
// and published patches.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { Writer } from "../access/SessionManager.ts";
import { SinkError } from "../coordination/index.ts";
import { InputId } from "../Id.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, type Update, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input } from "./Program.ts";
import type { RepliesError } from "./Replies.ts";
import { capture, nat, nth, parsed, sentinel, text, unleaked } from "./RepliesTest.ts";
import { ProgramRunner, Sent } from "./Runner.ts";

const SEED = 119120;
const RUNS = 100;
const NAME = "drafts:1";
const PROGRAM = "drafts";
const CAPACITY = 1024 ** 3;
/** The brain's writer key: the harness's process table trusts only this writer. */
export const BRAIN = "SHA256:brain";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };

/** What the runner's process store reads from the context: the inbox's ledger. Named through the
 *  store's layer, so this app file names no data module (0043). */
type StoreNeeds = Layer.Services<ReturnType<typeof ProcessStore.layer>>;

/** What the module owning the driver supplies: real database files, and the ledger-backed
 *  services a runner names, over the inbox's and the process table's connections. */
export type Harness = {
  /** A fresh folder; each run of the result opens the named database in it again. */
  readonly files: Effect.Effect<(name: string) => Effect.Effect<Sql, never, Scope.Scope>, never, Scope.Scope>;
  readonly services: (inbox: Sql, manager: Sql) => Layer.Layer<StoreNeeds | Mailbox | ProcessManager>;
};

/** The table that keeps terminal replies, by its own name, so the reply fault lands only on a reply write. */
const REPLIES = "process_replies";

/** The tables main's runner, inbox and process table write. Every other table a runner writes here is
 *  read for a stored reply and scanned for leaked secrets, so a new table cannot hide one. */
const KNOWN = new Set([
  "entries",
  "rings",
  "process_state",
  "process_letters",
  "process_activity",
  "process_recovery",
  "process_watchers",
  "process_receipts",
  "process_connections",
  "unsent",
  "parts",
  "spans",
  "content",
  "rolled",
  "measurements",
  "aggregated",
  "summary",
  "sizes",
  "archived",
  "gateway_state",
  "gateway_starts",
  "gateway_pending",
  "gateway_spent",
  "gateway_bindings",
  "gateway_sessions",
  "gateway_ended",
  "gateway_receipts",
]);

const WRITE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)/i;

const Model = Schema.Struct({ notes: Schema.Record(Schema.String, Schema.Int) });
type Model = typeof Model.Type;

const Save = Schema.Struct({
  type: Schema.Literal("save"),
  note: Schema.String,
  base: Schema.Int,
  body: Schema.String,
});

/** One version per note. A save on any other base is refused with the current version. */
const program = {
  name: PROGRAM,
  machine: Machine.make({
    model: Model,
    msg: Save,
    cmds: [],
    init: (saved) => [saved ?? { notes: {} }, []],
    update: { save: (s, m) => [{ notes: { ...s.notes, [m.note]: (s.notes[m.note] ?? 0) + 1 } }, []] },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Save,
  view: { data: Model, select: (s: Model) => s },
  refuse: (s: Model, m: typeof Save.Type) => {
    const now = s.notes[m.note] ?? 0;
    return m.base === now ? null : { reason: "changed_elsewhere", now };
  },
  inputs: { save: Input.cases.write.make({ schema: Save, description: "Save a note", personOnly: false }) },
  outputs: {},
  writes: {},
  wake: () => null,
} as const;

const NOTES = ["a", "b", "c"] as const;
const BODIES = ["", "same text", "  spaced  \n"] as const;
const lower = text("abcdefghijklmnopqrstuvwxyz0123456789", 8);

/** One move's entropy. Which move it is, and its parameters, are read against the walk's state. */
const Step = Arbitrary.all({
  pick: nat,
  kind: nat,
  ahead: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
  body: Arbitrary.schema(Schema.Literals(BODIES)),
  secret: sentinel,
  key: lower,
  for: lower,
});
type Step = typeof Step extends Arbitrary.Arbitrary<infer A> ? A : never;
const Walk = Arbitrary.array(Step, { minLength: 4, maxLength: 24 });

type Move =
  | "save"
  | "future"
  | "older"
  | "advance"
  | "retry"
  | "reuse"
  | "reopen"
  | "restart"
  | "flush"
  | "fault"
  | "corrupt";

/** R5's damage to a stored refusal: broken JSON, a missing field, a key that disagrees with its
 *  row. R6's: an accepted answer, or a refusal with a malformed reason. */
const DAMAGE = ["json", "missing", "key", "accepted", "malformed"] as const;

/** A refusal whose reason is not text. */
const Malformed = Schema.TaggedStruct("refused", { reason: Schema.Struct({ text: Schema.String }) });

/** A letter the record answered: the delivery as first sent, and its first terminal answer. */
type Answered = { readonly letter: Incoming; readonly first: Sent; readonly note: string; readonly base: number };

/** The armed faults: the recording flush, and the next write to the reply table. */
type Control = { flush: boolean; reply: boolean; hits: number };

/** The recovery connection with one armed fault: its next write to the reply table, never another's. */
const faulty = (sql: Sql, control: Control): Sql => ({
  exec: (query, ...params) => {
    const table = WRITE.exec(query)?.[1];

    if (control.reply && table === REPLIES) {
      control.reply = false;
      control.hits++;
      throw new Error("disk I/O error");
    }

    return sql.exec(query, ...params);
  },
  transaction: (step) => sql.transaction(step),
  size: () => sql.size(),
});

/** The cells of tables main never had that hold this letter's reply as a JSON object. */
const replyRows = (sql: Sql, id: string) =>
  sql
    .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map(({ name }) => String(name))
    .filter((table) => !KNOWN.has(table))
    .flatMap((table) =>
      sql
        .exec(`SELECT * FROM "${table}"`)
        .flatMap((row) =>
          Object.entries(row).flatMap(([column, value]) =>
            typeof value === "string" && parsed(value)?.["id"] === id ? [{ table, column, value }] : [],
          ),
        ),
    );

/** The rows of every table main never had, as text. */
const replyCells = (sql: Sql): ReadonlyArray<string> =>
  sql
    .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map(({ name }) => String(name))
    .filter((table) => !KNOWN.has(table))
    .flatMap((table) => sql.exec(`SELECT * FROM "${table}"`).flatMap((row) => Object.values(row)))
    .filter((cell): cell is string => typeof cell === "string");

let counter = 0;

const inputId = (): typeof InputId.Type => {
  counter = (counter + 1) % 1024;
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  return Schema.decodeUnknownSync(InputId)(
    `input_0000000000e0080000000000${alphabet[counter >> 5]}${alphabet[counter % 32]}`,
  );
};

const walk = (
  harness: Harness,
  enabled: ReadonlyArray<Move>,
  steps: ReadonlyArray<Step>,
  spans: ReturnType<typeof capture>,
) =>
  Effect.gen(function* () {
    const open = yield* harness.files;
    const control: Control = { flush: false, reply: false, hits: 0 };
    const published: Array<Update> = [];
    /** The independent record. */
    const versions = new Map<string, number>();
    const answered: Array<Answered> = [];
    let accepted = 0;
    const secrets: Array<string> = [];
    const errors: Array<string> = [];
    /** Stored refusals the walk damaged, by letter: the damaged cell as written. */
    const damaged = new Map<string, string>();

    let scope = yield* Scope.make();
    let inbox: Sql | undefined;
    let mailbox: Mailbox["Service"] | undefined;
    let runner: ProgramRunner["Service"] | undefined;
    let booted = false;

    const connect = Effect.fnUntraced(function* () {
      inbox = yield* open("inbox").pipe(Scope.provide(scope));
      const manager = yield* open("manager").pipe(Scope.provide(scope));
      const services = harness.services(inbox, manager);
      const coordination = yield* Layer.build(services).pipe(Scope.provide(scope));
      const processes = Context.get(coordination, ProcessManager);
      mailbox = Context.get(coordination, Mailbox);
      const owner = Writer.cases.person.make({ key: "SHA256:owner", for: "person-owner" });
      const meta = {
        by: BRAIN,
        for: "brain",
        sentAt: "2026-11-11T00:00:00Z",
        seen: 0,
        parent: null,
        traceId: TRACE.traceId,
        build: "test",
      };

      if (!booted) {
        yield* processes
          .start(
            Start.cases.first.make({ id: `boot:${NAME}`, name: NAME, code: { program: PROGRAM, hash: "test" } }),
            meta,
          )
          .pipe(Effect.orDie);
        booted = true;
      }

      const live = yield* processes.status(NAME).pipe(Effect.orDie);
      const dependencies = Layer.mergeAll(
        ProgramLoader.layer({ [PROGRAM]: program }, {}),
        ProcessStore.layer(inbox, { process: live.state.process }),
        Layer.effect(
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
                  build: "test",
                }),
              commit: () => Effect.die("drafts declares no write"),
              own: () => Effect.die("drafts declares no write"),
            });
          }),
        ),
        Layer.succeed(WatcherManager, {
          publish: (_client, update) =>
            Effect.sync(() => {
              published.push(update);
            }),
        }),
        Layer.succeed(Alarm, { set: () => Effect.void }),
        Layer.succeed(Recording, {
          flush: Effect.suspend(() => {
            if (!control.flush) {
              return Effect.void;
            }

            control.flush = false;
            return Effect.fail(new SinkError({ reason: "storage", held: 0 }));
          }),
        }),
      ).pipe(Layer.provideMerge(Layer.succeedContext(coordination)));
      const context = yield* Layer.build(
        ProgramRunner.layer(
          { id: live.state.process, name: NAME, program: PROGRAM, build: "test", owner },
          { recovery: { sql: faulty(inbox, control), name: NAME, capacity: CAPACITY } },
        ).pipe(Layer.provide(dependencies)),
      ).pipe(Scope.provide(scope));
      runner = Context.get(context, ProgramRunner);
      yield* runner.open("watch");
      return { inbox, runner };
    });
    let live = yield* connect();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

    const reopen = Effect.fnUntraced(function* () {
      yield* Scope.close(scope, Exit.void);
      scope = yield* Scope.make();
      live = yield* connect();
    });

    const patches = () => published.filter((u) => u.type === "patch").length;
    const inboxCount = Effect.suspend(() =>
      mailbox === undefined ? Effect.die("no connection") : Stream.runCount(mailbox.read(NAME, 0)).pipe(Effect.orDie),
    );

    /** The observable effects: accepted letters in the inbox, patches, and the view. */
    const observe = Effect.fnUntraced(function* () {
      const opened = yield* live.runner.open("watch");
      return {
        letters: yield* inboxCount,
        patches: patches(),
        view: opened.view,
        rev: opened.rev,
      };
    });

    /** What the record says the effects are. */
    const expected = (patchesNow: number) => ({
      letters: accepted,
      patches: patchesNow,
      view: { notes: Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b))) },
      rev: accepted,
    });
    const sorted = (view: unknown) => {
      const notes = (view as Model).notes;
      return { notes: Object.fromEntries(Object.entries(notes).sort(([a], [b]) => a.localeCompare(b))) };
    };

    const letter = (note: string, base: number, body: string, by = { key: "SHA256:writer", for: "person-writer" }) =>
      ({
        id: `letter-${answered.length}-${note}-${base}-${counter}`,
        envelope: {
          id: inputId(),
          by: Writer.cases.person.make(by),
          arrivedAt: 0,
          input: { type: "save", note, base, body },
        },
        sentAt: "2026-11-11T00:00:00Z",
        seen: 0,
        span: TRACE,
      }) satisfies Incoming;

    const current = (note: string) => versions.get(note) ?? 0;

    /** Sends a fresh letter and checks its answer against the record. */
    const fresh = Effect.fnUntraced(function* (note: string, base: number, body: string) {
      const sent = letter(note, base, body);
      const before = patches();
      const answer = yield* live.runner.msg(sent);

      if (base === current(note)) {
        accepted++;
        expect(answer).toEqual(
          Sent.cases.accepted.make({ rev: answer._tag === "accepted" ? answer.rev : -1, pos: accepted }),
        );
        versions.set(note, current(note) + 1);
        expect(patches(), "an accepted save publishes one patch").toBe(before + 1);
      } else {
        secrets.push(body);
        expect(answer).toEqual(Sent.cases.refused.make({ reason: "changed_elsewhere", now: current(note) }));
        expect(patches(), "a refusal publishes nothing").toBe(before);
      }

      answered.push({ letter: sent, first: answer, note, base });
      return sent;
    });

    /** A call that must fail, then its retry, which returns what committed. */
    const failed = Effect.fnUntraced(function* (sent: Incoming) {
      const exit = yield* Effect.exit(live.runner.msg(sent));
      expect(Exit.isFailure(exit), `a failed write or flush gave an answer: ${JSON.stringify(exit)}`).toBe(true);

      if (Exit.isFailure(exit)) {
        errors.push(Cause.pretty(exit.cause));
      }
    });

    /** A damaged reply fails the retry as a typed bad_row, changes nothing and stays stored. */
    const broken = Effect.fnUntraced(function* (prior: Answered, cell: string) {
      const before = yield* observe();
      const exit = yield* Effect.exit(live.runner.msg(prior.letter));
      expect(Exit.isFailure(exit), `a damaged reply gave an answer: ${JSON.stringify(exit)}`).toBe(true);

      if (Exit.isFailure(exit)) {
        errors.push(Cause.pretty(exit.cause));
        // A throw or defect is not a typed failure.
        expect(Cause.hasFails(exit.cause), Cause.pretty(exit.cause)).toBe(true);
        const error = Cause.squash(exit.cause) as RepliesError;
        expect(error._tag).toBe("RepliesError");
        expect(error.reason).toBe("bad_row");
      }

      expect(yield* observe(), "a damaged reply adds no letter, patch or version").toEqual(before);
      expect(replyCells(live.inbox), "a damaged reply is retained as it was").toContain(cell);
    });

    for (const [n, step] of steps.entries()) {
      const intact = answered.filter((a) => !damaged.has(a.letter.id));
      const stored = intact.filter((a) => a.first._tag === "refused");
      const futures = answered.filter((a) => a.first._tag === "refused" && a.base > current(a.note));
      const moves = enabled.filter((move) =>
        move === "older"
          ? NOTES.some((note) => current(note) > 0)
          : move === "advance"
            ? futures.length > 0
            : move === "retry" || move === "reuse"
              ? intact.length > 0
              : move === "corrupt"
                ? stored.length > 0
                : true,
      );
      const move = nth(moves, step.pick);
      const note = nth(NOTES, step.kind);

      if (move === "save") {
        yield* fresh(note, current(note), step.body);
      } else if (move === "future") {
        yield* fresh(note, current(note) + step.ahead, step.secret);
      } else if (move === "older") {
        const older = NOTES.filter((x) => current(x) > 0);
        const chosen = nth(older, step.kind);
        yield* fresh(chosen, step.kind % current(chosen), step.secret);
      } else if (move === "advance") {
        // Move a stored refusal's note toward its base, so a retry later finds that base current.
        const target = nth(futures, step.kind);
        yield* fresh(target.note, current(target.note), step.body);
      } else if (move === "retry") {
        const prior = nth(intact, step.kind);
        const before = yield* observe();
        expect(yield* live.runner.msg(prior.letter), "a retry answers the first answer").toEqual(prior.first);
        expect(yield* observe(), "a retry adds no letter, patch or version").toEqual(before);
      } else if (move === "reuse") {
        // The same letter with one bound part changed: its payload, or for a refusal its caller.
        const prior = nth(intact, step.kind);
        const input = prior.letter.envelope.input as typeof Save.Type;
        const parts = prior.first._tag === "refused" ? 3 : 1;
        const part = step.pick % parts;
        const changed: Incoming =
          part === 0
            ? {
                ...prior.letter,
                envelope: { ...prior.letter.envelope, input: { ...input, body: `${input.body}${step.secret}` } },
              }
            : {
                ...prior.letter,
                envelope: {
                  ...prior.letter.envelope,
                  by: Writer.cases.person.make(
                    part === 1
                      ? { key: `SHA256:${step.key}-other`, for: prior.letter.envelope.by.for }
                      : { key: prior.letter.envelope.by.key, for: `${step.for}-other` },
                  ),
                },
              };
        secrets.push(step.secret);
        const before = yield* observe();
        expect(yield* live.runner.msg(changed), "a changed binding borrows no answer").toEqual(
          Sent.cases.refused.make({ reason: "id_reused" }),
        );
        expect(yield* observe(), "a reused letter adds no letter, patch or version").toEqual(before);
      } else if (move === "reopen") {
        yield* reopen();
      } else if (move === "restart") {
        yield* live.runner.restart({ id: `restart-${n}`, build: "test" });
        yield* live.runner.open("watch");
      } else if (move === "flush" && intact.length > 0 && step.kind % 3 === 2) {
        // A duplicate of an accepted or refused letter whose flush fails: no answer, then the first.
        const prior = nth(intact, step.pick);
        const before = yield* observe();
        control.flush = true;
        yield* failed(prior.letter);
        expect(control.flush, "the armed flush was reached").toBe(false);
        expect(yield* live.runner.msg(prior.letter), "a duplicate's retry answers the first answer").toEqual(
          prior.first,
        );
        expect(yield* observe(), "a failed duplicate adds no letter, patch or version").toEqual(before);
      } else if (move === "flush" || move === "fault") {
        // The next answer cannot be kept: the call fails, and its retry returns what committed.
        const future = move === "fault" || step.kind % 2 === 0;
        const base = future ? current(note) + step.ahead : current(note);
        const body = future ? step.secret : step.body;
        const sent = letter(note, base, body);

        if (future) {
          secrets.push(body);
        }

        if (move === "flush") {
          control.flush = true;
        } else {
          control.reply = true;
        }

        yield* failed(sent);
        expect(control.flush || control.reply, "the armed fault was reached").toBe(false);
        const answer = yield* live.runner.msg(sent);

        if (future) {
          expect(answer).toEqual(Sent.cases.refused.make({ reason: "changed_elsewhere", now: current(note) }));
        } else {
          accepted++;
          expect(answer).toEqual(
            Sent.cases.accepted.make({ rev: answer._tag === "accepted" ? answer.rev : -1, pos: accepted }),
          );
          versions.set(note, current(note) + 1);
        }

        answered.push({ letter: sent, first: answer, note, base });
      } else if (move === "corrupt") {
        // Damage a stored refusal's row, derived from its current shape (R5, R6).
        const prior = nth(stored, step.kind);
        const located = replyRows(live.inbox, prior.letter.id);
        expect(located, "one stored JSON value holds the refusal").toHaveLength(1);
        const [{ table, column, value }] = located as [{ table: string; column: string; value: string }];
        const json = JSON.parse(value) as Record<string, unknown>;
        const kind = nth(DAMAGE, step.kind);
        const fields = ["parent", "by", "for", "digest", "answer"] as const;
        const cell =
          kind === "json"
            ? `${value.slice(0, -1)}${step.secret}`
            : kind === "missing"
              ? JSON.stringify(
                  Object.fromEntries(Object.entries(json).filter(([f]) => f !== fields[n % fields.length])),
                )
              : kind === "key"
                ? JSON.stringify({ ...json, id: `${prior.letter.id}-other` })
                : kind === "accepted"
                  ? JSON.stringify({ ...json, answer: Sent.cases.accepted.make({ rev: n + 1, pos: n + 1 }) })
                  : JSON.stringify({ ...json, answer: Malformed.make({ reason: { text: step.secret } }) });
        secrets.push(step.secret);
        live.inbox.exec(`UPDATE "${table}" SET "${column}"=? WHERE "${column}"=?`, cell, value);
        damaged.set(prior.letter.id, cell);
      }

      // After every move: each damaged reply still fails visibly and stays stored (R5, R6).
      for (const prior of answered) {
        const cell = damaged.get(prior.letter.id);

        if (cell !== undefined) {
          yield* broken(prior, cell);
        }
      }

      const seen = yield* observe();
      expect({ ...seen, view: sorted(seen.view) }, `after ${move}`).toEqual(expected(seen.patches));
      // No reply row, failure or span holds a refused body (R11).
      const kept = new Set(damaged.values());
      unleaked([...replyCells(live.inbox).filter((cell) => !kept.has(cell)), ...errors, ...spans.text()], secrets);
    }

    // Every first answer survives a last reopen and a successor.
    yield* reopen();
    yield* live.runner.restart({ id: "restart-last", build: "test" });

    for (const prior of answered) {
      const cell = damaged.get(prior.letter.id);

      if (cell === undefined) {
        expect(yield* live.runner.msg(prior.letter), "after reopen and restart").toEqual(prior.first);
      } else {
        yield* broken(prior, cell);
      }
    }

    const seen = yield* observe();
    expect({ ...seen, view: sorted(seen.view) }).toEqual(expected(seen.patches));
  }).pipe(Effect.withTracer(spans.tracer));

/** One law: a property over generated walks with these moves, each walk in its own scope. */
const law = (name: string, harness: Harness, enabled: ReadonlyArray<Move>) =>
  it.live.prop(name, [Walk], ([steps]) => Effect.scoped(walk(harness, enabled, steps, capture())), {
    timeout: 600_000,
    arbitrary: { seed: SEED, runs: RUNS },
  });

export const suite = (harness: Harness) =>
  describe("P13 runner terminal replies", () => {
    law("R2: reopen and process replacement keep every first answer", harness, [
      "save",
      "future",
      "retry",
      "reopen",
      "restart",
    ]);
    law("R3: a future-base refusal never becomes accepted once its base is current", harness, [
      "save",
      "future",
      "older",
      "advance",
      "retry",
      "reopen",
    ]);
    law("R4: a reply write that fails gives no answer; the retry answers fresh", harness, [
      "save",
      "future",
      "advance",
      "fault",
      "retry",
    ]);
    law("R5, R6: a damaged stored refusal fails the retry as bad_row, through reopen and restart", harness, [
      "save",
      "future",
      "advance",
      "corrupt",
      "retry",
      "reopen",
      "restart",
    ]);
    law("R7: a terminal refusal adds no accepted letter, patch or Cmd", harness, [
      "save",
      "future",
      "older",
      "advance",
      "retry",
      "reuse",
    ]);
    law("R8: accepted retries return the first placing, also for same-body letters", harness, [
      "save",
      "retry",
      "reopen",
      "restart",
    ]);
    law("R9: a changed caller or payload cannot borrow a terminal answer", harness, [
      "save",
      "future",
      "advance",
      "reuse",
      "retry",
    ]);
    law("R10: a failed recording flush gives no answer; the retry returns what committed", harness, [
      "save",
      "future",
      "advance",
      "flush",
      "retry",
    ]);
    law("R11 [secrets]: reply rows, failures and spans hold no refused body", harness, [
      "future",
      "older",
      "save",
      "fault",
      "flush",
      "reuse",
      "retry",
      "restart",
      "corrupt",
    ]);
  });
