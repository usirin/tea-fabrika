import { defineMachine } from "@demlik/tea";
import { Cmd, run as runEffect, runIn } from "@demlik/tea/effect";
import { useMachine } from "@demlik/tea/react";
import {
  Answer,
  AskIdentity,
  AskShown,
  askShownOf,
  ASK_COMMANDS,
  type AskCommand,
  type Shows,
} from "@kampus/pipeline/tickets/ask";
import { isAnswerRefusal } from "@kampus/pipeline/tickets/ticket";
import { Button, Kbd, Textarea } from "@manti-ui/react";
import { Effect, Fiber, HashSet, Layer, ManagedRuntime, Schema, Scope } from "effect";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { AskAnswer } from "./ticket.ts";

const Editor = Schema.TaggedUnion({
  reading: {},
  picks: {},
  note: { pick: Schema.String, text: Schema.String },
  saving: { answer: Answer },
});
type Editor = typeof Editor.Type;

type Model = {
  ticket: number;
  ask: AskShown;
  editor: Editor;
  needed?: boolean;
  took: { ms: number; opened: readonly string[] };
  failure: string | null;
  clock?: { focused: boolean; active: boolean; visible: boolean; at: number };
  draft?: Editor;
  key?: string;
  status?: string;
  evidence?: boolean;
};

type Msg =
  | { type: "do"; value: AskCommand; key?: string; now?: number }
  | { type: "pick"; pick: string; key?: string; now?: number }
  | { type: "note"; text: string }
  | { type: "submit"; key: string; now: number }
  | { type: "mark"; needed: boolean }
  | { type: "focus" | "active" | "visible"; value: boolean; now: number }
  | { type: "open"; name: string; now: number }
  | { type: "show"; ask: unknown; now: number }
  | { type: "tick"; now: number }
  | { type: "escape" }
  | { type: "save_ok"; value: unknown }
  | { type: "save_err"; error: { why: string } };

const save = Cmd.make("save", { input: AskAnswer, ok: Schema.Unknown, err: ["refused"] });

const answered = Cmd.make("answered", {
  input: Schema.Struct({ ticket: Schema.Int, said: Schema.String }),
  ok: Schema.Unknown,
  err: [],
});

const later = Cmd.make("later", {
  input: Schema.Struct({ key: Schema.String }),
  ok: Schema.Unknown,
  err: [],
});

type Command = ReturnType<typeof save> | ReturnType<typeof answered> | ReturnType<typeof later>;

/**
 * The answer a save Cmd hands the window's `answer`: the Cmd's input, without the Cmd's `type`,
 * which the host's strict reader refuses (shot S1). Pure.
 */
export const answerOfSave = (cmd: ReturnType<typeof save>): AskAnswer => {
  const { type: _type, ...answer } = cmd;
  return answer;
};

type Step = [Model, readonly Command[]];
const reading = () => Editor.cases.reading.make({});

const timed = (model: Model, now: number): Model & { clock: NonNullable<Model["clock"]> } => {
  const clock = model.clock ?? { focused: false, active: true, visible: true, at: now };
  const ms = clock.focused && clock.active && clock.visible ? Math.max(0, now - clock.at) : 0;
  return { ...model, took: { ...model.took, ms: model.took.ms + ms }, clock: { ...clock, at: now } };
};

const write = (model: Model, answer: Answer, key: string, now: number): Step => {
  if (model.editor._tag === "saving") {
    return [model, []];
  }

  const current = timed(model, now);
  const rec = current.ask.shows.rec;
  const value = AskAnswer.make({
    ticket: current.ticket,
    ask: current.ask.ask,
    answer,
    saw: current.ask.saw,
    via: {
      _tag: "window",
      took: {
        key,
        rec: rec._tag === "pick" ? "shown" : rec._tag === "hidden" ? "hidden" : "none",
        ms: current.took.ms,
        opened: current.took.opened,
        said: now,
      },
    },
    ...(current.needed === undefined ? {} : { needed: current.needed }),
  });
  return [
    { ...current, draft: current.editor, editor: Editor.cases.saving.make({ answer }), failure: null },
    [save(value)],
  ];
};

const pick = (model: Model, chosen: string, key: string, now: number): Step => {
  if (model.editor._tag === "saving" || !model.ask.shows.picks.some((p) => p.pick === chosen)) {
    return [model, []];
  }

  const rec = model.ask.shows.rec;

  if (rec._tag === "pick" && rec.pick === chosen) {
    return write(model, Answer.cases.rec.make({}), key, now);
  }

  return [{ ...model, editor: Editor.cases.note.make({ pick: chosen, text: "" }), failure: null }, []];
};

/** Why a save was refused, in words. */
const whyOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "why" in error && typeof error.why === "string"
    ? error.why
    : "The answer could not be saved";

/** The save was refused: the draft and the ask stay, and the editor says why. */
const failed = (model: Model, error: unknown): Step => [
  { ...model, editor: model.draft ?? reading(), failure: whyOf(error) },
  [],
];

/** What a saved answer says, in words: "Approved.", or "You chose <the pick's label>." Pure. */
const savedWords = (shows: Shows, answer: Answer | null): string => {
  const chosen =
    answer?._tag === "rec" && shows.rec._tag === "pick"
      ? shows.rec.pick
      : answer !== null && "pick" in answer
        ? answer.pick
        : "Answer";

  if (chosen === "approve") {
    return "Approved.";
  }

  const label = shows.picks.find((p) => p.pick === chosen)?.does ?? chosen;
  return `You chose ${label}.`;
};

/** The save landed: the editor reads again, and says what was saved. */
const saved = (model: Model): Step => {
  const status = savedWords(model.ask.shows, model.editor._tag === "saving" ? model.editor.answer : null);
  return [{ ...model, editor: reading(), status }, [answered({ ticket: model.ticket, said: status })]];
};

const update = (model: Model, msg: Msg): Step => {
  switch (msg.type) {
    case "do": {
      if (model.editor._tag === "saving") {
        return [model, []];
      }

      const rec = model.ask.shows.rec;
      const now = msg.now ?? model.clock?.at ?? 0;

      switch (msg.value._tag) {
        case "rec":
          return rec._tag === "pick" ? write(model, Answer.cases.rec.make({}), msg.key ?? "click", now) : [model, []];
        case "not": {
          if (rec._tag !== "pick") {
            return [model, []];
          }

          const others = model.ask.shows.picks.filter((p) => p.pick !== rec.pick);
          return others.length === 1 && others[0] !== undefined
            ? pick(model, others[0].pick, msg.key ?? "click", now)
            : [{ ...model, editor: Editor.cases.picks.make({}) }, []];
        }
        case "picks":
          return [{ ...model, editor: Editor.cases.picks.make({}) }, []];
        case "later":
          return [model, [later({ key: new AskIdentity({ ticket: model.ticket, ask: model.ask.ask }).key })]];
      }

      return [model, []];
    }
    case "pick":
      return pick(model, msg.pick, msg.key ?? "click", msg.now ?? model.clock?.at ?? 0);
    case "note":
      return model.editor._tag === "note"
        ? [{ ...model, editor: { ...model.editor, text: msg.text } }, []]
        : [model, []];
    case "submit": {
      if (model.editor._tag !== "note") {
        return [model, []];
      }

      const value = { pick: model.editor.pick, note: model.editor.text.trim() };

      if (model.ask.shows.rec._tag !== "pick") {
        const choice = { pick: value.pick, ...(value.note === "" ? {} : { note: value.note }) };
        return Schema.is(Answer.cases.chose)({ _tag: "chose", ...choice })
          ? write(model, Answer.cases.chose.make(choice), msg.key, msg.now)
          : [model, []];
      }

      return Schema.is(Answer.cases.against)({ _tag: "against", ...value })
        ? write(model, Answer.cases.against.make(value), msg.key, msg.now)
        : [model, []];
    }
    case "mark": {
      if (model.editor._tag === "saving") {
        return [model, []];
      }

      const { needed: _needed, ...rest } = model;
      return [model.needed === msg.needed ? rest : { ...rest, needed: msg.needed }, []];
    }
    case "focus":
    case "active":
    case "visible": {
      const next = timed(model, msg.now);
      const field = msg.type === "focus" ? "focused" : msg.type;
      return [{ ...next, clock: { ...next.clock, [field]: msg.value } }, []];
    }
    case "tick":
      return [timed(model, msg.now), []];
    case "open": {
      const next = timed(model, msg.now);
      return [
        {
          ...next,
          ...(msg.name === "evidence" ? { evidence: !next.evidence } : {}),
          // Only opening counts: closing the evidence again is not a look at it.
          took:
            msg.name === "evidence" && next.evidence === true
              ? next.took
              : { ...next.took, opened: [...next.took.opened, msg.name] },
        },
        [],
      ];
    }
    case "show": {
      const ask = Schema.decodeUnknownSync(AskShown)(msg.ask);
      const next = timed(model, msg.now);
      return ask.ask === next.ask.ask
        ? [next, []]
        : [
            {
              ticket: model.ticket,
              ask,
              editor: reading(),
              took: { ms: 0, opened: [] },
              failure: null,
              clock: { ...next.clock, at: msg.now },
            },
            [],
          ];
    }
    case "save_ok":
      return saved(model);
    case "save_err":
      return failed(model, msg.error);
    case "escape":
      return model.editor._tag === "note" || model.editor._tag === "picks"
        ? [{ ...model, editor: reading() }, []]
        : [model, []];
  }
};

type Ctx = { ticket: number; ask: unknown; now: number };

const init = (_loaded: unknown, ctx: Ctx): Step => [
  {
    ticket: ctx.ticket,
    ask: Schema.decodeUnknownSync(AskShown)(ctx.ask),
    editor: reading(),
    took: { ms: 0, opened: [] },
    failure: null,
    clock: { focused: false, visible: true, active: true, at: ctx.now },
  },
  [],
];

const machine = defineMachine({
  types: { model: {} as Model, msg: {} as Msg, ctx: {} as Ctx },
  cmds: [save, answered, later],
  init,
  update: {
    do: update,
    pick: update,
    note: update,
    submit: update,
    mark: update,
    focus: update,
    active: update,
    visible: update,
    open: update,
    show: update,
    tick: update,
    escape: update,
    save_ok: (s): Step => saved(s),
    save_err: (s, m): Step => failed(s, m.error),
    answered_ok: (s): Step => [s, []],
    later_ok: (s): Step => [s, []],
    // Neither cell can fail: these never come.
    answered_err: (s): Step => [s, []],
    later_err: (s): Step => [s, []],
  },
});

/** The shared ask editor. Its `init` keeps its own type, so a caller reads the first model as it is. */
export const askMachine = { ...machine, init };

/** A pick as a person reads it: the first letter up. Pure. */
const said = (pick: string) => pick.slice(0, 1).toUpperCase() + pick.slice(1);

/** The rec line's three parts, so the pick can stand out; joined, they are the view's `line`. */
type RecLine = { lead: string; pick?: string; rest?: string };

/**
 * The rec line (design E, owner, 2026-11-08): "Recommended Approve · 95% sure", said once. A
 * blind or no-rec ask never says Recommended: it says what stands where the rec would. Pure.
 */
const recLineOf = (rec: Shows["rec"]): RecLine =>
  rec._tag === "pick"
    ? {
        lead: "Recommended",
        pick: said(rec.pick),
        rest: rec.sure === null ? "· sureness unknown" : `· ${rec.sure}% sure`,
      }
    : rec._tag === "hidden"
      ? { lead: "Your pick first: the rec shows once you answer" }
      : { lead: rec.why };

const lineWords = (line: RecLine) => [line.lead, line.pick, line.rest].filter((w) => w !== undefined).join(" ");

/** Every pick's row: what it is and what it does, in the ask's order. */
type PickRow = { pick: string; does: string };

export type AskView = {
  key: string;
  ticket: number;
  shows: Shows;
  saw: string;
  editor: Editor;
  needed?: boolean;
  failure: string | null;
  busy: boolean;
  /** "Did this need you?" is offered: before a pick and with one, until the answer is saved. */
  marks: boolean;
  /** The rec line's words, "Recommended Approve · 95% sure"; a blind or no-rec ask's say no Recommended. */
  line: string;
  /** Every pick's row, only while every pick is open. */
  rows?: readonly PickRow[];
  /** The note editor's words, each naming the pick it sends; only while a note is open or saving. */
  note?: { label: string; send: string };
};

/** The note editor's label and send button, naming the pick. Against a rec, the note is asked for. */
const noteWords = (pick: string, against: boolean) => ({
  label: against ? `Why ${pick}?` : `Note on ${pick} (optional)`,
  send: `Send ${pick}`,
});

export const askView = (input: {
  ticket: number;
  ask: unknown;
  editor: unknown;
  draft?: unknown;
  needed?: boolean;
  failure: string | null;
}): AskView => {
  const ask = Schema.decodeUnknownSync(AskShown)(input.ask);
  const editor = Schema.decodeUnknownSync(Editor)(input.editor);
  const draft =
    editor._tag === "saving" && input.draft !== undefined ? Schema.decodeUnknownSync(Editor)(input.draft) : editor;
  return {
    key: `${input.ticket}/${ask.ask}`,
    ticket: input.ticket,
    shows: ask.shows,
    saw: ask.saw,
    editor,
    busy: editor._tag === "saving",
    failure: input.failure,
    marks: true,
    line: lineWords(recLineOf(ask.shows.rec)),
    ...(input.needed === undefined ? {} : { needed: input.needed }),
    ...(editor._tag === "picks" ? { rows: ask.shows.picks.map((p) => ({ pick: p.pick, does: p.does })) } : {}),
    ...(draft._tag === "note" ? { note: noteWords(draft.pick, ask.shows.rec._tag === "pick") } : {}),
  };
};

export type AskActions = {
  openLane: (ticket: number) => void;
  command: (
    press: { key: string; ctrl: boolean; alt: boolean; meta: boolean },
    typing: boolean,
  ) => { key: string; value: AskCommand } | undefined;
  answer: (answer: AskAnswer) => Effect.Effect<unknown, { why: string }>;
  later: (key: string) => void;
  keys: Readonly<Record<AskCommand["_tag"], readonly string[]>>;
  blocked: () => boolean;
};

export const AskActions = createContext<AskActions | null>(null);

export function StopView({
  ticket,
  why,
  resume,
}: {
  readonly ticket: number;
  readonly why: string;
  readonly resume?: string;
}) {
  const actions = useContext(AskActions);
  return (
    <section className="ask-view" aria-label="Whose turn">
      <p>{why}</p>
      {resume !== undefined && <p>Resume at {resume}</p>}
      <Button variant="tertiary" onClick={() => actions?.openLane(ticket)}>
        Open lane
      </Button>
    </section>
  );
}

const runtime = ManagedRuntime.make(Layer.empty);
const run = runIn(runtime);

type AttentionView = { focused: boolean; active: boolean; visible: boolean; evidence: boolean };

type Attention = {
  took: Model["took"];
  views: ReadonlyMap<string, AttentionView>;
  at: number;
};

type AttentionModel = ReadonlyMap<string, Attention>;

type AttentionMsg = { key: string; view: string; now: number } & (
  | { type: "change"; event: Extract<Msg, { type: "focus" | "active" | "visible" | "open" }> }
  | { type: "leave" | "read" | "saved" }
);

/** One clock per ask. Overlapping views share its time and append openings in event order. */
const attentionStep = (model: AttentionModel, msg: AttentionMsg): [AttentionModel, never[]] => {
  const previous = model.get(msg.key);

  if (previous === undefined && msg.type !== "change") {
    return [model, []];
  }

  const current = previous ?? { took: { ms: 0, opened: [] }, views: new Map(), at: msg.now };
  const focused = [...current.views.values()].some((v) => v.focused && v.active && v.visible);
  let took = {
    ...current.took,
    ms: current.took.ms + (focused ? Math.max(0, msg.now - current.at) : 0),
  };
  const views = new Map(current.views);

  if (msg.type === "change") {
    const view = views.get(msg.view) ?? {
      focused: false,
      active: true,
      visible: true,
      evidence: false,
    };
    const event = msg.event;

    if (event.type === "open") {
      if (event.name !== "evidence" || !view.evidence) {
        took = { ...took, opened: [...took.opened, event.name] };
      }

      views.set(msg.view, {
        ...view,
        evidence: event.name === "evidence" ? !view.evidence : view.evidence,
      });
    } else {
      views.set(msg.view, {
        ...view,
        [event.type === "focus" ? "focused" : event.type]: event.value,
      });
    }
  } else if (msg.type === "leave") {
    // A view can hide and return with its evidence still open. Keep that flag, but stop time.
    const view = views.get(msg.view);

    if (view !== undefined) {
      views.set(msg.view, { ...view, focused: false });
    }
  }

  const next = new Map(model);

  if (msg.type === "saved") {
    next.delete(msg.key);
  } else {
    next.set(msg.key, { took, views, at: msg.now });
  }

  return [next, []];
};

const attentionMachine = defineMachine({
  types: { model: {} as AttentionModel, msg: {} as AttentionMsg, ctx: undefined },
  cmds: [],
  init: (): [AttentionModel, never[]] => [new Map(), []],
  update: { change: attentionStep, leave: attentionStep, read: attentionStep, saved: attentionStep },
});

const startAttention = () =>
  runtime.runSync(
    runEffect(attentionMachine, { ctx: undefined }).pipe(Effect.provideService(Scope.Scope, runtime.scope)),
  );

// The window's host actions own the record's lifetime, independently of any mounted view.
const attentionRuns = new WeakMap<AskActions, ReturnType<typeof startAttention>>();

const attend = (actions: AskActions, msg: AttentionMsg) => {
  let running = attentionRuns.get(actions);

  if (running === undefined) {
    running = startAttention();
    attentionRuns.set(actions, running);
  }

  const ready = running.ready;
  return Effect.gen(function* () {
    const handle = yield* ready;
    yield* handle.dispatch(msg);
    return handle.getState().get(msg.key)?.took ?? { ms: 0, opened: [] };
  }).pipe(Effect.mapError(() => ({ why: "The ask's reading time could not be kept" })));
};

// Shared across mounts, so a held press cannot answer a newly mounted next ask.
const held = new Set<string>();

/** Where an ask view says what it saved: the one status region its window holds (review 6). */
const Says = createContext<((text: string, ask?: AskIdentity) => void) | null>(null);

type Waiting = number | HashSet.HashSet<AskIdentity>;

/** Live asks, saves not yet removed by a poll, and the last announcement. */
type Said = {
  readonly waiting: Waiting;
  readonly saved: HashSet.HashSet<AskIdentity>;
  readonly said: { readonly text: string; readonly count: number; readonly left: number } | null;
};

type StatusMsg = { type: "say"; text: string; ask?: AskIdentity } | { type: "count"; waiting: Waiting };

const statusMachine = defineMachine({
  types: { model: {} as Said, msg: {} as StatusMsg, ctx: {} as Waiting },
  cmds: [],
  init: (_loaded, waiting = 0): [Said, readonly never[]] => [{ waiting, saved: HashSet.empty(), said: null }, []],
  update: {
    count: (model, { waiting }): [Said, readonly never[]] => [
      {
        ...model,
        waiting,
        saved: typeof waiting === "number" ? HashSet.empty() : HashSet.intersection(model.saved, waiting),
      },
      [],
    ],
    say: (model, msg): [Said, readonly never[]] => {
      const { waiting = 0 } = model;
      const saved =
        msg.ask !== undefined && typeof waiting !== "number" && HashSet.has(waiting, msg.ask)
          ? HashSet.add(model.saved, msg.ask)
          : model.saved;
      return [
        {
          ...model,
          saved,
          said: {
            text: msg.text,
            count: (model.said?.count ?? 0) + 1,
            left: typeof waiting === "number" ? waiting : HashSet.size(HashSet.difference(waiting, saved)),
          },
        },
        [],
      ];
    },
  },
});

const waitingAsks = (asks: readonly (typeof AskIdentity.Encoded)[] | undefined, left: number): Waiting =>
  asks === undefined ? left : HashSet.fromIterable(asks.map(({ ticket, ask }) => new AskIdentity({ ticket, ask })));

/**
 * The window's one polite status region, always drawn and visually hidden, outside any ask view,
 * so what a save said is read out even when the next ask, or none, takes the view's place
 * (WCAG 4.1.3). It says what was saved and how many asks still wait, as in "Approved. 2 left.".
 * Each saying is a fresh text node: a second "Approved." changes the region, so it is read out
 * again, where setting the same words twice would change nothing.
 */
export function AskStatus({
  children,
  left,
  asks,
}: {
  readonly children: ReactNode;
  /** How many asks still wait where this region sits. */
  readonly left: number;
  /** The same live asks the count shows. Ticket and id account for saves before the next poll. */
  readonly asks?: readonly (typeof AskIdentity.Encoded)[];
}) {
  const ctx = useRef(waitingAsks(asks, left)).current;
  const [{ said }, send] = useMachine(statusMachine, { run, ctx });
  useLayoutEffect(() => send({ type: "count", waiting: waitingAsks(asks, left) }), [asks, left, send]);
  // A save may outlive its view. Its ticket and id travel with the reply; tea holds the list.
  const say = useCallback(
    (text: string, ask?: AskIdentity) => send({ type: "say", text, ...(ask === undefined ? {} : { ask }) }),
    [send],
  );
  return (
    <Says.Provider value={say}>
      {children}
      <p className="ask-status" role="status" aria-live="polite">
        {said !== null && <span key={said.count}>{`${said.text} ${said.left} left.`}</span>}
      </p>
    </Says.Provider>
  );
}

/** Any JSON a plan or a check holds, as words: no braces, no quotes, no tags. Pure. */
const wordsOf = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(wordsOf)
      .filter((w) => w !== "")
      .join("; ");
  }

  if (typeof value !== "object") {
    return "";
  }

  const o = value as Record<string, unknown>;

  if (typeof o.who === "string" && typeof o.want === "string") {
    return `${o.who} wants ${o.want}${typeof o.why === "string" ? `, to ${o.why}` : ""}`;
  }

  if (typeof o.name === "string") {
    const state = o.state ?? o.conclusion ?? o.status;
    return state === undefined ? o.name : `${o.name}: ${wordsOf(state)}`;
  }

  if (typeof o.title === "string") {
    return typeof o.met === "number" && typeof o.of === "number" ? `${o.title}, ${o.met} of ${o.of} met` : o.title;
  }

  return Object.entries(o)
    .filter(([key]) => key !== "_tag" && key !== "id")
    .map(([key, v]) => [key, wordsOf(v)] as const)
    .filter(([, words]) => words !== "")
    .map(([key, words]) => `${key} ${words}`)
    .join(", ");
};

/** A list of words, drawn only when it has any. */
function Listed({ label, items }: { readonly label: string; readonly items: readonly unknown[] }) {
  const words = items.map(wordsOf).filter((w) => w !== "");

  if (words.length === 0) {
    return null;
  }

  return (
    <>
      <p className="ask-evidence-label">{label}</p>
      <ul>
        {words.map((w, i) => (
          // one list of words, in order, never moved
          <li key={i}>{w}</li>
        ))}
      </ul>
    </>
  );
}

/** One JSON value of a plan, every field of it, as words in nested lists: no braces, no quotes. */
function Fields({ value }: { readonly value: unknown }): ReactNode {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return value.map((v) => String(v)).join(", ");
    }

    return (
      <ul>
        {value.map((v, i) => (
          // one list of a plan's items, in order, never moved
          <li key={i}>
            <Fields value={v} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="ask-fields">
      {Object.entries(value).map(([key, v]) => (
        <li key={key}>
          <span className="ask-quiet">{key}</span> <Fields value={v} />
        </li>
      ))}
    </ul>
  );
}

/** One part of a plan under its label, drawn only when it holds something. */
function Section({ label, value }: { readonly label: string; readonly value: unknown }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  return (
    <>
      <p className="ask-evidence-label">{label}</p>
      <div>
        <Fields value={value} />
      </div>
    </>
  );
}

/** What the ask stands on, drawn as words, never as JSON (review 9). */
function EvidenceText({ shows }: { readonly shows: Shows }) {
  const evidence = shows.evidence;

  switch (evidence._tag) {
    case "plan": {
      const { summary, stories, tasks, pointers, questions, ...rest } = evidence.plan;
      return (
        <>
          <p className="ask-evidence-label">Plan version {evidence.version}</p>
          <p>{summary}</p>
          <Section label="Stories" value={stories} />
          <Section label="Tasks" value={tasks} />
          <Section label="Pointers" value={pointers} />
          {questions.length > 0 && (
            <>
              <p className="ask-evidence-label">Open questions</p>
              <ul>
                {questions.map((q) => (
                  <li key={q.id}>
                    <p>
                      <span className="ask-quiet mono">{q.id}</span> {q.ask}
                    </p>
                    {q.options.length > 0 && <p className="ask-quiet">Options: {q.options.join("; ")}</p>}
                    <p className="ask-quiet">
                      Lean: {q.lean}. {q.why}
                      {q.cost === undefined ? "" : ` Cost: ${q.cost}.`}
                      {q.sure === undefined ? "" : ` ${q.sure}% sure.`}
                    </p>
                    {q.doubt !== undefined && <p className="ask-quiet">Doubt: {q.doubt}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Fields a later plan writer added: shown too, since the yes covers the whole plan. */}
          {Object.entries(rest).map(([key, value]) => (
            <Section key={key} label={said(key)} value={value} />
          ))}
          {evidence.text !== undefined && evidence.text !== "" && <p className="ask-said">{evidence.text}</p>}
        </>
      );
    }
    case "change":
      return (
        <>
          <p className="ask-evidence-label">The change at {evidence.head.slice(0, 7)}</p>
          {evidence.text !== undefined && evidence.text !== "" && <p className="ask-said">{evidence.text}</p>}
          <Listed label="Checks" items={evidence.checks} />
          {evidence.review !== null && (
            <>
              <p className="ask-evidence-label">Review</p>
              <p>{wordsOf(evidence.review)}</p>
            </>
          )}
          {evidence.rules.length > 0 && (
            <>
              <p className="ask-evidence-label">Rules</p>
              <ul>
                {evidence.rules.map((r) => (
                  <li key={r.path}>
                    <span className="mono">{r.path}</span>: {r.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="ask-evidence-label">Diff</p>
          <pre>{evidence.diff}</pre>
        </>
      );
    case "other":
      return <p className="ask-said">{evidence.text}</p>;
  }
}

const MARKS = [
  [true, "Needed me"],
  [false, "Agent could work it out"],
] as const;

/**
 * Where the shared view is drawn. In the asks menu the row already says the question and holds
 * Later, so the view draws neither.
 */
export type AskPlace = "ticket" | "tracker" | "menu";

/**
 * A failed save in a person's words: what happened, and that nothing is lost. The answer path's own
 * refusals already say what changed, so they stand as they are; a store's or a transport's words
 * never show.
 */
const failureWords = (why: string): string =>
  isAnswerRefusal(why)
    ? why
    : /locked|busy|SQLITE/i.test(why)
      ? "The ledger was busy, so nothing was saved. Your answer is kept."
      : /disconnect|host/i.test(why)
        ? "fabrika's host is not connected, so nothing was saved. Your answer is kept."
        : "Nothing was saved. Your answer is kept.";

/** One key press, as a view reads it: a React event, its own or one a place passes on. */
type KeyPress = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "target" | "preventDefault" | "stopPropagation"
>;

/**
 * What a place that holds the focus for a view can do with it: pass on a key pressed there, as if
 * pressed on the view. `true`: the view took the key. The asks menu's grid holds the focus while
 * its selected row's view is drawn, so its answer keys still work from the menu's first focus.
 */
export type AskKeys = {
  readonly press: (e: KeyPress) => boolean;
  /**
   * The place's own focus came or went. While the place holds it for the view, the view counts as
   * focused, so reading time in the menu reaches the answer's `took.ms` (review 5).
   */
  readonly focus: (held: boolean) => void;
};

export function AskView({
  ticket,
  ask,
  place = "ticket",
  acts,
  keys: handle,
}: {
  readonly ticket: number;
  readonly ask: AskShown;
  readonly place?: AskPlace;
  /**
   * The place's own actions for this ask (the menu's Open ticket and Later), drawn at the end of
   * the answer's toolbar, so every action of the ask sits in one row. Each passes `tabIndex={-1}`:
   * the toolbar keeps one tab stop, and its arrows reach them.
   */
  readonly acts?: ReactNode;
  /** Set by a place that holds the focus for the view, to pass its key presses on (`AskKeys`). */
  readonly keys?: Ref<AskKeys>;
}) {
  const actions = useContext(AskActions);
  const says = useContext(Says);
  const root = useRef<HTMLElement>(null);
  /** The program the view sits in, kept from its mount: an answered view draws nothing. */
  const program = useRef<HTMLElement | null>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const ctx = useRef({ ticket, ask: askShownOf(ask), now: Date.now() }).current;
  const identity = useRef(new AskIdentity({ ticket, ask: ask.ask })).current;
  const attention = useRef({ key: identity.key, view: crypto.randomUUID() }).current;
  const [model, dispatch] = useMachine(askMachine, {
    run,
    ctx,
    interpret: {
      save: (cmd) => {
        if (actions === null) {
          return Effect.fail({ _tag: "refused", why: "The host is disconnected" });
        }

        const words = savedWords(shown.current, cmd.answer);
        // The save and what it says outlive this view: a saved answer can take the ask, and
        // the view with it, off the page before the host's reply comes back.
        return Effect.gen(function* () {
          const fiber = yield* Effect.gen(function* () {
            const answer = answerOfSave(cmd);
            const now = answer.via._tag === "window" ? answer.via.took.said : Date.now();
            const took = yield* attend(actions, { ...attention, type: "read", now });
            const value =
              answer.via._tag === "window"
                ? { ...answer, via: { ...answer.via, took: { ...answer.via.took, ...took } } }
                : answer;
            const result = yield* actions.answer(value);
            yield* attend(actions, { ...attention, type: "saved", now: Date.now() });
            yield* Effect.sync(() => says?.(words, identity));
            return result;
          }).pipe(Effect.forkDetach);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.mapError((e) => ({ _tag: "refused", why: e.why })));
      },
      // The save already said its words, once: saying them here again would read them twice.
      answered: () =>
        Effect.sync(() => {
          (program.current ?? root.current)?.focus();
        }),
      later: (cmd) => Effect.sync(() => actions?.later(cmd.key)),
    },
  });
  const send = useCallback(
    (msg: Msg) => {
      if (
        actions !== null &&
        (msg.type === "focus" || msg.type === "active" || msg.type === "visible" || msg.type === "open")
      ) {
        Effect.runFork(attend(actions, { ...attention, type: "change", event: msg, now: msg.now }));
      }

      dispatch(msg);
    },
    [actions, attention, dispatch],
  );
  useEffect(
    () => () => {
      if (actions !== null) {
        Effect.runFork(attend(actions, { ...attention, type: "leave", now: Date.now() }));
      }
    },
    [actions, attention],
  );
  const view = askView(model);
  const shown = useRef(model.ask.shows);
  shown.current = model.ask.shows;
  // The next ask after an answer takes the focus its program holds, so its keys work at once.
  useEffect(() => {
    program.current = root.current?.closest<HTMLElement>(".program") ?? null;
    const active = document.activeElement;

    if (active === document.body || active === program.current) {
      root.current?.focus();
    }
  }, []);
  // Drawn inside a place that already holds the focus for it, as the menu's grid does when its
  // selection moves: the view is read from there, so it counts as focused from its first draw.
  useEffect(() => {
    const active = document.activeElement;

    if (handle === undefined || active === null || active === root.current) {
      return;
    }

    if (active.contains(root.current)) {
      send({ type: "focus", value: true, now: Date.now() });
    }
  }, [handle, send]);
  useEffect(() => {
    const up = (e: globalThis.KeyboardEvent) => held.delete(e.key);
    const active = () => {
      if (!document.hasFocus()) {
        held.clear();
      }

      send({ type: "active", value: document.hasFocus(), now: Date.now() });
    };
    const visible = () => send({ type: "visible", value: !document.hidden, now: Date.now() });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", active);
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", visible);
    active();
    visible();
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", active);
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [send]);
  useEffect(() => {
    if (view.editor._tag === "note") {
      note.current?.focus();
    }
  }, [view.editor._tag]);
  const failing = view.failure !== null && !view.busy;
  // The question and save status scroll together. Showing only the error can push "Your turn"
  // above a short tile, and a note's focused field can leave the saving status out of view.
  useEffect(() => {
    if ((!view.busy && !failing) || heading.current?.scrollIntoView === undefined) {
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.current.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [view.busy, failing]);
  const command = (name: AskCommand["_tag"], key = "click") =>
    send({ ...ASK_COMMANDS[name].send, key, now: Date.now() });
  /**
   * One key press on the view, or passed on to it (`passed`), where its own surface is the place's
   * and its focus stays there. `true`: the view took it. In the menu, Later is the menu's own key.
   */
  const onKey = (e: KeyPress, passed = false): boolean => {
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable);

    if (e.key === "Escape" && (model.editor._tag === "note" || model.editor._tag === "picks")) {
      e.preventDefault();
      e.stopPropagation();
      send({ type: "escape" });

      if (!passed) {
        root.current?.focus();
      }

      return true;
    }

    if (typing || actions?.blocked()) {
      return false;
    }

    const binding = actions?.command({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }, typing);
    const name =
      actions === null
        ? (Object.keys(ASK_COMMANDS) as AskCommand["_tag"][]).find(
            (name) => !e.ctrlKey && !e.metaKey && !e.altKey && ASK_COMMANDS[name].keys === e.key,
          )
        : binding?.value._tag;

    if (name !== undefined && !(place === "menu" && name === "later")) {
      e.preventDefault();
      e.stopPropagation();

      if (e.repeat || held.has(e.key)) {
        return true;
      }

      held.add(e.key);
      command(name, binding?.key ?? e.key);
      return true;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) {
      return false;
    }

    if (model.editor._tag === "picks" && /^[1-9]$/.test(e.key)) {
      const chosen = view.shows.picks[Number(e.key) - 1];

      if (chosen !== undefined) {
        e.preventDefault();
        e.stopPropagation();

        if (!e.repeat && !held.has(e.key)) {
          held.add(e.key);
          send({ type: "pick", pick: chosen.pick, key: e.key, now: Date.now() });
        }

        return true;
      }
    }

    // Space opens the evidence from the view's own surface, the toolbar's gap included (a click
    // there focuses it); on a button, Space presses that button.
    if (e.key === " " && (passed || (e.target instanceof HTMLElement && e.target.closest("button") === null))) {
      e.preventDefault();
      send({ type: "open", name: "evidence", now: Date.now() });
      return true;
    }

    return false;
  };
  useImperativeHandle(handle, () => ({
    press: (e) => onKey(e, true),
    focus: (held) => send({ type: "focus", value: held, now: Date.now() }),
  }));

  // Answered: the view goes, so the next ask, or the turn card, takes its place at once.
  if (model.status !== undefined) {
    return null;
  }

  const rec = view.shows.rec;
  const line = recLineOf(rec);
  const noting = view.note !== undefined;
  const tools = (Object.keys(ASK_COMMANDS) as AskCommand["_tag"][]).filter(
    (name) => (rec._tag === "pick" || name === "picks" || name === "later") && !(place === "menu" && name === "later"),
  );
  const evidenceId = `ask-evidence-${view.key.replace("/", "-")}`;
  const keysOf = (name: AskCommand["_tag"]) => actions?.keys[name] ?? [ASK_COMMANDS[name].keys];
  const retry = () =>
    model.editor._tag === "note" ? send({ type: "submit", key: "click", now: Date.now() }) : command("rec");
  const cancel = () => {
    send({ type: "escape" });
    root.current?.focus();
  };
  return (
    <section
      ref={root}
      className="ask-view"
      aria-label={`ask: ${view.shows.what}`}
      tabIndex={-1}
      aria-busy={view.busy}
      data-ask-editor={view.editor._tag}
      data-ask-place={place}
      onKeyDown={(e) => onKey(e)}
      onFocus={() => send({ type: "focus", value: true, now: Date.now() })}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          send({ type: "focus", value: false, now: Date.now() });
        }
      }}
    >
      <div ref={heading} className="ask-line">
        {place !== "menu" && (
          <p className="ask-question">
            <span className="ask-turn">Your turn</span> <span>{view.shows.what}</span>
          </p>
        )}
        {view.busy && <p className="ask-quiet">Saving your answer…</p>}
        {failing && view.failure !== null && (
          <div className="ask-fail" role="alert">
            {FAILED}
            <p>
              <strong>Not saved.</strong> {failureWords(view.failure)}
            </p>
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        )}
        {/* Focusable by code only (-1): Tab reaches its one roving button, never the toolbar itself. */}
        <div
          role="toolbar"
          aria-label="Answer"
          tabIndex={-1}
          className="ask-toolbar"
          onKeyDown={(e) => {
            // One tab stop (APG toolbar): the arrows move it, and it stays where they left it.
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const last = buttons.length - 1;
            const to =
              e.key === "ArrowRight"
                ? at === last
                  ? 0
                  : at + 1
                : e.key === "ArrowLeft"
                  ? at <= 0
                    ? last
                    : at - 1
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? last
                      : null;

            if (to === null) {
              return;
            }

            e.preventDefault();
            e.stopPropagation();

            for (const [i, b] of buttons.entries()) {
              b.tabIndex = i === to ? 0 : -1;
            }

            buttons[to]?.focus();
          }}
        >
          {tools.map((name, i) => {
            const keys = keysOf(name);
            // One indigo at a time: while a note is open, its Send is the one.
            const primary = name === "rec" && !noting;
            return (
              <Button
                key={name}
                size="sm"
                variant={primary ? "primary" : "outline"}
                tabIndex={i === 0 ? 0 : -1}
                disabled={view.busy}
                aria-keyshortcuts={keys.length === 0 ? undefined : keys.join(" ")}
                onClick={() => command(name)}
              >
                {ASK_COMMANDS[name].label}
                {keys.length > 0 && <Kbd size="sm">{keys.join(" / ")}</Kbd>}
              </Button>
            );
          })}
          {acts}
        </div>
      </div>
      <div className="ask-rec">
        <p className="ask-recwords">
          {/* A space before the words, so the text a reader copies or reads keeps them apart. */}{" "}
          <span className="ask-quiet">{line.lead}</span>
          {line.pick !== undefined && (
            <>
              {" "}
              <strong>{line.pick}</strong>
            </>
          )}
          {line.rest !== undefined && (
            <>
              {" "}
              <span className="ask-quiet">{line.rest}</span>
            </>
          )}
        </p>
        <div className="ask-marks" role="group" aria-label="Did this need you?">
          <span className="ask-quiet" aria-hidden="true">
            Did this need you?
          </span>
          {/* The two marks stay together: narrow, they drop under their question as one pair. */}
          <span className="ask-mark-pair">
            {MARKS.map(([needed, label]) => {
              const pressed = view.needed === needed;
              return (
                <Button
                  key={String(needed)}
                  size="sm"
                  variant="tertiary"
                  aria-pressed={pressed}
                  disabled={view.busy}
                  onClick={() => send({ type: "mark", needed })}
                >
                  {label}
                </Button>
              );
            })}
          </span>
        </div>
      </div>
      <div className="ask-why">
        {rec._tag === "pick" && (
          <p className="ask-quiet">
            {rec.why} · {rec.cost}
          </p>
        )}
        <Button
          size="sm"
          variant="tertiary"
          aria-expanded={model.evidence ?? false}
          aria-controls={evidenceId}
          aria-keyshortcuts="Space"
          onClick={() => send({ type: "open", name: "evidence", now: Date.now() })}
        >
          {model.evidence === true ? "Hide evidence" : "Evidence"}
          <Kbd size="sm">Space</Kbd>
        </Button>
      </div>
      {view.rows !== undefined && (
        <div className="ask-picks" role="group" aria-label="Every pick">
          {view.rows.map((p, i) => (
            <Button
              key={p.pick}
              size="sm"
              variant="tertiary"
              disabled={view.busy}
              aria-keyshortcuts={String(i + 1)}
              onClick={() => send({ type: "pick", pick: p.pick, now: Date.now() })}
            >
              <Kbd size="sm">{i + 1}</Kbd> <strong>{said(p.pick)}</strong> <span className="ask-quiet">{p.does}</span>
            </Button>
          ))}
        </div>
      )}
      {view.note !== undefined && (
        <form
          className="ask-note"
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: "submit", key: "click", now: Date.now() });
          }}
        >
          <Textarea
            ref={note}
            label={view.note.label}
            aria-required={rec._tag === "pick"}
            requiredIndicator={null}
            hint={
              rec._tag === "pick" ? "Needed: one line the next step reads." : "Optional: one line the next step reads."
            }
            maxLength={120}
            // The note is one line by its schema: the field rests at one line and grows as its words
            // wrap (`field-sizing` in window.css), so the bar fits a short tile.
            rows={1}
            resize="none"
            fullWidth
            disabled={view.busy}
            value={
              model.editor._tag === "note" ? model.editor.text : model.draft?._tag === "note" ? model.draft.text : ""
            }
            onChange={(e) => send({ type: "note", text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();

                if (!e.repeat) {
                  send({ type: "submit", key: "Enter", now: Date.now() });
                }
              }
            }}
          />
          <div className="ask-row">
            <Button type="submit" size="sm" variant="primary" disabled={view.busy} aria-keyshortcuts="Enter">
              {view.note.send}
              <Kbd size="sm">↵</Kbd>
            </Button>
            <Button size="sm" variant="outline" disabled={view.busy} aria-keyshortcuts="Escape" onClick={cancel}>
              Cancel
              <Kbd size="sm">Esc</Kbd>
            </Button>
          </div>
        </form>
      )}
      <div className="ask-evidence" id={evidenceId} hidden={model.evidence !== true}>
        <p className="ask-evidence-label">The ticket</p>
        <p>{view.shows.ticket.title}</p>
        {view.shows.ticket.body !== "" && <p>{view.shows.ticket.body}</p>}
        <EvidenceText shows={view.shows} />
      </div>
    </section>
  );
}

/** The failed save's mark: a warning sign, so the words, not only their color, say it failed. */
const FAILED = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path
      d="M8 1.8 15 14H1Z M8 6v4 M8 11.8v.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
