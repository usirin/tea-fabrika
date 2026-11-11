// The `fabrika` command and its subcommands, composed with the platform Layers. This start file
// chooses the TOML adapter, as dev.ts does; the commands themselves live in libfabrika.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Settings from "@kampus/libfabrika/node/settings/Command";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { Digest } from "effect/crypto";

const VERSION = "0.0.0";

const fabrika = Command.make("fabrika").pipe(Command.withSubcommands([Settings.make({ version: VERSION })]));

NodeRuntime.runMain(
  Command.run(fabrika, { version: VERSION }).pipe(
    Effect.provide([NodeServices.layer, TomlParser.layer, Digest.layerWebCrypto]),
  ),
);
