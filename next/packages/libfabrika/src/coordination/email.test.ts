// P36, next/: pure rules consume checked membership rows and referee time only.
import {expect} from "@effect/vitest";
import {
	DAY,
	EPOCH,
	LEDGER,
	PERSON,
	VerificationFlow,
	DeadlineFlow,
	CancelFlow,
	AuthorityFlow,
	added,
	canceled,
	initial,
	input,
	loadDomain,
	pureLaw,
	pureModule,
	requested,
	type Flow,
	type Row,
} from "../email/email.test-support.ts";

const domain = pureModule(loadDomain);
const EMAIL = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const verification = (at: number): Row => ({
	fact: {
		_tag: "verified",
		id: input(1),
		for: PERSON,
		to: LEDGER,
		email: "email_checked",
		key: EMAIL,
		signed: {signer: "person-0", text: "checked", armored: "checked"},
	},
	arrivedAt: at,
	parent: null,
});
const history = (flow: Flow): Row[] => [
	...initial(flow).map((fact) => ({fact, arrivedAt: EPOCH - 2, parent: null})),
	verification(EPOCH - 1),
	{fact: requested(flow), arrivedAt: EPOCH, parent: null},
];

pureLaw(
	"P36.06 recovery trusts only an earlier recorded verification",
	VerificationFlow,
	domain,
	(flow, plant) => {
		for (const relation of [-1, 0, 1] as const) {
			const rows = history(flow);
			rows[rows.length - 2] = verification(EPOCH + relation);
			if (plant === "trust sentAt") rows[rows.length - 2] = verification(EPOCH - 1);
			// Row order decides "recorded before". Two facts may arrive in the same millisecond.
			if (relation > 0 && plant !== "trust sentAt") {
				const verified = rows.splice(rows.length - 2, 1)[0]!;
				rows.push({...verified, arrivedAt: EPOCH - 1}); // backdated client text buys nothing
			}
			const state = domain().EmailState.replay(rows, LEDGER);
			expect(domain().EmailState.due(state, EPOCH + DAY).length).toBe(relation <= 0 ? 1 : 0);
		}
		const missing = history(flow).map((row, n) => (n === 1 ? {...row, arrivedAt: null} : row));
		const noTimes = missing.map((row) => ({...row, arrivedAt: null}));
		expect(
			domain().EmailState.due(domain().EmailState.replay(noTimes, LEDGER), EPOCH + DAY),
		).toEqual([]);
	},
	["trust sentAt"],
);

pureLaw(
	"P36.09 no completion before 24 hours; completion is possible when due",
	DeadlineFlow,
	domain,
	(flow, plant) => {
		const state = domain().EmailState.replay(history(flow), LEDGER);
		for (const offset of [-1, 0, 1] as const) {
			const now = EPOCH + DAY + offset;
			const actual =
				plant === "use client clock" ? now + 604800000 : plant === "shorten wait" ? now + 1 : now;
			const due = plant === "never complete" ? [] : domain().EmailState.due(state, actual);
			expect(due.map((row) => row.add)).toEqual(offset < 0 ? [] : [added(flow)]);
		}
	},
	["use client clock", "shorten wait", "never complete"],
);

pureLaw(
	"P36.11 canceled requests never admit or apply drops",
	CancelFlow,
	domain,
	(flow, plant) => {
		for (let signer = 0; signer < flow.live; signer++) {
			const rows = history(flow);
			if (plant !== "ignore cancellation")
				rows.push({
					fact: canceled(input(200), `person-${signer}`),
					arrivedAt: EPOCH + DAY - 1,
					parent: null,
				});
			const state = domain().EmailState.replay(rows, LEDGER);
			expect(domain().EmailState.due(state, EPOCH + DAY + flow.time)).toEqual([]);
			expect(
				domain().EmailState.allowsAdded(state, added(flow), {
					at: EPOCH + DAY,
					parent: input(200),
					signer: EMAIL,
				}),
			).toBe(false);
		}
	},
	["ignore cancellation"],
);

pureLaw(
	"P36.14 email rank signs only the exact due device addition",
	AuthorityFlow,
	domain,
	(flow, plant) => {
		const state = domain().EmailState.replay(history(flow), LEDGER);
		const add = added(flow);
		const allows = (
			value: typeof add,
			at = EPOCH + DAY,
			parent: string | null = input(200),
			signer = EMAIL,
		) =>
			plant === "email is person"
				? true
				: domain().EmailState.allowsAdded(state, value, {at, parent, signer});
		expect(allows(add)).toBe(true);
		expect(allows(add, EPOCH + DAY - 1)).toBe(false);
		expect(allows(add, EPOCH + DAY, null)).toBe(false);
		expect(allows(add, EPOCH + DAY, input(201))).toBe(false);
		const changed = [
			{...add, id: input(777)},
			{...add, to: "other-ledger"},
			{...add, for: "other-person"},
			{...add, adds: {_tag: "person" as const, key: "another", window: "another-window"}},
			{...add, drops: [...add.drops, "person-3"]},
			{...add, adds: {_tag: "recovery" as const, key: "sheet", v: 1 as const}},
			{
				...add,
				saw: {...add.saw, old: add.saw.old === "lost" ? ("kept" as const) : ("lost" as const)},
			},
			{...add, sentAt: new Date(EPOCH + flow.skew + 1).toISOString()},
		];
		for (const value of changed)
			expect(allows(plant === "accept changed add" ? add : value)).toBe(false);
		for (const signer of ["person-0", "window-0", "unknown"])
			expect(allows(add, EPOCH + DAY, input(200), signer)).toBe(false);
	},
	["email is person", "accept changed add"],
);

pureLaw(
	"P36.14 email verification is ledger-bound and keeps an immutable private address reference",
	AuthorityFlow,
	domain,
	(flow, plant) => {
		const rows = history(flow);
		const other = domain().EmailState.replay(
			rows,
			plant === "ignore ledger" ? LEDGER : "other-ledger",
		);
		expect(domain().EmailState.due(other, EPOCH + DAY)).toEqual([]);
		const fact = verification(EPOCH - 1).fact;
		expect(domain().verifiedText(fact)).toContain("email_checked");
		expect(domain().verifiedText(fact)).not.toContain("example.test");
	},
	["ignore ledger"],
);
