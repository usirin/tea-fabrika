import {memoryStorage, readInput, start, tell, viewOf} from "@kampus/fabrika";
import {Effect, Fiber, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {markdown} from "./index.ts";
import {Root} from "./root.ts";
import {keyed} from "./window.tsx";

// The markdown program: a text read into blocks, its view following each text told, and the
// window's keys.

describe("Root.fromMarkdown", () => {
	it("reads every block this repo writes, in mdast's names", () => {
		const text = [
			"# 170: The experiments program",
			"",
			"**Answer.** Yes,",
			"on today's blocks.",
			"",
			"- one",
			"  more",
			"- two",
			"",
			"1. first",
			"",
			"```ts",
			"const a = 1;",
			"",
			"```",
			"",
			"> a quote",
			"> goes on",
			"",
			"| Run | Note |",
			"|---|---|",
			"| 170-1 | a \\| b |",
			"",
			"---",
		].join("\n");
		expect(Root.fromMarkdown(text).children).toEqual([
			{type: "heading", depth: 1, text: "170: The experiments program"},
			{type: "paragraph", text: "**Answer.** Yes, on today's blocks."},
			{type: "list", ordered: false, items: ["one more", "two"]},
			{type: "list", ordered: true, items: ["first"]},
			{type: "code", lang: "ts", value: "const a = 1;\n"},
			{type: "blockquote", text: "a quote\ngoes on"},
			{type: "table", head: ["Run", "Note"], rows: [["170-1", "a | b"]]},
			{type: "thematicBreak"},
		]);
	});

	it("reads an empty text as no blocks", () => {
		expect(Root.fromMarkdown("\n\n").children).toEqual([]);
	});
});

describe("markdown", () => {
	it("shows each text told, the last one replacing the first, and ends on quit", async () => {
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(
					markdown,
					{text: "# Hi"},
					{},
					{id: "markdown:test", storage: memoryStorage()},
				);
				if (started.kind !== "running") return yield* Effect.die("markdown did not start");
				const view = viewOf(markdown);
				if (view === undefined) return yield* Effect.die("markdown has no view");
				const seen = yield* started.run.machines.page.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.map(view.of),
					// A view is untyped past `viewOf`: the window gets it as its data's schema reads it.
					Stream.filter(Schema.is(Root)),
					Stream.map((root) => root.children.map((b) => b.type)),
					Stream.filter((types) => types.includes("list")),
					Stream.take(1),
					Stream.runCollect,
					Effect.forkScoped,
				);
				yield* tell(started.run, "text", "- a\n- b");
				const lists = yield* Fiber.join(seen);
				yield* tell(started.run, "quit", {});
				const ended = yield* started.run.ended;
				return {lists, ended: ended.kind};
			}).pipe(Effect.scoped),
		);
		expect(shown).toEqual({lists: [["list"]], ended: "ended"});
	});

	it("takes quit from its window and refuses what it does not know", () => {
		expect(readInput(markdown, {type: "quit", value: {}}).kind).toBe("read");
		expect(readInput(markdown, {type: "scroll", value: {}}).kind).toBe("refused");
	});
});

describe("keyed", () => {
	it("keys each value by what it reads and how many alike came before", () => {
		expect(keyed(["a", "b", "a"], (x) => x).map((k) => k.key)).toEqual(["a#0", "b#0", "a#1"]);
	});
});
