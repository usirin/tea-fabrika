// T331, next/. L25/26 independent OpenSSH vectors. Integration laws live above transport in door/sheet.test.ts.
import {readFileSync} from "node:fs";
import {describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {verifySshsig} from "./sshsig.ts";

type Vector = {name: string; signer: string; text: string; armored: string};
const fixture: {signatures: Vector[]} = JSON.parse(
	readFileSync(
		new URL("../../../../../fixtures/next/recovery/sshsig.json", import.meta.url),
		"utf8",
	),
);
const check = (v: Vector, text = v.text) =>
	verifySshsig({text, armored: v.armored, signers: [v.signer], space: "fabrika-client"});

describe("P28 independent OpenSSH signatures", () => {
	it.effect(
		"vector: L25 all public OpenSSH proofs verify and changed text or namespace fails",
		() =>
			Effect.gen(function* () {
				for (const v of fixture.signatures) {
					expect((yield* check(v))._tag).toBe(v.name === "wrong-namespace" ? "refused" : "key");
					expect((yield* check(v, `${v.text}changed`))._tag).toBe("refused");
				}
			}),
	);
	it.effect(
		"vector: L25/26 candidate signer comes from the signed OpenSSH key, before membership",
		() =>
			Effect.gen(function* () {
				const T = yield* Effect.promise(() => import("./sshsig.ts"));
				for (const v of fixture.signatures) {
					expect(yield* T.readSigner(v.armored)).toBe(v.signer);
				}
			}),
	);
});
