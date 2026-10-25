import {describe, expect, it} from "vitest";
import {writer} from "./brief.ts";
import {ASK, P1, pid, TAKEN} from "./scripted.ts";

const {tries: _, ...asked} = ASK;
const brief = {...asked, taken: TAKEN};

describe("the writer's brief", () => {
	it("is the plan's Properties, the base, pointers and what it may write, and nothing else", () => {
		const text = writer.render(writer.fill(brief));
		expect(text).toContain(`against commit ${ASK.base}`);
		expect(text).toContain("- p1 (new): when a child exits with no outcome row,");
		expect(text).toContain("  Checks `handlers` in `packages/pipeline/src/hosted/lane.ts`");
		expect(text).toContain("- `**/*.test.ts`");
		expect(text).toContain("- `packages/pipeline/src/hosted/lane.test.ts`");
		// No slot for the builder's notes: an extra field throws, whatever got it past the type.
		expect(() => writer.fill({...brief, notes: "the builder says"} as never)).toThrow();
	});

	it("takes only `p<n>` ids and only `test` Properties", () => {
		expect(() => pid("c1")).toThrow();
		expect(() => writer.fill({...brief, properties: [{...P1, tool: "tla"}]} as never)).toThrow();
	});

	it("says where to look when nothing was pointed at", () => {
		expect(writer.render(writer.fill({...brief, pointers: [], taken: []}))).toContain(
			"Nothing was pointed at. Read the code yourself.",
		);
	});
});
