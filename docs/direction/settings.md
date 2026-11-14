---
state: "decided 2026-11-10 ([0086](../../.decisions/0086-settings-are-declared-once.md))"
summary: "Both versions, built in `next/` first by Tier 1's P38. How a person, a repo, a test and an agent set a choice. Seven principles: a choice is a setting, and a short list never is (0069); each is declared once with `Setting.make`, an Effect `Config` plus its words, a required `scope` (the files that may set it) and how it reloads, and the file reader, env name, flag, print, two editor schemas and error come from it; an empty file works; one order per key, flag then env then the repo's file then the person's then the default, and `fabrika settings` says where each value came from; a wrong value stops in words at the file, line and key, read through a `Toml` service on `toml-eslint-parser`; read at the edge, handed in through a `ConfigProvider`, and recorded with its hash beside `build`; what you can set comes from fabrika itself. Settings are per pack in `[pack.<name>.settings]`; the repo's `fabrika-version` names the oldest fabrika it works with. The design: TOML tables per area and per pack with a `#:schema` line, each change the hands see a ledger fact. A table of Tier 1's choices for P38's plan. From experiment 251."
---

# Settings

**Decided 2026-11-10.** The owner approved the seven principles, the shape and the smaller calls below
with their leans, after a walk of each part. The leans' confidence numbers stay as written.

This note says how a person, a repo, a test and an agent set a choice in fabrika. It builds on
[0069](../../.decisions/0069-choices-are-settings.md): a choice that makes sense as a `fabrika.toml`
value is one, declared once with its schema and default. Tier 1's P38 (tracker ticket 664) builds
the first of it in `next/`. The decision record is
[0086](../../.decisions/0086-settings-are-declared-once.md).

Built from [experiment 251](../../experiments/251-settings.md), which read how about twenty makers and
tools let people set a choice, checked `next/`'s local instance against them, and ran one editor
probe. The reading is not a measurement. A tag such as [c5] points at that experiment's links.

## Words used here

- **Instance.** One running copy of fabrika: one brain and its ledger, which clients dial. "The local
  instance" runs on a laptop, "the cloud instance" on Cloudflare
  ([0080](../../.decisions/0080-a-running-copy-is-an-instance.md)). Tracker ticket 681 renamed
  the code to match (`localInstance`, `InstanceError`, `INSTANCE`, `instance.json`).
- **The hands.** What runs on a person's computer and acts there: it reads files, starts processes
  and watches folders ([brain, hands, window, agent](./brain-hands-window-agent.md)).
- **Pack.** One or more programs in a package, and the only place a program lives. It is listed by
  one `[pack.<name>]` table in a `fabrika.toml`, and it declares one settings schema that all its
  programs read ([0083](../../.decisions/0083-every-program-in-a-pack.md)).
- **The core pack.** The pack that ships with fabrika, named `fabrika` in every key: `fabrika/tracker`,
  `[pack.fabrika.settings]`. Every other pack sits beside it.
- **Flow.** Steps written down as data, which fabrika checks and runs as one recorded process
  ([0074](../../.decisions/0074-agent-hands-over-a-flow.md)). The order of a run's steps lives in a
  flow, never in a settings file.
- **Scope.** The files that may set a setting: the person's file, the repo's file, or both. Every
  setting declares it.

## The idea in one example

The running example is the job a test does today and a person cannot: load one more program into a
local instance. Under 0083, a program lives in a pack, so the test lists a small local pack.

```ts
// A sketch, next/. `Setting` is P38's room; its name and path are sketch names.
import { Effect, Schema } from "effect";
import * as Setting from "@kampus/libfabrika/settings";

// One declaration per setting: its path, schema, default, words, scope and reload.
export const port = Setting.make("instance.port", {
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  default: 18787,
  doc: "The port the local instance listens on.",
  scope: ["person"], // only the person's file; the environment and a flag may set any key
  reload: "restart",
});

// A Setting is an Effect Config, so code reads it with yield*.
const start = Effect.gen(function* () {
  const at = yield* port; // 18787 from an empty file
  const packs = yield* Setting.packs; // the [pack.<name>] tables of both files
  // ... resolve each pack to its code, then build({ out, packs }) and start the instance on `at`
});
```

```toml
# ~/.fabrika/fabrika.toml, the person's file. Empty, it changes nothing.
#:schema ./person.json
theme = "fabrika"

[pack.fixtures]
from = "./fixtures"   # a pack on disk, read from this file's folder; no ref, no lock line
```

```toml
# ~/.fabrika/fixtures/pack.toml, the pack's own file
name = "fixtures"
programs = ["writer.ts"]
```

```text
one start traced: dev.ts with the person's file above and no repo file
read     fabrika-version in .fabrika/fabrika.toml     no repo file, so nothing to check
read     ~/.fabrika/fabrika.toml                      Toml.parse, with each key's line
decode   strictly, against the person's schema        every key is known; pack.fixtures at line 5
read     .fabrika/fabrika.toml                        the repo's file, at its default branch: none
env      FABRIKA_INSTANCE_PORT                        not set
flags    none
merge    per key: flag, then env, then the repo's file, then the person's, then the default
load     pack fixtures from ~/.fabrika/fixtures       pack.toml lists writer.ts; program fixtures/writer
print    instance.port    18787                       default
         pack.fixtures    ./fixtures                  ~/.fabrika/fabrika.toml:5
hand     build({ packs }), the instance({ port }); no machine reads a file
record   the instance's start entry holds the values in force and their hash, beside `build`
```

The real fixture is in `next/apps/fabrika/src/instance-records.test.ts`. Today it writes three one-file
programs into a temp home (`:145`, `:158`) and hands them to `build` by name and path (`:176`).
Under 0083 that test changes in two ways. It writes a `pack.toml` beside the three files, listing
them. It lists the pack in its test home's `fabrika.toml`, or through `ConfigProvider.fromUnknown`
with the same shape, and its programs are named `fixtures/writer`, `fixtures/timer` and
`fixtures/sealed`, not `writer-fixture`. The `fixtures` pack name is made up; the three programs are
real.

## Which version

- **`next/`:** all of it. P38 builds the room, the providers, the `Toml` service and Tier 1's
  settings. This note gives its plan the shape and a table of Tier 1's choices
  ([below](#tier-1s-choices-for-p38s-plan)).
- **Today's version (`packages/pipeline`, `apps/fabrika`):** it already reads both files, refuses
  unknown keys and prints where each pick came from. One small tryout is offered
  ([below](#a-tryout-in-todays-version)); nothing else changes.

## The shape

```ts
// A sketch, next/. What one declaration holds. Effect names checked against effect 4.1.2's d.ts.
import type { Config, Schema } from "effect";

type File = "person" | "repo";
type Reload = "live" | "restart";

interface Setting<A, const S extends ReadonlyArray<File>> extends Config.Config<A> {
  readonly path: string; // "instance.port": the TOML path, FABRIKA_INSTANCE_PORT, --instance.port
  readonly schema: Schema.Codec<A>;
  readonly default: A; // exactly one, here (0069)
  readonly doc: string; // required: the words every output shows
  readonly scope: S; // required, never empty: ["person"], ["repo"] or ["person", "repo"]
  readonly reload: Reload;
}
```

- **A Setting is a `Config`.** `Setting.make` builds `Config.schema(schema, path)` with
  `Config.withDefault(default)` and adds `doc`, `scope` and `reload`. `Config` extends `Effect` in
  4.1.2, so code reads a setting with `yield*`, and `Config.parse(provider)` reads it from a given
  provider.
- **Why more than a `Config`.** A `Config` cannot see a key nobody asked for: experiment 251's probe
  gave the default port and no word for `prot = 1`. The strict load, the print, the docs and the
  editor schema all need the list of declared paths, which a `Config` alone does not expose.
- **The scope is in the type.** `Setting.fileSchema(all, "repo")` (sketch name) keeps the settings
  whose scope holds `"repo"` and builds one `Schema.Struct` from them, each key under
  `Schema.optionalKey`. The same two Structs, person and repo, decode the two files strictly and
  produce the two JSON Schemas. So a repo's file that sets `instance.port` fails its own Struct, and
  its editor never offers the key.
- **`Setting.group`** (sketch name) joins the settings of one area or one pack into one `Config`
  with `Config.all` under `Config.nested`.

```ts
// A sketch, next/. The sources, most specific first, as ConfigProviders.
import { ConfigProvider, Effect } from "effect";

const sources = (flags: ConfigProvider.ConfigProvider, repo: ConfigProvider.ConfigProvider, person: ConfigProvider.ConfigProvider) =>
  flags.pipe(
    ConfigProvider.orElse(ConfigProvider.fromEnv().pipe(ConfigProvider.nested("fabrika"), ConfigProvider.constantCase)),
    ConfigProvider.orElse(repo),
    ConfigProvider.orElse(person),
  );

// The start code hands the chain in once; a test swaps it for its own.
start.pipe(Effect.provide(ConfigProvider.layer(sources(flags, repo, person))));
start.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ instance: { port: 18800 } }))));
```

A probe on 4.1.2 for this note read `FABRIKA_INSTANCE_PORT=18800` through
`fromEnv().pipe(nested("fabrika"), constantCase)` at `instance.port`, and fell back to a
`fromUnknown` file under `orElse`. The other order of `nested` and `constantCase` read nothing.

## The seven principles

### S1: a choice is a setting, and a few things never are

**Decided 2026-11-10 (0069), for "is a setting". Confidence 75% for the list of what never is.**

- **The rule.** A number, a name or a pick between tested paths that two people or two repos could
  want differently is a setting. A plan asks of each new choice "is this a setting?", and a no costs
  one line of why (0069). These never are, whatever their type:

```text
never a setting            because                                     example
the step order             it decides what happens next: a flow does   0074, the 2026-10-05 note
a wall                     a check, an approval, a person-only answer  the React Compiler's exceptions
a secret                   Config.Redacted, from the env or a locker   secrets are redacted
an identity or a founding  a fact, written once on the ledger          dev.ts --founder, --window
state                      it changes as things run                    ~/.fabrika/instance.json
process plumbing           one process telling another                 dev.ts --child, --parent
the home itself            the files live there                        FABRIKA_HOME
a security limit           changing it weakens recovery                P36's 10 minutes and 5 tries
a constant nobody varies   no person would choose differently          a 50 ms settle in a watcher
```

- **In a file and in code.** A floor on approvals is a number, so it is a setting; the order of the
  steps that ask for those approvals is a flow.

```toml
# .fabrika/fabrika.toml
[review]
human-approvals = 2
```

```ts
export const humanApprovals = Setting.make("review.human-approvals", {
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  default: 1,
  doc: "How many people must approve a change; an agent's review does not count. 0 means no floor.",
  scope: ["repo"],
  reload: "restart",
});
```

- **Why.** Twelve-factor's "strict separation of config from code" [c13], and the tmux and Neovim
  quality 0069 names: simple with an empty file, and as far as a person wants in one plain file. OTP
  keeps an application's `env` as settings and a supervisor's restart intensity in code [c17], so
  Tier 1's restart `Policy` stays a program fact (60%).
- **How it is held.** The plan's question, read at review. The parts code can check are in S2 and in
  [the check](#whether-a-check-enforces-a-choice-is-a-setting).
- **The doubt.** "Makes sense as a value" is judgment. P38's plan and the next few plans will show
  whether the list covers what comes up.
- **Today.** Breaks: `programs` (`next/apps/fabrika/src/build.ts:16`) and the record cap
  (`instance-records.test.ts:193`) are choices only a test reaches.

### S2: declared once, and everything else comes from the declaration

**Decided 2026-11-10. Confidence 85%. The one default is 0069's.**

- **The rule.** Path, schema, default, words, scope and reload live in one `Setting.make`. The file
  reader, the environment name, the flag, the print, the docs, the two editor schemas and the error
  all come from it. No second schema, no default in a caller, no hand-typed copy of the shape.
- **In a file and in code.** The declaration in [the idea](#the-idea-in-one-example) is the whole
  of it. From it come `[instance] port` in the person's file, `FABRIKA_INSTANCE_PORT`,
  `--instance.port`, the print's `instance.port` line, and the `port` entry in `person.json`.
- **Why.** Ghostty's docs are "all generated from the same source" [c5]. VS Code's extensions declare
  `default`, `markdownDescription` and `scope` in one place [c9]. Effect: describe what you need with
  `Config`, and the provider reads it [c15].
- **How it is held.** A type that requires `doc`, `default` and a non-empty `scope`; a test that each
  committed editor schema equals the generated one; a test per setting that the file, the
  environment, a flag and `fromUnknown` all reach it.
- **The doubt.** Whether `Setting.make` stays ours or becomes a small patch to Effect's `Config`. P38
  reads Effect's issues first ([0054](../../.decisions/0054-read-upstream-before-patching-it.md)).
- **Today.** Breaks: the record cap has three shapes and its default sits apart
  (`next/apps/fabrika/src/settings.ts:10`, `next/packages/libfabrika/src/cloudflare/record.ts:79`,
  `:29`); the port's default is in `next/apps/fabrika/dev.ts:71`; `BrainOptions` types it all again
  (`next/packages/libfabrika/src/cloudflare/runtime.ts:78`).

### S3: an empty file works

**Decided 2026-10-05, "an empty file changes nothing". Decided 2026-11-10, confidence 85%, that
nothing is required to start.**

- **The rule.** Every setting has a default, so no file, no flag and no environment variable is
  needed to start. A value with no sane default is not a setting: it is a founding fact, asked once
  on the founding screen and written on the ledger.
- **In a file and in code.** An empty `~/.fabrika/fabrika.toml`, or none, decodes to every default:

```ts
const empty = ConfigProvider.fromUnknown({});
yield* port.parse(empty); // 18787
```

- **Why.** tmux reads its file "if present" [c1]; Ghostty is "designed to work out of the box with no
  configuration" [c5]; Elm's `init` takes flags through a decoder [c20], and a decoder with defaults
  takes an empty object.
- **How it is held.** A property that the empty file decodes to every declared default.
- **The doubt.** A default that works once may not work twice. Two instances on one laptop both take
  port 18787, so the second cannot start. P38's plan says whether the second stops with words naming
  `instance.port`, or the default means "a free port" and the print shows the one it took.
- **Today.** Half: there is no file, and with no flags the instance cannot start, since `name`,
  `person` and `founder` have no default (`next/apps/fabrika/src/settings.ts:4`). Those are founding
  facts; only `name` is a setting, `[ledger] name` in
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md).

### S4: one order per key, and every value says where it came from

**Decided 2026-11-10. Confidence 75%.**

- **The rule.** For each key: a flag, then the environment, then the repo's file, then the person's
  file, then the default. A setting's `scope` says which files may set it; a file that sets a key
  outside its scope stops the start (S5) and is never skipped quietly. `fabrika settings` prints each
  key, its value and where it came from, with the file and line.
- **In a file and in code.** Both files may list packs. On the same pack name the repo's table wins,
  as the repo's pin always has (2026-10-31):

```toml
# ~/.fabrika/fabrika.toml
[pack.fixtures]
from = "./fixtures"
```

```toml
# .fabrika/fabrika.toml, the repo's
[pack.deploy-kit]
from = "github:acme/tools"
ref = "v1.2.0"
```

```text
$ fabrika settings
pack.deploy-kit   github:acme/tools v1.2.0   .fabrika/fabrika.toml:2
pack.fixtures     ./fixtures                 ~/.fabrika/fabrika.toml:2
instance.port     18787                      default
```

- **Why.** Git: "last value found taking precedence", and `--show-origin` [c4]. Cargo: `--config` over
  environment over files, the home lowest [c10]. VS Code: workspace settings "override user
  settings", and `application` settings live only in user settings [c9], which is what `scope` does.
  OTP: `.app` env, then `sys.config`, then the command line [c17].
- **How it is held.** A property over random sources that the most specific one wins per key and
  that the printed source is the one that won; a property that the pack tables of two files join by
  name, with the repo's table on a name both list.
- **The doubt.** `orElse` falls back per path, so an open table such as `pack` comes whole from the
  first source that has it (experiment 251's probe). Joining the two files' pack tables by name, and
  knowing which file gave a value, may need each file to be its own small provider that tags its
  source, with the join done in the room.
- **Today.** Breaks: a flag beats `~/.fabrika/instance.json` and then is written into it
  (`next/apps/fabrika/dev.ts:57`, `:76`), so a later start cannot tell a flag from a saved value,
  and nothing prints a source. Today's version prints each pick and where it came from
  (`packages/pipeline/src/setup.ts:5`).

### S5: a wrong value stops, in words, at the key

**Decided 2026-10-05, for "an unknown key fails" and "a value out of range fails and names the key".
Decided 2026-11-10, confidence 80%, for the words and for what a running app does.**

- **The rule.** At start, a wrong value, an unknown key, or a key outside its file's scope stops the
  start with one message: the file, the line, the key, the value, what it should be, and what
  happened. While running, a bad save keeps the last good values and says why, as keys already do.
  The repo's `fabrika-version` is read before anything else
  ([below](#the-oldest-fabrika-a-repos-file-works-with)).
- **In a file and in code.** The person's file in [the design](#the-design), with `port = 70000` on line 5; the same line typed
  `prot = 18800`, and a repo's file of two lines that sets `instance.port`:

```text
~/.fabrika/fabrika.toml, line 5: instance.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The instance did not start.
~/.fabrika/fabrika.toml, line 5: there is no setting instance.prot. Did you mean instance.port?
  fabrika settings lists every setting. The instance did not start.
.fabrika/fabrika.toml, line 2: instance.port is a person's setting, so a repo's file may not set it.
  Set it in ~/.fabrika/fabrika.toml, as FABRIKA_INSTANCE_PORT, or with --instance.port. The instance did not start.
```

```ts
// A sketch, next/. The strict decode names the path; the Toml service gives its line.
const doc = yield* Toml.parse(text); // values, and each key's span
yield* Schema.decodeUnknownEffect(Setting.fileSchema(all, "person"))(doc.value, { onExcessProperty: "error" });
// a failure at ["instance", "port"] is looked up in doc.spans for its line
```

- **"Did you mean" names only a key that file may set.** A key that exists but that file may not set
  gets the third message, never a guess.
- **Why.** WCAG 3.3.1: the item "is identified and the error is described to the user in text" [c22].
  Helix refuses unknown keys and says "Bad config" [c6]; kubectl is strict [c12].
- **How it is held.** Example tests labeled `format:` for the three messages; a property that every
  out-of-range value fails and names its key; a property that every key set outside its scope stops
  the start and is never offered as a "Did you mean".
- **Today.** Half: the schema refuses a bad port, but `dev.ts` turns every failure into
  `InstanceError({ reason: "settings" })` (`next/apps/fabrika/dev.ts:75`), so the key and the value are
  lost. Today's keys reader already gives a line (`apps/fabrika/src/host/keybindings.ts:84`).

### S6: read at the edge, handed in, and recorded

**Decided 2026-10-05 and 2026-10-11, for "machines never read the file" and "each machine is handed
its values". Decided 2026-11-10, confidence 70%, for the record and for live settings.**

- **The rule.** The hands or the start code read the files and hand values in. A `restart` setting
  is fixed for a process's life. A `live` setting arrives as a new value, the way a theme or a key
  table does, and the process takes it as input. The instance's start entry records the values in
  force and their hash; a record names that hash beside its `build`.
- **In a file and in code.** A program reads its pack's settings through the provider it was handed,
  never through a file:

```ts
// A sketch, next/. fabrika scopes the provider to the pack at load, so another pack is not there.
const forPack = (name: string) => ConfigProvider.nested(["pack", name, "settings"]);
const settings = yield* Fixtures.settings.parse(provider.pipe(forPack("fixtures"))); // provider: the chain above
```

- **Why.** Elixir split `runtime.exs` from the build-time file [c18] and tells a library to take "a
  parameter passed to the function" [c19], which is "handed in". Ghostty: "Some configuration options
  cannot be reloaded at runtime" [c5]. Elm takes flags at `init`, and a later change is a `Sub`.
- **How it is held.** A restart test that a replayed process keeps the settings hash it started with;
  a type: no machine's Model holds a provider.
- **The doubt.** Whether the brain's Worker gets each value as its own binding or one value as today
  (`next/apps/fabrika/alchemy.run.ts:52`). P38's plan answers it.
- **Today.** Half: `dev.ts` reads once and hands values to the instance. But the Worker decodes
  `INSTANCE` again (`next/packages/libfabrika/src/cloudflare/record.ts:83`), and no record names its
  settings.

### S7: you find out what you can set from fabrika itself

**Decided 2026-11-10. Confidence 75%. The editor half was probed on 2026-11-10.**

- **The rule.** Three outputs come from the declarations, and nothing is written by hand:
  - `fabrika settings`: every key, its value, where it came from, its default and its words; `--all`
    adds the ones left at default. It warns when a key in use is newer than the repo's
    `fabrika-version`.
  - two JSON Schemas, `person.json` and `repo.json`, one per file, each named by a `#:schema` line,
    so an editor completes, explains and checks keys.
  - the reference page.

  A settings program in a tile, with search, is Tier 2's, when the window has programs.
- **In a file and in code.**

```toml
#:schema ./person.json
[instance]
port = 70000   # the editor underlines it before a save: maximum 65535
```

```ts
// What the probe ran, effect 4.1.2, from the top-level Schema module.
const document = Schema.toJsonSchemaDocument(Setting.fileSchema(all, "person"), { onExcessProperty: "error" });
// document.schema is the root; the file adds "$schema" and the definitions itself
```

- **What the probe found** (NVIM 0.11.3, Taplo 0.10.0, Tombi 1.11.2, effect 4.1.2): completion, hover
  and diagnostics all worked from a generated schema in both language servers, and one
  `#:schema ./person.json` line served both. The build must handle four things. Every key comes out
  required unless the struct uses `Schema.optionalKey`. `Schema.withDecodingDefaultKey` drops the
  description and the default from the output, so the default goes on the Setting, not in the
  schema. No `$schema` key comes out, so the file writer adds it. Tombi's hover also shows the
  default and the range; Taplo's shows only the description.
- **Why.** `ghostty +show-config --default --docs` [c5]; `git config --list --show-origin` [c4];
  Taplo's `#:schema` [c11].
- **How it is held.** A test that each committed schema and the printed list match the declarations.
- **The doubt.** Nobody has checked that a person reaches for `fabrika settings` at all. The first
  person using Tier 1 would settle it.
- **Accessibility.** The print is plain text, so a screen reader reads it as lines. The settings
  program will need a real VoiceOver run, and every field's error in text (WCAG 3.3.1).
- **Today.** Breaks in `next/`: nothing lists what can be set. Today's version prints the picks of a
  run, which is the nearest thing.

## Tier 1's choices, for P38's plan

Every choice Tier 1 builds or changes in `next/`, marked setting or not. This is input for P38's plan,
not a question for the owner (0069). Paths are under `next/apps/fabrika/` unless they say otherwise.

| Choice | Today | Setting? | Because |
|---|---|---|---|
| more packs for a local instance | `src/build.ts:16`, test only | yes, `[pack.<name>]` with `from`, and `ref` for a remote; `["person", "repo"]`, restart; joined by name, the repo's wins | the running example; 0069's first; 0083 puts every program in a pack |
| the instance's port | `dev.ts:15`, default `dev.ts:71` | yes, `instance.port`, `["person"]`, restart | a number two people pick differently |
| the project's name | `dev.ts:16`, `src/settings.ts:4` | yes, `ledger.name`, `["repo"]`, restart | decided as `[ledger] name` |
| the oldest fabrika a repo works with | none | yes, `fabrika-version`, `["repo"]`, read first | [below](#the-oldest-fabrika-a-repos-file-works-with) |
| the person | `dev.ts:17`, `src/settings.ts:5` | no, a founding fact | who founded it; on the ledger once |
| the founder's key | `dev.ts:18` | no, an identity | a public key; its file's path may be a setting later |
| the window's key | `dev.ts:19` | no, an identity | the window makes its own (P3) |
| the record cap | `src/settings.ts:10`, `cloudflare/record.ts:29` | yes, `limits.record`, `["repo"]`, restart, a byte size such as `"1 GB"`, may only lower | a limit ([tea program](./tea-program.md)) |
| chaos in a build | `src/build.ts:17` | yes, `instance.chaos`, `["person"]`, restart; the cloud instance refuses `true` | a pick between two tested builds (P24, P27) |
| the `.tsx` files the Compiler checks | `src/build.ts:13` | no, a wall | every file, always ([React Compiler](./react-compiler.md)) |
| the Compiler's exceptions | `src/build.ts:14` | no, a wall | owner-approved rows |
| `--child`, `--parent` | `dev.ts:13` | no, plumbing | one process to its own child |
| the home folder | `dev.ts:56` | no; stays `FABRIKA_HOME` | the files live there (2026-10-30) |
| no telemetry | `dev.ts:36` | no, a wall | fabrika sends nothing out on its own |
| restart policy | P34, the glossary's `Policy` | no, a program fact, 60% | OTP keeps intensity in the supervisor's code |
| the person's keys | P20, `keybindings.toml` | yes, its own file | decided (K4) |
| hot reload | P15 | no | decided behavior; nobody turns it off |
| email code, 10 minutes, 5 tries | P36 | no, a security limit | it weakens recovery |
| `fabrika mcp --as <agent>` | P25 | no, a flag for one call | names who calls, not a choice that lasts |
| Approve once per agent name | P25 | no, a person-only wall | principle 5 |
| the cloud instance's account | P24 | no, Alchemy's environment | not ours; a credential sits beside it |

## Smaller calls

### The order when sources disagree

```text
A  flag > env > repo file > person file > default        Git, Cargo, VS Code, Helix, Zed
B  flag > env > person file > repo file > default        the person's own file wins
C  A, plus .fabrika/fabrika.local.toml, ignored by git    Git's local config
```

**Decided 2026-11-10: A. Confidence 75%.** Every maker read puts the project over the person, and
`scope` keeps a person's own picks (theme, port) out of the repo's file, as VS Code's `application`
scope does. A person who wants another value for one repo uses a flag or the environment. B lets one
person's file change a shared pick silently. C adds a second spelling, which the 2026-10-05 note
refused.

### An unknown key fails

**Decided 2026-10-05: an unknown key fails at start; while running, the last good values stay and
fabrika says why. Kept on 2026-11-10, confidence 70%.** Helix and kubectl do the same; WezTerm and
the Kubernetes server only warn [c6, c7, c12]. The risk is Kubernetes' own: a file shared by people
on two fabrika versions, where a key the newer one added fails the older one. `fabrika-version`
answers it: the older fabrika stops on the version line first, with words that say to update, and
never reaches the unknown key.

### The oldest fabrika a repo's file works with

```toml
# .fabrika/fabrika.toml
fabrika-version = "0.4.0"
```

```text
This repo needs fabrika 0.4.0 or newer. You have 0.3.2.
```

**Decided 2026-11-10. Confidence 80%.**

- **The rule.** The repo's file may say the oldest fabrika it works with. fabrika reads that key
  before anything else, so an older fabrika says the line above and never an unknown-key error. The
  key exists from the first version, because an old fabrika that does not know it would fail on it
  too. `fabrika settings` warns when a key in use is newer than the stated version, so the line stays
  true.
- **No format number.** There is no `configVersion`. Compose made its top-level `version`
  "obsolete" and validates against the newest schema
  ([Compose, version and name](https://docs.docker.com/reference/compose-file/version-and-name/)).
- **The known way.** Cargo's `rust-version` "tells cargo what version of the Rust toolchain you
  support for your package"
  ([rust-version](https://doc.rust-lang.org/cargo/reference/rust-version.html)). Terraform's
  `required_version` "specifies which version of the Terraform CLI is allowed to run the
  configuration" ([terraform block](https://developer.hashicorp.com/terraform/language/block/terraform)).
  npm's `engines`: "You can specify the version of node that your stuff works on"
  ([package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#engines)).
- **Its shape.** `scope: ["repo"]`, a plain version with no range, as Cargo's is. A person's own file
  has none: it is read only by the fabrika the person runs.

### Reload while running

```ts
reload: "live"; // a new value reaches the process as input; theme, keys, a pack's own pick
reload: "restart"; // fixed for the process's life; the print says "instance.port: next start"
```

**Decided 2026-11-10. Confidence 75%.** The [hot reload](./hot-reload.md) note is about code; this is
a value change, as keys and themes already are. A save reaches a `live` setting at the next step,
through the folder watch today's version uses (`apps/fabrika/src/host/settings.ts:30`).

### Packs and their settings

```toml
# .fabrika/fabrika.toml
[pack.fabrika.settings]       # the core pack's settings
[pack.deploy-kit]
from = "github:acme/tools"    # a remote pack needs a ref, pinned in .fabrika/fabrika.lock
ref = "v1.2.0"
[pack.deploy-kit.settings]
region = "eu"
[pack.release]
from = "./packs/release"      # the repo's own pack, read from this file's folder: no ref, no lock line
```

```ts
// A sketch, next/. A pack declares its settings once, as one group. Schema is effect 4.1.2's.
export const settings = Setting.group({
  region: Setting.make("region", {
    schema: Schema.Literals(["eu", "us"]),
    default: "us",
    doc: "Where deploys go.",
    scope: ["repo"],
    reload: "restart",
  }),
});

// Each [pack.<name>] table is one of two shapes, so a local pack with a ref cannot be written.
const Local = Schema.Struct({ from: Schema.String.check(Schema.isPattern(/^\./)) }); // 0084's shapes
const Remote = Schema.Struct({ from: Schema.String.check(Schema.isPattern(/^[^.]/)), ref: Schema.String });
const Entry = Schema.Union([Local, Remote]); // plus settings, decoded at load with the pack's own group
```

**Decided 2026-11-10 ([0083](../../.decisions/0083-every-program-in-a-pack.md), [0084](../../.decisions/0084-own-pack-listed-by-path.md), [0085](../../.decisions/0085-pack-cache-under-cache-folder.md)). Confidence 75% for what is new here.**

- Settings are per pack, in `[pack.<name>.settings]`, declared by the pack as one `Setting.group`. A
  program reads its pack's settings through a provider scoped to its pack (S6), and sees no other
  pack's.
- The core pack is `fabrika`, so its settings sit in `[pack.fabrika.settings]`.
- A repo's own pack is listed with `from = "./path"`, read from that file's folder, with no `ref` and
  no lock line. A pack nobody lists does not load.
- The home cache of pack code is `~/.fabrika/cache/packs/`, keyed by commit. It holds code only;
  the list of packs is always a file.
- Both files may list packs, joined by name; on the same name the repo's table wins (S4).
- At load, the core decodes a pack's `settings` table with the group the pack declares, so a wrong
  `region` gets S5's words at its line.
- `deploy-kit`, `release` and `region` are made up.

### Reading and writing TOML

```ts
// A sketch, next/. One service; its first Layer is on toml-eslint-parser 1.0.3.
export class Toml extends Context.Service<
  Toml,
  {
    parse(text: string): Effect.Effect<TomlDocument, TomlError>; // values, and each key's span
    set(text: string, path: ReadonlyArray<string>, value: unknown): Effect.Effect<string, TomlError>;
    remove(text: string, path: ReadonlyArray<string>): Effect.Effect<string, TomlError>;
  }
>()("@kampus/libfabrika/settings/Toml") {}
```

**Decided 2026-11-10. Confidence 75%.**

- TOML is read behind a `Toml` Effect service: parse with positions, set and remove. Its first Layer
  is on [`toml-eslint-parser`](https://www.npmjs.com/package/toml-eslint-parser) 1.0.3, which gives
  values and each key's line, and it replaces smol-toml in `next/`. A write is a text splice at the
  value's span, so comments and spacing around it stay.
- Looked at, per [0040](../../.decisions/0040-existing-tools-before-hand-written.md), on npm on
  2026-11-10:
  - [`@decimalturn/toml-patch`](https://www.npmjs.com/package/@decimalturn/toml-patch) 3.3.2: keeps
    comments on a patch, but its README offers no key positions, which S5's line needs.
  - [`@toml-tools/parser`](https://www.npmjs.com/package/@toml-tools/parser) 1.0.1: a Chevrotain
    syntax tree, with values left to walk out by hand; its last release is from 2023.
  - [`@taplo/lib`](https://www.npmjs.com/package/@taplo/lib) 0.5.0: Taplo as WASM, about 35 MB
    unpacked, last released 2024-02.
  - [`@rainbowatcher/toml-edit-js`](https://www.npmjs.com/package/@rainbowatcher/toml-edit-js)
    0.6.5: Rust's `toml_edit` as WASM. It edits and keeps format, and was set aside for now: a WASM
    module in every client, a browser tab included, for what a splice does. The service is what lets
    it swap in later.
- The cost: a splice writes one value at a time, and a new table is appended as text. If no parser
  had fit, the fallback was a small package of our own, published apart.

### Who must approve a change

**Decided by [0079](../../.decisions/0079-size-counts-governed-paths-name-who.md) (a trial) and
[0082](../../.decisions/0082-approvals-is-a-floor-for-every-run.md). This note only shows the file.**

```toml
# .fabrika/fabrika.toml, read at the change's base and at its head, joined
[review]
human-approvals = 1                                            # the floor; 0 means no floor
governed = [".github/", "next/packages/libfabrika/src/gateway/"]  # an owner of these rules is among them
```

- `review.human-approvals` is the floor for every run. A flow may ask for more review steps, never fewer;
  one under the floor is refused before its first step runs (0082).
- A change's size moves the count up from the floor, and its governed paths set who must be among
  the people, read from fabrika's own settings, never from the code host (0079, a trial until its
  false alarms are measured).
- Never a setting: the rule that turns a diff into a count, an agent's look counting as a person's,
  and anything a change or a flow could use to lower its own floor. An agent cannot write
  `.fabrika/` (principle 5).
- Today's version has `[ship] approval` (`codeowners` or `none`) and `[review] governed` and `ui`;
  `human-approvals` is new.

### Docs from the declaration

**Decided 2026-11-10. Confidence 75%.** `doc` is required by the type. `fabrika settings`, the two
JSON Schemas (`Schema.toJsonSchemaDocument`) and the reference page are generated, and a test fails
when a committed schema is out of date.

### What a run records about its settings

```ts
// A sketch, next/. One entry at each process start, in the ledger's own fields.
{ _tag: "settings", hash: "sha256-…", values: { "instance.port": 18787, "limits.record": "1000000000" },
  from: { "pack.fixtures": "~/.fabrika/fabrika.toml" } }
```

**Decided 2026-11-10. Confidence 70%.** Records name the hash beside `build`. Paths are written from
`~` or the repo root, never a machine's absolute path. A value is stored as its schema encodes it:
`limits.record` is the parsed count of bytes, which `Schema.ByteSize` in 4.1.2 writes as a string of
digits, so a count past 2^53 stays exact.

### Whether a check enforces "a choice is a setting"

```text
lint   oxlint's own node/no-process-env in next/, so a value comes through Config   (0040: an existing tool)
type   Setting.make requires doc, default and scope; entry functions take a Settings value
law    each declared setting is reachable from the file, the env, a flag and fromUnknown
review the plan's "is this a setting?" (0069)
```

**Decided 2026-11-10: all four. Confidence 70%.** oxlint 1.90.0 has `node/no-process-env`; it would
fire on `dev.ts:36` and `:56`, two edges to mark or move. Its false alarms are not measured yet, so
it starts as advice. "Is this a choice" stays judgment.

### Key spelling and paths

**Decided 2026-11-10. Confidence 70%.** One short word where it fits (`port`, `record`, `chaos`),
kebab-case when it cannot (`fabrika-version`), as Cargo, Helix and Ghostty write keys. A key does not
say again what its type says: `limits.record` is a byte size, so it is not `recordBytes`. A path in a
setting is read from its file's folder, `~` allowed. The environment name is the path with `FABRIKA_`
in front, constant-cased: `FABRIKA_INSTANCE_PORT`, as Cargo's `CARGO_FOO_BAR`.

A byte size has one spelling: a string with its unit, as Effect reads it.

```ts
// A sketch, next/. effect 4.1.2's Schema.ByteSize and ByteSize.bytes.
export const record = Setting.make("limits.record", {
  schema: Schema.ByteSize, // "64 KiB" or "1 GB"; a bare 65536 is refused
  default: ByteSize.bytes(1_000_000_000),
  doc: "The most bytes one record may hold. A repo's file may lower it, never raise it.",
  scope: ["repo"],
  reload: "restart",
});
```

A probe on 4.1.2 read `"64 KiB"` and `"64KiB"` as 65536 and `"1 GB"` as 1000000000, and refused
`65536` and `"65536"` with "Expected a valid ByteSize string at ["record"]". `kB`, `MB` and `GB` are
powers of 1,000; `KiB`, `MiB` and `GiB` powers of 1,024. S5's words: "limits.record = 65536 is not a
byte size. Write a number and a unit, such as \"64 KiB\" or \"1 GB\"."

## The design

**Decided 2026-11-10: TOML tables per area and per pack, with a schema line in each file, and every
change the hands see recorded on the ledger. The file stays the source.**

```toml
# ~/.fabrika/fabrika.toml, the person's
#:schema ./person.json
theme = "fabrika"

[instance]
port = 70000

[pack.fixtures]
from = "./fixtures"
```

```toml
# .fabrika/fabrika.toml, the repo's
#:schema ./repo.json
fabrika-version = "0.4.0"

[review]
human-approvals = 1

[pack.fabrika.settings]
```

```text
~/.fabrika/fabrika.toml, line 5: instance.port = 70000 is not a port.
  A port is a whole number from 1 to 65535. The instance did not start.

$ fabrika settings              # once line 5 says port = 18800
fabrika-version         0.4.0        .fabrika/fabrika.toml:2
review.human-approvals  1            .fabrika/fabrika.toml:5
instance.port           18800        ~/.fabrika/fabrika.toml:5
pack.fixtures           ./fixtures   ~/.fabrika/fabrika.toml:7
```

- **The editor** underlines `70000` before a save, from `person.json`.
- **A test** sets a value with `ConfigProvider.fromUnknown`, in the files' own shape (0069).
- **An agent** uses flags or its own home's file. It cannot write `.fabrika/`, and it never writes a
  person's file (principle 5).
- **The record.** Each new hash of the person's file the hands see is a ledger fact, with `by`, the
  referee's `arrivedAt` and the writer's `sentAt`. So "who changed it, when" is kept, and the ledger
  never owns the value.
- **What it gives up.** A key's full path is split across a table header and a line, so
  `fabrika settings` prints the dotted path for search.

The designs that lost:

- **Flat dotted keys, the Ghostty way.** A fine second; long files read as one wall, with no sections
  to scan.
- **One typed TypeScript file, the WezTerm and Neovim way.** A file of code can branch, so it walks
  back TOML and "a config that decides what happens next"; a computed value has no line for S5.
- **Settings as ledger facts, the file a view.** Two writers, the file and a settings program, race,
  and it needs Tier 2's window. Its record is kept in the design above.

## What the ledger records

- **A settings entry at each process start,** with the values in force, where each came from and
  their hash. Records name the hash beside `build`.
- **Each new hash of the person's file the hands see,** with `by`, `arrivedAt` and `sentAt`.
- **Lost if not recorded now:** which settings a past record ran under. A record written with a
  64 KiB cap means something else than one with 1 GB, and nothing can tell them apart later. This is
  "a run copies its settings when it is filed", carried into `next/`.
- **Nothing secret:** the file holds no secret, and paths are written from `~` or the repo root.

## A tryout in today's version

Not filed. One small fix the owner may pick:

- Generate a JSON Schema from today's `File` schema (`packages/pipeline/src/settings.ts`) with
  `Schema.toJsonSchemaDocument(File, { onExcessProperty: "error" })`, commit it beside
  `.fabrika/fabrika.toml`, name it with `#:schema`, and add a test that fails when it is stale.

**Size:** about 60 to 100 lines with the test, about 1 agent hour. An estimate from reading the code.

## Where this differs from settled notes

- **0069's sketch** (`.decisions/0069-choices-are-settings.md:25`, `:30`) reads `programs` as a
  record of name to path with `Config.schema` alone. Here a declaration wraps the `Config`, and
  programs come in packs. 0069 is not edited; its rule holds.
- **Programs by path and program-level tables** (2026-10-31, A4 in
  [the cloud is one more host](./the-cloud-is-one-more-host.md#a4-packs-part-decided-2026-10-31)):
  walked back by 0083. No `[programs."..."]` tables, and a repo's own program is in a local pack.
- **`~/.fabrika/packs`** as the cache in [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)
  is now `~/.fabrika/cache/packs/`, keyed by commit ([0085](../../.decisions/0085-pack-cache-under-cache-folder.md)).
- **0082's sketch** writes `scope: "repo"` as a string. Here `scope` is a list, required and never
  empty, with no "both" and no default. Fixed by 0082's amendment of 2026-11-10, which also renames
  its setting `review.human-approvals`.
- **"The pack checks them"** (the 2026-10-05 note): the core runs the schema the pack declares, at
  load. The pack still owns the rules.
- **The glossary's `setting` row** says a setting "does not change during a run". A `live` setting
  arrives as input; the row is amended with this note.
- **The glossary's `Policy` row** keeps restart policy out of settings, as OTP does, at 60%.
- **`next/`'s `~/.fabrika/instance.json`** mixes saved flags with founding facts. The 2026-10-30 note
  says "State is not settings". P38 splits it.

## What it costs

- One room in libfabrika: `Setting.make`, `group`, `fileSchema`, the strict load, the providers, the
  join of pack tables by name, the scope check, the print and the two schema outputs. About 300 to
  500 lines with tests, a guess from reading the code; P38 sizes it.
- The `Toml` service and its first Layer, about 100 to 200 lines with tests, a guess.
- `dev.ts` moves its flags onto the declarations, and `build`, the local instance and the Worker take
  one `Settings` value.
- `instance-records.test.ts` writes a `pack.toml` and names its programs under the pack.
- One settings entry per process start.

## What it cannot tell us

- Nobody has used the design. The pick is reading, plus one editor probe.
- Whether `orElse` can say which file gave a value, or each file needs its own tagged provider.
- Whether a strict load still hurts two people on two versions when one forgets to raise
  `fabrika-version`.
- Whether joining pack tables by name surprises anyone.
- Linear's answers are opinion from one docs page.
- No screen reader heard an error or a settings program.
