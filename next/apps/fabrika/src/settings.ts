import { SettingsStart } from "@kampus/libfabrika";
import { Schema } from "effect";

export const Settings = SettingsStart.Input;
export type Settings = typeof Settings.Type;

export const Founding = Schema.Struct({
  name: Settings.fields.name,
  ...Settings.fields.founding.fields,
  build: Settings.fields.build,
  limits: Settings.fields.limits,
  mail: Settings.fields.mail,
});

export type Options = Omit<Settings, "start" | "build"> & { readonly start?: string; readonly home: string };
