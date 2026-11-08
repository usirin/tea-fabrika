import {applyCell} from "@demlik/tea";
// P19, next/. The local desktop machine's laws, on the real `desktopMachine` from its real `init`
// with tea's pbt (plan "The local machine" and "Laws"). Each law names its plant. Lists come two
// ways: `arbGuidedSequence`, whose answers match a Cmd the machine really sent, and
// `arbMsgSequence` over the whole Msg table, since a guided list drops every refused event and so
// cannot prove a refusal (plan "Laws").
//
// The machine's module is loaded per law, so a missing export fails that law alone.
import {
	arbGuidedSequence,
	arbMsgSequence,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";
import {syncTest} from "../testing.ts";
import {blankArb, foundingArb, nameArb, SEED} from "./desktop.test-support.ts";
import type * as Founding from "./founding.ts";

type Mod = typeof Founding;
type Msg = Founding.DesktopMsg;
type Model = typeof Founding.DesktopModel.Type;

const MODULE = "./founding.ts";
const load = async (): Promise<Mod> => {
	const mod: Partial<Mod> = await import(/* @vite-ignore */ MODULE).catch((cause: unknown) => {
		throw new Error(`P19 missing module desktop/founding.ts (${String(cause)})`);
	});
	for (const name of [
		"desktopMachine",
		"DesktopModel",
		"inspectHome",
		"foundHome",
		"startBrain",
		"stopBrain",
	] as const) {
		if (mod[name] === undefined)
			throw new Error(`P19 missing export ${name} from desktop/founding.ts`);
	}
	return mod as Mod;
};
const ctx = () => stubCtxThrowingProxy<Founding.DesktopContext>();
const RUNS = {seed: SEED, numRuns: 150};

const whys = {
	inspect: ["storage", "existing_data", "bad_home"],
	found: ["storage", "existing_data", "bad_home", "crypto", "seal_unavailable"],
	start: ["port_taken", "foreign_service", "launchctl", "startup"],
	stop: ["launchctl", "stop"],
} as const;

/** Every Msg case, each settled reply built from a Cmd the module's own constructors make. */
const table = (m: Mod): MsgArbitraryTable<Msg> => {
	const url = fc.constantFrom("http://127.0.0.1:4387", "http://127.0.0.1:51234");
	const founder = foundingArb.map((f) => Schema.decodeUnknownSync(m.Founding)(f));
	const home = fc.oneof(
		fc.constant(m.Home.cases.empty.make({})),
		founder.map((f) => m.Home.cases.ready.make({founder: f})),
	);
	return {
		opened: fc.constant({type: "opened"}),
		typed: fc.oneof(nameArb, blankArb).map((name) => ({type: "typed", name})),
		start: fc.constant({type: "start"}),
		retry: fc.constant({type: "retry"}),
		close: fc.constant({type: "close"}),
		activate: fc.constant({type: "activate"}),
		quit: fc.constant({type: "quit"}),
		desktop_inspect_ok: home.map((h) => m.inspectHome.ok(m.inspectHome({}), h)),
		desktop_inspect_err: fc
			.constantFrom(...whys.inspect)
			.map((why) => m.inspectHome.err(m.inspectHome({}), {_tag: why})),
		desktop_found_ok: fc
			.tuple(nameArb, founder)
			.map(([name, f]) => m.foundHome.ok(m.foundHome({name}), f)),
		desktop_found_err: fc
			.tuple(nameArb, fc.constantFrom(...whys.found))
			.map(([name, why]) => m.foundHome.err(m.foundHome({name}), {_tag: why})),
		desktop_start_brain_ok: fc
			.tuple(founder, url)
			.map(([f, u]) => m.startBrain.ok(m.startBrain(f), {url: u})),
		desktop_start_brain_err: fc
			.tuple(founder, fc.constantFrom(...whys.start))
			.map(([f, why]) => m.startBrain.err(m.startBrain(f), {_tag: why})),
		desktop_stop_brain_ok: fc.constant(m.stopBrain.ok(m.stopBrain({}), null)),
		desktop_stop_brain_err: fc
			.constantFrom(...whys.stop)
			.map((why) => m.stopBrain.err(m.stopBrain({}), {_tag: why})),
	} as MsgArbitraryTable<Msg>;
};

const raw = (m: Mod) =>
	arbMsgSequence(fc.oneof(...Object.values(table(m))), {maxLength: 40, size: "max"});

/** Outside events plus a success-or-failure answer to each Cmd really waiting. */
const guided = (m: Mod) => {
	const t = table(m);
	const founder = foundingArb.map((f) => Schema.decodeUnknownSync(m.Founding)(f));
	return arbGuidedSequence(
		m.desktopMachine,
		ctx(),
		{
			outside: {
				opened: t.opened,
				typed: t.typed,
				start: t.start,
				retry: t.retry,
				close: t.close,
				activate: t.activate,
				quit: t.quit,
			},
			answers: {
				desktop_inspect: {
					draw: fc.oneof(
						fc.constant({ok: true as const, ready: false as const, f: null}),
						founder.map((f) => ({ok: true as const, ready: true as const, f})),
						fc.constantFrom(...whys.inspect).map((why) => ({ok: false as const, why})),
					),
					make: (cmd, v) =>
						v.ok
							? m.inspectHome.ok(
									cmd,
									v.ready ? m.Home.cases.ready.make({founder: v.f}) : m.Home.cases.empty.make({}),
								)
							: m.inspectHome.err(cmd, {_tag: v.why}),
				},
				desktop_found: {
					draw: fc.oneof(
						founder.map((f) => ({ok: true as const, f})),
						fc.constantFrom(...whys.found).map((why) => ({ok: false as const, why})),
					),
					make: (cmd, v) => (v.ok ? m.foundHome.ok(cmd, v.f) : m.foundHome.err(cmd, {_tag: v.why})),
				},
				desktop_start_brain: {
					draw: fc.oneof(
						fc.constant({ok: true as const}),
						fc.constantFrom(...whys.start).map((why) => ({ok: false as const, why})),
					),
					make: (cmd, v) =>
						v.ok
							? m.startBrain.ok(cmd, {url: "http://127.0.0.1:4387"})
							: m.startBrain.err(cmd, {_tag: v.why}),
				},
				desktop_stop_brain: {
					draw: fc.oneof(
						fc.constant({ok: true as const}),
						fc.constantFrom(...whys.stop).map((why) => ({ok: false as const, why})),
					),
					make: (cmd, v) =>
						v.ok ? m.stopBrain.ok(cmd, null) : m.stopBrain.err(cmd, {_tag: v.why}),
				},
			},
		},
		{maxLength: 50},
	);
};

const cmdTypes = (cmds: ReadonlyArray<{readonly type: string}>) => cmds.map((c) => c.type);
const both = (m: Mod) => fc.oneof(raw(m), guided(m));

describe("P19 desktop machine: founding", () => {
	it("plant, Start first: Start counts only on the founding page, and a blank name stays there with a field error", async () => {
		const m = await load();
		propertyInvariant(
			m.desktopMachine,
			ctx(),
			both(m),
			({prev, msg, next, cmds}) => {
				if (msg.type !== "start") return true;
				if (prev._tag !== "founding")
					return cmds.length === 0 && JSON.stringify(next) === JSON.stringify(prev)
						? true
						: `Start in ${prev._tag} changed the model or sent ${cmdTypes(cmds)}`;
				if (prev.name.trim().length === 0)
					return next._tag === "founding" && next.error !== null && cmds.length === 0
						? true
						: "a blank name left the founding page or sent a Cmd";
				const found = cmds.filter((c) => c.type === "desktop_found");
				return found.length === 1 &&
					(found[0] as {name: string}).name.trim() === prev.name.trim() &&
					!cmdTypes(cmds).includes("desktop_start_brain")
					? true
					: `Start with a name sent ${cmdTypes(cmds)}`;
			},
			RUNS,
		);
	});

	it("plant, show founding over existing data: the founding page comes only from an empty home", async () => {
		const m = await load();
		propertyInvariant(
			m.desktopMachine,
			ctx(),
			both(m),
			({prev, msg, next}) =>
				next._tag !== "founding" ||
				prev._tag === "founding" ||
				(msg.type === "desktop_inspect_ok" && msg.value._tag === "empty") ||
				`${msg.type} moved ${prev._tag} to founding`,
			RUNS,
		);
	});

	it("plant, start before the keys are installed: the brain starts only with a founder a store answered", async () => {
		const m = await load();
		propertyTrace(
			m.desktopMachine,
			ctx(),
			guided(m),
			(steps, _final, initCmds) => {
				const known = new Set<string>();
				for (const c of initCmds)
					if (c.type === "desktop_start_brain") return "init started the brain";
				for (const {msg, cmds} of steps) {
					if (msg.type === "desktop_found_ok")
						known.add(JSON.stringify(Schema.encodeSync(m.Founding)(msg.value)));
					if (msg.type === "desktop_inspect_ok" && msg.value._tag === "ready")
						known.add(JSON.stringify(Schema.encodeSync(m.Founding)(msg.value.founder)));
					for (const c of cmds) {
						if (c.type !== "desktop_start_brain") continue;
						if (!known.has(JSON.stringify(Schema.encodeSync(m.Founding)(c))))
							return `${msg.type} started the brain for a founder no store answered`;
					}
				}
				return true;
			},
			RUNS,
		);
	});

	it("plant, generate on retry: a failed start keeps the identity, and Retry starts the same founder again", async () => {
		const m = await load();
		propertyInvariant(
			m.desktopMachine,
			ctx(),
			guided(m),
			({prev, msg, cmds}) => {
				if (cmdTypes(cmds).includes("desktop_found") && msg.type !== "start")
					return `${msg.type} in ${prev._tag} founded a new identity`;
				return true;
			},
			RUNS,
		);
		// A start failure, then Retry: the second start names the founder the first did.
		const isInspect = (c: {readonly type: string}): c is ReturnType<typeof m.inspectHome> =>
			c.type === "desktop_inspect";
		const isStart = (c: {readonly type: string}): c is ReturnType<typeof m.startBrain> =>
			c.type === "desktop_start_brain";
		fc.assert(
			fc.property(foundingArb, fc.constantFrom(...whys.start), (value, why) => {
				const founder = Schema.decodeUnknownSync(m.Founding)(value);
				const step = (s: Model, msg: Msg) =>
					applyCell<Model, Msg, Founding.DesktopCmd>(m.desktopMachine, s, msg);
				let [s, cmds] = m.desktopMachine.init(null, ctx());
				if (!cmds.some(isInspect)) [s, cmds] = step(s, {type: "opened"});
				const inspect = cmds.find(isInspect);
				expect(inspect, "opening the app inspects its home").toBeDefined();
				const [s1, c1] = step(s, m.inspectHome.ok(inspect!, m.Home.cases.ready.make({founder})));
				const first = c1.find(isStart);
				expect(first, "an existing home starts its brain").toBeDefined();
				const [s2] = step(s1, m.startBrain.err(first!, {_tag: why}));
				expect(s2._tag).toBe("blocked");
				const [, c3] = step(s2, {type: "retry"});
				expect(cmdTypes(c3)).toEqual(["desktop_start_brain"]);
				expect(c3[0]).toEqual(first);
			}),
			RUNS,
		);
	});
});

describe("P19 desktop machine: close, activate and Quit", () => {
	it("plant, quit on last window: Close and Activate never stop the brain", async () => {
		const m = await load();
		propertyInvariant(
			m.desktopMachine,
			ctx(),
			both(m),
			({prev, msg, next, cmds}) =>
				(msg.type !== "close" && msg.type !== "activate") ||
				(!cmdTypes(cmds).includes("desktop_stop_brain") &&
					(prev._tag !== "online" || next._tag === "online")) ||
				`${msg.type} in ${prev._tag} sent ${cmdTypes(cmds)} and moved to ${next._tag}`,
			RUNS,
		);
	});

	it("plant, ignore Cmd-Q or stop twice: Quit stops once, and never two stops at a time", async () => {
		const m = await load();
		propertyTrace(
			m.desktopMachine,
			ctx(),
			fc.oneof(raw(m), guided(m)),
			(steps) => {
				let waiting = 0;
				for (const {prev, msg, next, cmds} of steps) {
					const stops = cmds.filter((c) => c.type === "desktop_stop_brain").length;
					if (msg.type === "desktop_stop_brain_ok" || msg.type === "desktop_stop_brain_err")
						waiting = Math.max(0, waiting - 1);
					waiting += stops;
					if (waiting > 1) return `${msg.type} left ${waiting} stops in flight`;
					if (stops > 0 && msg.type !== "quit" && msg.type !== "retry")
						return `${msg.type} stopped the brain`;
					if (msg.type === "quit" && prev._tag === "online" && next._tag !== "stopping")
						return `Quit from online moved to ${next._tag}`;
					if (msg.type === "quit" && prev._tag === "online" && stops !== 1)
						return "Quit from online did not send exactly one stop";
				}
				return true;
			},
			RUNS,
		);
	});

	it("plant, report stopped early or quit anyway: only a settled stop reaches stopped, and a failed one stays retryable", async () => {
		const m = await load();
		propertyInvariant(
			m.desktopMachine,
			ctx(),
			both(m),
			({prev, msg, next, cmds}) => {
				if (
					next._tag === "stopped" &&
					prev._tag !== "stopped" &&
					msg.type !== "desktop_stop_brain_ok"
				)
					return `${msg.type} reached stopped without a settled stop`;
				if (msg.type === "desktop_stop_brain_err" && prev._tag === "stopping")
					return next._tag === "blocked" && whys.stop.includes(next.why as never)
						? true
						: `a failed stop moved to ${next._tag}`;
				if (
					msg.type === "retry" &&
					prev._tag === "blocked" &&
					whys.stop.includes(prev.why as never) &&
					!(next._tag === "stopping" && cmdTypes(cmds).includes("desktop_stop_brain"))
				)
					return "Retry after a failed stop did not stop again";
				return true;
			},
			RUNS,
		);
	});
});

describe("P19 desktop machine: saved cuts", () => {
	it("plant, drop starting or stopping on encode: every JSON cut keeps later models and Cmds", async () => {
		const m = await load();
		fc.assert(
			fc.property(guided(m), (msgs) => {
				syncTest(m.desktopMachine, ctx(), {
					msgs: [...msgs],
					encode: Schema.encodeSync(m.DesktopModel),
					decode: Schema.decodeUnknownSync(m.DesktopModel),
					equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
					seed: SEED,
				});
			}),
			{seed: SEED, numRuns: 60},
		);
	});
});
