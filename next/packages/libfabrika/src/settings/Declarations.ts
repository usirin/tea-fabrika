// The settings fabrika itself declares (docs/direction/settings.md, "Is this a setting?"). A
// schema's title and description are the words a refused value is explained with (S5).
import { Schema } from "effect";
import * as Setting from "./Setting.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).annotate({
  title: "a port",
  description: "A port is a whole number from 1 to 65535.",
});

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)).annotate({
  title: "a version",
  description: "A version is three whole numbers, as 1.2.3.",
});

export const port = Setting.make("instance.port", {
  schema: Port,
  default: 18787,
  doc: "The port the local instance listens on.",
  scope: ["person"],
  reload: "restart",
});

// The first version that reads settings. A later release never raises this default by itself.
export const version = Setting.make("fabrika-version", {
  schema: Version,
  default: "0.0.0",
  doc: "The oldest fabrika this repo works with. It is read before every other setting.",
  scope: ["repo"],
  reload: "restart",
});

export const all = Setting.group({ port, version });
