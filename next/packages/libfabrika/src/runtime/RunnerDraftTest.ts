// fabsh in a tile, slice 1, next/: the runner's draft laws L6, L7 and L8 of the approved plan
// (docs/plan/lanes/fabsh-PLAN.md, "Laws"), a suite the module owning a real SQLite driver runs (0062):
// `RunnerDraftTest.suite(harness)`, from `node/runtime/RunnerDraft.laws.test.ts`. The plan names one
// file, `runtime/RunnerDraft.laws.test.ts`; a runtime test may not open a driver, so the laws live
// here and the driver runs them, as `RunnerWatchersTest` does. Written before the runner's draft
// call; until the build adds it, every law fails on `draft` missing from the runner.
//
// The shape these laws hold the runner to, from the plan's "The draft frame in the library":
// - `Program.make` takes an optional `draft: {schema, refuse}`; the program keeps it.
// - `ProgramRunner` gains `draft(m)`: under the process's permit, it decodes `m` with the draft
//   schema, runs the draft check, keeps the value in memory as the process's newest draft, and
//   answers the plan's `DraftAnswer`: `{ok: <the newest draft>}`, or `{err, reason?}` with `err`
//   `bad_draft` (it does not decode), `refused` (the check said no) or `no_draft` (the program
//   declares none). No ledger append, no letter, no checkpoint, no watcher publish, no span.
// - A submitted letter goes through `msg` as every letter does, and the step takes its line from
//   the letter, never from the draft.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { Writer } from "../access/SessionManager.ts";
import { Archive, RecordManager, SpanSink } from "../coordination/index.ts";
import { InputId } from "../Id.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, type Update, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";
import { BRAIN, type Harness } from "./RunnerRepliesTest.ts";

const SEED = 119120;
const NAME = "lines:1";
const PROGRAM = "lines";
const BARE = "bare";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const owner = Writer.cases.person.make({ key: "SHA256:fixture", for: "person-fixture" });
/** The test program's longest draft line: a small row, so the walk reaches it. */
const MOST = 40;

const meta = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-14T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE.traceId,
  build: "test",
};

const Model = Schema.Struct({ lines: Schema.Array(Schema.String) });
const Msg = Schema.Struct({ type: Schema.Literal("submitted"), line: Schema.String });

const Draft = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(MOST)),
  cursor: Schema.Int,
  n: Schema.Int,
});
type Draft = typeof Draft.Type;

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? { lines: [] }, []],
  update: { submitted: (s, m) => [{ lines: [...s.lines, m.line] }, []] },
});

/** A program like fabsh, cut to what a runner law reads: one line input and one draft. */
const lines = Program.make({
  name: PROGRAM,
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => ({ lines: s.lines }),
  refuse: () => null,
  inputs: { submitted: "A line" },
  draft: {
    schema: Draft,
    refuse: (d: Draft) =>
      d.text.includes("\n")
        ? { reason: "bad_line" }
        : d.cursor < 0 || d.cursor > d.text.length
          ? { reason: "bad_cursor" }
          : null,
  },
  outputs: {},
  writes: {},
  wake: () => null,
});

/** The same program with no draft, for `no_draft`. */
const bare = Program.make({
  name: BARE,
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => ({ lines: s.lines }),
  refuse: () => null,
  inputs: { submitted: "A line" },
  outputs: {},
  writes: {},
  wake: () => null,
});

type Answer = { readonly ok: unknown } | { readonly err: string; readonly reason?: string };

/** The runner as these laws call it: today's service and the plan's `draft`. */
type Runner = ProgramRunner["Service"] & { readonly draft?: (m: unknown) => Effect.Effect<Answer, unknown> };

const drafting = (r: Runner) => {
  const draft = r.draft;
  expect(draft, "the runner's draft call is missing").toBeTypeOf("function");
  return draft ?? (() => Effect.die("the runner's draft call is missing"));
};

/** Every row of every table of `sql`, as text: what a database holds. */
const dump = (sql: Sql): string =>
  JSON.stringify(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((t) => [String(t.name), sql.exec(`SELECT * FROM "${String(t.name).replace(/"/g, '""')}"`)]),
  );

const world = Effect.fnUntraced(function* (harness: Harness, program: typeof lines | typeof bare) {
  const files = yield* harness.files;
  let scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void));
  const published: Array<{ client: string; update: Update }> = [];
  let booted = false;
  let serial = 0;
  const databases: Array<Sql> = [];
  const connect = Effect.fnUntraced(function* () {
    const sql = yield* files("inbox").pipe(Scope.provide(scope));
    const manager = yield* files("manager").pipe(Scope.provide(scope));
    const spans = yield* files("spans").pipe(Scope.provide(scope));
    databases.length = 0;
    databases.push(sql, manager, spans);
    const coordination = yield* Layer.build(harness.services(sql, manager)).pipe(Scope.provide(scope));
    const processes = Context.get(coordination, ProcessManager);
    const mailbox = Context.get(coordination, Mailbox);

    if (!booted) {
      yield* processes
        .start(
          Start.cases.first.make({ id: "boot-lines", name: NAME, code: { program: program.name, hash: "test" } }),
          meta,
        )
        .pipe(Effect.orDie);
      booted = true;
    }

    const live = yield* processes.status(NAME).pipe(Effect.orDie);
    const dependencies = Layer.mergeAll(
      ProgramLoader.layer({ [program.name]: program }, {}),
      ProcessStore.layer(sql, { process: live.state.process }),
      Layer.succeed(CheckedWriter, {
        append: (i) =>
          mailbox.send(NAME, i.id, i.envelope.input, {
            ...meta,
            by: i.envelope.by.key,
            for: i.envelope.by.for,
            parent: i.envelope.id,
          }),
        commit: () => Effect.die("no outputs"),
        own: () => Effect.die("no outputs"),
      }),
      Layer.succeed(WatcherManager, {
        publish: (client, update) => Effect.sync(() => void published.push({ client, update })),
      }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Recording.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            SpanSink.layer(spans, { object: "lines" }),
            RecordManager.memory(4 * 1024 * 1024),
            Archive.memory,
          ),
        ),
      ),
    ).pipe(Layer.provideMerge(Layer.succeedContext(coordination)));
    const context = yield* Layer.build(
      ProgramRunner.layer(
        { id: live.state.process, name: NAME, program: program.name, build: "test", owner },
        { recovery: { sql, name: NAME, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(dependencies)),
    ).pipe(Scope.provide(scope));
    return Context.get(context, ProgramRunner) as Runner;
  });
  let runner = yield* connect();
  return {
    runner: () => runner,
    published,
    /** Everything the three databases hold now. */
    rows: () => databases.map(dump).join("\n"),
    /** A wake: every layer and connection dropped, and a new life on the same files. */
    wake: Effect.fnUntraced(function* () {
      yield* Scope.close(scope, Exit.void);
      scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void));
      runner = yield* connect();
    }),
    submit: (line: string) => {
      const incoming: Incoming = {
        id: `line-${serial}`,
        envelope: {
          id: InputId.make(`input_0000000000e008${(serial++).toString(16).padStart(12, "0")}`),
          by: owner,
          arrivedAt: serial,
          input: { type: "submitted", line },
        },
        sentAt: meta.sentAt,
        seen: 0,
        span: TRACE,
      };
      return runner.msg(incoming);
    },
  };
});

/** One move: a submitted line, a draft frame (carrying a planted marker), or a wake. */
const Move = Arbitrary.all({
  pick: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))),
  text: Arbitrary.schema(Schema.String.check(Schema.isMaxLength(30))),
  line: Arbitrary.schema(Schema.String.check(Schema.isMaxLength(30))),
});
type Move = typeof Move extends Arbitrary.Arbitrary<infer A> ? A : never;
const Walk = Arbitrary.array(Move, { minLength: 3, maxLength: 16 });

/** A marker planted in every draft, so a copy of draft text anywhere shows. Its `~` is in no base64,
 *  hex or id alphabet and it is 18 characters long, so no random key or id the stores write holds it. */
const MARK = "~fabsh~draft~mark~";

/** A draft text the program's check accepts (L8 covers the refused ones): the marker, then no newline. */
const marked = (m: Move) => `${MARK}${m.pick}${m.text.replace(/\n/g, " ")}`.slice(0, MOST);

export const suite = (harness: Harness) =>
  describe("fabsh slice 1: the runner's draft, next/", () => {
    it.live.prop(
      "L6: a draft is never saved: no draft text in any database, and a draft frame changes no row and publishes nothing",
      [Walk],
      ([moves]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(harness, lines);
            let drafts = 0;

            for (const m of moves) {
              if (m.pick % 3 === 0) {
                expect((yield* w.submit(m.line.replaceAll(MARK, "")))._tag).toBe("accepted");
                continue;
              }

              if (m.pick % 7 === 1) {
                yield* w.wake();
                continue;
              }

              const text = marked(m);
              const before = w.rows();
              const published = w.published.length;
              const answer = yield* drafting(w.runner())({ text, cursor: text.length, n: m.pick });
              drafts++;
              expect(answer, "the frame is echoed").toEqual({ ok: { text, cursor: text.length, n: m.pick } });
              expect(w.rows(), "a draft frame changed a row").toBe(before);
              expect(w.published.length, "a draft frame published a view").toBe(published);
            }

            if (drafts === 0) {
              const text = marked(moves[0] ?? { pick: 0, text: "", line: "" });
              expect(yield* drafting(w.runner())({ text, cursor: 0, n: 0 })).toEqual({ ok: { text, cursor: 0, n: 0 } });
            }

            expect(w.rows().includes(MARK), "a database holds draft text").toBe(false);
            expect(JSON.stringify(w.published).includes(MARK), "a published view holds draft text").toBe(false);
          }),
        ),
      { timeout: 50 * 10_000, arbitrary: { seed: SEED, runs: 200 } },
    );

    it.live.prop(
      "L7: the saved fold does not depend on drafts: the live view, the view after a wake and the fold of the letters alone agree (0229)",
      [Walk],
      ([moves]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(harness, lines);
            let model = machine.init(null, {})[0];

            for (const m of moves) {
              if (m.pick % 2 === 0) {
                const text = marked(m);
                yield* drafting(w.runner())({ text, cursor: m.pick % (text.length + 1), n: m.pick });
                continue;
              }

              // L13 at the runner: the step takes its line from the letter, never from the draft.
              expect((yield* w.submit(m.line))._tag).toBe("accepted");
              model = applyCell(machine, model, { type: "submitted", line: m.line })[0];
            }

            const live = (yield* w.runner().open("live")).view;
            expect(live, "the live view is the fold of the letters alone").toEqual({ lines: model.lines });
            yield* w.wake();
            expect((yield* w.runner().open("woken")).view, "a wake replays the same view").toEqual(live);
          }),
        ),
      { timeout: 50 * 10_000, arbitrary: { seed: SEED, runs: 300 } },
    );

    it.live.prop(
      "L8: every frame passes the program's draft check: one too long, holding a newline or with its cursor outside the text is refused and changes nothing",
      [
        Arbitrary.array(
          Arbitrary.all({
            size: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 * MOST }))),
            cursor: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: -2, maximum: 2 * MOST + 2 }))),
            newline: Arbitrary.schema(Schema.Boolean),
          }),
          { minLength: 1, maxLength: 12 },
        ),
      ],
      ([frames]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(harness, lines);

            for (const [n, f] of frames.entries()) {
              const body = "x".repeat(f.size);
              const text = f.newline && f.size > 0 ? `${body.slice(1)}\n` : body;
              const bad = text.length > MOST || text.includes("\n") || f.cursor < 0 || f.cursor > text.length;
              const before = w.rows();
              const answer = yield* drafting(w.runner())({ text, cursor: f.cursor, n });

              if (bad) {
                expect(answer, `${text.length} characters, cursor ${f.cursor}`).toMatchObject({
                  err: text.length > MOST ? "bad_draft" : expect.stringMatching(/^(bad_draft|refused)$/),
                });
              } else {
                expect(answer, "a good frame echoes itself").toEqual({ ok: { text, cursor: f.cursor, n } });
              }

              expect(w.rows(), "a frame changed a row").toBe(before);
            }

            // No frame, refused or not, moved the view.
            expect((yield* w.runner().open("after")).view).toEqual({ lines: [] });
          }),
        ),
      { timeout: 50 * 10_000, arbitrary: { seed: SEED, runs: 200 } },
    );

    it.live("scenario: L10 at the runner: a program that declares no draft answers no_draft and changes nothing", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world(harness, bare);
          const before = w.rows();
          expect(yield* drafting(w.runner())({ text: "help", cursor: 4, n: 1 })).toMatchObject({ err: "no_draft" });
          expect(w.rows()).toBe(before);
        }),
      ),
    );
  });
