---
date: "2026-11-10"
summary: "Reading, not a measurement, plus one probe. tmux, Neovim, Git, Ghostty, Helix, WezTerm, Zed, VS Code, Cargo, Kubernetes, twelve-factor and its critics, Effect, OTP and Elm agree: work with an empty file, declare each setting once with its default and words, read sources in one order with the project over the person and flags on top, show where a value came from, and say a wrong value at its key. They split on unknown keys (kubectl and Helix refuse, WezTerm and the Kubernetes server warn). The probes found a `Config` cannot see an unknown key (a typo gives the default with no word), an open table comes whole from one source under `orElse`, and the error names the key but not the file or line. The editor probe (NVIM 0.11.3, Taplo 0.10.0, Tombi 1.11.2): a schema from `Schema.toJsonSchemaDocument` gave completion, hover and diagnostics in both servers through one `#:schema` line; keys need `Schema.optionalKey`, `withDecodingDefaultKey` drops the words and default, and `$schema` is added by hand. `next/`'s local instance breaks most of it: five sticky flags, no file, the record cap in three shapes, and one more program only a test can load. Feeds [settings](../docs/direction/settings.md). | $0"
---

# How do makers let people set a choice, and what does `next/`'s local instance teach?

Read 2026-11-10. **This is reading, not a measurement.** Three small probes ran against the
installed `effect` 4.1.2 from scratch files, not kept (the third, on byte sizes, the same evening); everything else is what
public docs, public source and today's code say. One more probe, on editors, ran on 2026-11-10 and
is written up in [its own section](#a-probe-2026-11-10). It feeds [settings](../docs/direction/settings.md),
a decided note, and a private Design canvas, "Settings guidelines".

**A word.** In `next/`, one running copy of fabrika is an instance, never a stage
([0080](../.decisions/0080-a-running-copy-is-an-instance.md)). The code on main still says stage
(`stage.json`, `StageError`, `STAGE`, `stage-records.test.ts`) until the rename sweep, tracker ticket
681, runs, so a name cited from code keeps it here.

**The answer.** The makers agree on the plain way. Work with an empty file. Declare each setting
once, with its type, its default and its words, and build the docs and the editor's hints from that
one place. Read a few sources in one fixed order, the most specific last: the default, the person's
file, the project's file, the environment, a flag. Let a person ask where any value came from. Say
a wrong value in words, at the key, before anything runs. They split on one thing: an unknown key.
Kubernetes' kubectl, Helix and Ghostty refuse or report it; WezTerm only warns unless you turn
strict on; the Kubernetes server itself only warns by default.

`next/`'s local instance follows one part of this and breaks most of it. It has one schema for the
instance (`next/apps/fabrika/src/settings.ts:3`). But a person sets it only by five flags, the flags stick
in a hidden JSON file, nothing reads a `fabrika.toml`, and the one choice in the running example,
"load one more program into a local instance", only a test can make.

```text
how each tool read lets a person set a choice, one line each
tmux        one file "if present"; scopes server, session, window, pane; show-options -A marks inherited
Neovim      init.lua; options global, window or buffer; ":verbose set" tells "where it was last set"
Git         system, global, local, worktree; "last value found taking precedence"; --show-origin
Ghostty     key = value; works with no file; +show-config --default --docs; docs generated from source
Helix       config.toml, plus .helix/config.toml merged over it; unknown keys refused; :config-reload
Zed         user settings, project settings "merged on top of user settings"; a settings editor
VS Code     user, then workspace "override user settings"; each setting declares its scope
Cargo       config.toml up the tree, deeper wins; CARGO_FOO_BAR; --config over env over files
Kubernetes  a declared spec; unknown fields: Strict, Warn (server default) or Ignore; kubectl strict
12-factor   "stores config in environment variables"; critics: untyped strings, legacy, leaks
Effect      Config declares a value and its default; ConfigProvider is where it comes from
OTP         .app env, overridden by sys.config, overridden by the command line; runtime.exs
Elm         flags at init, "exactly what you expect", checked by a decoder
```

Which version: the tools are outside the repo. "`next/`" means `next/` on main at `d9dc3d164`.
"Today's version" means `apps/fabrika` and `packages/pipeline` on the same commit. Every `file:line`
below was checked again on main at `889f1f235`, after the folder move.

Decided before this study, and not reopened here:

- **[0069](../.decisions/0069-choices-are-settings.md)** (owner, 2026-11-10): a choice that makes
  sense as a `fabrika.toml` value is one, declared once as an Effect `Config` with its schema and
  default, fed alike by the file, the environment, a flag and a test; in `next/` this holds now, and
  Tier 1's P38 builds the foundation.
- **Which settings Tier 1 gets is P38's plan's answer** (owner, 2026-11-10, in 0069), never a
  question for the owner.
- **[0070](../.decisions/0070-flow-runner-stays-a-machine.md)** (2026-11-10): the lead's flow runner
  stays a plain tea machine, not a program, until a program can run outside fabrika's app.
- **[One fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md)** (2026-10-05, the
  folder 2026-10-30): `.fabrika/fabrika.toml` and `~/.fabrika/fabrika.toml`, one spelling, TOML; a
  knob is a number, a name or a pick between tested paths; the step order stays in code; an empty
  file changes nothing; an unknown key fails; a value out of range fails and names the key; a run
  copies its settings when it is filed; machines never read the file; packs are `[pack.<name>]`.
- **[Keybindings are configurable](../docs/direction/keybindings-are-configurable.md)** (2026-11-01):
  keys in their own `~/.fabrika/keybindings.toml`; a bad file keeps the last good table and names the
  line; live reload at the next key.
- **[Themes](../docs/direction/themes.md)** (2026-11-01): `theme = "<name>"` in the person's file.
- **[Principles](../docs/direction/principles.md)** 5 (2026-11-08): unsure is a setting; an agent
  cannot write `.fabrika/`; a wall is never a setting an agent can turn off.
- **[Secrets are Redacted](../docs/direction/secrets-are-redacted.md)** (2026-10-26): no secret in
  the file; a secret is read with `Config.Redacted`.
- **[Pin exact versions](../docs/direction/pin-exact-versions.md)**, and
  **[0068](../.decisions/0068-tiers-carry-every-part.md)** (2026-11-10): each tier carries a working
  slice of every core idea, settings among them.

## What was read

About 30 public pages and source files, read on 2026-11-10, and eleven files of this repo's code.
Quotes are short and were checked against the page as fetched. A claim from a summary page is
marked **secondary**, and one found nowhere is marked **guess**.

## Tools people use daily

- **tmux [c1].** It "loads the system configuration file from /etc/tmux.conf, if present". "Each
  option belongs to one or multiple scopes (server, session, window, and pane)". "Sessions which do
  not have a particular option configured inherit the value from the global session options."
  `show-options -A` "includes options inherited from a parent set of options, such options are
  marked with an asterisk." An unknown option is an error: "the -q flag suppresses errors about
  unknown or ambiguous options."
- **Neovim [c2].** Options are "global", "local to window" or "local to buffer". "When 'verbose' is
  non-zero, displaying an option value will also tell where it was last set", as "Last set from
  modeline line 1". `:checkhealth` "Run all healthchecks" [c3]. The 0069 record already quotes its
  tuned defaults, so an empty `init.lua` works.
- **Git [c4].** "Options will be read from all of these files that are available", in the order
  system, global, local, worktree, "with last value found taking precedence over values read
  earlier." `--show-origin` adds "the actual origin (config file path, ref, or blob id if
  applicable)"; `--show-scope` the scope. `include.path` and `includeIf` pull in another file. Git
  keeps unknown names, since tools store their own keys there (**guess**: the page as fetched did
  not say).
- **Ghostty [c5].** "a custom, but very simplistic `key = value` syntax." "designed to work out of the
  box with no configuration for most users." `ghostty +show-config --default --docs` prints every
  default with its docs, and "they're all generated from the same source." It reloads on a key, and
  "Some configuration options cannot be reloaded at runtime". `+list-themes` lists themes. In its
  source, an unknown key is a diagnostic, `"unknown field"` (`src/cli/args.zig`). That the rest of
  the file still loads is **secondary**.
- **Helix [c6].** A `config.toml` in the config folder, and one in a project's `.helix/` whose
  "settings will be merged with the configuration directory `config.toml` and the built-in
  configuration." `:config-reload`. In its source, the config struct is
  `#[serde(deny_unknown_fields)]` (`helix-term/src/config.rs:20`), the two files merge to depth 3
  (`:82`), and a bad file stops the start with "Bad config: …" and "Press <ENTER> to continue with
  default config" (`helix-term/src/main.rs:125`).
- **WezTerm [c7].** A Lua file that must "return a configuration table". On a change "the
  configuration will be automatically reloaded"; on an error "an error will be shown and the
  default configuration will be used instead." Its `config_builder` "knows how to log warnings or
  generate errors if you attempt to define an invalid configuration option", warns by default, and
  `set_strict_mode(true)` turns that into an error window.
- **Zed [c8].** "project settings are merged on top of user settings", and every setting can be set
  "in the Settings Editor" or in `settings.json`. (The page as fetched did not show its JSON schema;
  that it ships one is **secondary**.)
- **VS Code [c9].** "Workspace settings are specific to a project and override user settings."
  Values live in `settings.json`, and the Settings editor is a front end on it. An extension
  declares its settings in `contributes.configuration`, with a `default`, a `markdownDescription`
  shown in the settings UI, and a `scope`: `application` settings "can only be configured in user
  settings", `machine` ones "only in user settings or only in remote settings", and "If no `scope`
  is declared, the default is `window`." Some settings "can only be defined in user settings and not
  at workspace scope" for security.
- **Cargo [c10].** It "looks for configuration files in the current directory and all parent
  directories", and the "deeper config directory" wins, "where the home directory is the lowest
  priority." "For each configuration key of the form `foo.bar` the environment variable
  `CARGO_FOO_BAR` can also be used". "Configuration values specified this way [`--config`] take
  precedence over environment variables, which take precedence over configuration files." Arrays
  join across files.
- **Taplo [c11],** the TOML language server most editors use: a file may name its schema with the
  `#:schema` header directive, and the schema, "in JSON format", gives completion.

## Declared state, and the twelve-factor rule

- **Kubernetes [c12].** Unknown fields have three answers. Strict: "rejects the request with a 400
  Bad Request error". Warn, the server default: "reports a warning to the client". Ignore: "dropping
  all unknown and duplicate fields and giving no indication it has done so." And "The default
  validation setting for kubectl is `--validate=true`, which means strict server-side field
  validation." So the tool a person types into is strict, and the server that old and new clients
  share only warns.
- **The twelve-factor app [c13].** "An app's config is everything that is likely to vary between
  deploys", kept in "strict separation of config from code", and "The twelve-factor app stores config
  in environment variables". Grouping into named environments "does not scale cleanly". Its
  open-source test fits a public repo: "could be made open source at any moment, without
  compromising any credentials".
- **Its critics [c14].** Environment variables "tie us to all that legacy", "should never affect an
  app running in production", and lose types where a file keeps them: "A string will always be a
  string and won't turn into a number." Other posts (**secondary**) say to validate all config at
  start and keep secrets out of the environment, since process lists and crash reports show it.

## Effect, as installed, and Tim Smart's apps

- **The real API, in `effect` 4.1.2** (`node_modules/effect/src/Config.ts`, `ConfigProvider.ts`).
  `Config` describes a value: `Config.Port`, `Config.Int`, `Config.ByteSize`, `Config.Duration`,
  `Config.Literals`, `Config.Redacted`, `Config.schema(codec, path)`, with `Config.withDefault`,
  `Config.nested`, `Config.all`, `Config.orElse` (`Config.ts:800`, `:1240`, `:1797`, `:1876`). A
  `ConfigProvider` is where values come from: `fromUnknown`, `fromEnv`, `fromDotEnv`, `fromDir`,
  `orElse`, `nested`, `constantCase`, `layer`, `layerAdd` (`ConfigProvider.ts:492`, `:766`, `:1061`,
  `:1209`). `orElse` "falls back to `that` when `self` returns `undefined` for a path". The guide that
  ships with it says "You describe _what_ you need with `Config`, and the library figures out _how_
  to read and validate it using a `ConfigProvider`" [c15].
- **What the probes found.** A `Config` cannot see a key nobody asked for. A typo, `prot = 1`, gives
  the default port with no word, and a struct read with `Config.schema` drops an extra key. So "an
  unknown key fails" needs one more check: a strict decode of the whole file, which works,
  `Schema.decodeUnknownEffect(File)(text, { onExcessProperty: "error" })` gives "Expected no excess
  property at ["prot"]". Two files under `orElse` merge field by field for declared fields, but an
  open table such as `programs` comes whole from the first file that has it. A bad port reads
  "Expected a value between 1 and 65535 at ["port"]": the key, never the file or the line.
  `constantCase` maps `instance.port` to `INSTANCE_PORT`, Cargo's naming. `Config.ByteSize("record")` reads
  `"64KiB"` and `"64 KiB"` as 65536 bytes and `"1 GB"` as 1000000000, and refuses a bare `65536` or
  `"65536"` with "Expected a valid ByteSize string at ["record"]": the unit is required.
- **Effect can describe a schema for an editor.** `Schema.toJsonSchemaDocument` exists in the
  installed version (`Schema.ts`, in the top-level `Schema` module), so a JSON Schema for an editor
  can come from the same declaration. The [probe below](#a-probe-2026-11-10) tried it.
- **Tim Smart's apps [c16].** He reads each value where the service is built, from the environment,
  with its default beside it: `Config.Port("PORT").pipe(Config.withDefault(8080))` inside
  `Layer.unwrap` (`cheffect`, `server/main.ts:12`); `Config.String("ACTUAL_DATA")` with a default and
  `Config.Redacted("ACTUAL_PASSWORD")` inside a service's `make` (`actualbudget-sync`,
  `src/Actual.ts:33`); `Config.String("LALPH_EDITOR").pipe(Config.orElse(() =>
  Config.String("EDITOR")), …, Config.withDefault(["nano"]))` (`lalph`, `src/shared/config.ts:4`).
  No file, no list of keys, no docs from the declaration: his apps have a handful of values each.

## OTP and Elm

- **OTP [c17].** An application's parameters are "a list of `{Par,Val}` tuples specified by a key
  `env` in the `.app` file"; "The values in the `.app` file can be overridden by values in a system
  configuration file", and they "can be overridden directly from the command line". Elixir's
  `config/config.exs` "is read at build time", and `config/runtime.exs` "is read after our application
  and dependencies are compiled" [c18]. Its anti-pattern list says "library authors should avoid
  using the application environment", and "this type of configuration should be performed using a
  parameter passed to the function" [c19].
- **Elm [c20].** "Flags are a way to pass values into Elm on initialization", and "Elm checks for that
  sort of thing, making sure the flags are exactly what you expect", through a decoder.

## Apps with a pointer, and accessibility

- **Linear [c21].** "Adjust your preferences to help you move faster and personalize your
  workflow." Preferences are the person's, beside workspace and team settings. How their team
  would build ours is a guess, marked so in the note.
- **WCAG 3.3.1 [c22].** "If an input error is automatically detected, the item that is in error is
  identified and the error is described to the user in text." A wrong value in a file is that, for a
  person reading a terminal or a screen reader.

## Outside software

- **A mixing console's scenes and safes [o1].** A scene stores every channel's settings; Recall Safe
  keeps chosen channels or parameters out of a recall, and the scene still stores them (Yamaha CL
  and M7CL manuals, **secondary**: read through search excerpts). It teaches: a layer of saved values
  over a live state, with a named, visible way to say "never change this one on recall". It does not
  carry over: a console has one operator and one desk; fabrika has two people and many files.
- **A camera's custom modes [o2].** Fujifilm's C1 to C7 slots hold a whole set of picks under one
  dial position, and some bodies can save only the image picks (**secondary**, from guides). It
  teaches: a named set of values a person switches to at once. It does not carry over: there is no
  "where did this value come from", since a slot overwrites everything.
- **Ableton Live's defaults and templates [o3].** "Live will use these settings as the initialized,
  default state for new Live Sets"; a template set loads "with the configuration you saved". It
  teaches: the person's default is a saved state they shaped, not a list they type. It does not
  carry over: a set is a project's state, and our rule is that state is not settings.

## Today's local instance, and today's version

The running example: **"load one more program into a local instance"**, as a setting.

| What | Today | Where |
|---|---|---|
| The instance's whole schema | seven keys, no defaults, no words | `next/apps/fabrika/src/settings.ts:3` |
| How a person sets it | five flags, `--port --name --person --founder --window` | `next/apps/fabrika/dev.ts:12` |
| A flag value | sticks: merged into `~/.fabrika/stage.json`, written back every start | `next/apps/fabrika/dev.ts:57`, `:76` |
| The port's default | `18787`, in the start code, not the schema | `next/apps/fabrika/dev.ts:71` |
| The home | `FABRIKA_HOME` read raw from `process.env` | `next/apps/fabrika/dev.ts:56` |
| One more program | `build({ programs })`, but `dev.ts` calls `build({ out })` only | `next/apps/fabrika/src/build.ts:16`, `dev.ts:79` |
| Who reaches it | only a test | `next/apps/fabrika/src/stage-records.test.ts:176` |
| The fixed list | one row, `counter` | `next/apps/fabrika/src/table.ts:5` |
| The record cap | set only by a test; a second schema in the Worker; its default, 1 GB, a third place | `stage-records.test.ts:193`, `next/packages/libfabrika/src/cloudflare/record.ts:79`, `:29` |
| The Worker's view | the settings as one JSON environment variable, `STAGE`, typed again by hand | `next/apps/fabrika/alchemy.run.ts:52`, `next/packages/libfabrika/src/cloudflare/runtime.ts:78` |
| Today's version's repo file | Effect Schema, strict: "no such key or table" | `packages/pipeline/src/settings.ts:313`, `:359` |
| Today's version's start | prints every pick and where it came from | `packages/pipeline/src/setup.ts:5` |
| Today's version's person files | one reader, `none`, `read` or `refused` with a line; keys keep the last good table | `apps/fabrika/src/host/settings.ts:62`, `apps/fabrika/src/host/keybindings.ts:84` |

Checked against the note's principles (S1 to S7):

- **S1, a choice is a setting: breaks.** `programs` and the record cap are choices only a test
  reaches.
- **S2, declared once: breaks.** The record cap has three shapes and its default sits apart; the
  port's default is in `dev.ts`; `BrainOptions` types the instance a second time.
- **S3, an empty file works: half.** There is no file. With no flags and no `stage.json`, the start
  fails, since `name`, `person` and `founder` have no default. Those three are founding facts, not
  settings, which is why they have none.
- **S4, one order, and the source shown: breaks.** A flag beats `stage.json`, and the flag then
  becomes `stage.json`, so the next start cannot tell a flag from a saved value. Nothing prints
  where a value came from. Today's version does print it.
- **S5, a wrong value said in words: half.** The schema refuses a bad port, but `dev.ts` turns every
  failure into `StageError({ reason: "settings" })` (`dev.ts:75`), so the key and the value are lost.
  Today's version names the key, and its keys file names the line.
- **S6, read at the edge, handed in, recorded: half.** The values are read once in `dev.ts` and
  handed to the instance, which is right. But the Worker reads `STAGE` again in `record.ts`, and no
  record names the settings it ran under; records name only the `build`.
- **S7, find out from the app: breaks.** No command lists what can be set. Today's version's start
  print is the nearest thing.

## A probe, 2026-11-10

This part ran. It asked one question: does a JSON Schema made from an Effect Schema give completion,
hover and diagnostics in an editor, under both TOML language servers?

- **Setup.** NVIM 0.11.3, Taplo 0.10.0, Tombi 1.11.2 and `effect` 4.1.2. A small script made two
  schemas, `person.json` and `repo.json`, from two `Schema.Struct`s with
  `Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })`. Each TOML file named its
  schema with one `#:schema ./person.json` line.
- **What worked.** Completion, hover and diagnostics, from the generated schema, in both servers. One
  `#:schema` line served both.
- **What the build must handle.** Four things:
  - Every key came out required unless the struct used `Schema.optionalKey`.
  - `Schema.withDecodingDefaultKey` dropped the description and the default from the output.
  - No `$schema` key came out; the script added it, and the definitions, around the document's
    `schema`.
  - Tombi's hover also showed the default and the range; Taplo's showed only the description.
- **One more check, for the note's provider chain.** On the same `effect`, a Node script read
  `FABRIKA_INSTANCE_PORT=18800` at `instance.port` through
  `ConfigProvider.fromEnv().pipe(ConfigProvider.nested("fabrika"), ConfigProvider.constantCase)`,
  fell back to a `fromUnknown` file under `orElse`, and read through `ConfigProvider.layer`. With
  `constantCase` before `nested`, it read nothing and gave the default.
- **Kept outside git.** The probe's files stay in the owner's private archive, not in the repo
  ([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).
- **What it cannot tell us.** One editor, one person, a two-key schema. Other editors (VS Code, Zed,
  Helix) were not tried.

## What this tells us for fabrika

- The plain way the makers share fits 0069 and the 2026-10-05 note. Nothing found argues against
  TOML, against one fixed order, or against a strict load at start.
- Effect gives the reading and the order, not the rest. Unknown keys, the line of a bad value,
  "where did this come from", docs and an editor schema all need one declaration that knows its own
  path, default and words. A `Config` alone is opaque, so the declaration has to hold both.
- The order the makers agree on puts the project over the person (Git, Cargo, VS Code, Helix, Zed).
  VS Code's `scope` answers the clash with a person's own picks: some settings may only live in the
  person's file.
- Unknown keys split along one line, Kubernetes' own: the tool a person types into is strict, and a
  file shared by people on different versions is where strict hurts. With two people on one repo,
  that is our case too.
- Every maker that reloads says some settings cannot reload. So each setting says whether it can.

## What it cannot tell us

- No design was built or shot. The designs in the note are files and words; only the editor half
  of one was tried.
- Nobody used any of them. Whether people read a flat file or tables more easily is a guess.
- Ghostty's "the rest still loads", Zed's schema, the Yamaha and Fujifilm details and Git's unknown
  keys were not read on a primary page.
- Linear's settings were read from one docs page; how they would build ours is opinion.
- Whether the strict load hurts two people on two fabrika versions is untested.
- No screen reader heard an error.

Dollars: $0. No model ran. The three reading probes ran with Node on `effect` 4.1.2 from scratch
files and were deleted; the 2026-11-10 probe's files are kept outside git.

## Links

- [c1] [tmux(1)](https://man.openbsd.org/tmux.1)
- [c2] [Neovim, options](https://neovim.io/doc/user/options/)
- [c3] [Neovim, health](https://neovim.io/doc/user/health/)
- [c4] [git-config](https://git-scm.com/docs/git-config)
- [c5] [Ghostty, configuration](https://ghostty.org/docs/config), [reference](https://ghostty.org/docs/config/reference), [`src/cli/args.zig`](https://github.com/ghostty-org/ghostty/blob/main/src/cli/args.zig)
- [c6] [Helix, configuration](https://docs.helix-editor.com/configuration.html), [`helix-term/src/config.rs`](https://github.com/helix-editor/helix/blob/master/helix-term/src/config.rs), [`helix-term/src/main.rs`](https://github.com/helix-editor/helix/blob/master/helix-term/src/main.rs)
- [c7] [WezTerm, configuration files](https://wezterm.org/config/files.html), [`config_builder`](https://wezterm.org/config/lua/wezterm/config_builder.html)
- [c8] [Zed, all settings](https://zed.dev/docs/configuring-zed)
- [c9] [VS Code, settings](https://code.visualstudio.com/docs/configure/settings), [contribution points](https://code.visualstudio.com/api/references/contribution-points)
- [c10] [Cargo, configuration](https://doc.rust-lang.org/cargo/reference/config.html)
- [c11] [Taplo, directives](https://taplo.tamasfe.dev/configuration/directives.html), [developing schemas](https://taplo.tamasfe.dev/configuration/developing-schemas.html)
- [c12] [Kubernetes, API concepts, field validation](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [c13] [The Twelve-Factor App, III. Config](https://12factor.net/config)
- [c14] [Ivan Grishaev, "Environ variables are not for configuring software"](https://grishaev.me/en/env/); [Marmelab, validating twelve-factor config](https://marmelab.com/blog/2018/12/05/twelve-factor-applications-how-do-you-validate-your-configuration.html) (secondary)
- [c15] `node_modules/effect/src/Config.ts`, `ConfigProvider.ts`, `Schema.ts` in `effect` 4.1.2; upstream [CONFIG.md](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CONFIG.md)
- [c16] [cheffect `server/main.ts`](https://github.com/tim-smart/cheffect/blob/main/server/main.ts), [actualbudget-sync `src/Actual.ts`](https://github.com/tim-smart/actualbudget-sync/blob/main/src/Actual.ts), [lalph `src/shared/config.ts`](https://github.com/tim-smart/lalph/blob/main/src/shared/config.ts)
- [c17] [Erlang, applications, configuring an application](https://www.erlang.org/doc/system/applications.html)
- [c18] [Elixir, configuration and releases](https://elixir.hexdocs.pm/main/config-and-releases.html)
- [c19] [Elixir, design anti-patterns](https://elixir.hexdocs.pm/design-anti-patterns.html)
- [c20] [Elm guide, flags](https://guide.elm-lang.org/interop/flags.html)
- [c21] [Linear, account preferences](https://linear.app/docs/account-preferences)
- [c22] [WCAG 2.2, understanding 3.3.1 error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- [o1] Yamaha CL1 manual p. 91, M7CL V3 recall safe guide, through [search excerpts](https://www.manualslib.com/manual/1190224/Yamaha-Cl1.html?page=91) (secondary)
- [o2] [Fujifilm X-A3 manual, custom mode](https://app.fujifilm-dsc.com/en/manual/x-a3/shooting_mode/custom/); guides on C1 to C7 (secondary)
- [o3] [Ableton Live manual, managing files and sets](https://www.ableton.com/en/manual/managing-files-and-sets/)
