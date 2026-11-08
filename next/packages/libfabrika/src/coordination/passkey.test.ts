// P9's additive schema extension: metadata is durable, not caller authority. Existing P9 tests
// still own root equality and recovery folds. Plants: strip the extension; lose enrollment proof.
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import {Adds, Signed} from "./members.ts";

const checked = {
	origin: "https://fabrika.test",
	rp: "fabrika.test",
	be: true,
	bs: true,
	counter: 0,
};
describe("P10 passkey records", () => {
	it("question 19: Signed keeps checked backup state and zero counter beside the original bytes", () => {
		const input = {text: "original\n", armored: "armor", signer: "sk-key", passkey: checked};
		const decoded = Schema.decodeUnknownSync(Signed)(input);
		expect(decoded).toEqual(input);
		expect(Schema.encodeSync(Signed)(decoded)).toEqual(input);
	});
	it("question 19: an added person keeps credential, RP, origin and enrollment proof", () => {
		const input = {
			_tag: "person",
			key: "sk-key",
			window: "window",
			passkey: {
				credential: "credential",
				rp: "fabrika.test",
				origin: "https://fabrika.test",
				be: true,
				bs: true,
				nonce: "nonce",
				proof: "SSHSIG proof",
			},
		};
		const decoded = Schema.decodeUnknownSync(Adds)(input);
		expect(decoded).toEqual(input);
		expect(Schema.encodeSync(Adds)(decoded)).toEqual(input);
	});
	it("P7 compatibility: plain Ed25519 signed facts need no invented passkey fields", () => {
		const input = {text: "original", armored: "armor", signer: "ssh-ed25519 key"};
		expect(Schema.decodeUnknownSync(Signed)(input)).toEqual(input);
	});
});
