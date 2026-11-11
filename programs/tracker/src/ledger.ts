import { Ledger, MEMBERS, namesOf, type Row, streams, type Writer, writerText } from "@kampus/fabrika-old";
import { readFacts } from "@kampus/pipeline/asks/ledger";
import { foldLedger } from "@kampus/pipeline/asks/rules";
import { AREAS, type AreaEntry, areasOf, readAreaRow } from "@kampus/pipeline/tickets/area";
import { questionLine, sealAsk } from "@kampus/pipeline/tickets/ask";
import { askedFor, askedStep, LaneStep } from "@kampus/pipeline/tickets/steps";
import {
  type AnswerRefusal,
  type Entry,
  alreadyAnswered,
  answerRefused,
  closedAsks,
  factsOf,
  fold,
  mayWrite,
  nameOf,
  readAnswer,
  readRow,
  writtenDuring,
} from "@kampus/pipeline/tickets/ticket";
import { Schema } from "effect";
import { Clock, Context, Duration, Effect, Stream } from "effect";
import type { ClockSub, load, PollSub, save, saveHints } from "./machine.ts";
import { type AreaWrite, areaFactOf, factOf, isAreaWrite, type TicketWrite } from "./ticket.ts";

// The tracker's cells and its poll: the only code that talks to the ledger. Through the `Ledger`
// service, never the file under it, so the same tracker runs on memory in a test and on
// node:sqlite in the app.
//
//   save {id: "w1", write: {kind: "file", title: "Login fails", body: ""}, next: 1}
//     register tracker/ticket/1                     taken already? then 2, 3, ... until one is new
//     send tracker/ticket/1/inbox, id w1            {type: "filed", ...}, writer "user:owner"
//     // {ticket: 1}
//
//   save {id: "w2", write: {kind: "make_area", name: "lane"}, next: 2}
//     read tracker/areas/inbox, fold it              the next area is 1; is the name free?
//     append tracker/areas/inbox at the rev read     {_tag: "area_made", area: 1, ...}; Stale? read again
//     // {area: 1}
//
// Who writes is the `Author` service: the host says who sits at the window.

/** Who the tracker writes as. */
export class Author extends Context.Service<Author, Writer>()("@tea-fabrika/tracker/Author") {}

/** Rows read per call. */
const PAGE = 500;

/** The most numbers a new ticket passes over before it gives up: each one was taken. */
const TRIES = 1000;

/** The ledger did not answer: the tag a cell fails with, and why in words. */
const unreachable = (e: { readonly message: string }) => ({
  _tag: "unreachable" as const,
  why: e.message,
});

/**
 * A write the ledger did not answer, in the words a person reads. The store's own text goes to the
 * log only: it names a database, not what the person can do.
 */
const notSaved = (e: { readonly message: string }) =>
  Effect.logWarning("the ledger did not take a write", e.message).pipe(
    Effect.andThen(
      Effect.fail({
        _tag: "unreachable" as const,
        why: "Could not reach the ledger. Nothing was saved. Try again.",
      }),
    ),
  );

/** The ledger said no, and why in the words a person reads. */
const refusal = (why: string) => ({ _tag: "refused" as const, why });
/** The ledger said no to a write on one stream, named for whoever reads the log. */
const refused = (stream: string) => refusal(`the ledger refused ${stream}`);

/**
 * An agent's entry with its person's name, when this ledger's members name them. A ledger with no
 * door has no members, and its entries stay as they are.
 */
const named = (entry: Entry, names: ReadonlyMap<string, string>): Entry => {
  const whose = "for" in entry.by ? names.get(entry.by.for) : undefined;
  return whose === undefined ? entry : { ...entry, whose };
};

/**
 * The name the tickets (`tracker/ticket/<n>`) and the areas (`tracker/areas`) are both under. One
 * read of it, with one place, so a row of either written while the other is read is never passed.
 */
const TRACKER = "tracker";

/** Every row after `after` under the tracker's prefix, read in pages: the tickets' and the areas'. */
export const loadCell = (cmd: ReturnType<typeof load>) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const entries: Entry[] = [];
    const areas: AreaEntry[] = [];
    const broken: string[] = [];
    let last = cmd.after;
    const names = namesOf(yield* ledger.readStream(MEMBERS));

    for (;;) {
      const page = yield* ledger.read(last, PAGE, TRACKER);

      for (const row of page) {
        const read = readRow(row);

        if (read.kind === "entry") {
          entries.push(named(read.entry, names));
        }

        if (read.kind === "broken") {
          broken.push(read.why);
        }

        const area = readAreaRow(row);

        if (area._tag === "entry") {
          areas.push(area.entry);
        }

        if (area._tag === "broken") {
          broken.push(area.why);
        }
      }

      last = page.at(-1)?.pos ?? last;

      if (page.length < PAGE) {
        return { entries, broken, last, areas };
      }
    }
  }).pipe(Effect.mapError(unreachable));

/** A new ticket's number: the first from `next` whose name nobody registered yet, registered now. */
const claim = (next: number, writer: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    for (let n = next; n < next + TRIES; n++) {
      if ((yield* ledger.register(nameOf(n), writer)).created) {
        return n;
      }
    }

    return yield* Effect.fail(refused(`${TRIES} ticket numbers from ${next}: every one was taken`));
  });

/** Ticket `n`'s timeline, folded from its inbox's rows, so a fact that does not fit is kept out. */
const timelineOf = (n: number, rows: readonly Row[]): readonly Entry[] => {
  const entries = rows.flatMap((row) => {
    const read = readRow(row);
    return read.kind === "entry" ? [read.entry] : [];
  });
  return fold([], entries).tickets.find((t) => t.number === n)?.timeline ?? [];
};

/** The areas' inbox. */
const AREAS_INBOX = streams(AREAS).inbox;

/**
 * One area write, as one fact on the areas' inbox, under the write's message id. The stream is
 * read and folded first, and the fact goes at the place it was read to: a write that landed in
 * between makes the ledger say `Stale`, and it is read and checked again. So two people who make
 * an area at once get two numbers, and a name taken a moment ago is refused, in words.
 */
const saveArea = (id: string, write: AreaWrite) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const author = yield* Author;
    const writer = writerText(author);

    // A ledger behind the door refuses this too; a ledger in this process does not, so it is here.
    if (author.kind !== "user") {
      return yield* Effect.fail({
        _tag: "refused" as const,
        why: `only a person writes ${write.kind}, and this tracker writes as agent ${author.id}`,
      });
    }

    yield* ledger.register(AREAS, writer);

    for (let tries = 0; tries < TRIES; tries++) {
      const rows = yield* ledger.readStream(AREAS_INBOX, 0, -1);
      const entries = rows.flatMap((row) => {
        const read = readAreaRow(row);
        return read._tag === "entry" ? [{ id: row.id, entry: read.entry }] : [];
      });
      // An earlier try of this same write landed: it is not written twice.
      const landed = entries.find((e) => e.id === id);

      if (landed !== undefined) {
        return { area: landed.entry.fact.area };
      }

      const made = areaFactOf(write, areasOf(entries.map((e) => e.entry)).areas);

      if ("why" in made) {
        return yield* Effect.fail({ _tag: "refused" as const, why: made.why });
      }

      const { fact } = made;
      const wrote = yield* ledger
        .append(AREAS_INBOX, rows.at(-1)?.rev ?? 0, { kind: fact._tag, writer, data: fact, id })
        .pipe(
          Effect.as(true),
          Effect.catchTag("Stale", () => Effect.succeed(false)),
        );

      if (wrote) {
        return { area: fact.area };
      }
    }

    return yield* Effect.fail(refused(`${AREAS_INBOX}: ${TRIES} tries, each one stale`));
  });

/**
 * One write: an area write on the areas' stream, any other as one fact in its ticket's inbox,
 * under the write's message id.
 */
export const saveCell = (cmd: ReturnType<typeof save>) =>
  Effect.gen(function* () {
    const { write } = cmd;
    return isAreaWrite(write) ? yield* saveArea(cmd.id, write) : yield* saveTicket(cmd, write);
  }).pipe(
    Effect.catchTags({
      LedgerUnreachable: notSaved,
      Denied: (e) => Effect.fail(refused(e.stream)),
      Fenced: (e) => Effect.fail(refused(e.stream)),
      UnknownName: (e) => Effect.fail(refused(e.stream)),
    }),
  );

/** One ticket write, as one fact in its ticket's inbox. */
const saveTicket = (cmd: ReturnType<typeof save>, write: TicketWrite) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const author = yield* Author;
    const writer = writerText(author);
    const fact = yield* factOf(write);

    // A ledger behind the door refuses this too; a ledger in this process does not, so it is here.
    if (!mayWrite(author, fact.type)) {
      return yield* Effect.fail({
        _tag: "refused" as const,
        why: `only a person writes ${fact.type}, and this tracker writes as agent ${author.id}`,
      });
    }

    const ticket = write.kind === "file" ? yield* claim(cmd.next, writer) : write.ticket;
    const inbox = streams(nameOf(ticket)).inbox;

    if (fact.type === "answered") {
      for (let tries = 0; tries < TRIES; tries++) {
        const rows = yield* ledger.readStream(inbox, 0, -1);
        const timeline = timelineOf(ticket, rows);
        const landed = factsOf(timeline, "answered").find((a) => a.ask === fact.ask);

        if (landed !== undefined) {
          // The same pick again is one answer: a retry, or a second click. Another pick lost the race.
          const won = readAnswer(timeline, landed)?.pick;

          if (won === undefined || won === readAnswer(timeline, fact)?.pick) {
            return { ticket };
          }

          return yield* Effect.fail(refusal(alreadyAnswered(won)));
        }

        const now = yield* Clock.currentTimeMillis;
        const ask = factsOf(timeline, "asked").find((a) => a.ask === fact.ask);
        const why: AnswerRefusal | null =
          "format" in fact
            ? answerRefused(timeline, fact, now)
            : ask === undefined
              ? "The ask is missing"
              : "format" in ask
                ? "The ask needs an exact display answer"
                : factsOf(timeline, "withdrawn").some((w) => w.ask === ask.ask)
                  ? "The ask was withdrawn"
                  : !ask.picks.includes(fact.pick)
                    ? "The answer is not offered"
                    : null;

        if (why !== null) {
          return yield* Effect.fail(refusal(why));
        }

        const wrote = yield* ledger
          .append(inbox, rows.at(-1)?.rev ?? 0, {
            id: `answer/${fact.ask}`,
            kind: "answered",
            writer,
            data: fact,
          })
          .pipe(
            Effect.as(true),
            Effect.catchTag("Stale", () => Effect.succeed(false)),
          );

        if (wrote) {
          return { ticket };
        }
      }

      return yield* Effect.fail(refusal("The question kept changing. Try again." satisfies AnswerRefusal));
    }

    // A comment names the run live as it is written, read off the ticket's own facts.
    const data =
      fact.type === "commented"
        ? writtenDuring(fact, timelineOf(ticket, yield* ledger.readStream(inbox, 0, -1)))
        : fact;
    yield* ledger.send(inbox, cmd.id, { kind: data.type, writer, data });
    return { ticket };
  });

/**
 * Seal a parked old question once before any view is allowed to draw it. The sealed replacement is
 * written first and the old ask withdrawn second, so a stop between the two leaves the replacement
 * to answer; the next start writes the withdrawal. Code writes both, for the person (`sealerOf`).
 */
export const prepareAsk = (ticket: number, ask: string, draft: unknown) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const writer = writerText(sealerOf(yield* Author));
    const inbox = streams(nameOf(ticket)).inbox;

    for (let tries = 0; tries < TRIES; tries++) {
      const rows = yield* ledger.readStream(inbox, 0, -1);
      const timeline = timelineOf(ticket, rows);
      const existing = factsOf(timeline, "asked").find((a) => "format" in a && (a.ask === ask || a.replaces === ask));
      const withdrawn = factsOf(timeline, "withdrawn").some((w) => w.ask === ask);

      if (existing !== undefined && "format" in existing && (withdrawn || existing.ask === ask)) {
        return existing;
      }

      const old = factsOf(timeline, "asked").find((a) => a.ask === ask);

      if (existing === undefined && (old === undefined || factsOf(timeline, "answered").some((a) => a.ask === ask))) {
        return yield* Effect.fail(refusal("The pending question is missing"));
      }

      const sealed =
        existing !== undefined && "format" in existing
          ? existing
          : yield* sealAsk({
              ...(draft as object),
              ask: `${ask}/sealed`,
              replaces: ask,
              rec: { _tag: "none", why: "No recommendation was recorded" },
            });
      const replaced = existing !== undefined;
      const data = replaced ? { type: "withdrawn", ask, why: "changed" } : sealed;
      const wrote = yield* ledger
        .append(inbox, rows.at(-1)?.rev ?? 0, {
          id: replaced ? `withdraw/${ask}` : sealed.ask,
          kind: data.type,
          writer,
          data,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTag("Stale", () => Effect.succeed(false)),
        );

      if (!wrote) {
        continue;
      }
    }

    return yield* Effect.fail(refusal("The pending question kept changing"));
  });

/** Recover only evidence the ledger actually kept. Unknown old change approvals stay unreadable. */
export const preparePending = (number: number) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const timeline = timelineOf(number, yield* ledger.readStream(streams(nameOf(number)).inbox));
    // Open, or replaced by a sealed ask but not yet withdrawn: a stop between the two writes.
    const closed = closedAsks(timeline);
    const answered = new Set(factsOf(timeline, "answered").map((a) => a.ask));
    const withdrawn = new Set(factsOf(timeline, "withdrawn").map((w) => w.ask));
    const pending = factsOf(timeline, "asked").filter(
      (a) => !("format" in a) && !answered.has(a.ask) && (!closed.has(a.ask) || !withdrawn.has(a.ask)),
    );

    if (pending.length === 0) {
      return;
    }

    const stored = foldLedger(yield* readFacts);
    const tracks = [...stored.plans.values()].filter((p) => p.tickets.some((t) => t.endsWith(`#${number}`)));
    const track = tracks.length === 1 ? tracks[0] : undefined;
    const version = factsOf(timeline, "planned").at(-1)?.version;
    const plan = track?.versions.findLast((p) => p.version === version);
    const last = factsOf(timeline, "ended").at(-1)?.stage;
    const step = last !== undefined && Schema.is(LaneStep)(last) ? last : "plan";

    for (const old of pending) {
      if ("format" in old) {
        continue;
      }

      const kind = askedFor(old.ask);

      if (kind === "merge" || kind === "exam_merge" || (kind === "approve" && plan === undefined)) {
        continue;
      }

      const first = timeline[0]?.fact;
      const title = first?.type === "filed" ? first.title : "State not recorded";
      const body = first?.type === "filed" ? first.body : "";
      // An old ask's question could run to 256 characters; the sealed ask shows one line and keeps
      // the whole question beside it, as a lane's own ask does.
      const what = questionLine(old.what);
      const whole = what === old.what ? [] : [old.what];
      const text = [...whole, ...factsOf(timeline, "commented").map((f) => f.body)].join("\n\n");
      yield* prepareAsk(number, old.ask, {
        for: kind ?? "unknown",
        step: kind === null ? step : askedStep(kind, step),
        repo: track?.plan.split("#")[0] ?? "unknown",
        why: null,
        what,
        picks: old.picks.map((pick) => ({
          pick,
          does:
            pick === "approve"
              ? "Approve this plan and continue to the exam"
              : pick === "no"
                ? "Keep the lane parked for a new plan"
                : `Resume the saved lane with ${pick}`,
        })),
        ticket: { title, body },
        until: null,
        evidence:
          kind === "approve" && plan !== undefined
            ? {
                _tag: "plan",
                version: plan.version,
                plan: plan.data,
                ...(whole.length === 0 ? {} : { text: whole[0] }),
              }
            : { _tag: "other", text },
        ...(old.trace === undefined ? {} : { trace: old.trace }),
      });
    }
  });

/**
 * Who writes a duplicate hint: code, as the agent `duplicates` working for whoever sits at the
 * window, never the person. On a ledger behind the door, the door stamps the row from the session
 * instead, so there it reads as the session's writer until a host's agents sign in as their
 * person.
 */
export const hinterOf = (author: Writer): Writer => codeFor("duplicates", author);

/** Who seals a parked old ask: code, as the agent `asks` working for whoever sits at the window. */
const sealerOf = (author: Writer): Writer => codeFor("asks", author);

/** Code named `id`, working for the person behind `author`. An agent for no one stays itself. */
const codeFor = (id: string, author: Writer): Writer =>
  author.kind === "user"
    ? { kind: "agent", id, for: author.id }
    : "for" in author
      ? { kind: "agent", id, for: author.for }
      : author;

/** A ticket's duplicate hints, one fact each, under ids made from the ticket and the hint. */
export const saveHintsCell = (cmd: ReturnType<typeof saveHints>) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const writer = writerText(hinterOf(yield* Author));

    for (const hint of cmd.hints) {
      yield* ledger.send(streams(nameOf(cmd.ticket)).inbox, `maybe_duplicate/${cmd.ticket}/${hint.of}`, {
        kind: "maybe_duplicate",
        writer,
        data: { type: "maybe_duplicate", of: hint.of, yes: hint.yes },
      });
    }

    return {};
  }).pipe(
    Effect.catchTags({
      LedgerUnreachable: notSaved,
      Denied: (e) => Effect.fail(refused(e.stream)),
      Fenced: (e) => Effect.fail(refused(e.stream)),
      UnknownName: (e) => Effect.fail(refused(e.stream)),
    }),
  );

/** How often the poll asks the ledger for news. */
export const POLL = Duration.seconds(1);

/** `moved`, once the ledger has a row after `after`. A failed ask is asked again at the next tick. */
export const pollRunner = (sub: PollSub) =>
  Stream.tick(POLL).pipe(
    Stream.mapEffect(() =>
      Effect.gen(function* () {
        return yield* (yield* Ledger).read(sub.deps.after, 1, TRACKER);
      }).pipe(Effect.orElseSucceed(() => [])),
    ),
    Stream.filter((rows) => rows.length > 0),
    Stream.take(1),
    Stream.map(() => ({ type: "moved" as const })),
  );

/** How often the clock ticks: a ticket's line turns "idle" within a minute of its hour. */
export const CLOCK = Duration.minutes(1);

/** `tick` with the time, at once and then once a minute. */
export const clockRunner = (_sub: ClockSub) =>
  Stream.tick(CLOCK).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map((now) => ({ type: "tick" as const, now })),
  );
