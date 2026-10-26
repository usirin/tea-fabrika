import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {accessLaws, type Law} from "./access.ts";
import {startServer} from "./harness.ts";
import {mayOpen, objectOf, PLANTED, type Planted, RULES} from "./router.ts";

const broken = (laws: readonly Law[]) => laws.filter((l) => !l.pass);
const lawsOn = async (planted?: string) => {
	const s = await startServer(planted === undefined ? {} : {planted});
	try {
		return await Effect.runPromise(accessLaws(s));
	} finally {
		await s.drop();
	}
};

describe("the access rule", () => {
	it("holds on the server: every law", async () => {
		const laws = await lawsOn();
		expect(broken(laws)).toEqual([]);
		expect(laws.length).toBe(10);
	});

	it("breaks on every planted mistake", async () => {
		// The name check alone is a second wall: with the router right, nobody can see it is gone.
		// So it is planted with the router's own mistake, where it is the only wall left.
		const plants = [
			...Object.keys(PLANTED).filter((p): p is Planted => p in PLANTED && p !== "name-check-off"),
			"route-by-prefix,name-check-off",
		];
		const caught = await Promise.all(
			plants.map(async (p) => ({p, by: broken(await lawsOn(p)).map((l) => l.law.split(".")[0])})),
		);
		expect(caught.filter((c) => c.by.length === 0)).toEqual([]);
		expect(caught.length).toBe(8);
		// The founder test: one founder spreading to every project is seen by law 6.
		expect(caught.find((c) => c.p === "founder-from-config")?.by).toContain("6");
		// With both walls down, person B sees person A's rows (law 2), not only a refusal.
		expect(caught.find((c) => c.p === "route-by-prefix,name-check-off")?.by).toContain("2");
	});

	it("with the router right, the name check alone changes nothing a person sees", async () => {
		expect(broken(await lawsOn("name-check-off"))).toEqual([]);
	});
});

describe("the router", () => {
	const at = (path: string) => objectOf(new URL(`http://server${path}`));

	it("reads the object from the path, and nothing else", () => {
		expect(at("/project/acme/append")).toEqual({
			kind: "project",
			id: "acme",
			name: "project/acme",
			rest: ["append"],
		});
		expect(at("/person/1001/door/self")?.name).toBe("person/1001");
		expect(at("/lane/acme~t1/claim")?.name).toBe("lane/acme~t1");
		for (const bad of [
			"/person/someone/read",
			"/person/01001/read",
			"/person/1001x/read",
			"/project/Acme/read",
			"/project//read",
			"/lane/acme/read",
			"/ledger/read",
			"/index/read",
			"/",
		])
			expect(at(bad)).toBeNull();
	});

	it("a person's object opens to that person alone, never an agent", () => {
		const p = at("/person/1001/read");
		if (p === null) throw new Error("no address");
		expect(mayOpen(RULES, p, {kind: "user", id: "github:1001"}, null)).toBe(true);
		expect(mayOpen(RULES, p, {kind: "user", id: "github:1002"}, null)).toBe(false);
		const own = {kind: "agent", id: "github:1001.builder", for: "github:1001"} as const;
		expect(mayOpen(RULES, p, own, null)).toBe(false);
	});
});
