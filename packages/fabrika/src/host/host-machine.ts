// A host's own loop for one registered name, as a tea machine: OTP's registered-name owner. Every
// host runs this same machine for a name; there is no supervisor host. Whoever wins the claim runs
// the program; when its lease goes, any host may take over.
//
//   watching   the lease is someone else's (or nobody's yet). A clock to its end, and the
//              registry tail's `lease_expired`, each send it to claiming.
//   claiming   one claim in flight. The ledger's compare-and-set picks one winner.
//   owning     it won, under a fence, until a time. The program runs (a Sub), a clock renews the
//              lease, and a second clock runs to the lease's end plus the grace. A renew that
//              says `lost`, a newer claim in the tail, the program losing its lease, or the lease
//              clock running out sends it back to watching.
//   exiting    (99) the program ended by itself: it returned (`normal`) or crashed. One `exit`
//              in flight, under the fence, with the lease still renewed. The ledger's answer, or
//              the `exited` event in the tail, sends it to down.
//   down       (99) the name's incarnation ended (OTP: the process is dead). Nothing runs and
//              nothing is claimed, until its parent restarts it: the tail's `restarted`.
//
// Lifted from experiment 94 (experiments/94-tea-host/host-machine.ts). New in 98: the lease clock.
// Each `claimed` and `renewed` carries `until`, the time the request was sent plus the ttl: the
// ledger starts the lease no earlier than that, so it ends no earlier either. At `until` the
// program stops, whatever the ledger says or does not say.
//
// New in 99: exiting and down. "Down" is the program's own end, never the host's: a host that dies
// or freezes loses its lease, and another host takes the name over and replays it (Orleans'
// virtual actor: the name lives on). Only a host that still holds the lease may say the name
// exited, and only once its own program ended: a program that lost its lease is not a crash.
//
// The program is a Sub, not a Cmd: it is on exactly while the state is owning, under that state's
// fence. Leaving owning turns it off, which stops the program. (Elm: something that stays open is
// a Sub.)
//
// New in 151: a wifi drop is not a lost lease. The ledger fences a holder only once a newer claim
// takes the name (Kafka's producer epoch), so an owner the ledger does not answer loses nothing by
// waiting. Its program runs on to the lease's end plus `graceMs` (Chubby's grace period), and stops
// there, where a person sees it. While away it renews every `retryRenewMs`; a renew that comes back
// ends being away. Only the ledger's word ends it sooner: `lost`, or a newer claim in the tail. The
// ledger's own `lease_expired` of this fence is no such word any more: it ends nothing.
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import type {ExitReason} from "./rules.ts";

/**
 * 151: how long past its lease's end a host that hears nothing from the ledger keeps its program,
 * by default: 10 minutes. Not the ledger's expiry grace (1 s), which says when `lease_expired` is
 * written.
 */
export const HOST_GRACE_MS = 600_000;

export interface HostSettings {
	/** How often an owner renews. Well under the lease's ttl. */
	readonly renewEveryMs: number;
	/** How long to wait before claiming again after a failed or lost claim. */
	readonly retryMs: number;
	/**
	 * 151: how long past the lease's end an owner that hears nothing keeps its program (Chubby's
	 * grace period). Default `HOST_GRACE_MS`, 10 minutes.
	 */
	readonly graceMs?: number;
	/**
	 * 151: after a renew with no answer, the next ones come this often, until one comes back
	 * (Kubernetes' leader election `retryPeriod`). Default `renewEveryMs`.
	 */
	readonly retryRenewMs?: number;
}

/** What an exit says: OTP's reason, the words of the crash, and the inbox rev it was likely on. */
export interface ExitWord {
	readonly reason: ExitReason;
	readonly why: string;
	readonly suspect: number | null;
}

export type Host =
	| {readonly phase: "watching"; readonly waitMs: number; readonly tries: number}
	| {
			readonly phase: "claiming";
			readonly tries: number;
			/** The newest `exited` and `restarted` the tail showed while the claim was in flight. */
			readonly lastExit: number;
			readonly lastRestart: number;
	  }
	| {
			readonly phase: "owning";
			readonly fence: number;
			/** The name's run number (OTP's pid): a restart starts a new one, a takeover keeps it. */
			readonly incarnation: number;
			/** The lease's end as this host may count on it: its own clock, never the ledger's. */
			readonly until: number;
			/** The program said it is running (its replay is done). */
			readonly started: boolean;
			/** Renew clocks set so far: each renew sets a new one. */
			readonly ticks: number;
			/** 151: the last renew had no answer, so they come every `retryRenewMs`. Absent: false. */
			readonly away?: boolean;
	  }
	| {
			readonly phase: "exiting";
			readonly fence: number;
			readonly incarnation: number;
			readonly until: number;
			readonly ticks: number;
			readonly away?: boolean;
			readonly exit: ExitWord;
	  }
	/** The name exited at `pos` (its `exited` event) and waits for a restart. */
	| {readonly phase: "down"; readonly pos: number};

/** How a program run ended, as the host sorts it. */
export type ProgramEnd =
	/** `main` returned: OTP's `normal`. */
	| {readonly how: "ended"}
	/** `main` failed or died, and not for its lease: OTP's crash. */
	| {readonly how: "crashed"; readonly why: string; readonly suspect: number | null}
	/** `main` failed because its lease was gone (a refused save, a fenced write): not an exit. */
	| {readonly how: "lost"}
	/** `main` was interrupted. */
	| {readonly how: "stopped"};

export type HostMsg =
	/** The clock to the lease's end ran out: try again. `tries` names the wait it was set for. */
	| {readonly type: "claim_due"; readonly tries: number}
	/** The registry tail showed `lease_expired` for this fence. */
	| {readonly type: "seen_expiry"; readonly fence: number}
	/** The registry tail showed a claim under this fence (its own, or another host's). */
	| {readonly type: "seen_claim"; readonly fence: number}
	/** The registry tail showed the name's `exited` event at `pos`. */
	| {readonly type: "seen_exit"; readonly pos: number}
	/** The registry tail showed the name's `restarted` event at `pos`. */
	| {readonly type: "seen_restart"; readonly pos: number}
	| {
			readonly type: "claimed";
			readonly fence: number;
			readonly until: number;
			readonly incarnation: number;
	  }
	/** Someone holds it; its lease ends in `waitMs`. */
	| {readonly type: "held"; readonly waitMs: number}
	/** The claim was refused: the name is down since `pos`. */
	| {readonly type: "is_down"; readonly pos: number}
	| {readonly type: "claim_failed"}
	| {readonly type: "program_started"; readonly fence: number}
	| ({readonly type: "program_ended"; readonly fence: number} & ProgramEnd)
	| {readonly type: "renew_due"; readonly fence: number; readonly tick: number}
	| {readonly type: "renewed"; readonly fence: number; readonly until: number}
	| {readonly type: "renew_lost"; readonly fence: number}
	/** No answer: the lease may or may not be renewed. The lease clock decides. */
	| {readonly type: "renew_unknown"; readonly fence: number}
	/** The lease clock went off: it reads `until` or later. */
	| {readonly type: "lease_due"; readonly fence: number; readonly until: number}
	/** The exit under this fence landed at `pos`. */
	| {readonly type: "exited"; readonly fence: number; readonly pos: number}
	/** The ledger refused the exit (the lease was gone), or did not answer. */
	| {readonly type: "exit_refused"; readonly fence: number};

export type HostCmd =
	| {readonly type: "claim"}
	| {readonly type: "renew"; readonly fence: number}
	| ({readonly type: "exit"; readonly fence: number} & ExitWord);

export type HostSub =
	| Sub<"registry_tail", {readonly on: true}>
	| Sub<"program", {readonly fence: number; readonly incarnation: number}>
	/** It sends `lease_due` at `until`: the lease's end plus the grace. */
	| Sub<"lease_clock", {readonly fence: number; readonly until: number}>;

export const START: Host = {phase: "watching", waitMs: 0, tries: 0};

/** The fence the program runs under, or `null`: it is off. The laws read this same function. */
export const programOf = (s: Host): {readonly fence: number; readonly incarnation: number} | null =>
	s.phase === "owning" ? {fence: s.fence, incarnation: s.incarnation} : null;

/**
 * The renew clock, or `null`: off. It runs while owning and while exiting, every `every`, or
 * every `retryRenewMs` once a renew had no answer.
 */
export const renewClockOf = (s: Host, every: number, retryRenewMs = every) =>
	s.phase === "owning" || s.phase === "exiting"
		? {
				ms: s.away === true ? retryRenewMs : every,
				msg: {type: "renew_due" as const, fence: s.fence, tick: s.ticks},
			}
		: null;

/** The lease clock, or `null`: off. It goes off `graceMs` past the lease's end. */
export const leaseClockOf = (s: Host, graceMs = HOST_GRACE_MS) =>
	s.phase === "owning" || s.phase === "exiting" ? {fence: s.fence, until: s.until + graceMs} : null;

const watching = (waitMs: number, tries: number): Host => ({phase: "watching", waitMs, tries});

/**
 * Did this Msg end the program of an owner under `fence`, whose lease runs `until`? The ledger's
 * word: `lost`, or a newer claim in the tail. Or, with no word at all, its lease clock at the
 * lease's end plus the grace. 151: not the clock at the bare end, and not the ledger's
 * `lease_expired` of this fence: the fence holds until a newer claim, so a host that is back renews
 * and goes on.
 */
export const losesLease = (
	fence: number,
	until: number,
	m: HostMsg,
	graceMs = HOST_GRACE_MS,
): boolean =>
	(m.type === "renew_lost" && m.fence === fence) ||
	(m.type === "seen_claim" && m.fence > fence) ||
	(m.type === "lease_due" && m.fence === fence && m.until >= until + graceMs);

type Holding = Extract<Host, {readonly phase: "owning" | "exiting"}>;
/** 151: a renew had no answer: ask again every `retryRenewMs` from now, not at the next regular one. */
const away = <S extends Holding>(s: S): S =>
	s.away === true ? s : {...s, ticks: s.ticks + 1, away: true};
/** A renew came back: the lease runs to the later end, and it is not away any more. */
const back = <S extends Holding>(s: S, until: number): S =>
	until > s.until || s.away === true ? {...s, until: Math.max(s.until, until), away: false} : s;

/** The exit an owner asks for when its program ended this way, or `null`: no exit (lease lost, stopped). */
export const exitOf = (end: ProgramEnd): ExitWord | null =>
	end.how === "ended"
		? {reason: "normal", why: "returned", suspect: null}
		: end.how === "crashed"
			? {reason: "crash", why: end.why, suspect: end.suspect}
			: null;

type Step = readonly [Host, readonly HostCmd[]];

export const hostUpdate = (settings: HostSettings) => {
	const grace = settings.graceMs ?? HOST_GRACE_MS;
	return (s: Host, m: HostMsg): Step => {
		switch (s.phase) {
			case "watching":
				if ((m.type === "claim_due" && m.tries === s.tries) || m.type === "seen_expiry")
					return [
						{phase: "claiming", tries: s.tries, lastExit: 0, lastRestart: 0},
						[{type: "claim"}],
					];
				if (m.type === "seen_exit") return [{phase: "down", pos: m.pos}, []];
				return [s, []];
			case "claiming":
				if (m.type === "seen_exit") return [{...s, lastExit: Math.max(s.lastExit, m.pos)}, []];
				if (m.type === "seen_restart")
					return [{...s, lastRestart: Math.max(s.lastRestart, m.pos)}, []];
				if (m.type === "claimed")
					return s.lastExit > m.fence
						? [{phase: "down", pos: s.lastExit}, []]
						: [
								{
									phase: "owning",
									fence: m.fence,
									incarnation: m.incarnation,
									until: m.until,
									started: false,
									ticks: 0,
									away: false,
								},
								[],
							];
				// Down, unless a restart landed while the claim was in flight: then claim again.
				if (m.type === "is_down")
					return s.lastRestart > m.pos
						? [watching(settings.retryMs, 0), []]
						: [{phase: "down", pos: m.pos}, []];
				if (m.type === "held") return [watching(m.waitMs, s.tries + 1), []];
				if (m.type === "claim_failed") return [watching(settings.retryMs, s.tries + 1), []];
				return [s, []];
			case "owning": {
				if (m.type === "seen_exit" && m.pos > s.fence) return [{phase: "down", pos: m.pos}, []];
				if (m.type === "program_ended" && m.fence === s.fence) {
					const exit = exitOf(m);
					if (exit === null) return [watching(settings.retryMs, 0), []];
					const {fence, incarnation, until, ticks} = s;
					return [
						{phase: "exiting", fence, incarnation, until, ticks, away: s.away === true, exit},
						[{type: "exit", fence, ...exit}],
					];
				}
				if (losesLease(s.fence, s.until, m, grace)) return [watching(settings.retryMs, 0), []];
				if (m.type === "program_started" && m.fence === s.fence) return [{...s, started: true}, []];
				if (m.type === "renew_due" && m.fence === s.fence && m.tick === s.ticks)
					return [{...s, ticks: s.ticks + 1}, [{type: "renew", fence: s.fence}]];
				if (m.type === "renew_unknown" && m.fence === s.fence) return [away(s), []];
				// A late answer to an older renew may carry an earlier `until`: the lease only grows.
				if (m.type === "renewed" && m.fence === s.fence) return [back(s, m.until), []];
				return [s, []];
			}
			case "exiting":
				if (m.type === "exited" && m.fence === s.fence) return [{phase: "down", pos: m.pos}, []];
				if (m.type === "seen_exit" && m.pos > s.fence) return [{phase: "down", pos: m.pos}, []];
				if (m.type === "exit_refused" && m.fence === s.fence)
					return [watching(settings.retryMs, 0), []];
				// A landed exit deletes the lease, so a renew racing it hears `lost`: the exit's own
				// answer decides, not the renew's.
				if (m.type !== "renew_lost" && losesLease(s.fence, s.until, m, grace))
					return [watching(settings.retryMs, 0), []];
				if (m.type === "renew_due" && m.fence === s.fence && m.tick === s.ticks)
					return [{...s, ticks: s.ticks + 1}, [{type: "renew", fence: s.fence}]];
				if (m.type === "renew_unknown" && m.fence === s.fence) return [away(s), []];
				if (m.type === "renewed" && m.fence === s.fence) return [back(s, m.until), []];
				return [s, []];
			case "down":
				if (m.type === "seen_restart" && m.pos > s.pos) return [watching(0, 0), []];
				return [s, []];
		}
	};
};

const sub = <T extends string, D>(type: T, deps: (s: Host) => D | null) =>
	// The one cast: tea's `DepKeyedSub` is a conditional type that a literal cannot be checked against.
	({type, deps}) as DepKeyedSub<Host, Sub<T, D>>;

export const hostSubs = (settings: HostSettings) => [
	sub("timer", (s) =>
		s.phase === "watching"
			? {ms: s.waitMs, msg: {type: "claim_due" as const, tries: s.tries}}
			: null,
	),
	sub("timer", (s) => renewClockOf(s, settings.renewEveryMs, settings.retryRenewMs)),
	sub("registry_tail", () => ({on: true as const})),
	sub("program", programOf),
	sub("lease_clock", (s) => leaseClockOf(s, settings.graceMs)),
];

/** The machine, every message type a cell of the one update. */
export const createHost = (settings: HostSettings) => {
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
			seen_exit: cell,
			seen_restart: cell,
			claimed: cell,
			held: cell,
			is_down: cell,
			claim_failed: cell,
			program_started: cell,
			program_ended: cell,
			renew_due: cell,
			renewed: cell,
			renew_lost: cell,
			renew_unknown: cell,
			lease_due: cell,
			exited: cell,
			exit_refused: cell,
		},
		subs: hostSubs(settings),
	});
};
