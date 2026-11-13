// The settings fabrika itself declares (docs/direction/settings.md, "Is this a setting?"). A
// schema's title and description are the words a refused value is explained with (S5).
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

export const brainThrottle = Setting.make("desktop.brain-throttle", {
  schema: Positive,
  default: 2,
  doc: "The delay in whole seconds between crash restarts of the local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

export const brainPoll = Setting.make("desktop.brain-poll", {
  schema: Positive,
  default: 100,
  doc: "The interval in milliseconds between brain readiness and shutdown checks.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

export const brainStartTimeout = Setting.make("desktop.brain-start-timeout", {
  schema: Positive,
  default: 60000,
  doc: "The maximum time in milliseconds to start or reuse a ready local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

export const brainStopTimeout = Setting.make("desktop.brain-stop-timeout", {
  schema: Positive,
  default: 5000,
  doc: "The maximum time in milliseconds to confirm the local brain and its children have stopped.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

export const all = Setting.group({
  port,
  version,
  gatewayLimit,
  gatewayWindow,
  brainThrottle,
  brainPoll,
  brainStartTimeout,
  brainStopTimeout,
});
