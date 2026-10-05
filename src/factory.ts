import { applyCell, defineMachine, type Migrated, refuse } from "@demlik/tea";
import type { JevTimerMsg } from "@demlik/tea/jev";
import { weigh } from "./comments.ts";
import { build, check, diagnose, freshCheck, type Lane, type LaneCmd, lane, type ParkAnswer, prepare } from "./lane.ts";
import { inspect, match, type ReviewParkAnswer, route } from "./review.ts";
import { catchUp, land, retest, type Ship, type ShipCmd, type ShipInput, type ShipParkAnswer, seal, ship } from "./ship.ts";
import { isBuildable, sortAsk } from "./sort.ts";
import { fetchComments, fetchTicket } from "./tracker.ts";
import { enrich, type Triage, type TriageCmd, type TriageParkAnswer, triage } from "./triage.ts";

/**
 * The whole pipeline as one machine: triage, the lane and ship are parts of
 * its state, and it steps each one with that machine's own `update`. What the
 * factory adds is the hand-offs between them.
 */
export interface Factory {
  readonly triage: Triage;
  readonly lane: Lane;
  readonly ship: Ship;
  /** The conversation the lane's builder will have, named when the issue is filed. */
  readonly builder: string | null;
}

export type FactoryMsg =
  /**
   * A ticket was filed: only its id, since triage reads it from the tracker.
   * `builder` names the lane's builder conversation; the host makes it, so the reducer stays pure.
   */
  | { readonly type: "file"; readonly issue: string; readonly builder: string }
  /** Sent once after booting from saved state: every part re-issues what it was waiting on. */
  | { readonly type: "resume"; readonly at: number }
  /** A person's answer to a park: the part that is parked gets it. */
  | {
      readonly type: "answer";
      readonly answer: ParkAnswer | ReviewParkAnswer | TriageParkAnswer | ShipParkAnswer;
      readonly at: number;
    }
  | JevTimerMsg;

export type FactoryCmd = TriageCmd | LaneCmd | ShipCmd;
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

const toShip = <M extends AnyMsg>(s: Factory, msg: M): Step => {
  const [next, cmds] = applyCell<Ship, AnyMsg, ShipCmd>(ship, s.ship, msg);
  return [{ ...s, ship: next }, cmds];
};

/** What the person approving the change reads: what the lane left on the record. */
function recordOf(done: Extract<Lane, { phase: "done" }>): ShipInput {
  return {
    issue: done.issue.id,
    title: done.issue.title,
    record: [
      `${done.attempt} attempt(s), ${done.builds} build(s)`,
      ...done.deviations.map((d) => `extra change ${d.file}: ${d.why}`),
      ...done.notes.map((f) => `filed ${f.id} ${f.file}:${f.line}: ${f.problem}`),
      ...done.matched.map((m) => `${m.finding.id} taken as ${m.to} again: ${m.finding.problem}`),
      ...done.withdrawn.map((f) => `withdrawn ${f.id}: ${f.problem}`),
      ...done.comments.map((c) => `comment ${c.id}, settled by the ${c.state.kind === "settled" ? c.state.by : "?"}: ${c.text}`),
    ],
  };
}

/**
 * The hand-offs: an issue triage sorted as agent work of a buildable type
 * starts the lane, and a lane that is done starts ship. Everything else stays
 * where its part left it.
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
    return handOff([next, [...cmds, ...more]]);
  }
  if (s.lane.phase === "done" && s.ship.phase === "idle") {
    const [next, more] = toShip(s, { type: "start", input: recordOf(s.lane) });
    return [next, [...cmds, ...more]];
  }
  return [s, cmds];
}

/** Which part a person's answer is for: the one that is parked. Only one ever is. */
function answer(s: Factory, m: Extract<FactoryMsg, { type: "answer" }>): Step {
  if (s.triage.phase === "parked") return handOff(toTriage(s, m));
  if (s.ship.phase === "parked") return toShip(s, m);
  return handOff(toLane(s, m));
}

const laneCell = (s: Factory, m: AnyMsg): Step => handOff(toLane(s, m));
const triageCell = (s: Factory, m: AnyMsg): Step => handOff(toTriage(s, m));
const shipCell = (s: Factory, m: AnyMsg): Step => toShip(s, m);

export const factory = defineMachine({
  types: { model: {} as Factory, msg: {} as FactoryMsg, ctx: undefined },
  cmds: [
    fetchTicket,
    enrich,
    sortAsk.run,
    prepare,
    build,
    check,
    freshCheck,
    diagnose,
    route,
    inspect,
    match,
    fetchComments,
    weigh,
    seal,
    land,
    catchUp,
    retest,
  ],
  init: (loaded) => [
    loaded ?? { triage: { phase: "idle" }, lane: { phase: "idle" }, ship: { phase: "idle" }, builder: null },
    [],
  ],
  update: {
    file: (s, m): Step =>
      s.triage.phase === "idle" ? handOff(toTriage({ ...s, builder: m.builder }, { type: "file", issue: m.issue })) : [s, []],
    resume: (s, m): Step => {
      const [afterTriage, triageCmds] = toTriage(s, m);
      const [afterLane, laneCmds] = toLane(afterTriage, m);
      const [afterShip, shipCmds] = toShip(afterLane, { type: "resume" });
      return handOff([afterShip, [...triageCmds, ...laneCmds, ...shipCmds]]);
    },
    answer: (s, m): Step => answer(s, m),
    fetch_ticket_ok: triageCell,
    fetch_ticket_err: triageCell,
    enrich_ok: triageCell,
    enrich_err: triageCell,
    // Only triage asks Jev through tea's Jev door; the lane's Jev plug-ins sit behind their own services.
    resilient_run_ok: triageCell,
    resilient_run_err: triageCell,
    deadline_exceeded: triageCell,
    prepare_ok: laneCell,
    prepare_err: laneCell,
    build_ok: laneCell,
    build_err: laneCell,
    check_ok: laneCell,
    check_err: laneCell,
    fresh_check_ok: laneCell,
    fresh_check_err: laneCell,
    diagnose_ok: laneCell,
    diagnose_err: laneCell,
    route_ok: laneCell,
    route_err: laneCell,
    inspect_ok: laneCell,
    inspect_err: laneCell,
    match_ok: laneCell,
    match_err: laneCell,
    fetch_comments_ok: laneCell,
    fetch_comments_err: laneCell,
    weigh_ok: laneCell,
    weigh_err: laneCell,
    seal_ok: shipCell,
    seal_err: shipCell,
    land_ok: shipCell,
    land_err: shipCell,
    catch_up_ok: shipCell,
    catch_up_err: shipCell,
    retest_ok: shipCell,
    retest_err: shipCell,
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
    typeof phaseOf(saved.ship) === "string" &&
    (saved.builder === null || typeof saved.builder === "string")
    ? (raw as Factory)
    : refuse("not a saved factory");
}
