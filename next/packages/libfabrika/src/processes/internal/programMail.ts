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
// Program mail's pure rules, next/ (P41 slice 1): a delivery's ID and the host's grant.
import type { Grants } from "../ProgramMail.ts";

/**
 * A delivery's ID: its dispatched command's one child under `/mail`. Never `/answer`, which is the
 * runner's own reply space, so peer mail never passes as a runner's own letter.
 * @internal
 */
export const mailId = (command: string): string => `${command}/mail`;

/**
 * Whether the host's grant lets `source` reach `to`: only a source's own entry counts, never an
 * inherited key.
 * @internal
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const granted = (grants: Grants, source: string, to: string): boolean =>
  Object.hasOwn(grants, source) && (grants[source] ?? []).includes(to);

/** The business `ref` a message carries, if it has one. @internal */
export const businessRef = (m: unknown): string | null =>
  typeof m === "object" && m !== null && "ref" in m && typeof m.ref === "string" ? m.ref : null;
