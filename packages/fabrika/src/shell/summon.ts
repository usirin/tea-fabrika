import { Context, Effect, Schema, Stream } from "effect";

// The agents a person summoned by name, as tsh asks for them: the service tsh's `summon`,
// `dismiss`, `agents` and `@name` speak to, as it speaks to `Programs` and `HostJobs`. The host
// holds the one manager (../agents/summon/manager.ts); a test hands tsh a double.
//
//   tsh$ summon claude haiku high as scout      summon({agent: "claude", settings: ["haiku", "high"], name: "scout", by})
//   tsh$ @scout why does post print #7 twice?   turn("scout", "why does post print #7 twice?", null)
//                                               told {turn: 3}, status ..., said "It formats ...", result
//   ^C                                          cancel("scout"): the turn ends cancelled, scout stays
//   tsh$ dismiss scout                          dismiss("scout", by): {cut: null}
//
// The agent is not a job; each of its turns is (the `turn` program, ../agents/summon/turn.ts). An
// agent keeps running between turns, so a job that held it would never end.
//
// A name is one agent until it is dismissed: a summon on a taken name is refused, never a
// replacement, as Erlang's `register` fails on a taken name.

/** Why a summon, a dismiss or a turn was refused, in words a person reads. */
export class SummonRefused extends Schema.TaggedError<SummonRefused>()("SummonRefused", {
  why: Schema.String,
}) {
  override get message(): string {
    return this.why;
  }
}

/**
 * What a summoned agent is doing. `opening`: its session is opening, as after a host restart.
 * `down`: its harness would not open, or ended, and takes no turn.
 */
export const AgentState = Schema.Literals(["opening", "idle", "turn", "asking", "down"]);
export type AgentState = typeof AgentState.Type;

/** One summoned agent, as `agents`, Tab after `@` and the top bar list it. */
export const Summoned = Schema.Struct({
  name: Schema.String,
  /** The harness: claude, codex, fake. */
  agent: Schema.String,
  /** The model word typed at the summon, and the model the harness says it set. */
  model: Schema.Struct({
    typed: Schema.NullOr(Schema.String),
    resolved: Schema.NullOr(Schema.String),
  }),
  /** The effort word typed, and the effort the harness set. */
  effort: Schema.Struct({ typed: Schema.NullOr(Schema.String), set: Schema.NullOr(Schema.String) }),
  /** The repository it works in. */
  folder: Schema.String,
  /** When it was summoned, on the host's clock. */
  since: Schema.Finite,
  /** Who summoned it, as a writer's text. */
  by: Schema.String,
  state: AgentState,
  /** The session's dollars so far, when the harness says them. */
  cost: Schema.NullOr(Schema.Finite),
});
export type Summoned = typeof Summoned.Type;

/**
 * What one turn sends, in order: `told` once, with the number the prompt got; `status` as it works;
 * `ask` for each permission it waits on; `said` once, the reply whole; `result` last.
 */
export type TurnNews =
  | { readonly _tag: "told"; readonly turn: number }
  | { readonly _tag: "status"; readonly text: string }
  | { readonly _tag: "ask"; readonly ask: string; readonly title: string }
  | { readonly _tag: "answered"; readonly ask: string; readonly allow: boolean }
  | { readonly _tag: "said"; readonly text: string }
  | {
      readonly _tag: "result";
      readonly stop: string;
      readonly ms: number;
      readonly cost: number | null;
    };

export class SummonManager extends Context.Service<
  SummonManager,
  {
    /** Start an agent under a name. Refused: a taken or bad name, a bad setting, no such agent. */
    readonly summon: (a: {
      readonly agent: string;
      readonly settings: readonly string[];
      readonly name: string;
      readonly by: string;
    }) => Effect.Effect<Summoned, SummonRefused>;
    /** Cancel its turn, if one runs, stop it, and free the name. `cut`: the turn cancelled. */
    readonly dismiss: (name: string, by: string) => Effect.Effect<{ readonly cut: number | null }, SummonRefused>;
    readonly list: Effect.Effect<readonly Summoned[]>;
    /** The kept ACP run behind a turn. Hosts without kept jobs may leave this out. */
    readonly identify?: (name: string, turn: number) => Effect.Effect<{ readonly run: string }, SummonRefused>;
    /** One turn: tell the agent `prompt`, and send what comes back until its result. */
    readonly turn: (
      name: string,
      prompt: string,
      room: string | null,
      resume?: { readonly run: string; readonly turn: number },
    ) => Stream.Stream<TurnNews, SummonRefused>;
    /** Cancel the turn the agent runs now, by ACP's `session/cancel`. The agent stays. */
    readonly cancel: (name: string, mine?: { readonly turn: number; readonly run?: string }) => Effect.Effect<void>;
    /** Answer the ask `ask` of the agent: allow it once, or refuse it. `by`: who answered. */
    readonly answer: (name: string, ask: string, allow: boolean, by: string) => Effect.Effect<void>;
  }
>()("@kampus/fabrika-old/SummonManager") {}

/**
 * How to supply the project a missing `SummonManager` needs: the app's own folder-opening action,
 * which opens a window whose host works in that project (ticket 276).
 */
const NOWHERE =
  "no project is open here for summoned agents: open one with File > Open Folder…, or press ⌘O and pick a project";

/** The manager of a tsh started with none: it lists nobody, and refuses the rest in words. */
/**
 * What Tab offers for talk, as the host last said it: the agents a person can summon, the
 * settings each harness offered when it last opened, and the names summoned now.
 */
export interface Talk {
  readonly agents: readonly string[];
  /** Each harness's models and efforts, by agent, from its last open. None until one opens. */
  readonly offers: Readonly<Record<string, readonly string[]>>;
  readonly names: readonly string[];
}

/** Nothing to offer: a tsh with no host that keeps summoned agents. */
export const NO_TALK: Talk = { agents: [], offers: {}, names: [] };

export const noSummons: SummonManager["Service"] = {
  summon: () => Effect.fail(new SummonRefused({ why: NOWHERE })),
  dismiss: () => Effect.fail(new SummonRefused({ why: NOWHERE })),
  list: Effect.succeed([]),
  turn: () => Stream.fail(new SummonRefused({ why: NOWHERE })),
  cancel: () => Effect.void,
  answer: () => Effect.void,
};
