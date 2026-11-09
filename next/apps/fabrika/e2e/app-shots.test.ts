import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
// P23, next/. scenario: real built windows, all five layouts and both looks.
// This box cannot launch Electron or Chromium. The driver runs and inspects these images later.
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import type {Page} from "playwright";
import {click, freshHome, launchP23, linkTab, outside, visible} from "./p23.test-support.ts";

const inspections: Array<{file: string; inspected: boolean}> = [];

const shot = (
	page: Page,
	state: string,
	layout: string,
	look: string,
	demo: import("./p23.test-support.ts").Demo,
) =>
	Effect.gen(function* () {
		const controls = yield* outside("browser", () =>
			page.getByRole("button").evaluateAll((buttons) =>
				buttons.map((button) => {
					const box = button.getBoundingClientRect();
					let scrollable = false;
					for (let parent = button.parentElement; parent; parent = parent.parentElement) {
						const style = getComputedStyle(parent);
						if (
							["auto", "scroll"].includes(style.overflowY) &&
							parent.scrollHeight > parent.clientHeight
						)
							scrollable = true;
					}
					return {
						text: button.textContent,
						x: box.x,
						y: box.y,
						width: box.width,
						height: box.height,
						viewport: {width: innerWidth, height: innerHeight},
						hidden: getComputedStyle(button).visibility === "hidden",
						scrollable,
					};
				}),
			),
		);
		for (const box of controls.filter((box) => !box.hidden && box.width > 0 && box.height > 0)) {
			expect(box.x, box.text).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width, box.text).toBeLessThanOrEqual(box.viewport.width);
			if (!box.scrollable) {
				expect(box.y, box.text).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height, box.text).toBeLessThanOrEqual(box.viewport.height);
			}
		}
		const folder =
			state.startsWith("online-") || state.startsWith("queued-") || state.startsWith("recovered-")
				? "next/programs/counter/docs/p23"
				: "next/apps/fabrika/docs/p23";
		const root = resolve(import.meta.dirname, "../../../..");
		const name = `${state}-${layout}-${look}`;
		yield* Effect.sync(() => mkdirSync(join(root, folder), {recursive: true}));
		const image = yield* outside("browser", () =>
			page.screenshot({path: join(root, folder, `${name}.png`), fullPage: true}),
		);
		expect(image.byteLength).toBeGreaterThan(0);
		const diagnostics = yield* demo.diagnostics;
		expect(diagnostics.some((line) => /^build [a-f0-9]{64}$/.test(line))).toBe(true);
		// Save only relative paths and build evidence. The lead supplies an inspection for every image.
		const reviewPath = process.env.P23_SHOT_REVIEW;
		const review = yield* Effect.try({
			try: () =>
				reviewPath
					? Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.NonEmptyString))(
							JSON.parse(readFileSync(reviewPath, "utf8")),
						)[name]
					: undefined,
			catch: () => new Error("missing screenshot inspection fixture P23_SHOT_REVIEW"),
		});
		const manifest = {
			file: `${name}.png`,
			state,
			layout,
			look,
			viewport: page.viewportSize(),
			controls,
			diagnostics,
			inspected: typeof review === "string" && review.trim().length > 0,
			review: review ?? null,
		};
		yield* Effect.sync(() =>
			writeFileSync(join(root, folder, `${name}.json`), JSON.stringify(manifest, null, 2)),
		);
		inspections.push(manifest);
		return manifest;
	});
describe("P23 screenshot and usability matrix", () => {
	// Capture every state before asking the saved inspection fixture to account for each image.
	afterAll(() => {
		for (const image of inspections)
			expect(
				image.inspected,
				`${image.file}: missing image inspection fixture P23_SHOT_REVIEW`,
			).toBe(true);
	});
	for (const look of ["dark", "light"] as const)
		for (const layout of ["one", "side", "stacked", "2x2", "small"] as const) {
			// Plan reason: screenshots and inspection in every required state, layout and look need real built windows.
			it.live(
				`scenario: ${layout} ${look} real counters remain usable online, queued and recovered`,
				() =>
					Effect.gen(function* () {
						const home = yield* freshHome();
						const demo = yield* launchP23({
							home,
							label: `test.p23.${home.split("/").at(-1)}`,
							layout,
							look,
							brain: "stand-in",
							seal: "stand-in",
						});
						yield* outside("browser", () =>
							demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
						);
						yield* click(demo.window, "Start");
						yield* visible(demo.window, "Online");
						const browser = yield* linkTab(demo);
						yield* visible(browser.page, "Online");
						const size =
							layout === "small" ? {width: 1024, height: 700} : {width: 1440, height: 1000};
						yield* outside("browser", () => browser.page.setViewportSize(size));
						const expected = layout === "2x2" ? 4 : layout === "one" || layout === "small" ? 1 : 2;
						for (const page of [demo.window, browser.page]) {
							expect(
								yield* outside("browser", () =>
									page.getByRole("button", {name: "Add one", exact: true}).count(),
								),
							).toBe(expected);
							yield* shot(
								page,
								page === demo.window ? "online-app" : "online-browser",
								layout,
								look,
								demo,
							);
						}
						yield* demo.killBrain;
						yield* visible(browser.page, "Disconnected");
						yield* outside("browser", () =>
							browser.page.getByRole("button", {name: "Add one", exact: true}).first().click(),
						);
						yield* visible(browser.page, /queued/i);
						for (const page of [demo.window, browser.page])
							yield* shot(
								page,
								page === demo.window ? "queued-app" : "queued-browser",
								layout,
								look,
								demo,
							);
						yield* visible(browser.page, "Online");
						yield* visible(demo.window, "Online");
						for (const page of [demo.window, browser.page])
							yield* shot(
								page,
								page === demo.window ? "recovered-app" : "recovered-browser",
								layout,
								look,
								demo,
							);
						yield* shot(demo.popover, "menu", layout, look, demo);
						expect(yield* demo.diagnostics).toEqual(
							expect.arrayContaining([
								expect.stringMatching(/build/),
								expect.stringMatching(/stage/),
							]),
						);
					}),
			);
			for (const [sizeName, size] of [
				["full", {width: 1440, height: 1000}],
				["narrow", {width: 600, height: 900}],
				["small", {width: 1024, height: 700}],
			] as const) {
				// Plan reason: founding, waiting, denied and removed screens precede tiles and need real size captures.
				it.live(
					`scenario: ${layout} ${look} ${sizeName} founding, waiting, denied and removed screens fit`,
					() =>
						Effect.gen(function* () {
							const home = yield* freshHome();
							const demo = yield* launchP23({
								home,
								label: `test.p23.${home.split("/").at(-1)}`,
								layout,
								look,
								brain: "stand-in",
								seal: "stand-in",
							});
							yield* outside("browser", () => demo.window.setViewportSize(size));
							yield* shot(demo.window, `founding-${sizeName}`, layout, look, demo);
							yield* outside("browser", () =>
								demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"),
							);
							yield* click(demo.window, "Start");
							yield* visible(demo.window, "Online");
							yield* demo.menuReady;
							const page = yield* outside("browser", () => demo.browser.newPage({viewport: size}));
							yield* outside("browser", () => page.goto(demo.url));
							yield* visible(page, /waiting/i);
							yield* shot(page, `waiting-${sizeName}`, layout, look, demo);
							yield* click(demo.popover, "Deny");
							yield* visible(page, /denied/i);
							yield* shot(page, `denied-${sizeName}`, layout, look, demo);
							yield* click(page, "Ask again");
							yield* demo.answerCheck("click");
							yield* click(demo.popover, "Approve");
							yield* visible(page, "Online");
							yield* demo.answerCheck("click");
							yield* click(demo.popover, "Remove");
							yield* visible(page, /removed/i);
							yield* shot(page, `removed-${sizeName}`, layout, look, demo);
						}),
				);
			}
		}
});
