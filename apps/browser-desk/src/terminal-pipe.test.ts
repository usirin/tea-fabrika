// Native edge: this test drives real cat/tr processes through the public program inputs.
import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {openTerminalPipe} from "./terminal-pipe.ts";

const wait = (what: string, check: () => boolean) => {
	const loop: Effect.Effect<void> = Effect.suspend(() =>
		check() ? Effect.void : Effect.sleep("10 millis").pipe(Effect.andThen(loop)),
	);
	return loop.pipe(Effect.onInterrupt(() => Effect.logError(`waited for ${what}`)));
};

it.live("pipes real terminal text, pauses without buffering, and resumes the same processes", () =>
	Effect.gen(function* () {
		const result = yield* Effect.gen(function* () {
			const demo = yield* openTerminalPipe("native-test", {
				cwd: process.cwd(),
				env: {PATH: "/usr/bin:/bin", TERM: "xterm-256color"},
			});
			const text = () =>
				demo
					.view()
					.to.chunks.map((chunk) => chunk.data)
					.join("");
			yield* wait(
				"both native processes",
				() => demo.view().from.phase === "running" && demo.view().to.phase === "running",
			);
			const before = {from: demo.view().from.id, to: demo.view().to.id};
			yield* demo.send("from", {type: "input", data: "hello bro\r"});
			yield* wait("first uppercase output", () => text().includes("HELLO BRO"));
			yield* demo.enable(false);
			yield* wait("paused link", () => !demo.view().link.enabled);
			yield* demo.send("from", {type: "input", data: "not forwarded\r"});
			yield* wait("discarded input", () =>
				demo
					.view()
					.link.packets.some(
						(packet) => packet.status === "discarded" && packet.text.includes("not forwarded"),
					),
			);
			const paused = text();
			yield* demo.enable(true);
			yield* wait("resumed link", () => demo.view().link.enabled);
			yield* demo.send("from", {type: "input", data: "back online\r"});
			yield* wait("resumed uppercase output", () => text().includes("BACK ONLINE"));
			return {
				before,
				after: {from: demo.view().from.id, to: demo.view().to.id},
				text: text(),
				paused,
				link: demo.view().link,
				failure: demo.view().failure,
			};
		}).pipe(Effect.scoped);
		expect(result.text).toContain("HELLO BRO");
		expect(result.text).toContain("BACK ONLINE");
		expect(result.paused).not.toContain("NOT FORWARDED");
		expect(result.text).not.toContain("NOT FORWARDED");
		expect(result.after).toEqual(result.before);
		expect(result.link.sent).toBeGreaterThan(0);
		expect(result.link.dropped).toBeGreaterThan(0);
		expect(result.failure).toBeNull();
	}),
);
