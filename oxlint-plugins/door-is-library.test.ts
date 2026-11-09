import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

const code = "fabrika(door-is-library)";
describe("P17a, the library owns the door", async () => {
	const files = {
		"next/apps/fabrika/src/door.ts": [
			'export {Door} from "@kampus/libfabrika/door";',
			'export type {ConnectionId} from "@kampus/libfabrika/door";',
			'export * from "@kampus/libfabrika/door";',
			'export const guard = (key: string) => key !== "revoked";',
			'export {Door} from "./old-door.ts";',
			'import {Door} from "@kampus/libfabrika/door";',
		].join("\n"),
		"next/apps/fabrika/src/door-store.ts": "export const fold = (rows: unknown[]) => rows;",
		"next/apps/fabrika/src/door-nonce.ts": "export default function check() { return true; }",
		"next/packages/libfabrika/src/door/door.ts": "export const guard = () => true;",
		"next/apps/fabrika/src/door.test.ts": "const guard = () => true;",
		"next/apps/fabrika/src/brain.ts": "export const wire = () => true;",
	};
	const linted = await plant(files);
	it("plants checks, folds, imports and a wrong re-export in each retired file", () => {
		expect(linted(code, "next/apps/fabrika/src/door.ts")).toEqual([4, 5, 6]);
		expect(linted(code, "next/apps/fabrika/src/door-store.ts")).toEqual([1]);
		expect(linted(code, "next/apps/fabrika/src/door-nonce.ts")).toEqual([1]);
	});
	it("permits library logic, app wiring and tests", () => {
		for (const path of Object.keys(files).slice(3)) expect(linted(code, path)).toEqual([]);
	});
});
