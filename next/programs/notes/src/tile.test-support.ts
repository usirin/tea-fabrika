// T293, next/. P13's planned schemas only. This supplies no notes or editor behavior.
import {Id} from "@kampus/libfabrika";
import {Schema} from "effect";
import * as fc from "fast-check";

const note = Id.make("note");
export const plannedNotes = {
	note,
	save: Schema.Struct({
		note,
		base: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		body: Schema.String,
		how: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
		from: Schema.optionalKey(
			Schema.Struct({note, version: Schema.Int.check(Schema.isGreaterThan(0))}),
		),
	}),
	view: Schema.Struct({
		notes: Schema.Array(Schema.Struct({note, version: Schema.Int, body: Schema.String})),
	}),
};
export const noteIds = fc.bigInt({min: 0n, max: (1n << 62n) - 1n}).map((random) => {
	let uuid = (7n << 76n) | (2n << 62n) | random;
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = `${"0123456789abcdefghjkmnpqrstvwxyz"[Number(uuid & 31n)]}${suffix}`;
		uuid >>= 5n;
	}
	return Schema.decodeUnknownSync(note)(`note_${suffix}`);
});
// Full ledger fields come from libfabrika, not a second history metadata schema.
export const bodies = fc.oneof(
	fc.string(),
	fc.constantFrom("", "\r\n  🙂", "مرحبا", "<b>literal</b>"),
);
