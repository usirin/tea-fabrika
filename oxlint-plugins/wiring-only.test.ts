import * as fc from "fast-check";
import {expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

it("P18 c8 plants: decisions, socket callbacks, decoders and public binding overrides fail in app wiring", () => {
	fc.assert(
		fc.property(
			fc.constantFrom(
				"if (online) start();",
				"const a = online ? start() : stop();",
				"socket.onmessage = e => apply(e.data);",
				"const a = JSON.parse(frame);",
				"const a = Schema.decodeUnknownEffect(Size)(input);",
				"const a = new WebSocket(url);",
				"const binding = {client: params.client, session: params.session};",
			),
			(source) => {
				const file = "next/apps/fabrika/src/entry/browser.tsx";
				expect(plant({[file]: source})("p18(wiring-only)", file).length).toBeGreaterThan(0);
			},
		),
		{seed: 119120, numRuns: 14},
	);
});

it("P18 c8 plants: platform composition and capability policy cannot move back into Tuval", () => {
	fc.assert(
		fc.property(
			fc.constantFrom("browser", "headless"),
			fc.constantFrom(
				"export const headlessLayer = options => Layer.mergeAll(options.screen, options.key);",
				"export const cannot = ['Cmd+W'];",
				"export function policy() { return true; }",
			),
			(platform, source) => {
				const file = `next/packages/tuval/src/${platform}/index.ts`;
				expect(plant({[file]: source})("p18(wiring-only)", file)).toEqual([1]);
				const good = `export {${platform}Layer} from "@kampus/libfabrika/${platform}";`;
				expect(plant({[file]: good})("p18(wiring-only)", file)).toEqual([]);
			},
		),
		{seed: 119120, numRuns: 6},
	);
});

it("P18 c8: ordinary library code and direct app handoffs pass", () => {
	const file = "next/apps/fabrika/src/runtime.ts";
	const fires = plant({
		[file]:
			'import {startWindow} from "@kampus/libfabrika";\nexport const start = context => startWindow(context);',
		"next/packages/libfabrika/src/client/socket.ts": "if (frame === 'pong') accept();",
	});
	expect(fires("p18(wiring-only)", file)).toEqual([]);
	expect(fires("p18(wiring-only)", "next/packages/libfabrika/src/client/socket.ts")).toEqual([]);
});

it("P18 c8 plants: drawing has no socket callbacks and the client core has no platform imports", () => {
	fc.assert(
		fc.property(
			fc.constantFrom(
				["next/packages/tuval/src/window/main.tsx", "socket.onmessage = e => receive(e);"],
				[
					"next/packages/tuval/src/window/main.tsx",
					'import * as Socket from "effect/socket/Socket";',
				],
				["next/packages/libfabrika/src/client/window.ts", 'import {readFile} from "node:fs";'],
			),
			([file, source]) => {
				expect(plant({[file!]: source!})("p18(wiring-only)", file!).length).toBeGreaterThan(0);
			},
		),
		{seed: 119120, numRuns: 3},
	);
});
