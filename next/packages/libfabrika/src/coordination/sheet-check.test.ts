// T331, next/. L18, the offline check's signed text, original clock and exact retry.
import {createPrivateKey, createPublicKey, sign} from "node:crypto";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {checkSshsig, KeyLine, writeSshsig} from "../transport/sshsig.ts";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const int = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const Input = Schema.Struct({
	seed: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(32, 32)),
	matched: Schema.Boolean,
	at: int(0, 86_400_000),
	later: int(0, 86_400_000),
	retries: int(0, 3),
	count: int(1, 40),
	failure: Schema.Literals(["none", "store", "send", "ack"]),
});
const field = (value: Uint8Array | string) => {
	const b = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(b.length);
	return Buffer.concat([n, b]);
};
const key = (seed: readonly number[]) => {
	const privateKey = createPrivateKey({
		key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]),
		format: "der",
		type: "pkcs8",
	});
	const raw = createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32);
	const line = Schema.decodeUnknownSync(KeyLine)(
		`ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(raw)]).toString("base64")}`,
	);
	return {
		line,
		sign: (text: string) =>
			writeSshsig({
				text,
				space: "fabrika-client",
				line,
				sign: (b) => Effect.sync(() => new Uint8Array(sign(null, b, privateKey))),
			}),
	};
};
const time = (n: number) => new Date(Date.UTC(2026, 10, 9) + n).toISOString();

describe("P28 signed offline checks", () => {
	it.effect.prop(
		"L18 text: signed check binds ledger, ID, original time and result",
		{a: Arbitrary.schema(Input)},
		({a}) =>
			Effect.gen(function* () {
				const C = yield* Effect.promise(() => import("./sheet-check.ts"));
				const k = key(a.seed);
				const check = C.Check.make({
					id: "check_01m6v5270hf3c8x2q7w9z4k5mn",
					to: "p28",
					sentAt: time(a.at),
					matched: a.matched,
				});
				const text = C.checkText(check),
					armored = yield* k.sign(text);
				expect(
					yield* checkSshsig({text, armored, signers: [k.line], space: "fabrika-client"}),
				).toEqual({signer: k.line});
				for (const changed of [
					{...check, to: "other"},
					{...check, id: "check_01m6v5270hf3c8x2q7w9z4k5m1"},
					{...check, sentAt: time(a.at + 1)},
					{...check, matched: !a.matched},
				]) {
					expect(
						yield* checkSshsig({
							text: C.checkText(changed),
							armored,
							signers: [k.line],
							space: "fabrika-client",
						}),
					).toEqual({why: "bad_signature"});
				}
				expect(Schema.decodeUnknownSync(C.Checked)({_tag: "checked", matched: a.matched})).toEqual({
					_tag: "checked",
					matched: a.matched,
				});
			}),
		options,
	);
});
