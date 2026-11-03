// A plan delivered on tea-host (experiment 105): the lane under `lane:<n>` (./lane.ts), and every
// child it names, each with its agent. One function serves them all on this host, so a second host
// that runs it serves the same names: whichever holds a name's lease runs it, the other waits.
//
//   serveLane   the lane, and each child as the lane names it in `<lane>/children` (./children.ts): a
//               plan, a catch-up, a build, a review or a ship, picked by the last part of its name
//   deliver     the lane registered, its job cast once (the id `job`: sent twice, kept once), then
//               served until its outcome row is there. Run again after a crash, it serves the same
//               names: the lane goes on from its journal, and no child starts twice
//
// A plan child reads the ticket with every ticket sort folded in since the last version
// (`foldedPlanHost`), so the lane's next version covers them.

import {
	type Cost,
	cast,
	type HostEvent,
	type Input,
	type Inputs,
	Ledger,
	type Program,
	serve,
} from "@kampus/fabrika-old";
import {Duration, Effect, Schedule} from "effect";
import {ensureName} from "../asks/ledger.ts";
import type {PlanId} from "../ids.ts";
import {kindOf, type LaneJob} from "../stages/lane/machine.ts";
import {PlanHost} from "../stages/plan/services.ts";
import {type AgentNote, agentOf, agentProgram, type Turn} from "./agent.ts";
import {buildTurn} from "./build.ts";
import {hostedCatchup, resolveTurn} from "./catchup.ts";
import {serveChildren} from "./children.ts";
import {Faults} from "./idempotency.ts";
import {hostedLane, laneOf} from "./lane.ts";
import {foldedPlanHost, hostedPlan, planTurn} from "./plan.ts";
import {hostedLocalReview, localReviewTurn} from "./review-local.ts";
import {hostedShip} from "./ship.ts";
import {hostedStage, readOutcome, type StageNote} from "./stage.ts";
import {hostedTask} from "./task.ts";

/** How this host serves a lane and its children. */
export interface Hosting {
	/** This host's name in the ledger: unique per process start. */
	readonly holder: string;
	readonly ttlMs: number;
	/** Every agent turn is `real` or `stub`, as the bill says. */
	readonly agent: Turn["agent"];
	/** A turn's upper bound, held before it starts. */
	readonly hold: Cost;
	readonly turnFaultMs?: number;
	readonly say?: (n: StageNote | AgentNote) => void;
	readonly listen?: (name: string) => (e: HostEvent) => void;
	/** The faults planted on one name and its agent. Default: none. */
	readonly faults?: (name: string) => Faults["Service"];
}

const NONE: Faults["Service"] = {at: () => Effect.void};
const EVERY = Schedule.spaced(Duration.millis(200));

/** Serve `lane` and each child it names, with their agents, until the scope closes. */
export const serveLane = (lane: string, o: Hosting) =>
	Effect.gen(function* () {
		const say = o.say ?? (() => {});
		const timing = {ttlMs: o.ttlMs, renewEveryMs: Math.round(o.ttlMs / 4)};
		const faults = (name: string) => o.faults?.(name) ?? NONE;
		const one = <I extends Inputs & {readonly inbox: Input<any>}, E, R>(
			name: string,
			program: Program<Record<never, never>, I, any, Record<never, never>, E, R>,
		) =>
			serve({
				name,
				holder: o.holder,
				program,
				...(o.listen === undefined ? {} : {listen: o.listen(name)}),
				...timing,
			}).pipe(Effect.provideService(Faults, faults(name)), Effect.orDie);
		const agent = <R>(turn: Parameters<typeof agentProgram<R>>[0]["turn"]) =>
			agentProgram({
				turn,
				hold: o.hold,
				say,
				...(o.turnFaultMs === undefined ? {} : {turnFaultMs: o.turnFaultMs}),
			});
		const ledger = yield* Ledger;
		const folded = foldedPlanHost(yield* PlanHost, ledger);

		const serveChild = (name: string) =>
			Effect.gen(function* () {
				const child = agentOf(name);
				switch (kindOf(name)) {
					case "plan":
						yield* one(name, hostedStage(hostedPlan, say)).pipe(
							Effect.provideService(PlanHost, folded),
						);
						return yield* one(child, agent(planTurn(o.agent)));
					case "catchup":
						yield* one(name, hostedStage(hostedCatchup, say));
						return yield* one(child, agent(resolveTurn(o.agent)));
					case "build":
						yield* one(name, hostedStage(hostedTask, say));
						return yield* one(child, agent(buildTurn(o.agent)));
					case "review":
						yield* one(name, hostedStage(hostedLocalReview, say));
						return yield* one(child, agent(localReviewTurn(o.agent)));
					case "ship":
						return yield* one(name, hostedStage(hostedShip, say));
					case null:
						return;
				}
			});
		yield* one(lane, hostedStage(hostedLane, say));
		yield* serveChildren(lane, serveChild);
	});

/** A plan's lane: registered, its job cast once, served here until it is over. Its outcome row. */
export const deliver = (plan: PlanId, job: LaneJob, o: Hosting) =>
	Effect.gen(function* () {
		const lane = laneOf(plan);
		yield* ensureName(lane, o.holder);
		yield* cast(lane, "job", job, o.holder);
		yield* serveLane(lane, o);
		const row = yield* readOutcome(lane).pipe(
			Effect.orElseSucceed(() => null),
			Effect.repeat({until: (r) => r !== null, schedule: EVERY}),
		);
		return row?.outcome ?? null;
	}).pipe(Effect.scoped);
