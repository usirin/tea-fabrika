// T331, next/. Laws 7-12. Signatures are opaque here; the door checks real signatures.
// P28_PLANT selects an observation mutation. A plant must fail the named law, not an import.
import {describe, expect, it} from "@effect/vitest";
import {Result, Schema} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
	Add,
	Adds,
	admitted,
	allows,
	EMPTY,
	foldMembers,
	MemberFact,
	type Members,
} from "./members.ts";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const int = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minimum: number, maximum: number) =>
	Schema.String.check(Schema.isBetweenLength(minimum, maximum));
const Facts = Schema.Struct({
	steps: Schema.Array(Schema.Literals(["device", "sheet", "tab", "agent", "drop"])).check(
		Schema.isBetweenLength(1, 40),
	),
	devices: int(1, 6),
	children: Schema.Array(int(0, 6)).check(Schema.isBetweenLength(6, 6)),
	depth: int(0, 6),
	sheets: int(0, 3),
	drops: Schema.Array(int(0, 5)).check(Schema.isBetweenLength(0, 12)),
	name: text(1, 32),
	label: text(0, 32),
	where: text(0, 32),
	has: Schema.Array(text(1, 16)).check(Schema.isBetweenLength(0, 4)),
	at: int(0, 86_400_000),
	retries: int(0, 3),
	competitors: int(0, 2),
});
const facts = Arbitrary.schema(Facts);
const plant = process.env.P28_PLANT;
const person = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const id = (n: number) => `input_01m6v5270hetdrt4r8${String(n).padStart(8, "0")}`;
const signed = (signer: string) => ({signer, text: "door-checked", armored: "door-checked"});
const saw = (how: "device" | "sheet" | "recovery") => ({
	how,
	check: "touch" as const,
	where: "test",
	has: [],
	typed: how === "sheet",
	kept: how === "sheet" ? ("hand" as const) : null,
	old: how === "recovery" ? ("lost" as const) : null,
});
const add = (n: number, signer: string, adds: typeof Adds.Type, drops: readonly string[] = []) =>
	MemberFact.cases.added.make({
		add: Add.make({
			id: id(n),
			for: person,
			to: "p28",
			adds,
			drops,
			saw: saw(adds._tag === "recovery" ? "sheet" : signer.startsWith("r") ? "recovery" : "device"),
			sentAt: "2026-11-09T00:00:00.000Z",
		}),
		signed: signed(signer),
	});
const device = (n: number, signer = "p0", drops: readonly string[] = []) =>
	add(n, signer, Adds.cases.person.make({key: `p${n}`, window: `w${n}`}), drops);
const sheet = (n: number) => add(n, "p0", Adds.cases.recovery.make({key: `r${n}`, v: 1}));
const grant = (n: number, signer: string, as: "window" | "agent") =>
	MemberFact.cases.granted.make({
		grant: {
			id: id(n),
			key: `c${n}`,
			for: person,
			to: "p28",
			as,
			sentAt: "2026-11-09T00:00:00.000Z",
			saw: {code: "1234", label: "test", where: "test", how: "compare", check: "touch", has: []},
		},
		signed: signed(signer),
	});
const revoke = (n: number, key: string) =>
	MemberFact.cases.revoked.make({
		revoke: {
			id: id(n),
			key,
			for: person,
			to: "p28",
			saw: {label: "test", where: "test", how: "panel", check: "touch"},
			sentAt: "2026-11-09T00:00:00.000Z",
		},
		signed: signed("p0"),
	});
const history = (a: typeof Facts.Type): MemberFact[] => {
	const rows: MemberFact[] = [
		MemberFact.cases.founded.make({id: person, name: a.name, keys: ["p0"], window: "w0"}),
	];
	for (let d = 1; d < a.devices; d++) rows.push(device(d));
	for (let d = 0; d < a.devices; d++)
		for (let c = 0; c < (a.children[d] ?? 0); c++)
			rows.push(grant(100 + d * 6 + c, `p${d}`, c % 2 === 0 ? "window" : "agent"));
	for (let s = 0; s < a.sheets; s++) rows.push(sheet(200 + s));
	for (const [i, step] of a.steps.entries()) {
		const n = 300 + i;
		rows.push(
			step === "device"
				? device(n)
				: step === "sheet"
					? sheet(n)
					: step === "drop"
						? revoke(n, `p${a.drops[i % Math.max(1, a.drops.length)] ?? 1}`)
						: grant(n, "p0", step === "tab" ? "window" : "agent"),
		);
	}
	return rows.slice(0, 40);
};
const fold = (rows: readonly MemberFact[]) =>
	rows.reduce((state, fact) => Result.getOrElse(allows(state, fact), () => state), EMPTY);
const live = (m: Members, k: string) => m.keys.get(k)?.live === true && !m.spent.has(k);

describe("P28 fold properties", () => {
	it.prop(
		"L7: first founded, person, name and old authors survive",
		{a: facts},
		({a}) => {
			const rows = history(a),
				original = structuredClone(rows);
			const result = foldMembers([
				...rows,
				MemberFact.cases.founded.make({id: "other", name: "other", keys: ["thief"], window: null}),
			]);
			const observed =
				plant === "replace-founded" ? {...result, person: "other", name: "other"} : result;
			expect([observed.person, observed.name]).toEqual([person, a.name]);
			expect(rows).toEqual(original);
		},
		options,
	);
	it.prop(
		"L8: drops are permanent and admission walks every ancestor",
		{a: facts},
		({a}) => {
			const start = history(a).slice(0, 1);
			const rows = [
				...start,
				device(1),
				grant(2, "p1", "window"),
				revoke(3, "p1"),
				device(4, "p0"),
			];
			const again = add(5, "p0", Adds.cases.person.make({key: "p1", window: "again"}));
			const m = foldMembers([...rows, again]);
			expect(live(m, "p1") || plant === "revive-dropped").toBe(false);
			expect(admitted(m, "c2")).toEqual({why: "not_granted"});
			// The admission function accepts any finite tree. Include every depth 0..6.
			const keys = new Map(m.keys);
			keys.set("ancestor", {rank: "person", live: false, under: null});
			for (let n = 0; n <= a.depth; n++)
				keys.set(`depth${n}`, {
					rank: "window",
					live: true,
					under: n === 0 ? "ancestor" : `depth${n - 1}`,
				});
			const answer =
				plant === "own-live-only"
					? {key: `depth${a.depth}`, person, as: "window"}
					: admitted({...m, keys}, `depth${a.depth}`);
			expect(answer).toEqual({why: "not_granted"});
		},
		options,
	);
	it.prop(
		"L9: devices and sheets are equal roots; dropping one leaves the others",
		{a: facts},
		({a}) => {
			const rows = [
				...history(a).slice(0, 1),
				device(1),
				device(2, "p1"),
				sheet(3),
				grant(4, "p1", "agent"),
				revoke(5, "p1"),
			];
			const m = foldMembers(rows);
			const keys = new Map(m.keys);
			if (plant === "device-under-device") keys.set("p2", {...keys.get("p2")!, under: "p1"});
			if (plant === "sheet-under-device") keys.set("r3", {...keys.get("r3")!, under: "p1"});
			expect([keys.get("p2")?.under, keys.get("r3")?.under]).toEqual([null, null]);
			expect([live(m, "p2"), live(m, "r3")]).toEqual([true, true]);
			expect(admitted(m, "w2")).toMatchObject({person, as: "window"});
			expect(admitted(m, "c4")).toEqual({why: "not_granted"});
		},
		options,
	);
	it.prop(
		"L10: one live sheet, one use, stable retries and one winning recovery",
		{a: facts},
		({a}) => {
			const rows = [...history(a).slice(0, 1), sheet(1), sheet(2)];
			let state = fold(rows);
			const liveSheets = [...state.members.keys].filter(
				([k, v]) => v.rank === "recovery" && live(state.members, k),
			);
			expect(
				plant === "skip-replaced"
					? [...liveSheets, ["r1", state.members.keys.get("r1")]]
					: liveSheets,
			).toHaveLength(1);
			expect(Result.isFailure(allows(state, device(3, "r1")))).toBe(true);
			const first = device(4, "r2");
			const applied = allows(state, first);
			expect(Result.isSuccess(applied)).toBe(true);
			state = Result.getOrThrow(applied);
			for (let retry = 0; retry < a.retries; retry++)
				expect(allows(state, first)).toEqual(Result.succeed(state));
			for (let n = 0; n < a.competitors; n++) {
				const loser =
					plant === "skip-spent" ? Result.succeed(state) : allows(state, device(10 + n, "r2"));
				expect(loser).toEqual(Result.fail("used"));
			}
			expect(admitted(state.members, "w4")).toMatchObject({person});
		},
		options,
	);
	it.prop(
		"L11: person authority alone adds peers or sheets; recovery adds one device",
		{a: facts},
		({a}) => {
			const state = fold([...history(a).slice(0, 1), device(1), sheet(2), grant(3, "p0", "agent")]);
			for (const signer of ["w0", "w1", "c3"]) {
				const answer =
					plant === "window-authority" ? Result.succeed(state) : allows(state, device(4, signer));
				expect(answer).toEqual(Result.fail("not_allowed"));
				expect(allows(state, {...sheet(5), signed: signed(signer)})).toEqual(
					Result.fail("not_allowed"),
				);
			}
			for (const signer of ["p0", "p1"])
				expect(Result.isSuccess(allows(state, device(6, signer)))).toBe(true);
			expect(Result.isSuccess(allows(state, device(7, "r2")))).toBe(true);
			expect(allows(state, {...sheet(8), signed: signed("r2")})).toEqual(
				Result.fail("not_allowed"),
			);
			expect(allows(state, grant(9, "r2", "agent"))).toEqual(Result.fail("not_allowed"));
			expect(allows(state, {...revoke(10, "p1"), signed: signed("r2")})).toEqual(
				Result.fail("not_allowed"),
			);
			// Capability text is recorded only. It cannot upgrade a window.
			const forged = device(11, "w0");
			if (forged._tag !== "added") throw new Error("fixture must be added");
			expect(
				allows(state, {
					...forged,
					add: {...forged.add, saw: {...forged.add.saw, has: ["person", ...a.has]}},
				}),
			).toEqual(Result.fail("not_allowed"));
		},
		options,
	);
	it.prop(
		"L12: foreign drops refuse before changing membership",
		{a: facts},
		({a}) => {
			const state = fold(history(a).slice(0, 1));
			const answer = allows(state, device(1, "p0", ["foreign-person-key"]));
			expect(answer).toEqual(Result.fail("not_member"));
			expect(state.members.keys.has("p1")).toBe(false);
		},
		options,
	);
});
