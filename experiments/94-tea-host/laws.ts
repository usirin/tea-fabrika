// The laws of experiment 94's two machines, walked by the repo's checker
// (wip/src/laws/explore.ts): every Msg order up to a bound, through the real reducers, each law
// after every step, and each law seen to fail once on a planted mistake.
//
// The host machine's world: claims answered won (fence 1 or 2), held, or failed; renews
// answered renewed, lost, or no answer; the registry tail showing any claim or expiry, stray ones
// included; the program saying it started or ended under any fence, late ones included.
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
} from "@kampus/pipeline/laws/explore";
import {type Count, type CounterMsg, counter, ZERO} from "./counter.ts";
import {
	createHost,
	type Host,
	type HostCmd,
	type HostMsg,
	hostUpdate,
	losesLease,
	programOf,
	renewClockOf,
	type Settings,
	START,
} from "./host-machine.ts";

const SETTINGS: Settings = {renewEveryMs: 300, retryMs: 50};
const host = createHost(SETTINGS);

/** How the laws see a host's Subs: the same functions the machine's `subs` call. */
export interface View {
	readonly program: (s: Host) => {readonly fence: number} | null;
	readonly renewing: (s: Host) => boolean;
}
const VIEW: View = {
	program: programOf,
	renewing: (s) => renewClockOf(s, SETTINGS.renewEveryMs) !== null,
};

const FENCES = [1, 2] as const;

export function hostWorld(): World<Host, HostMsg, HostCmd> {
	return {
		outside: (s) => [
			...(s.phase === "watching" ? [{type: "claim_due" as const, tries: s.tries}] : []),
			...(s.phase === "owning"
				? [{type: "renew_due" as const, fence: s.fence, tick: s.ticks}]
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
						...FENCES.map((fence): HostMsg => ({type: "claimed", fence})),
						{type: "held", waitMs: 400},
						{type: "claim_failed"},
					]
				: [
						{type: "renewed", fence: cmd.fence},
						{type: "renew_lost", fence: cmd.fence},
						{type: "renew_unknown", fence: cmd.fence},
					],
	};
}

const fenceOf = (m: HostMsg): number | null => ("fence" in m ? m.fence : null);

export function hostLaws(view: View = VIEW): readonly Law<Host, HostMsg, HostCmd>[] {
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
			if (prev.phase !== "owning" || !losesLease(prev.fence, msg)) return null;
			return view.program(next) === null
				? null
				: `after ${msg.type} ${fenceOf(msg)} the program still runs under fence ${prev.fence}`;
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

// ---------------------------------------------------------------- planted mistakes

const real = hostUpdate(SETTINGS);
type HostStep = Update<Host, HostMsg, HostCmd>;

/** Told someone holds it, it runs the program anyway, under the last fence it heard of. */
const startsUnclaimed: HostStep = (s, m) =>
	s.phase === "claiming" && m.type === "held"
		? [{phase: "owning", fence: 1, started: false, ticks: 0}, []]
		: real(s, m);
/** A renew that says `lost` is ignored. */
const keepsRunningWhenLost: HostStep = (s, m) => (m.type === "renew_lost" ? [s, []] : real(s, m));
/** It renews the first fence it ever held. */
const renewsTheFirstFence: HostStep = (s, m) =>
	s.phase === "owning" && m.type === "renew_due" && m.fence === s.fence && m.tick === s.ticks
		? [{...s, ticks: s.ticks + 1}, [{type: "renew", fence: 1}]]
		: real(s, m);
/** It sees any expiry in the tail as its cue, owning or not. */
const claimsWhileOwning: HostStep = (s, m) =>
	s.phase === "owning" && m.type === "seen_expiry" && m.fence !== s.fence
		? [s, [{type: "claim"}]]
		: real(s, m);
/** A `lost` about any fence stops the owner. */
const staleWordStops: HostStep = (s, m) =>
	s.phase === "owning" && m.type === "renew_lost"
		? [{phase: "watching", waitMs: SETTINGS.retryMs, tries: 0}, []]
		: real(s, m);
/** The renew clock waits for the program to say it started (a long replay loses the lease). */
const renewsAfterStart: View = {
	program: programOf,
	renewing: (s) => s.phase === "owning" && s.started,
};

export const HOST_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: HostStep;
	readonly view?: View;
}[] = [
	{
		name: "starts unclaimed",
		law: "the program runs only under the claim this host won last",
		update: startsUnclaimed,
	},
	{
		name: "keeps running when lost",
		law: "losing the lease stops the program",
		update: keepsRunningWhenLost,
	},
	{
		name: "renews the first fence",
		law: "it renews only the fence it holds",
		update: renewsTheFirstFence,
	},
	{
		name: "claims while owning",
		law: "it claims only while it holds nothing",
		update: claimsWhileOwning,
	},
	{
		name: "stale word stops",
		law: "word about another fence changes nothing",
		update: staleWordStops,
	},
	{
		name: "renews after start",
		law: "while the program runs, the lease is renewed",
		update: real,
		view: renewsAfterStart,
	},
];

// ---------------------------------------------------------------- the counter

type CounterCmd = never;
const counterStep = stepOf<Count, CounterMsg, CounterCmd>(counter);

export function counterWorld(): World<Count, CounterMsg, CounterCmd> {
	return {
		outside: () =>
			[1, 2, 3].flatMap((rev) =>
				["a", "b"].map((id): CounterMsg => ({type: "increment", id, rev})),
			),
		answers: () => [],
	};
}

export function counterLaws(): readonly Law<Count, CounterMsg, CounterCmd>[] {
	return [
		law<Count, CounterMsg, CounterCmd>("the cursor never goes back", ({prev, next}) =>
			next.cursor < prev.cursor ? `cursor ${prev.cursor} went back to ${next.cursor}` : null,
		),
		law<Count, CounterMsg, CounterCmd>(
			"a message at or behind the cursor changes nothing",
			({prev, msg, next}) =>
				msg.rev <= prev.cursor && next !== prev
					? `rev ${msg.rev} at cursor ${prev.cursor} changed the count to ${next.count}`
					: null,
		),
		law<Count, CounterMsg, CounterCmd>(
			"each message counts once, exactly when it moves the cursor",
			({prev, next}) => {
				const added = next.count - prev.count;
				const moved = next.cursor > prev.cursor;
				return added === (moved ? 1 : 0) ? null : `count +${added}, cursor moved: ${moved}`;
			},
		),
		law<Count, CounterMsg, CounterCmd>(
			"the state names the message counted last",
			({prev, msg, next}) =>
				next.count > prev.count && next.last !== msg.id
					? `counted ${msg.id} and names ${next.last}`
					: null,
		),
	];
}

const countsRepeats: Update<Count, CounterMsg, CounterCmd> = (s, m) =>
	m.rev <= s.cursor ? [{...s, count: s.count + 1}, []] : counterStep(s, m);
const cursorFollows: Update<Count, CounterMsg, CounterCmd> = (s, m) =>
	m.rev <= s.cursor ? [{...s, cursor: m.rev}, []] : counterStep(s, m);
const countsTwice: Update<Count, CounterMsg, CounterCmd> = (s, m) =>
	m.rev > s.cursor ? [{count: s.count + 2, cursor: m.rev, last: m.id}, []] : counterStep(s, m);
const namesTheFirst: Update<Count, CounterMsg, CounterCmd> = (s, m) =>
	m.rev > s.cursor
		? [{count: s.count + 1, cursor: m.rev, last: s.last ?? m.id}, []]
		: counterStep(s, m);

export const COUNTER_PLANTED = [
	{
		name: "counts repeats",
		law: "a message at or behind the cursor changes nothing",
		update: countsRepeats,
	},
	{name: "cursor follows", law: "the cursor never goes back", update: cursorFollows},
	{
		name: "counts twice",
		law: "each message counts once, exactly when it moves the cursor",
		update: countsTwice,
	},
	{name: "names the first", law: "the state names the message counted last", update: namesTheFirst},
] as const;

// ---------------------------------------------------------------- the check

export interface LawsResult {
	readonly machine: string;
	readonly states: number;
	readonly complete: boolean;
	readonly ms: number;
	readonly sent: readonly string[];
	readonly unsent: readonly string[];
	readonly broken: Readonly<Record<string, string>>;
	readonly laws: readonly string[];
	/** Each planted mistake: the law it should break, and whether it did, with the shortest path. */
	readonly planted: readonly {
		readonly name: string;
		readonly law: string;
		readonly caught: boolean;
		readonly path: string | null;
	}[];
}

const summary = <M>(
	machine: string,
	r: Report<M>,
	alphabet: readonly string[],
	laws: readonly string[],
	show: (m: M) => string,
) => ({
	machine,
	states: r.states,
	complete: r.complete,
	ms: r.ms,
	sent: r.sent,
	unsent: alphabet.filter((t) => !r.sent.includes(t)),
	broken: Object.fromEntries(r.broken.map((b) => [b.law, pathText(b.path, show)])),
	laws,
});

const HOST_TYPES = Object.keys(host.update).sort();

export function checkHost(depth = 10): LawsResult {
	const laws = hostLaws();
	const r = explore({
		init: START,
		update: stepOf<Host, HostMsg, HostCmd>(host),
		world: hostWorld(),
		laws,
		depth,
	});
	const planted = HOST_PLANTED.map((p) => {
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
	});
	return {
		...summary(
			"host",
			r,
			HOST_TYPES,
			laws.map((l) => l.name),
			showHostMsg,
		),
		planted,
	};
}

const showCounterMsg = (m: CounterMsg) => `increment ${m.id} ${m.rev}`;

export function checkCounter(depth = 6): LawsResult {
	const laws = counterLaws();
	const r = explore({init: ZERO, update: counterStep, world: counterWorld(), laws, depth});
	const planted = COUNTER_PLANTED.map((p) => {
		const found = explore({
			init: ZERO,
			update: p.update,
			world: counterWorld(),
			laws: counterLaws(),
			depth,
		}).broken.find((b) => b.law === p.law);
		return {
			name: p.name,
			law: p.law,
			caught: found !== undefined,
			path: found === undefined ? null : pathText(found.path, showCounterMsg),
		};
	});
	return {
		...summary(
			"counter",
			r,
			["increment"],
			laws.map((l) => l.name),
			showCounterMsg,
		),
		planted,
	};
}
