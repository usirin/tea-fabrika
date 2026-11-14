/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * The exact text each membership signature covers.
 *
 * **Details**
 *
 * Each text is schema-ordered JSON for the tagged change, followed by one line feed, so an omitted
 * tag or field, or a reordered field, changes the signed bytes. Nothing here signs or verifies.
 *
 * @stability unstable
 */
import { Schema } from "effect";
import { Add, Grant, Revoke } from "./Access.ts";

/**
 * Schema for the three changes a key signs: a grant, a removal and an addition.
 *
 * @stability unstable
 * @category models
 */
export const Change = Schema.TaggedUnion({
  granted: { grant: Grant },
  revoked: { revoke: Revoke },
  added: { add: Add },
});

const encode = Schema.encodeSync(Schema.fromJsonString(Change));

/**
 * Returns the text a person key signs for a grant: the tagged JSON plus one line feed.
 *
 * @stability unstable
 * @category constructors
 */
export const grantText = (grant: typeof Grant.Type): string => `${encode(Change.cases.granted.make({ grant }))}\n`;

/**
 * Returns the text a person key signs for a removal: the tagged JSON plus one line feed.
 *
 * @stability unstable
 * @category constructors
 */
export const revokeText = (revoke: typeof Revoke.Type): string => `${encode(Change.cases.revoked.make({ revoke }))}\n`;

/**
 * Returns the text a key signs for an addition: the tagged JSON plus one line feed.
 *
 * @stability unstable
 * @category constructors
 */
export const addText = (add: typeof Add.Type): string => `${encode(Change.cases.added.make({ add }))}\n`;

const Enrollment = Schema.TaggedStruct("enrolled", {
  id: Schema.String,
  to: Schema.String,
  for: Schema.String,
  key: Schema.String,
  window: Schema.String,
  nonce: Schema.String,
});

const encodeEnrollment = Schema.encodeSync(Schema.fromJsonString(Enrollment));

/**
 * Returns the text a new device's person key signs to prove its enrollment: the tagged JSON plus one
 * line feed.
 *
 * **Details**
 *
 * It binds the add id, the ledger, the person, both new keys (`key` and `window`) and a nonce, so
 * a change to any of them changes the text.
 *
 * @stability unstable
 * @category constructors
 */
export const enrollmentText = (a: Omit<typeof Enrollment.Type, "_tag">): string =>
  `${encodeEnrollment(Enrollment.make(a))}\n`;
