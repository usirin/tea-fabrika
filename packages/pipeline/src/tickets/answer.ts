import { Ledger, type Row, streams, type Writer, writerText } from "@kampus/fabrika-old";
import { Clock, Effect } from "effect";
import {
  type AnswerRefusal,
  type Entry,
  type FactOf,
  alreadyAnswered,
  answerRefused,
  factsOf,
  fold,
  mayWrite,
  nameOf,
  readAnswer,
  readRow,
} from "./ticket.ts";

// The one checked answer save: the tracker's window, the host and the lane harness all write a
// person's answer through it.
//
//   saveAnswer(117, {type: "answered", format: 1, ask: "plan-v2", answer: {_tag: "rec"}, ...}, owner)
//     read tracker/ticket/117/inbox, fold it        the ask is open, offered, and its display hash matches?
//     append at the rev read, id answer/plan-v2      Stale? read and check again
//     // {ticket: 117}

/** The most times a write reads its stream again after a write landed in between. */
export const TRIES = 1000;

/** The ledger said no, and why in the words a person reads. */
const refusal = (why: string) => ({ _tag: "refused" as const, why });

/** Ticket `n`'s timeline, folded from its inbox's rows, so a fact that does not fit is kept out. */
export const timelineOf = (n: number, rows: readonly Row[]): readonly Entry[] => {
  const entries = rows.flatMap((row) => {
    const read = readRow(row);
    return read.kind === "entry" ? [read.entry] : [];
  });
  return fold([], entries).tickets.find((t) => t.number === n)?.timeline ?? [];
};

/**
 * One person's answer, checked against the ticket's timeline and appended at the rev read, under
 * `answer/<ask>`. The same pick again is one answer; another pick loses the race. It fails
 * `{_tag: "refused", why}`; ledger errors pass through to the caller.
 */
export const saveAnswer = (ticket: number, fact: FactOf<"answered">, author: Writer) =>
  Effect.gen(function* () {
    // A ledger behind the door refuses this too; a ledger in this process does not, so it is here.
    if (!mayWrite(author, fact.type)) {
      return yield* Effect.fail(refusal(`only a person writes ${fact.type}, and this writer is agent ${author.id}`));
    }

    const ledger = yield* Ledger;
    const writer = writerText(author);
    const inbox = streams(nameOf(ticket)).inbox;

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
  });
