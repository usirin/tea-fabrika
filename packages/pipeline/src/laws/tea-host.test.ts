import {describe, expect, it} from "vitest";
import {checkCalls, checkHost, checkMonitors, checkSupervisor} from "./tea-host.ts";

// The machines of the host (../../host), every law in every Msg order up to the bound, and every
// planted mistake caught by the law it should break. Each walk is bounded by states, not time, so
// the suite's one time limit (vitest.config.ts) only has to outlast a busy machine.

describe("the tea-host machines", () => {
	it("the host holds every law, and each planted mistake breaks its law", () => {
		const r = checkHost(8);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(19);
	});

	it("the call module holds every law, and each planted mistake breaks its law", () => {
		const r = checkCalls(6);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(7);
	});

	it("the supervisor holds every law under each strategy, and each planted mistake breaks its law", () => {
		const r = checkSupervisor(5);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(25);
		expect(r.laws.length).toBe(21);
	});

	it("the monitor module holds every law, and each planted mistake breaks its law", () => {
		const r = checkMonitors(7);
		expect(r.broken).toEqual({});
		expect(r.planted.filter((p) => !p.caught)).toEqual([]);
		expect(r.planted.length).toBe(10);
	});
});
