import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	deliver,
	drop,
	greet,
	type Link,
	type LinkCmd,
	type LinkCtx,
	linkMachine,
	refuse,
} from "./link.ts";

// The laws of the link's handshake (link.ts), on tea's pbt: after every step of any list of what
// the other side may do, from the real init, on the host's side and on the app's. The other side
// may greet with any version, greet twice, talk before its hello, send a line that does not read,
// or hang up, in any order.

type Machine = typeof linkMachine;
type Msg = MsgOf<Machine>;
type LinkStep = Step<Link, Msg, LinkCmd>;

const OURS = 1;
const SIDES: readonly LinkCtx[] = [
	{side: "host", ours: OURS},
	{side: "app", ours: OURS},
];

/** A Cmd's failed answer. The link's Cmds declare no errors, so a malformed answer is the one left. */
const failed = <T extends string, C>(type: T, cmd: C) =>
	fc.constant({type, cmd, error: {_tag: "malformed_result", issues: []} as const, at: 0});
const [greeting, delivering, refusing, dropping] = [
	greet({version: OURS}),
	deliver({m: null}),
	refuse({theirs: 0, ours: OURS}),
	drop({why: "x"}),
] as const;

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	hello: arbRecordMsg("hello", {
		version: fc.oneof({arbitrary: fc.constant(OURS), weight: 3}, fc.constantFrom(0, 2)),
	}),
	line: arbRecordMsg("line", {
		m: fc.constantFrom({type: "page"}, {type: "port", port: "tile:t1"}, {type: "away"}),
	}),
	bad: arbRecordMsg("bad", {why: fc.constantFrom("not JSON", "no such type")}),
	ended: arbRecordMsg("ended", {why: fc.constantFrom("the socket closed", "EPIPE")}),
	greet_ok: fc.constant(greet.ok(greeting, null, 0)),
	greet_err: failed(greet.errType, greeting),
	deliver_ok: fc.constant(deliver.ok(delivering, null, 0)),
	deliver_err: failed(deliver.errType, delivering),
	refuse_ok: fc.constant(refuse.ok(refusing, null, 0)),
	refuse_err: failed(refuse.errType, refusing),
	drop_ok: fc.constant(drop.ok(dropping, null, 0)),
	drop_err: failed(drop.errType, dropping),
};
/** Mostly hellos and lines, so most lists come up before they end. */
const lists = fc.array(arbMsg(table, {weights: {hello: 4, line: 4, bad: 1, ended: 1}}), {
	maxLength: 16,
	size: "max",
});
const OPTS = {numRuns: 300, seed: 1};

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

/** A law over each step, on both sides of the link. */
const everyStep = (name: string, holds: (step: LinkStep) => boolean): Law => ({
	name,
	check: (machine) => {
		for (const ctx of SIDES) propertyInvariant(machine, ctx, lists, holds, OPTS);
	},
});

const over = (s: Link) => s.at === "refused" || s.at === "closed";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- never wrong

const overStays = everyStep(
	"once refused or closed, it stays as it is and says nothing",
	({prev, next, cmds}) => !over(prev) || (same(next, prev) && cmds.length === 0),
);

const keepsCtx = everyStep(
	"it always keeps its side and the version it speaks",
	({prev, next}) => next.side === prev.side && next.ours === prev.ours && next.ours === OURS,
);

const upOnlyEqual = everyStep(
	"it is up only after a hello in the version it speaks",
	({prev, msg, next}) =>
		next.at !== "up" || prev.at === "up" || (msg.type === "hello" && msg.version === next.ours),
);

const deliversOnlyUp = everyStep(
	"a line is handed on only while the link is up, and as it came",
	({prev, msg, next, cmds}) => {
		const handed = cmds.filter((c) => c.type === "deliver");
		if (handed.length === 0) return true;
		return (
			prev.at === "up" &&
			next.at === "up" &&
			msg.type === "line" &&
			same(handed, [deliver({m: msg.m})])
		);
	},
);

const neverSpeaksFirst = everyStep(
	"the host never greets unasked: it greets once, in answer to the first hello",
	({prev, msg, cmds}) =>
		cmds.every((c) => c.type !== "greet") ||
		(prev.side === "host" && prev.at === "hello" && msg.type === "hello"),
);

// ---------------------------------------------------------------- something good

const appGreets: Law = {
	name: "the app greets first, with the version it speaks; the host waits to be greeted",
	check: (machine) => {
		const [app, appSays] = machine.init(null, {side: "app", ours: OURS});
		const [host, hostSays] = machine.init(null, {side: "host", ours: OURS});
		if (app.at !== "hello" || !same(appSays, [greet({version: OURS})]))
			throw new Error(`the app starts ${JSON.stringify([app, appSays])}`);
		if (host.at !== "hello" || hostSays.length > 0)
			throw new Error(`the host starts ${JSON.stringify([host, hostSays])}`);
	},
};

const hostAnswers = everyStep(
	"the host answers the first hello with its own version, right or wrong",
	({prev, msg, cmds}) =>
		prev.side !== "host" ||
		prev.at !== "hello" ||
		msg.type !== "hello" ||
		same(cmds[0], greet({version: prev.ours})),
);

const comesUp = everyStep(
	"a hello in its own version, while it waits for one, brings the link up",
	({prev, msg, next}) =>
		prev.at !== "hello" || msg.type !== "hello" || msg.version !== prev.ours || next.at === "up",
);

const refusesOther = everyStep(
	"a hello in another version, while it waits for one, is refused plainly and the socket closed",
	({prev, msg, next, cmds}) => {
		if (prev.at !== "hello" || msg.type !== "hello" || msg.version === prev.ours) return true;
		const types = cmds.map((c) => c.type);
		return (
			next.at === "refused" &&
			next.theirs === msg.version &&
			cmds.some((c) => same(c, refuse({theirs: msg.version, ours: prev.ours}))) &&
			types.indexOf("refuse") < types.indexOf("drop")
		);
	},
);

const deliversLines = everyStep(
	"while the link is up, every line is handed on",
	({prev, msg, next, cmds}) =>
		prev.at !== "up" ||
		msg.type !== "line" ||
		(next.at === "up" && same(cmds, [deliver({m: msg.m})])),
);

const closesSocket = everyStep(
	"a link it closes itself, for a bad line or a line out of turn, has its socket closed; a hang-up closes it with nothing to say",
	({prev, msg, next, cmds}) => {
		if (over(prev) || next.at !== "closed") return true;
		if (msg.type === "ended") return cmds.length === 0 && next.why === msg.why;
		return same(cmds, [drop({why: next.why})]);
	},
);

const LAWS = [
	overStays,
	keepsCtx,
	upOnlyEqual,
	deliversOnlyUp,
	neverSpeaksFirst,
	appGreets,
	hostAnswers,
	comesUp,
	refusesOther,
	deliversLines,
	closesSocket,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = linkMachine.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...linkMachine,
	update: {...real, ...update},
});
const ctxOf = (s: Link): LinkCtx => ({side: s.side, ours: s.ours});

const PLANTS = {
	/** A hello after the link closed opens it again. */
	opensAgain: plant({
		hello: (s, m) => (s.at === "closed" ? [{...ctxOf(s), at: "up"}, []] : real.hello(s, m)),
	}),
	/** A refused link takes on the other side's version. */
	takesTheirVersion: plant({
		hello: (s, m) => {
			const [next, cmds] = real.hello(s, m);
			return [s.at === "hello" && next.at === "refused" ? {...next, ours: m.version} : next, cmds];
		},
	}),
	/** Any version brings the link up. */
	upForAny: plant({
		hello: (s, m) => (s.at === "hello" ? real.hello(s, {...m, version: s.ours}) : real.hello(s, m)),
	}),
	/** A line before the hello is handed on. */
	talksBeforeHello: plant({
		line: (s, m) => (s.at === "hello" ? [s, [deliver({m: m.m})]] : real.line(s, m)),
	}),
	/** The first hello is greeted back on the app's side too. */
	greetsEveryHello: plant({
		hello: (s, m) => {
			const [next, cmds] = real.hello(s, m);
			return [
				next,
				s.at !== "hello" || cmds.some((c) => c.type === "greet")
					? cmds
					: [greet({version: s.ours}), ...cmds],
			];
		},
	}),
	/** The app waits to be greeted. */
	appWaits: {...linkMachine, init: (_loaded, ctx) => [{...ctx, at: "hello"}, []]},
	/** The host greets back only a hello in its own version. */
	hostQuietOnOther: plant({
		hello: (s, m) => {
			const [next, cmds] = real.hello(s, m);
			return [next, next.at === "refused" ? cmds.filter((c) => c.type !== "greet") : cmds];
		},
	}),
	/** A hello in its own version is taken for another. */
	refusesItsOwn: plant({
		hello: (s, m) =>
			s.at === "hello" ? real.hello(s, {...m, version: s.ours + 1}) : real.hello(s, m),
	}),
	/** Another version is refused, and the socket left open. */
	refusesQuietly: plant({
		hello: (s, m) => {
			const [next, cmds] = real.hello(s, m);
			return [next, next.at === "refused" ? cmds.filter((c) => c.type !== "drop") : cmds];
		},
	}),
	/** A line while up is dropped. */
	deafToLines: plant({line: (s, m) => (s.at === "up" ? [s, []] : real.line(s, m))}),
	/** A bad line closes the link and leaves the socket open. */
	badLeavesSocket: plant({
		bad: (s, m) => (over(s) ? [s, []] : [{...ctxOf(s), at: "closed", why: m.why}, []]),
	}),
} satisfies Record<string, Machine>;

describe("the link's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(linkMachine);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			opensAgain: [overStays.name, upOnlyEqual.name],
			takesTheirVersion: [keepsCtx.name],
			upForAny: [upOnlyEqual.name, refusesOther.name],
			talksBeforeHello: [deliversOnlyUp.name],
			greetsEveryHello: [neverSpeaksFirst.name],
			appWaits: [appGreets.name],
			hostQuietOnOther: [hostAnswers.name],
			refusesItsOwn: [comesUp.name, refusesOther.name],
			refusesQuietly: [refusesOther.name],
			deafToLines: [deliversLines.name],
			badLeavesSocket: [closesSocket.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
