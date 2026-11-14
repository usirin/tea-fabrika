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
// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
import { Schema } from "effect";
import { InputId } from "./Id.ts";

/** A place in the log or in a stream. Both count from 1; 0 means before the first. */
export const Rev = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Rev = typeof Rev.Type;

/** Old saved parents keep their original identity. New checked inputs use InputId. */
const LegacyParentText = Schema.String.check(Schema.isPattern(/^in-process_[0-7][0-9a-hjkmnp-tv-z]{25}-[1-9][0-9]*$/));

export const ParentText = Schema.Union([InputId, LegacyParentText]);
