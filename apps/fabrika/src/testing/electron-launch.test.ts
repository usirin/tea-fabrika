// Today's app. Fake I/O tests the judge independently of build's recorder.
import {isAbsolute, dirname} from "node:path";
import {Arbitrary, Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	checkWindowReport,
	createElectronRunner,
	Report,
	type WindowReport,
} from "./electron-launch.ts";

const options = {seed: 119120, numRuns: 50};
type Record = WindowReport["windows"][number]["records"][number];
const safe = (id: string, complete: boolean, n = 1): WindowReport => ({
	version: 1,
	id,
	pid: 123,
	installed: true,
	complete,
	windows: Array.from({length: n}, (_, index) => ({
		id: index + 1,
		closed: complete,
		records: [
			{_tag: "opacity", at: 0, ok: true, setup: true, requested: 0, value: 0},
			{_tag: "mouse", at: 1, ok: true, setup: true, requested: true, value: true},
			{
				_tag: "setup",
				at: 2,
				ok: true,
				state: {
					opacity: 0,
					ignoresMouse: true,
					focused: false,
					bounds: {x: -100, y: 24, width: 20000, height: 15000},
					area: {x: -100, y: 24, width: 800, height: 600},
				},
			},
			...(complete ? [{_tag: "closed" as const, at: 3}] : []),
		],
	})),
});
const fixture = (bad: (report: WindowReport) => unknown = (r) => r) => {
	let seq = 0;
	const calls: Array<{args: string[]; env: NodeJS.ProcessEnv; cwd?: string}> = [];
	const closed: string[] = [];
	const reads: string[] = [];
	const runner = createElectronRunner({
		id: () => `launch-${++seq}`,
		executable: () => "/fake/electron",
		launch: async (input) => {
			calls.push(input);
			return {id: input.env.FABRIKA_E2E_ID ?? ""};
		},
		inspect: async (app) => ({report: safe(app.id, false), live: [1]}),
		close: async (app) => {
			closed.push(app.id);
		},
		read: async (path) => {
			reads.push(path);
			expect(closed.length).toBe(calls.length);
			const id = calls.find((c) => c.env.FABRIKA_E2E_REPORT === path)?.env.FABRIKA_E2E_ID ?? "";
			return JSON.stringify(bad(safe(id, true)));
		},
	});
	return {...runner, calls, closed, reads};
};

describe("Electron window law", () => {
	it("installs CJS before the app, copies the environment, keeps cwd and isolates repeated homes", async () => {
		// fast-check: edge cases -- foreign environment fields and optional paths are launcher inputs.
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					extra: fc.dictionary(fc.stringMatching(/^[A-Z]{1,12}$/), fc.string()),
					home: fc.stringMatching(/^[a-z]{1,12}$/),
					cwd: fc.option(fc.stringMatching(/^[a-z]{1,12}$/), {nil: undefined}),
					count: fc.integer({min: 2, max: 5}),
				}),
				async ({extra, home, cwd, count}) => {
					const env = {...extra, FABRIKA_FOREGROUND: "1", FABRIKA_HOME: "wrong", FAKE_AGENT: "yes"};
					const before = {...env};
					const f = fixture();
					await f.runE2e(async () => {
						for (let i = 0; i < count; i++)
							await f.launchElectron({home, env, ...(cwd === undefined ? {} : {cwd})});
					});
					expect(env).toEqual(before);
					expect(new Set(f.reads).size).toBe(count);
					for (const call of f.calls) {
						expect(call.args[0]).toBe("-r");
						expect(call.args[1]).toMatch(/\/src\/testing\/electron-hook\.cjs$/);
						expect(call.args[2]).toMatch(/\/apps\/fabrika$/);
						expect(call.args.every((a) => a === "-r" || isAbsolute(a))).toBe(true);
						expect(call.env).toMatchObject({
							...extra,
							FABRIKA_HOME: home,
							FAKE_AGENT: "yes",
							FABRIKA_E2E_ID: expect.any(String),
						});
						expect(call.env.FABRIKA_FOREGROUND).toBeUndefined();
						expect(call.env.NODE_OPTIONS).toBe(extra.NODE_OPTIONS);
						expect(dirname(call.env.FABRIKA_E2E_REPORT ?? "")).toBe(home);
						expect(call.cwd).toBe(cwd);
					}
				},
			),
			options,
		);
	});

	it("accepts safe histories drawn from the report Schema's Effect Arbitrary", async () => {
		const result = await Effect.runPromise(
			Arbitrary.checkEffect(
				Arbitrary.schema(Report),
				(report) => {
					const good = safe(report.id, true, Math.max(1, report.windows.length));
					const windows = good.windows.map((w, index) => {
						const sample = report.windows[index]?.records.find(
							(r) => r._tag === "setup" || r._tag === "bounds",
						);
						const state = sample && "state" in sample ? sample.state : undefined;
						return {
							...w,
							records: w.records.map((r) =>
								r._tag === "setup" && r.state && state
									? {
											...r,
											state: {
												...r.state,
												bounds: {...state.bounds, x: state.area.x, y: state.area.y},
												area: state.area,
											},
										}
									: r,
							),
						};
					});
					const input = {...good, pid: report.pid, windows};
					expect(
						checkWindowReport(Schema.decodeUnknownSync(Report)(input), report.id, true),
					).toEqual(input);
					return true;
				},
				{seed: 119120, runs: 50},
			),
		);
		expect(result._tag).toBe("Passed");
	});

	it("rejects bad history after safe restoration, including closed windows and missing setup", () => {
		// fast-check: edge cases -- malicious histories must be generated outside the valid Schema.
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 8}),
				fc.array(fc.constantFrom("opacity", "mouse", "focus"), {minLength: 1, maxLength: 40}),
				(count, events) => {
					const good = safe("history", true, count);
					expect(() => checkWindowReport(good, "history", true)).not.toThrow();
					for (const event of events) {
						const bad: Record =
							event === "focus"
								? {_tag: "focus", at: 3}
								: event === "opacity"
									? {_tag: "opacity", at: 3, ok: true, setup: false, requested: 0.5, value: 0.5}
									: {_tag: "mouse", at: 3, ok: true, setup: false, requested: false, value: false};
						const restore: Record =
							event === "opacity"
								? {_tag: "opacity", at: 4, ok: true, setup: false, requested: 0, value: 0}
								: {_tag: "mouse", at: 4, ok: true, setup: false, requested: true, value: true};
						const report = {
							...good,
							windows: good.windows.map((w, i) =>
								i === count - 1
									? {
											...w,
											records: [...w.records.slice(0, -1), bad, restore, {_tag: "closed", at: 5}],
										}
									: w,
							),
						};
						expect(() => checkWindowReport(report, "history", true)).toThrow();
					}
					for (const tag of ["opacity", "mouse", "setup"])
						expect(() =>
							checkWindowReport(
								{
									...good,
									windows: good.windows.map((w) => ({
										...w,
										records: w.records.filter((r) => r._tag !== tag),
									})),
								},
								"history",
								true,
							),
						).toThrow();
				},
			),
			{seed: 119120, numRuns: 100},
		);
	});

	it("rejects missing, malformed, stale, empty and unfinished reports after cleanup despite catches", async () => {
		// fast-check: edge cases -- invalid reports and body failures intentionally violate the contract.
		await fc.assert(
			fc.asyncProperty(fc.string(), fc.boolean(), async (text, failBody) => {
				const bodyError = new Error(`body:${text}`);
				const corruptions: Array<(r: WindowReport) => unknown> = [
					() => undefined,
					() => text,
					(r) => ({...r, id: `stale:${r.id}`}),
					(r) => ({...r, windows: []}),
					(r) => ({...r, complete: false}),
					(r) => ({...r, installed: false}),
					(r) => ({...r, windows: [{id: 1, closed: true, records: []}]}),
				];
				for (const corrupt of corruptions) {
					const f = fixture(corrupt);
					const pending = f.runE2e(async () => {
						await f.launchElectron({home: "test-home", env: {}});
						await f.launchElectron({home: "test-home", env: {}});
						if (failBody) throw bodyError;
					});
					const error = await pending.then(
						() => null,
						(e: unknown) => e,
					);
					expect(error).toBeInstanceOf(AggregateError);
					expect(f.closed).toHaveLength(2);
					expect(f.reads).toHaveLength(2);
					expect((error as AggregateError).errors.includes(bodyError)).toBe(failBody);
				}
			}),
			options,
		);
	});

	it("keeps startup, read and close failures even when the body catches launch errors", async () => {
		// fast-check: edge cases -- native startup and I/O failures have no successful report Schema.
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("missing", "live", "read", "json", "close", "launch"),
				fc.string(),
				async (failure, text) => {
					const original = new Error(text);
					const order: string[] = [];
					const runner = createElectronRunner({
						id: () => "failed",
						executable: () => "/fake/electron",
						launch: async () => {
							if (failure === "launch") throw original;
							return {};
						},
						inspect: async () => ({
							report: failure === "missing" ? undefined : safe("failed", false),
							live: failure === "live" ? [1, 2] : [1],
						}),
						close: async () => {
							order.push("close");
							if (failure === "close") throw original;
						},
						read: async () => {
							order.push("read");
							if (failure === "read" || failure === "launch") throw original;
							if (failure === "json") return `\u0000${text}`;
							return JSON.stringify(safe("failed", true));
						},
					});
					await expect(
						runner.runE2e(async () => {
							await runner.launchElectron({home: "home", env: {}}).catch(() => {});
						}),
					).rejects.toThrow("window law");
					expect(order.at(-1)).toBe("read");
					expect(order.indexOf("close") < order.indexOf("read") || failure === "launch").toBe(true);
				},
			),
			options,
		);
	});

	it("rejects failed setup, missing setter results and settled bounds away from the corner", () => {
		// fast-check: edge cases -- malformed native evidence must fail, including after restoration.
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 20000}),
				fc.constantFrom("setup", "bounds", "mouse", "opacity"),
				(offset, fault) => {
					const good = safe("invalid", true);
					const bad = good.windows.map((w) => ({
						...w,
						records:
							fault === "bounds"
								? [...w.records, {_tag: "bounds" as const, at: 4, ok: false, error: "move failed"}]
								: w.records.map((r) => {
										if (r._tag !== fault) return r;
										if (r._tag === "setup") return {...r, ok: false, error: "setup failed"};
										return {...r, value: undefined};
									}),
					}));
					expect(() => checkWindowReport({...good, windows: bad}, "invalid", true)).toThrow();
					const misplaced = good.windows.map((w) => ({
						...w,
						records: w.records.map((r) =>
							r._tag === "setup" && r.state
								? {
										...r,
										state: {...r.state, bounds: {...r.state.bounds, x: r.state.area.x + offset}},
									}
								: r,
						),
					}));
					expect(() => checkWindowReport({...good, windows: misplaced}, "invalid", true)).toThrow(
						"corner",
					);
				},
			),
			{seed: 119120, numRuns: 100},
		);
	});
});
