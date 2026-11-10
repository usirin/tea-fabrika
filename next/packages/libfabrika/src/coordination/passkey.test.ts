// P9's additive schema extension: metadata is durable, not caller authority. Existing P9 tests
// still own root equality and recovery folds. Plants: strip the extension; lose enrollment proof.
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";
import {Add, Adds, Signed} from "./members.ts";

const checked = {
	origin: "https://fabrika.test",
	rp: "fabrika.test",
	be: true,
	bs: true,
	counter: 0,
};

const text = fc.string();

const checkedArb = fc.record({
	origin: text,
	rp: text,
	be: fc.boolean(),
	bs: fc.boolean(),
	counter: fc.nat(),
});

const commonArb = fc.record({id: text, for: text, to: text, sentAt: text});

const commonExample = {
	id: "change",
	for: "person-a",
	to: "project-a",
	sentAt: "2026-11-08T04:00:00.000Z",
};

describe("P10 passkey records", () => {
	it("p42: added-key records retain command and handwritten observations", () => {
		fc.assert(
			fc.property(commonArb, text, text, (common, key, where) => {
				const add = {
					...common,
					adds: {_tag: "recovery", key, v: 1},
					drops: [],
					saw: {
						how: "sheet",
						check: "touch",
						where,
						has: [],
						typed: true,
						kept: "hand",
						old: null,
					},
				};
				expect(Schema.decodeUnknownSync(Add)(add)).toEqual(add);
				const command = {...add, saw: {...add.saw, how: "command", kept: null, typed: false}};
				expect(Schema.decodeUnknownSync(Add)(command)).toEqual(command);
			}),
			{seed: 119120, includeErrorInReport: true, examples: [[commonExample, "sheet", "test"]]},
		);
	});
	it("question 19: an enrolled root cannot carry an incomplete proof record", () => {
		const incomplete = fc
			.record({
				credential: text,
				rp: text,
				origin: text,
				be: fc.boolean(),
				bs: fc.boolean(),
				nonce: text,
				proof: text,
			})
			.chain((full) =>
				fc
					.subarray(Object.keys(full), {maxLength: 6})
					.map((keys) =>
						Object.fromEntries(keys.map((key) => [key, full[key as keyof typeof full]])),
					),
			);
		fc.assert(
			fc.property(incomplete, text, text, (passkey, key, window) => {
				expect(Schema.is(Adds)({_tag: "person", key, window, passkey})).toBe(false);
			}),
			{
				seed: 119120,
				includeErrorInReport: true,
				examples: [
					[{}, "root", "window"],
					[{credential: "credential", rp: "fabrika.test"}, "root", "window"],
				],
			},
		);
	});
	it("question 19: Signed keeps checked backup state and zero counter beside the original bytes", () => {
		fc.assert(
			fc.property(fc.record({text, armored: text, signer: text, passkey: checkedArb}), (input) => {
				const decoded = Schema.decodeUnknownSync(Signed)(input);
				expect(decoded).toEqual(input);
				expect(Schema.encodeSync(Signed)(decoded)).toEqual(input);
			}),
			{
				seed: 119120,
				includeErrorInReport: true,
				examples: [[{text: "original\n", armored: "armor", signer: "sk-key", passkey: checked}]],
			},
		);
	});
	it("question 19: an added person keeps credential, RP, origin and enrollment proof", () => {
		const example = {
			_tag: "person" as const,
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
		fc.assert(
			fc.property(
				fc
					.record({
						key: text,
						window: text,
						passkey: fc.record({
							credential: text,
							rp: text,
							origin: text,
							be: fc.boolean(),
							bs: fc.boolean(),
							nonce: text,
							proof: text,
						}),
					})
					.map((value) => ({_tag: "person" as const, ...value})),
				(input) => {
					const decoded = Schema.decodeUnknownSync(Adds)(input);
					expect(decoded).toEqual(input);
					expect(Schema.encodeSync(Adds)(decoded)).toEqual(input);
				},
			),
			{seed: 119120, includeErrorInReport: true, examples: [[example]]},
		);
	});
	it("P7 compatibility: plain Ed25519 signed events need no invented passkey fields", () => {
		fc.assert(
			fc.property(fc.record({text, armored: text, signer: text}), (input) => {
				expect(Schema.decodeUnknownSync(Signed)(input)).toEqual(input);
			}),
			{
				seed: 119120,
				includeErrorInReport: true,
				examples: [[{text: "original", armored: "armor", signer: "ssh-ed25519 key"}]],
			},
		);
	});
});
