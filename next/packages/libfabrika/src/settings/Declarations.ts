// The settings fabrika itself declares (docs/direction/settings.md, "Is this a setting?"). A
// schema's title and description are the words a refused value is explained with (S5).
import { ByteSize, Schema } from "effect";
import * as Setting from "./Setting.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).annotate({
  title: "a port",
  description: "A port is a whole number from 1 to 65535.",
});

// The u flag lets Effect write the pattern into the generated JSON Schema.
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)).annotate({
  title: "a version",
  description: "A version is three whole numbers, as 1.2.3.",
});

export const port = Setting.make("instance.port", {
  schema: Port,
  default: 18787,
  doc: "The port the local instance listens on.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

// The first version that reads settings. A later release never raises this default by itself.
export const version = Setting.make("fabrika-version", {
  schema: Version,
  default: "0.0.0",
  doc: "The oldest fabrika this repo works with. It is read before every other setting.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/**
 * Setting for the most attempts one checked sender may route in a gateway window.
 *
 * @stability unstable
 * @category settings
 */
export const gatewayLimit = Setting.make("gateway.limit", {
  schema: Positive,
  default: 600,
  doc: "The most routed attempts one signed-in key may make in one gateway window.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the gateway budget's window in milliseconds.
 *
 * @stability unstable
 * @category settings
 */
export const gatewayWindow = Setting.make("gateway.window", {
  schema: Positive,
  default: 60_000,
  doc: "The gateway window in milliseconds.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

const Bytes = Schema.ByteSizeFromString.check(
  Schema.makeFilter((n) => ByteSize.toBigInt(n) > 0n, {
    expected: "a positive byte size",
  }),
);

const RecoveryAllowance = Schema.Struct({
  writes: Positive,
  bytes: Bytes,
  letter: Schema.Struct({ writes: Positive, bytes: Bytes }),
});

/**
 * Setting for the most ledger writes one program may commit per rolling minute.
 *
 * @stability unstable
 * @category settings
 */
export const writes = Setting.make("limits.writes", {
  schema: Positive.check(Schema.isLessThanOrEqualTo(13_760)),
  default: 13_760,
  doc: "The most ledger writes one program may commit per rolling minute, including admitted steps.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most encoded ledger bytes one program may keep.
 *
 * @stability unstable
 * @category settings
 */
export const storage = Setting.make("limits.storage", {
  schema: Bytes.check(
    Schema.makeFilter((n) => ByteSize.toBigInt(n) <= 1_000_000_000n, {
      expected: "at most 1000000000 B",
    }),
  ),
  default: ByteSize.bytes(1_000_000_000),
  doc: "The most encoded ledger bytes one program may keep, at most decimal one GB.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the recovery allowance of each storage location: its writes and bytes per rolling
 * minute, and the room one replayed letter may take.
 *
 * @stability unstable
 * @category settings
 */
export const recovery = Setting.make("limits.recovery", {
  schema: Schema.Struct({ project: RecoveryAllowance, process: RecoveryAllowance }),
  default: {
    project: { writes: 160, bytes: ByteSize.bytes(74_080), letter: { writes: 10, bytes: ByteSize.bytes(5_469) } },
    process: { writes: 290, bytes: ByteSize.bytes(207_410), letter: { writes: 50, bytes: ByteSize.bytes(18_790) } },
  },
  doc: "Recovery writes and bytes per rolling minute, plus each accepted letter's replay room.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

export const all = Setting.group({ port, version, gatewayLimit, gatewayWindow, writes, storage, recovery });
