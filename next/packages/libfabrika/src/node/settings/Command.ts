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
 * `fabrika settings`: one fresh load of the declared settings, printed with their origins,
 * defaults and descriptions. It selects no repo, as a dev start does, so it reads only the
 * person's file, the declared environment names and the declared flags. The whole report is built
 * before anything prints, and it writes nothing and starts nothing.
 *
 * @stability unstable
 */
import { Config, Console, Effect, Path } from "effect";
import { Command, Flag } from "effect/cli";
import * as Declarations from "../../settings/Declarations.ts";
import * as Print from "../../settings/Print.ts";
import * as Reference from "../../settings/Reference.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import * as Load from "./Load.ts";

const declarations = Declarations.all.declarations;

/** The entries that hold a value, as one record. */
const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));

const optional = (name: string) => Config.String(name).pipe(Config.withDefault(undefined));

/**
 * Creates the `settings` command, which prints the settings this fabrika reads, with their origins
 * and defaults.
 *
 * **Details**
 *
 * Each declared setting is also a flag at its own path, as `--instance.port`, and `--all` adds the
 * settings their defaults supply. `options.version` is the running fabrika's version, handed to
 * the load as it is.
 *
 * @stability unstable
 * @category commands
 */
export const make = (options: { readonly version: string }) =>
  Command.make(
    "settings",
    {
      // Each declared setting is a flag at its own path, as --instance.port.
      settings: Object.fromEntries(
        declarations.map((d) => [
          d.path,
          Flag.String(d.path).pipe(Flag.withDescription(d.doc), Flag.withDefault(undefined)),
        ]),
      ),
      all: Flag.Boolean("all").pipe(
        Flag.withDescription("Also show the settings their defaults supply."),
        Flag.withDefault(false),
      ),
    },
    (flags) =>
      Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
        const path = yield* Path.Path;
        const fabrikaHome = yield* optional("FABRIKA_HOME");
        const home = fabrikaHome ?? path.join(yield* Config.String("HOME"), ".fabrika");
        // A person reads their file's name from ~ or FABRIKA_HOME, never as this machine's path.
        const person = {
          path: path.join(home, "fabrika.toml"),
          name: `${fabrikaHome === undefined ? "~/.fabrika" : "$FABRIKA_HOME"}/fabrika.toml`,
        };
        const env: Array<readonly [string, string | undefined]> = [];

        for (const d of declarations) {
          env.push([d.env, yield* optional(d.env)]);
        }

        const loaded = yield* Load.load({
          person,
          flags: present(declarations.map((d) => [d.path, flags.settings[d.path]])),
          env: present(env),
          version: options.version,
        });
        const rows = Reference.rows(Declarations.all, loaded.snapshot);
        const warnings = loaded.repo === undefined ? [] : Print.warnings(Reference.warnings(rows, loaded.repo.minimum));
        const report = Print.report(rows, { all: flags.all });

        for (const warning of warnings) {
          yield* Console.error(warning);
        }

        yield* Console.log(report.trimEnd());
      }),
  ).pipe(Command.withDescription("Print the settings this fabrika reads, with their origins and defaults."));
