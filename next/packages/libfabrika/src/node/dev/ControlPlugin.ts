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
 * The control plugin the local brain's driver hands to Alchemy's local runtime.
 *
 * @stability unstable
 */
import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const identifier = "cloudflare-runtime/plugin/FabrikaControl";

/**
 * Service for the local runtime's control socket, under the name Alchemy's plugin contract gives
 * it. The driver provides it with one socket on 127.0.0.1 and a `start` that hears the port the
 * runtime chose.
 *
 * @stability unstable
 * @category services
 */
export class ControlPlugin extends Plugin.Service<ControlPlugin>()(identifier) {}
