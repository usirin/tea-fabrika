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
import { SettingsStart } from "@kampus/libfabrika";
import { Schema } from "effect";

export const Settings = SettingsStart.Input;
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Settings = typeof Settings.Type;

export const Founding = Schema.Struct({
  name: Settings.fields.name,
  ...Settings.fields.founding.fields,
  build: Settings.fields.build,
  limits: Settings.fields.limits,
  mail: Settings.fields.mail,
});

export type Options = Omit<Settings, "start" | "build"> & { readonly start?: string; readonly home: string };
