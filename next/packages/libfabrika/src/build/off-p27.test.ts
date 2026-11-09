// P27a, next/. scenario: inspect final executable bytes, then run normal work on the off stage.
import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {production, type BuildModule, type CompilerModule} from "../chaos/p27.test-support.ts";

describe("P27a off output", () => {
	it.effect(
		"scenario: plant, unconditional live handler, embedded chaos or abort method in the off bundle",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					// P24's real build and compiler are required. No copied build implementation.
					const B = yield* production<BuildModule>("../build/node.ts", "build");
					const C = yield* production<CompilerModule>("../build/compiler.ts", "BuildCompiler");
					const out = yield* Effect.acquireRelease(
						Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
						(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
					);
					const built = yield* B.build({
						root: resolve(import.meta.dirname, "../../../../apps/fabrika"),
						out,
						programs: [
							{name: "counter", package: "@kampus/counter", export: "counter"},
							{name: "notes", package: "@kampus/notes", export: "notes"},
							{name: "chaos", package: "@kampus/chaos", export: "chaos"},
						],
						windows: [],
						chaos: {_tag: "off"},
					}).pipe(Effect.provide(C.BuildCompiler.layer), Effect.provide(NodeServices.layer));
					const output: string[] = [];
					const read = (folder: string) => {
						for (const name of readdirSync(folder)) {
							const path = join(folder, name);
							if (statSync(path).isDirectory()) read(path);
							else if (/\.(?:m?js|html)$/.test(name)) output.push(readFileSync(path, "utf8"));
						}
					};
					read(out);
					expect(output.length).toBeGreaterThan(0);
					const text = output.join("\n");
					for (const forbidden of [
						"LiveNemesis",
						"LiveStepFault",
						"GatewayFault",
						"chaos.selected",
						"chaos.did",
						"chaos.fire",
						"chaos.observe",
						"chaos.complete",
						"chaos.check",
						"chaosTile",
						"kill_brain",
						"hang_brain",
					])
						expect(text).not.toContain(forbidden);
					expect(text).not.toMatch(
						/(?:\.abort\s*\(|["']abort["']\s*[:(]|\[\s*["']abort["']\s*\]\s*\()/,
					);
					expect(built.programs.map((p) => p.name)).toEqual(
						expect.arrayContaining(["counter", "notes"]),
					);
					expect(built.programs.some((p) => p.name === "chaos")).toBe(false);
				}),
			),
	);
});
