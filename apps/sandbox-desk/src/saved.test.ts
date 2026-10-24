import {describe, expect, it} from "vitest";
import {type Saved, save} from "./saved.ts";

const previous: Saved = {
	phase: "ready",
	saved: {
		id: "351ec4d7-b629-4d73-a88e-f2c0f7f21dfa",
		dir: "/desk",
		size: 100,
		sha256: "a".repeat(64),
		format: "tar+zstd/1",
	},
	at: 1,
	failure: null,
};
const next = {...previous.saved, id: "81dc55d8-802a-4b92-a8f7-e34d4ca8e576"};
describe("save before stopping a Sandbox", () => {
	it("retains the last complete save and the live disk after an R2 failure", async () => {
		const calls: string[] = [];
		const result = await save(previous, true, {
			quiet: async () => {
				calls.push("quiet");
			},
			backup: async () => {
				throw Error("R2 upload failed");
			},
			remember: async () => {
				calls.push("remember");
			},
			open: async () => {
				calls.push("open");
			},
			destroy: async () => {
				calls.push("destroy");
			},
		});
		expect(calls).toEqual(["quiet", "open", "remember"]);
		expect(result).toEqual({...previous, failure: "R2 upload failed"});
	});
	it("never stops the instance when persisting the new reference fails", async () => {
		const calls: string[] = [];
		const result = await save(previous, true, {
			quiet: async () => {},
			backup: async () => next,
			remember: async (state) => {
				if (state.saved?.id === next.id) throw Error("DO storage unavailable");
				calls.push("remember-old");
			},
			open: async () => {
				calls.push("open");
			},
			destroy: async () => {
				calls.push("destroy");
			},
		});
		expect(result.saved).toEqual(previous.saved);
		expect(calls).toEqual(["open", "remember-old"]);
	});
	it("commits the complete record before destroying a saved sleeping instance", async () => {
		const calls: string[] = [];
		const result = await save(previous, true, {
			quiet: async () => {
				calls.push("quiet");
			},
			backup: async () => {
				calls.push("backup");
				return next;
			},
			remember: async (state) => {
				expect(state.saved).toEqual(next);
				calls.push("remember");
			},
			open: async () => {
				calls.push("open");
			},
			destroy: async () => {
				calls.push("destroy");
			},
		});
		expect(calls).toEqual(["quiet", "backup", "remember", "destroy"]);
		expect(result.phase).toBe("sleeping");
	});
});
