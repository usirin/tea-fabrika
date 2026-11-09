// P23, next/. scenario: real Chromium network/history evidence supplements generated secret laws.
// This box cannot start Chromium, Electron or a socket; run through the existing e2e driver later.
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Redacted, Schema} from "effect";
import {click, leaks, linkTab, openLink, outside, startDemo, visible} from "./p23.test-support.ts";

describe("P23 real one-time links", () => {
	// Plan reason: real Chromium network capture checks HTTP URLs, redirects and address/history behavior.
	it.live(
		"scenario: [secrets] p49 no pass in HTTP URLs, redirects, history, diagnostics or saved captures",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* outside("browser", () =>
					demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
				);
				yield* click(demo.window, "Start");
				yield* visible(demo.window, "Online");
				const capture: unknown[] = [],
					sent: string[] = [],
					received: string[] = [];
				const context = yield* outside("browser", () => demo.browser.newContext());
				yield* outside("browser", () =>
					context.addInitScript(() => {
						globalThis.p23History = [];
						globalThis.p23Startup = [];
						for (const name of ["replaceState", "pushState"] as const) {
							const original = history[name].bind(history);
							history[name] = (state, title, url) => {
								globalThis.p23Startup.push(name);
								globalThis.p23History.push({name, state, url: String(url)});
								original(state, title, url);
							};
						}
						const openKey = IDBFactory.prototype.open;
						IDBFactory.prototype.open = function (
							this: IDBFactory,
							...args: Parameters<IDBFactory["open"]>
						) {
							globalThis.p23Startup.push("key");
							return openKey.apply(this, args);
						};
						const NativeWebSocket = WebSocket;
						globalThis.WebSocket = class extends NativeWebSocket {
							constructor(...args: ConstructorParameters<typeof NativeWebSocket>) {
								globalThis.p23Startup.push("socket");
								super(...args);
							}
						};
					}),
				);
				const page = yield* outside("browser", () => context.newPage());
				page.on("request", (request) => {
					capture.push({url: request.url(), headers: request.headers(), body: request.postData()});
				});
				page.on("response", (response) => {
					capture.push({
						url: response.url(),
						status: response.status(),
						headers: response.headers(),
					});
				});
				page.on("console", (message) => {
					capture.push({console: message.text()});
				});
				page.on("pageerror", (error) => {
					capture.push({error: error.message});
				});
				page.on("websocket", (socket) => {
					capture.push({socket: socket.url()});
					socket.on("framesent", ({payload}) => {
						sent.push(String(payload));
					});
					socket.on("framereceived", ({payload}) => {
						received.push(String(payload));
					});
				});
				// Open via the real native action, but navigate the network-capturing context to that exact URL.
				const opened = yield* openLink(demo);
				const url = Redacted.value(opened);
				const raw = new URL(url).hash.slice("#pass=".length);
				yield* outside("browser", () => page.goto(url));
				yield* visible(page, "Online");
				expect(page.url()).toBe(`${demo.url}/`);
				const history = yield* outside("browser", () =>
					page.evaluate(() => ({
						state: window.history.state,
						calls: globalThis.p23History,
						length: window.history.length,
						startup: globalThis.p23Startup,
					})),
				);
				expect(history.calls).toEqual([{name: "replaceState", state: null, url: "/"}]);
				expect(history.state).toBeNull();
				expect(history.startup[0]).toBe("replaceState");
				expect(history.startup.indexOf("key")).toBeGreaterThan(0);
				expect(history.startup.indexOf("socket")).toBeGreaterThan(0);
				expect(sent.filter((frame) => leaks(raw, frame))).toHaveLength(1);
				for (const frame of sent.filter((frame) => leaks(raw, frame)))
					expect(JSON.parse(frame).method).toBe("door.knock");
				const saved = {
					capture,
					received,
					sent: sent.filter((frame) => !leaks(raw, frame)),
					history,
					entries: yield* demo.entries,
					observations: yield* demo.observations,
					diagnostics: yield* demo.diagnostics,
				};
				expect(leaks(raw, saved)).toBe(false);
				expect(
					capture.some(
						(item) =>
							typeof item === "object" &&
							item !== null &&
							"status" in item &&
							item.status >= 300 &&
							item.status < 400,
					),
				).toBe(false);
				// A reload cannot send that pass again.
				yield* outside("browser", () => page.reload());
				yield* visible(page, "Online");
				expect(sent.filter((frame) => leaks(raw, frame))).toHaveLength(1);
			}),
	);
	// Plan reason: a fresh Chromium key must show its normal code and recover through the real Approve action.
	it.live(
		"scenario: used, expired and unknown links show a normal code and recover through Approve",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* outside("browser", () =>
					demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
				);
				yield* click(demo.window, "Start");
				yield* visible(demo.window, "Online");
				const first = yield* linkTab(demo);
				yield* visible(first.page, "Online");
				for (const state of ["used", "expired", "unknown"]) {
					const context = yield* outside("browser", () => demo.browser.newContext());
					const page = yield* outside("browser", () => context.newPage());
					let url = Redacted.value(first.opened);
					if (state === "unknown") url = `${demo.url}/#pass=${"x".repeat(43)}`;
					if (state === "expired") {
						const unused = yield* openLink(demo);
						url = Redacted.value(unused);
						// Only the main Effect clock moves. The real menu still decides whether the pass expired.
						yield* demo.expireLinks;
					}
					yield* outside("browser", () => page.goto(url));
					yield* visible(page, /waiting/i);
					expect(
						yield* outside("browser", () => page.getByRole("status", {name: /code/i}).innerText()),
					).toMatch(/\d{6}/);
					yield* demo.answerCheck("click");
					yield* click(demo.popover, "Approve");
					yield* visible(page, "Online");
				}
			}),
	);
	// Plan reason: a real waiting tab must become online after the native link action.
	it.live(
		"scenario: an already waiting key takes a fresh link without changing its code or adding a row",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* outside("browser", () =>
					demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
				);
				yield* click(demo.window, "Start");
				yield* visible(demo.window, "Online");
				const context = yield* outside("browser", () => demo.browser.newContext());
				const page = yield* outside("browser", () => context.newPage());
				yield* outside("browser", () => page.goto(demo.url));
				yield* visible(page, /waiting/i);
				const code = yield* outside("browser", () =>
					page.getByRole("status", {name: /code/i}).innerText(),
				);
				const opened = yield* openLink(demo);
				const row = demo.popover.getByText(code, {exact: true});
				expect(yield* outside("browser", () => row.count())).toBe(1);
				yield* outside("browser", () => page.goto(Redacted.value(opened)));
				yield* visible(page, "Online");
				const grants = (yield* demo.entries).filter(
					(entry) => entry.stream === "door/members" && entry._tag === "granted",
				);
				expect(grants).toHaveLength(1);
				expect(grants[0]?.body).toMatchObject({grant: {saw: {code, how: "link", check: "none"}}});
			}),
	);
	// Plan reason: all four built routes and the bound Host check must run against P12's real stage.
	it.live(
		"scenario: the real stage preserves bound Host and serves all four built routes directly",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* outside("browser", () =>
					demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
				);
				yield* click(demo.window, "Start");
				yield* visible(demo.window, "Online");
				const cases = Schema.Struct({
					method: Schema.Literals(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]),
					word: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,16}$/)),
				});
				const checked = yield* Arbitrary.checkEffect(
					Arbitrary.schema(cases),
					({method, word}) =>
						Effect.gen(function* () {
							for (const path of ["/", "/electron", "/browser.js", "/electron.js"]) {
								const response = yield* outside("stage", () =>
									fetch(`${demo.url}${path}`, {method, redirect: "manual"}),
								);
								expect(response.status).toBe(method === "GET" || method === "HEAD" ? 200 : 405);
								expect(response.headers.has("location")).toBe(false);
								if (method === "HEAD")
									expect(yield* outside("stage", () => response.text())).toBe("");
								const wrong = yield* outside("stage", () =>
									fetch(`${demo.url}${path}`, {
										method,
										headers: {host: `${word}.example`},
										redirect: "manual",
									}),
								);
								expect(wrong.status).toBeGreaterThanOrEqual(400);
							}
							const unknown = yield* outside("stage", () =>
								fetch(`${demo.url}/unknown/${word}`, {redirect: "manual"}),
							);
							expect(unknown.status).toBe(404);
							return true;
						}),
					{seed: 119120, runs: 40, size: 64},
				);
				expect(checked).toMatchObject({_tag: "Passed"});
			}),
	);
});
