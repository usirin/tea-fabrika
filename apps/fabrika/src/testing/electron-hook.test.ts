// Today's app. Build supplies this .cjs module and its .d.cts contract.
// install({app, screen, id, pid, now, write}) returns {report(): WindowReport}.
// write receives the report synchronously; auto-install exposes the same object as __fabrikaE2E.
import {EventEmitter} from "node:events";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {install} from "./electron-hook.cjs";
import {createElectronRunner, type WindowReport} from "./electron-launch.ts";

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}
// fast-check: edge cases -- independent screen/window bounds exercise platform limits, not a domain Schema.
const bounds = fc.record({
	x: fc.integer({min: -20000, max: 20000}),
	y: fc.integer({min: -20000, max: 20000}),
	width: fc.integer({min: 1, max: 20000}),
	height: fc.integer({min: 1, max: 20000}),
});
const options = {seed: 119120, numRuns: 100};

class FakeWindow extends EventEmitter {
	opacity = 1;
	ignoresMouse = false;
	focused = false;
	destroyed = false;
	throwMouse = false;
	throwOpacity = false;
	readback: number | undefined;
	positionWrites = 0;
	readonly calls: Array<{method: string; args: unknown[]; receiver: unknown}> = [];
	constructor(
		readonly id: number,
		private bounds: Bounds,
	) {
		super();
	}
	getBounds() {
		if (this.destroyed) throw new Error("native window destroyed");
		return {...this.bounds};
	}
	getPosition() {
		if (this.destroyed) throw new Error("native window destroyed");
		return [this.bounds.x, this.bounds.y];
	}
	getSize() {
		if (this.destroyed) throw new Error("native window destroyed");
		return [this.bounds.width, this.bounds.height];
	}
	getOpacity() {
		if (this.destroyed) throw new Error("native window destroyed");
		return this.readback ?? this.opacity;
	}
	isFocused() {
		return this.focused;
	}
	isDestroyed() {
		return this.destroyed;
	}
	setOpacity(value: number) {
		this.calls.push({method: "opacity", args: [value], receiver: this});
		if (this.throwOpacity) throw new Error("native opacity failure");
		this.opacity = value;
		return "opacity-result";
	}
	setIgnoreMouseEvents(value: boolean, options?: {forward: boolean}) {
		this.calls.push({
			method: "mouse",
			args: options === undefined ? [value] : [value, options],
			receiver: this,
		});
		if (this.throwMouse) throw new Error("native mouse failure");
		this.ignoresMouse = value;
		return "mouse-result";
	}
	setPosition(x: number, y: number) {
		this.calls.push({method: "position", args: [x, y], receiver: this});
		if (++this.positionWrites > 100) throw new Error("recursive native move");
		this.bounds = {...this.bounds, x, y};
		this.emit("move");
	}
	setBounds(value: Partial<Bounds>) {
		this.bounds = {...this.bounds, ...value};
		this.emit("move");
		this.emit("resize");
	}
	showInactive() {
		this.calls.push({method: "showInactive", args: [], receiver: this});
	}
	close() {
		this.destroyed = true;
		this.emit("closed");
	}
}
const fixture = (initial: Bounds) => {
	const app = Object.assign(new EventEmitter(), {
		ready: false,
		isReady() {
			return this.ready;
		},
	});
	let area = {...initial};
	const screen = Object.assign(new EventEmitter(), {
		getPrimaryDisplay() {
			if (!app.ready) throw new Error("screen read before ready");
			return {workArea: {...area}};
		},
	});
	const written: WindowReport[] = [];
	let clock = 0;
	const hook = install({
		app,
		screen,
		id: "hook-law",
		pid: 321,
		now: () => ++clock,
		write: (report: WindowReport) => {
			written.push(structuredClone(report));
		},
	});
	app.ready = true;
	return {
		app,
		screen,
		written,
		hook,
		create(id: number, b: Bounds) {
			const window = new FakeWindow(id, b);
			app.emit("browser-window-created", {}, window);
			window.showInactive();
			return window;
		},
		area(next: Bounds) {
			area = {...next};
			screen.emit("display-metrics-changed", {}, {workArea: area}, ["workArea"]);
		},
	};
};

// Keep the original report in its original phase: inspect at startup or read after close.
// An independent, safe hook lifetime supplies the other phase.
const runReport = (report: unknown, complete: boolean, live: readonly number[] = []) => {
	const baseline = fixture({x: 0, y: 0, width: 800, height: 600});
	baseline.create(1, {x: 0, y: 0, width: 400, height: 300});
	const startup = baseline.hook.report();
	baseline.app.emit("quit");
	const runner = createElectronRunner({
		id: () => "hook-law",
		executable: () => "/fake/electron",
		launch: async () => ({}),
		inspect: async () => ({report: complete ? startup : report, live}),
		close: async () => {},
		read: async () => JSON.stringify(complete ? report : baseline.written.at(-1)),
	});
	return runner.runE2e(async () => {
		await runner.launchElectron({home: "test-home", env: {}});
	});
};

describe("Electron startup hook", () => {
	it("sets opacity, mouse-ignore and corner synchronously before every simulated showInactive", async () => {
		await fc.assert(
			fc.asyncProperty(bounds, bounds, async (b, area) => {
				const f = fixture(area);
				const w = f.create(1, b);
				expect(w.opacity).toBe(0);
				expect(w.ignoresMouse).toBe(true);
				expect(w.getBounds()).toEqual({...b, x: area.x, y: area.y});
				expect(w.calls.slice(0, 2).map((c) => [c.method, ...c.args])).toEqual([
					["opacity", 0],
					["mouse", true],
				]);
				expect(w.calls.at(-1)?.method).toBe("showInactive");
				await expect(runReport(f.hook.report(), false, [1])).resolves.toBeUndefined();
			}),
			options,
		);
	});

	it("moves, resizes and display changes preserve requested sizes and settle without recursion", async () => {
		// fast-check: edge cases -- a fake native event schedule has no Schema equivalent.
		await fc.assert(
			fc.asyncProperty(
				bounds,
				bounds,
				fc.array(fc.record({kind: fc.constantFrom("move", "resize", "display"), bounds}), {
					minLength: 0,
					maxLength: 40,
				}),
				async (b, initial, events) => {
					const f = fixture(initial);
					const w = f.create(1, b);
					let area = initial;
					let wanted = b;
					for (const event of events) {
						const before = w.positionWrites;
						if (event.kind === "display") {
							area = event.bounds;
							f.area(area);
						} else {
							wanted = event.bounds;
							w.setBounds(wanted);
						}
						expect(w.getBounds()).toEqual({...wanted, x: area.x, y: area.y});
						expect(w.positionWrites - before).toBeLessThanOrEqual(1);
						const settled = w.positionWrites;
						w.emit("move");
						w.emit("resize");
						expect(w.positionWrites).toBe(settled);
					}
					await expect(runReport(f.hook.report(), false, [1])).resolves.toBeUndefined();
				},
			),
			options,
		);
	});

	it("covers reopened windows and retains closed-window history in the synchronous quit report", async () => {
		// fast-check: edge cases -- generated window lifetimes include closures and later creations.
		await fc.assert(
			fc.asyncProperty(
				bounds,
				fc.array(bounds, {minLength: 1, maxLength: 8}),
				async (area, windows) => {
					const f = fixture(area);
					for (const [index, b] of windows.entries()) {
						f.create(index + 1, b).close();
						expect(f.written.at(-1)?.windows).toHaveLength(index + 1);
					}
					f.app.emit("activate");
					const reopened = f.create(windows.length + 1, area);
					expect(reopened.ignoresMouse).toBe(true);
					f.app.emit("quit");
					const report = f.written.at(-1);
					expect(report?.complete).toBe(true);
					expect(report?.windows.map((w) => [w.id, w.closed])).toEqual([
						...windows.map((_, i) => [i + 1, true]),
						[windows.length + 1, false],
					]);
					await expect(runReport(report, true)).resolves.toBeUndefined();
				},
			),
			options,
		);
	});

	it("retains transient positive opacity, enabled mouse and native focus after safe restoration and closure", async () => {
		// fast-check: edge cases -- generated bad calls intentionally leave the safe-state Schema.
		await fc.assert(
			fc.asyncProperty(
				bounds,
				fc.array(fc.constantFrom("opacity", "mouse", "focus", "close"), {
					minLength: 0,
					maxLength: 40,
				}),
				async (area, schedule) => {
					for (const fault of ["opacity", "mouse", "focus"]) {
						const f = fixture(area);
						let id = 1;
						let w = f.create(id, area);
						for (const event of [...schedule, fault]) {
							if (event === "close") {
								w.close();
								w = f.create(++id, area);
							} else if (event === "opacity") {
								w.setOpacity(0.5);
								w.setOpacity(0);
							} else if (event === "mouse") {
								w.setIgnoreMouseEvents(false);
								w.setIgnoreMouseEvents(true);
							} else {
								f.app.emit("browser-window-focus", {}, w);
								w.focused = false;
							}
						}
						w.close();
						f.app.emit("quit");
						await expect(runReport(f.written.at(-1), true)).rejects.toThrow();
					}
				},
			),
			options,
		);
	});

	it("preserves native receivers, full setter arguments and returns; thrown setters never record success", async () => {
		// fast-check: edge cases -- native throws and extra setter arguments are platform behavior.
		await fc.assert(
			fc.asyncProperty(
				bounds,
				fc.boolean(),
				fc.boolean(),
				async (area, forward, opacityFailure) => {
					const f = fixture(area);
					const w = f.create(1, area);
					const args = {forward};
					expect(w.setIgnoreMouseEvents(true, args)).toBe("mouse-result");
					expect(w.calls.at(-1)).toEqual({method: "mouse", args: [true, args], receiver: w});
					expect(w.setOpacity(0)).toBe("opacity-result");
					w.throwMouse = !opacityFailure;
					w.throwOpacity = opacityFailure;
					expect(() =>
						opacityFailure ? w.setOpacity(0.75) : w.setIgnoreMouseEvents(false, args),
					).toThrow("native");
					const failed = f.hook
						.report()
						.windows.flatMap((window) => window.records)
						.filter((r) => r._tag === (opacityFailure ? "opacity" : "mouse"))
						.at(-1);
					expect(failed).toMatchObject({ok: false, error: expect.any(String)});
					expect(failed && "value" in failed ? failed.value : undefined).toBeUndefined();
					await expect(runReport(f.hook.report(), false)).rejects.toThrow();
				},
			),
			options,
		);
	});

	it("records setup failures and focus emitted before window creation", async () => {
		// fast-check: edge cases -- startup native failures and early focus cannot be a valid report.
		await fc.assert(
			fc.asyncProperty(
				bounds,
				fc.constantFrom("opacity", "mouse", "focus", "readback"),
				async (area, fault) => {
					const f = fixture(area);
					const w = new FakeWindow(1, area);
					w.throwOpacity = fault === "opacity";
					w.throwMouse = fault === "mouse";
					w.readback = fault === "readback" ? 1 : undefined;
					if (fault === "focus") f.app.emit("browser-window-focus", {}, w);
					try {
						f.app.emit("browser-window-created", {}, w);
					} catch {
						/* A setup failure may also abort construction. */
					}
					f.app.emit("quit");
					await expect(runReport(f.written.at(-1), true)).rejects.toThrow();
				},
			),
			options,
		);
	});
});
