// A host's own loop for one registered name, as a tea machine: OTP's registered-name owner and
// its supervisor in one. Every host runs this same machine for `counter:1`; there is no named
// supervisor host. Whoever wins the claim runs the program; when its lease goes, any host may
// restart it.
//
//   watching   the lease is someone else's (or nobody's yet). A clock to its end, and the
//              registry tail's `lease_expired`, each send it to claiming.
//   claiming   one claim in flight. The ledger's compare-and-set picks one winner.
//   owning     it won, under a fence. The program runs (a Sub), and a clock renews the lease.
//              A renew that says `lost`, a newer claim or this fence's expiry in the tail, or
//              the program ending (a write refused) sends it back to watching.
//
// The program is a Sub, not a Cmd: it is on exactly while the state is owning, under that
// state's fence. Leaving owning turns it off, which stops the program. So "a host that lost
// keeps running the program" cannot be written here: there is no state that runs it and
// does not own. (Elm: something that stays open is a Sub.)
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";

export interface Settings {
	/** How often an owner renews. Well under the lease's ttl. */
	readonly renewEveryMs: number;
	/** How long to wait before claiming again after a failed or lost claim. */
	readonly retryMs: number;
}

export type Host =
	| {readonly phase: "watching"; readonly waitMs: number; readonly tries: number}
	| {readonly phase: "claiming"; readonly tries: number}
	| {
			readonly phase: "owning";
			readonly fence: number;
			/** The program said it is running. */
			readonly started: boolean;
			/** Renew clocks set so far: each renew sets a new one. */
			readonly ticks: number;
	  };

export type HostMsg =
	/** The clock to the lease's end ran out: try again. `tries` names the wait it was set for. */
	| {readonly type: "claim_due"; readonly tries: number}
	/** The registry tail showed `lease_expired` for this fence. */
	| {readonly type: "seen_expiry"; readonly fence: number}
	/** The registry tail showed a claim under this fence (its own, or another host's). */
	| {readonly type: "seen_claim"; readonly fence: number}
	| {readonly type: "claimed"; readonly fence: number}
	/** Someone holds it; its lease ends in `waitMs`. */
	| {readonly type: "held"; readonly waitMs: number}
	| {readonly type: "claim_failed"}
	| {readonly type: "program_started"; readonly fence: number}
	| {
			readonly type: "program_ended";
			readonly fence: number;
			readonly how: "ended" | "stopped" | "failed";
	  }
	| {readonly type: "renew_due"; readonly fence: number; readonly tick: number}
	| {readonly type: "renewed"; readonly fence: number}
	| {readonly type: "renew_lost"; readonly fence: number}
	/** No answer: the lease may or may not be renewed. The fence decides at the next write. */
	| {readonly type: "renew_unknown"; readonly fence: number};

export type HostCmd = {readonly type: "claim"} | {readonly type: "renew"; readonly fence: number};

export type HostSub =
	| Sub<"registry_tail", {readonly on: true}>
	| Sub<"program", {readonly fence: number}>;

export const START: Host = {phase: "watching", waitMs: 0, tries: 0};

/** The fence the program runs under, or `null`: it is off. The laws read this same function. */
export const programOf = (s: Host): {readonly fence: number} | null =>
	s.phase === "owning" ? {fence: s.fence} : null;

/** The renew clock, or `null`: off. */
export const renewClockOf = (s: Host, every: number) =>
	s.phase === "owning"
		? {ms: every, msg: {type: "renew_due" as const, fence: s.fence, tick: s.ticks}}
		: null;

const watching = (waitMs: number, tries: number): Host => ({phase: "watching", waitMs, tries});

/** Did this Msg take the lease from an owner under `fence`? */
export const losesLease = (fence: number, m: HostMsg): boolean =>
	(m.type === "renew_lost" && m.fence === fence) ||
	(m.type === "seen_expiry" && m.fence === fence) ||
	(m.type === "seen_claim" && m.fence > fence) ||
	(m.type === "program_ended" && m.fence === fence);

type Step = readonly [Host, readonly HostCmd[]];

export const hostUpdate =
	(settings: Settings) =>
	(s: Host, m: HostMsg): Step => {
		switch (s.phase) {
			case "watching":
				if ((m.type === "claim_due" && m.tries === s.tries) || m.type === "seen_expiry")
					return [{phase: "claiming", tries: s.tries}, [{type: "claim"}]];
				return [s, []];
			case "claiming":
				if (m.type === "claimed")
					return [{phase: "owning", fence: m.fence, started: false, ticks: 0}, []];
				if (m.type === "held") return [watching(m.waitMs, s.tries + 1), []];
				if (m.type === "claim_failed") return [watching(settings.retryMs, s.tries + 1), []];
				return [s, []];
			case "owning":
				if (losesLease(s.fence, m)) return [watching(settings.retryMs, 0), []];
				if (m.type === "program_started" && m.fence === s.fence) return [{...s, started: true}, []];
				if (m.type === "renew_due" && m.fence === s.fence && m.tick === s.ticks)
					return [{...s, ticks: s.ticks + 1}, [{type: "renew", fence: s.fence}]];
				return [s, []];
		}
	};

const sub = <T extends string, D>(type: T, deps: (s: Host) => D | null) =>
	// The one cast: tea's `DepKeyedSub` is a conditional type that a literal cannot be checked against.
	({type, deps}) as DepKeyedSub<Host, Sub<T, D>>;

export const hostSubs = (settings: Settings) => [
	sub("timer", (s) =>
		s.phase === "watching"
			? {ms: s.waitMs, msg: {type: "claim_due" as const, tries: s.tries}}
			: null,
	),
	sub("timer", (s) => renewClockOf(s, settings.renewEveryMs)),
	sub("registry_tail", () => ({on: true as const})),
	sub("program", programOf),
];

/** The machine, every message type a cell of the one update. */
export const createHost = (settings: Settings) => {
	const step = hostUpdate(settings);
	const cell = (s: Host, m: HostMsg) => step(s, m);
	return defineMachine<Host, HostMsg, HostCmd, HostSub, undefined>({
		types: {
			model: {} as Host,
			msg: {} as HostMsg,
			cmd: {} as HostCmd,
			sub: {} as HostSub,
			ctx: undefined,
		},
		init: () => [START, []],
		update: {
			claim_due: cell,
			seen_expiry: cell,
			seen_claim: cell,
			claimed: cell,
			held: cell,
			claim_failed: cell,
			program_started: cell,
			program_ended: cell,
			renew_due: cell,
			renewed: cell,
			renew_lost: cell,
			renew_unknown: cell,
		},
		subs: hostSubs(settings),
	});
};
