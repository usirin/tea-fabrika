// The laws of the two machines in packages/tea-host: the host's own loop (host-machine.ts) and
// the call module (call.ts), walked by this repo's checker (./explore.ts): every Msg order up to a
// bound, through the real reducers, each law after every step, and each law seen to fail once on a
// planted mistake. They live here, not in the package, because the checker lives here and a
// package does not import wip.
//
// The host's laws are experiment 94's (experiments/94-tea-host/laws.ts), with the lease clock
// that is new in experiment 98: three more laws and three more plants.
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
	programOf,
	renewClockOf,
	START,
} from "@tea-fabrika/tea-host/host";
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
	readonly program: (s: Host) => {readonly fence: number} | null;
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

export function hostWorld(): World<Host, HostMsg, HostCmd> {
	return {
		outside: (s) => [
			...(s.phase === "watching" ? [{type: "claim_due" as const, tries: s.tries}] : []),
			...(s.phase === "owning"
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
				{type: "program_ended", fence, how: "failed"},
			]),
			{type: "seen_claim", fence: 3},
		],
		answers: (cmd) =>
			cmd.type === "claim"
				? [
						...FENCES.map((fence): HostMsg => ({type: "claimed", fence, until: CLAIMED_UNTIL})),
						{type: "held", waitMs: 400},
						{type: "claim_failed"},
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
			const bad = cmds.find(
				(c) => c.type === "renew" && (prev.phase !== "owning" || c.fence !== prev.fence),
			);
			return bad === undefined
				? null
				: `renews fence ${bad.type === "renew" ? bad.fence : "?"} while ${prev.phase === "owning" ? `holding ${prev.fence}` : prev.phase}`;
		}),
		law<Host, HostMsg, HostCmd>("it claims only while it holds nothing", ({prev, cmds}) =>
			prev.phase === "owning" && cmds.some((c) => c.type === "claim")
				? `claims while holding fence ${prev.fence}`
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
				? [{phase: "owning", fence: 1, until: CLAIMED_UNTIL, started: false, ticks: 0}, []]
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
		law: "it claims only while it holds nothing",
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
