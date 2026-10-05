import { applyCell, defineMachine, type Migrated, refuse } from "@demlik/tea";
import type { JevTimerMsg } from "@demlik/tea/jev";
import type { RawIssue } from "./issue.ts";
import { ask } from "./judge.ts";
import { build, check, type Lane, type LaneCmd, lane, type ParkAnswer } from "./lane.ts";
import { isBuildable, sortAsk } from "./sort.ts";
import { enrich, type Triage, type TriageCmd, triage } from "./triage.ts";

/**
 * The whole pipeline as one machine: triage and the lane are two parts of its
 * state, and it steps each one with that machine's own `update`. What the
 * factory adds is the hand-off between them.
 */
export interface Factory {
  readonly triage: Triage;
  readonly lane: Lane;
  /** The conversation the lane's builder will have, named when the issue is filed. */
  readonly builder: string | null;
}

export type FactoryMsg =
  /** `builder` names the lane's builder conversation; the host makes it, so the reducer stays pure. */
  | { readonly type: "file"; readonly raw: RawIssue; readonly builder: string }
  /** Sent once after booting from saved state: both parts re-issue what they were waiting on. */
  | { readonly type: "resume"; readonly at: number }
  | { readonly type: "answer"; readonly answer: ParkAnswer; readonly at: number }
  | JevTimerMsg;

export type FactoryCmd = TriageCmd | LaneCmd;
type Step = readonly [Factory, readonly FactoryCmd[]];
type AnyMsg = { readonly type: string };

const toTriage = <M extends AnyMsg>(s: Factory, msg: M): Step => {
  const [next, cmds] = applyCell<Triage, AnyMsg, TriageCmd>(triage, s.triage, msg);
  return [{ ...s, triage: next }, cmds];
};

const toLane = <M extends AnyMsg>(s: Factory, msg: M): Step => {
  const [next, cmds] = applyCell<Lane, AnyMsg, LaneCmd>(lane, s.lane, msg);
  return [{ ...s, lane: next }, cmds];
};

/**
 * The hand-off: an issue triage sorted as agent work of a buildable type starts
 * the lane. Everything else triage decides stays where triage left it.
 */
function handOff([s, cmds]: Step): Step {
  if (
    s.lane.phase === "idle" &&
    s.builder !== null &&
    s.triage.phase === "triaged" &&
    s.triage.audience === "agent" &&
    isBuildable(s.triage.type)
  ) {
    const [next, more] = toLane(s, { type: "start", issue: s.triage.issue, session: s.builder });
    return [next, [...cmds, ...more]];
  }
  return [s, cmds];
}

/**
 * Both machines ask Jev through a Cmd of the same name, so its answer is routed
 * by who is waiting: triage while it sorts, the lane otherwise. They never wait
 * at the same time, because the lane only starts once triage is done.
 */
const toWhoeverAsked = <M extends AnyMsg>(s: Factory, msg: M): Step =>
  s.triage.phase === "sorting" ? toTriage(s, msg) : toLane(s, msg);

export const factory = defineMachine({
  types: { model: {} as Factory, msg: {} as FactoryMsg, ctx: undefined },
  cmds: [enrich, build, check, ask.run, sortAsk.run],
  init: (loaded) => [
    loaded ?? { triage: { phase: "idle" }, lane: { phase: "idle" }, builder: null },
    [],
  ],
  update: {
    file: (s, m): Step =>
      s.triage.phase === "idle"
        ? handOff(toTriage({ ...s, builder: m.builder }, { type: "file", raw: m.raw }))
        : [s, []],
    resume: (s, m): Step => {
      const [afterTriage, triageCmds] = toTriage(s, m);
      const [afterLane, laneCmds] = toLane(afterTriage, m);
      return handOff([afterLane, [...triageCmds, ...laneCmds]]);
    },
    answer: (s, m): Step => toLane(s, m),
    enrich_ok: (s, m): Step => handOff(toTriage(s, m)),
    enrich_err: (s, m): Step => handOff(toTriage(s, m)),
    build_ok: (s, m): Step => toLane(s, m),
    build_err: (s, m): Step => toLane(s, m),
    check_ok: (s, m): Step => toLane(s, m),
    check_err: (s, m): Step => toLane(s, m),
    resilient_run_ok: (s, m): Step => handOff(toWhoeverAsked(s, m)),
    resilient_run_err: (s, m): Step => handOff(toWhoeverAsked(s, m)),
    deadline_exceeded: (s, m): Step => handOff(toWhoeverAsked(s, m)),
  },
  subs: [
    {
      type: "timer",
      deps: (s: Factory) =>
        s.triage.phase === "sorting"
          ? sortAsk.timer(s.triage.sort)
          : s.lane.phase === "judging"
            ? ask.timer(s.lane.judge)
            : null,
    },
  ],
});

/**
 * Read a saved factory back. `null` means nothing was saved, so the run boots
 * fresh. The check is only the outline: the state was written by this machine,
 * and a shape it no longer knows is refused rather than guessed at.
 */
export function parseFactory(raw: unknown): Migrated<Factory> {
  if (raw === null) return null;
  const saved = raw as Partial<Record<keyof Factory, unknown>>;
  const phaseOf = (part: unknown) =>
    typeof part === "object" && part !== null && "phase" in part ? part.phase : undefined;
  return typeof phaseOf(saved.triage) === "string" &&
    typeof phaseOf(saved.lane) === "string" &&
    (saved.builder === null || typeof saved.builder === "string")
    ? (raw as Factory)
    : refuse("not a saved factory");
}
