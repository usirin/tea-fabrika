/**
 * The settings fabrika itself declares: `instance.port`, `fabrika-version`, `gateway.limit` and `gateway.window`, and `all`, the group of the four.
 *
 * **Details**
 *
 * A schema's title and description are the words a refused value is explained with. Every setting here is `since` release 0.0.0 and reloads on restart. See docs/direction/settings.md, "Is this a setting?", for how a choice becomes one.
 *
 * @stability unstable
 */
import { Schema } from "effect";
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

/**
 * Setting for the port the local instance listens on.
 *
 * **Details**
 *
 * The value is a whole number from 1 to 65535. The default is 18787. It is set in a person's file only.
 *
 * @stability unstable
 * @category settings
 */
export const port = Setting.make("instance.port", {
  schema: Port,
  default: 18787,
  doc: "The port the local instance listens on.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the oldest fabrika release a repo works with.
 *
 * **Details**
 *
 * The value is three whole numbers, as `1.2.3`. It is set in the repo's file only, and it is read before every other setting. The default is 0.0.0, the first release that reads settings, and a later release never raises it by itself.
 *
 * @stability unstable
 * @category settings
 */
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

/**
 * Group of every setting fabrika declares, ready to load, validate and print.
 *
 * **Details**
 *
 * Holds `port`, `version`, `gatewayLimit` and `gatewayWindow`. Making the group checked their paths, environment names and defaults together.
 *
 * @stability unstable
 * @category settings
 */
export const all = Setting.group({ port, version, gatewayLimit, gatewayWindow });
