// The laws of the machines in packages/tea-host: the host's own loop (host-machine.ts), the call
// module (call.ts), the supervisor (supervisor.ts) and the monitor module (monitor.ts), walked by
// this repo's checker (./explore.ts): every Msg order up to a bound, through the real reducers,
// each law after every step, and each law seen to fail once on a planted mistake. They live here,
// not in the package, because the checker lives here and a package does not import wip.
//
// The host's laws are experiment 94's (experiments/94-tea-host/laws.ts), with the lease clock
// that is new in experiment 98 (three more laws and plants) and the exits, restarts and down
// phase that are new in experiment 99 (nine more laws, ten more plants). Experiment 100 rewrote
// the supervisor's laws for its three strategies, stops, calls and backoff (nineteen laws, 22
// plants, each run under the strategy it is about), and added the monitor's re-arm backoff law.
import {
	type CallCmd,
	type CallMsg,
	type Calls,
	call,
	update as callUpdate,
	noCalls,
	type Outcome,
} from "@tea-fabrika/tea-host/call";
import {
	createHost,
	type Host,
	type HostCmd,
	type HostMsg,
	type HostSettings,
	hostUpdate,
	leaseClockOf,
	losesLease,
	type ProgramEnd,
	programOf,
	renewClockOf,
	START,
} from "@tea-fabrika/tea-host/host";
import {
	endedOf,
	type MonitorCmd,
	type MonitorMsg,
	type MonitorOutcome,
	type Monitors,
	update as monitorUpdate,
	noMonitors,
	refOf,
} from "@tea-fabrika/tea-host/monitor";
import {
	type Child,
	NOT_BEGUN,
	type Request,
	type Strategy,
	type SupervisorMsg,
	type SupervisorSpec,
	type SupervisorState,
	startsOf,
	stopOf,
	superviseWith,
} from "@tea-fabrika/tea-host/supervisor";
import {
	broke,
	explore,
	type Law,
	law,
	pathText,
	type Report,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// ---------------------------------------------------------------- the host

const SETTINGS: HostSettings = {renewEveryMs: 300, retryMs: 50};
const host = createHost(SETTINGS);

/** How the laws see a host's Subs: the same functions the machine's `subs` call. */
export interface HostView {
	readonly program: (s: Host) => {readonly fence: number; readonly incarnation: number} | null;
	readonly renewing: (s: Host) => boolean;
	readonly leaseClock: (s: Host) => {readonly fence: number; readonly until: number} | null;
}
const VIEW: HostView = {
	program: programOf,
	renewing: (s) => renewClockOf(s, SETTINGS.renewEveryMs) !== null,
	leaseClock: leaseClockOf,
};

const FENCES = [1, 2] as const;
/** A claim's lease end, a later renew's, and an earlier one (a late answer to an old renew). */
const CLAIMED_UNTIL = 1000;
const UNTILS = [500, 2000] as const;
/** 99: where the name's `exited` event lands (past both fences), and a restart before and after it. */
const EXIT_POS = 5;
const RESTART_POS = [4, 7] as const;
/** A claim's incarnation: a takeover of the same run, or a new run after a restart. */
const INCARNATIONS = [1, 2] as const;
const ENDS: readonly ProgramEnd[] = [
	{how: "ended"},
	{how: "crashed", why: "boom", suspect: 9},
	{how: "lost"},
	{how: "stopped"},
];

export function hostWorld(): World<Host, HostMsg, HostCmd> {
	return {
		outside: (s) => [
			...(s.phase === "watching" ? [{type: "claim_due" as const, tries: s.tries}] : []),
			...(s.phase === "owning" || s.phase === "exiting"
				? [
						{type: "renew_due" as const, fence: s.fence, tick: s.ticks},
						{type: "lease_due" as const, fence: s.fence, until: s.until},
						{type: "lease_due" as const, fence: s.fence, until: 500},
					]
				: []),
			...FENCES.flatMap((fence): HostMsg[] => [
				{type: "seen_expiry", fence},
				{type: "seen_claim", fence},
				{type: "program_started", fence},
				...ENDS.map((end): HostMsg => ({type: "program_ended", fence, ...end})),
			]),
			{type: "seen_claim", fence: 3},
			{type: "seen_exit", pos: EXIT_POS},
			...RESTART_POS.map((pos): HostMsg => ({type: "seen_restart", pos})),
		],
		answers: (cmd) =>
			cmd.type === "claim"
				? [
						...FENCES.flatMap((fence) =>
							INCARNATIONS.map(
								(incarnation): HostMsg => ({
									type: "claimed",
									fence,
									until: CLAIMED_UNTIL,
									incarnation,
								}),
							),
						),
						{type: "held", waitMs: 400},
						{type: "claim_failed"},
						{type: "is_down", pos: EXIT_POS},
					]
				: cmd.type === "exit"
					? [
							{type: "exited", fence: cmd.fence, pos: EXIT_POS},
							{type: "exit_refused", fence: cmd.fence},
						]
					: [
							...UNTILS.map((until): HostMsg => ({type: "renewed", fence: cmd.fence, until})),
							{type: "renew_lost", fence: cmd.fence},
							{type: "renew_unknown", fence: cmd.fence},
						],
	};
}

const fenceOf = (m: HostMsg): number | null => ("fence" in m ? m.fence : null);

export function hostLaws(view: HostView = VIEW): readonly Law<Host, HostMsg, HostCmd>[] {
	return [
		watched<Host, HostMsg, HostCmd, number | null>(
			"the program runs only under the claim this host won last",
			null,
			(won, {msg, next}) => {
				const now = msg.type === "claimed" ? msg.fence : won;
				const on = view.program(next);
				return on === null || on.fence === now
					? now
					: broke(
							`the program runs under fence ${on.fence}; the last claim won was ${now ?? "none"}`,
						);
			},
		),
		law<Host, HostMsg, HostCmd>("losing the lease stops the program", ({prev, msg, next}) => {
			if (prev.phase !== "owning" || !losesLease(prev.fence, prev.until, msg)) return null;
			return view.program(next) === null
				? null
				: `after ${msg.type} ${fenceOf(msg)} the program still runs under fence ${prev.fence}`;
		}),
		law<Host, HostMsg, HostCmd>("at its own lease's end the program stops", ({prev, msg, next}) => {
			if (prev.phase !== "owning" || msg.type !== "lease_due") return null;
			if (msg.fence !== prev.fence || msg.until !== prev.until) return null;
			return view.program(next) === null
				? null
				: `the lease clock ran out at ${msg.until} and the program still runs`;
		}),
		law<Host, HostMsg, HostCmd>("the lease clock never runs backwards", ({prev, next}) => {
			const a = view.leaseClock(prev);
			const b = view.leaseClock(next);
			if (a === null || b === null || a.fence !== b.fence) return null;
			return b.until >= a.until ? null : `the lease end went from ${a.until} back to ${b.until}`;
		}),
		law<Host, HostMsg, HostCmd>("while the program runs, its lease clock runs", ({next}) => {
			const on = view.program(next);
			const clock = view.leaseClock(next);
			return on === null || (clock !== null && clock.fence === on.fence)
				? null
				: "the program runs with no lease clock on its fence";
		}),
		law<Host, HostMsg, HostCmd>("it renews only the fence it holds", ({prev, cmds}) => {
			const held = prev.phase === "owning" || prev.phase === "exiting" ? prev.fence : null;
			const bad = cmds.find((c) => c.type === "renew" && c.fence !== held);
			return bad === undefined
				? null
				: `renews fence ${bad.type === "renew" ? bad.fence : "?"} while ${held === null ? prev.phase : `holding ${held}`}`;
		}),
		law<Host, HostMsg, HostCmd>(
			"it claims only while it holds nothing and the name is not down",
			({prev, cmds}) =>
				prev.phase !== "watching" &&
				prev.phase !== "claiming" &&
				cmds.some((c) => c.type === "claim")
					? `claims while ${prev.phase}`
					: null,
		),
		law<Host, HostMsg, HostCmd>(
			"word about another fence changes nothing",
			({prev, msg, next, cmds}) => {
				const fence = fenceOf(msg);
				if (prev.phase !== "owning" || fence === null || fence === prev.fence) return null;
				if (msg.type === "seen_claim" && fence > prev.fence) return null;
				return next === prev && cmds.length === 0
					? null
					: `${msg.type} ${fence} moved the owner of fence ${prev.fence}`;
			},
		),
		law<Host, HostMsg, HostCmd>("while the program runs, the lease is renewed", ({next}) =>
			view.program(next) !== null && !view.renewing(next)
				? "the program runs and no renew clock is set"
				: null,
		),
		// 99: exits, down, and the incarnation.
		watched<Host, HostMsg, HostCmd, number | null>(
			"the program runs under the incarnation its claim gave",
			null,
			(given, {msg, next}) => {
				const now = msg.type === "claimed" ? msg.incarnation : given;
				const on = view.program(next);
				return on === null || on.incarnation === now
					? now
					: broke(
							`the program runs as incarnation ${on.incarnation}; the claim gave ${now ?? "none"}`,
						);
			},
		),
		law<Host, HostMsg, HostCmd>("nothing runs while exiting or down", ({next}) =>
			(next.phase === "exiting" || next.phase === "down") && view.program(next) !== null
				? `the program runs while ${next.phase}`
				: null,
		),
		law<Host, HostMsg, HostCmd>(
			"it exits only for its own program's end, under the fence it holds",
			({prev, msg, cmds}) => {
				const exit = cmds.find((c) => c.type === "exit");
				if (exit === undefined) return null;
				return prev.phase === "owning" &&
					msg.type === "program_ended" &&
					msg.fence === prev.fence &&
					exit.fence === prev.fence
					? null
					: `exits fence ${exit.fence} on ${msg.type} while ${prev.phase}`;
			},
		),
		law<Host, HostMsg, HostCmd>(
			"a program that lost its lease or was stopped is not an exit",
			({msg, cmds}) =>
				msg.type === "program_ended" &&
				(msg.how === "lost" || msg.how === "stopped") &&
				cmds.some((c) => c.type === "exit")
					? `a program that ended ${msg.how} exits the name`
					: null,
		),
		law<Host, HostMsg, HostCmd>("a crash exits `crash`, a return exits `normal`", ({msg, cmds}) => {
			const exit = cmds.find((c) => c.type === "exit");
			if (exit === undefined || msg.type !== "program_ended") return null;
			const want = msg.how === "crashed" ? "crash" : msg.how === "ended" ? "normal" : null;
			return exit.reason === want ? null : `ended ${msg.how}, exits ${exit.reason}`;
		}),
		law<Host, HostMsg, HostCmd>("a due renew is sent while exiting too", ({prev, msg, cmds}) =>
			prev.phase === "exiting" &&
			msg.type === "renew_due" &&
			msg.fence === prev.fence &&
			msg.tick === prev.ticks &&
			!cmds.some((c) => c.type === "renew")
				? "the lease is not renewed while the exit is in flight"
				: null,
		),
		law<Host, HostMsg, HostCmd>(
			"while exiting, the exit's own answer decides, not a renew's",
			({prev, msg, next}) =>
				prev.phase === "exiting" && msg.type === "renew_lost" && next.phase !== "exiting"
					? `a renew that heard lost ended the exit in flight (now ${next.phase})`
					: null,
		),
		law<Host, HostMsg, HostCmd>("a landed exit leaves it down", ({prev, msg, next}) =>
			prev.phase === "exiting" &&
			msg.type === "exited" &&
			msg.fence === prev.fence &&
			next.phase !== "down"
				? `after its exit landed it is ${next.phase}`
				: null,
		),
		law<Host, HostMsg, HostCmd>(
			"down wakes only on a restart after its exit",
			({prev, msg, next}) =>
				prev.phase === "down" &&
				next.phase !== "down" &&
				!(msg.type === "seen_restart" && msg.pos > prev.pos)
					? `down at ${prev.pos} woke on ${showHostMsg(msg)}`
					: null,
		),
	];
}

export const showHostMsg = (m: HostMsg): string => {
	const {type, ...rest} = m;
	const args = Object.values(rest).join(" ");
	return args === "" ? type : `${type} ${args}`;
};

const real = hostUpdate(SETTINGS);
type HostStep = Update<Host, HostMsg, HostCmd>;

export const HOST_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: HostStep;
	readonly view?: HostView;
}[] = [
	{
		name: "starts unclaimed (94)",
		law: "the program runs only under the claim this host won last",
		update: (s, m) =>
			s.phase === "claiming" && m.type === "held"
				? [
						{
							phase: "owning",
							fence: 1,
							incarnation: 1,
							until: CLAIMED_UNTIL,
							started: false,
							ticks: 0,
						},
						[],
					]
				: real(s, m),
	},
	{
		name: "keeps running when lost (94)",
		law: "losing the lease stops the program",
		update: (s, m) => (m.type === "renew_lost" ? [s, []] : real(s, m)),
	},
	{
		name: "renews the first fence (94)",
		law: "it renews only the fence it holds",
		update: (s, m) =>
			s.phase === "owning" && m.type === "renew_due" && m.fence === s.fence && m.tick === s.ticks
				? [{...s, ticks: s.ticks + 1}, [{type: "renew", fence: 1}]]
				: real(s, m),
	},
	{
		name: "claims while owning (94)",
		law: "it claims only while it holds nothing and the name is not down",
		update: (s, m) =>
			s.phase === "owning" && m.type === "seen_expiry" && m.fence !== s.fence
				? [s, [{type: "claim"}]]
				: real(s, m),
	},
	{
		name: "stale word stops (94)",
		law: "word about another fence changes nothing",
		update: (s, m) =>
			s.phase === "owning" && m.type === "renew_lost"
				? [{phase: "watching", waitMs: SETTINGS.retryMs, tries: 0}, []]
				: real(s, m),
	},
	{
		name: "renews after start (94)",
		law: "while the program runs, the lease is renewed",
		update: real,
		view: {...VIEW, renewing: (s) => s.phase === "owning" && s.started},
	},
	{
		name: "ignores its lease clock (98)",
		law: "at its own lease's end the program stops",
		update: (s, m) => (m.type === "lease_due" ? [s, []] : real(s, m)),
	},
	{
		name: "a late renew answer moves the lease end back (98)",
		law: "the lease clock never runs backwards",
		update: (s, m) =>
			s.phase === "owning" && m.type === "renewed" && m.fence === s.fence
				? [{...s, until: m.until}, []]
				: real(s, m),
	},
	{
		name: "the lease clock waits for the program to start (98)",
		law: "while the program runs, its lease clock runs",
		update: real,
		view: {
			...VIEW,
			leaseClock: (s) => (s.phase === "owning" && s.started ? leaseClockOf(s) : null),
		},
	},
	{
		name: "a takeover counts as a new incarnation (99)",
		law: "the program runs under the incarnation its claim gave",
		update: (s, m) => {
			const [next, cmds] = real(s, m);
			return m.type === "claimed" && next.phase === "owning"
				? [{...next, incarnation: m.incarnation + 1}, cmds]
				: [next, cmds];
		},
	},
	{
		name: "the program runs on while the exit is in flight (99)",
		law: "nothing runs while exiting or down",
		update: real,
		view: {
			...VIEW,
			program: (s) =>
				s.phase === "owning" || s.phase === "exiting"
					? {fence: s.fence, incarnation: s.incarnation}
					: null,
		},
	},
	{
		name: "exits on another fence's program end (99)",
		law: "it exits only for its own program's end, under the fence it holds",
		update: (s, m) =>
			s.phase === "owning" && m.type === "program_ended" && m.fence !== s.fence
				? real(s, {...m, fence: s.fence})
				: real(s, m),
	},
	{
		name: "a lost lease exits as a crash (99)",
		law: "a program that lost its lease or was stopped is not an exit",
		update: (s, m) =>
			m.type === "program_ended" && m.how === "lost"
				? real(s, {
						type: "program_ended",
						fence: m.fence,
						how: "crashed",
						why: "lost",
						suspect: null,
					})
				: real(s, m),
	},
	{
		name: "a crash exits normal (99)",
		law: "a crash exits `crash`, a return exits `normal`",
		update: (s, m) =>
			m.type === "program_ended" && m.how === "crashed"
				? real(s, {type: "program_ended", fence: m.fence, how: "ended"})
				: real(s, m),
	},
	{
		name: "stops renewing while exiting (99)",
		law: "a due renew is sent while exiting too",
		update: (s, m) => (s.phase === "exiting" && m.type === "renew_due" ? [s, []] : real(s, m)),
	},
	{
		name: "a renew that heard lost ends the exit (99)",
		law: "while exiting, the exit's own answer decides, not a renew's",
		update: (s, m) =>
			s.phase === "exiting" && m.type === "renew_lost" && m.fence === s.fence
				? [{phase: "watching", waitMs: SETTINGS.retryMs, tries: 0}, []]
				: real(s, m),
	},
	{
		name: "a landed exit goes back to watching (99)",
		law: "a landed exit leaves it down",
		update: (s, m) =>
			s.phase === "exiting" && m.type === "exited" && m.fence === s.fence
				? [{phase: "watching", waitMs: SETTINGS.retryMs, tries: 0}, []]
				: real(s, m),
	},
	{
		name: "a stale restart wakes a down name (99)",
		law: "down wakes only on a restart after its exit",
		update: (s, m) =>
			s.phase === "down" && m.type === "seen_restart"
				? [{phase: "watching", waitMs: 0, tries: 0}, []]
				: real(s, m),
	},
	{
		name: "claims while down (99)",
		law: "it claims only while it holds nothing and the name is not down",
		update: (s, m) =>
			s.phase === "down" && m.type === "seen_restart" && m.pos <= s.pos
				? [s, [{type: "claim"}]]
				: real(s, m),
	},
];

// ---------------------------------------------------------------- the call module

/**
 * The call module inside the smallest parent that shows what it did: the calls, the outcome of the
 * last Msg, and which ids were ever called (so the world calls each id once, as a parent does).
 */
export interface Caller {
	readonly calls: Calls<number>;
	readonly last: Outcome<number, string>;
	readonly called: readonly string[];
}
export type CallerMsg =
	| {readonly type: "call"; readonly id: string; readonly req: number}
	| CallMsg<string>;
type CallerCmd = CallCmd<number>;

const CALL_SETTINGS = {timeoutMs: 100, retryMs: 20};
const calls = callUpdate(CALL_SETTINGS);
const REQ: Record<string, number> = {q1: 1, q2: 2};

export const callerInit: Caller = {calls: noCalls(), last: null, called: []};

export const callerStep: Update<Caller, CallerMsg, CallerCmd> = (s, m) => {
	if (m.type === "call") {
		const r = call(s.calls, m.id, m.req);
		return [{calls: r.calls, last: null, called: [...s.called, m.id]}, r.cmds];
	}
	const r = calls<number, string>(s.calls, m);
	return [{...s, calls: r.calls, last: r.outcome}, r.cmds];
};

export function callerWorld(): World<Caller, CallerMsg, CallerCmd> {
	return {
		outside: (s) => [
			...Object.entries(REQ)
				.filter(([id]) => !s.called.includes(id))
				.map(([id, req]): CallerMsg => ({type: "call", id, req})),
			{type: "resume"},
			...s.calls.pending.flatMap((p): CallerMsg[] => [
				{type: "timed_out", id: p.id, tries: p.tries},
				{type: "timed_out", id: p.id, tries: p.tries - 1},
			]),
			...Object.keys(REQ).flatMap((id) =>
				[1, 2, 3].map((rev): CallerMsg => ({type: "reply", id, rev, res: `${id}@${rev}`})),
			),
		],
		answers: (cmd) => [
			{type: "sent", id: cmd.id, tries: cmd.tries, at: 0},
			{type: "send_failed", id: cmd.id, tries: cmd.tries, at: 0},
		],
	};
}

const pendingOf = (s: Caller, id: string) => s.calls.pending.find((p) => p.id === id);

export function callerLaws(): readonly Law<Caller, CallerMsg, CallerCmd>[] {
	return [
		watched<Caller, CallerMsg, CallerCmd, readonly string[]>(
			"a call is answered at most once",
			[],
			(answered, {next}) => {
				if (next.last?.kind !== "answered") return answered;
				const id = next.last.id;
				return answered.includes(id)
					? broke(`${id} answered a second time`)
					: [...answered, id].sort();
			},
		),
		law<Caller, CallerMsg, CallerCmd>(
			"every send carries a pending call's id, its request and its try",
			({next, cmds}) => {
				const bad = cmds.find((c) => {
					const p = pendingOf(next, c.id);
					return p === undefined || p.req !== c.req || p.tries !== c.tries;
				});
				return bad === undefined ? null : `sends ${bad.id} try ${bad.tries} req ${bad.req}`;
			},
		),
		law<Caller, CallerMsg, CallerCmd>(
			"a reply at or behind the cursor changes nothing",
			({prev, msg, next, cmds}) =>
				msg.type === "reply" &&
				msg.rev <= prev.calls.cursor &&
				(next.calls !== prev.calls || cmds.length > 0 || next.last !== null)
					? `reply ${msg.id} at rev ${msg.rev}, cursor ${prev.calls.cursor}, changed the calls`
					: null,
		),
		law<Caller, CallerMsg, CallerCmd>(
			"a reply for no pending call answers nothing",
			({prev, msg, next}) =>
				msg.type === "reply" &&
				pendingOf(prev, msg.id) === undefined &&
				next.last?.kind === "answered"
					? `reply ${msg.id} answered a call that was not pending`
					: null,
		),
		law<Caller, CallerMsg, CallerCmd>(
			"a call that timed out is sent again under its own id",
			({prev, msg, cmds}) => {
				if (msg.type !== "timed_out") return null;
				const p = pendingOf(prev, msg.id);
				if (p === undefined || p.tries !== msg.tries || p.due === null) return null;
				return cmds.some((c) => c.id === p.id && c.tries === p.tries + 1)
					? null
					: `${p.id} timed out at try ${p.tries} and was not sent again under its id`;
			},
		),
		law<Caller, CallerMsg, CallerCmd>(
			"resume sends every pending call again",
			({prev, msg, cmds}) => {
				if (msg.type !== "resume") return null;
				const want = prev.calls.pending.map((p) => p.id).sort();
				const got = cmds.map((c) => c.id).sort();
				return want.join() === got.join() ? null : `resume sent ${got.join()} of ${want.join()}`;
			},
		),
		law<Caller, CallerMsg, CallerCmd>("a call is answered with its own request", ({next}) =>
			next.last?.kind === "answered" && REQ[next.last.id] !== next.last.req
				? `${next.last.id} answered with req ${next.last.req}`
				: null,
		),
	];
}

export const showCallerMsg = (m: CallerMsg): string => {
	const {type, ...rest} = m;
	const args = Object.values(rest).join(" ");
	return args === "" ? type : `${type} ${args}`;
};

type CallerStep = Update<Caller, CallerMsg, CallerCmd>;
const around =
	(f: (s: Caller, m: CallerMsg) => ReturnType<CallerStep> | null): CallerStep =>
	(s, m) =>
		f(s, m) ?? callerStep(s, m);

export const CALLER_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: CallerStep;
}[] = [
	{
		name: "a late reply is read again",
		law: "a reply at or behind the cursor changes nothing",
		update: around((s, m) => {
			if (m.type !== "reply" || m.rev > s.calls.cursor) return null;
			const p = pendingOf(s, m.id);
			return p === undefined
				? null
				: [
						{
							...s,
							calls: {...s.calls, pending: s.calls.pending.filter((x) => x !== p)},
							last: {kind: "answered", id: p.id, req: p.req, res: m.res},
						},
						[],
					];
		}),
	},
	{
		name: "a reply for no pending call answers",
		law: "a reply for no pending call answers nothing",
		update: around((s, m) =>
			m.type === "reply" && m.rev > s.calls.cursor && pendingOf(s, m.id) === undefined
				? [
						{
							...s,
							calls: {...s.calls, cursor: m.rev},
							last: {kind: "answered", id: m.id, req: REQ[m.id] ?? 0, res: m.res},
						},
						[],
					]
				: null,
		),
	},
	{
		name: "a retry under a new call id",
		law: "a call that timed out is sent again under its own id",
		update: around((s, m) => {
			if (m.type !== "timed_out") return null;
			const [next, cmds] = callerStep(s, m);
			return [next, cmds.map((c) => ({...c, id: `${c.id}'`}))];
		}),
	},
	{
		name: "resume forgets the calls in flight",
		law: "resume sends every pending call again",
		update: around((s, m) => (m.type === "resume" ? [s, []] : null)),
	},
	{
		name: "a send carries the try before",
		law: "every send carries a pending call's id, its request and its try",
		update: around((s, m) => {
			if (m.type !== "timed_out") return null;
			const [next, cmds] = callerStep(s, m);
			return [next, cmds.map((c) => ({...c, tries: c.tries - 1}))];
		}),
	},
	{
		name: "answers with another call's request",
		law: "a call is answered with its own request",
		update: around((s, m) => {
			const [next, cmds] = callerStep(s, m);
			return next.last?.kind === "answered"
				? [{...next, last: {...next.last, req: next.last.req + 1}}, cmds]
				: [next, cmds];
		}),
	},
	{
		name: "a reply answers but the call stays pending",
		law: "a call is answered at most once",
		update: around((s, m) => {
			if (m.type !== "reply" || m.rev <= s.calls.cursor) return null;
			const p = pendingOf(s, m.id);
			return p === undefined
				? null
				: [
						{
							...s,
							calls: {...s.calls, cursor: m.rev},
							last: {kind: "answered", id: p.id, req: p.req, res: m.res},
						},
						[],
					];
		}),
	},
];

// ---------------------------------------------------------------- the supervisor (99, 100)

// OTP's supervisor, walked through its real reducer once per restart strategy. Its starts, its
// stops, its replies and its give-up are Subs read off the state (`startsOf`, `stopOf`, `outbox`,
// `phase`), so the world answers whatever is in flight, in any order. Times are data: a start
// answers at its `notBefore`, an EXIT comes 20, 150 or 2000 ms after the run began. The spec is
// small on purpose: intensity 1 in 100 ms, a backoff of 10..40 ms that resets after 1000 ms, so a
// give-up, a second restart in a row and a reset all fit inside the depth bound.

const SUP = "s";
const SUP_BACKOFF = {minMs: 10, maxMs: 40, resetAfterMs: 1000};
const supSpec = (strategy: Strategy): SupervisorSpec => ({
	strategy,
	intensity: 1,
	periodMs: 100,
	maxDeliveries: null,
	backoff: SUP_BACKOFF,
	children: [
		{name: "a", restart: "permanent", shutdown: "brutal_kill"},
		{name: "b", restart: "transient", shutdown: 100},
		{name: "t", restart: "temporary", shutdown: "infinity"},
	],
});
const STRATEGIES: readonly Strategy[] = ["one_for_one", "one_for_all", "rest_for_one"];
type SupStep = Update<SupervisorState, SupervisorMsg, never>;
const supOf =
	(spec: SupervisorSpec): SupStep =>
	(s, m) => [superviseWith(SUP, spec)(s, m), []];
const caller = (id: string) => ({id, replyTo: "h"});
type Reason = Extract<SupervisorMsg, {readonly type: "exit"}>["reason"];

export function supervisorWorld(): World<SupervisorState, SupervisorMsg, never> {
	return {
		outside: (s) => {
			const begins: SupervisorMsg[] = [
				{type: "begin", incarnation: 1, parent: "p"},
				...(s.incarnation >= 1
					? [{type: "begin" as const, incarnation: s.incarnation + 1, parent: "p"}]
					: []),
			];
			if (s.incarnation === 0) return begins;
			const rev = s.cursor + 1;
			const to = s.incarnation;
			const exit = (from: string, incarnation: number, reason: Reason, at: number) =>
				({type: "exit", rev, from, to, incarnation, reason, why: "x", at}) as const;
			const exits = s.children.flatMap((c): SupervisorMsg[] => {
				const run = c.run;
				switch (run.is) {
					case "up": {
						const at = (d: number) => run.since + d;
						const inc = c.incarnation;
						return c.name === "a"
							? [
									exit("a", inc, "crash", at(20)),
									exit("a", inc, "crash", at(150)),
									exit("a", inc, "crash", at(2000)),
									exit("a", inc, "normal", at(20)),
									...(inc > 1 ? [exit("a", inc - 1, "crash", at(20))] : []),
								]
							: c.name === "b"
								? [exit("b", inc, "crash", at(20)), exit("b", inc, "normal", at(20))]
								: [exit(c.name, inc, "crash", at(20))];
					}
					case "stopping":
						return [exit(c.name, c.incarnation, "shutdown", 60)];
					case "starting":
						// An exit that comes before the start's answer.
						return c.name === "a" && run.after !== null
							? [exit("a", run.after + 1, "crash", run.notBefore + 20)]
							: [];
					case "stopped":
						return [];
				}
				return [];
			});
			const starts = startsOf(s).flatMap((p): SupervisorMsg[] => {
				const known = s.children.find((c) => c.name === p.name)?.incarnation ?? 0;
				const started: SupervisorMsg = {
					type: "started",
					name: p.name,
					incarnation: (p.after ?? known) + 1,
					at: p.notBefore,
					generation: p.generation,
				};
				return p.name === "d" ? [started, {type: "start_refused", name: "d"}] : [started];
			});
			// A start sent in the generation before a group restart caught it, landing late: any time.
			const late = s.children.flatMap((c): SupervisorMsg[] => {
				const run = c.run;
				return run.is === "starting" && run.generation > 0
					? [
							{
								type: "started",
								name: c.name,
								incarnation: (run.after ?? c.incarnation) + 1,
								at: run.notBefore - 5,
								generation: run.generation - 1,
							},
						]
					: [];
			});
			const stop = stopOf(s);
			const stops: SupervisorMsg[] =
				stop === null
					? []
					: (["signalled", "exited", "noproc"] as const).map((how) => ({
							type: "signalled",
							name: stop.name,
							incarnation: stop.incarnation,
							signal: stop.signal,
							how,
							at: Math.max(10, stop.at),
						}));
			const request = (id: string, req: Request): SupervisorMsg => ({
				type: "request",
				rev,
				caller: caller(id),
				req,
			});
			return [
				...begins,
				...exits,
				...starts,
				...late,
				...stops,
				request("q1", {op: "terminate_child", name: "b"}),
				request("q2", {op: "restart_child", name: "b"}),
				request("q3", {op: "start_child", spec: {name: "d", restart: "permanent"}}),
				request("q4", {op: "which_children"}),
				...s.outbox.map((o): SupervisorMsg => ({type: "replied", id: o.id})),
				exit("p", 1, "shutdown", 50),
				exit("x", 1, "crash", 50),
				...(to > 1 ? [{...exit("a", 1, "crash", 50), to: to - 1}] : []),
				...(s.cursor > 0 ? [{...exit("a", 9, "crash", 50), rev: s.cursor}] : []),
				{type: "ignored", rev},
			];
		},
		answers: () => [],
	};
}

const childOf = (s: SupervisorState, name: string) => s.children.find((c) => c.name === name);
/** The restart type the spec gives a child (the laws' truth, not the state's); `d` is added permanent. */
const specRestart = (name: string) =>
	supSpec("one_for_one").children.find((c) => c.name === name)?.restart ?? "permanent";
const startOf = (s: SupervisorState, name: string) => {
	const run = childOf(s, name)?.run;
	return run?.is === "starting" ? run : undefined;
};
/** A start `next` has and `prev` did not (or had for another run). */
const newStart = (prev: SupervisorState, next: SupervisorState, name: string) => {
	const a = startOf(prev, name);
	const b = startOf(next, name);
	return b !== undefined && (a === undefined || a.after !== b.after) ? b : undefined;
};
const windowOf = (spec: SupervisorSpec, s: SupervisorState, at: number) =>
	s.restarts.filter((t) => t > at - spec.periodMs);
/** An EXIT of a running child the reducer must act on: past the cursor, for this run, not stale. */
const freshExit = (s: SupervisorState, m: SupervisorMsg) => {
	if (m.type !== "exit" || m.rev <= s.cursor || m.to !== s.incarnation || s.phase !== "running")
		return null;
	const c = childOf(s, m.from);
	if (c === undefined || c.run.is !== "up" || m.incarnation < c.incarnation) return null;
	return {c, m};
};
const freshParent = (s: SupervisorState, m: SupervisorMsg) =>
	m.type === "exit" &&
	m.rev > s.cursor &&
	m.to === s.incarnation &&
	s.phase === "running" &&
	m.from === s.parent;
/** A restart this step made: which child, the exit it answers, and how long that run lived. */
const restartOf = (prev: SupervisorState, msg: SupervisorMsg, next: SupervisorState) => {
	if (msg.type === "begin" || next.restarted <= prev.restarted) return null;
	if (msg.type === "exit") {
		const run = childOf(prev, msg.from)?.run;
		return {name: msg.from, at: msg.at, lived: run?.is === "up" ? msg.at - run.since : null};
	}
	if (msg.type === "started") {
		const run = childOf(prev, msg.name)?.run;
		const held = run?.is === "starting" ? run.held : null;
		return held === null ? null : {name: msg.name, at: held.at, lived: held.at - msg.at};
	}
	return null;
};
/** The siblings a strategy restarts with `name`, by the order in `s`. */
const groupOf = (strategy: Strategy, s: SupervisorState, name: string) => {
	const at = s.children.findIndex((c) => c.name === name);
	return strategy === "one_for_all"
		? s.children.filter((c) => c.name !== name).map((c) => c.name)
		: strategy === "rest_for_one"
			? s.children.slice(at + 1).map((c) => c.name)
			: [];
};
const sameExceptCursor = (a: SupervisorState, b: SupervisorState) =>
	JSON.stringify({...a, cursor: 0}) === JSON.stringify({...b, cursor: 0});

type SupLaw = Law<SupervisorState, SupervisorMsg, never>;
const l = (name: string, check: Parameters<typeof law<SupervisorState, SupervisorMsg, never>>[1]) =>
	law<SupervisorState, SupervisorMsg, never>(name, check);

export function supervisorLaws(strategy: Strategy): readonly SupLaw[] {
	const spec = supSpec(strategy);
	const b = SUP_BACKOFF;
	return [
		l("it never restarts more than its intensity within one period", ({prev, next}) => {
			if (next.restarted <= prev.restarted) return null;
			const n = windowOf(spec, next, next.restarts.at(-1) ?? 0).length;
			return n <= spec.intensity ? null : `${n} restarts within ${spec.periodMs} ms`;
		}),
		l("it gives up only past its intensity, or when its parent exits", ({prev, msg, next}) => {
			if (prev.phase !== "running" || next.phase === "running" || msg.type === "begin") return null;
			if (freshParent(prev, msg)) return null;
			const held = msg.type === "started" ? startOf(prev, msg.name)?.held : null;
			const at = msg.type === "exit" ? msg.at : (held?.at ?? null);
			if (at === null) return `gave up on ${msg.type}`;
			const n = windowOf(spec, prev, at).length + 1;
			return n > spec.intensity ? null : `gave up at ${n} restarts, intensity ${spec.intensity}`;
		}),
		l("a parent's EXIT stops it", ({prev, msg, next}) =>
			freshParent(prev, msg) && next.phase === "running" ? "its parent exited; it runs on" : null,
		),
		l("after it gives up nothing starts, until a new incarnation", ({prev, msg, next}) => {
			if (
				next.phase !== "running" &&
				next.children.some(
					(c) =>
						c.run.is === "starting" ||
						(c.run.is === "stopping" && c.run.afterStop.do === "restart"),
				)
			)
				return "a start is still in the state after giving up";
			if (prev.phase !== "running" && next.phase === "running")
				return msg.type === "begin" && msg.incarnation !== prev.incarnation
					? null
					: `woke on ${msg.type}`;
			return null;
		}),
		l("it exits only once every child is stopped", ({next}) => {
			const left = next.children.find((c) => c.run.is !== "stopped");
			return next.phase === "shutdown" && left !== undefined
				? `exited with ${left.name} ${left.run.is}`
				: null;
		}),
		l("a temporary child is never started again", ({prev, msg, next}) => {
			if (msg.type === "begin") return null;
			const again = next.children.find(
				(c) => specRestart(c.name) === "temporary" && newStart(prev, next, c.name),
			);
			return again === undefined ? null : `temporary ${again.name} started again on ${msg.type}`;
		}),
		l("a transient child is started again only after a crash or a kill", ({prev, msg, next}) => {
			const f = freshExit(prev, msg);
			if (f === null || specRestart(f.c.name) !== "transient") return null;
			return f.m.reason !== "crash" && f.m.reason !== "killed" && newStart(prev, next, f.c.name)
				? `transient ${f.c.name} started again after ${f.m.reason}`
				: null;
		}),
		l("a permanent child's exit starts it again, within intensity", ({prev, msg, next}) => {
			const f = freshExit(prev, msg);
			if (f === null || specRestart(f.c.name) !== "permanent" || next.phase !== "running")
				return null;
			return startOf(next, f.c.name)?.after === f.m.incarnation
				? null
				: `${f.c.name} exited at ${f.m.incarnation} and was not started again`;
		}),
		l("a restart takes exactly the strategy's siblings with it", ({prev, msg, next}) => {
			const r = restartOf(prev, msg, next);
			if (r === null) return null;
			const group = groupOf(strategy, prev, r.name);
			for (const x of prev.children) {
				if (x.name === r.name) continue;
				const after = childOf(next, x.name);
				if (!group.includes(x.name)) {
					if (JSON.stringify(after) !== JSON.stringify(x))
						return `${x.name} is no ${strategy} sibling of ${r.name} and changed`;
				} else if (x.run.is === "up" && after?.run.is !== "stopping")
					return `${x.name} is a ${strategy} sibling of ${r.name} and was not stopped`;
			}
			return null;
		}),
		l("a running child is stopped before it is started again", ({prev, msg, next}) => {
			if (msg.type === "begin") return null;
			for (const x of prev.children) {
				const after = childOf(next, x.name);
				if (after?.run.is !== "starting") continue;
				const own = msg.type === "exit" && msg.from === x.name;
				if (x.run.is === "up" && !own) return `${x.name} was up and starts again on ${msg.type}`;
				if (
					x.run.is === "stopping" &&
					!own &&
					!(msg.type === "signalled" && msg.name === x.name && msg.how === "noproc")
				)
					return `${x.name} was stopping and starts again on ${msg.type}`;
			}
			return null;
		}),
		l("a start sent before a group restart caught it is not kept running", ({prev, msg, next}) => {
			if (msg.type !== "started") return null;
			const run = childOf(prev, msg.name)?.run;
			if (run?.is !== "starting" || msg.generation >= run.generation || prev.phase !== "running")
				return null;
			return childOf(next, msg.name)?.run.is === "up"
				? `${msg.name} started in generation ${msg.generation}, caught in generation ${run.generation}, and is kept`
				: null;
		}),
		l("a restart waits between minMs and maxMs after the exit", ({prev, msg, next}) => {
			const r = restartOf(prev, msg, next);
			const s = r === null ? undefined : startOf(next, r.name);
			if (r === null || s === undefined) return null;
			const wait = s.notBefore - r.at;
			return wait >= b.minMs && wait <= b.maxMs ? null : `${r.name} waits ${wait} ms`;
		}),
		watched<SupervisorState, SupervisorMsg, never, Readonly<Record<string, number>>>(
			"a crash again soon waits twice as long, up to maxMs; a long run starts over",
			{},
			(last, {prev, msg, next}) => {
				if (msg.type === "begin" && msg.incarnation !== prev.incarnation) return {};
				const r = restartOf(prev, msg, next);
				const s = r === null ? undefined : startOf(next, r.name);
				if (r === null || s === undefined || r.lived === null) return last;
				const wait = s.notBefore - r.at;
				const before = last[r.name];
				if (r.lived >= b.resetAfterMs && wait !== b.minMs)
					return broke(`${r.name} ran ${r.lived} ms and still waits ${wait} ms`);
				if (
					r.lived < b.resetAfterMs &&
					before !== undefined &&
					wait < Math.min(b.maxMs, 2 * before)
				)
					return broke(
						`${r.name} crashed again after ${r.lived} ms; waits ${wait}, then ${before}`,
					);
				return {...last, [r.name]: wait};
			},
		),
		watched<SupervisorState, SupervisorMsg, never, Readonly<Record<string, string>>>(
			"a call sent again gets the same answer, and is answered once at a time",
			{},
			(seen, {prev, next}) => {
				const ids = next.outbox.map((o) => o.id);
				if (new Set(ids).size !== ids.length) return broke(`two replies in flight for one id`);
				let out = seen;
				for (const o of next.outbox) {
					if (prev.outbox.some((p) => p.id === o.id)) continue;
					const res = JSON.stringify(o.res);
					const was = out[o.id];
					if (was !== undefined && was !== res)
						return broke(`call ${o.id} answered ${was}, then ${res}`);
					out = {...out, [o.id]: res};
				}
				return out;
			},
		),
		watched<SupervisorState, SupervisorMsg, never, readonly string[]>(
			"a terminated child stays stopped until restart_child or a group restart",
			[],
			(gone, {prev, msg, next}) => {
				if (msg.type === "begin" && msg.incarnation !== prev.incarnation) return [];
				let now = gone;
				// A call sent again under an id it answered (or is working on) does nothing new.
				const resent =
					msg.type === "request" &&
					msg.caller !== null &&
					[...prev.answered, ...prev.waiting].some((a) => a.id === msg.caller?.id);
				const req = msg.type === "request" && msg.rev > prev.cursor && !resent ? msg.req : null;
				if (req !== null && prev.phase === "running" && "name" in req) {
					if (req.op === "terminate_child" && childOf(prev, req.name) && !now.includes(req.name))
						now = [...now, req.name];
					if (req.op === "restart_child" || req.op === "delete_child")
						now = now.filter((n) => n !== req.name);
				}
				const r = restartOf(prev, msg, next);
				if (r !== null) {
					const group = groupOf(strategy, prev, r.name);
					now = now.filter((n) => !group.includes(n));
				}
				const back = now.find((n) => {
					const run = childOf(next, n)?.run.is;
					return run === "up" || run === "starting";
				});
				return back === undefined ? now : broke(`${back} was terminated and runs again`);
			},
		),
		l("a stale EXIT changes nothing but the cursor", ({prev, msg, next}) => {
			if (msg.type !== "exit" || msg.rev <= prev.cursor) return null;
			const c = childOf(prev, msg.from);
			const stale =
				msg.to !== prev.incarnation || (c !== undefined && msg.incarnation < c.incarnation);
			return stale && !sameExceptCursor(prev, next)
				? `EXIT of ${msg.from} at ${msg.incarnation} for run ${msg.to} (known ${c?.incarnation}, run ${prev.incarnation}) changed the state`
				: null;
		}),
		l("a message at or behind the cursor changes nothing", ({prev, msg, next}) =>
			"rev" in msg && msg.rev <= prev.cursor && next !== prev
				? `${msg.type} at rev ${msg.rev} changed the state`
				: null,
		),
		l("a new incarnation starts every child from the spec", ({prev, msg, next}) => {
			if (msg.type !== "begin" || msg.incarnation === prev.incarnation) return null;
			const want = spec.children.map((c) => `${c.name}:null`).join();
			const got = next.children
				.map((c) => `${c.name}:${c.run.is === "starting" ? c.run.after : c.run.is}`)
				.join();
			return want === got && next.restarts.length === 0 && next.phase === "running"
				? null
				: `started ${got}, restarts ${next.restarts.length}, ${next.phase}`;
		}),
		l("every new start names the last run it replaces", ({prev, next}) => {
			for (const c of next.children) {
				const s = newStart(prev, next, c.name);
				const want = c.incarnation === 0 ? null : c.incarnation;
				if (s !== undefined && s.after !== want)
					return `${c.name} starts after ${s.after}; its last run is ${want}`;
			}
			return null;
		}),
	];
}

const sup1 = superviseWith(SUP, supSpec("one_for_one"));
const aroundSup =
	(f: (s: SupervisorState, m: SupervisorMsg) => SupervisorState | null): SupStep =>
	(s, m) => [f(s, m) ?? sup1(s, m), []];
const withSpec = (change: Partial<SupervisorSpec>): SupStep =>
	supOf({...supSpec("one_for_one"), ...change});
const mapChildren = (s: SupervisorState, f: (c: Child) => Child): SupervisorState => ({
	...s,
	children: s.children.map(f),
});

export const SUPERVISOR_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	/** The strategy the plant runs under: the real machine it is checked against. */
	readonly strategy: Strategy;
	readonly update: SupStep;
}[] = [
	{
		name: "no brake: restarts past its intensity",
		law: "it never restarts more than its intensity within one period",
		strategy: "one_for_one",
		update: withSpec({intensity: 99}),
	},
	{
		name: "counts restarts forever, never over a period",
		law: "it gives up only past its intensity, or when its parent exits",
		strategy: "one_for_one",
		update: withSpec({periodMs: 1_000_000}),
	},
	{
		name: "ignores its parent's EXIT",
		law: "a parent's EXIT stops it",
		strategy: "one_for_one",
		update: aroundSup((s, m) =>
			freshParent(s, m) && m.type === "exit" ? {...s, cursor: m.rev} : null,
		),
	},
	{
		name: "starts its children again after giving up",
		law: "after it gives up nothing starts, until a new incarnation",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			const next = sup1(s, m);
			return next.phase !== "running" && s.phase === "running"
				? mapChildren(next, (c) => ({
						...c,
						run: {is: "starting", after: c.incarnation, notBefore: 0, held: null, generation: 0},
					}))
				: null;
		}),
	},
	{
		name: "gives up and exits at once, its children left running",
		law: "it exits only once every child is stopped",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			const next = sup1(s, m);
			return next.phase === "stopping" ? {...next, phase: "shutdown"} : null;
		}),
	},
	{
		name: "a temporary child is restarted like a permanent one",
		law: "a temporary child is never started again",
		strategy: "one_for_one",
		update: withSpec({
			children: supSpec("one_for_one").children.map((c) => ({...c, restart: "permanent" as const})),
		}),
	},
	{
		name: "a transient child is restarted after a clean exit",
		law: "a transient child is started again only after a crash or a kill",
		strategy: "one_for_one",
		update: aroundSup((s, m) =>
			m.type === "exit" && m.reason === "normal" ? sup1(s, {...m, reason: "crash"}) : null,
		),
	},
	{
		name: "a permanent child is let go after a normal exit",
		law: "a permanent child's exit starts it again, within intensity",
		strategy: "one_for_one",
		update: withSpec({
			children: supSpec("one_for_one").children.map((c) =>
				c.restart === "permanent" ? {...c, restart: "transient" as const} : c,
			),
		}),
	},
	{
		name: "one_for_all restarts only the child that exited",
		law: "a restart takes exactly the strategy's siblings with it",
		strategy: "one_for_all",
		update: withSpec({strategy: "one_for_one"}),
	},
	{
		name: "rest_for_one restarts the children before it too",
		law: "a restart takes exactly the strategy's siblings with it",
		strategy: "rest_for_one",
		update: withSpec({strategy: "one_for_all"}),
	},
	{
		name: "a group restart starts the siblings without stopping them: two runs at once",
		law: "a running child is stopped before it is started again",
		strategy: "one_for_all",
		update: (s, m) => {
			const next = superviseWith(SUP, supSpec("one_for_all"))(s, m);
			return [
				mapChildren(next, (c) => {
					const was = childOf(s, c.name)?.run.is;
					return was === "up" && c.run.is === "stopping" && c.run.afterStop.do === "restart"
						? {
								...c,
								run: {
									is: "starting",
									after: c.incarnation,
									notBefore: c.run.afterStop.notBefore,
									held: null,
									generation: 0,
								},
							}
						: c;
				}),
				[],
			];
		},
	},
	{
		name: "a late start from before the group restart is taken as the restart itself",
		law: "a start sent before a group restart caught it is not kept running",
		strategy: "one_for_all",
		update: (s, m) => {
			const all = superviseWith(SUP, supSpec("one_for_all"));
			const run = m.type === "started" ? childOf(s, m.name)?.run : undefined;
			return [
				all(
					s,
					m.type === "started" && run?.is === "starting" ? {...m, generation: run.generation} : m,
				),
				[],
			];
		},
	},
	{
		name: "no backoff: restarts the moment it exits",
		law: "a restart waits between minMs and maxMs after the exit",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			const {backoff: _, ...plain} = supSpec("one_for_one");
			return superviseWith(SUP, plain)(s, m);
		}),
	},
	{
		name: "a fixed wait: a crash loop waits minMs each time",
		law: "a crash again soon waits twice as long, up to maxMs; a long run starts over",
		strategy: "one_for_one",
		update: withSpec({backoff: {...SUP_BACKOFF, maxMs: SUP_BACKOFF.minMs}}),
	},
	{
		name: "the wait never starts over, however long the child ran",
		law: "a crash again soon waits twice as long, up to maxMs; a long run starts over",
		strategy: "one_for_one",
		update: withSpec({backoff: {...SUP_BACKOFF, resetAfterMs: 1_000_000}}),
	},
	{
		name: "a call sent again is done again",
		law: "a call sent again gets the same answer, and is answered once at a time",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			const caller = m.type === "request" ? m.caller : null;
			return caller === null
				? null
				: sup1({...s, answered: s.answered.filter((a) => a.id !== caller.id)}, m);
		}),
	},
	{
		name: "terminate_child starts the child again once it ends",
		law: "a terminated child stays stopped until restart_child or a group restart",
		strategy: "one_for_one",
		update: aroundSup((s, m) =>
			m.type === "request" && m.req.op === "terminate_child"
				? mapChildren(sup1(s, m), (c) =>
						c.run.is === "stopping" && c.run.afterStop.do === "stay"
							? {...c, run: {...c.run, afterStop: {do: "restart", notBefore: 0}}}
							: c,
					)
				: null,
		),
	},
	{
		name: "an EXIT for an earlier run of the supervisor restarts a child",
		law: "a stale EXIT changes nothing but the cursor",
		strategy: "one_for_one",
		update: aroundSup((s, m) =>
			m.type === "exit" && m.to !== s.incarnation ? sup1(s, {...m, to: s.incarnation}) : null,
		),
	},
	{
		name: "an EXIT of an older run of the child restarts it",
		law: "a stale EXIT changes nothing but the cursor",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			if (m.type !== "exit" || m.rev <= s.cursor) return null;
			const c = childOf(s, m.from);
			if (c === undefined || m.incarnation >= c.incarnation || c.run.is !== "up") return null;
			return sup1(
				mapChildren(s, (x) => (x === c ? {...c, incarnation: m.incarnation} : x)),
				m,
			);
		}),
	},
	{
		name: "reads an old EXIT again",
		law: "a message at or behind the cursor changes nothing",
		strategy: "one_for_one",
		update: aroundSup((s, m) =>
			m.type === "exit" && m.rev <= s.cursor ? sup1({...s, cursor: m.rev - 1}, m) : null,
		),
	},
	{
		name: "a restart of the supervisor keeps the old restart list",
		law: "a new incarnation starts every child from the spec",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			if (m.type !== "begin" || m.incarnation === s.incarnation) return null;
			return {...sup1(s, m), restarts: s.restarts.length > 0 ? s.restarts : [0]};
		}),
	},
	{
		name: "a restart names no run: a start that cannot be fenced",
		law: "every new start names the last run it replaces",
		strategy: "one_for_one",
		update: aroundSup((s, m) => {
			if (m.type !== "exit") return null;
			return mapChildren(sup1(s, m), (c) =>
				c.run.is === "starting" && c.run.after === m.incarnation
					? {...c, run: {...c.run, after: null}}
					: c,
			);
		}),
	},
];

// ---------------------------------------------------------------- the monitor module (99)

/** The monitor module inside the smallest parent that shows what it did: the last outcome. */
export interface Watcher {
	readonly monitors: Monitors;
	readonly last: MonitorOutcome;
}
type WatcherStep = Update<Watcher, MonitorMsg, MonitorCmd>;
/** 100's re-arm backoff: 50, 100, 200, 200, ... ms while a name stays down. */
const WATCH_RETRY = {retryMs: 50, maxRetryMs: 200};
const monitorsUpdate = monitorUpdate(WATCH_RETRY);
export const watcherStep: WatcherStep = (s, m) => {
	const r = monitorsUpdate(s.monitors, m);
	return [{monitors: r.monitors, last: r.outcome}, r.cmds];
};
const watcherInit: Watcher = {monitors: noMonitors, last: null};

export function watcherWorld(): World<Watcher, MonitorMsg, MonitorCmd> {
	return {
		outside: (s) => {
			const rev = s.monitors.cursor + 1;
			return [
				{type: "watch", target: "t"},
				{type: "resume"},
				...s.monitors.watches.flatMap((w): MonitorMsg[] => {
					const ref = refOf(w);
					const old = refOf({target: w.target, n: w.n - 1});
					const down = {target: w.target, incarnation: 1, why: "x", at: 0};
					return [
						{type: "retry_due", ref},
						{type: "retry_due", ref: old},
						{type: "down", rev, ref, ...down, reason: "crash"},
						{type: "down", rev, ref, ...down, incarnation: 2, reason: "crash"},
						{type: "down", rev, ref, ...down, incarnation: 4, reason: "crash"},
						{type: "down", rev, ref, ...down, incarnation: 2, reason: "noproc"},
						{type: "down", rev, ref: old, ...down, reason: "crash"},
						...(s.monitors.cursor > 0
							? [
									{
										type: "down" as const,
										rev: s.monitors.cursor,
										ref,
										...down,
										reason: "crash" as const,
									},
								]
							: []),
					];
				}),
			];
		},
		answers: (cmd) => [
			{type: "monitored", ref: cmd.ref, how: "on", incarnation: 1, at: 0},
			{type: "monitored", ref: cmd.ref, how: "on", incarnation: 3, at: 0},
			{type: "monitored", ref: cmd.ref, how: "noproc", incarnation: null, at: 0},
			{type: "monitored", ref: cmd.ref, how: "failed", incarnation: null, at: 0},
		],
	};
}

const watchOf = (s: Watcher, target: string) => s.monitors.watches.find((w) => w.target === target);

/**
 * What a Msg the module must take in proves: every incarnation of `target` up to `to` has ended.
 * A monitor on j proves j-1; a DOWN at j proves j. `death`: it is a real death (not a noproc).
 */
const provedBy = (s: Watcher, m: MonitorMsg) => {
	if (m.type === "monitored") {
		const w = s.monitors.watches.find((x) => refOf(x) === m.ref);
		if (w === undefined || w.status !== "asking" || m.how !== "on" || m.incarnation === null)
			return null;
		return {target: w.target, to: m.incarnation - 1, death: false};
	}
	if (m.type !== "down" || m.rev <= s.monitors.cursor || watchOf(s, m.target) === undefined)
		return null;
	return {target: m.target, to: m.incarnation, death: m.reason !== "noproc"};
};

/** Per target: the incarnation watching began after, and the last one proved ended. */
type Proved = Readonly<Record<string, {readonly start: number; readonly to: number}>>;
const prove = (proved: Proved, p: ReturnType<typeof provedBy>): Proved => {
	if (p === null) return proved;
	const was = proved[p.target];
	// The first thing seen is where watching began: a real death at j is reported, j-1 is not.
	if (was === undefined)
		return {...proved, [p.target]: {start: p.death ? p.to - 1 : p.to, to: p.to}};
	return {...proved, [p.target]: {start: was.start, to: Math.max(was.to, p.to)}};
};

export function watcherLaws(): readonly Law<Watcher, MonitorMsg, MonitorCmd>[] {
	type W = Law<Watcher, MonitorMsg, MonitorCmd>;
	const l = (name: string, check: Parameters<typeof law<Watcher, MonitorMsg, MonitorCmd>>[1]): W =>
		law<Watcher, MonitorMsg, MonitorCmd>(name, check);
	return [
		watched<Watcher, MonitorMsg, MonitorCmd, readonly string[]>(
			"no death is reported twice",
			[],
			(seen, {next}) => {
				const ended = endedOf(next.last);
				if (ended === null) return seen;
				const deaths = Array.from(
					{length: ended.to - ended.from + 1},
					(_, i) => `${ended.target}@${ended.from + i}`,
				);
				const twice = deaths.find((d) => seen.includes(d));
				return twice === undefined ? [...seen, ...deaths].sort() : broke(`${twice} reported twice`);
			},
		),
		watched<
			Watcher,
			MonitorMsg,
			MonitorCmd,
			{readonly proved: Proved; readonly seen: readonly string[]}
		>(
			"every death proved since watching began is reported",
			{proved: {}, seen: []},
			(mem, {prev, msg, next}) => {
				const proved = prove(mem.proved, provedBy(prev, msg));
				const ended = endedOf(next.last);
				const seen =
					ended === null
						? mem.seen
						: [
								...mem.seen,
								...Array.from(
									{length: ended.to - ended.from + 1},
									(_, i) => `${ended.target}@${ended.from + i}`,
								),
							].sort();
				for (const [target, p] of Object.entries(proved))
					for (let i = p.start + 1; i <= p.to; i++)
						if (!seen.includes(`${target}@${i}`))
							return broke(`${target}@${i} ended and was never reported`);
				return {proved, seen};
			},
		),
		l("a report goes no further than its Msg proves", ({prev, msg, next}) => {
			const ended = endedOf(next.last);
			if (ended === null || watchOf(prev, ended.target) === undefined) return null;
			const p = provedBy(prev, msg);
			return p !== null && p.target === ended.target && ended.to <= p.to
				? null
				: `reported ${ended.target}@${ended.from}..${ended.to} on ${msg.type}`;
		}),
		l("a noproc is never a death", ({next}) =>
			next.last?.kind === "down" && next.last.reason === "noproc"
				? "a noproc counted as a death"
				: null,
		),
		l("after a death it monitors again, under a new ref", ({prev, msg, cmds}) => {
			if (msg.type !== "down" || msg.rev <= prev.monitors.cursor || msg.reason === "noproc")
				return null;
			const w = watchOf(prev, msg.target);
			if (w === undefined || refOf(w) !== msg.ref || w.status === "waiting") return null;
			return cmds.some((c) => c.target === msg.target && c.ref !== msg.ref)
				? null
				: `${msg.target} came down and is not watched again`;
		}),
		l("every monitor carries the ref of a watch that is asking", ({next, cmds}) => {
			const bad = cmds.find((c) => {
				const w = watchOf(next, c.target);
				return w === undefined || w.status !== "asking" || refOf(w) !== c.ref;
			});
			return bad === undefined ? null : `monitors ${bad.target} under ${bad.ref}`;
		}),
		l("a DOWN at or behind the cursor changes nothing", ({prev, msg, next, cmds}) =>
			msg.type === "down" &&
			msg.rev <= prev.monitors.cursor &&
			(next.monitors !== prev.monitors || cmds.length > 0 || next.last !== null)
				? `DOWN at rev ${msg.rev}, cursor ${prev.monitors.cursor}, changed something`
				: null,
		),
		l("resume sends every asking monitor again", ({prev, msg, cmds}) => {
			if (msg.type !== "resume") return null;
			const want = prev.monitors.watches
				.filter((w) => w.status === "asking")
				.map(refOf)
				.sort()
				.join();
			const got = cmds
				.map((c) => c.ref)
				.sort()
				.join();
			return want === got ? null : `resume sent ${got} of ${want}`;
		}),
		watched<Watcher, MonitorMsg, MonitorCmd, Readonly<Record<string, number>>>(
			"a name that stays down is asked again later each time, up to maxRetryMs",
			{},
			(last, {prev, msg, next}) => {
				if (msg.type !== "monitored") return last;
				const w = prev.monitors.watches.find((x) => refOf(x) === msg.ref);
				if (w === undefined || w.status !== "asking") return last;
				if (msg.how === "on") {
					const {[w.target]: _, ...rest} = last;
					return rest;
				}
				const after = watchOf(next, w.target);
				if (after?.status !== "waiting" || after.due === null) return last;
				const wait = after.due - msg.at;
				const before = last[w.target];
				const {retryMs, maxRetryMs} = WATCH_RETRY;
				if (wait < retryMs || wait > maxRetryMs) return broke(`${w.target} waits ${wait} ms`);
				if (before !== undefined && wait < Math.min(maxRetryMs, 2 * before))
					return broke(`${w.target} missed again; waits ${wait} ms, then ${before} ms`);
				return {...last, [w.target]: wait};
			},
		),
		l("a waiting watch asks again only when its own retry is due", ({prev, msg, next}) => {
			for (const w of prev.monitors.watches) {
				if (w.status !== "waiting") continue;
				const after = watchOf(next, w.target);
				if (after?.status !== "asking") continue;
				if (!(msg.type === "retry_due" && msg.ref === refOf(w)))
					return `${w.target} asked again on ${msg.type}`;
			}
			return null;
		}),
	];
}

const aroundWatcher =
	(f: (s: Watcher, m: MonitorMsg) => ReturnType<WatcherStep> | null): WatcherStep =>
	(s, m) =>
		f(s, m) ?? watcherStep(s, m);

export const WATCHER_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: WatcherStep;
}[] = [
	{
		name: "reports every DOWN, so one death seen by two monitors twice",
		law: "no death is reported twice",
		update: aroundWatcher((s, m) => {
			if (m.type !== "down" || m.reason === "noproc" || m.rev <= s.monitors.cursor) return null;
			const [next, cmds] = watcherStep(s, m);
			const {type: _, rev: __, ...down} = m;
			return [{...next, last: {kind: "down", missed: 0, ...down}}, cmds];
		}),
	},
	{
		name: "OTP's monitor alone: no gap, deaths between a DOWN and the next monitor go unseen",
		law: "every death proved since watching began is reported",
		update: (s, m) => {
			const [next, cmds] = watcherStep(s, m);
			const last = next.last;
			if (last?.kind === "gap") return [{...next, last: null}, cmds];
			if (last?.kind === "down" && last.missed > 0)
				return [{...next, last: {...last, missed: 0}}, cmds];
			return [next, cmds];
		},
	},
	{
		name: "a monitor on j reports j ended too",
		law: "a report goes no further than its Msg proves",
		update: (s, m) => {
			const [next, cmds] = watcherStep(s, m);
			const last = next.last;
			return m.type === "monitored" && last?.kind === "gap"
				? [{...next, last: {...last, to: last.to + 1}}, cmds]
				: [next, cmds];
		},
	},
	{
		name: "a noproc counts as a death",
		law: "a noproc is never a death",
		update: aroundWatcher((s, m) => {
			if (m.type !== "down" || m.reason !== "noproc" || m.rev <= s.monitors.cursor) return null;
			const [next, cmds] = watcherStep(s, m);
			const {type: _, rev: __, ...down} = m;
			return [{...next, last: {kind: "down", missed: 0, ...down}}, cmds];
		}),
	},
	{
		name: "stops watching after a death",
		law: "after a death it monitors again, under a new ref",
		update: aroundWatcher((s, m) => {
			if (m.type !== "down" || m.reason === "noproc") return null;
			const [next] = watcherStep(s, m);
			return [next, []];
		}),
	},
	{
		name: "monitors again under the old ref",
		law: "every monitor carries the ref of a watch that is asking",
		update: aroundWatcher((s, m) => {
			if (m.type !== "down" || m.reason === "noproc") return null;
			const [next, cmds] = watcherStep(s, m);
			return [next, cmds.map((c) => ({...c, ref: m.ref}))];
		}),
	},
	{
		name: "reads an old DOWN again",
		law: "a DOWN at or behind the cursor changes nothing",
		update: aroundWatcher((s, m) =>
			m.type === "down" && m.rev <= s.monitors.cursor
				? watcherStep({...s, monitors: {...s.monitors, cursor: m.rev - 1}}, m)
				: null,
		),
	},
	{
		name: "resume forgets the monitors in flight",
		law: "resume sends every asking monitor again",
		update: aroundWatcher((s, m) => (m.type === "resume" ? [s, []] : null)),
	},
	{
		name: "99's fixed re-arm: a name that stays down is asked every retryMs",
		law: "a name that stays down is asked again later each time, up to maxRetryMs",
		update: (s, m) => {
			const r = monitorUpdate({retryMs: WATCH_RETRY.retryMs, maxRetryMs: WATCH_RETRY.retryMs})(
				s.monitors,
				m,
			);
			return [{monitors: r.monitors, last: r.outcome}, r.cmds];
		},
	},
	{
		name: "a stale retry asks again",
		law: "a waiting watch asks again only when its own retry is due",
		update: aroundWatcher((s, m) => {
			if (m.type !== "retry_due") return null;
			const w = s.monitors.watches.find(
				(x) => x.status === "waiting" && refOf({target: x.target, n: x.n - 1}) === m.ref,
			);
			return w === undefined ? null : watcherStep(s, {...m, ref: refOf(w)});
		}),
	},
];

// ---------------------------------------------------------------- the check

export interface Checked {
	readonly machine: string;
	readonly states: number;
	readonly complete: boolean;
	readonly ms: number;
	readonly laws: readonly string[];
	readonly broken: Readonly<Record<string, string>>;
	readonly planted: readonly {
		readonly name: string;
		readonly law: string;
		readonly caught: boolean;
		readonly path: string | null;
	}[];
}

const brokenOf = <M>(r: Report<M>, show: (m: M) => string) =>
	Object.fromEntries(r.broken.map((b) => [b.law, pathText(b.path, show)]));

export function checkHost(depth = 9): Checked {
	const laws = hostLaws();
	const update = stepOf<Host, HostMsg, HostCmd>(host);
	const r = explore({init: START, update, world: hostWorld(), laws, depth});
	return {
		machine: "host",
		states: r.states,
		complete: r.complete,
		ms: r.ms,
		laws: laws.map((l) => l.name),
		broken: brokenOf(r, showHostMsg),
		planted: HOST_PLANTED.map((p) => {
			const found = explore({
				init: START,
				update: p.update,
				world: hostWorld(),
				laws: hostLaws(p.view),
				depth,
			}).broken.find((b) => b.law === p.law);
			return {
				name: p.name,
				law: p.law,
				caught: found !== undefined,
				path: found === undefined ? null : pathText(found.path, showHostMsg),
			};
		}),
	};
}

/** One machine with no views to swap: its laws, then each plant against the law it should break. */
const checkOf = <S, M extends {readonly type: string}, C>(
	machine: string,
	init: S,
	update: Update<S, M, C>,
	world: () => World<S, M, C>,
	laws: () => readonly Law<S, M, C>[],
	planted: readonly {
		readonly name: string;
		readonly law: string;
		readonly update: Update<S, M, C>;
	}[],
	show: (m: M) => string,
	depth: number,
): Checked => {
	const r = explore({init, update, world: world(), laws: laws(), depth});
	return {
		machine,
		states: r.states,
		complete: r.complete,
		ms: r.ms,
		laws: laws().map((l) => l.name),
		broken: brokenOf(r, show),
		planted: planted.map((p) => {
			const found = explore({
				init,
				update: p.update,
				world: world(),
				laws: laws(),
				depth,
			}).broken.find((b) => b.law === p.law);
			return {
				name: p.name,
				law: p.law,
				caught: found !== undefined,
				path: found === undefined ? null : pathText(found.path, show),
			};
		}),
	};
};

const showMsg = (m: {readonly type: string}): string => {
	const {type, ...rest} = m;
	const args = Object.values(rest)
		.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)))
		.join(" ");
	return args === "" ? type : `${type} ${args}`;
};

/** The supervisor under each restart strategy, then each plant under the strategy it is for. */
export function checkSupervisor(depth = 5): Checked {
	const runs = STRATEGIES.map((strategy) => ({
		strategy,
		r: explore({
			init: NOT_BEGUN,
			update: supOf(supSpec(strategy)),
			world: supervisorWorld(),
			laws: supervisorLaws(strategy),
			depth,
		}),
	}));
	return {
		machine: "supervisor",
		states: runs.reduce((n, x) => n + x.r.states, 0),
		complete: runs.every((x) => x.r.complete),
		ms: runs.reduce((n, x) => n + x.r.ms, 0),
		laws: supervisorLaws("one_for_one").map((x) => x.name),
		broken: Object.fromEntries(
			runs.flatMap((x) =>
				x.r.broken.map((b) => [`${x.strategy}: ${b.law}`, pathText(b.path, showMsg)]),
			),
		),
		planted: SUPERVISOR_PLANTED.map((p) => {
			const found = explore({
				init: NOT_BEGUN,
				update: p.update,
				world: supervisorWorld(),
				laws: supervisorLaws(p.strategy),
				depth,
			}).broken.find((b) => b.law === p.law);
			return {
				name: `${p.name} (${p.strategy})`,
				law: p.law,
				caught: found !== undefined,
				path: found === undefined ? null : pathText(found.path, showMsg),
			};
		}),
	};
}

export const checkMonitors = (depth = 6): Checked =>
	checkOf(
		"monitor",
		watcherInit,
		watcherStep,
		watcherWorld,
		watcherLaws,
		WATCHER_PLANTED,
		showMsg,
		depth,
	);

export function checkCalls(depth = 7): Checked {
	const laws = callerLaws();
	const r = explore({init: callerInit, update: callerStep, world: callerWorld(), laws, depth});
	return {
		machine: "call",
		states: r.states,
		complete: r.complete,
		ms: r.ms,
		laws: laws.map((l) => l.name),
		broken: brokenOf(r, showCallerMsg),
		planted: CALLER_PLANTED.map((p) => {
			const found = explore({
				init: callerInit,
				update: p.update,
				world: callerWorld(),
				laws: callerLaws(),
				depth,
			}).broken.find((b) => b.law === p.law);
			return {
				name: p.name,
				law: p.law,
				caught: found !== undefined,
				path: found === undefined ? null : pathText(found.path, showCallerMsg),
			};
		}),
	};
}
