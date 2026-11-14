/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
