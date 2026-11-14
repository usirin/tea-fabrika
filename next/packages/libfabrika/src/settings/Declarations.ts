/**
 * The settings fabrika itself declares: `instance.port`, `fabrika-version`, `gateway.limit`, `gateway.window`, the
 * four local brain settings under `desktop.brain-*`, `desktop.link-ttl`, and `all`, the group of the nine.
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
 * Setting for the most draft frames one checked sender may route in a gateway window: their own
 * budget, so typing never spends `gateway.limit`. The default is twice a fast typist's ten keys a
 * second over the 60-second window.
 *
 * @stability unstable
 * @category settings
 */
export const gatewayDraftLimit = Setting.make("gateway.draft-limit", {
  schema: Positive,
  default: 1_200,
  doc: "The most draft frames one signed-in key may send in one gateway window.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for a one-time browser link's lifetime in whole milliseconds.
 *
 * @stability unstable
 * @category settings
 */
export const desktopLinkTtl = Setting.make("desktop.link-ttl", {
  schema: Positive,
  default: 60_000,
  doc: "How long a one-time browser link lives in milliseconds.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the delay in whole seconds that the service manager waits between crash restarts
 * of the local brain.
 *
 * @stability unstable
 * @category settings
 */
export const brainThrottle = Setting.make("desktop.brain-throttle", {
  schema: Positive,
  default: 2,
  doc: "The delay in whole seconds between crash restarts of the local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the interval in milliseconds between two readiness or shutdown checks of the local
 * brain. A native command that is interrupted gets the same interval to exit before it is killed.
 *
 * @stability unstable
 * @category settings
 */
export const brainPoll = Setting.make("desktop.brain-poll", {
  schema: Positive,
  default: 100,
  doc: "The interval in milliseconds between brain readiness and shutdown checks.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most milliseconds one attempt to start or reuse the local brain may take
 * before it fails.
 *
 * @stability unstable
 * @category settings
 */
export const brainStartTimeout = Setting.make("desktop.brain-start-timeout", {
  schema: Positive,
  default: 60000,
  doc: "The maximum time in milliseconds to start or reuse a ready local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most milliseconds one stop may take to confirm that the local brain and what
 * it owns are gone, before it fails.
 *
 * @stability unstable
 * @category settings
 */
export const brainStopTimeout = Setting.make("desktop.brain-stop-timeout", {
  schema: Positive,
  default: 5000,
  doc: "The maximum time in milliseconds to confirm the local brain and its children have stopped.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Group of every setting fabrika declares, ready to load, validate and print.
 *
 * **Details**
 *
 * Holds `port`, `version`, `gatewayLimit`, `gatewayWindow`, the four local brain settings
 * (`brainThrottle`, `brainPoll`, `brainStartTimeout` and `brainStopTimeout`) and `desktopLinkTtl`.
 * Making the group checked their paths, environment names and defaults together.
 *
 * @stability unstable
 * @category settings
 */
export const all = Setting.group({
  port,
  version,
  gatewayLimit,
  gatewayWindow,
  brainThrottle,
  brainPoll,
  brainStartTimeout,
  brainStopTimeout,
  desktopLinkTtl,
});
