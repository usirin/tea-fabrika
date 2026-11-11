import { type Row, TraceId, Writer, type Writes, writerOf } from "@kampus/fabrika-old";
import { Option, Schema } from "effect";
import { Asked, Answered, answerOf } from "./ask.ts";

// A ticket: one stream of facts on the ledger, and nothing else
// (docs/direction/tickets-start-in-our-tracker.md). Ticket 3 is the registered name
// `tracker/ticket/3`, and its facts are the messages in that name's inbox, oldest first. The row
// says who wrote a fact (a user or an agent) and when; the fact says only what happened:
//
//   tracker/ticket/3/inbox   {type: "filed", title: "Login fails", body: "On main."}   user:owner
//                            {type: "commented", body: "Seen it too."}                  agent:review
//                            {type: "closed"}                                           user:owner
//
//   fold([], entries).tickets   [{number: 3, title: "Login fails", state: "closed", timeline: [3 entries]}]
//
// A state change is a fact of its own (`closed`, `reopened`), never a comment. The facts live in
// the pipeline, so a lane reads and writes the same ones the tracker shows
// (docs/direction/a-ticket-runs-from-the-app.md, section 3); the tracker imports them. This file
// is pure: ./tickets.ts reads and writes the ledger, and so does the tracker's own ledger.ts.

/** A ticket's number: 1, 2, 3, in the order the tickets were filed. */
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** One line, with no space at either end. */
export const Title = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(256),
  Schema.isPattern(/^[^\r\n]*$/),
);

/** A cut title stays well inside its limit, so a word or two may follow it. */
const TITLE_CUT = 200;

/**
 * Any text as a {@link Title}: line breaks to spaces, cut, and trimmed after the cut, since a cut can
 * land on a space. The one way text that was not written as a title becomes one. Pure.
 */
export const titleOf = (text: string): string =>
  text
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, TITLE_CUT)
    .trim() || "(no title)";

const BODY_MOST = 65_536;

/** A ticket's body: any text, empty too. */
export const Body = Schema.String.check(Schema.isMaxLength(BODY_MOST));

/** A comment's text: a body with something in it besides spaces. */
export const Said = Body.check(Schema.isPattern(/\S/));

/** The most failing tests a step's end names. A run with more keeps the first; the comment says how many. */
export const FAILED_MOST = 50;

const CUT_NOTE = "\n\n(cut here: it was too long for a comment)";

/** Any text as what a {@link Said} can hold, saying so where it was cut. Pure. */
export const saidOf = (text: string): string =>
  text.length <= BODY_MOST ? text : `${text.slice(0, BODY_MOST - CUT_NOTE.length)}${CUT_NOTE}`;

// ---------------------------------------------------------------- what a lane writes
//
// More kinds, the facts a lane works with
// (docs/direction/what-a-ticket-shows.md, section 2). Each is a tagged struct under `type`, the
// key the tracker's first four already use on the ledger, so the rows written before still read.
// The fields added since (`asks` and `during` on a comment, `text` on an answer, `trace` on a
// start) are optional for that reason.
//
//   {type: "started", run: "r-7", stage: "build", task: "t-2", log: null,
//    trace: "9c41…e07a"}                                                             code
//   {type: "session", run: "r-7", id: "019a2f…"}                                      code, once
//   {type: "ended", run: "r-7", stage: "build", outcome: {kind: "send", to: "review", why: "built"},
//    usd: 0.41, input: 12000, output: 3000, turns: 14}                               code
//   {type: "asked", ask: "a-1", what: "approve plan v2", picks: ["approve", "no"]}   the stage that asks
//   {type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:9c1f…"}  a user, never an agent

/** One stage's name, as the pipeline spells it: `triage`, `build`, `review`, `test_writer`. */
export const Stage = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/));

/** An id on one line with no spaces: a run's (`r-7`), an ask's (`a-1`), a task's, a finding's. */
export const Id = Schema.String.check(Schema.isPattern(/^\S{1,128}$/));

/** A commit's sha: 7 to 64 hex digits. */
export const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));

/** A count: 0, 1, 2. */
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Each failing test by name, at most `FAILED_MOST`. */
const Failed = Schema.Array(Schema.String).check(Schema.isMaxLength(FAILED_MOST));

/**
 * One command of code's checks, as it ran. `command`: as the settings say it, `{out}` and all, so no
 * path from the machine that ran it. `code`: its exit code; `null` when it could not start or ran past
 * its time. `ms`: how long it took, both tries of one that could not start at first.
 */
const CommandRun = Schema.Struct({
  command: Schema.String,
  code: Schema.NullOr(Schema.Int),
  ms: Count,
});

/**
 * Code's own run of `[build] checks` at a head, after a build (docs/plan/pipeline-self-fix.md, PR 4).
 * `failed`: each failing test by name, when a command wrote vitest's report. `not_run`: a command
 * could not start, after one more try, or ran past its time, so nothing says whether the head holds.
 * Never read as green. The lane and the mutation step hand it on with any head; on the ticket the
 * head is a sha.
 *
 *   {head: "7a41…", result: "red", failed: ["src/clamp.test.ts > clamp > keeps a high number"],
 *    commands: [{command: "vitest run --reporter=json --outputFile={out}", code: 1, ms: 41250}]}
 */
export const Checked = Schema.Struct({
  head: Schema.String,
  commands: Schema.Array(CommandRun),
  result: Schema.Literals(["green", "red", "not_run"]),
  failed: Failed,
});
export type Checked = typeof Checked.Type;

/** Checks a step trusted in place of a run of its own: only green ones, at a sha. */
const Trusted = Schema.Struct({ ...Checked.fields, head: Sha, result: Schema.Literal("green") });

/** A stage's answer, in the five verbs (docs/direction/outcome-names.md): the `AnyOutcome` shape. */
export const Outcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("done"), part: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("send"), to: Stage, why: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("ask"), who: Schema.String, for: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("skip"), why: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("stuck"), why: Schema.String }),
]);
export type Outcome = typeof Outcome.Type;

/** One check on a pull request, in GitHub's own words (the REST API's check runs). */
export const Check = Schema.Struct({
  name: Title,
  status: Schema.Literals(["queued", "in_progress", "completed"]),
  /** Set once it is `completed`. */
  conclusion: Schema.NullOr(
    Schema.Literals(["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale"]),
  ),
});
export type Check = typeof Check.Type;

/** A pull request's state, as the watcher read it from GitHub. */
export const PrState = Schema.Literals(["draft", "open", "merged", "closed"]);

/** A hash of some text, as the facts spell it: `sha256:` and 64 hex digits. */
export const Hash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
export type Hash = typeof Hash.Type;

/**
 * What a comment asks for. Missing: nothing, it is talk. `changes`: the person clicked "Request
 * changes", GitHub's word in its review box. A person's stops build and asks for a new plan or a
 * new approval; an agent's stops nothing (./approval.ts).
 */
export const Asks = Schema.Literal("changes");

/**
 * What a yes on a pull request was given on, so code can tell later whether it still stands
 * (docs/direction/a-yes-binds-to-the-diff.md): `onto`, the branch it goes onto; `base`, where it left
 * that branch; `diff`, the id of its diff (`git patch-id --verbatim` over `git diff -U0`). Only known
 * when the yes is given. Each is left out on a fact written before them.
 */
const Given = Schema.Struct({
  onto: Schema.optionalKey(Id),
  base: Schema.optionalKey(Sha),
  diff: Schema.optionalKey(Sha),
});

/** A pull request's address on GitHub, or an address under it, such as a review comment's. */
const PullUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*(?:[/?#]\S*)?$/),
);

/**
 * Where a filing came from (docs/direction/a-ticket-says-where-it-came-from.md). Each key keeps the
 * one meaning it has elsewhere here: `url` as on {@link PrFact}, `run` as on `started`, `head` a
 * {@link Sha}. `pr`: a step of a pull request, or a comment on it. `run`: a lane run on this ledger;
 * its `started` fact names the step, so it carries none. `walk`: a person's walk of a pull request,
 * a note or an experiment.
 *
 *   {_tag: "pr", url: "https://github.com/usirin/tea-fabrika/pull/352", step: "mutation"}
 *   {_tag: "run", ticket: 117, run: "r-test_writer-26"}
 *   {_tag: "walk", url: "https://github.com/usirin/tea-fabrika/pull/332"}
 */
export const From = Schema.TaggedUnion({
  pr: { url: PullUrl, step: Schema.optionalKey(Stage) },
  run: { ticket: TicketNumber, run: Id, head: Schema.optionalKey(Sha) },
  walk: { url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)) },
});
export type From = typeof From.Type;

/** The tracker's own four: a ticket filed, talked about, closed and opened again. */
export const TicketFact = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("filed"),
    title: Title,
    body: Body,
    /** Where it came from. Missing: the filer named none, or it was filed before the key. */
    from: Schema.optionalKey(From),
  }),
  Schema.Struct({
    type: Schema.Literal("commented"),
    body: Said,
    asks: Schema.optionalKey(Asks),
    /**
     * The run that was live when the comment was written: the ticket's {@link liveRun}. Code fills
     * it in at the write; a person never types it. Missing: no run was live, or the comment was
     * written before the key.
     */
    during: Schema.optionalKey(Id),
  }),
  Schema.Struct({ type: Schema.Literal("closed") }),
  Schema.Struct({ type: Schema.Literal("reopened") }),
]);

/**
 * The facts a lane writes, through `Tickets.write`: every lane fact but the watcher's `pr` and a
 * person's `answered` and `rated` (docs/direction/a-ticket-runs-from-the-app.md, section 3). A
 * lane cannot even spell an answer to its own ask, or a merge, and `Tickets.write` checks it again
 * at run time, so a cast one is refused too.
 */
export const CodeFact = Schema.Union([
  Asked,
  Schema.Struct({ type: Schema.Literal("withdrawn"), ask: Id, why: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stopped"), why: Schema.String, resume: Stage }),
  /**
   * Code started an agent run. `log`: where its own log is, once there is one. `trace`: the trace
   * id of the job the run is in, the key of its `JobRecord`
   * (docs/direction/a-job-record-holds-its-trace.md). Left out by a run that has no record.
   */
  Schema.Struct({
    type: Schema.Literal("started"),
    run: Id,
    stage: Stage,
    task: Schema.NullOr(Id),
    log: Schema.NullOr(Schema.String),
    trace: Schema.optionalKey(TraceId),
    /** The brief this run was given: its file's name and the hash of the file. Only known now. */
    brief: Schema.optionalKey(Schema.String),
    hash: Schema.optionalKey(Schema.String),
    harness: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String),
    effort: Schema.optionalKey(Schema.String),
    /** The lane's round the run is in (self-fix PR 5). Left out: a start written before this key, or round 1. */
    round: Schema.optionalKey(Count),
  }),
  /**
   * The run ended, with its stage's answer, what it cost and how long it went. `usd`: dollars at
   * API list price where a rate is known, else 0. `listUsd`: the same, with `null` for a rate
   * nobody knows, so an unknown price never reads as free.
   */
  Schema.Struct({
    type: Schema.Literal("ended"),
    run: Id,
    stage: Stage,
    outcome: Outcome,
    usd: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    input: Count,
    output: Count,
    turns: Count,
    /** How many last messages did not fit their schema, each followed by one more try. */
    misfits: Schema.optionalKey(Count),
    harness: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String),
    effort: Schema.optionalKey(Schema.String),
    /** Part of `input`: the tokens read back from the maker's cache. */
    cached: Schema.optionalKey(Count),
    /** What the maker's own answer said was billed. `null`: it did not say, as on a flat plan. */
    billed: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    listUsd: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    minutes: Schema.optionalKey(Schema.Finite),
    /** The tests that failed at the run's head, by name, at most `FAILED_MOST`. The error text exists only now. */
    failed: Schema.optionalKey(Failed),
    /**
     * The green checks at the run's head it trusted in place of a run of its own, so a skip never
     * reads as a clean run: the mutation step's, which then runs no suite of its own.
     */
    trusted: Schema.optionalKey(Trusted),
    /**
     * Why a test writer's run on the base could not run, as the run said it (tracker 193): the cause,
     * the box's exit code (`null`: it never ended), how long it went, and stderr's last lines, with
     * no home path and no key. The cause exists only now. Left out: any other end. Its `why` is
     * `stages/test-writer/checked.ts`'s `RunWhy`, which this file cannot name.
     */
    failure: Schema.optionalKey(
      Schema.Struct({
        why: Schema.String,
        code: Schema.NullOr(Schema.Finite),
        ms: Schema.Finite,
        tail: Schema.String,
      }),
    ),
    /**
     * The step's input key (self-fix PR 5, P7): a hash of what it read
     * (`stages/pipeline/key.ts`). Only known now. Left out: an end written before the key.
     */
    key: Schema.optionalKey(Hash),
    /**
     * What `key` was made of, by name: values and hashes only, never a path or a secret, so a later
     * reader can say which input changed. Its shape is `stages/pipeline/key.ts`'s `Inputs`, which
     * this file cannot name. Left out: an end written before this key, or one with no key.
     */
    inputs: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
    ),
    /**
     * What the step left for the steps after it: the change to the lane's carry, which the lane's
     * fold reads back when its save is gone (self-fix PR 5, `stages/pipeline/restart.ts`). Only
     * known now. Its shape is the lane's own, which this file cannot name: the lane's types import
     * this one, so the fold decodes it. Left out: an end written before this key, or a run that broke.
     */
    carry: Schema.optionalKey(Schema.Unknown),
  }),
  /**
   * Code ran `[build] checks` at `head`, after a build: what it found there. `pr`: the pull request
   * whose head it was, when that is not the lane's own (the exam's), so the lane's fold never takes
   * them for its own checks. Left out: the lane's own, or a fact written before the key.
   */
  Schema.Struct({
    type: Schema.Literal("checked"),
    ...Checked.fields,
    head: Sha,
    pr: Schema.optionalKey(Id),
  }),
  /**
   * A run's agent opened its session, once, after the run's `started`. `id`: the harness's own id
   * for the conversation: the Codex thread, the ACP session, the Agent SDK session. Only known
   * then, and a later restart loads the session by it. No fact: the agent never opened one, or
   * its harness names none.
   */
  Schema.Struct({ type: Schema.Literal("session"), run: Id, id: Id }),
  /**
   * A stopped lane started again (self-fix PR 5): who is the entry's writer, and when its time.
   * `from`: the step it went on from. `base`: the commit the lane stood on when it stopped, `null` if
   * it had none. `onto`: main as read fresh, which the lane's branch stands on now: the same commit
   * when main had not moved. `head` and `to`: the lane's head before and after, `null` if it had
   * none. `conflicts`: the files where main's side won. `kept`: the ref the old head stays under,
   * when the branch started again from main. Only known at the restart. The four are left out on a
   * restart written before them.
   */
  Schema.Struct({
    type: Schema.Literal("restarted"),
    from: Stage,
    base: Schema.NullOr(Sha),
    onto: Sha,
    head: Schema.optionalKey(Schema.NullOr(Sha)),
    to: Schema.optionalKey(Schema.NullOr(Sha)),
    conflicts: Schema.optionalKey(Schema.Array(Schema.String)),
    kept: Schema.optionalKey(Schema.String),
  }),
  /** The plan stage wrote a plan, or a new version of it. */
  Schema.Struct({
    type: Schema.Literal("planned"),
    version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    tasks: Schema.Array(Id),
  }),
  /** The build stage pushed commits; `head` is the branch's head after them. */
  Schema.Struct({
    type: Schema.Literal("pushed"),
    head: Sha,
    commits: Schema.Array(Schema.Struct({ sha: Sha, title: Title })),
  }),
  /**
   * The review stage judged the criteria at `head`: `met` of `of`, and what it found, in its own
   * words. What it read, only known then (docs/direction/a-yes-binds-to-the-diff.md): `pr`, the pull
   * request; `onto`, the branch it goes onto; `base`, where it left that branch; `diff`, the id of its
   * diff. Left out on a review written before them.
   */
  Schema.Struct({
    type: Schema.Literal("reviewed"),
    head: Sha,
    met: Count,
    of: Count,
    findings: Schema.Array(Body),
    pr: Schema.optionalKey(Id),
    ...Given.fields,
  }),
  /**
   * A stage asks the owner something. `picks`: the buttons, at least one. `head`: the commit the
   * person was shown, for a question about a pull request. Left out: any other question. `trace`:
   * the lane that asked, its trace id as its `started` facts give it (ticket 141). Left out on an
   * ask written before the key: a view then places it by time.
   */
  Schema.Struct({
    type: Schema.Literal("asked"),
    ask: Id,
    what: Title,
    picks: Schema.NonEmptyArray(Title),
    head: Schema.optionalKey(Sha),
    trace: Schema.optionalKey(TraceId),
  }),
  /**
   * Code found a yes given at `from` still stands at `to` (stages/pipeline/carry.ts): the same head,
   * a clean replay onto the branch, the base's formatter's own output, or a glance that said yes.
   */
  Schema.Struct({
    type: Schema.Literal("carried"),
    from: Sha,
    to: Sha,
    why: Schema.Literals(["same_head", "replayed", "formatted", "glanced"]),
  }),
]);
export type CodeFact = typeof CodeFact.Type;

/**
 * The watcher saw the ticket's pull request change. Written on a change only, and only by the
 * watcher, through `Watcher.write`: never the lane, push, merge or an agent. Done is read off this
 * fact alone, so a lane that could write it could close its own ticket.
 */
export const PrFact = Schema.Struct({
  type: Schema.Literal("pr"),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
  state: PrState,
  head: Sha,
  checks: Schema.Array(Check),
});
export type PrFact = typeof PrFact.Type;

/** The two a person writes in the window, never code. */
export const PersonFact = Schema.Union([
  Answered,
  /**
   * A person answered an ask: one of its picks, and a note if they wrote one. Never an agent.
   * `text`: the hash of the ticket's title and body the person saw (./approval.ts), so an approval covers
   * that text and no edit after it. Missing on an answer written before the hash.
   */
  Schema.Struct({
    type: Schema.Literal("answered"),
    ask: Id,
    pick: Title,
    note: Body,
    text: Schema.optionalKey(Hash),
    /** The head a person's `merge` was given at, and what they saw there. Left out: any other answer. */
    head: Schema.optionalKey(Sha),
    ...Given.fields,
  }),
  /** A person rated one of a review's findings. */
  Schema.Struct({
    type: Schema.Literal("rated"),
    finding: Id,
    says: Schema.Literals(["fix", "noise"]),
  }),
]);

/** The nine a lane works with: what code, a stage, the watcher and the person in its box write. */
export const LaneFact = Schema.Union([...CodeFact.members, PrFact, ...PersonFact.members]);
export type LaneFact = typeof LaneFact.Type;

/** How sure Jev is of a yes: 0 (no) to 1 (yes). */
export const Yes = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1));

/** What a person says to a duplicate hint, in Linear's and GitHub's words. */
export const Says = Schema.Literals(["accept", "dismiss"]);
export type Says = typeof Says.Type;

/**
 * A duplicate hint and a person's word on it (./duplicates.ts). Advice only: neither fact closes,
 * merges or hides a ticket, and no stage reads them to decide. They are kept so the false alarms
 * can be counted: a dismissed hint is one.
 *
 *   {type: "maybe_duplicate", of: 4, yes: 0.83}       code, after Jev read #9 against #4
 *   {type: "duplicate_rated", of: 4, says: "accept"}   a person, never an agent
 */
export const HintFact = Schema.Union([
  Schema.Struct({ type: Schema.Literal("maybe_duplicate"), of: TicketNumber, yes: Yes }),
  Schema.Struct({ type: Schema.Literal("duplicate_rated"), of: TicketNumber, says: Says }),
]);
export type HintFact = typeof HintFact.Type;

/** What happened to a ticket. The first fact of every ticket is `filed`, and only the first. */
export const Fact = Schema.Union([...TicketFact.members, ...LaneFact.members, ...HintFact.members]);
export type Fact = typeof Fact.Type;

/** One kind of fact, by its `type`. */
export type FactOf<T extends Fact["type"]> = Extract<Fact, { readonly type: T }>;

/**
 * Who may write each fact. `answered` is a person's: the type holds this table to the ledger
 * door's kinds only a person writes (`PERSON_KINDS`), and the door refuses it from an agent's
 * session. On a ledger with no door (memory, node:sqlite), the line is held twice: the tracker's
 * save refuses to write a person's fact as an agent, `Tickets.write` takes only a `CodeFact`, and
 * the fold keeps one an agent wrote out of every ticket (`step` below). `pr` is an agent's, but
 * only the watcher's: `Tickets.write` refuses it, and only `Watcher.write` takes it. `rated` is a user's too by the note, but the
 * door does not know that kind yet, so the table cannot say `person` for it.
 */
export const WRITTEN_BY = {
  filed: "anyone",
  commented: "anyone",
  closed: "anyone",
  reopened: "anyone",
  started: "anyone",
  session: "anyone",
  ended: "anyone",
  checked: "anyone",
  restarted: "anyone",
  planned: "anyone",
  pushed: "anyone",
  reviewed: "anyone",
  pr: "anyone",
  asked: "anyone",
  withdrawn: "anyone",
  stopped: "anyone",
  carried: "anyone",
  answered: "person",
  rated: "anyone",
  maybe_duplicate: "anyone",
  duplicate_rated: "person",
} as const satisfies Writes<Fact["type"]>;

/** May `by` write a fact of this kind: a person's kind only by a user. */
export const mayWrite = (by: Writer, type: Fact["type"]): boolean =>
  WRITTEN_BY[type] === "anyone" || by.kind === "user";

/** One fact read back: on which ticket, who wrote it, when, and where the ledger put it. */
export const Entry = Schema.Struct({
  pos: Schema.Int,
  ticket: TicketNumber,
  by: Writer,
  /** For an agent's row: the name its person goes by on this ledger, from `door/members`. */
  whose: Schema.optional(Schema.String),
  at: Schema.Finite,
  fact: Fact,
});
export type Entry = typeof Entry.Type;

export const State = Schema.Literals(["open", "closed"]);
export type State = typeof State.Type;

/** A ticket, folded from its entries. `timeline`: every entry, oldest first, `filed` the first. */
export const Ticket = Schema.Struct({
  number: TicketNumber,
  title: Title,
  state: State,
  timeline: Schema.Array(Entry),
});
export type Ticket = typeof Ticket.Type;

/** The name every ticket's streams are under, as the ledger reads a prefix: by whole parts. */
export const ROOT = "tracker/ticket";

/** Ticket `number`'s registered name. Its facts go to the name's inbox. */
export const nameOf = (number: number) => `${ROOT}/${number}`;

const INBOX = /^tracker\/ticket\/([1-9]\d*)\/inbox$/;

/**
 * The ledger kind a fact is kept under: its own type, except where the ledger keeps that word for
 * itself and refuses it from anyone else (host/rules.ts, `LEDGER_KINDS`). `restarted` is the ledger's
 * own, for a name it started again, so a lane's restart is kept as `lane_restarted`.
 */
const KEPT_AS: Partial<Record<Fact["type"], string>> = { restarted: "lane_restarted" };
export const kindOf = (type: Fact["type"]): string => KEPT_AS[type] ?? type;
const decodeFact = Schema.decodeUnknownOption(Schema.fromJsonString(Fact));

/** What one ledger row is to the tracker: a fact on a ticket, a row of no ticket's facts, or broken. */
export type Read =
  | { readonly kind: "entry"; readonly entry: Entry }
  | { readonly kind: "other" }
  | { readonly kind: "broken"; readonly why: string };

/** Read one row. A row in a ticket's inbox must hold a fact, by a user or an agent; else it is broken. */
export function readRow(row: Row): Read {
  const ticket = INBOX.exec(row.stream)?.[1];

  if (ticket === undefined) {
    return { kind: "other" };
  }

  const broken = (why: string): Read => ({
    kind: "broken",
    why: `row ${row.pos} on #${ticket}: ${why}`,
  });
  const by = writerOf(row.writer);

  if (by === null) {
    return broken(`its writer "${row.writer}" is neither a user nor an agent`);
  }

  const fact = Option.getOrNull(decodeFact(row.data));

  if (fact === null) {
    return broken(`its data is not a fact`);
  }

  if (kindOf(fact.type) !== row.kind) {
    return broken(`a ${fact.type} fact kept as ${row.kind}`);
  }

  return { kind: "entry", entry: { pos: row.pos, ticket: Number(ticket), by, at: row.at, fact } };
}

/** The tickets with the entries folded in, oldest ticket first, and what did not fit, in words. */
export interface Folded {
  readonly tickets: readonly Ticket[];
  readonly problems: readonly string[];
}

const after = (state: State, fact: Fact): State => {
  if (fact.type === "closed") {
    return "closed";
  }

  if (fact.type === "reopened") {
    return "open";
  }

  return state;
};

/** The facts of one kind on a timeline, oldest first. */
export const factsOf = <T extends Fact["type"]>(timeline: readonly Entry[], type: T): readonly FactOf<T>[] =>
  timeline.flatMap((e) => (e.fact.type === type ? [e.fact as FactOf<T>] : []));

/**
 * The asks no one may answer now: answered, withdrawn, or replaced by a sealed ask. A `changed`
 * withdrawal closes its ask only once the replacement stands, so a crash between the two writes
 * leaves the old ask waiting, never a ticket with nothing to answer. Pure.
 */
export const closedAsks = (timeline: readonly Entry[]): ReadonlySet<string> => {
  const replaced = new Set(
    factsOf(timeline, "asked").flatMap((a) => ("format" in a && a.replaces !== undefined ? [a.replaces] : [])),
  );
  return new Set([
    ...factsOf(timeline, "answered").map((a) => a.ask),
    ...factsOf(timeline, "withdrawn")
      .filter((w) => w.why !== "changed" || replaced.has(w.ask))
      .map((w) => w.ask),
    ...replaced,
  ]);
};

/**
 * The answer path's own refusals, each already in a person's words: what changed under the ask,
 * so the window shows it as it is. A store's or a transport's failure is none of these.
 */
const ANSWER_REFUSALS = [
  "The sealed ask is missing",
  "The ask was withdrawn",
  "The ask expired",
  "The displayed question changed",
  "The answer is not offered by this ask",
  "The plan changed",
  "The change head moved",
  // An old ask's, from before the sealed display.
  "The ask is missing",
  "The ask needs an exact display answer",
  "The answer is not offered",
  "The question kept changing. Try again.",
] as const;

export type AnswerRefusal = (typeof ANSWER_REFUSALS)[number];
/** A second pick that lost the race to the first, which it names. */
export const alreadyAnswered = (pick: string) => `Already answered: ${pick}`;

/** Whether `why` is one of the answer path's own refusals, so a person may read it as it is. Pure. */
export const isAnswerRefusal = (why: string): boolean =>
  why.startsWith(alreadyAnswered("")) || (ANSWER_REFUSALS as readonly string[]).includes(why);

/** The current subject still matches the sealed display. Writer clocks never decide expiry. */
export const answerRefused = (timeline: readonly Entry[], fact: Answered, at: number): AnswerRefusal | null => {
  const ask = factsOf(timeline, "asked").find((a) => a.ask === fact.ask);

  if (ask === undefined || !("format" in ask)) {
    return "The sealed ask is missing";
  }

  if (factsOf(timeline, "withdrawn").some((w) => w.ask === ask.ask)) {
    return "The ask was withdrawn";
  }

  if (ask.until !== null && at >= ask.until) {
    return "The ask expired";
  }

  if (fact.saw !== ask.saw) {
    return "The displayed question changed";
  }

  if (answerOf(ask, fact.answer) === null) {
    return "The answer is not offered by this ask";
  }

  const evidence = ask.shows.evidence;
  const planned = factsOf(timeline, "planned").at(-1);

  if (evidence._tag === "plan" && planned !== undefined && planned.version !== evidence.version) {
    return "The plan changed";
  }

  if (evidence._tag === "change") {
    const current = timeline.findLast((e) => e.fact.type === "pushed" || e.fact.type === "pr");

    if (current !== undefined && "head" in current.fact && current.fact.head !== evidence.head) {
      return "The change head moved";
    }
  }

  return null;
};

/** One answer reader for current and historical facts, including replacement waits. */
export const readAnswer = (timeline: readonly { readonly fact: Fact }[], fact: FactOf<"answered">) => {
  if (!("format" in fact)) {
    return { ask: fact.ask, pick: fact.pick, note: fact.note, head: fact.head };
  }

  const ask = timeline.find((e) => e.fact.type === "asked" && e.fact.ask === fact.ask)?.fact;

  if (ask?.type !== "asked" || !("format" in ask)) {
    return null;
  }

  const answer = answerOf(ask, fact.answer);
  return answer === null
    ? null
    : {
        ...answer,
        ask: ask.replaces ?? ask.ask,
        head: ask.shows.evidence._tag === "change" ? ask.shows.evidence.head : undefined,
      };
};

export const questionOf = (ask: FactOf<"asked">): string => ("format" in ask ? ask.shows.what : ask.what);

export const picksOf = (ask: FactOf<"asked">): readonly string[] =>
  "format" in ask ? ask.shows.picks.map((p) => p.pick) : ask.picks;

/**
 * The run live on a timeline: its last `started`, while no `ended` names that run. `null`: none
 * is. An earlier start that never ended is a run that died, so a later start, ended or not, is
 * the one that counts. Pure.
 *
 *   liveRun([filed, started r-1])            // "r-1"
 *   liveRun([filed, started r-1, ended r-1]) // null
 */
export const liveRun = (timeline: readonly Entry[]): string | null => {
  const last = factsOf(timeline, "started").at(-1);

  if (last === undefined) {
    return null;
  }

  return factsOf(timeline, "ended").some((e) => e.run === last.run) ? null : last.run;
};

/** A comment as its writer gives it: never with `during`, which only code fills in. */
export type Comment = Omit<FactOf<"commented">, "during">;

/**
 * A comment as it is written onto `timeline`: with `during` set to the {@link liveRun}, or
 * missing when none is live. Built key by key, so a `during` cast past the type is dropped. Pure.
 */
export const writtenDuring = (comment: Comment, timeline: readonly Entry[]): FactOf<"commented"> => {
  const during = liveRun(timeline);
  return {
    type: "commented",
    body: comment.body,
    ...(comment.asks === undefined ? {} : { asks: comment.asks }),
    ...(during === null ? {} : { during }),
  };
};

/** Why a lane fact does not fit the timeline before it, or `null` when it fits. */
const misfit = (timeline: readonly Entry[], fact: Fact, at: number): string | null => {
  switch (fact.type) {
    case "started":
      return factsOf(timeline, "started").some((s) => s.run === fact.run)
        ? `run ${fact.run} started a second time`
        : null;
    case "session":
      if (!factsOf(timeline, "started").some((s) => s.run === fact.run)) {
        return `run ${fact.run} opened a session, but it never started`;
      }

      return factsOf(timeline, "session").some((s) => s.run === fact.run)
        ? `run ${fact.run} opened a session a second time`
        : null;
    case "ended": {
      const started = factsOf(timeline, "started").find((s) => s.run === fact.run);

      if (started === undefined) {
        return `run ${fact.run} ended, but it never started`;
      }

      if (started.stage !== fact.stage) {
        return `run ${fact.run} started as ${started.stage} and ended as ${fact.stage}`;
      }

      return factsOf(timeline, "ended").some((e) => e.run === fact.run) ? `run ${fact.run} ended a second time` : null;
    }
    case "asked":
      return factsOf(timeline, "asked").some((a) => a.ask === fact.ask) ? `ask ${fact.ask} asked a second time` : null;
    case "answered": {
      // A comment is never an answer, and neither is an answer that does not fit its ask.
      const asked = factsOf(timeline, "asked").find((a) => a.ask === fact.ask);

      if (asked === undefined) {
        return `an answer to ask ${fact.ask}, which was never asked`;
      }

      if (factsOf(timeline, "answered").some((a) => a.ask === fact.ask)) {
        return `ask ${fact.ask} answered a second time`;
      }

      if ("format" in fact) {
        return answerRefused(timeline, fact, at);
      }

      if ("format" in asked) {
        return "A sealed ask needs an exact display answer";
      }

      return asked.picks.includes(fact.pick) ? null : `"${fact.pick}" is not one of ask ${fact.ask}'s picks`;
    }
    case "maybe_duplicate":
      if (timeline[0]?.ticket === fact.of) {
        return `a ticket hinted as a duplicate of itself`;
      }

      return factsOf(timeline, "maybe_duplicate").some((h) => h.of === fact.of)
        ? `#${fact.of} hinted as a duplicate a second time`
        : null;
    // A person may change their mind: the newest word on a hint is the one that counts.
    case "duplicate_rated":
      return factsOf(timeline, "maybe_duplicate").some((h) => h.of === fact.of)
        ? null
        : `a word on #${fact.of}, which was never hinted as a duplicate`;
    default:
      return null;
  }
};

/** One entry onto its ticket: the ticket after it, or why it does not fit. */
const step = (ticket: Ticket | undefined, entry: Entry): Ticket | string => {
  const { fact } = entry;
  const where = `row ${entry.pos} on #${entry.ticket}`;

  // Held here too, not only at the save: an agent's row on a ledger with no door still reads.
  if (!mayWrite(entry.by, fact.type)) {
    return `${where}: ${fact.type} written by an agent, but only a person writes it`;
  }

  if (fact.type === "filed") {
    return ticket === undefined
      ? { number: entry.ticket, title: fact.title, state: "open", timeline: [entry] }
      : `${where}: filed a second time`;
  }

  if (ticket === undefined) {
    return `${where}: ${fact.type}, but the ticket was never filed`;
  }

  const wrong = misfit(ticket.timeline, fact, entry.at);

  if (wrong !== null) {
    return `${where}: ${wrong}`;
  }

  return { ...ticket, state: after(ticket.state, fact), timeline: [...ticket.timeline, entry] };
};

/** Fold entries, in the ledger's order, onto the tickets folded so far. */
export function fold(tickets: readonly Ticket[], entries: readonly Entry[]): Folded {
  const byNumber = new Map(tickets.map((t) => [t.number, t]));
  const problems: string[] = [];

  for (const entry of entries) {
    const next = step(byNumber.get(entry.ticket), entry);

    if (typeof next === "string") {
      problems.push(next);
    } else {
      byNumber.set(entry.ticket, next);
    }
  }

  return { tickets: [...byNumber.values()].sort((a, b) => a.number - b.number), problems };
}
