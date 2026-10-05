import { applyCell, defineMachine, type Migrated, refuse } from "@demlik/tea";
import type { JevTimerMsg } from "@demlik/tea/jev";
import type { RawIssue } from "./issue.ts";
import { build, check, type Lane, type LaneCmd, lane, type ParkAnswer, prepare } from "./lane.ts";
import { inspect, match, type ReviewParkAnswer, route } from "./review.ts";
import { isBuildable, sortAsk } from "./sort.ts";
import { enrich, type Triage, type TriageCmd, type TriageParkAnswer, triage } from "./triage.ts";

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
  /** A person's answer to a park, triage's or the lane's: the part that is parked gets it. */
  | {
      readonly type: "answer";
      readonly answer: ParkAnswer | ReviewParkAnswer | TriageParkAnswer;
      readonly at: number;
    }
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

export const factory = defineMachine({
  types: { model: {} as Factory, msg: {} as FactoryMsg, ctx: undefined },
  cmds: [enrich, sortAsk.run, prepare, build, check, route, inspect, match],
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
    // Each part ignores an answer to a park it is not in.
    answer: (s, m): Step => (s.triage.phase === "parked" ? handOff(toTriage(s, m)) : toLane(s, m)),
    enrich_ok: (s, m): Step => handOff(toTriage(s, m)),
    enrich_err: (s, m): Step => handOff(toTriage(s, m)),
    prepare_ok: (s, m): Step => toLane(s, m),
    prepare_err: (s, m): Step => toLane(s, m),
    build_ok: (s, m): Step => toLane(s, m),
    build_err: (s, m): Step => toLane(s, m),
    check_ok: (s, m): Step => toLane(s, m),
    check_err: (s, m): Step => toLane(s, m),
    route_ok: (s, m): Step => toLane(s, m),
    route_err: (s, m): Step => toLane(s, m),
    inspect_ok: (s, m): Step => toLane(s, m),
    inspect_err: (s, m): Step => toLane(s, m),
    match_ok: (s, m): Step => toLane(s, m),
    match_err: (s, m): Step => toLane(s, m),
    // Only triage asks Jev; the lane's checks are tests.
    resilient_run_ok: (s, m): Step => handOff(toTriage(s, m)),
    resilient_run_err: (s, m): Step => handOff(toTriage(s, m)),
    deadline_exceeded: (s, m): Step => handOff(toTriage(s, m)),
  },
  subs: [
    {
      type: "timer",
      deps: (s: Factory) => (s.triage.phase === "sorting" ? sortAsk.timer(s.triage.sort) : null),
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
