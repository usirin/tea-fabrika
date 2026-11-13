import { applyCell } from "@demlik/tea";
// P13 slice 2, next/. Runtime laws take real stores from the module that owns their driver (0062).
import { Machine } from "@demlik/tea/effect";
import { describe, expect } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, Result, Schema, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { Writer, SinkError } from "../coordination/index.ts";
import * as Id from "../Id.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { defaultPolicy, supervisor, Supervision } from "./internal/supervisor.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input, ProgramDown } from "./Program.ts";
import { recoveryStore } from "./RecoveryStore.ts";
import { capture, nth } from "./RepliesTest.ts";
import { ProgramRunner, Sent } from "./Runner.ts";
import { BRAIN, type Harness } from "./RunnerRepliesTest.ts";

const NAME = "admission:1";
const PROGRAM = "admission";
const SENT_AT = "2026-11-11T00:00:00Z";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const Model = Schema.Struct({ versions: Schema.Record(Schema.String, Schema.Int) });

const Save = Schema.Struct({
  type: Schema.Literal("save"),
  note: Schema.String,
  base: Schema.Int,
  body: Schema.String,
});

const parameters = { seed: 119120, numRuns: 40 };

// The tape carries entropy only. Each choice is rebuilt from the state reached by its prefix.
const Tape = fc.array(fc.record({ move: fc.noBias(fc.nat()), pick: fc.noBias(fc.nat()) }), {
  minLength: 12,
  maxLength: 30,
});

type Cell = typeof Tape extends fc.Arbitrary<ReadonlyArray<infer A>> ? A : never;

export type Register = (
  name: string,
  tape: typeof Tape,
  check: (tape: ReadonlyArray<Cell>) => Effect.Effect<void, unknown, Scope.Scope>,
  options: typeof parameters,
  reached: Set<string>,
  required: ReadonlyArray<string>,
) => void;

type Move =
  | "admit"
  | "refuse"
  | "legacy_refuse"
  | "invalid"
  | "retry"
  | "reuse"
  | "reopen"
  | "flush"
  | "activity_save"
  | "admission_save"
  | "refusal_save"
  | "reply_write"
  | "reply_complete"
  | "check_throw"
  | "update_throw"
  | "lost_observation"
  | "refuse_failed"
  | "rpc"
  | "update_rpc"
  | "cleanup"
  | "update_cleanup"
  | "abandon_save"
  | "update_abandon_save"
  | "restart";

type Answered = { readonly input: Incoming; readonly first: Sent };

const WRITE = /^\s*(INSERT|UPDATE|REPLACE|DELETE)\b/i;

const decodeText = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Json));

// SQL columns and span fields can hold another JSON document.
const texts = (value: Schema.Json, cache: Map<string, ReadonlyArray<string>>): ReadonlyArray<string> => {
  if (typeof value === "string") {
    const prior = cache.get(value);

    if (prior !== undefined) {
      return prior;
    }

    const decoded = decodeText(value);
    const result = [
      value,
      ...(Result.isSuccess(decoded) ? texts(decoded.success, cache) : []),
      ...Array.from(value.matchAll(/https?:\/\/[^\s"<>\\]+/gu), ([url]) =>
        Result.getOrElse(
          Result.try(() => decodeURIComponent(decodeURIComponent(url))),
          () => url,
        ),
      ),
    ];
    cache.set(value, result);
    return result;
  }

  return Array.isArray(value)
    ? value.flatMap((part) => texts(part, cache))
    : value !== null && typeof value === "object"
      ? Object.values(value).flatMap((part) => texts(part, cache))
      : [];
};

const journalWalk = Effect.fnUntraced(function* (harness: Harness, tape: ReadonlyArray<Cell>, reached: Set<string>) {
  const files = yield* harness.files;
  const ids = yield* Id.Generator.pipe(Effect.provide(Id.Generator.layer));
  const process = yield* ids.next(Id.Process);
  const ctx = { policy: defaultPolicy, process, name: NAME, build: "test", at: 0 };
  let model = supervisor.init(null, ctx)[0];
  const held = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
  let scope = yield* held;
  let cut = "";
  let hits = 0;
  const savedInputs = new Map<string, Schema.Json>();
  const pending = new Map<string, Incoming>();
  const owner = Writer.cases.person.make({ key: BRAIN, for: "fixture-writer" });
  const connect = Effect.fnUntraced(function* () {
    const raw = yield* files("journal").pipe(Scope.provide(scope));
    const sql: Sql = {
      exec: (query, ...params) => {
        if (cut !== "" && WRITE.test(query) && query.includes(cut)) {
          cut = "";
          hits++;
          throw new Error("SQLITE_IOERR");
        }

        return raw.exec(query, ...params);
      },
      transaction: (step) => raw.transaction(step),
      size: () => raw.size(),
    };
    return recoveryStore(sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
  });
  let store = yield* connect();
  yield* store.save(model);

  for (const [n, cell] of tape.entries()) {
    const j = model.journal;
    const options =
      j._tag === "idle"
        ? ["begin", "crash"]
        : j._tag === "checking"
          ? ["admit", "refuse", "abandon", "fail_receipt", "fail_journal", "crash"]
          : j._tag === "stepping"
            ? ["finished", "crash"]
            : j._tag === "writing_reply"
              ? ["reply_written", "crash"]
              : ["attempt_cleared", "crash"];
    const move = nth(options, cell.move);
    reached.add(`${move}:${j._tag}`);

    if (move === "crash") {
      yield* Scope.close(scope, Exit.void);
      scope = yield* held;
      store = yield* connect();
      expect(yield* store.load, "the real database reopens at the reached commit cut").toEqual(model);

      for (const [letter, input] of savedInputs) {
        expect(yield* store.input(letter)).toEqual(input);
      }

      continue;
    }

    let message: unknown;
    let admitting: { letter: string; input: Schema.Json } | null = null;

    if (j._tag === "idle") {
      const input: Incoming = {
        id: `cut-${n}`,
        envelope: {
          id: yield* ids.next(Id.Input),
          by: owner,
          arrivedAt: n,
          input: Save.make({ type: "save", note: `n${cell.pick % 3}`, base: n, body: `BODY-${cell.pick}-${n} "/雪\n` }),
        },
        sentAt: SENT_AT,
        seen: 0,
        span: TRACE,
      };
      pending.set(input.id, input);
      message = { type: "begin", process, letter: input.id, build: "test", phase: "fresh", at: n };
    } else if (j._tag === "checking") {
      const input = pending.get(j.attempt.letter);
      expect(input).toBeDefined();
      const delivery = Schema.decodeUnknownSync(Schema.Json)(input);

      if (move === "admit" || move === "fail_receipt" || move === "fail_journal") {
        message = {
          type: "admitted",
          seq: j.attempt.seq,
          receipt: {
            letter: j.attempt.letter,
            input: delivery,
            digest: `digest-${n}`,
            errors: [],
            tries: 0,
            result: null,
            process,
          },
        };
        admitting = { letter: j.attempt.letter, input: delivery };

        if (move !== "admit") {
          cut = move === "fail_receipt" ? "process_receipts" : "process_recovery";
        }
      } else if (move === "refuse") {
        message = {
          type: "refused",
          seq: j.attempt.seq,
          reply: {
            name: NAME,
            id: j.attempt.letter,
            parent: input?.envelope.id,
            by: owner.key,
            for: owner.for,
            digest: `digest-${n}`,
            answer: Sent.cases.refused.make({ reason: "changed_elsewhere" }),
          },
        };
      } else {
        message = { type: "abandoned", seq: j.attempt.seq };
      }
    } else if ("attempt" in j) {
      message = { type: move, seq: j.attempt.seq };
    }

    const msg = Schema.decodeUnknownSync(Schema.toType(supervisor.msg))(message);
    const before = model;
    const next = applyCell(supervisor, model, msg)[0];

    if (msg.type === "begin") {
      expect(next.journal._tag).toBe("checking");
    }

    const result = yield* Effect.result(store.save(next));

    if (result._tag === "Failure") {
      expect(hits).toBeGreaterThan(0);
      expect(yield* store.load, "a failed transaction installs neither admission nor its input").toEqual(before);

      if (admitting !== null) {
        expect(yield* store.input(admitting.letter)).toBeNull();
      }
    } else {
      model = next;

      if (admitting !== null) {
        savedInputs.set(admitting.letter, admitting.input);
      }

      expect(yield* store.load).toEqual(model);
    }

    cut = "";

    if (model.journal._tag === "checking") {
      expect(yield* store.input(model.journal.attempt.letter)).toBeNull();
    }

    for (const [letter, input] of savedInputs) {
      expect(yield* store.input(letter)).toEqual(input);
    }
  }
});

const walk = Effect.fnUntraced(function* (
  harness: Harness,
  tape: ReadonlyArray<Cell>,
  enabled: ReadonlyArray<Move>,
  reached: Set<string>,
  monitor: ReturnType<typeof capture>,
) {
  const open = yield* harness.files;
  const writes: Array<string> = [];
  const decoded = new Map<string, ReadonlyArray<string>>();
  const errors: Array<string> = [];
  const refusedBodies: Array<string> = [];
  const answers: Array<Answered> = [];
  const failures: Array<Incoming> = [];
  const versions = new Map<string, number>();
  const ids = yield* Id.Generator.pipe(Effect.provide(Id.Generator.layer));
  const owner = Writer.cases.person.make({ key: BRAIN, for: "fixture-writer" });
  const meta = {
    by: BRAIN,
    for: owner.for,
    sentAt: "2026-11-11T00:00:00Z",
    seen: 0,
    parent: null,
    traceId: TRACE.traceId,
    build: "test",
  };
  const control = { cut: "", hits: 0, checks: 0, updates: 0, mode: "", expected: null as Incoming | null };
  let serial = 0;
  let booted = false;
  let alarm: number | null = null;
  const acquire = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
  let scope = yield* acquire;

  const wrapped = (sql: Sql): Sql => ({
    exec: (query, ...params) => {
      if (WRITE.test(query)) {
        const text = JSON.stringify([query, params]);
        // Keep even rolled-back writes: inserting a body and later deleting it is a leak.
        writes.push(text);
        const admission =
          /process_recovery/.test(query) &&
          params.some((p) => typeof p === "string" && p.includes('"_tag":"stepping"'));
        const reply = /process_replies/.test(query);
        const cleanup =
          /process_activity/.test(query) && params.some((p) => typeof p === "string" && p.includes('"_tag":"idle"'));
        const activity =
          /process_activity/.test(query) &&
          params.some((p) => typeof p === "string" && p.includes('"_tag":"stepping"'));
        const refusal =
          /process_recovery/.test(query) &&
          params.some((p) => typeof p === "string" && p.includes('"_tag":"writing_reply"'));
        const abandonment =
          /process_recovery/.test(query) &&
          params.some((p) => typeof p === "string" && p.includes('"_tag":"clearing_attempt"'));
        const replyComplete =
          /process_recovery/.test(query) && params.some((p) => typeof p === "string" && p.includes('"_tag":"idle"'));

        if (
          control.cut === "all" ||
          (control.cut === "admission" && admission) ||
          (control.cut === "reply" && reply) ||
          (control.cut === "reply_complete" && replyComplete) ||
          (control.cut === "activity" && activity) ||
          (control.cut === "refusal" && refusal) ||
          (control.cut === "abandonment" && abandonment) ||
          (control.cut === "cleanup" && cleanup)
        ) {
          control.hits++;

          if (control.cut !== "all") {
            control.cut = "";
          }

          throw new Error("SQLITE_IOERR");
        }
      }

      return sql.exec(query, ...params);
    },
    transaction: (body) => sql.transaction(body),
    size: () => sql.size(),
  });
  const program = {
    name: PROGRAM,
    machine: Machine.make({
      model: Model,
      msg: Save,
      cmds: [],
      init: (saved) => [saved ?? { versions: {} }, []],
      update: {
        save: (s, m) => {
          if (control.mode === "update_throw") {
            throw new TypeError("private update failure");
          }

          return [{ versions: { ...s.versions, [m.note]: (s.versions[m.note] ?? 0) + 1 } }, []];
        },
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Save,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: (s: typeof Model.Type, m: typeof Save.Type) => {
      control.checks++;

      if (control.mode === "lost_observation") {
        control.cut = "all";
      }

      if (control.mode === "check_throw" || control.mode === "lost_observation") {
        throw new RangeError("private check failure");
      }

      const now = s.versions[m.note] ?? 0;
      return m.base === now ? null : { reason: "changed_elsewhere", now };
    },
    inputs: { save: Input.cases.write.make({ schema: Save, description: "Save", personOnly: false }) },
    outputs: {},
    writes: {},
    wake: () => null,
  };
  const connect = Effect.fnUntraced(function* () {
    const raw = yield* open("inbox").pipe(Scope.provide(scope));
    const manager = yield* open("manager").pipe(Scope.provide(scope));
    const sql = wrapped(raw);
    const journal = recoveryStore(raw, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
    const services = yield* Layer.build(harness.services(raw, manager)).pipe(Scope.provide(scope));
    const processes = Context.get(services, ProcessManager);
    const mailbox = Context.get(services, Mailbox);

    if (!booted) {
      yield* processes.start(
        Start.cases.first.make({ id: "boot", name: NAME, code: { program: PROGRAM, hash: "test" } }),
        meta,
      );
      booted = true;
    }

    const status = yield* processes.status(NAME);
    const loader = Layer.effect(
      ProgramLoader,
      Effect.gen(function* () {
        const loaded = yield* ProgramLoader.use((l) => l.load(PROGRAM));
        return {
          load: () =>
            Effect.succeed({
              ...loaded,
              execution: {
                ...loaded.execution,
                fresh: (s: unknown, m: unknown) =>
                  Effect.gen(function* () {
                    if (enabled.includes("admission_save")) {
                      expect(
                        (yield* journal.load.pipe(Effect.orDie))?.journal._tag,
                        "fresh checking has a saved, body-free attempt",
                      ).toBe("checking");
                    }

                    return yield* control.mode === "rpc" ||
                    control.mode === "cleanup" ||
                    control.mode === "abandon_save"
                      ? Effect.fail(new ProgramDown({ reason: "step", source: "rpc" }))
                      : loaded.execution.fresh(s, m);
                  }),
                update: (s: unknown, m: unknown) =>
                  Effect.gen(function* () {
                    control.updates++;

                    if (control.expected !== null) {
                      expect(
                        yield* journal.input(control.expected.id).pipe(Effect.orDie),
                        "the complete admitted delivery committed before update",
                      ).toEqual(control.expected);
                      const pending = (yield* journal.load.pipe(Effect.orDie))?.journal;
                      expect(pending?._tag).toBe("stepping");

                      if (pending?._tag === "stepping") {
                        expect(pending.attempt.letter).toBe(control.expected.id);
                      }

                      reached.add("update_after_commit");
                    }

                    if (
                      control.mode === "update_rpc" ||
                      control.mode === "update_cleanup" ||
                      control.mode === "update_abandon_save"
                    ) {
                      return yield* new ProgramDown({ reason: "step", source: "rpc" });
                    }

                    return yield* loaded.execution.update(s, m);
                  }),
              },
            }),
        };
      }),
    ).pipe(Layer.provide(ProgramLoader.layer({ [PROGRAM]: program }, {})));
    const dependencies = Layer.mergeAll(
      loader,
      ProcessStore.layer(sql, { process: status.state.process }),
      Layer.succeed(CheckedWriter, {
        append: (i) =>
          mailbox.send(NAME, i.id, i.envelope.input, {
            ...meta,
            by: i.envelope.by.key,
            for: i.envelope.by.for,
            parent: i.envelope.id,
          }),
        commit: () => Effect.die("no writes"),
        own: () => Effect.die("no writes"),
      }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Alarm, {
        set: (at) =>
          Effect.sync(() => {
            alarm = at;
          }),
      }),
      Layer.succeed(Recording, {
        flush: Effect.suspend(() => {
          if (control.cut !== "flush") {
            return Effect.void;
          }

          control.cut = "";
          control.hits++;
          return Effect.fail(new SinkError({ reason: "storage", held: 0 }));
        }),
      }),
    ).pipe(Layer.provideMerge(Layer.succeedContext(services)));
    const context = yield* Layer.build(
      ProgramRunner.layer(
        { id: status.state.process, name: NAME, program: PROGRAM, build: "test", owner },
        { recovery: { sql, name: NAME, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(dependencies)),
    ).pipe(Scope.provide(scope));
    const runner = Context.get(context, ProgramRunner);

    for (let round = 0; round < 12; round++) {
      const opened = yield* Effect.exit(runner.open("fixture"));

      if (Exit.isSuccess(opened)) {
        return { runner, mailbox, raw, journal };
      }

      if (alarm === null) {
        return yield* Effect.failCause(opened.cause);
      }

      const at: number = alarm;
      alarm = null;
      yield* TestClock.setTime(at);
      yield* Effect.exit(runner.due(at));
    }

    return yield* Effect.die(new Error("recovery did not reach a live successor"));
  });
  let live = yield* connect();
  const reopen = Effect.fnUntraced(function* () {
    yield* Scope.close(scope, Exit.void);
    scope = yield* acquire;
    live = yield* connect();
  });
  const input = Effect.fnUntraced(function* (cell: Cell, refusing: boolean) {
    const note = `n${cell.pick % 3}`;
    const now = versions.get(note) ?? 0;
    return {
      id: `letter-${++serial}`,
      envelope: {
        id: yield* ids.next(Id.Input),
        by: owner,
        arrivedAt: serial,
        input: Save.make({
          type: "save",
          note,
          base: refusing ? now + 1 + (cell.pick % 4) : now,
          body: `BODY-${serial}-${cell.pick} "/雪\n`,
        }),
      },
      sentAt: meta.sentAt,
      seen: 0,
      span: TRACE,
    } satisfies Incoming;
  });
  const noteError = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isFailure(exit)) {
      errors.push(JSON.stringify(Cause.squash(exit.cause)), Cause.pretty(exit.cause));
    }
  };
  const check = Effect.fnUntraced(function* () {
    const saved = yield* live.journal.load;
    expect((yield* live.runner.open("verify")).view, "only accepted inputs change the model").toEqual({
      versions: Object.fromEntries(versions),
    });

    for (const prior of failures) {
      expect(yield* live.journal.input(prior.id), "earlier failure evidence stays exact").toEqual(prior);
    }

    expect(saved?.receipts.filter((r) => r.tries > 0).every((r) => r.errors.length === r.tries)).toBe(true);
    const records = live.raw
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .flatMap(({ name }) => live.raw.exec(`SELECT * FROM "${name}"`));
    const outputs = [...writes, ...records.map((row) => JSON.stringify(row)), ...errors, ...monitor.text()].flatMap(
      (output) => texts(output, decoded),
    );

    for (const body of refusedBodies) {
      const forms = [body, JSON.stringify(body).slice(1, -1), encodeURIComponent(body), body.slice(0, 14)];
      expect(
        outputs.filter((output) => forms.some((form) => output.includes(form))),
        "input text leaked",
      ).toEqual([]);
    }
  });

  for (const cell of tape) {
    const unansweredFailures = failures.filter(
      (failed) => !answers.some((answered) => answered.input.id === failed.id),
    );
    const available = enabled.filter((move) =>
      move === "refuse_failed"
        ? unansweredFailures.length > 0
        : move === "retry" || move === "reuse"
          ? answers.length > 0
          : true,
    );
    const move = nth(available, cell.move);
    reached.add(move);

    if (move === "reopen") {
      yield* reopen();
      continue;
    }

    if (move === "restart") {
      yield* live.runner.restart({ id: `restart-${++serial}`, build: "test" });
      continue;
    }

    const beforeChecks = control.checks;
    const beforeUpdates = control.updates;
    const beforeHits = control.hits;
    const before = yield* live.journal.load;

    if (move === "legacy_refuse" || move === "invalid") {
      const original = yield* input(cell, true);
      const message = Schema.decodeUnknownSync(Save)(original.envelope.input);
      const delivery =
        move === "legacy_refuse"
          ? { ...original, envelope: { ...original.envelope, id: `in-${yield* ids.next(Id.Process)}-${serial}` } }
          : { ...original, envelope: { ...original.envelope, input: { ...message, base: "invalid" } } };
      refusedBodies.push(message.body);
      const answer = yield* live.runner.msg(delivery);
      expect(answer).toEqual(
        Sent.cases.refused.make(
          move === "invalid"
            ? { reason: "bad_msg" }
            : { reason: "changed_elsewhere", now: versions.get(message.note) ?? 0 },
        ),
      );
      expect(yield* live.journal.input(original.id)).toBeNull();
      expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
      expect(control.updates).toBe(beforeUpdates);
      expect(control.checks).toBe(beforeChecks + (move === "invalid" ? 0 : 1));
      const hasReplies =
        live.raw.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='process_replies'").length > 0;
      expect(
        hasReplies ? live.raw.exec("SELECT id FROM process_replies WHERE name=? AND id=?", NAME, original.id) : [],
      ).toEqual([]);
      yield* reopen();
      expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
      yield* check();
      continue;
    }

    if (move === "refuse_failed") {
      const prior = nth(unansweredFailures, cell.pick);
      const old = yield* live.journal.receipt(prior.id);
      const message = Schema.decodeUnknownSync(Save)(prior.envelope.input);
      const advance = yield* input({ ...cell, pick: Number(message.note.slice(1)) }, false);
      control.expected = advance;
      const advanced = yield* live.runner.msg(advance);
      expect(advanced._tag).toBe("accepted");
      versions.set(message.note, (versions.get(message.note) ?? 0) + 1);
      answers.push({ input: advance, first: advanced });
      control.expected = null;
      const refused = yield* live.runner.msg(prior);
      expect(refused).toEqual(
        Sent.cases.refused.make({ reason: "changed_elsewhere", now: versions.get(message.note) ?? 0 }),
      );
      expect(
        yield* live.journal.receipt(prior.id),
        "later refusal cannot replace the earlier failed-delivery evidence",
      ).toEqual(old);
      answers.push({ input: prior, first: refused });
      continue;
    }

    if (move === "retry" || move === "reuse") {
      const prior = nth(answers, cell.pick);
      const component = Math.floor(cell.pick / answers.length) % 4;
      const changed =
        component === 0
          ? { ...prior.input, seen: prior.input.seen + 1 }
          : component === 1
            ? { ...prior.input, sentAt: "2026-11-11T00:00:01Z" }
            : component === 2
              ? {
                  ...prior.input,
                  envelope: {
                    ...prior.input.envelope,
                    input: {
                      ...Schema.decodeUnknownSync(Save)(prior.input.envelope.input),
                      body: `changed-${cell.pick}`,
                    },
                  },
                }
              : {
                  ...prior.input,
                  envelope: {
                    ...prior.input.envelope,
                    by: Writer.cases.person.make({ key: owner.key, for: "different-fixture-writer" }),
                  },
                };
      const retried = move === "retry" ? prior.input : changed;
      // Accepted placement permits new clocks on a resend; its body stays bound.
      const sameAnswer = move === "retry" || (prior.first._tag === "accepted" && component < 2);
      expect(yield* live.runner.msg(retried)).toEqual(
        sameAnswer ? prior.first : Sent.cases.refused.make({ reason: "id_reused" }),
      );
      expect(control.checks).toBe(beforeChecks);
      expect(control.updates).toBe(beforeUpdates);
      continue;
    }

    const refusing =
      move === "refuse" || move === "refusal_save" || move === "reply_write" || move === "reply_complete";
    const fresh = yield* input(cell, refusing);
    control.expected = refusing ? null : fresh;
    control.mode = move;
    control.cut =
      move === "activity_save"
        ? "activity"
        : move === "admission_save"
          ? "admission"
          : move === "refusal_save"
            ? "refusal"
            : move === "abandon_save" || move === "update_abandon_save"
              ? "abandonment"
              : move === "reply_write"
                ? "reply"
                : move === "reply_complete"
                  ? "reply_complete"
                  : move === "cleanup" || move === "update_cleanup"
                    ? "cleanup"
                    : move === "flush"
                      ? "flush"
                      : "";

    if (refusing) {
      refusedBodies.push(Schema.decodeUnknownSync(Save)(fresh.envelope.input).body);
    }

    const exit = yield* Effect.exit(live.runner.msg(fresh));

    if (refusing) {
      expect(control.updates).toBe(beforeUpdates);
      expect(yield* live.journal.input(fresh.id), "a normal refusal stores no fresh draft").toBeNull();
      expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
    }

    if (
      move === "admission_save" ||
      move === "activity_save" ||
      move === "refusal_save" ||
      move === "abandon_save" ||
      move === "update_abandon_save" ||
      move === "reply_write" ||
      move === "reply_complete" ||
      move === "flush" ||
      move === "rpc" ||
      move === "update_rpc" ||
      move === "cleanup" ||
      move === "update_cleanup" ||
      move === "lost_observation" ||
      move === "check_throw" ||
      move === "update_throw"
    ) {
      expect(Exit.isFailure(exit), `${move} gives no successful answer`).toBe(true);
      noteError(exit);

      if (
        move === "admission_save" ||
        move === "activity_save" ||
        move === "refusal_save" ||
        move === "abandon_save" ||
        move === "update_abandon_save"
      ) {
        expect(control.hits, `${move} reaches its write cut`).toBe(beforeHits + 1);
        expect(control.updates).toBe(beforeUpdates + (move === "update_abandon_save" ? 1 : 0));
        expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
        expect(yield* live.journal.input(fresh.id)).toEqual(move === "update_abandon_save" ? fresh : null);
      }

      if (move === "rpc" || move === "cleanup" || move === "update_rpc" || move === "update_cleanup") {
        expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
      }

      if (move === "check_throw" || move === "update_throw") {
        failures.push(fresh);
        const saved = yield* live.journal.load;
        expect(saved?.receipts.find((r) => r.letter === fresh.id)).toMatchObject({
          input: fresh,
          tries: 1,
          errors: [move === "check_throw" ? "RangeError" : "TypeError"],
        });
        expect(saved?.observations.filter((o) => o.letter === fresh.id)).toHaveLength(1);
        expect(saved?.crashes).toBe((before?.crashes ?? 0) + 1);
      }

      if (move === "lost_observation") {
        const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
        expect(error).toBeInstanceOf(ProgramDown);

        if (error instanceof ProgramDown) {
          expect(error.errorClass).toBe("RangeError");
        }

        control.cut = "";
        expect((yield* live.journal.load)?.receipts.some((r) => r.letter === fresh.id && r.tries > 0)).toBe(false);
      }

      control.mode = "";
      control.cut = "";
      control.expected = null;
      // Retry at the reached cut both with the live runner and with a reopened store.
      const sameRunner = move !== "check_throw" && move !== "update_throw" && cell.pick % 2 === 0;
      const checksBeforeResume = control.checks;

      if (!sameRunner) {
        yield* reopen();
      }

      if (!sameRunner && (move === "reply_write" || move === "reply_complete")) {
        expect(control.checks, "saved reply work resumes without fresh checking").toBe(checksBeforeResume);
      }

      if (move === "lost_observation") {
        const saved = yield* live.journal.load;
        expect(saved?.observations.filter((o) => o.letter === fresh.id && o.phase === "fresh")).toHaveLength(0);
        expect(saved?.observations.filter((o) => o.letter === fresh.id && o.phase === "interrupted")).toHaveLength(
          sameRunner ? 0 : 1,
        );
      }

      if (
        move === "reply_write" ||
        move === "reply_complete" ||
        move === "cleanup" ||
        move === "rpc" ||
        move === "update_rpc" ||
        move === "update_cleanup"
      ) {
        expect((yield* live.journal.load)?.crashes).toBe(before?.crashes ?? 0);
        reached.add("resume_without_charge");
      }

      // A restart makes a process available after an injected program crash.
      if (move === "check_throw" || move === "update_throw" || (move === "lost_observation" && !sameRunner)) {
        yield* live.runner.restart({ id: `after-failure-${++serial}`, build: "test" });
        reached.add(`${move}:reopened`);
      } else {
        // Complete this same binding after its storage/transport cut, including a lost first answer.
        control.expected = refusing ? null : fresh;
        const retried = yield* Effect.exit(live.runner.msg(fresh));
        expect(retried._tag, `${move} must progress on ${sameRunner ? "the same runner" : "reopen"}`).toBe("Success");

        if (Exit.isFailure(retried)) {
          return yield* Effect.failCause(retried.cause);
        }

        const answer = retried.value;
        expect(answer._tag).toBe(refusing ? "refused" : "accepted");
        reached.add(`${move}:${sameRunner ? "same_runner" : "reopened"}`);

        if (sameRunner) {
          expect((yield* live.journal.load)?.crashes, "a live retry is not a process interruption").toBe(
            before?.crashes ?? 0,
          );
        }

        if (move === "reply_write" || move === "reply_complete") {
          expect(control.checks, "pending reply work never checks the program again").toBe(checksBeforeResume);
        }

        if (move === "lost_observation") {
          const saved = yield* live.journal.load;
          expect(saved?.observations.filter((o) => o.letter === fresh.id && o.phase === "fresh")).toHaveLength(0);
          expect(saved?.receipts.find((r) => r.letter === fresh.id)?.errors ?? []).toEqual([]);
        }

        answers.push({ input: fresh, first: answer });

        if (!refusing) {
          const m = Schema.decodeUnknownSync(Save)(fresh.envelope.input);
          versions.set(m.note, (versions.get(m.note) ?? 0) + 1);
        }
      }
    } else {
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }

      const answer = exit.value;
      expect(answer._tag).toBe(refusing ? "refused" : "accepted");
      answers.push({ input: fresh, first: answer });

      if (!refusing) {
        const m = Schema.decodeUnknownSync(Save)(fresh.envelope.input);
        versions.set(m.note, (versions.get(m.note) ?? 0) + 1);
      }
    }

    control.mode = "";
    control.cut = "";
    control.expected = null;
    yield* check();
  }

  yield* reopen();

  for (const prior of answers) {
    expect(yield* live.runner.msg(prior.input)).toEqual(prior.first);
  }

  const letters = yield* Stream.runCollect(live.mailbox.read(NAME, 0));
  expect(letters.length).toBe([...versions.values()].reduce((a, b) => a + b, 0));
  yield* check();
});

export const suite = (harness: Harness, register: Register) =>
  describe("P13 runner admission", () => {
    const law = (name: string, moves: ReadonlyArray<Move>, required: ReadonlyArray<string>, numRuns = 40) => {
      const reached = new Set<string>();
      register(
        name,
        Tape,
        (tape) => {
          const monitor = capture();
          return walk(harness, tape, moves, reached, monitor).pipe(Effect.withTracer(monitor.tracer));
        },
        { ...parameters, numRuns },
        reached,
        required,
      );
    };
    law(
      "A2, A4, A10, A12 [secrets]: refusal writes no draft, spends no crash budget and keeps the first bound answer",
      ["admit", "refuse", "legacy_refuse", "invalid", "retry", "reuse", "reopen", "restart"],
      ["refuse", "legacy_refuse", "invalid", "retry", "reuse", "reopen"],
    );
    law(
      "A3: admission commits the exact delivery before update; a failed commit cannot run update",
      ["admit", "activity_save", "admission_save", "reopen"],
      [
        "activity_save:same_runner",
        "activity_save:reopened",
        "admission_save:same_runner",
        "admission_save:reopened",
        "update_after_commit",
        "reopen",
      ],
    );
    law(
      "A4: a cut reply write resumes before interruption capture without charging a refusal",
      ["refuse", "refusal_save", "reply_write", "reply_complete", "retry", "reopen"],
      [
        "refusal_save:same_runner",
        "refusal_save:reopened",
        "reply_write:same_runner",
        "reply_write:reopened",
        "reply_complete:same_runner",
        "reply_complete:reopened",
        "resume_without_charge",
      ],
    );
    law(
      "A6: required recording failure prevents an answer; committed answers survive retry",
      ["admit", "refuse", "flush", "retry", "reopen"],
      ["flush", "retry"],
    );
    law(
      "A8: failed checking and update retain exact input and one failure; a failed observation keeps the original failure",
      ["admit", "check_throw", "update_throw", "lost_observation", "reopen", "refuse_failed"],
      ["check_throw", "update_throw", "lost_observation:same_runner", "lost_observation:reopened", "refuse_failed"],
    );
    law(
      "A9: transport loss and failed activity cleanup resume without a program-crash charge",
      ["admit", "rpc", "cleanup", "update_rpc", "update_cleanup", "abandon_save", "update_abandon_save", "reopen"],
      [
        "rpc:same_runner",
        "rpc:reopened",
        "cleanup:same_runner",
        "cleanup:reopened",
        "update_rpc:same_runner",
        "update_rpc:reopened",
        "update_cleanup:same_runner",
        "update_cleanup:reopened",
        "abandon_save:same_runner",
        "abandon_save:reopened",
        "update_abandon_save:same_runner",
        "update_abandon_save:reopened",
        "resume_without_charge",
      ],
      100,
    );
    const cuts = new Set<string>();
    register(
      "A3: real admission transactions survive reopen; either split write may fail without installing the admission",
      Tape,
      (tape) => journalWalk(harness, tape, cuts),
      parameters,
      cuts,
      [
        "crash:checking",
        "crash:stepping",
        "crash:writing_reply",
        "crash:clearing_attempt",
        "fail_receipt:checking",
        "fail_journal:checking",
      ],
    );
  });
