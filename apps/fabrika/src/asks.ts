import { type DepKeyedSub, defineMachine, type Sub } from "@demlik/tea";
import { Cmd } from "@demlik/tea/effect";
import { Ledger, streams } from "@kampus/fabrika-old";
import { AskShown } from "@kampus/pipeline/tickets/ask";
import { Entry, fold, ROOT, readRow, type Ticket, TicketNumber, Title } from "@kampus/pipeline/tickets/ticket";
import { headOf, words, preparePending } from "@tea-fabrika/tracker";
import { Cause, Clock, Duration, Effect, Exit, Schema, Stream } from "effect";
import type { Noticed } from "./link.ts";

// The asks: every ask on the ledger that waits on the person, folded in the host, once, for
// every place that shows a count of them: the window's top bar, the Dock badge and the asks list
// (window/frame.tsx, main.ts). One source, so the three can never tell two stories, as Cursor's
// badge and sidebar did (the frame's research, rule 4). A tea machine, pure: the ledger is reached
// through its one Cmd and its Sub, whose cells are below.
//
//   [asks] = init(null, {later: ["9/a-1"], seen: []})   load {after: 0}; the marks kept from before
//   load_ok {entries: [#7 filed, #7 asked a-1 "approve plan"], last: 2}
//                                        9/a-1 waits no more: its later is dropped
//   asksNow(asks)                        {asks: [{key: "7/a-1", ticket: 7, what: "approve plan", kind: "ask", ...}], ...}
//   {type: "later", key: "7/a-1"}        the ask leaves the count, and shows at the list's foot
//   {type: "back", key: "7/a-1"}         and is counted again
//   {type: "seen"}                       the list was opened: no ask is new any more
//   marksOf(asks)                        {later: [], seen: ["7/a-1"]}: what the host keeps
//
// What waits on the person is the tracker's own word for it (`headOf`, programs/tracker): a
// ticket whose head is `asks` waits on each open ask, and one whose head is `stuck` waits once,
// on its stuck run. A closed or done ticket waits on nothing, whatever ask it still holds. So the
// tracker's list and this count agree by construction.
//
// "Later" and "seen" are the person's, not the ledger's: no fact says them, as no fact says what
// one person has read. They live here, in the host, so every window shows the same, and the host
// keeps them in the person's own home (`Marks`, asks.json, host/run.ts), so they outlive a
// restart. Two people on one shared ledger each have their own home and host, so each keeps their
// own. They come in as the machine's flags, as an Elm app's do from its storage, and the host
// writes them after each change that moves them, as Elm's TodoMVC saves after each update.
//
// A mark is keyed by its ask's own name on the ledger (`7/a-1`), and each read of the ledger
// drops every mark whose ask no longer waits: an answered ask's later is gone at the first read,
// never shown. A mark that does not read back (a broken or older file) is none: every ask counts
// and is new. The count errs toward more, never toward less.

/** One thing that waits on the person: an open ask, or a stuck run. */
export const Ask = Schema.Struct({
  /** Its key, the same on every read: `7/a-1` for ask a-1 on #7, `7/stuck/r-3` for a stuck run. */
  key: Schema.String,
  ticket: TicketNumber,
  /** The ticket's title. */
  title: Title,
  /** What it asks, in its own words, or why the run is stuck. */
  what: Schema.String,
  kind: Schema.Literals(["ask", "stuck"]),
  sealed: Schema.optionalKey(AskShown),
  for: Schema.optionalKey(Schema.String),
  why: Schema.optionalKey(Schema.String),
  resume: Schema.optionalKey(Schema.String),
  /** When it was asked, or the run ended stuck. */
  at: Schema.Finite,
  /** The person has opened the list since it came. */
  seen: Schema.Boolean,
});
export type Ask = typeof Ask.Type;

/**
 * What the frame shows, from the ledger: the live asks (the count), oldest first, the ones set
 * aside, and whether the ledger answers.
 *
 * `reach`: `reading` before the first read, `ok` once one worked, `failed` when the last failed.
 */
export const AsksNow = Schema.Struct({
  asks: Schema.Array(Ask),
  later: Schema.Array(Ask),
  reach: Schema.Literals(["reading", "ok", "failed"]),
  /** Why the last read failed, in words, or `null`. */
  why: Schema.NullOr(Schema.String),
});
export type AsksNow = typeof AsksNow.Type;

/** An ask's key, as a page sends it back and the host keeps it: short, on one line. */
export const AskKey = Schema.String.check(Schema.isPattern(/^\S{1,300}$/));

/** The person's own marks on the asks, kept between starts of the host: asks.json in the home. */
export const Marks = Schema.Struct({
  /** The keys set aside. */
  later: Schema.Array(AskKey),
  /** The keys seen in the list. */
  seen: Schema.Array(AskKey),
});
export type Marks = typeof Marks.Type;

/** No marks: every ask counts, and every ask is new. */
export const NO_MARKS: Marks = { later: [], seen: [] };

/**
 * The marks kept from before, read back from the file's text as the host starts: `none` when
 * there was no file, `refused` with why when it does not read, as a broken file or one an older
 * build wrote. Either way the host starts with `NO_MARKS`.
 */
type KeptMarks =
  | { readonly kind: "read"; readonly marks: Marks }
  | { readonly kind: "none" }
  | { readonly kind: "refused"; readonly why: string };

const decodeMarks = Schema.decodeUnknownExit(Schema.fromJsonString(Marks));

/** Read back the marks a host kept, from the file's text, or `null`: there is no file. */
export const readMarks = (text: string | null): KeptMarks => {
  if (text === null) {
    return { kind: "none" };
  }

  const exit = decodeMarks(text, { onExcessProperty: "error" });

  if (Exit.isSuccess(exit)) {
    return { kind: "read", marks: exit.value };
  }

  const failure = Cause.squash(exit.cause);
  return { kind: "refused", why: failure instanceof Error ? failure.message : String(failure) };
};

/** The asks machine's state. */
export interface Asks {
  readonly tickets: readonly Ticket[];
  /** The last row's place read so far. */
  readonly after: number;
  /** A load is out; `again`: and news came while it was, so one more follows. */
  readonly load: "idle" | "busy" | "again";
  readonly reach: AsksNow["reach"];
  readonly why: string | null;
  /** The keys the person set aside. */
  readonly later: readonly string[];
  /** The keys the person has seen in the list. */
  readonly seen: readonly string[];
  /** The clock's last tick, the time the tracker's head is read at. 0: no tick yet. */
  readonly now: number;
}

export type AsksMsg =
  | { readonly type: "moved" }
  /** The poll could not read the ledger. */
  | { readonly type: "failed"; readonly why: string }
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "later"; readonly key: string }
  | { readonly type: "back"; readonly key: string }
  | { readonly type: "seen" };

/** Read the ledger's tickets after `after`: the facts found, and the last row's place. */
export const load = Cmd.make("load", {
  input: Schema.Struct({ after: Schema.Int }),
  ok: Schema.Struct({ entries: Schema.Array(Entry), last: Schema.Int }),
  err: ["unreachable"],
});

/** The poll: rows after `after` are news; `failed`, and the first read that works is news too. */
type PollSub = Sub<"poll", { readonly after: number; readonly failed: boolean }>;
/** The clock: the time, once a minute. */
type ClockSub = Sub<"clock", Record<string, never>>;

type Step = readonly [Asks, readonly ReturnType<typeof load>[]];

const START: Asks = {
  tickets: [],
  after: 0,
  load: "busy",
  reach: "reading",
  why: null,
  later: [],
  seen: [],
  now: 0,
};

/** Why a cell failed, in words. */
const whyOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "why" in error && typeof error.why === "string"
    ? error.why
    : String(error);

/** A load came back, or failed: one more if news came meanwhile. */
const settled = (s: Asks): Step =>
  s.load === "again" ? [{ ...s, load: "busy" }, [load({ after: s.after })]] : [{ ...s, load: "idle" }, []];

/** The keys of what waits now. */
const waitingKeys = (s: Asks): ReadonlySet<string> => new Set(waitingOf(s.tickets, s.now).map((a) => a.key));

/** Only the keys that wait: the same list when every one does. */
const only = (keys: readonly string[], waiting: ReadonlySet<string>): readonly string[] =>
  keys.every((k) => waiting.has(k)) ? keys : keys.filter((k) => waiting.has(k));

export const asksMachine = defineMachine({
  types: {
    model: {} as Asks,
    msg: {} as AsksMsg,
    sub: {} as PollSub | ClockSub,
    /** The flags: the marks kept from before (`readMarks`), or `NO_MARKS`. */
    ctx: {} as Marks,
  },
  cmds: [load],
  init: (_loaded, kept): Step => [{ ...START, later: kept.later, seen: kept.seen }, [load({ after: 0 })]],
  update: {
    moved: (s): Step =>
      s.load === "idle" ? [{ ...s, load: "busy" }, [load({ after: s.after })]] : [{ ...s, load: "again" }, []],
    failed: (s, m): Step => [{ ...s, reach: "failed", why: m.why }, []],
    tick: (s, m): Step => [{ ...s, now: m.now }, []],
    // Only an ask that waits is set aside: one answered since the list was drawn is gone.
    later: (s, m): Step =>
      s.later.includes(m.key) || !waitingKeys(s).has(m.key) ? [s, []] : [{ ...s, later: [...s.later, m.key] }, []],
    back: (s, m): Step =>
      s.later.includes(m.key) ? [{ ...s, later: s.later.filter((k) => k !== m.key) }, []] : [s, []],
    seen: (s): Step => {
      const keys = waitingOf(s.tickets, s.now).map((a) => a.key);
      const fresh = keys.filter((k) => !s.seen.includes(k));
      return fresh.length === 0 ? [s, []] : [{ ...s, seen: [...s.seen, ...fresh] }, []];
    },
    // The ledger as read so far, whole: a mark whose ask waits no more is dropped.
    load_ok: (s, m): Step => {
      const folded = fold(s.tickets, m.value.entries);
      const read: Asks = {
        ...s,
        tickets: folded.tickets,
        after: Math.max(s.after, m.value.last),
        reach: "ok",
        why: null,
      };
      const waiting = waitingKeys(read);
      return settled({ ...read, later: only(s.later, waiting), seen: only(s.seen, waiting) });
    },
    load_err: (s, m): Step => settled({ ...s, reach: "failed", why: whyOf(m.error) }),
  },
  subs: [
    {
      type: "poll",
      deps: (s) => (s.load === "idle" ? { after: s.after, failed: s.reach === "failed" } : null),
    } satisfies DepKeyedSub<Asks, PollSub>,
    { type: "clock", deps: () => ({}) } satisfies DepKeyedSub<Asks, ClockSub>,
  ],
});

/** A thing that waits, before the person's seen and later are put on it. */
type Waiting = Omit<Ask, "seen">;

/**
 * What waits on the person, oldest first, by the tracker's own head: each open ask of a ticket
 * whose head is `asks`, and the stuck run of one whose head is `stuck`.
 */
export const waitingOf = (tickets: readonly Ticket[], now: number): readonly Waiting[] =>
  tickets
    .flatMap((ticket): Waiting[] => {
      const head = headOf(ticket.timeline, now);
      const of = { ticket: ticket.number, title: ticket.title };

      if (head._tag === "asks") {
        return head.asks.map((a) => ({
          ...of,
          key: `${ticket.number}/${a.ask}`,
          what: a.what,
          kind: "ask",
          ...(a.sealed === undefined ? {} : { sealed: a.sealed, ...(a.for === undefined ? {} : { for: a.for }) }),
          at: a.at,
        }));
      }

      if (head._tag !== "stuck") {
        return [];
      }

      const ended = ticket.timeline.findLast((e) => e.fact.type === "ended");
      const run = ended?.fact.type === "ended" ? ended.fact.run : "run";
      return [
        {
          ...of,
          key: `${ticket.number}/stuck/${run}`,
          what: words(head.why),
          kind: "stuck",
          why: head.why,
          resume: head.stage,
          at: ended?.at ?? now,
        },
      ];
    })
    .sort((a, b) => a.at - b.at);

/** The frame's view of the asks: one value, for the top bar, the badge and the list alike. */
export const asksNow = (s: Asks): AsksNow => {
  const groups = new Map<string, Waiting[]>();

  for (const row of waitingOf(s.tickets, s.now)) {
    const kind = row.for ?? row.kind;
    groups.set(kind, [...(groups.get(kind) ?? []), row]);
  }

  const all = [...groups.values()].flat().map((a) => ({ ...a, seen: s.seen.includes(a.key) }));
  return {
    asks: all.filter((a) => !s.later.includes(a.key)),
    later: all.filter((a) => s.later.includes(a.key)),
    reach: s.reach,
    why: s.why,
  };
};

/** What the host keeps of the machine: the person's marks. */
export const marksOf = (s: Asks): Marks => ({ later: s.later, seen: s.seen });

/**
 * The asks to tell the person of, as the app's notification does: the live ones whose keys were
 * not there before. `null` before: the first value since the app attached, which tells of none,
 * so a start or a reconnect never shouts every old ask.
 */
export const newAsks = (before: ReadonlySet<string> | null, now: AsksNow): readonly Ask[] =>
  before === null ? [] : now.asks.filter((a) => !before.has(a.key));

/** Every key the person knows of: the live asks and the ones set aside. */
export const keysOf = (now: AsksNow): ReadonlySet<string> => new Set([...now.asks, ...now.later].map((a) => a.key));

/** What a notification says of new asks: the one ask, in its ticket's words, or how many. */
export const noticeOf = (fresh: readonly [Ask, ...Ask[]]): { title: string; body: string } => {
  const [first, ...rest] = fresh;
  const said = (a: Ask) => (a.kind === "stuck" ? `stuck: ${a.what}` : a.what);

  if (rest.length === 0) {
    return { title: `#${first.ticket} ${first.title}`, body: said(first) };
  }

  return {
    title: `${fresh.length} new asks`,
    body: fresh.map((a) => `#${a.ticket} ${said(a)}`).join("\n"),
  };
};

// ---------------------------------------------------------------- the cells, on the `Ledger`

/**
 * The name whose inbox keeps each system notification sent of new asks, one row per notification
 * (plan: "Record each newly sent notice"). Outside `tracker/ticket`, so no ticket's facts and no
 * count of asks reads it; attention per ticket folds it by the tickets each row names.
 */
const NOTICES = "asks/notices";

/**
 * Keep one sent notification on the ledger, as `noticed` in `asks/notices/inbox`, written as the
 * person whose app showed it. Its id is the app's send time and first ask, so a retry of one send
 * is one row. A past notification is never invented: only a send the app reports is kept.
 */
export const noticeCell = (notice: Noticed, writer: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    yield* ledger.register(NOTICES, writer);
    const { type: _type, ...data } = notice;
    yield* ledger.send(streams(NOTICES).inbox, `notice/${notice.sentAt}/${notice.asks[0].key}`, {
      kind: "noticed",
      writer,
      data,
    });
  });

/** Rows read per call. */
const PAGE = 500;

/** Every ticket's row after `after`, read in pages. A row that does not read is left out. */
export const loadCell = (cmd: ReturnType<typeof load>) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const entries: Entry[] = [];
    let last = cmd.after;

    for (;;) {
      const page = yield* ledger.read(last, PAGE, ROOT);

      for (const row of page) {
        const read = readRow(row);

        if (read.kind === "entry") {
          entries.push(read.entry);
        }
      }

      last = page.at(-1)?.pos ?? last;

      if (page.length < PAGE) {
        break;
      }
    }

    // Each ticket's parked old asks are sealed once per read, after the paging. A ticket whose old
    // ask cannot be sealed keeps it parked and leaves every other ticket's asks to load; the sealed
    // asks written here come back on the next read, which the poll starts.
    for (const n of new Set(
      entries.filter((e) => e.fact.type === "asked" && !("format" in e.fact)).map((e) => e.ticket),
    )) {
      yield* preparePending(n).pipe(
        Effect.catch((e) =>
          Effect.logWarning(`ticket ${n}: an old ask was not sealed`, "why" in e ? e.why : e.message),
        ),
      );
    }

    return { entries, last };
  }).pipe(Effect.mapError((e) => ({ _tag: "unreachable" as const, why: "why" in e ? e.why : e.message })));

/** How often the poll asks the ledger for news, as the tracker's does. */
const POLL = Duration.seconds(1);

/**
 * `moved` once the ledger has a row after `after`, or once it answers again after a failure;
 * `failed` once a read fails while the last one worked.
 */
const pollRunner = (sub: PollSub) =>
  Stream.tick(POLL).pipe(
    Stream.mapEffect(() =>
      Effect.gen(function* () {
        return yield* (yield* Ledger).read(sub.deps.after, 1, ROOT);
      }).pipe(
        Effect.map((rows): AsksMsg | null => (rows.length > 0 || sub.deps.failed ? { type: "moved" } : null)),
        Effect.catch((e) =>
          Effect.succeed<AsksMsg | null>(sub.deps.failed ? null : { type: "failed", why: e.message }),
        ),
      ),
    ),
    Stream.filter((m): m is AsksMsg => m !== null),
    Stream.take(1),
  );

/** How often the clock ticks: the tracker's head reads the time, as its own list does. */
const CLOCK = Duration.minutes(1);

/** `tick` with the time, at once and then once a minute. */
const clockRunner = (_sub: ClockSub) =>
  Stream.tick(CLOCK).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map((now): AsksMsg => ({ type: "tick", now })),
  );

/** How the machine runs: on the marks kept from before, with its cell and Subs, on the `Ledger` service. */
export const asksOptions = (kept: Marks) => ({
  ctx: kept,
  interpret: { load: loadCell },
  subscribe: { poll: pollRunner, clock: clockRunner },
});
