import {tell} from "@kampus/fabrika";
import {Effect as Fx} from "effect";
import {describe, expect, it} from "vitest";
import {openTsh} from "./tsh.ts";

describe("the GUI's real tsh launcher", () => {
	it("uses tsh validation before a command can request a window", async () => {
		const opened: string[] = [];
		await Fx.runPromise(
			Fx.scoped(
				Fx.gen(function* () {
					const shell = yield* openTsh("test", (kind) =>
						Fx.sync(() => {
							opened.push(kind);
						}),
					);
					shell.line("counter --missing yes");
					yield* tell(shell.run, "line", "counter --missing yes");
					for (let i = 0; i < 500 && !shell.view().ready; i++) yield* Fx.sleep("1 millis");
					expect(shell.view().ready).toBe(true);
					expect(opened).toEqual([]);
					shell.line("counter");
					yield* tell(shell.run, "line", "counter");
					for (let i = 0; i < 500 && !shell.view().ready; i++) yield* Fx.sleep("1 millis");
					expect(opened).toEqual(["counter"]);
					shell.line("seq --to 3 | double");
					yield* tell(shell.run, "line", "seq --to 3 | double");
					for (let i = 0; i < 500 && !shell.view().ready; i++) yield* Fx.sleep("1 millis");
					expect(shell.view().lines.slice(-3)).toEqual(["double 2", "double 4", "double 6"]);
				}),
			),
		);
	});
});
