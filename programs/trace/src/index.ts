import { run } from "@demlik/tea/effect";
import {
  anyInput,
  defineProgram,
  end,
  flag,
  input,
  type JobTrace,
  jobTraceId,
  kind,
  TraceId,
  Traces,
} from "@kampus/fabrika-old";
import { TicketNumber } from "@kampus/pipeline/tickets/ticket";
import { Tickets } from "@kampus/pipeline/tickets/tickets";
import { Clock, Duration, Effect, Option, Schema, Stream } from "effect";
import {
  type FactsSub,
  type FollowSub,
  Model,
  RowKey,
  statusOf,
  type TickSub,
  type TraceMsg,
  trace as traceMachine,
} from "./machine.ts";
import { Shown, shownOf } from "./view.ts";

// A job's trace, or a ticket's lanes, in a tile of its own (./window.tsx).
//
// The job view: one job's record, read through the `Traces` service, drawn as a waterfall (one bar
// per span, nested by parent, one colour per program, its events as dots), and every row that
// groups others opens, down to one step: its Msg, the state before and after, and the Cmds it
// started. Elm's debugger and Redux DevTools for the steps, Jaeger's span detail for the spans.
//
//   tsh> seq --to 3 | tally | trace      no flag: its own line's job, followed as it goes
//   // tally's total fits no input of trace, so it is wired to `any`, which takes it and lets it go
//   tsh> trace --id 6c0f…e3a1            that job's record, followed while the job runs
//   toggle {row: "job"}                  the job's row closes; again, it opens
//   choose {row: "step:…"}               the step's detail shows
//   quit null                            it ends
//
// The ticket view (ticket 141): every lane the ticket's `started` facts name, oldest first, one
// section per trace id, each on its own time axis. Steps come from the ticket's facts; a step
// opens to its spans, from that lane's job record. A wait on a person is a row. A fact stepper
// replays the ticket up to any fact.
//
//   tsh> trace --ticket 117              ticket 117's lanes; the newest opens
//   tsh> tracker | trace                 the ticket the tracker picks, then the next pick
//   tsh> ticket --ticket 117 | trace     the ticket a pipe sends on `ticket`
//   step {by: -1}                        the ticket as it was one fact back
//   seek {at: null}                      live again
//
// `any` is how `pv` and `tee` sit in a Unix pipe: anything comes in, and being in the line is
// enough. Elm's `Json.Decode.value` is the same promise in a type: a value nobody decodes.

/** A row to open or close. */
export const Toggle = Schema.Struct({ row: RowKey });
/** The row whose detail shows, or `null` for none. */
export const Choose = Schema.Struct({ row: Schema.NullOr(RowKey) });
/** The replay's playhead: a time in Unix ms, or `null` for live. */
export const Seek = Schema.Struct({ at: Schema.NullOr(Schema.Finite) });
/** One stop back or on: the fact before or after the playhead. */
export const StepBy = Schema.Struct({ by: Schema.Literals([-1, 1]) });

/** The window's own inputs: closing them all ends the program, as a quit does. */
const WINDOW = ["toggle", "choose", "seek", "step", "quit"] as const;

/**
 * How long a record is still followed once its job has ended: the spans that end last, the
 * line's own among them, come in after the job's end is written.
 */
export const SETTLE = Duration.seconds(5);

/**
 * One read as a `got`, and, once its job has ended, `null` when `SETTLE` has passed since: nothing
 * writes to the record then, so no later read would come to say so. A newer read replaces the wait.
 */
const gotThenSettled = (t: JobTrace): Stream.Stream<TraceMsg | null> => {
  const got: Stream.Stream<TraceMsg | null> = Stream.make({ type: "got", trace: t });
  const ended = t.job?.ended ?? null;

  if (ended === null) {
    return got;
  }

  const wait = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.sleep(Duration.millis(Math.max(0, ended.at + Duration.toMillis(SETTLE) - now))),
  );
  return Stream.concat(got, Stream.fromEffect(Effect.as(wait, null)));
};

/**
 * One record, followed through `Traces`: a `got` per read of it, until its job settled, and one
 * `lost` if it cannot be read.
 */
const followOne = (id: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Traces).watch(id);
    }),
  ).pipe(
    Stream.switchMap(gotThenSettled),
    Stream.takeWhile((msg): msg is TraceMsg => msg !== null),
    Stream.catchTag("TraceUnread", (e): Stream.Stream<TraceMsg> => Stream.make({ type: "lost", id, why: e.message })),
  );

/** The job view's record, or each of the ticket view's lanes' records, side by side. */
const followRunner = (sub: FollowSub) =>
  "ids" in sub.deps
    ? Stream.mergeAll(sub.deps.ids.map(followOne), { concurrency: "unbounded" })
    : followOne(sub.deps.id);

/**
 * How often the time is told while a job runs or a lane is open: the window says it in whole
 * seconds, so once a second is what it can show.
 */
export const TICK = Duration.seconds(1);

/** The time, at once and then every `TICK`, as the tracker's clock tells it. */
const tickRunner = (_sub: TickSub) =>
  Stream.tick(TICK).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map((now): TraceMsg => ({ type: "tick", now })),
  );

/**
 * How often a ticket's facts are read again (the owner's answer 6): every `FAST`, and every `SLOW`
 * once `CALM` reads in a row changed nothing, back to `FAST` on a change. No `Tickets.watch`
 * exists, so this is a poll; the back-off cuts the reads a quiet ticket costs about four times.
 */
export const FAST = Duration.seconds(1);
export const SLOW = Duration.seconds(5);
export const CALM = 5;

/** Where the poll stands: the last timeline seen, by its length and newest entry, and how many reads in a row matched it. */
interface Poll {
  readonly seen: string | null;
  readonly same: number;
  readonly first: boolean;
}

/**
 * A ticket's facts, read at once and then again as `FAST` and `SLOW` say: a `facts` when they
 * changed, an `unread` when they could not be read, and nothing when they read as before. Where
 * no ledger is given (a job's trace alone, as in its tests), a ticket is one `unread` that says so:
 * a job view never needs the ledger, so the program does not ask for one.
 */
const factsRunner = (sub: FactsSub) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const given = yield* Effect.serviceOption(Tickets);
      const { number } = sub.deps;

      if (Option.isNone(given)) {
        const msg: TraceMsg = { type: "unread", number, why: "no ledger is given here" };
        return Stream.make(msg);
      }

      const tickets = given.value;
      return Stream.paginate<Poll, TraceMsg>({ seen: null, same: 0, first: true }, (poll) =>
        Effect.gen(function* () {
          if (!poll.first) {
            yield* Effect.sleep(poll.same >= CALM ? SLOW : FAST);
          }

          const read = yield* Effect.result(tickets.read(number));

          if (read._tag === "Failure") {
            const msg: TraceMsg = { type: "unread", number, why: read.failure.says };
            return [[msg], { ...poll, same: poll.same + 1, first: false }] as const;
          }

          const { timeline } = read.success;
          const newest = timeline.at(-1);
          const seen = `${timeline.length}:${newest?.pos ?? 0}:${newest?.at ?? 0}`;

          if (seen === poll.seen) {
            return [[], { ...poll, same: poll.same + 1, first: false }] as const;
          }

          const msg: TraceMsg = { type: "facts", number, timeline };
          return [[msg], { seen, same: 0, first: false }] as const;
        }).pipe(Effect.map(([msgs, next]) => [msgs, Option.some(next)] as const)),
      );
    }),
  );

/** How the machine runs: following on the `Traces` service, the ledger's `Tickets`, and the clock. */
export const traceOptions = {
  ctx: undefined,
  interpret: {},
  subscribe: { follow: followRunner, tick: tickRunner, facts: factsRunner },
};

/** The machine as the program declares it: kept nowhere, since the record and the ledger keep it. */
export const traceKind = kind({
  machine: traceMachine,
  state: Model,
  parent: "main",
  options: () => traceOptions,
  drawing: () => ({
    name: "trace",
    steps: { follow: "follow the record", tick: "tell the time", facts: "read the ticket" },
  }),
  status: statusOf,
});

export const trace = defineProgram({
  name: "trace",
  description:
    "One job's trace, read from its record, or one ticket's lanes, read from its facts. A job: a bar per span, nested by parent, one colour per program, and every grouped row opening down to one step. A ticket: every lane oldest first, its steps and its waits on a person, each step opening to its spans, and a replay to any fact. It has a window.",
  flags: {
    id: flag(
      Schema.UndefinedOr(TraceId),
      "The job's trace id: 32 hex characters, the trace id of its first run. Left out, it shows its own line's job until one comes on `id`.",
    ),
    ticket: flag(
      Schema.UndefinedOr(TicketNumber),
      "A ticket to show, by its number: its lanes, oldest first. Left out, it shows a job until one comes on `ticket`.",
    ),
  },
  inputs: {
    toggle: input(Toggle, "Open or close a row that groups others."),
    choose: input(Choose, "Show one row's detail, or none with `null`."),
    seek: input(Seek, "Replay the ticket up to a time, in Unix ms, or `null` for live."),
    step: input(StepBy, "Replay one fact back (`-1`) or on (`1`). Past the last is live."),
    quit: input(Schema.Null, "Stop."),
    id: input(TraceId, "A job's trace id: its record replaces what shows."),
    ticket: input(
      TicketNumber,
      "A ticket to show now, by its number: what a pipe from the tracker, the ticket or the pipeline sends.",
    ),
    any: anyInput("Anything else on a pipe, let go unread: being in the line is enough, as with `pv`."),
  },
  outputs: {},
  machines: { trace: traceKind },
  view: { machine: "trace", data: Shown, of: shownOf },
  main: ({ flags, serve, watch }) =>
    Effect.gen(function* () {
      const runtime = yield* (yield* run(traceMachine, traceOptions)).ready;
      const step = (msg: TraceMsg) => runtime.dispatch(msg).pipe(Effect.orDie);
      const look = (id: string) => step({ type: "look", id });
      const show = (number: number) => step({ type: "ticket", number });

      // The ticket flag, else the id flag's job, else its own line's: `null` when it runs in no
      // job (a test).
      if (flags.ticket !== undefined) {
        yield* show(flags.ticket);
      } else {
        const first = flags.id ?? (yield* jobTraceId);

        if (first !== null) {
          yield* look(first);
        }
      }

      yield* watch("trace", "trace", runtime);
      // Each id and ticket told, in order with the window's inputs: a pipe's end does not end
      // the window. A quit, or the window's inputs closed, does. Anything on `any` is taken and
      // let go, so the program before it never waits on it.
      yield* serve(
        {
          id: look,
          ticket: show,
          any: () => Effect.void,
          toggle: ({ row }) => step({ type: "toggle", row }),
          choose: ({ row }) => step({ type: "choose", row }),
          seek: ({ at }) => step({ type: "seek", at }),
          step: ({ by }) => step({ type: "step", by }),
          quit: () => end,
        },
        { until: WINDOW },
      );
    }).pipe(Effect.scoped),
});

export {
  type FactsSub,
  type FollowSub,
  followed,
  Model,
  Read,
  statusOf,
  type TickSub,
  type TraceMsg,
} from "./machine.ts";
export { groupsOf, JOB, type Node, nodesOf, treeOf } from "./tree.ts";
export { Change, changesOf, Detail, Row, Shown, shownOf } from "./view.ts";
