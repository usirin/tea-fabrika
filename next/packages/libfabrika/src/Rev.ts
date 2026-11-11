// One of the shared names of 0043 (rooms on floors): a value every room may import, with no service
// and no error.
import { Schema } from "effect";
import { InputId } from "./Id.ts";

/** A place in the log or in a stream. Both count from 1; 0 means before the first. */
export const Rev = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type Rev = typeof Rev.Type;

/** Old saved parents keep their original identity. New checked inputs use InputId. */
const LegacyParentText = Schema.String.check(Schema.isPattern(/^in-process_[0-7][0-9a-hjkmnp-tv-z]{25}-[1-9][0-9]*$/));

export const ParentText = Schema.Union([InputId, LegacyParentText]);
