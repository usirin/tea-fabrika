import {describe, expect, it} from "vitest";
import {checkCalls, checkHost} from "./tea-host.ts";

// The machines of packages/tea-host, every law in every Msg order up to the bound, and every
// planted mistake caught by the law it should break.

describe("the tea-host machines", () => {
	it("the host holds every law, and each planted mistake breaks its law", () => {
		const r = checkHost(8);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(9);
	});

	it("the call module holds every law, and each planted mistake breaks its law", () => {
		const r = checkCalls(6);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(7);
	});
});
