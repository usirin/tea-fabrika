// P24, next/. Local twins only in CI. The lead calls smoke({stage: "cloud", url, home}) after
// the owner-approved deploy. No environment variable silently turns a test into a cloud run.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema, Scope} from "effect";
import type {Browser} from "playwright";
import {
	assertWake,
	localOff,
	protocol,
	protocolKey,
	processId,
	smoke,
	SmokeError,
} from "./cloud.test-support.ts";

describe("P24 real stages", () => {
	it.effect("scenario: p33 one completed off file boots after copying it alone", () =>
		Effect.gen(function* () {
			const stage = yield* localOff();
			const reply = yield* Effect.promise(() => fetch(stage.url));
			expect(reply.ok).toBe(true);
			expect(stage.sha256).toMatch(/^[a-f0-9]{64}$/);
			// No source, chunks, window directory or node_modules sit beside this file.
			const {readdirSync} = yield* Effect.promise(() => import("node:fs"));
			expect(readdirSync(join(stage.home, "alone"))).toEqual(["brain.mjs"]);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
	it.effect(
		"scenario: p38 the exact off file performs counter work and real P13 notes save/read",
		() =>
			Effect.gen(function* () {
				const stage = yield* localOff(true);
				const report = yield* smoke({url: stage.url, home: stage.home, stage: "local"});
				expect(report.sha256).toBe(stage.sha256);
				expect(report.checks.find((check) => check.name === "counter and real notes")?.passed).toBe(
					true,
				);
				expect(report.samples.map((sample) => sample.measure).sort()).toEqual([
					"cold_wake",
					"first_answer",
					"isolate_cold_load",
					"press_to_count",
					"reconnect",
				]);
			}).pipe(Effect.provide(NodeServices.layer)),
	);
	it.effect(
		"scenario: sleep restores the parked wait and new instances preserve program life",
		() =>
			Effect.gen(function* () {
				const stage = yield* localOff(true);
				const report = yield* smoke({url: stage.url, home: stage.home, stage: "local"});
				expect(
					report.checks.find((check) => check.name === "parked wait survived a confirmed wake")
						?.passed,
				).toBe(true);
				expect(report.samples.find((sample) => sample.measure === "cold_wake")?.ms).not.toBeNull();
			}).pipe(Effect.provide(NodeServices.layer)),
	);
	it.effect("scenario: cold-load readings require first callback and actual first execution", () =>
		Effect.gen(function* () {
			const stage = yield* localOff(true);
			const report = yield* smoke({url: stage.url, home: stage.home, stage: "local"});
			expect(
				report.checks.find((check) => check.name === "new loader cache key actually executed")
					?.passed,
			).toBe(true);
			expect(
				report.samples.find((sample) => sample.measure === "isolate_cold_load")?.ms,
			).not.toBeNull();
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("P24 Electron menu and browser", () => {
	it.effect(
		"scenario: same-key rows, cloud check, Deny, Remove and failed cloud stay stage-bound",
		() =>
			Effect.gen(function* () {
				const {launchP23} = yield* Effect.promise(() => import("./p23.test-support.ts"));
				const desktopPackage = "@kampus/libfabrika/desktop";
				const {installCloudLink} = yield* Effect.promise(() => import(desktopPackage));
				const local = yield* localOff();
				const cloudScope = yield* Scope.make();
				yield* Effect.addFinalizer(() => Scope.close(cloudScope, Exit.void));
				const cloud = yield* localOff(false, "p24-cloud").pipe(
					Effect.provideService(Scope.Scope, cloudScope),
				);
				// The twin uses HTTP loopback, but must still be named as a second ledger by /door.
				yield* installCloudLink(local.home, {url: cloud.url, ledger: "p24-cloud"});
				const app = yield* launchP23({
					home: local.home,
					label: "p24-menu",
					layout: "one",
					look: "dark",
					brain: "stand-in",
					seal: "stand-in",
				});
				const sharedKey = protocolKey();
				const localClient = yield* protocol(local.url, "p24-local-tab", sharedKey),
					cloudClient = yield* protocol(cloud.url, "p24-cloud-tab", sharedKey);
				yield* localClient.call("door.knock", {label: "P24 Local"});
				yield* cloudClient.call("door.knock", {label: "P24 Cloud"});
				const localRow = app.popover.getByRole("group", {name: /Local/});
				const cloudRow = app.popover.getByRole("group", {name: /Cloud/});
				expect(yield* Effect.promise(() => localRow.getByText("P24 Local").isVisible())).toBe(true);
				expect(yield* Effect.promise(() => cloudRow.getByText("P24 Cloud").isVisible())).toBe(true);
				const before = yield* app.entries;
				yield* Effect.promise(() => cloudRow.getByRole("button", {name: /Approve/}).click());
				yield* app.answerCheck("no");
				expect(yield* app.entries).toEqual(before);
				yield* Effect.promise(() => cloudRow.getByRole("button", {name: /Approve/}).click());
				yield* app.answerCheck("click");
				yield* Effect.promise(() =>
					expect.poll(() => cloudClient.notices.some((n: any) => n.ready)).toBe(true),
				);
				expect(localClient.notices.some((n) => n.ready)).toBe(false);
				const pid = yield* processId(cloudClient, "counter:1");
				expect(
					(yield* cloudClient.call("process.send", {
						pid,
						letter: "p24-cloud-once",
						m: {type: "inc"},
						sentAt: new Date().toISOString(),
						seen: 0,
					})).result._tag,
				).toBe("accepted");
				yield* Effect.promise(() => cloudRow.getByRole("button", {name: /Remove/}).click());
				yield* app.answerCheck("click");
				yield* Effect.promise(() =>
					expect.poll(() => cloudClient.notices.some((n) => n.closed === 4003)).toBe(true),
				);
				yield* Effect.promise(() => localRow.getByRole("button", {name: /Deny/}).click());
				yield* Effect.promise(() =>
					expect
						.poll(() => localClient.notices.some((n) => n.method === "client.denied"))
						.toBe(true),
				);
				// Kill the cloud transport only. Local refresh must remain usable and show a failure on Cloud.
				yield* Scope.close(cloudScope, Exit.void);
				yield* Effect.promise(() => localRow.getByRole("button", {name: /Refresh/}).click());
				expect(yield* Effect.promise(() => localRow.getByText(/Local/).first().isVisible())).toBe(
					true,
				);
				expect(
					yield* Effect.promise(() =>
						cloudRow.getByText(/unavailable|error|disconnected/i).isVisible(),
					),
				).toBe(true);
				expect((yield* app.diagnostics).join("\n")).not.toContain("PRIVATE KEY");
			}).pipe(Effect.provide(NodeServices.layer)),
	);
	it.effect(
		"scenario: P23 cloud one-time link clears its fragment, grants once and quits without stopping cloud",
		() =>
			Effect.gen(function* () {
				const home = yield* Effect.acquireRelease(
					Effect.sync(() => mkdtempSync("/tmp/fh.")),
					(home) => Effect.sync(() => rmSync(home, {recursive: true, force: true})),
				);
				const {launchP23} = yield* Effect.promise(() => import("./p23.test-support.ts"));
				const twin = yield* localOff(false, "p24-cloud");
				writeFileSync(
					join(home, "cloud.json"),
					JSON.stringify({url: twin.url, ledger: "p24-cloud"}),
				);
				writeFileSync(join(home, "stage.json"), JSON.stringify({stage: "cloud"}));
				const app = yield* launchP23({
					home,
					label: "p24-cloud-window",
					layout: "one",
					look: "dark",
					brain: "stand-in",
					seal: "stand-in",
				});
				yield* Effect.promise(() =>
					app.popover
						.getByRole("group", {name: /Cloud/})
						.getByRole("button", {name: /Open in browser/})
						.click(),
				);
				expect(app.url).toBe(twin.url);
				const before = yield* app.entries;
				const opened = yield* app.takeOpened;
				const {Redacted} = yield* Effect.promise(() => import("effect"));
				const browser: Browser = app.browser;
				const context = yield* Effect.promise(() => browser.newContext());
				const page = yield* Effect.promise(() => context.newPage());
				// Only the real sending point unwraps the pass; it is never printed or saved.
				yield* Effect.tryPromise({
					try: () => page.goto(Redacted.value(opened)),
					catch: () => new SmokeError({why: "browser_open"}),
				});
				yield* Effect.promise(() => expect.poll(() => new URL(page.url()).hash === "").toBe(true));
				yield* Effect.promise(() => page.getByRole("button", {name: /Add one/}).click());
				const after = yield* app.entries;
				expect(
					after.filter((entry: any) => entry._tag === "granted").length -
						before.filter((entry: any) => entry._tag === "granted").length,
				).toBe(1);
				const secondContext = yield* Effect.promise(() => browser.newContext());
				const second = yield* Effect.promise(() => secondContext.newPage());
				yield* Effect.tryPromise({
					try: () => second.goto(Redacted.value(opened)),
					catch: () => new SmokeError({why: "browser_open"}),
				});
				yield* Effect.promise(() =>
					second
						.getByText(/code|waiting|approve/i)
						.first()
						.waitFor(),
				);
				expect((yield* app.entries).filter((entry: any) => entry._tag === "granted")).toEqual(
					after.filter((entry: any) => entry._tag === "granted"),
				);
				yield* app.quit;
				expect((yield* Effect.promise(() => fetch(twin.url))).ok).toBe(true);
				const diagnostic = (yield* app.diagnostics).join("\n");
				expect(diagnostic).not.toMatch(/brain\.start|PRIVATE KEY|#pass=/);
			}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("P24 stage plants", () => {
	it.prop(
		"plants: a warm call, replacement process and lost wait cannot count as an idle wake",
		{n: Schema.Int},
		({n}) => {
			const process = `process-${n}`;
			const before = [
				{
					name: "object.wake",
					resource: {attributes: {object: "project"}},
					attributes: {instance: "instance_old", process},
				},
			];
			expect(() => assertWake(before, before, process)).toThrow();
			expect(() =>
				assertWake(before, [...before, {name: "restarted", attributes: {process}}], process),
			).toThrow();
			const lost = Effect.runSync(Effect.exit(Effect.fail("parked wait lost")));
			expect(Exit.isFailure(lost)).toBe(true);
		},
		{arbitrary: {seed: 119120, runs: 100, size: 100}},
	);
});
