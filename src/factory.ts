import { applyCell, defineMachine } from "@demlik/tea";
import type { JevTimerMsg } from "@demlik/tea/jev";
import type { RawIssue } from "./issue.ts";
import { ask } from "./judge.ts";
import { build, check, type Lane, type LaneCmd, lane } from "./lane.ts";
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
}

export type FactoryMsg =
  | { readonly type: "file"; readonly raw: RawIssue }
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
    s.triage.phase === "triaged" &&
    s.triage.audience === "agent" &&
    isBuildable(s.triage.type)
  ) {
    const [next, more] = toLane(s, { type: "start", issue: s.triage.issue });
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
    loaded ?? { triage: { phase: "idle" }, lane: { phase: "idle" } },
    [],
  ],
  update: {
    file: (s, m): Step => handOff(toTriage(s, m)),
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
