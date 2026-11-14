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
 * Discovery of saved ledger stream names, independent of their contents.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Stream } from "effect";

/**
 * A failure while reading the store.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", {
  cause: Schema.Defect(),
}) {}

/**
 * A saved stream name that failed decoding.
 *
 * @stability unstable
 * @category errors
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", {
  cause: Schema.Defect(),
}) {}

/**
 * The discovery service's failure, with its original cause.
 *
 * @stability unstable
 * @category errors
 */
export class LedgerStreamsError extends Schema.TaggedError<LedgerStreamsError>()("LedgerStreamsError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/**
 * Service that lists distinct names matching a literal prefix in storage order.
 *
 * @stability unstable
 * @category services
 */
export class LedgerStreams extends Context.Service<
  LedgerStreams,
  { readonly list: (prefix: string) => Stream.Stream<string, LedgerStreamsError> }
>()("@kampus/libfabrika/ledger/LedgerStreams") {}
