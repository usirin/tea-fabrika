// P23, next/. Page policy is tested here; bound Host is also tested through the real stage in e2e.
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Duration, Effect, Option, Redacted, Schema} from "effect";
import {Digest} from "effect/crypto";
import {TestClock} from "effect/testing";
import {browserLinkFixture, Bytes32, checks} from "../desktop/browser-link.test-support.ts";

const module = "./pages.ts";
const load = () => Effect.promise((): Promise<typeof import("./pages.ts")> => import(module));
describe("P23 built pages", () => {
	it.effect(
		"the four routes serve selected assets directly with correct GET, HEAD and method handling",
		() =>
			Effect.gen(function* () {
				const {PageAssets, servePage} = yield* load();
				const input = Schema.Struct({
					assets: PageAssets,
					method: Schema.Literals(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]),
					unknown: Schema.NonEmptyString,
				});
				const checked = yield* Arbitrary.checkEffect(
					Arbitrary.schema(input),
					({assets, method, unknown}) =>
						Effect.gen(function* () {
							const selected = yield* Schema.decodeUnknownEffect(PageAssets)(assets);
							for (const [path, body, type] of [
								["/", assets.browser.html, "text/html"],
								["/electron", assets.electron.html, "text/html"],
								["/browser.js", assets.browser.js, "javascript"],
								["/electron.js", assets.electron.js, "javascript"],
							] as const) {
								const response = yield* servePage(
									new Request(`http://127.0.0.1:43123${path}`, {method}),
									selected,
								);
								expect(response).not.toBeNull();
								expect(response!.status).toBe(method === "GET" || method === "HEAD" ? 200 : 405);
								expect(response!.headers.has("location")).toBe(false);
								if (method === "GET" || method === "HEAD") {
									expect(response!.headers.get("content-type")).toContain(type);
									expect(yield* Effect.promise(() => response!.text())).toBe(
										method === "HEAD" ? "" : body,
									);
								}
								if ((method === "GET" || method === "HEAD") && type === "text/html") {
									expect(response!.headers.get("cache-control")).toBe("no-store");
									expect(response!.headers.get("referrer-policy")).toBe("no-referrer");
									expect(response!.headers.get("content-security-policy")).toBeTruthy();
								}
							}
							expect(
								yield* servePage(
									new Request(`http://127.0.0.1:43123/unknown/${encodeURIComponent(unknown)}`, {
										method,
									}),
									selected,
								),
							).toBeNull();
							return true;
						}),
					checks.arbitrary,
				);
				expect(checked._tag).toBe("Passed");
			}),
	);
	it.effect.prop(
		"public libfabrika subpaths perform the link flow with generated origins and failures",
		{
			bytes: Bytes32,
			port: Schema.Int.check(Schema.isBetween({minimum: 1024, maximum: 65535})),
			cloud: Schema.Boolean,
			fail: Schema.Boolean,
			expired: Schema.Boolean,
		},
		({bytes, port, cloud, fail, expired}) =>
			Effect.gen(function* () {
				const desktopPath = "@kampus/libfabrika/desktop",
					browserPath = "@kampus/libfabrika/browser",
					serverPath = "@kampus/libfabrika/server",
					electronPath = "@kampus/libfabrika/electron",
					transportPath = "@kampus/libfabrika/transport";
				const desktop: typeof import("@kampus/libfabrika/desktop") = yield* Effect.promise(
					() => import(desktopPath),
				);
				const browser: typeof import("@kampus/libfabrika/browser") = yield* Effect.promise(
					() => import(browserPath),
				);
				const server: typeof import("@kampus/libfabrika/server") = yield* Effect.promise(
					() => import(serverPath),
				);
				const electron: typeof import("@kampus/libfabrika/electron") = yield* Effect.promise(
					() => import(electronPath),
				);
				const transport: typeof import("@kampus/libfabrika/transport") = yield* Effect.promise(
					() => import(transportPath),
				);
				for (const value of [
					desktop.BrowserLink,
					desktop.openBrowserLink,
					desktop.menuMachine,
					browser.BrowserPass,
					browser.takeBrowserPass,
					transport.PassSecret,
					transport.passDigest,
					server.PageAssets,
					server.servePage,
					electron.electronExternalBrowser,
				])
					expect(value).toBeDefined();
				const origin = cloud ? "https://selected.example" : `http://127.0.0.1:${port}`;
				const fixture = yield* browserLinkFixture({bytes, origin});
				if (fail) yield* fixture.failOpen;
				yield* Effect.gen(function* () {
					const link = yield* desktop.BrowserLink;
					const prepared = yield* link.prepare;
					if (expired) yield* TestClock.adjust(Duration.millis(60_000));
					const opened = yield* Effect.result(link.open(prepared.pass.id));
					expect(opened._tag).toBe(fail || expired ? "Failure" : "Success");
					let fragment = "";
					if (opened._tag === "Success") {
						const sent = yield* fixture.opened;
						expect(sent).toHaveLength(1);
						expect(sent[0]?.origin).toBe(origin);
						const pass = sent[0]?.pass;
						if (!pass) return yield* Effect.die("successful open sent no pass");
						fragment = `#pass=${Redacted.value(pass)}`;
					}
					yield* Effect.gen(function* () {
						const holder = yield* browser.BrowserPass;
						yield* holder.ready;
						expect(fragment).toBe("");
						const pass = yield* holder.take;
						expect(Option.isSome(pass)).toBe(opened._tag === "Success");
						if (Option.isSome(pass))
							expect(
								yield* transport.passDigest(pass.value).pipe(Effect.provide(Digest.layerWebCrypto)),
							).toBe(prepared.pass.digest);
						expect(Option.isNone(yield* holder.take)).toBe(true);
					}).pipe(
						Effect.provide(
							browser.BrowserPass.browser({
								hash: () => fragment,
								clear: () => {
									fragment = "";
								},
							}),
						),
					);
				}).pipe(Effect.provide(fixture.layer));
				const checked = yield* Arbitrary.checkEffect(
					Arbitrary.schema(server.PageAssets),
					(assets) =>
						Effect.gen(function* () {
							const selected = yield* Schema.decodeUnknownEffect(server.PageAssets)(assets);
							expect(
								(yield* server.servePage(new Request("http://127.0.0.1:43123/"), selected))?.status,
							).toBe(200);
							return true;
						}),
					checks.arbitrary,
				);
				expect(checked._tag).toBe("Passed");
			}),
		checks,
	);
});

// Compile-only public client. It imports no app or Tuval decision helper.
const publicClient = (
	desktop: typeof import("@kampus/libfabrika/desktop"),
	browser: typeof import("@kampus/libfabrika/browser"),
	server: typeof import("@kampus/libfabrika/server"),
	transport: typeof import("@kampus/libfabrika/transport"),
) =>
	Effect.gen(function* () {
		const link = yield* desktop.BrowserLink;
		const prepared = yield* link.prepare;
		const pass = yield* browser.BrowserPass;
		yield* pass.ready;
		const captured = yield* pass.take;
		return {prepared, captured, hash: transport.passDigest, page: server.servePage};
	});
void publicClient;
