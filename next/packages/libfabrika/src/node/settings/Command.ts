// `fabrika settings`: one fresh load of the declared settings, printed with their origins,
// defaults and descriptions. It selects no repo, as a dev start does, so it reads only the
// person's file, the declared environment names and the declared flags. The whole report is built
// before anything prints, and it writes nothing and starts nothing.
import { Config, Console, Effect, Path } from "effect";
import { Command, Flag } from "effect/cli";
import * as Declarations from "../../settings/Declarations.ts";
import * as Print from "../../settings/Print.ts";
import * as Reference from "../../settings/Reference.ts";
import * as Load from "./Load.ts";

const declarations = Declarations.all.declarations;

/** The entries that hold a value, as one record. */
const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));

const optional = (name: string) => Config.String(name).pipe(Config.withDefault(undefined));

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
      Effect.gen(function* () {
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
