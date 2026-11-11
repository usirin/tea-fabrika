import { hash, TraceId, type ProgramCommand } from "@kampus/fabrika-old";
import { Effect, Option, Schema } from "effect";
import { QuestionId } from "../ids.ts";

/** The most a question may say on its one line. */
const LINE_MOST = 120;

const Line = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(LINE_MOST),
  Schema.isPattern(/^[^\r\n]*$/),
);

// No control characters: SQLite's reader cuts a row id at NUL, so an id holding one would not
// come back as it was written (review 5).
// oxlint-disable-next-line no-control-regex -- the class names the control characters it refuses
const Id = Schema.String.check(Schema.isPattern(/^[^\s\u0000-\u001f\u007f]{1,128}$/));

/** Ask ids are local to a ticket. Equality includes both fields. */
export class AskIdentity extends Schema.Class<AskIdentity>("AskIdentity")({
  ticket: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  ask: Schema.NonEmptyString,
}) {
  /** React and the window's Later messages require a string key. */
  get key(): string {
    return `${this.ticket}/${this.ask}`;
  }
}

const Hash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const Percent = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

export const Rec = Schema.TaggedUnion({
  pick: { pick: Line, why: Line, cost: Line, sure: Schema.NullOr(Percent) },
  none: { why: Line },
});
export type Rec = typeof Rec.Type;

export const Answer = Schema.TaggedUnion({
  rec: {},
  against: { pick: Line, note: Line },
  chose: { pick: Line, note: Schema.optionalKey(Line) },
});
export type Answer = typeof Answer.Type;
export const AskCommand = Schema.TaggedUnion({ rec: {}, not: {}, picks: {}, later: {} });
export type AskCommand = typeof AskCommand.Type;

export const ASK_COMMANDS = {
  rec: { send: { type: "do", value: AskCommand.cases.rec.make({}) }, keys: "y", label: "Take rec" },
  not: { send: { type: "do", value: AskCommand.cases.not.make({}) }, keys: "n", label: "Not the rec" },
  picks: {
    send: { type: "do", value: AskCommand.cases.picks.make({}) },
    keys: "o",
    label: "Every pick",
  },
  later: { send: { type: "do", value: AskCommand.cases.later.make({}) }, keys: "h", label: "Later" },
} as const satisfies Record<AskCommand["_tag"], ProgramCommand<{ type: "do"; value: AskCommand }>>;

const DisplayRec = Schema.Union([Rec, Schema.TaggedStruct("hidden", {})]);
const Pick = Schema.Struct({ pick: Line, does: Schema.NonEmptyString });
const Text = Schema.Struct({ title: Schema.String, body: Schema.String });

// Plan contents stay JSON, including fields added by later plan writers. Required parts cannot vanish.
const Plan = Schema.StructWithRest(
  Schema.Struct({
    summary: Schema.String,
    stories: Schema.Array(Schema.Json),
    tasks: Schema.Array(Schema.Json),
    pointers: Schema.Array(Schema.Json),
    questions: Schema.Array(
      Schema.Struct({
        id: QuestionId,
        ask: Schema.String,
        options: Schema.Array(Schema.String),
        lean: Schema.String,
        why: Schema.String,
        cost: Schema.optionalKey(Schema.String),
        sure: Schema.optionalKey(Schema.Finite),
        doubt: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);

export const Evidence = Schema.TaggedUnion({
  plan: {
    version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    plan: Plan,
    /** The plan step's own words, as it wrote them while it ran. */
    text: Schema.optionalKey(Schema.String),
  },
  change: {
    head: Schema.String,
    diff: Schema.String,
    checks: Schema.Array(Schema.Json),
    review: Schema.NullOr(Schema.Json),
    rules: Schema.Array(Schema.Struct({ path: Schema.String, text: Schema.String })),
    /** The words beside the change: what was let through, what each rule change does and why. */
    text: Schema.optionalKey(Schema.String),
  },
  other: { text: Schema.String },
});

/**
 * Any question as the one line an ask shows: as it is when it fits, else cut at a word, so what a
 * question says first (a merge's count) survives. The whole question then goes beside it, so no
 * word of it is lost. Pure.
 */
export const questionLine = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();

  if (flat.length <= LINE_MOST) {
    return flat;
  }

  const cut = flat.slice(0, LINE_MOST - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

const display = { what: Line, picks: Schema.NonEmptyArray(Pick), ticket: Text, evidence: Evidence };
export const Shows = Schema.Struct({ ...display, rec: DisplayRec });
export type Shows = typeof Shows.Type;

const fields = {
  ask: Id,
  for: Schema.NonEmptyString,
  step: Schema.NonEmptyString,
  repo: Schema.NonEmptyString,
  why: Schema.NullOr(Schema.String),
  rec: Rec,
  until: Schema.NullOr(Schema.Finite),
  replaces: Schema.optionalKey(Id),
  trace: Schema.optionalKey(TraceId),
};

const Draft = Schema.Struct({ ...fields, ...display });

export const Asked = Schema.Struct({
  type: Schema.Literal("asked"),
  format: Schema.Literal(1),
  ...fields,
  shows: Shows,
  saw: Hash,
  blind: Schema.Struct({ policy: Schema.Int, hidden: Schema.Boolean }),
});
export type Asked = typeof Asked.Type;
/**
 * What a window gets of a sealed ask: what it shows and the hash of that, never the sealed rec or
 * the blind draw (review 7). A full `Asked` reads as one, and keeps only these.
 */
export const AskShown = Schema.Struct({ ask: Id, shows: Shows, saw: Hash });
export type AskShown = typeof AskShown.Type;

/** A sealed ask as a window gets it. Pure. */
export const askShownOf = (ask: AskShown): AskShown => ({
  ask: ask.ask,
  shows: ask.shows,
  saw: ask.saw,
});

const Took = Schema.Struct({
  key: Schema.NonEmptyString,
  rec: Schema.Literals(["shown", "hidden", "none"]),
  ms: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  opened: Schema.Array(Schema.String),
  said: Schema.Finite,
});

export const Via = Schema.TaggedUnion({
  window: { took: Took },
  chat: { session: Id, took: Schema.optionalKey(Took) },
});

export const Answered = Schema.Struct({
  type: Schema.Literal("answered"),
  format: Schema.Literal(1),
  ask: Id,
  answer: Answer,
  saw: Hash,
  via: Via,
  needed: Schema.optionalKey(Schema.Boolean),
});
export type Answered = typeof Answered.Type;

/** Stable draw, recorded once with the ask. FNV-1a mixes the seed and policy with its id. */
export const blindDraw = (ask: string, seed = 119120, policy = 1) => {
  let n = 2166136261;

  for (const char of `${policy}/${seed}/${ask}`) {
    n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  }

  return { policy, hidden: (n >>> 0) % 5 === 0 };
};

export const sealAsk = (input: unknown, policy?: { seed: number }) =>
  Effect.gen(function* () {
    const draft = yield* Schema.decodeUnknownEffect(Draft)(input);

    if (new Set(draft.picks.map((p) => p.pick)).size !== draft.picks.length) {
      return yield* Effect.fail(new Error("An ask repeats a pick"));
    }

    const sealed = draft.rec;

    if (sealed._tag === "pick" && !draft.picks.some((p) => p.pick === sealed.pick)) {
      return yield* Effect.fail(new Error("The recommendation is not offered"));
    }

    const draw = blindDraw(draft.ask, policy?.seed);
    // An approve ask's rec comes only from the plan's leans and can only ever be approve: hiding it
    // would hide nothing, so that kind is never drawn blind, and the sealed fact says it was not.
    const blind = {
      ...draw,
      hidden: draft.rec._tag === "pick" && draft.for !== "approve" && draw.hidden,
    };
    const shows = {
      what: draft.what,
      picks: draft.picks,
      ticket: draft.ticket,
      evidence: draft.evidence,
      rec: draft.rec._tag === "pick" && blind.hidden ? Schema.TaggedStruct("hidden", {}).make({}) : draft.rec,
    };
    return Asked.make({
      type: "asked",
      format: 1,
      ask: draft.ask,
      for: draft.for,
      step: draft.step,
      repo: draft.repo,
      why: draft.why,
      rec: draft.rec,
      until: draft.until,
      shows,
      saw: yield* hash(shows),
      blind,
      ...(draft.replaces === undefined ? {} : { replaces: draft.replaces }),
      ...(draft.trace === undefined ? {} : { trace: draft.trace }),
    });
  });

/** Resolve only what was actually offered and visible. A blind choice always stays chose. */
export const answerOf = (raw: unknown, input: unknown): { pick: string; note: string } | null => {
  const read = Schema.decodeUnknownOption(Asked)(raw);

  if (Option.isNone(read)) {
    return null;
  }

  const asked = read.value;
  const decoded = Schema.decodeUnknownOption(Answer)(input);

  if (Option.isNone(decoded)) {
    return null;
  }

  const answer = decoded.value;
  const rec = asked.shows.rec;

  if (answer._tag === "rec") {
    return rec._tag === "pick" ? { pick: rec.pick, note: "" } : null;
  }

  if (!asked.shows.picks.some((p) => p.pick === answer.pick)) {
    return null;
  }

  if (answer._tag === "chose") {
    return rec._tag !== "pick" ? { pick: answer.pick, note: answer.note ?? "" } : null;
  }

  return rec._tag === "pick" && rec.pick !== answer.pick ? { pick: answer.pick, note: answer.note } : null;
};
