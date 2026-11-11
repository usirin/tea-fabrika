import { type DepKeyedSub, defineMachine, type Sub } from "@demlik/tea";
import { JobTrace, TraceId } from "@kampus/fabrika-old";
import { Entry, TicketNumber } from "@kampus/pipeline/tickets/ticket";
import { Schema } from "effect";
import { lanesOf, stopsOf } from "./ticket.ts";
import { findOf, groupsOf, JOB, treeOf } from "./tree.ts";

// The trace's machine: what the tile shows (one job's record, or one ticket's lanes), which of its
// rows are open, and which one is chosen. Elm's debugger and Redux DevTools hold the same: the
// history, and where you look in it. Pure: the records and the facts are followed through Subs,
// whose runners are in ./index.ts.
//
// The job view:
//
//   look     follow the job's record (`follow`): its own line's job at the start, or the flag's,
//            then each id told on `id`. A newer id replaces what shows, its open rows and its
//            detail; the same id again changes nothing, unless it could not be read
//   got      the record, read again: the first shows the job's row open, a later one keeps the
//            rows open and the detail chosen, and an end already read: a stale read that says the
//            job runs keeps that end, and the rest of it applies. One for an id it no longer
//            follows is dropped
//   lost     the record could not be read: before the first read it says why, after it the last
//            record read stays shown
//   toggle   open a row that groups others, or close it: a job, a run, a machine run, a round,
//            an agent's turns. A row that groups nothing, or is not in the record, changes nothing
//   choose   show one row's detail: a span's tags and events, or a step's Msg, the state before
//            and after, and its Cmds. `null` closes the detail
//   tick     the time, while the record shown says its job has not ended: an earlier tick keeps
//            the later time, as a clock can step back. Anything else lets it go
//
// The ticket view (ticket 141):
//
//   ticket   show this ticket's lanes: its facts are read (`facts`), live, every row closed. The
//            same number again changes nothing
//   facts    its facts, read again: the first read opens the newest lane alone, and a lane that
//            begins later opens too. Each lane's record is followed (`follow`, by its trace id).
//            Facts for another ticket are dropped
//   unread   they could not be read: before the first read it says why, after it the last read
//            stays shown
//   got      a lane's record, read again; one for an id that is no lane's is dropped
//   seek     the playhead: the ticket replayed up to a time, or `null` for live. Past the last
//            fact is live
//   step     ← and →: the stop before or after, a stop being a started, ended, asked, answered
//            or restarted. Past the last stop is live; from live, ← is the last stop
//   tick     the time, while a lane is open and the playhead is live: it lands on the ticket view
//            itself (`now`), as a lane's open row runs to now. An earlier tick keeps the later
//
//   replay(trace, {ctx: undefined, msgs: [{type: "look", id: TALLY_ID}]})
//   // state.shows {kind: "job", read: {at: "reading", id}}; subs [follow {id}]
//   // then got: state.shows.read {at: "read", trace, now: null}, open ["job"]
//   replay(trace, {ctx: undefined, msgs: [{type: "ticket", number: 117}, {type: "facts", ...}]})
//   // state.shows {kind: "ticket", facts: {at: "read", ...}, records: [], at: null, now: null}
//   // open ["lane:<newest>"]; subs [facts {number: 117}, follow {ids: [three lanes]}]
//
// Elm's answer for a value that changes on its own is a Sub, not a Cmd asked again: `Time.every`,
// a websocket. Open rows are state, as Elm keeps them in the Model: a reload, a second window or
// another client of the same run shows the same rows open.

/**
 * A job's record as the machine holds it: `JobTrace` with one type on both sides, since it never
 * leaves the process as the record's wire writes it. The record's reader has decoded it already.
 */
export const Kept = Schema.toType(JobTrace);
type Kept = typeof Kept.Type;

/**
 * Follow job records, by their trace ids: each read of one comes back as `got`. The job view
 * follows one (`id`); the ticket view one per lane (`ids`), in one Sub, since tea's `subs` is a
 * fixed list and a ticket's lanes are not.
 */
export type FollowSub = Sub<"follow", { readonly id: string } | { readonly ids: readonly string[] }>;

/**
 * The time, as Elm's `Time.every`: while the job of the record shown runs (`id`), or while a lane
 * of the ticket shown is open and the playhead is live (`number`). Each comes as `tick`.
 */
export type TickSub = Sub<"tick", { readonly id: string } | { readonly number: number }>;

/** A row of the tree, by its key (./tree.ts): what `toggle` and `choose` name. */
export const RowKey = Schema.String.check(Schema.isMaxLength(512));

/** Where the record stands: not asked yet, asked, read, or it could not be read. */
export const Read = Schema.Union([
  Schema.Struct({ at: Schema.Literal("waiting") }),
  Schema.Struct({ at: Schema.Literal("reading"), id: TraceId }),
  Schema.Struct({
    at: Schema.Literal("read"),
    trace: Kept,
    /** Unix ms, the latest tick told. `null`: its job ended or names no job, or no tick came yet. */
    now: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({ at: Schema.Literal("unread"), id: TraceId, why: Schema.String }),
]);
export type Read = typeof Read.Type;

/** A ticket's facts, as the `facts` Sub last read them. */
export const Facts = Schema.Union([
  Schema.Struct({ at: Schema.Literal("reading"), number: TicketNumber }),
  Schema.Struct({ at: Schema.Literal("read"), number: TicketNumber, timeline: Schema.Array(Entry) }),
  Schema.Struct({ at: Schema.Literal("unread"), number: TicketNumber, why: Schema.String }),
]);
export type Facts = typeof Facts.Type;

/**
 * What the tile shows: one job's record, or one ticket's lanes. One or the other, so a ticket view
 * never holds a stray `read`, and a job view never holds a playhead.
 */
export const Shows = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("job"), read: Read }),
  Schema.Struct({
    kind: Schema.Literal("ticket"),
    facts: Facts,
    /** Each lane's record, by its trace id, as the `follow` Sub last read it. */
    records: Schema.Array(Schema.Struct({ id: TraceId, read: Read })),
    /** The playhead. `null`: live, at now. A time: the ticket replayed up to it. */
    at: Schema.NullOr(Schema.Number),
    /** Unix ms, the latest tick told while a lane is open. `null`: no tick came yet. */
    now: Schema.NullOr(Schema.Number),
  }),
]);
export type Shows = typeof Shows.Type;
type TicketShows = Extract<Shows, { readonly kind: "ticket" }>;

export const Model = Schema.Struct({
  shows: Shows,
  /** The rows open, each one that groups others in what is read. */
  open: Schema.Array(RowKey),
  /** The row whose detail shows. `null`: none. */
  chosen: Schema.NullOr(RowKey),
});
export type Model = typeof Model.Type;

export type TraceMsg =
  | { readonly type: "look"; readonly id: string }
  | { readonly type: "got"; readonly trace: Kept }
  | { readonly type: "lost"; readonly id: string; readonly why: string }
  | { readonly type: "toggle"; readonly row: string }
  | { readonly type: "choose"; readonly row: string | null }
  | { readonly type: "tick"; readonly now: number }
  /** Show this ticket; the playhead goes back to live. */
  | { readonly type: "ticket"; readonly number: number }
  /** Its facts, read again. */
  | { readonly type: "facts"; readonly number: number; readonly timeline: readonly Entry[] }
  /** They could not be read. */
  | { readonly type: "unread"; readonly number: number; readonly why: string }
  /** A drag on the replay: a time, or back to now. */
  | { readonly type: "seek"; readonly at: number | null }
  /** ← and →: the fact before or after. */
  | { readonly type: "step"; readonly by: -1 | 1 };

/** Read a ticket's facts again, while the tile shows that ticket: each read comes as `facts`. */
export type FactsSub = Sub<"facts", { readonly number: number }>;

type Step = readonly [Model, readonly never[]];

const start: Model = { shows: { kind: "job", read: { at: "waiting" } }, open: [], chosen: null };

/** The trace id the machine reads or shows. `null`: none told yet. */
export const idOf = (r: Read): string | null => {
  switch (r.at) {
    case "waiting":
      return null;
    case "read":
      return r.trace.trace;
    default:
      return r.id;
  }
};

/** The record a job view follows: the one it reads or shows. None while waiting, once lost, or in the ticket view. */
export const followed = (s: Model): { readonly id: string } | null => {
  if (s.shows.kind !== "job") {
    return null;
  }

  const read = s.shows.read;
  return read.at === "reading" ? { id: read.id } : read.at === "read" ? { id: read.trace.trace } : null;
};

/** Its job has not ended, as the record says it. A record with no job says nothing of the kind. */
export const isRunning = (trace: Kept): boolean => trace.job !== null && trace.job.ended === null;

/** The clock's Sub in the job view: on while the record shown says its job has not ended. */
export const ticking = (s: Model): { readonly id: string } | null => {
  if (s.shows.kind !== "job") {
    return null;
  }

  const read = s.shows.read;
  return read.at === "read" && isRunning(read.trace) ? { id: read.trace.trace } : null;
};

/** The facts a ticket view has read. `null`: none yet, or a job view. */
const timelineOf = (s: Model): readonly Entry[] | null =>
  s.shows.kind === "ticket" && s.shows.facts.at === "read" ? s.shows.facts.timeline : null;

/** The lanes' trace ids in a ticket's facts, oldest first. A start with no trace names none. */
export const lanesIn = (timeline: readonly Entry[]): readonly string[] =>
  lanesOf(timeline, Infinity, Infinity)
    .map((l) => l.trace)
    .filter((t) => t !== "");

/** Some lane of the ticket is open: a step not ended, or an ask not answered. */
const anyOpen = (timeline: readonly Entry[]): boolean => lanesOf(timeline, Infinity, Infinity).some((l) => l.open);

/** The ticket view's records to follow: one per lane its facts name. */
export const lanesFollowed = (s: Model): { readonly ids: readonly string[] } | null => {
  const timeline = timelineOf(s);

  if (timeline === null) {
    return null;
  }

  const ids = lanesIn(timeline);
  return ids.length === 0 ? null : { ids };
};

/** The ticket view's facts Sub: on while a ticket shows. */
export const factsRead = (s: Model): { readonly number: number } | null =>
  s.shows.kind === "ticket" ? { number: s.shows.facts.number } : null;

/** The ticket view's clock: on while a lane is open and the playhead is live. */
export const ticketTicking = (s: Model): { readonly number: number } | null => {
  const timeline = timelineOf(s);
  return s.shows.kind === "ticket" && s.shows.at === null && timeline !== null && anyOpen(timeline)
    ? { number: s.shows.facts.number }
    : null;
};

/** The rows a record first shows open: the job's, when anything is under it. */
export const firstOpen = (trace: Kept): readonly string[] => (groupsOf(treeOf(trace)).has(JOB) ? [JOB] : []);

/**
 * A newer read of the record shown, with the end the record shown already says. The host writes an
 * end once and reads come in order, so only a stale read can say otherwise; the rest of it applies.
 */
const keepingEnd = (shown: Kept, read: Kept): Kept => {
  const ended = shown.job?.ended ?? null;
  const job = read.job ?? shown.job;
  return ended === null || job === null ? read : { ...read, job: { ...job, ended } };
};

/** A job view with this record. */
const showing = (s: Model, read: Read): Model => ({ ...s, shows: { kind: "job", read } });

/**
 * A newer read of the record shown: the rows open stay open, and the detail stays, where they
 * still are. A record that had nothing under its job yet (a job just begun, its spans not in)
 * showed no row to open or close, so the first read with something in it opens the job's row,
 * as a first read does.
 */
const again = (s: Model, read: Read & { readonly at: "read" }, trace: Kept): Model => {
  const tree = treeOf(trace);
  const groups = groupsOf(tree);
  const shown = groupsOf(treeOf(read.trace)).has(JOB);
  return {
    shows: { kind: "job", read: { at: "read", trace, now: isRunning(trace) ? read.now : null } },
    open: shown ? s.open.filter((k) => groups.has(k)) : firstOpen(trace),
    chosen: s.chosen !== null && findOf(tree, s.chosen) !== undefined ? s.chosen : null,
  };
};

/** A ticket view, its shows changed. */
const inTicket = (s: Model, shows: TicketShows): Model => ({ ...s, shows });

/** The span ids in the ticket view's records read: the rows a step's spans may open. */
const spanIn = (shows: TicketShows, id: string): boolean =>
  shows.records.some((r) => r.read.at === "read" && r.read.trace.spans.some((sp) => sp.span === id));

/**
 * A row the ticket view holds: a lane, a step's run, an ask, a span of a lane's record, or a
 * span's folded HTTP calls. `opens`: only a row that groups others (a lane, a run, a span).
 */
const ticketRowIn = (shows: TicketShows, key: string, opens: boolean): boolean => {
  const timeline = shows.facts.at === "read" ? shows.facts.timeline : [];
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");

  switch (kind) {
    case "lane":
      return lanesIn(timeline).includes(id);
    case "run":
      return timeline.some((e) => e.fact.type === "started" && e.fact.run === id);
    case "ask":
      return !opens && timeline.some((e) => e.fact.type === "asked" && e.fact.ask === id);
    case "span":
      return spanIn(shows, id);
    case "calls":
      return opens && spanIn(shows, id);
    default:
      return false;
  }
};

/** The playhead after a `step`: the stop after or before it, or live past the last. */
const stepped = (timeline: readonly Entry[], at: number | null, by: -1 | 1): number | null => {
  const stops = stopsOf(timeline);

  if (at === null) {
    return by === 1 ? null : (stops.at(-1) ?? null);
  }

  if (by === 1) {
    return stops.find((t) => t > at) ?? null;
  }

  return stops.findLast((t) => t < at) ?? at;
};

export const trace = defineMachine({
  types: {
    model: {} as Model,
    msg: {} as TraceMsg,
    sub: {} as FollowSub | TickSub | FactsSub,
    ctx: undefined,
  },
  cmds: [],
  init: (): Step => [start, []],
  update: {
    // A newer id replaces what shows, with its rows and its detail. The same id again changes
    // nothing, unless its record could not be read: then it is followed again.
    look: (s, m): Step => {
      if (s.shows.kind === "job") {
        const read = s.shows.read;

        if (idOf(read) === m.id && read.at !== "unread") {
          return [s, []];
        }
      }

      return [{ shows: { kind: "job", read: { at: "reading", id: m.id } }, open: [], chosen: null }, []];
    },
    got: (s, m): Step => {
      if (s.shows.kind === "ticket") {
        const shows = s.shows;

        if (!lanesIn(timelineOf(s) ?? []).includes(m.trace.trace)) {
          return [s, []];
        }

        const held = shows.records.find((r) => r.id === m.trace.trace);
        const trace = held?.read.at === "read" ? keepingEnd(held.read.trace, m.trace) : m.trace;
        const read: Read = { at: "read", trace, now: null };
        const records =
          held === undefined
            ? [...shows.records, { id: m.trace.trace, read }]
            : shows.records.map((r) => (r.id === m.trace.trace ? { id: r.id, read } : r));
        return [inTicket(s, { ...shows, records }), []];
      }

      const read = s.shows.read;

      if (idOf(read) !== m.trace.trace) {
        return [s, []];
      }

      if (read.at === "reading") {
        return [
          {
            shows: { kind: "job", read: { at: "read", trace: m.trace, now: null } },
            open: firstOpen(m.trace),
            chosen: null,
          },
          [],
        ];
      }

      return read.at === "read" ? [again(s, read, keepingEnd(read.trace, m.trace)), []] : [s, []];
    },
    lost: (s, m): Step => {
      if (s.shows.kind === "ticket") {
        const shows = s.shows;

        if (!lanesIn(timelineOf(s) ?? []).includes(m.id)) {
          return [s, []];
        }

        if (shows.records.some((r) => r.id === m.id && r.read.at === "read")) {
          return [s, []];
        }

        const read: Read = { at: "unread", id: m.id, why: m.why };
        const records = [...shows.records.filter((r) => r.id !== m.id), { id: m.id, read }];
        return [inTicket(s, { ...shows, records }), []];
      }

      const read = s.shows.read;
      return read.at === "reading" && read.id === m.id
        ? [showing(s, { at: "unread", id: m.id, why: m.why }), []]
        : [s, []];
    },
    toggle: (s, m): Step => {
      const holds =
        s.shows.kind === "ticket"
          ? ticketRowIn(s.shows, m.row, true)
          : s.shows.read.at === "read" && groupsOf(treeOf(s.shows.read.trace)).has(m.row);

      if (!holds) {
        return [s, []];
      }

      const open = s.open.includes(m.row) ? s.open.filter((k) => k !== m.row) : [...s.open, m.row];
      return [{ ...s, open }, []];
    },
    choose: (s, m): Step => {
      if (m.row === null) {
        return [{ ...s, chosen: null }, []];
      }

      const holds =
        s.shows.kind === "ticket"
          ? !m.row.startsWith("lane:") && ticketRowIn(s.shows, m.row, false)
          : s.shows.read.at === "read" && findOf(treeOf(s.shows.read.trace), m.row) !== undefined;
      return holds ? [{ ...s, chosen: m.row }, []] : [s, []];
    },
    // A tick that was on its way when the job's end was read, or a newer id, is let go. In the
    // ticket view it lands on the view itself, while a lane is open and the playhead is live.
    tick: (s, m): Step => {
      if (s.shows.kind === "ticket") {
        return ticketTicking(s) === null
          ? [s, []]
          : [inTicket(s, { ...s.shows, now: Math.max(s.shows.now ?? m.now, m.now) }), []];
      }

      const read = s.shows.read;
      return read.at === "read" && isRunning(read.trace)
        ? [showing(s, { ...read, now: Math.max(read.now ?? m.now, m.now) }), []]
        : [s, []];
    },
    ticket: (s, m): Step =>
      s.shows.kind === "ticket" && s.shows.facts.number === m.number
        ? [s, []]
        : [
            {
              shows: {
                kind: "ticket",
                facts: { at: "reading", number: m.number },
                records: [],
                at: null,
                now: null,
              },
              open: [],
              chosen: null,
            },
            [],
          ],
    // The first read opens the newest lane alone; a lane begun since the last read opens too.
    facts: (s, m): Step => {
      if (s.shows.kind !== "ticket" || s.shows.facts.number !== m.number) {
        return [s, []];
      }

      const before = lanesIn(timelineOf(s) ?? []).at(-1);
      const newest = lanesIn(m.timeline).at(-1);
      const key = newest === undefined ? null : `lane:${newest}`;
      const open = key === null || newest === before || s.open.includes(key) ? s.open : [...s.open, key];
      return [
        {
          ...s,
          shows: { ...s.shows, facts: { at: "read", number: m.number, timeline: m.timeline } },
          open,
        },
        [],
      ];
    },
    unread: (s, m): Step =>
      s.shows.kind === "ticket" && s.shows.facts.number === m.number && s.shows.facts.at !== "read"
        ? [inTicket(s, { ...s.shows, facts: { at: "unread", number: m.number, why: m.why } }), []]
        : [s, []],
    // Past the last fact is live: there is nothing later to replay up to.
    seek: (s, m): Step => {
      const timeline = timelineOf(s);

      if (s.shows.kind !== "ticket" || timeline === null) {
        return [s, []];
      }

      const last = timeline.at(-1)?.at ?? -Infinity;
      const at = m.at === null || m.at > last ? null : m.at;
      return at === s.shows.at ? [s, []] : [inTicket(s, { ...s.shows, at }), []];
    },
    step: (s, m): Step => {
      const timeline = timelineOf(s);

      if (s.shows.kind !== "ticket" || timeline === null) {
        return [s, []];
      }

      const at = stepped(timeline, s.shows.at, m.by);
      return at === s.shows.at ? [s, []] : [inTicket(s, { ...s.shows, at }), []];
    },
  },
  subs: [
    { type: "follow", deps: followed } satisfies DepKeyedSub<Model, FollowSub>,
    { type: "tick", deps: ticking } satisfies DepKeyedSub<Model, TickSub>,
    { type: "facts", deps: factsRead } satisfies DepKeyedSub<Model, FactsSub>,
    { type: "follow", deps: lanesFollowed } satisfies DepKeyedSub<Model, FollowSub>,
    { type: "tick", deps: ticketTicking } satisfies DepKeyedSub<Model, TickSub>,
  ],
});

/** Its status line, for a host's list of runs. */
export const statusOf = (s: Model): string => {
  if (s.shows.kind === "ticket") {
    const { facts } = s.shows;

    switch (facts.at) {
      case "reading":
        return `reading ticket ${facts.number}`;
      case "unread":
        return `cannot read ticket ${facts.number}: ${facts.why}`;
      case "read": {
        const lanes = lanesIn(facts.timeline).length;
        const where = s.shows.at === null ? "live" : "replaying";
        return `ticket ${facts.number}, ${lanes} ${lanes === 1 ? "lane" : "lanes"}, ${where}`;
      }
    }
  }

  const read = s.shows.read;

  switch (read.at) {
    case "waiting":
      return "waiting for a run to be picked";
    case "reading":
      return "reading the record";
    case "unread":
      return `cannot read the record: ${read.why}`;
    case "read": {
      const t = read.trace;
      return `${t.spans.length} spans, ${t.steps.length} steps, ${s.open.length} open`;
    }
  }
};
