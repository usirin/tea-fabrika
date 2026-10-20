// The laws of the machines in packages/tea-host: the host's own loop (host-machine.ts), the call
// module (call.ts), the supervisor (supervisor.ts) and the monitor module (monitor.ts), walked by
// this repo's checker (./explore.ts): every Msg order up to a bound, through the real reducers,
// each law after every step, and each law seen to fail once on a planted mistake. They live here,
// not in the package, because the checker lives here and a package does not import wip.
//
// The host's laws are experiment 94's (experiments/94-tea-host/laws.ts), with the lease clock
// that is new in experiment 98 (three more laws and plants) and the exits, restarts and down
// phase that are new in experiment 99 (nine more laws, ten more plants).
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
	NOT_BEGUN,
	type SupervisorMsg,
	type SupervisorSpec,
	type SupervisorState,
	startsOf,
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

// ---------------------------------------------------------------- the supervisor (99)

// OTP's one_for_one supervisor, walked through its real reducer. Its starts and its give-up are
// Subs read off the state (`startsOf`, `phase`), so the world answers a start with `started` or
// `start_refused` whenever one is in flight, in any order, as often as it likes.

const SUP = "s";
const SUP_SPEC: SupervisorSpec = {
	strategy: "one_for_one",
	intensity: 1,
	periodMs: 100,
	maxDeliveries: null,
	children: [
		{name: "a", restart: "permanent"},
		{name: "b", restart: "transient"},
		{name: "t", restart: "temporary"},
	],
};
/** Two EXIT times inside one period, and one past it. */
const ATS = [0, 50, 150] as const;
type SupStep = Update<SupervisorState, SupervisorMsg, never>;
const supReal = superviseWith(SUP, SUP_SPEC);
const supStep: SupStep = (s, m) => [supReal(s, m), []];

export function supervisorWorld(): World<SupervisorState, SupervisorMsg, never> {
	return {
		outside: (s) => {
			const rev = s.cursor + 1;
			const exits = s.children.flatMap((c): SupervisorMsg[] => {
				const inc = Math.max(1, c.incarnation);
				return [
					...ATS.map(
						(at): SupervisorMsg => ({
							type: "exit",
							rev,
							from: c.name,
							incarnation: inc,
							reason: "crash",
							why: "x",
							at,
						}),
					),
					{type: "exit", rev, from: c.name, incarnation: inc, reason: "normal", why: "x", at: 50},
					...(c.incarnation > 1
						? [
								{
									type: "exit" as const,
									rev,
									from: c.name,
									incarnation: c.incarnation - 1,
									reason: "crash" as const,
									why: "old",
									at: 50,
								},
							]
						: []),
				];
			});
			const starts = startsOf(s).flatMap((p): SupervisorMsg[] => [
				{type: "started", name: p.name, incarnation: (p.after ?? 0) + 1},
				{type: "started", name: p.name, incarnation: (p.after ?? 0) + 2},
				{type: "start_refused", name: p.name},
			]);
			return [
				{type: "begin", incarnation: 1, parent: "p"},
				{type: "begin", incarnation: 2, parent: "p"},
				...exits,
				...starts,
				{type: "exit", rev, from: "p", incarnation: 1, reason: "shutdown", why: "parent", at: 50},
				{type: "exit", rev, from: "x", incarnation: 1, reason: "crash", why: "stranger", at: 50},
				...(s.cursor > 0
					? [
							{
								type: "exit" as const,
								rev: s.cursor,
								from: "a",
								incarnation: 9,
								reason: "crash" as const,
								why: "again",
								at: 50,
							},
						]
					: []),
				{type: "start_child", rev, name: "d", restart: "permanent"},
				{type: "ignored", rev},
			];
		},
		answers: () => [],
	};
}

const childOf = (s: SupervisorState, name: string) => s.children.find((c) => c.name === name);
/** The restart type the spec gives a child (the laws' truth, not the state's); `d` is added permanent. */
const specRestart = (name: string) =>
	SUP_SPEC.children.find((c) => c.name === name)?.restart ?? "permanent";
const startOf = (s: SupervisorState, name: string) => startsOf(s).find((p) => p.name === name);
/** A start that `next` has and `prev` did not (or had for another incarnation). */
const newStart = (prev: SupervisorState, next: SupervisorState, name: string) => {
	const a = startOf(prev, name);
	const b = startOf(next, name);
	return b !== undefined && (a === undefined || a.after !== b.after) ? b : undefined;
};
const windowOf = (s: SupervisorState, at: number) =>
	s.restarts.filter((t) => t > at - SUP_SPEC.periodMs);
/** An EXIT the reducer must act on: past the cursor, from a child it knows, not stale, none in flight. */
const freshExit = (s: SupervisorState, m: SupervisorMsg) => {
	if (m.type !== "exit" || m.rev <= s.cursor || s.phase !== "running") return null;
	const c = childOf(s, m.from);
	if (c === undefined || c.gone || c.start !== null || m.incarnation < c.incarnation) return null;
	return {c, m};
};

export function supervisorLaws(): readonly Law<SupervisorState, SupervisorMsg, never>[] {
	type L = Law<SupervisorState, SupervisorMsg, never>;
	const l = (
		name: string,
		check: Parameters<typeof law<SupervisorState, SupervisorMsg, never>>[1],
	): L => law<SupervisorState, SupervisorMsg, never>(name, check);
	return [
		l("it never restarts more than its intensity within one period", ({prev, msg, next}) => {
			if (msg.type !== "exit" && msg.type !== "started") return null;
			const restarted = next.restarted > prev.restarted;
			if (!restarted) return null;
			const at = next.restarts.at(-1) ?? 0;
			const n = windowOf(next, at).length;
			return n <= SUP_SPEC.intensity ? null : `${n} restarts within ${SUP_SPEC.periodMs} ms`;
		}),
		l("it gives up only past its intensity, or when its parent exits", ({prev, msg, next}) => {
			if (prev.phase !== "running" || next.phase !== "shutdown") return null;
			if (msg.type === "exit" && msg.from === prev.parent) return null;
			const at =
				msg.type === "exit"
					? msg.at
					: (childOf(prev, msg.type === "started" ? msg.name : "")?.held?.at ?? null);
			if (at === null) return `gave up on ${msg.type}`;
			const n = windowOf(prev, at).length + 1;
			return n > SUP_SPEC.intensity
				? null
				: `gave up at ${n} restarts, intensity ${SUP_SPEC.intensity}`;
		}),
		l("a parent's EXIT shuts it down", ({prev, msg, next}) =>
			freshParent(prev, msg) && next.phase !== "shutdown"
				? `parent exited and it is ${next.phase}`
				: null,
		),
		l("after it gives up nothing starts, until a new incarnation", ({prev, msg, next}) => {
			// Read the children, not only `startsOf`: a start left in the state would run again the
			// moment anything reads it without the phase gate.
			if (next.phase === "shutdown" && next.children.some((c) => c.start !== null))
				return "a start is in flight after giving up";
			if (prev.phase === "shutdown" && next.phase === "running")
				return msg.type === "begin" && msg.incarnation !== prev.incarnation
					? null
					: `woke on ${msg.type}`;
			return null;
		}),
		l("a temporary child is never started again", ({prev, msg, next}) => {
			if (msg.type === "begin" || msg.type === "start_child") return null;
			const again = next.children.find(
				(c) => specRestart(c.name) === "temporary" && newStart(prev, next, c.name),
			);
			return again === undefined ? null : `temporary ${again.name} started again on ${msg.type}`;
		}),
		l("a transient child is started again only after a crash", ({prev, msg, next}) => {
			const why =
				msg.type === "exit"
					? {name: msg.from, reason: msg.reason}
					: msg.type === "started"
						? {name: msg.name, reason: childOf(prev, msg.name)?.held?.reason ?? "crash"}
						: null;
			return why !== null &&
				why.reason !== "crash" &&
				specRestart(why.name) === "transient" &&
				newStart(prev, next, why.name)
				? `transient ${why.name} started again after ${why.reason}`
				: null;
		}),
		l("a permanent child's exit starts it again, within intensity", ({prev, msg, next}) => {
			const f = freshExit(prev, msg);
			if (f === null || specRestart(f.c.name) !== "permanent" || next.phase !== "running")
				return null;
			const s = startOf(next, f.c.name);
			return s?.after === f.m.incarnation
				? null
				: `${f.c.name} exited at ${f.m.incarnation} and was not started again`;
		}),
		l("every new start names the incarnation it replaces", ({prev, msg, next}) => {
			for (const c of next.children) {
				const s = newStart(prev, next, c.name);
				if (s === undefined) continue;
				const ok =
					(msg.type === "begin" && s.after === null) ||
					(msg.type === "start_child" && s.after === null && msg.name === c.name) ||
					(msg.type === "exit" && msg.from === c.name && s.after === msg.incarnation) ||
					(msg.type === "started" && msg.name === c.name && s.after === msg.incarnation);
				if (!ok) return `${c.name} starts after ${s.after} on ${msg.type}`;
			}
			return null;
		}),
		l("a stale EXIT changes nothing but the cursor", ({prev, msg, next}) => {
			if (msg.type !== "exit" || msg.rev <= prev.cursor) return null;
			const c = childOf(prev, msg.from);
			if (c === undefined || msg.incarnation >= c.incarnation) return null;
			return JSON.stringify({...next, cursor: 0}) === JSON.stringify({...prev, cursor: 0})
				? null
				: `EXIT of ${msg.from} incarnation ${msg.incarnation} (known ${c.incarnation}) changed the state`;
		}),
		l("a message at or behind the cursor changes nothing", ({prev, msg, next}) =>
			"rev" in msg && msg.rev <= prev.cursor && next !== prev
				? `${msg.type} at rev ${msg.rev} changed the state`
				: null,
		),
		l("a new incarnation starts every child from the spec", ({prev, msg, next}) => {
			if (msg.type !== "begin" || msg.incarnation === prev.incarnation) return null;
			const want = SUP_SPEC.children.map((c) => `${c.name}:null`).join();
			const got = startsOf(next)
				.map((p) => `${p.name}:${p.after}`)
				.join();
			return want === got && next.restarts.length === 0
				? null
				: `started ${got}, restarts ${next.restarts.length}`;
		}),
	];
}
const freshParent = (s: SupervisorState, m: SupervisorMsg) =>
	m.type === "exit" && m.rev > s.cursor && s.phase === "running" && m.from === s.parent;

const aroundSup =
	(f: (s: SupervisorState, m: SupervisorMsg) => SupervisorState | null): SupStep =>
	(s, m) => [f(s, m) ?? supReal(s, m), []];

export const SUPERVISOR_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: SupStep;
}[] = [
	{
		name: "counts restarts forever, never over a period",
		law: "it gives up only past its intensity, or when its parent exits",
		update: aroundSup((s, m) => {
			const next = superviseWith(SUP, {...SUP_SPEC, periodMs: 1_000_000})(s, m);
			return next.phase === "shutdown" && s.phase === "running" && !freshParent(s, m) ? next : null;
		}),
	},
	{
		name: "no brake: restarts past its intensity",
		law: "it never restarts more than its intensity within one period",
		update: (s, m) => [superviseWith(SUP, {...SUP_SPEC, intensity: 99})(s, m), []],
	},
	{
		name: "ignores its parent's EXIT",
		law: "a parent's EXIT shuts it down",
		update: aroundSup((s, m) =>
			freshParent(s, m) && m.type === "exit" ? {...s, cursor: m.rev} : null,
		),
	},
	{
		name: "starts children after giving up",
		law: "after it gives up nothing starts, until a new incarnation",
		update: aroundSup((s, m) => {
			const next = supReal(s, m);
			return next.phase === "shutdown"
				? {...next, children: next.children.map((c) => ({...c, start: {after: c.incarnation}}))}
				: null;
		}),
	},
	{
		name: "a temporary child is restarted like a permanent one",
		law: "a temporary child is never started again",
		update: (s, m) => [
			superviseWith(SUP, {
				...SUP_SPEC,
				children: SUP_SPEC.children.map((c) => ({...c, restart: "permanent" as const})),
			})(s, m),
			[],
		],
	},
	{
		name: "a transient child is restarted after a clean exit",
		law: "a transient child is started again only after a crash",
		update: aroundSup((s, m) =>
			m.type === "exit" && m.reason !== "crash" ? supReal(s, {...m, reason: "crash"}) : null,
		),
	},
	{
		name: "a permanent child is let go after a normal exit",
		law: "a permanent child's exit starts it again, within intensity",
		update: (s, m) => [
			superviseWith(SUP, {
				...SUP_SPEC,
				children: SUP_SPEC.children.map((c) =>
					c.restart === "permanent" ? {...c, restart: "transient" as const} : c,
				),
			})(s, m),
			[],
		],
	},
	{
		name: "a restart names no incarnation",
		law: "every new start names the incarnation it replaces",
		update: aroundSup((s, m) => {
			if (m.type !== "exit") return null;
			const next = supReal(s, m);
			return {
				...next,
				children: next.children.map((c) =>
					c.start?.after === m.incarnation ? {...c, start: {after: null}} : c,
				),
			};
		}),
	},
	{
		name: "a stale EXIT restarts the child",
		law: "a stale EXIT changes nothing but the cursor",
		update: aroundSup((s, m) => {
			if (m.type !== "exit" || m.rev <= s.cursor) return null;
			const c = childOf(s, m.from);
			if (c === undefined || m.incarnation >= c.incarnation || c.start !== null) return null;
			return supReal(
				{...s, children: s.children.map((x) => (x === c ? {...c, incarnation: m.incarnation} : x))},
				m,
			);
		}),
	},
	{
		name: "reads an old EXIT again",
		law: "a message at or behind the cursor changes nothing",
		update: aroundSup((s, m) =>
			m.type === "exit" && m.rev <= s.cursor ? supReal({...s, cursor: m.rev - 1}, m) : null,
		),
	},
	{
		name: "a restart of the supervisor keeps the old restart list",
		law: "a new incarnation starts every child from the spec",
		update: aroundSup((s, m) => {
			if (m.type !== "begin" || m.incarnation === s.incarnation) return null;
			return {...supReal(s, m), restarts: s.restarts.length > 0 ? s.restarts : [0]};
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
const monitorsUpdate = monitorUpdate({retryMs: 50});
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
	const args = Object.values(rest).join(" ");
	return args === "" ? type : `${type} ${args}`;
};

export const checkSupervisor = (depth = 5): Checked =>
	checkOf(
		"supervisor",
		NOT_BEGUN,
		supStep,
		supervisorWorld,
		supervisorLaws,
		SUPERVISOR_PLANTED,
		showMsg,
		depth,
	);

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
