import {Schema} from "effect";
import {Add, Grant, Revoke} from "./members.ts";

export const Change = Schema.TaggedUnion({
	granted: {grant: Grant},
	revoked: {revoke: Revoke},
	added: {add: Add},
});

const encode = Schema.encodeSync(Schema.fromJsonString(Change));

export const grantText = (grant: typeof Grant.Type): string =>
	`${encode(Change.cases.granted.make({grant}))}\n`;

export const revokeText = (revoke: typeof Revoke.Type): string =>
	`${encode(Change.cases.revoked.make({revoke}))}\n`;

export const addText = (add: typeof Add.Type): string =>
	`${encode(Change.cases.added.make({add}))}\n`;

const Enrollment = Schema.TaggedStruct("enrolled", {
	id: Schema.String,
	to: Schema.String,
	for: Schema.String,
	key: Schema.String,
	window: Schema.String,
	nonce: Schema.String,
});

const encodeEnrollment = Schema.encodeSync(Schema.fromJsonString(Enrollment));

export const enrollmentText = (a: Omit<typeof Enrollment.Type, "_tag">): string =>
	`${encodeEnrollment(Enrollment.make(a))}\n`;
