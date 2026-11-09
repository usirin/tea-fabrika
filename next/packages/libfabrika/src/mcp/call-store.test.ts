// P25 D/F, next/. The on-disk store is always the product's Node adapter.
import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {NodeFileSystem} from "@effect/platform-node";
import {afterAll, expect, it} from "@effect/vitest";
import {Cause, Effect, Exit, Schema} from "effect";
import * as Id from "../id.ts";
import {raceChildren, reserve} from "../node/agent.test-support.ts";
import {CallReceipt, CallStore, Delivery, Small, options} from "./mcp.test-support.ts";

const homes: string[] = [];
const home = () => {
	const h = mkdtempSync("/tmp/fh.");
	homes.push(h);
	return h;
};
afterAll(() => {
	for (const h of homes) rmSync(h, {recursive: true, force: true});
});
const same = (a: unknown, b: unknown) => expect(b, "one reserved retry identity").toEqual(a);
const bindingLaw = (
	receipt: {
		readonly key: string;
		readonly ledger: string;
		readonly target: string;
		readonly letter: string;
	},
	request: {readonly key: string; readonly ledger: string; readonly target: string},
	first: {readonly letter: string},
) => {
	expect(receipt).toMatchObject(request);
	expect(receipt.letter, "another binding cannot borrow a receipt").not.toBe(first.letter);
};
it.effect.prop(
	"L15 a receipt cannot be borrowed by another key, ledger or continuing target",
	{
		binding: Schema.Struct({
			key: Schema.NonEmptyString,
			ledger: Schema.NonEmptyString,
			target: Schema.NonEmptyString,
		}),
	},
	({binding}) =>
		Effect.gen(function* () {
			const {agentStore} = yield* Effect.promise(() => import("../node/agent-store.ts"));
			const layer = agentStore({home: home()});
			const request = {...reserve, ...binding};
			const first = yield* CallStore.use((s) => s.reserve(request)).pipe(Effect.provide(layer));
			same(first, yield* CallStore.use((s) => s.reserve(request)).pipe(Effect.provide(layer)));
			for (const changed of [
				{...request, key: `${request.key}x`},
				{...request, ledger: `${request.ledger}x`},
				{...request, target: `${request.target}x`},
			]) {
				const result = yield* Effect.exit(
					CallStore.use((s) => s.reserve(changed)).pipe(Effect.provide(layer)),
				);
				expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(false);
				if (Exit.isSuccess(result)) bindingLaw(result.value, changed, first);
			}
			same(first, yield* CallStore.use((s) => s.reserve(request)).pipe(Effect.provide(layer)));
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
	options,
);
it.effect("scenario: L16 separate bridge processes reserve one receipt", () =>
	// Separate processes prove atomic storage. A local semaphore cannot satisfy this race.
	Effect.gen(function* () {
		const h = home();
		const {agentStore} = yield* Effect.promise(() => import("../node/agent-store.ts"));
		const [a, b] = yield* raceChildren(h, "receipt");
		same(a, b);
		const receipt = yield* Schema.decodeUnknownEffect(CallReceipt)(a);
		expect(Schema.is(Id.Letter)(receipt.letter)).toBe(true);
		const again = yield* CallStore.use((s) =>
			s.reserve({...reserve, sentAt: "2026-11-09T00:00:00Z", seen: 99}),
		).pipe(Effect.provide(agentStore({home: h})));
		same(receipt, again);
	}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
);
it.effect.prop(
	"L05 outside receipts are decoded without defects",
	{raw: Schema.Json, n: Small},
	({raw, n}) =>
		Effect.gen(function* () {
			const {agentStore} = yield* Effect.promise(() => import("../node/agent-store.ts"));
			const h = home();
			const layer = agentStore({home: h});
			const receipt = yield* CallStore.use((s) =>
				s.reserve({...reserve, digest: n.toString(16).padStart(64, "0")}),
			).pipe(Effect.provide(layer));
			const result = yield* Effect.exit(
				CallStore.use((s) =>
					// @ts-expect-error Deliberately malformed saved data must fail in the typed channel.
					s.settle(receipt.letter, {corrupt: raw}),
				).pipe(Effect.provide(layer)),
			);
			expect(Exit.isFailure(result)).toBe(true);
			expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(false);
			yield* CallStore.use((s) =>
				s.settle(receipt.letter, Delivery.cases.accepted.make({rev: 1, pos: 1})),
			).pipe(Effect.provide(layer));
			const good = yield* CallStore.use((s) =>
				s.reserve({...reserve, digest: n.toString(16).padStart(64, "0")}),
			).pipe(Effect.provide(layer));
			expect(Schema.is(CallReceipt)(good)).toBe(true);
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
	options,
);
it.effect.prop(
	"receipts survive reopen and retain only terminal fields",
	{answer: Delivery, seen: Small},
	({answer, seen}) =>
		Effect.gen(function* () {
			const {agentStore} = yield* Effect.promise(() => import("../node/agent-store.ts"));
			const h = home();
			const a = yield* CallStore.use((s) => s.reserve({...reserve, seen})).pipe(
				Effect.provide(agentStore({home: h})),
			);
			yield* CallStore.use((s) => s.settle(a.letter, answer)).pipe(
				Effect.provide(agentStore({home: h})),
			);
			const b = yield* CallStore.use((s) => s.reserve({...reserve, seen: seen + 1})).pipe(
				Effect.provide(agentStore({home: h})),
			);
			same({...a, answer}, b);
			const bytes = readdirSync(h, {recursive: true})
				.filter((f) => typeof f === "string" && f.endsWith(".db"))
				.map((f) => readFileSync(join(h, String(f))).toString("utf8"))
				.join("");
			expect(bytes).not.toContain("private-body-marker");
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
	options,
);
it("plant L16: per-process mutex allocates two letters", () =>
	expect(() => same({letter: "a"}, {letter: "b"})).toThrow());
it("plant L05: receipt constructor throws on disk data", () =>
	expect(() =>
		expect(() => Schema.decodeUnknownSync(CallReceipt)({letter: 3})).not.toThrow(),
	).toThrow());
it("plant L15: cached digest ignores the ledger binding", () =>
	expect(() =>
		bindingLaw(
			{key: "a", ledger: "one", target: "notes:1", letter: "old"},
			{key: "a", ledger: "two", target: "notes:1"},
			{letter: "old"},
		),
	).toThrow());
