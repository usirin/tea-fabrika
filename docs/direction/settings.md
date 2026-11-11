# Settings

**Proposed 2026-11-10.** Decided before this note, and marked decided wherever it appears:

- **[0069](../../.decisions/0069-choices-are-settings.md)** (owner, 2026-11-10): a choice that makes
  sense as a `fabrika.toml` value is one, in both versions. In `next/` it is declared once as an
  Effect `Config` with its schema and its default, and the file, the environment, a flag and a test
  all feed it the same way. A test never takes an option a person cannot reach. It holds in `next/`
  now, and Tier 1's P38 (tracker ticket 664) builds the foundation and the settings for what Tier 1
  builds or changes.
- **Which settings Tier 1 gets is P38's plan's answer** (owner, 2026-11-10, in
  [0069](../../.decisions/0069-choices-are-settings.md)). The plan lists every choice Tier 1 builds or
  changes and says of each: a setting or not, and why. It is never a question for the owner, so the
  [table below](#tier-1s-choices-for-p38s-plan) is input for that plan.
- **[0070](../../.decisions/0070-flow-runner-stays-a-machine.md)** (2026-11-10): for now the lead's
  flow runner stays a plain tea machine on tea's Effect engine, not a `Program.make`, until a program
  can run outside fabrika's app. It changes nothing here, but it bounds one part: a program's own
  settings ([below](#how-a-program-declares-its-own-settings-and-a-packs)) reach only programs the
  app runs, and the flow runner is not one yet.
- **[One fabrika.toml per repo](./one-fabrika-toml-per-repo.md)** (2026-10-05, the folder
  2026-10-30): `.fabrika/fabrika.toml` and `~/.fabrika/fabrika.toml`, one spelling, TOML. A knob is a
  number, a name or a pick between paths the code has and tests. The step order stays in code. An
  empty file changes nothing, an unknown key fails, and a value out of range fails and names the key.
  A run copies its settings when it is filed, machines never read the file, and each machine is
  handed its values. Packs are `[pack.<name>]` tables.
- **[Keybindings are configurable](./keybindings-are-configurable.md)** (2026-11-01): keys live in
  `~/.fabrika/keybindings.toml`; a bad file keeps the last good table and names the line; a save
  takes effect at the next key.
- **[Themes](./themes.md)** (2026-11-01): `theme = "<name>"` in the person's file, each theme its own
  file.
- **[Principles](./principles.md)** 5 (2026-11-08): unsure is a setting, with a safe default and its
  use recorded; an agent cannot write `.fabrika/`; a wall is never a setting an agent can turn off.
- **[Secrets are Redacted](./secrets-are-redacted.md)** (2026-10-26): no secret in the file; a
  secret is read with `Config.Redacted`.
- **[Pin exact versions](./pin-exact-versions.md)**, and
  **[0068](../../.decisions/0068-tiers-carry-every-part.md)** (2026-11-10): each tier carries a working
  slice of every core idea.

Built from [experiment 251](../../experiments/251-settings.md), which read how about twenty makers
and tools let people set a choice and checked `next/`'s stage against them, and a private Design
canvas, "Settings guidelines". Neither is a measurement. A tag such as [c5] points at that
experiment's links.

```ts
// A sketch, next/. The running example: load one more program into a local stage.
// One declaration per setting: its path, schema, default, words, where it may be set, how it reloads.
import { ConfigProvider, Effect, Schema } from "effect";
import * as Setting from "@kampus/libfabrika/settings"; // a sketch name for P38's room

export const port = Setting.make("stage.port", {
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  default: 18787,
  doc: "The port the local stage listens on.",
  where: "person", // the person's file, the environment or a flag; never the repo's file
  reload: "restart",
});

export const programs = Setting.make("stage.programs", {
  schema: Schema.Record(Schema.String, Schema.String),
  default: {},
  doc: "More programs to load, by name. Each is a module that exports `program`, read from the file's folder.",
  where: "both", // a person's own and a repo's own programs; the two tables merge by name
  reload: "restart",
});

export const Stage = Setting.group({ port, programs }); // a Config, plus the keys it declares

// A test sets it the way a person does, through a provider (0069).
const stage = yield* Stage.parse(ConfigProvider.fromUnknown({ stage: { programs: { "writer-fixture": writer } } }));
yield* build({ out, programs: stage.programs });
```

```toml
# ~/.fabrika/fabrika.toml, the person's file. Empty, it changes nothing.
#:schema ./fabrika.schema.json
theme = "fabrika"

[stage]
programs = { writer-fixture = "./fixtures/writer.ts" }
```

```text
one start traced: dev.ts with the file above, line 6 its programs line, and no repo file
read     ~/.fabrika/fabrika.toml          TOML, then a strict decode against every declared key
read     .fabrika/fabrika.toml            the repo's file, as committed on its default branch: none
env      FABRIKA_STAGE_PORT               not set
flags    none
layer    per key: flag, then env, then the repo's file, then the person's, then the default
print    stage.port       18787                                  default
         stage.programs   writer-fixture = ./fixtures/writer.ts  ~/.fabrika/fabrika.toml:6
hand     build({ programs }), localStage({ port }); no machine reads a file
record   the stage's start entry holds the values in force and their hash, as it holds `build`
```

## Which version

- **`next/`:** all of it. P38 builds the room, the providers and Tier 1's settings; this note gives
  its plan the shape and a table of Tier 1's choices ([below](#tier-1s-choices-for-p38s-plan)).
- **Today's version (`packages/pipeline`, `apps/fabrika`):** it already reads both files, refuses
  unknown keys and prints where each pick came from. One small tryout is offered
  ([below](#a-tryout-in-todays-version)); nothing else changes.

## The word

**"Setting".** One named value a person, a repo, a test or an agent's start can set. The repo already
says it (`settings.ts` in both versions, the glossary's `fabrika.toml` row, "The settings file", and
0069), and so do VS Code, Zed and Linear. tmux and Neovim say "option", Git and Cargo say "config".
Here "option" stays for a function's options object, such as `build`'s `Options`, and "flag" for the
command line. `Config` and `ConfigProvider` stay Effect's own words for the code that declares and
feeds a setting. Proposed glossary row, for the Shared names section:

```text
| setting | One named value in fabrika.toml (or keybindings.toml, or a theme file), declared once in code
  with its schema, default, words, where it may be set and how it reloads; fed alike by a file, the
  environment, a flag and a test. [Settings](../docs/direction/settings.md), 0069 | Not an "option",
  which is a function's options object, or a "flag", which is the command line's. Not state: what a
  process changes as it runs is never a setting. Not Effect's `Config`, which is the code that reads it. |
```

## The shape

```ts
// A sketch, next/. What one declaration holds. Checked against effect 4.1.2 in experiment 251's probes.
type Where = "person" | "repo" | "both"; // which files may set it; env and flags may set any.
// A file that sets a key its `where` refuses stops the start, in words (S5).
type Reload = "live" | "restart";

interface Setting<A> {
  readonly path: string;          // "stage.port": the TOML path, and FABRIKA_STAGE_PORT, and --stage.port
  readonly schema: Schema.Codec<A>;
  readonly default: A;            // exactly one, here (0069)
  readonly doc: string;           // required: the words every output shows
  readonly where: Where;
  readonly reload: Reload;
  readonly config: Config.Config<A>; // Effect's Config at the path, with the default; nobody writes a second
}
```

- **Why a declaration around `Config`, not `Config` alone.** Experiment 251's probe found a `Config`
  cannot see a key nobody asked for: `prot = 1` gives the default port and no word. So the strict
  load needs the list of declared paths, and so do the print, the docs and the editor schema. A
  `Config` is opaque; the declaration keeps what it cannot.
- **The strict load** decodes the whole file once against a struct built from the declarations, with
  `onExcessProperty: "error"`, which the probe showed gives "Expected no excess property at
  ["prot"]". Then each `Config` reads through the layered providers.
- **`Setting.group`** joins declarations into one `Config` (`Config.all` under `Config.nested`), and
  the probe showed two files then merge field by field.

## The seven principles

### S1: a choice is a setting, and a few things never are

**Decided 2026-11-10 (0069), for "is a setting". Lean, 75%, for the list of what never is.**

- **Means.** A number, a name or a pick between tested paths that two people or two repos could
  want differently is a setting. A plan asks of each new choice "is this a setting?" and a no costs
  one line of why (0069). These never are, whatever their type:

```text
never a setting            why                                         today's example
the step order             a config that decides what happens next     2026-10-05 note
a wall                     a check, an approval, a person-only answer  React Compiler strictness, compiler-ledger.json
a secret                   Config.Redacted, from the env or a locker   secrets are redacted
an identity or a founding  a fact, written once on the ledger          dev.ts --founder, --window
state                      it changes as things run                    the desk; ~/.fabrika/stage.json
process plumbing           one process telling another                 dev.ts --child, --parent
the home itself            the files live there                        FABRIKA_HOME
a security limit           changing it weakens recovery                P36's 10 minutes and 5 tries
a constant nobody varies   no person would choose differently          the 50 ms settle in host/settings.ts
```

- **Why.** Twelve-factor's "strict separation of config from code" [c13], and the tmux and Neovim
  quality 0069 names: simple with an empty file, and as far as a person wants in one plain file.
- **Linear as the builder (guess).** One place where every preference is a row with words, so
  nothing a person might change hides in code. As fabrika programs: a `settings` program owns
  viewing and changing them, and every program gets its rows for free from its declaration, as it
  gets palette rows from `commands`.
- **OTP.** An application's `env` is its settings, and the command line overrides them [c17]. A
  supervisor's restart intensity is not: it sits in the supervisor's own `init/1`, in code. So
  Tier 1's restart `Policy` stays a program fact (the glossary's Policy row), lean 60%.
- **Holds it.** Taste and review: the plan's question. The parts code can check are in S2 and the
  lint call.
- **The doubt.** "Makes sense as a value" is judgment. A week of P38's plan and the next plans will
  show whether the list above covers what comes up.
- **Today.** Breaks: `programs` (`next/apps/fabrika/src/build.ts:16`) and the record cap
  (`stage-records.test.ts:190`) are choices only a test reaches.

### S2: declared once, and everything else comes from the declaration

**Lean, 85%. The one default is decided (0069).**

- **Means.** Path, schema, default, words, where and reload live in one `Setting.make`. The file
  reader, the environment name, the flag, the print, the docs, the editor schema and the error all
  come from it. No second schema, no default in a caller, no hand-typed copy of the shape.
- **Why.** Ghostty's docs are "all generated from the same source" [c5]. VS Code's extensions declare
  `default`, `markdownDescription` and `scope` in one place [c9]. Effect's own guide: describe what
  you need with `Config`, and the provider reads it [c15].
- **Linear as the builder (guess).** The settings program reads the declarations; nobody writes a
  settings screen per program.
- **Elm.** One decoder per flag shape, "exactly what you expect" [c20].
- **Holds it.** Law: a type that requires `doc` and `default`; a test that the committed editor
  schema equals the generated one; a test per setting that the file, the environment, a flag and
  `fromUnknown` all reach it.
- **The doubt.** Whether `Setting.make` is ours or a small patch to Effect's `Config`. Read Effect's
  issues before P38 builds it ([0054](../../.decisions/0054-read-upstream-before-patching-it.md)).
- **The cost.** The whole settings room, about 300 to 500 lines with tests, a guess; see
  [what it costs](#what-it-costs) for what that counts.
- **Today.** Breaks: the record cap has three shapes and its default sits apart
  (`next/apps/fabrika/src/settings.ts:10`, `packages/libfabrika/src/workers/record.ts:78`, `:27`); the
  port's default is in `next/apps/fabrika/dev.ts:71`; `BrainOptions` types it all again
  (`packages/libfabrika/src/workers/runtime.ts:97`).

### S3: an empty file works

**Decided 2026-10-05, "an empty file changes nothing". Lean, 85%, that nothing is required to start.**

- **Means.** Every setting has a default, so no file, no flag and no environment variable is needed
  to start. A value that has no sane default is not a setting: it is a founding fact, asked once on
  the founding screen and written on the ledger.
- **Why.** tmux reads its file "if present" [c1]; Ghostty is "designed to work out of the box with no
  configuration" [c5]; Ableton's default set is the person's own starting state [o3].
- **Linear as the builder (guess).** A new workspace works before anyone opens settings.
- **Elm.** `init` gets flags; with a decoder and a default, an empty object is a good start.
- **Holds it.** Law: a property that the empty file decodes to every declared default.
- **The doubt.** A default that works once may not work twice. Two stages on one laptop both take
  port 18787 from an empty file, so the second one cannot start. P38's plan says whether a second
  stage stops with words naming `stage.port`, or the default means "a free port" and the print shows
  the one it took. Running two stages at once would settle it.
- **Today.** Half: there is no file, and with no flags the stage cannot start, since `name`, `person`
  and `founder` have no default (`next/apps/fabrika/src/settings.ts:4`). Those are founding facts;
  only `name` is a setting, decided as `[ledger] name` in
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md).

### S4: one order, per key, and every value says where it came from

**Lean, 75%.**

- **Means.** For each key: a flag, then the environment, then the repo's file, then the person's
  file, then the default. A setting's `where` says which files may set it; a file that sets a key
  its `where` refuses stops the start (S5), and is never skipped quietly. Where both files may set
  an open table, such as `stage.programs`, the two merge by name, and on a name both use the repo's
  wins ([an open table in two places](#an-open-table-in-two-places)). `fabrika settings` prints each
  key, its value and where it came from, with the file and line.
- **Why.** Git: "last value found taking precedence", and `--show-origin` [c4]. Cargo: `--config` over
  environment over files, the home lowest [c10]. VS Code: workspace "override user settings", and
  `application` settings live only in user settings [c9]. tmux marks inherited values with an
  asterisk [c1]; Neovim says "where it was last set" [c2].
- **Linear as the builder (guess).** A personal preference never lets a teammate's pick change your
  view, and a workspace setting says it is the workspace's. That is `where`.
- **OTP.** `.app` env, then `sys.config`, then the command line [c17]: the same order.
- **Holds it.** Law: a property over random sources that the most specific one wins, per key, and
  that the printed source is the one that won.
- **The doubt.** The repo over the person, see [the order](#the-order-when-sources-disagree).
- **Today.** Breaks: a flag beats `~/.fabrika/stage.json` and then is written into it
  (`next/apps/fabrika/dev.ts:57`, `:76`), so a later start cannot tell a flag from a saved value, and
  nothing prints a source. Today's version prints each pick and where it came from
  (`packages/pipeline/src/setup.ts:5`).

### S5: a wrong value stops, in words, at the key

**Decided 2026-10-05, for "an unknown key fails" and "a value out of range fails and names the key".
Lean, 80%, for the words and for what a running app does.**

- **Means.** At start, a wrong value, an unknown key, or a key set in a file its `where` refuses
  stops the start with one message: the file, the line, the key, the value, what it should be, and
  what happened. While running, a bad save keeps the last good values and says why, as keys already
  do. A refused file stops the start for the reason the 2026-10-05 note gives for `[ledger]` in a
  nested file: "The mistake cannot be made, rather than warned about."
- **The files the messages name.** The person's file is [D2's](#d2-toml-tables-per-area-and-per-program-with-a-schema),
  the lean, with `port = 70000` on line 5. The second message is the same file with line 5 typed
  `prot = 18800`. The third is a repo's file of two lines. D1, D3 and D4 each give their own line
  below.

```text
.fabrika/fabrika.toml, the repo's file for the third message
1  [stage]
2  port = 18800
```

```text
~/.fabrika/fabrika.toml, line 5: stage.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The stage did not start.
~/.fabrika/fabrika.toml, line 5: there is no setting stage.prot. Did you mean stage.port?
  fabrika settings lists every setting. The stage did not start.
.fabrika/fabrika.toml, line 2: stage.port is a person's setting, so a repo's file may not set it.
  Set it in ~/.fabrika/fabrika.toml, as FABRIKA_STAGE_PORT, or with --stage.port. The stage did not start.
```

- **"Did you mean" names only a key that file may set.** A key that exists but that file may not set
  gets the third message, never a guess. An unknown key in the repo's file whose nearest key is a
  person's, such as `stage.prot` there, gets no "Did you mean": it reads "there is no setting
  stage.prot that a repo's file may set", then the list line.

- **Why.** WCAG 3.3.1: the item "is identified and the error is described to the user in text" [c22].
  Helix refuses unknown keys and says "Bad config" [c6]; kubectl is strict [c12]; tmux errors unless
  `-q` [c1].
- **Linear as the builder (guess).** A bad value is never saved silently; the field says what is
  wrong where it is.
- **Elm.** A failed decode is an error to handle, never a guess.
- **Holds it.** Law: example tests labeled `format:` for the three messages; a property that every
  out-of-range value fails and names its key; and a property that every key set in a file its
  `where` refuses stops the start and is never offered as a "Did you mean".
- **The doubt.** Line numbers: Effect's error names the path only ("Expected a value between 1 and
  65535 at ["port"]"), so the line needs a TOML parser that keeps positions, or a search for the key.
  Today's keys reader already gives a line (`apps/fabrika/src/host/keybindings.ts:84`).
- **Today.** Half: the schema refuses a bad port, but `dev.ts` turns every failure into
  `StageError({ reason: "settings" })` (`next/apps/fabrika/dev.ts:75`), so the key and the value are
  lost.

### S6: read at the edge, handed in, and recorded

**Decided 2026-10-05 and 2026-10-11, for "machines never read the file" and "each machine is handed its
values". Lean, 70%, for the record and for live settings.**

- **Means.** The hands or the start code read the files and hand values in. A `restart` setting is
  fixed for a process's life. A `live` setting arrives as a new value, the way a theme or a key table
  does, and the process takes it as input. The stage's start entry records the values in force and
  their hash; a record names that hash beside its `build`.
- **Why.** OTP reads env at run time, and Elixir split `runtime.exs` from the build-time file [c18];
  its own advice for a library is "a parameter passed to the function" [c19], which is "handed in".
  Ghostty: "Some configuration options cannot be reloaded at runtime" [c5].
- **Linear as the builder (guess).** A change shows at once everywhere you are, since they save as you
  type.
- **Elm.** Flags at `init`; a later change is a `Sub`, never a read from inside `update`.
- **Holds it.** Law: a restart test that a replayed process keeps the settings hash it started with,
  and a type: no machine's Model holds a provider.
- **The doubt.** Whether the brain's Worker should get each value as its own binding or one `STAGE`
  value as today (`next/apps/fabrika/alchemy.run.ts:31`). P38's plan answers it.
- **Today.** Half: `dev.ts` reads once and hands values to the stage. But the Worker decodes `STAGE`
  again (`packages/libfabrika/src/workers/record.ts:74`), and no record names its settings.

### S7: you find out what you can set from fabrika itself

**Lean, 75%.**

- **Means.** Three outputs from the declarations, and nothing written by hand:
  - `fabrika settings`: every key, its value, where it came from, its default and its words;
    `--all` adds the ones left at default.
  - a JSON Schema beside the files, named by `#:schema`, so an editor completes and checks keys.
  - the reference page.
  A settings program in a tile, with search, is Tier 2's, when the window has programs; it needs the
  guidelines skill's real look step.
- **Why.** `ghostty +show-config --default --docs` [c5]; `git config --list --show-origin` [c4];
  Taplo's `#:schema` [c11]; Neovim's `:checkhealth` [c3].
- **Linear as the builder (guess).** Settings are found by search, the same box as every command.
  Here that is the palette: "settings" opens the program at the key.
- **OTP.** `application:get_all_env/1` lists an application's env. No docs from it.
- **Holds it.** Law: a test that the committed schema and the printed list match the declarations.
  Taste: the settings program, beside Linear, later.
- **The doubt.** Until Tier 2's settings program, a person finds settings only through a command and
  an editor's hints, and nobody has checked that a person reaches for `fabrika settings` at all.
  The editor half is untried too: `SchemaRepresentation.toJsonSchemaDocument` exists in `effect`
  4.1.2, but no JSON Schema was made from a declaration and opened in an editor. A first person
  using Tier 1, and one schema opened under Taplo, would settle each.
- **Accessibility.** The print is plain text, so a screen reader reads it as lines. The settings
  program will need a real VoiceOver run, and every field's error in text (WCAG 3.3.1).
- **Today.** Breaks in `next/`: nothing lists what can be set. Today's version prints the picks of a
  run, which is the nearest thing.

## Tier 1's choices, for P38's plan

Every choice Tier 1 builds or changes in `next/`, marked setting or not. This is input for P38's plan,
not a question for the owner (0069).

| Choice | Where today | Setting? | Why |
|---|---|---|---|
| more programs for a local stage | `build.ts:16`, test only | yes, `stage.programs`, both, restart; the two tables merge by name | the running example; 0069's first; a repo's own programs are a recorded direction ([packs are programs](./packs-are-programs.md)) and 0068 wants outside programs early |
| the stage's port | `dev.ts:15`, default `dev.ts:71` | yes, `stage.port`, person, restart | a number two people pick differently |
| the project's name | `dev.ts:16`, `settings.ts:4` | yes, `ledger.name`, repo, restart | decided as `[ledger] name` |
| the person | `dev.ts:17`, `settings.ts:5` | no, a founding fact | who founded it; on the ledger once |
| the founder's key | `dev.ts:18` | no, an identity | a public key; its file's path may be a person setting later, as the 2026-10-30 note's key file |
| the window's key | `dev.ts:19` | no, an identity | the window makes its own (P3) |
| the record cap | `settings.ts:10`, `record.ts:27` | yes, `limits.record`, repo, restart, a byte size written `"1 GB"`, may only lower | a limit; numbers come from `fabrika.toml` ([tea program](./tea-program.md)) |
| chaos in a build | `build.ts:17` | yes, `stage.chaos`, person, restart; a cloud stage refuses `true` | a pick between two tested builds (P24, P27) |
| the `.tsx` files the Compiler checks | `build.ts:13` | no, a wall | every file, always ([React Compiler](./react-compiler.md)) |
| the Compiler's exceptions | `build.ts:14`, `compiler-ledger.json` | no, a wall | owner-approved rows, never a setting |
| `--child`, `--parent` | `dev.ts:13` | no, plumbing | one process to its own child |
| the home folder | `dev.ts:56` | no; stays `FABRIKA_HOME` | the files live there (decided 2026-10-30) |
| no telemetry | `dev.ts:36` | no, a wall | fabrika sends nothing out on its own |
| restart policy | P34, the glossary's `Policy` | no, a program fact, 60% | OTP keeps intensity in the supervisor's code |
| the person's keys | P20, `keybindings.toml` | yes, its own file | decided (K4: Tier 1 reads the file) |
| hot reload | P15 | no | decided behavior; nobody turns it off |
| email code, 10 minutes, 5 tries | P36 | no, a security limit | weakens recovery |
| `fabrika mcp --as <agent>` | P25 | no, a flag for one call | names who is calling, not a choice that lasts |
| Approve once per agent name | P25 | no, a person-only wall | principle 5 |
| the cloud stage's account | P24 | no, Alchemy's environment | not ours; a credential sits beside it |

## Smaller calls

### The order when sources disagree

```text
A  flag > env > repo file > person file > default        Git, Cargo, VS Code, Helix, Zed
B  flag > env > person file > repo file > default        the person's own file wins
C  A, plus .fabrika/fabrika.local.toml, ignored by git    Git's local config, a per-person repo file
```

**Lean A, 75%.** Every maker read puts the project over the person, and `where` keeps a person's own
picks (theme, port) out of the repo's file, as VS Code's `application` scope does. A person who wants
another value for one repo uses a flag or the environment for that start. B lets one person's file
change a shared pick silently. C adds a second spelling, which the 2026-10-05 note refused.

### An unknown key: fail or warn

```text
A  fails at start; while running, keeps the last good values and says why     decided; Helix, kubectl
B  warns, and loads the rest                                                    WezTerm's default, the k8s server
```

**Decided A (2026-10-05). Lean to keep it, 70%.** The doubt is Kubernetes' own: a file shared by
people on two fabrika versions. A key the newer one added fails the older one. The message names the
closest key, and P38 adds one more line when no key is close: "a newer fabrika may know it; this is
build <hash>". Two people on two versions in Tier 3 would settle it.

### Reload while running

```ts
reload: "live";    // a new value reaches the process as input; theme, keys, a program's own pick
reload: "restart"; // fixed for the process's life; the print says "stage.port: next start"
```

**Lean, 75%.** The [hot reload](./hot-reload.md) note is about code; this is a value change, as keys
and themes already are. A save reaches a `live` setting at the next step, through the same folder
watch today's version uses (`apps/fabrika/src/host/settings.ts:30`). The glossary's control state row
says a setting "never changes": true per process for `restart`, and a `live` value is input, not
control state.

### How a program declares its own settings, and a pack's

```ts
// A sketch, next/. A program gets one field, as it got `commands`.
Program.make({ name: "notes", settings: { width: Setting.field(Schema.Int, { default: 80, doc: "…" }) } });
```

```toml
[program.notes]       # A: under program, beside [pack.<name>]
width = 72
[notes]               # B: the program's name at the top
width = 72
```

**Lean A, 65%.** It sits beside the decided `[pack.<name>]`, and a program's name can never take a
core table such as `[stage]` or `[agents]`. B is shorter, and keybindings already write `notes.edit`
flat; the cost of B is a list of reserved names. A pack's own settings stay in `[pack.<name>]`
(decided); the core decodes them with the schema the pack declares, so the pack's check runs at
load. `width` is made up.

### Docs from the declaration

**Lean, 75%.** `doc` is required by the type. `fabrika settings`, the JSON Schema
(`SchemaRepresentation.toJsonSchemaDocument`, in `effect` 4.1.2) and the reference page are generated,
and a test fails when the committed schema is out of date.

### What a run records about its settings

```ts
// A sketch, next/. One entry at each process start, in the ledger's own fields.
{ _tag: "settings", hash: "sha256-…", values: { "stage.port": 18787, "limits.record": "1000000000" },
  from: { "stage.programs": "~/.fabrika/fabrika.toml" } }
```

**Lean, 70%.** Records name the hash beside `build`. Paths in values are written from `~` or the repo
root, never a machine's absolute path. A value is stored as its schema encodes it, never as the
person typed it: `limits.record` is the parsed count of bytes, and `Schema.ByteSize`'s JSON codec in
`effect` 4.1.2 writes it as a string of digits, so a count past 2^53 stays exact. The unit, bytes, is
named once, in the declaration.

### Whether a check enforces "a choice is a setting"

```text
lint   oxlint's own node/no-process-env in next/, so a value comes through Config      (0040: existing tool)
type   Setting.make requires doc and default; entry functions take a Settings value
law    each declared setting is reachable from the file, the env, a flag and fromUnknown
review the plan's "is this a setting?" (0069)
```

**Lean: all four, 70%.** oxlint 1.90.0, the installed version, has `node/no-process-env`; it would
fire on `dev.ts:36` and `:56`, two edges to mark or move. Its false alarms are not measured yet, so it
starts as advice. "Is this a choice" stays judgment.

### Key spelling and paths

**Lean, 70%.** One short word where it fits (`port`, `record`, `chaos`), kebab-case when it cannot, as
Cargo, Helix and Ghostty write keys. A key does not say again what its type says: `limits.record`
is a byte size, so it is not `recordBytes`. A path in a setting is read from the file's folder, `~`
allowed. The environment name is the path with `FABRIKA_` in front, `FABRIKA_STAGE_PORT`, as Cargo's
`CARGO_FOO_BAR`.

A byte size has one spelling in the file: a string with its unit, as Effect reads it.

```ts
// A sketch, next/. effect 4.1.2: Config.ByteSize(name) is Config.schema(Schema.ByteSize, name).
export const record = Setting.make("limits.record", {
  schema: Schema.ByteSize, // a file gives "64 KiB" or "1 GB"; the value is a ByteSize, an exact count of bytes
  default: ByteSize.bytes(1_000_000_000), // today's 1 GB (record.ts:27)
  doc: "The most bytes one record may hold. A repo's file may lower it, never raise it.",
  where: "repo",
  reload: "restart",
});
```

```toml
[limits]
record = "64 KiB"   # 65536 bytes; "64KiB" reads the same. A bare 65536 is refused, and so is "64 KB"
```

A probe on `effect` 4.1.2 read `"64 KiB"` and `"64KiB"` as 65536 and `"1 GB"` as 1000000000, and
refused both `65536` and `"65536"` with "Expected a valid ByteSize string at ["record"]": the unit is
required. `KB`, `mb` and `b` are refused as unclear (`ByteSizeFromString` in `Schema.ts`). `kB`, `MB`
and `GB` are powers of 1,000, and `KiB`, `MiB` and `GiB` powers of 1,024. S5's words for it: "limits.record =
65536 is not a byte size. Write a number and a unit, such as \"64 KiB\" or \"1 GB\"."

### An open table in two places

`stage.programs` is `where: "both"`. The rule for `where` is S4's: a person's own picks stay out of
the repo's file. A program list is not only a person's pick. The 2026-10-05 note already gives a
repo its own programs (`.fabrika/programs/`, proposed) and its own packs, and
[packs are programs](./packs-are-programs.md). [0068](../../.decisions/0068-tiers-carry-every-part.md)
wants a program written outside fabrika's source to run early. So both files may set it.

```toml
# ~/.fabrika/fabrika.toml, the person's: line 6 as in the opening file
[stage]
programs = { writer-fixture = "./fixtures/writer.ts" }
```

```toml
# .fabrika/fabrika.toml, the repo's; the path is read from .fabrika/
[stage]
programs = { deploy = "./programs/deploy/main.ts" }
```

`deploy` and its path are made up; the folder is the 2026-10-05 note's `programs/deploy/`.

```text
A  merged by name: writer-fixture and deploy both load; on a name in both,     Helix, Cargo's arrays, our packs
   the repo's wins, as for every key
B  the most specific source replaces it whole: only deploy loads                Effect's orElse as it is
```

**Lean A, 70%.** A person expects to add, not to lose the rest. It is the rule packs already have:
a pack can sit in either file, and "When both name the same pack, the project's pin wins" (the
2026-10-05 note). A repo's programs keep that note's proposed guards: read from the default branch
only, and trusted by the person before the first run. The probe showed Effect's `orElse` does B, so
A costs a merge in the provider. The print says which source gave each name:

```text
stage.programs   deploy = ./programs/deploy/main.ts         .fabrika/fabrika.toml:3
                 writer-fixture = ./fixtures/writer.ts      ~/.fabrika/fabrika.toml:6
```

### A real case: who must look at a change, by risk

Teams split on review: a person on every agent pull request; people by risk, none, one or two;
review after the merge; no person at all. Read as the list of workflows fabrika supports, review is a
choice a repo sets. Not decided. Checked against the 2026-10-05 limits and principle 5:

```toml
# .fabrika/fabrika.toml, a sketch. Read from the default branch, joined across base and head.
[review]
governed = [".github/", "next/packages/libfabrika/src/door/"]   # decided key: the paths that are high risk
ui = ["next/apps/fabrika/src/"]                                 # decided key

[review.people]     # how many people approve, per risk: numbers
low = 0
normal = 1
high = 2
when = "before"     # "before" | "after": a pick, only once both ship paths exist and are tested
```

```text
fits as a setting                               why
how many people, per risk                       a number
which paths are high risk                       names; [review] governed already is one
before or after the merge                       a pick between two tested paths, once "after" is built
how risk is read: "paths" or "judge"            a pick, once a Judge classifier is built and measured

does not fit                                    why
the risk rule as logic (if X and size > N ...)  it decides what happens next: code, or a Judge
an agent's approval counting as a person's      a wall: no agent approves a pull request
a change that lowers its own risk               the file is read at the default branch, base and head joined
an agent setting any of it                      an agent cannot write .fabrika/ (principle 5)
```

- **Lean, 65%.** The counts, the path lists and the two picks are settings; the rule that turns a
  diff into a risk stays in code. A count of 0 is allowed, since "no person" is one of the real
  workflows, but it is never silent: a knob that switches a check off shows on the record, "skipped"
  and why (decided 2026-10-05). The wall is who counts, never how many.
- **The doubt.** Whether `high` may be 0. A refusal at load would make "no person" impossible for
  governed paths, which a team that runs that way would hit. The owner picks; this lean allows it and
  records it.
- **Today's version** has `[ship] approval` (`codeowners` or `none`) and `[review] governed` and
  `ui`; the counts and `when` are new.

## The designs

Four different answers to the same files. Each holds the same settings: `stage.port` and
`stage.programs` (Tier 1), one program's own (`notes.width`, made up), a person's (`theme`), a repo's
(`agents.build.model = "haiku"`), and one wrong value, `port = 70000`. No window is built in this
pass.

`agents.build.model` is today's version's key, and `"haiku"` is its own example
(`packages/pipeline/src/settings.ts:15`; the schema, a non-empty word, at `:145`). Today's version
takes it from the repo's file, then the machine's `tsh.toml`, then the default `"opus"`
(`packages/pipeline/src/setup.ts:136`, `:61`), and `tsh.toml` folds into the person's file (decided
2026-10-30). So in `next/` it is `where: "both"`, `reload: "restart"`, and the repo's wins, as S4's
order says.

Each design gives the same five things: the person's file, the repo's file, the error for
`port = 70000`, the print, and how a test and an agent set a value. A gap a design cannot fill is
named under what it loses.

### D1: flat dotted keys, the Ghostty way

```toml
# ~/.fabrika/fabrika.toml
theme = "fabrika"
stage.port = 70000
stage.programs.writer-fixture = "./fixtures/writer.ts"
program.notes.width = 72
```

```toml
# .fabrika/fabrika.toml
agents.build.model = "haiku"
```

```text
~/.fabrika/fabrika.toml, line 3: stage.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The stage did not start.

$ fabrika settings
agents.build.model  haiku                                  .fabrika/fabrika.toml:2
stage.programs      writer-fixture = ./fixtures/writer.ts  ~/.fabrika/fabrika.toml:4
```

- The print uses the same flat paths, so a line you see is a line you paste. A test uses
  `fromUnknown`, the way a person does (0069). An agent uses flags or its own home's file; it cannot
  write `.fabrika/` (principle 5).
- **Owns it:** the start code reads, the hands watch, `fabrika settings` prints.
- **Lost:** sections a person scans; long files read as one wall. Still TOML, so nothing decided moves.

### D2: TOML tables per area and per program, with a schema

```toml
#:schema ./fabrika.schema.json
theme = "fabrika"

[stage]
port = 70000
programs = { writer-fixture = "./fixtures/writer.ts" }

[program.notes]
width = 72
```

```toml
# .fabrika/fabrika.toml
[agents.build]
model = "haiku"
```

```text
~/.fabrika/fabrika.toml, line 5: stage.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The stage did not start.

$ fabrika settings
agents.build.model  haiku                                  .fabrika/fabrika.toml:3
stage.programs      writer-fixture = ./fixtures/writer.ts  ~/.fabrika/fabrika.toml:6
```

- The first file is the person's, and S5's messages name its lines. The editor underlines `70000`
  before a save. The repo's file may set `[stage] programs`, but its `where` refuses `stage.port`
  there, with S5's third message. A test and an agent set a value as in D1.
- **Owns it:** the same as D1, plus the generated schema.
- **Lost:** a key's full path is split across a header and a line, so `fabrika settings` prints the
  dotted path for search.

### D3: one typed TypeScript file, the WezTerm and Neovim way

```ts
// ~/.fabrika/fabrika.ts
export default Settings.define({
  theme: "fabrika",
  stage: { port: 70000, programs: { "writer-fixture": "./fixtures/writer.ts" } },
  program: { notes: { width: 72 } },
});
```

```ts
// .fabrika/fabrika.ts
export default Settings.define({ agents: { build: { model: "haiku" } } });
```

```text
~/.fabrika/fabrika.ts: stage.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The stage did not start.

$ fabrika settings
agents.build.model  haiku                                  .fabrika/fabrika.ts
stage.programs      writer-fixture = ./fixtures/writer.ts  ~/.fabrika/fabrika.ts
```

- The type checker catches `70000` in the editor. At start fabrika must run the file, then decode
  what it returned with the same declarations. So the message and the print name the file but no
  line: a value the code computed has no line. A test still uses `fromUnknown`, so it never runs the
  person's file. An agent uses flags only: its start would otherwise run code it did not write.
- **It walks back three decided points:** TOML, one spelling, and "a config that decides what
  happens next is a worse programming language", since a file of code can branch.
- **Owns it:** the start code runs the file and decodes it; the type checker; `fabrika settings`.
- **Lost:** an empty file being plain; anything but TypeScript reading it; a browser tab reading it;
  the line in every message and in the print (S5 and S4 lose their line); an agent's own home file.

### D4: settings as ledger facts, edited through a program, the file a view

```text
the settings program   a tile with every declared setting, search, its source, its words
the hands              read ~/.fabrika/fabrika.toml, post each change to the person's object
the ledger             one fact per change: key, value, by, arrivedAt, sentAt, how ("file" | "program")
the file               written back by the hands as a view; still the one a person edits
```

- **The file's spelling is D2's tables.** The file must stay TOML (decided), and the hands write it
  back, so it takes the lean's spelling and its schema. D1's flat keys would also work. The repo's
  file stays a file at the default branch (decided), the same as D2's, so only the person's settings
  move.
- **The error.** A bad file gives D2's message, line 5. A bad value typed in the program is refused
  in its field before anything is posted: "stage.port: 70000 is not a port. A port is a whole number
  from 1 to 65535. Not saved."
- **The print** is D2's, plus the last change the ledger holds for each key: who, when, and `how`.
- **A test** sets a value with `fromUnknown`, as in every design. A test of the program path sends the
  settings program's Msg and reads the fact back from the ledger.
- **An agent** uses flags or its own home's file, as in D1. It never posts to the person's object: a
  person's settings are the person's, as `.fabrika/` is (principle 5). That reading of principle 5 is
  a lean, 70%.
- **Owns it:** the `settings` program, the hands, the person's object.
- **Lost:** simplicity: two writers, the file and the program, race, as the keys note found. It needs
  the window and the program, which are Tier 2.
- It is the path the keys note leans for a browser tab (its "a browser tab has no files"). Every
  change keeps who and when, which a file alone cannot.

**Lean: D2, 75%, with D4's record but not its source.** D2 is the plain way the makers agree on and
keeps every decided point. From D4 it takes the record: each new hash the hands see is a fact, so
"who changed it, when" is kept without the ledger owning the value. D1 is a fine second; D3 walks
back decided points.

## What the ledger records

- **A settings entry at each process start,** with the values in force, where each came from and
  their hash (above). Records name the hash beside `build`.
- **Each new hash of the person's file the hands see,** with `by`, the referee's `arrivedAt` and the
  writer's `sentAt`. The keys note already records `how` for its own file.
- **Lost if not recorded now:** which settings a past record ran under. A record written with a
  64 KiB cap means something else than one with 1 GB, and nothing can tell them apart later. This is
  "a run copies its settings when it is filed", carried into `next/`.
- **Nothing secret:** the file holds no secret, and paths are written from `~` or the repo root.

## A tryout in today's version

Not filed. One small fix the owner may pick:

- Generate a JSON Schema from today's `File` schema (`packages/pipeline/src/settings.ts`) with
  `SchemaRepresentation.toJsonSchemaDocument`, commit it beside `.fabrika/fabrika.toml`, name it with
  `#:schema`, and add a test that fails when it is stale. An editor then completes and checks keys.

**Size:** about 60 to 100 lines with the test, about 1 agent hour. An estimate from reading the code.

## Where this differs from settled notes

- **0069's sketch** reads `programs` with `Config.schema` alone. Here a declaration wraps the
  `Config`, since a `Config` cannot refuse a key nobody asked for (experiment 251's probe).
- **[One fabrika.toml per repo](./one-fabrika-toml-per-repo.md):** "the pack checks them". Here the
  core runs the schema the pack declares, at load. The pack still owns the check's rules.
- **The glossary's control state row:** "a setting, which never changes". A `live` setting changes,
  as input; the row would say "never changes inside a process unless it arrives as input".
- **The glossary's `Policy` row** says it is "Not a program setting a person changes". 0069 says a
  number is a setting. This note keeps `Policy` out, as OTP does, at 60%.
- **`next/`'s `~/.fabrika/stage.json`** mixes saved flags with founding facts. The 2026-10-30 note
  says "State is not settings". P38 would split it: settings into the person's file, founding facts
  onto the ledger.

## What it costs

- One room in libfabrika: `Setting.make`, `group`, the strict load, the providers, the merge of an
  open table by name, the `where` check, the print and the schema output. About 300 to 500 lines with
  tests, a guess from reading the code; P38 sizes it. This is the one number for the room; S2 points
  here.
- `dev.ts` moves its flags onto the declarations, and `build`, `localStage` and the Worker take one
  `Settings` value.
- A TOML parser in `next/` that keeps line numbers, or a key search, for S5's line.
- One settings entry per process start.

## What it cannot tell us

- No design was built or shot, and nobody used one. The lean for D2 is reading.
- Whether a strict load hurts two people on two versions.
- Whether merging open tables by name surprises anyone.
- Linear's answers are opinion from one docs page.
- No screen reader heard an error or a settings program.
