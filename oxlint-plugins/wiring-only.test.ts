// P23 shape laws live in lint. These are the rule's valid and invalid plants.
import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

describe("P23 native-only links and app wiring", () => {
	const files = {
		"next/apps/fabrika/src/browser.ts": [
			'import {mountWindow} from "@kampus/libfabrika/browser";',
			"mountWindow(run, views, root);",
			'import {Schema, Machine} from "effect";',
			'const choose = (value) => value ? "yes" : "no";',
			"const fold = (rows) => rows.filter((row) => row.live);",
			'import {openBrowserLink as mint} from "@kampus/libfabrika/desktop";',
		].join("\n"),
		"next/apps/fabrika/src/brain.ts":
			'export const route = (request) => {if (request.url === "/") return new Response("wrong entry");};',
		"next/packages/libfabrika/src/browser/entry.ts":
			'import {BrowserLink} from "../desktop/browser-link.ts";',
		"next/packages/libfabrika/src/electron/menu.ts":
			'import {openBrowserLink} from "../desktop/browser-link.ts"; export const clicked = (run) => openBrowserLink(run);',
		"next/packages/libfabrika/src/desktop/browser-link.ts":
			'import {BrowserLink} from "./index.ts";',
		"next/packages/libfabrika/src/server/pages.ts":
			'export const route = (path) => path === "/" ? "browser" : null;',
	};
	const result = plant(files);
	it("plants renderer minting, routing, Schema, reducers and folds", () => {
		expect(result("fabrika-wiring(wiring-only)", "next/apps/fabrika/src/browser.ts")).toEqual([
			3, 3, 4, 5, 6,
		]);
		expect(result("fabrika-wiring(wiring-only)", "next/apps/fabrika/src/brain.ts")).toEqual([1]);
		expect(
			result("fabrika-wiring(wiring-only)", "next/packages/libfabrika/src/browser/entry.ts"),
		).toEqual([1]);
	});
	it("allows native callback wiring and decisions in their library modules", () => {
		for (const path of Object.keys(files).slice(3))
			expect(result("fabrika-wiring(wiring-only)", path)).toEqual([]);
	});
});
