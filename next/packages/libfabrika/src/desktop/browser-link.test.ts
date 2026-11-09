// P23, next/. Real BrowserLink and real menuMachine; Layers supply only outside replies.
import {createHash} from "node:crypto";
import {run} from "@demlik/tea/effect";
import {describe, expect, it, vi} from "@effect/vitest";
import {Context, Duration, Effect, Exit, Fiber, Layer, Redacted, Schema, Scope} from "effect";
import {TestClock} from "effect/testing";
import {
	browserLinkFixture,
	Bytes32,
	checks,
	leaks,
	Operations,
	SafeTime,
} from "./browser-link.test-support.ts";

const module = "./browser-link.ts";
const menuModule = "./menu.ts";
const load = () =>
	Effect.promise((): Promise<typeof import("./browser-link.ts")> => import(module));
const loadMenu = () =>
	Effect.promise((): Promise<typeof import("./menu.ts")> => import(menuModule));
const context = {person: "person-test", ledger: "test-ledger", own: "own-test", browser: true};

describe("P23 native browser link", () => {
	it.effect.prop(
		"prepare uses exactly 32 secure bytes, shared digest, two TypeIDs and a 60-second deadline",
		{bytes: Bytes32, at: SafeTime},
		({bytes, at}) =>
			Effect.gen(function* () {
				const {BrowserLink} = yield* load();
				const fixture = yield* browserLinkFixture({bytes});
				yield* TestClock.setTime(at);
				yield* Effect.gen(function* () {
					const link = yield* BrowserLink;
					const prepared = yield* link.prepare;
					const other = yield* link.prepare;
					expect(prepared.at).toBe(at);
					expect(prepared.pass.until).toBe(at + 60_000);
					expect(prepared.input).toMatch(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
					expect(prepared.pass.id).toMatch(/^pass_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
					expect(other.input).not.toBe(prepared.input);
					expect(other.pass.id).not.toBe(prepared.pass.id);
					expect(fixture.sizes).toEqual([32, 32]);
					const raw = Buffer.from(bytes).toString("base64url");
					expect(prepared.pass.digest).toBe(createHash("sha256").update(raw).digest("base64url"));
					expect(leaks(raw, prepared)).toBe(false);
					yield* link.open(prepared.pass.id);
					const opened = yield* fixture.opened;
					expect(opened).toHaveLength(1);
					expect(opened[0]!.origin).toBe("http://127.0.0.1:43123");
					expect(Redacted.value(opened[0]!.pass)).toBe(raw);
					expect(yield* Effect.result(link.open(prepared.pass.id))).toMatchObject({
						_tag: "Failure",
					});
					expect(yield* fixture.opened).toHaveLength(1);
				}).pipe(Effect.provide(fixture.layer));
			}),
		checks,
	);
	it.effect.prop(
		"only a selected bare loopback HTTP or cloud HTTPS origin can prepare",
		{
			port: Schema.Int.check(Schema.isBetween({minimum: 1024, maximum: 65535})),
			word: Schema.String.check(Schema.isPattern(/^[a-z]{1,20}$/)),
		},
		({port, word}) =>
			Effect.gen(function* () {
				const {BrowserLink} = yield* load();
				for (const origin of [
					`http://127.0.0.1:${port}`,
					`http://localhost:${port}`,
					`https://${word}.example`,
				]) {
					const fixture = yield* browserLinkFixture({origin});
					expect(
						yield* Effect.result(
							BrowserLink.use((link) => link.prepare).pipe(Effect.provide(fixture.layer)),
						),
					).toHaveProperty("_tag", "Success");
				}
				for (const origin of [
					`http://${word}.example`,
					`https://user:pass@${word}.example`,
					`https://${word}.example/?q=1`,
					`https://${word}.example/#pass=x`,
					`https://${word}.example/path`,
					`file:///${word}`,
					`javascript:${word}`,
				]) {
					const fixture = yield* browserLinkFixture({origin});
					expect(
						yield* Effect.result(
							BrowserLink.use((link) => link.prepare).pipe(Effect.provide(fixture.layer)),
						),
					).toMatchObject({_tag: "Failure", failure: {why: "bad_address"}});
					expect(fixture.sizes).toEqual([]);
					expect(yield* fixture.opened).toEqual([]);
				}
			}),
		checks,
	);
	it.effect.prop(
		"holder expires at exactly 60,000 ms on the main clock",
		{at: SafeTime, bytes: Bytes32},
		({at, bytes}) =>
			Effect.gen(function* () {
				const {BrowserLink} = yield* load();
				for (const elapsed of [59_999, 60_000, 60_001]) {
					yield* TestClock.setTime(at);
					const fixture = yield* browserLinkFixture({bytes});
					yield* Effect.gen(function* () {
						const link = yield* BrowserLink;
						const prepared = yield* link.prepare;
						yield* TestClock.adjust(Duration.millis(elapsed));
						const answer = yield* Effect.result(link.open(prepared.pass.id));
						expect(answer._tag).toBe(elapsed < 60_000 ? "Success" : "Failure");
						expect(yield* fixture.opened).toHaveLength(elapsed < 60_000 ? 1 : 0);
					}).pipe(Effect.provide(fixture.layer));
				}
			}),
		checks,
	);
	it.effect.prop(
		"install precedes external open, and rejected opening removes menu authority",
		{bytes: Bytes32, fail: Schema.Boolean},
		({bytes, fail}) =>
			Effect.gen(function* () {
				const {BrowserLink, openBrowserLink} = yield* load();
				const {menuMachine} = yield* loadMenu();
				let installed = false;
				const fixture = yield* browserLinkFixture({
					bytes,
					beforeOpen: () => {
						expect(installed).toBe(true);
					},
				});
				if (fail) yield* fixture.failOpen;
				yield* Effect.gen(function* () {
					const link = yield* BrowserLink;
					const handle = yield* run(menuMachine, {
						interpret: {
							menu_open: (cmd: Extract<import("./menu.ts").MenuCmd, {type: "menu_open"}>) =>
								link.open(cmd.id).pipe(
									Effect.as(null),
									Effect.mapError(() => ({_tag: "open"})),
								),
							menu_refresh: () => Effect.succeed({rows: [], clients: []}),
							menu_check: () => Effect.die("automatic grant requested a person check"),
							menu_sign: () => Effect.die("no row was supplied"),
							menu_post: () => Effect.die("no signed change was supplied"),
							menu_deny: () => Effect.die("no denial was supplied"),
							menu_quit: () => Effect.succeed(null),
						},
					});
					const runtime = yield* handle.ready;
					yield* runtime.dispatch({type: "connected", context});
					runtime.subscribe(() => {
						installed = runtime.getState().passes.length === 1;
					});
					yield* Effect.result(openBrowserLink(runtime));
					yield* runtime.idle();
					expect(yield* fixture.opened).toHaveLength(1);
					expect(runtime.getState().passes).toHaveLength(fail ? 0 : 1);
					expect(runtime.getState().error === null).toBe(!fail);
					const raw = Buffer.from(bytes).toString("base64url");
					expect(leaks(raw, runtime.getState())).toBe(false);
				}).pipe(Effect.provide(fixture.layer));
			}),
		checks,
	);
	it.effect.prop(
		"discard, interrupted opening and scope closure remove bytes, including unopened entries",
		{bytes: Bytes32, ops: Operations},
		({bytes, ops}) =>
			Effect.gen(function* () {
				const fixture = yield* browserLinkFixture({bytes, pauseOpen: true});
				const scope = yield* Scope.make();
				const services = yield* buildLink(fixture.layer, scope);
				const link = services;
				const unopened = yield* link.prepare;
				const pending = yield* link.prepare;
				const fiber = yield* Effect.forkChild(link.open(pending.pass.id));
				yield* fixture.entered;
				yield* Fiber.interrupt(fiber);
				for (const _op of ops) yield* link.discard(pending.pass.id);
				expect(yield* Effect.result(link.open(pending.pass.id))).toHaveProperty("_tag", "Failure");
				yield* Scope.close(scope, Exit.void);
				expect(yield* Effect.result(link.open(unopened.pass.id))).toHaveProperty("_tag", "Failure");
			}),
		checks,
	);
	it.effect.prop(
		"interrupted native dispatch removes both held bytes and installed menu authority",
		{bytes: Bytes32, at: SafeTime},
		({bytes, at}) =>
			Effect.gen(function* () {
				const {BrowserLink, openBrowserLink} = yield* load();
				const {menuMachine} = yield* loadMenu();
				const fixture = yield* browserLinkFixture({bytes, pauseOpen: true});
				yield* TestClock.setTime(at);
				yield* Effect.gen(function* () {
					const link = yield* BrowserLink;
					const handle = yield* run(menuMachine, {
						interpret: {
							menu_open: (cmd: Extract<import("./menu.ts").MenuCmd, {type: "menu_open"}>) =>
								link.open(cmd.id).pipe(
									Effect.as(null),
									Effect.mapError(() => ({_tag: "open"})),
								),
							menu_refresh: () => Effect.succeed({rows: [], clients: []}),
							menu_check: () => Effect.die("unexpected check"),
							menu_sign: () => Effect.die("unexpected sign"),
							menu_post: () => Effect.die("unexpected post"),
							menu_deny: () => Effect.die("unexpected deny"),
							menu_quit: () => Effect.succeed(null),
						},
					});
					const runtime = yield* handle.ready;
					yield* runtime.dispatch({type: "connected", context});
					const pending = yield* Effect.forkChild(openBrowserLink(runtime));
					yield* fixture.entered;
					const issued = runtime.getState().passes;
					expect(issued).toHaveLength(1);
					yield* Fiber.interrupt(pending);
					yield* fixture.release;
					yield* runtime.idle();
					expect(runtime.getState().passes).toEqual([]);
					for (const pass of issued)
						expect(yield* Effect.result(link.open(pass.id))).toHaveProperty("_tag", "Failure");
				}).pipe(Effect.provide(fixture.layer));
			}),
		checks,
	);
	it.effect.prop(
		"native adapter builds only a fragment URL and replaces rejection text with fixed open",
		{bytes: Bytes32, fail: Schema.Boolean},
		({bytes, fail}) =>
			Effect.gen(function* () {
				const {ExternalBrowser} = yield* load();
				const passModule = "../transport/browser-pass.ts";
				const {PassSecret}: typeof import("../transport/browser-pass.ts") = yield* Effect.promise(
					() => import(passModule),
				);
				const raw = Buffer.from(bytes).toString("base64url");
				const pass = yield* Schema.decodeUnknownEffect(PassSecret)(raw);
				const sent: string[] = [];
				vi.resetModules();
				vi.doMock("electron", () => ({
					shell: {
						openExternal: (url: string) => {
							sent.push(url);
							return fail ? Promise.reject(new Error(url)) : Promise.resolve();
						},
					},
				}));
				try {
					const adapterPath = "../electron/browser-link.ts";
					const {electronExternalBrowser}: typeof import("../electron/browser-link.ts") =
						yield* Effect.promise(() => import(adapterPath));
					const answer = yield* Effect.result(
						ExternalBrowser.use((external) => external.open("https://selected.example", pass)).pipe(
							Effect.provide(electronExternalBrowser),
						),
					);
					expect(sent).toEqual([`https://selected.example/#pass=${raw}`]);
					expect(new URL(sent[0]!).search).toBe("");
					expect(answer._tag).toBe(fail ? "Failure" : "Success");
					expect(leaks(raw, answer)).toBe(false);
				} finally {
					vi.doUnmock("electron");
				}
			}),
		checks,
	);
});

// Keep a handle after closing its scope so cleanup is observable without a copied holder.
const buildLink = (
	layer: Layer.Layer<import("./browser-link.ts").BrowserLink>,
	scope: Scope.Closeable,
) =>
	Effect.gen(function* () {
		const {BrowserLink} = yield* load();
		const services = yield* Layer.buildWithScope(layer, scope);
		return Context.get(services, BrowserLink);
	});
