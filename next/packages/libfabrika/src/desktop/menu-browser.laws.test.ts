// P23, next/. Tea checks the real P21 menu from init, including Cmd replies.
import {applyCell} from "@demlik/tea";
import {
	arbGuidedSequence,
	arbMsg,
	arbMsgSequence,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Duration, Effect, Fiber, Logger, Option, Redacted, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {
	browserLinkFixture,
	Bytes32,
	checks,
	leaks,
	Operations,
	personKeyLayer,
	SafeTime,
	secretForms,
} from "./browser-link.test-support.ts";
import type {MenuCmd, MenuMsg} from "./menu.ts";

const menuPath = "./menu.ts";
const load = () => Effect.promise((): Promise<typeof import("./menu.ts")> => import(menuPath));
const fcChecks = {seed: 119120, numRuns: 200};
const context = {person: "test-person", ledger: "test-ledger", own: "own-key", browser: true};
const id = (prefix: string) =>
	fc.uint8Array({minLength: 16, maxLength: 16}).map((raw) => {
		const bytes = raw.slice();
		bytes[6] = (bytes[6]! & 15) | 112;
		bytes[8] = (bytes[8]! & 63) | 128;
		const bits = `00${[...bytes].map((b) => b.toString(2).padStart(8, "0")).join("")}`;
		const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
		return `${prefix}_${Array.from({length: 26}, (_, i) => alphabet[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join("")}`;
	});
const words = fc.string({minLength: 1, maxLength: 40});
const at = fc.integer({min: 0, max: 2 ** 40});
const row = fc.record({
	key: words,
	label: words,
	where: words,
	code: fc.integer({min: 0, max: 999999}).map((n) => String(n).padStart(6, "0")),
	until: at,
	tabs: fc.integer({min: 1, max: 20}),
	has: fc.array(words, {maxLength: 20}),
	as: fc.constantFrom("window", "agent"),
	digest: fc.option(words, {nil: null}),
});
const signed = fc.record({text: words, armored: words, signer: words});

// The table is exhaustive against P21's inferred MenuMsg, not a substitute message union.
const table = (m: typeof import("./menu.ts")): MsgArbitraryTable<MenuMsg> => {
	const input = id("input").map(Schema.decodeUnknownSync(m.MenuInputId));
	const grant = id("grant").map(Schema.decodeUnknownSync(m.GrantId));
	const revoke = id("revoke").map(Schema.decodeUnknownSync(m.RevokeId));
	const pass = fc
		.record({id: id("pass"), digest: words, until: at})
		.map(Schema.decodeUnknownSync(m.MenuPass));
	const intent = fc
		.tuple(grant, row)
		.map(([id, row]) => m.MenuIntent.cases.approve.make({id, row}));
	const sign = fc
		.tuple(input, intent)
		.map(([input, intent]) => m.signChange({input, intent, context, check: "none"}));
	const check = fc.tuple(input, intent).map(([input, intent]) => m.checkPerson({input, intent}));
	const post = fc.tuple(input, signed).map(([input, signed]) => m.postChange({input, signed}));
	const deny = fc.tuple(input, words).map(([input, key]) =>
		m.denyClient({
			input,
			key,
			saw: {
				label: "test",
				where: "local",
				code: "123456",
				has: [],
				how: "compare",
				check: "none",
			},
		}),
	);
	const open = pass.map((p) => m.openBrowser({id: p.id}));
	const applied = m.ChangeReply.cases.applied.make({rev: 1});
	return {
		connected: fc.constant({type: "connected", context}),
		brain: words.map((words) => ({type: "brain", words})),
		rows: fc
			.tuple(fc.array(row, {maxLength: 20}), at)
			.map(([rows, at]) => ({type: "rows", rows, at})),
		clients: fc.constant({type: "clients", clients: []}),
		approve: fc
			.tuple(input, grant, words)
			.map(([input, id, key]) => ({type: "approve", input, id, key})),
		deny: fc.tuple(input, words).map(([input, key]) => ({type: "deny", input, key})),
		remove: fc
			.tuple(input, revoke, words)
			.map(([input, id, key]) => ({type: "remove", input, id, key})),
		enter: fc.constant({type: "enter"}),
		refresh: fc.constant({type: "refresh"}),
		open_browser: fc.tuple(pass, at).map(([pass, at]) => ({type: "open_browser", pass, at})),
		quit: fc.constant({type: "quit"}),
		menu_check_ok: check.map((cmd) => m.checkPerson.ok(cmd, {_tag: "checked", check: "click"})),
		menu_check_err: check.map((cmd) => m.checkPerson.err(cmd, {_tag: "check"})),
		menu_sign_ok: fc.tuple(sign, signed).map(([cmd, value]) => m.signChange.ok(cmd, value)),
		menu_sign_err: sign.map((cmd) => m.signChange.err(cmd, {_tag: "key"})),
		menu_post_ok: post.map((cmd) => m.postChange.ok(cmd, applied)),
		menu_post_err: post.map((cmd) => m.postChange.err(cmd, {_tag: "connection"})),
		menu_deny_ok: deny.map((cmd) => m.denyClient.ok(cmd, applied)),
		menu_deny_err: deny.map((cmd) => m.denyClient.err(cmd, {_tag: "bad_reply"})),
		menu_refresh_ok: fc.constant(m.refreshMenu.ok(m.refreshMenu({}), {rows: [], clients: []})),
		menu_refresh_err: fc.constant(m.refreshMenu.err(m.refreshMenu({}), {_tag: "connection"})),
		menu_open_ok: open.map((cmd) => m.openBrowser.ok(cmd, null)),
		menu_open_err: open.map((cmd) => m.openBrowser.err(cmd, {_tag: "open"})),
		menu_quit_ok: fc.constant(m.quitMenu.ok(m.quitMenu({}), null)),
		menu_quit_err: fc.constant(
			m.quitMenu.err(m.quitMenu({}), {_tag: "malformed_result", issues: []}),
		),
	};
};
const signs = (cmds: ReadonlyArray<MenuCmd>) => cmds.filter((cmd) => cmd.type === "menu_sign");
const inspectSigned = (signed: {text: string}, digest: string) => {
	expect(signed.text).toContain('"how":"link"');
	expect(signed.text).toContain('"check":"none"');
	expect(signed.text).not.toContain(digest);
};
const inspectTaken = (pass: Option.Option<Redacted.Redacted<string>>, raw: string) => {
	expect(
		Option.match(pass, {onNone: () => true, onSome: (value) => Redacted.value(value) === raw}),
	).toBe(true);
};
const interruptedOpen = Effect.fnUntraced(function* (
	BrowserLink: typeof import("./browser-link.ts").BrowserLink,
	paused: Effect.Success<ReturnType<typeof browserLinkFixture>>,
	output: unknown[],
) {
	const heldLink = yield* BrowserLink;
	const prepared = yield* heldLink.prepare;
	const active = yield* Effect.forkChild(heldLink.open(prepared.pass.id));
	yield* paused.entered;
	output.push(yield* Fiber.interrupt(active));
	expect(yield* Effect.result(heldLink.open(prepared.pass.id))).toHaveProperty("_tag", "Failure");
});

describe("P23 real menu link laws", () => {
	it.effect(
		"one pass grants at most one key across two matching rows and later duplicate messages",
		() =>
			Effect.gen(function* () {
				const m = yield* load();
				const t = table(m);
				const noise = arbMsgSequence(arbMsg(t), {maxLength: 64, size: "max"});
				const seq = fc
					.tuple(id("pass"), words, at, row, row, fc.boolean(), noise)
					.filter(([, , , a, b]) => a.key !== b.key)
					.map(([id, digest, issued, a, b, reverse, rest]): ReadonlyArray<MenuMsg> => {
						const pass = Schema.decodeUnknownSync(m.MenuPass)({id, digest, until: issued + 60_000});
						const rows = [a, b].map((r) => ({...r, digest, until: issued + 120_000}));
						return [
							{type: "connected", context},
							{type: "open_browser", pass, at: issued},
							{type: "rows", rows: reverse ? [...rows].reverse() : rows, at: issued + 1},
							{type: "rows", rows: [...rows].reverse(), at: issued + 2},
							...rest,
						];
					});
				propertyInvariant(
					m.menuMachine,
					{},
					seq,
					({prev, msg, next, cmds}) => {
						const automatic = signs(cmds).filter((cmd) => cmd.check === "none");
						if (msg.type !== "rows") return true;
						const matches = prev.passes.filter(
							(pass) => pass.until > msg.at && msg.rows.some((r) => r.digest === pass.digest),
						);
						return (
							automatic.length <= matches.length &&
							automatic.every(
								(cmd) => !next.passes.some((pass) => pass.digest === cmd.intent.row.digest),
							) &&
							!cmds.some((cmd) => cmd.type === "menu_check")
						);
					},
					fcChecks,
				);
				// Plant: restore the consumed pass. The same two matching rows then sign twice.
				fc.assert(
					fc.property(seq, (msgs) => {
						const trace = foldEvents(m.menuMachine, {}, null, msgs.slice(0, 4));
						expect(trace.steps.flatMap((step) => signs(step.cmds))).toHaveLength(1);
						const match = trace.steps[2]!;
						const broken = {...match.next, passes: match.prev.passes};
						const [, extra] = applyCell(m.menuMachine, broken, msgs[3]!);
						expect(() => expect(signs([...match.cmds, ...extra])).toHaveLength(1)).toThrow();
					}),
					fcChecks,
				);
			}),
	);
	it.effect.prop(
		"expired, used and unknown digests remain ordinary rows at the exact deadline",
		{issued: SafeTime, bytes: Bytes32},
		({issued, bytes}) =>
			Effect.gen(function* () {
				const m = yield* load();
				const p = yield* browserLinkFixture({bytes});
				const linkPath = "./browser-link.ts";
				const {BrowserLink}: typeof import("./browser-link.ts") = yield* Effect.promise(
					() => import(linkPath),
				);
				const prepared = yield* BrowserLink.use((link) => link.prepare).pipe(
					Effect.provide(p.layer),
				);
				for (const elapsed of [59_999, 60_000, 60_001])
					for (const state of ["live", "used", "unknown"]) {
						yield* TestClock.setTime(issued);
						yield* TestClock.adjust(Duration.millis(elapsed));
						const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
						const pass = {...prepared.pass, until: issued + 60_000};
						const r = {
							key: "fresh-key",
							label: "Browser",
							where: "local",
							code: "246810",
							until: issued + 120_000,
							tabs: 1,
							has: [],
							as: "window",
							digest: state === "unknown" ? "different-digest" : pass.digest,
						};
						const msgs: MenuMsg[] = [
							{type: "connected", context},
							{type: "open_browser", pass, at: issued},
						];
						if (state === "used")
							msgs.push({type: "rows", rows: [{...r, key: "first-key"}], at: issued + 1});
						msgs.push({type: "rows", rows: [r], at: now});
						const result = foldEvents(m.menuMachine, {}, null, msgs);
						const last = result.steps.at(-1)!;
						expect(signs(last.cmds)).toHaveLength(state === "live" && elapsed < 60_000 ? 1 : 0);
						expect(last.next.rows).toContainEqual(r);
					}
			}),
		checks,
	);
	it.effect(
		"guided real Cmd replies and unsolicited mismatches never restore failed authority",
		() =>
			Effect.gen(function* () {
				const m = yield* load();
				const t = table(m);
				const guided = arbGuidedSequence(
					m.menuMachine,
					{},
					{
						outside: t,
						answers: {
							menu_open: {
								draw: fc.boolean(),
								make: (cmd, ok) =>
									ok ? m.openBrowser.ok(cmd, null) : m.openBrowser.err(cmd, {_tag: "open"}),
							},
							menu_check: {
								draw: fc.boolean(),
								make: (cmd, ok) =>
									m.checkPerson.ok(
										cmd,
										ok ? {_tag: "checked", check: "click"} : {_tag: "not_checked", why: "no"},
									),
							},
							menu_sign: {draw: signed, make: (cmd, value) => m.signChange.ok(cmd, value)},
							menu_post: {
								draw: fc.constantFrom("applied", "ignored", "refused"),
								make: (cmd, answer) =>
									m.postChange.ok(
										cmd,
										answer === "applied"
											? {_tag: "applied", rev: 1}
											: answer === "ignored"
												? {_tag: "ignored", rev: 1, why: "used"}
												: {_tag: "refused", why: "not_allowed"},
									),
							},
							menu_refresh: {
								draw: fc.array(row, {maxLength: 20}),
								make: (cmd, rows) => m.refreshMenu.ok(cmd, {rows, clients: []}),
							},
							menu_deny: {
								draw: fc.boolean(),
								make: (cmd, ok) =>
									ok
										? m.denyClient.ok(cmd, {_tag: "applied", rev: 1})
										: m.denyClient.err(cmd, {_tag: "connection"}),
							},
							menu_quit: {draw: fc.constant(null), make: (cmd) => m.quitMenu.ok(cmd, null)},
						},
					},
					{maxLength: 96, size: "max"},
				);
				for (const seq of [guided, arbMsgSequence(arbMsg(t), {maxLength: 96, size: "max"})])
					propertyInvariant(
						m.menuMachine,
						{},
						seq,
						({msg, next, cmds}) =>
							msg.type !== "menu_open_err" ||
							(!next.passes.some((pass) => pass.id === msg.cmd.id) && signs(cmds).length === 0),
						fcChecks,
					);
			}),
	);
	it.effect.prop(
		"[secrets] link and menu flows keep passes out of every saved and diagnostic output",
		{bytes: Bytes32, ops: Operations},
		({bytes, ops}) =>
			Effect.gen(function* () {
				const desktopPath = "@kampus/libfabrika/desktop",
					browserPath = "@kampus/libfabrika/browser";
				const m: typeof import("@kampus/libfabrika/desktop") = yield* Effect.promise(
					() => import(desktopPath),
				);
				const {BrowserLink, signMenuChange} = m;
				const {BrowserPass}: typeof import("@kampus/libfabrika/browser") = yield* Effect.promise(
					() => import(browserPath),
				);
				const person = yield* personKeyLayer();
				const fixture = yield* browserLinkFixture({bytes});
				const raw = Buffer.from(bytes).toString("base64url");
				const logs: unknown[] = [];
				const output: Record<string, unknown[]> = {
					url: [],
					redirect: [],
					record: [],
					span: [],
					log: logs,
					error: [],
					cmd: [],
					model: [],
					frame: [],
					capture: [],
				};
				yield* Effect.gen(function* () {
					const link = yield* BrowserLink;
					let [model] = m.menuMachine.init(null, {});
					[model] = applyCell(m.menuMachine, model, {type: "connected", context});
					const held: Array<{pass: {id: string; digest: string; until: number}; at: number}> = [];
					let hash = `#pass=${raw}`;
					yield* Effect.gen(function* () {
						const browser = yield* BrowserPass;
						yield* browser.ready;
						for (const op of ["prepare", "open", "take", "knock", ...ops]) {
							if (op === "prepare") {
								const prepared = yield* link.prepare;
								held.push(prepared);
								const [next, cmds] = applyCell(m.menuMachine, model, {
									type: "open_browser",
									pass: prepared.pass,
									at: prepared.at,
								});
								model = next;
								output.cmd.push(...cmds);
							} else if (op === "fail") yield* fixture.failOpen;
							else if (op === "open" && held.length) {
								const answer = yield* Effect.result(link.open(held.at(-1)!.pass.id));
								output.error.push(answer);
								if (answer._tag === "Failure") {
									const [next, cmds] = applyCell(
										m.menuMachine,
										model,
										m.openBrowser.err(m.openBrowser({id: held.at(-1)!.pass.id}), {_tag: "open"}),
									);
									model = next;
									output.cmd.push(...cmds);
								}
							} else if (op === "interrupt") {
								const paused = yield* browserLinkFixture({bytes, pauseOpen: true});
								yield* interruptedOpen(BrowserLink, paused, output.error).pipe(
									Effect.provide(paused.layer),
									Effect.withTracer(fixture.tracer),
								);
								output.record.push(...(yield* paused.observations));
							} else if (op === "discard") {
								for (const entry of held) yield* link.discard(entry.pass.id);
							} else if (op === "take" || op === "knock") {
								const pass = yield* browser.take;
								// The outgoing knock is a named sending point. Its raw frame is never saved.
								inspectTaken(pass, raw);
								const digest = held.at(-1)?.pass.digest ?? "unknown";
								const [next, cmds] = applyCell(m.menuMachine, model, {
									type: "rows",
									at: held.at(-1)?.at ?? 0,
									rows: [
										{
											key: `key-${op}`,
											label: "Tab",
											where: "local",
											code: "654321",
											until: 120000,
											tabs: 1,
											has: [],
											as: "window",
											digest,
										},
									],
								});
								model = next;
								output.cmd.push(...cmds);
								for (const cmd of signs(cmds)) {
									const signed = yield* signMenuChange({
										intent: cmd.intent,
										context: cmd.context,
										check: cmd.check,
									}).pipe(Effect.provide(person));
									output.record.push(signed);
									output.frame.push(signed);
									inspectSigned(signed, digest);
								}
							}
							output.model.push(model);
							output.url.push(`http://127.0.0.1:43123/${hash}`);
						}
					}).pipe(
						Effect.provide(
							BrowserPass.browser({
								hash: () => hash,
								clear: () => {
									hash = "";
								},
							}),
						),
					);
				}).pipe(
					Effect.provide(fixture.layer),
					Effect.withTracer(fixture.tracer),
					Effect.provide(
						Logger.layer([
							Logger.make((options) => {
								logs.push(options);
							}),
						]),
					),
				);
				output.record.push(...(yield* fixture.observations));
				output.span.push(
					...fixture.spans.map((span) => ({
						name: span.name,
						attributes: [...span.attributes],
						status: span.status,
					})),
				);
				for (const [destination, values] of Object.entries(output)) {
					expect(leaks(raw, values), destination).toBe(false);
					for (const encoded of secretForms(raw))
						expect(() =>
							expect(leaks(raw, [...values, {[destination]: encoded}])).toBe(false),
						).toThrow();
				}
			}),
		checks,
	);
});
