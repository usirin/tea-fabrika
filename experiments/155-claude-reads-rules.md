# 155. Can Claude read a repository's rules while its settings stay out?

The question: the [direction note](../docs/direction/agents-read-rules-the-normal-way.md) says
every agent reads a repository's rule files itself. For Claude that means
`settingSources: ["project"]`. What else does that bring in, and can the rules come in while the
rest stays out?

**Answer: yes. Confidence 85%.**

- `settingSources: ["project"]` alone brings in the rules, and also the project's hooks, its env
  and its `apiKeyHelper`. The hooks ran outside the sandbox.
- Adding `projectConfigRoot` pointed at an empty folder keeps all of that out. The rule files
  still load from the working folder: top `CLAUDE.md`, `@file` imports, `.claude/rules/`, and
  nested `CLAUDE.md` files.
- Claude does **not** read `AGENTS.md` by default, even with no `CLAUDE.md` at all. A built-in
  plugin option turns it on, and then top and nested `AGENTS.md` both load.
- The builder, the reviewer and the planner now load rules this way. The reviewer still gets
  main's copy pasted, marked as the rules the pull request is judged by.

```ts
// packages/fabrika/src/agents/claude/rules.ts: the whole switch.
export const NO_PROJECT_CONFIG = "/var/empty";
export const AGENTS_MD = {
	"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
} as const;
export const ownRules = <S extends Readonly<Record<string, unknown>>>(settings: S) => ({
	settingSources: ["project" as const], // rule files, from the working folder
	projectConfigRoot: NO_PROJECT_CONFIG, // settings, hooks, .mcp.json, .claude/ from an empty folder
	settings: {...settings, pluginConfigs: AGENTS_MD}, // AGENTS.md too
});

// builder.ts
const options = {...rest, ...ownRules({disableClaudeAiConnectors: true})};
```

## Who did what

- **This repo's code:** the builder's own options (`builderOptions` from
  `packages/pipeline/src/stages/build/builder.ts`), with a few changes per run so the test could
  see things (below). After the switch, the `builder` variant runs those options as shipped.
- **Today's fabrika:** nothing of it ran. No ledger, no lane, no real ticket.
- **Claude:** Agent SDK 0.3.296 with Claude Code 2.1.296, signed in with a Claude token from the
  environment. Model `claude-haiku-4-5`, effort low, the cheapest, as in experiment 152.
- **Not tested:** the ACP adapter (`@agentclientprotocol/claude-agent-acp` 0.85.1) pins SDK
  0.3.286. Its runs stay on `settingSources: []` with pasted rules.
- **The script:** `155-claude-reads-rules.ts`. The fixture: `155-claude-reads-rules/repo/`. The
  answers: `results/155-claude-reads-rules.json`.

## How it was measured

- **The fixture** is a small repository where every part carries its own code word, such as
  `M155-NESTED-AGENTS-b9m2`. Its files are stored under other names (`dot-claude/`,
  `CLAUDE.md.fixture`) so agents working in this repo do not load them. Each run copies it to a
  fresh temp folder and gives the real names back.
  - Rule files: top `CLAUDE.md` and `AGENTS.md`, `CLAUDE.local.md`, `packages/x/CLAUDE.md` and
    `packages/x/AGENTS.md`, `.claude/rules/style.md`, an `@docs/imported.md` import and an import
    from a folder outside the copy.
  - Settings in `.claude/settings.json`: env, looser permissions and sandbox, a status line,
    three hooks that leave a file behind, a plugin from a local marketplace, all project MCP
    servers turned on. A `.mcp.json` server leaves a file when it starts. A project skill,
    subagent and command.
- **The detector** is a small proxy on 127.0.0.1, set as the run's `ANTHROPIC_BASE_URL`. It looks
  for code words in each request to the model and passes the request on to Anthropic. It notes
  only whether a login header was there, never its value. The project's env names a second
  address, so a call sent there is counted too.
- **The job:** read `packages/x/note.txt`, run `sh probe.sh` (prints two env values, tries a write
  outside the copy and a web request), answer in one line.
- **Controls:** the prompt's own code word and one from the SDK's env reach the model in every run
  that started, so the detector works. `selftest` (no model) plants all 17 code words and finds
  them all.
- **Changes per run, for the test only:** Write is taken off the tool list (to see whether the
  project's permissions give it back), the sandbox may write only in the copy, and one extra SDK
  hook counts our own hook calls.

```ts
// A sketch of the variants (155-claude-reads-rules.ts). "before" is the builder as it was.
const VARIANTS = {
	none:          {settingSources: []},                       // the builder before the switch
	project:       {settingSources: ["project"]},
	helper:        {settingSources: ["project"], adds: "apiKeyHelper"},
	"no-hooks":    {settingSources: ["project"], settings: {disableAllHooks: true}},
	"config-root": {settingSources: ["project"], projectConfigRoot: emptyDir},
	safe:          {...ownRules(...), projectConfigRoot: emptyDir, adds: "apiKeyHelper"},
	"safe-missing":   {...ownRules(...), projectConfigRoot: "/nonexistent-155"},
	"safe-var-empty": {...ownRules(...)},                      // /var/empty
	builder:       {shipped: true, adds: "apiKeyHelper"},      // builderOptions as it is now
	"agents-only": {settingSources: ["project"], fixture: "no CLAUDE.md files"},
};
```

## What came back

One run per variant. "seen" means the code word reached the model.

| what | none | project | no-hooks | config-root | safe | agents-only | builder |
|---|---|---|---|---|---|---|---|
| top CLAUDE.md, `@file` import | - | seen | seen | seen | seen | - | seen |
| nested CLAUDE.md | - | seen | seen | seen | seen | - | seen |
| `.claude/rules/` | - | seen | seen | seen | seen | seen | seen |
| top and nested AGENTS.md | - | - | - | - | seen | - | seen |
| CLAUDE.local.md, import from outside the copy | - | - | - | - | - | - | - |
| project skill, subagent, command | - | listed | listed | - | - | listed | - |
| plugin skill, MCP server | - | - | - | - | - | - | - |
| project hooks ran | - | 3 of 3 | - | - | - | 3 of 3 | - |
| project env reached the run | - | yes | yes | - | - | yes | - |
| permissions or sandbox loosened | - | - | - | - | - | - | - |
| our own SDK hooks ran | 3 | 3 | 3 | 3 | 3 | 3 | 3 |

- **Rule files, `["project"]`:** top `CLAUDE.md`, its in-copy import, `.claude/rules/` and the
  nested `CLAUDE.md`. The nested one loads late, once the agent reads a file in its folder, as the
  docs say. `CLAUDE.local.md` did not load (it is a personal file, and was not asked for). The
  import from a folder outside the copy did not load.
- **AGENTS.md:** never with the defaults, not even in `agents-only`, where the copy has no
  `CLAUDE.md`. Claude Code 2.1.296 ships a built-in plugin, `cc-plugin-agents-md`, with an option
  `instructionFiles`: `"claude-md"`, `"claude-md-or-agents-md"` (the default), `"claude-md-and-agents-md"`
  or `"managed-only"`. With `"claude-md-and-agents-md"` set through flag settings, the top and the
  nested `AGENTS.md` both loaded. Why the default loaded nothing in `agents-only` is not known; a
  guess is that `.claude/rules/` counts as the project's own instructions.
- **Hooks:** with `["project"]` the project's `SessionStart`, `UserPromptSubmit` and `PreToolUse`
  hooks ran, outside the sandbox, and the session hook's text reached the model.
  `disableAllHooks` stopped them, and our own SDK hooks kept running.
- **Env:** the project's env reached both the agent's Bash and Claude Code itself, Claude Code's
  own variables included. `disableAllHooks` does not stop that. Only `projectConfigRoot` did.
- **`apiKeyHelper`:** a project's `apiKeyHelper` ran and became the run's login, so the run
  failed (`helper`). With `projectConfigRoot` it did not run (`safe`, `builder`).
- **Skills, subagents, commands:** listed by name at start with `["project"]`, but none of their
  text reached the model in this job. With `projectConfigRoot` they were not listed.
- **Plugin and MCP:** the project's plugin was never installed or loaded headless. The MCP server
  never started: the builder sets `strictMcpConfig`.
- **Permissions and sandbox:** never loosened. Write stayed refused, the write outside the copy
  failed, the web request got nothing. The builder's `--settings` sets
  `allowUnsandboxedCommands: false`, and the sandbox docs say project `allowWrite` and
  `allowedDomains` are then ignored. `permissionMode` stayed `dontAsk`.
- **A missing folder fails closed:** `projectConfigRoot: "/nonexistent-155"` makes Claude Code
  refuse to start ("is not an existing directory that this user can list"). Nothing loads
  silently.

## What the SDK docs say (0.3.296, `sdk.d.ts`)

- `settingSources`: "Pass `[]` to disable filesystem settings (SDK isolation mode). Must include
  `'project'` to load CLAUDE.md files."
- `projectConfigRoot`: "Project settings (hooks, permissions), `.mcp.json`, the `.claude` config
  trees (commands, agents, skills, workflows, routines, output-styles...) and
  `CLAUDE_PROJECT_DIR` come from here instead of `cwd`."
- `strictMcpConfig`: "ignoring all other MCP configurations: project `.mcp.json`, user settings,
  plugins...".
- `disableAllHooks`: "Disable all hooks and statusLine execution: the hooks defined in settings
  files and by installed plugins."

## The switch

| run | before | now | why |
|---|---|---|---|
| builder | `[]`, rules pasted | `ownRules`, rules loaded | measured above (`builder` variant) |
| reviewer | `[]`, rules pasted | `ownRules`, plus main's copy pasted | main's copy wins: a change cannot loosen its own rules |
| planner | `[]`, rules pasted | `ownRules` | same options as the builder |
| sorter | `[]` | `[]` | runs in an empty folder with no tools; no rules to read |
| ACP builder | `[]`, rules pasted | `[]`, rules pasted | its adapter pins SDK 0.3.286, not tested |
| interface's Claude adapter (156) | `[]` | `ownRules` | the same options as the stages |
| interface's `acp-claude` row (156) | `[]`, rules pasted | `[]`, rules pasted | the same older SDK |

- The builder's prompt now says the rule files "are loaded for you as you work", with the nearest
  one winning. The ACP builder keeps the pasted text (`promptOf(brief, [], "pasted")`).
- The reviewer's prompt says the pasted files are the rules the pull request is judged by, that
  Claude Code also loads the copy's files, and that the pasted files win. When main has no rule
  file at its top, it says so, and that a rule only this change adds is not one it is judged by.
- `packages/pipeline/src/stages/rules.ts` keeps reading rules: for the reviewer's judged copy and
  for the ACP builder.
- Why `/var/empty`: it is on every macOS and is empty and read-only there. A fixed path keeps the
  options plain data, with no temp folder to make and remove.

**Recommendation: keep the switch. Confidence 85%.** It brings nested files and imports to every
Claude run, which pasting never did. It costs one more setting on each run, and a box image must
make `/var/empty` (below).

## Keeping it that way

The owner kept the repository's settings out on 2026-10-26, even where only trusted people work
in it: agents write the repository too, and its `.claude/` is set up for people's own sessions
([direction note](../docs/direction/agents-read-rules-the-normal-way.md)). So the mistake this
experiment found is made hard to write again, in three layers.

```ts
// 1. pnpm lint, anywhere but rules.ts and tests (biome-plugins/no-project-settings.grit):
const options = {...rest, settingSources: ["project"]}; // refused: use ...ownRules(...)
const other = {...ownRules({}), projectConfigRoot: "/srv/repo"}; // refused
// 2. The Claude adapter's type: a stage's `more` cannot name where settings come from.
claudeAdapter({more: () => ({settingSources: ["user"]})}); // tsc error
// 3. Before Claude Code starts (openLive, and the adapter's own check):
startRefusal({settingSources: ["project"]});
// "settingSources names project, and projectConfigRoot is not set, so the project's hooks, env
//  and apiKeyHelper would load with its rules (experiment 155). Load them with ownRules ..."
emptyFolderRefusal(); // on a Debian box with no /var/empty:
// "/var/empty is not on this machine ... In a box image, as root before USER:
//  RUN mkdir -p -m 0555 /var/empty."
```

- **The lint rule blocks, so its false alarms were counted first.** On the tree it fired 17
  times. 12 were runs that load the project's settings on purpose (this experiment's variants,
  experiment 43's spike, the old operator in `legacy/`); each now says why in a `biome-ignore`.
  4 were tests that write the options' shape; tests are left out. 1 was a real slip: experiment
  127 set `settingSources: ["project"]` to measure a copy's own hook, but since the switch the
  builder's options beside it carried the empty folder, so 127 no longer loaded that hook. 127
  now drops the folder on purpose.
- **What the rule cannot see:** options that leave `settingSources` out, which loads every
  settings file. The start check refuses those.
- **The box images make the folder:** 127's and 137's Docker boxes and 148's Cloudflare box run
  `mkdir -p -m 0555 /var/empty` as root before `USER`. On the Debian Node image the folder is
  not there without it (checked with `docker run`).
- **Tests:** `rules.test.ts` plants each bad form in a file and runs the repository's own biome
  on it, checks the start refusals and the folder checks, and that a refused run starts nothing.
  `adapters.test.ts` checks the adapter's options, its type and its refusal.
- **Re-checked live after the change** (`run builder safe`, 2026-10-26): the same code words,
  hooks, env and listings as the table above, for $0.0505. The saved answers were kept as they
  were.

## Cost

- The saved answers sum to $0.1475 for the ten variants in the file.
- All runs, the early trial runs included: about $0.31.
- A run took about 31,000 to 42,000 input tokens (most of them cached) and about 1,200 output
  tokens.

```sh
CLAUDE_CODE_OAUTH_TOKEN=<token> env -u TYPESAFE_API_KEY nice -n 15 node experiments/155-claude-reads-rules.ts run none project safe builder
node experiments/155-claude-reads-rules.ts selftest   # no model
node experiments/155-claude-reads-rules.ts report     # no model
```

## What this cannot tell us

- **One run per variant, one small model.** A bigger model could read a skill when the cheap one
  did not. Loading is done by Claude Code, not the model, so this doubt is small.
- **Why the default AGENTS.md mode loaded nothing.** We set the mode by hand, so it does not
  matter today, but a later Claude Code could change the plugin's name or option.
- **Boxes without `/var/empty`.** Debian and Ubuntu do not ship it. The box images here now make
  it, and a live run checks it first and names the fix. A box image made elsewhere still needs
  the one line; no run has started Claude in such a box yet.
- **Skills and subagents of the repository** do not load this way: `projectConfigRoot` moves all
  of `.claude/` away. Copying only `.claude/skills` and `.claude/agents` into an empty root of
  the run's own is a later option, untested.
- **Plugins a person already installed.** Our runs load no user settings, so a project's
  `enabledPlugins` had nothing to turn on. Not tested with a user plugin present.
- **`@~/` imports** (from the home folder) were not tried.
- **Whether agents follow nested rule files better** than pasted ones. No run compared them.
- **The ACP adapter.** Its older SDK was not tested; it stays on pasted rules.
