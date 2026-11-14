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
// The `fabrika` command and its subcommands, composed with the platform Layers. This start file
// chooses the TOML adapter, as dev.ts does; the commands themselves live in libfabrika.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Settings from "@kampus/libfabrika/node/settings/Command";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Effect } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Command } from "effect/cli";
import { Digest } from "effect/crypto";

const VERSION = "0.0.0";

const fabrika = Command.make("fabrika").pipe(Command.withSubcommands([Settings.make({ version: VERSION })]));

NodeRuntime.runMain(
  Command.run(fabrika, { version: VERSION }).pipe(
    Effect.provide([NodeServices.layer, TomlParser.layer, Digest.layerWebCrypto]),
  ),
);
