---
date: "2026-11-07"
scripts: "none"
summary: "About the CLIs, not either version of fabrika; reading only, not a measurement: Claude Code 2.1.319, Agent SDK 0.3.316, Codex CLI 0.165.0 and openai/codex `57a808a`, with file and line. Both CLIs already pass on the server's percent of the limit: Claude's `rate_limit_event` (`utilization` 0 to 1, `resetsAt`) and Codex's `token_count` snapshot (`used_percent` 0 to 100, `window_minutes`, `resets_at`); token counts, OpenTelemetry and dollars have no limit to divide by. Subscription or key per run: Claude's `apiKeySource` on `system/init` plus `subscriptionType`, Codex's auth mode plus `plan_type`. A key in the environment quietly wins on both CLIs. Every percent source a program can read is experimental or undocumented. Feeds the owner's decision of the same day, [the meter on subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions). 85%; the doubt is how often the fields arrive on headless runs. No model, $0."
---

# How full is a subscription's limit, and is a run on one at all? Claude Code and Codex, read from a program

Read 2026-11-07. **This is reading, not a measurement.** No paid run, no agent on a ticket. What was
read: Claude Code 2.1.319, the Agent SDK `@anthropic-ai/claude-agent-sdk` 0.3.316 (its `sdk.d.ts`),
Codex CLI 0.165.0, and openai/codex at commit `57a808a`. A few local session files of each CLI were
looked at, not counted. It is about the CLIs, not about either version of fabrika; today's version
reads none of this yet. It feeds [the meter on
subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions), decided by the
owner the same day. Dollars spent: $0.

**The answer.**

- **Both CLIs already know your percent of the limit.** The server sends it back on every model call,
  and each CLI passes it on. Tokens alone cannot say where you stand; the percent can.
- **Claude Code, best source:** the `rate_limit_event` message in `--output-format stream-json` and
  the Agent SDK, with `rateLimitType`, `utilization` (0 to 1) and `resetsAt`.
- **Codex, best source:** the `token_count` event's `rate_limits` snapshot, with `used_percent`
  (0 to 100), `window_minutes` and `resets_at`. It lands in the session file after each turn, and
  `codex app-server` serves it as `account/rateLimits/read`.
- **Subscription or key, per run:** Claude's `apiKeySource` on the first `system/init` message, plus
  `accountInfo()`'s `subscriptionType`; Codex's auth mode, plus the snapshot's `plan_type`.
- **A key in the environment quietly wins on both.** So each run should record whether each key
  variable was set, yes or no.
- **Not good enough alone:** token counts from transcripts, OpenTelemetry, and dollar figures. They
  have no limit to divide by.
- **Every percent source is experimental or undocumented,** except Claude's status line fields and
  Codex's `/status` screen, which only a person sees. Read them with every field optional.
- How sure: about 85%. The doubt is how often the fields arrive on headless runs.

## 1. Claude Code on a Max plan

**The limits.** Pro and Max have a five-hour session limit and a weekly limit, shared between
claude.ai and Claude Code; Max also has a separate weekly Fable limit
([help article](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)).
Anthropic publishes no token or hour numbers there. Windows roll; they are not calendar-based
([costs, Teams section](https://code.claude.com/docs/en/costs#claude-for-teams-and-enterprise)). The
SDK also names `seven_day_opus`, `seven_day_sonnet` and per-model `model_scoped` windows
(`sdk.d.ts:4430-4500`).

| Source | What it gives | Stable? |
|---|---|---|
| `rate_limit_event` (stream-json, SDK) | `status` (allowed, allowed_warning, rejected), `rateLimitType`, `utilization` 0 to 1, `resetsAt` in epoch seconds; the server's own number | Typed in the SDK (`sdk.d.ts:5918-5935`), "emitted when rate limit info changes" |
| SDK `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` | Five-hour, seven-day, Opus, Sonnet and per-model windows: `utilization` 0 to 100, `resets_at` as ISO text. It reads the same endpoint `/usage` reads | Unstable by its own name (`sdk.d.ts:3131-3150`, `4407-4500`) |
| Status line input | `rate_limits.five_hour` and `.seven_day`: `used_percentage` 0 to 100, `resets_at` in epoch seconds | Documented ([status line](https://code.claude.com/docs/en/statusline#rate-limit-usage)); the interactive app only |
| `/usage` screen | Plan bars, plus a rough local breakdown | A screen for a person. Its endpoint is itself rate limited and falls back to data up to 60 minutes old ([costs](https://code.claude.com/docs/en/costs#when-the-usage-request-fails)) |
| Transcript `message.usage` | Exact tokens per call, no limit | Undocumented file format |
| OpenTelemetry `claude_code.token.usage`, `cost.usage`, `api_error.status_code` | Tokens, estimated list-price dollars, 429s; no limit metric | Documented ([monitoring](https://code.claude.com/docs/en/monitoring-usage)) |

- **Seen on disk.** Older events carried `utilization` only past a warning line (`0.81`, `0.9`, with
  `surpassedThreshold: 0.75`). Newer ones add an undocumented `unifiedWindows` object with both
  windows, such as `five_hour.utilization 0.24` and `seven_day.utilization 0.5`, even when `status`
  is `allowed`. Mind the scale: this event uses 0 to 1, the status line and `usage_…()` use 0 to 100.
- The number comes from `anthropic-ratelimit-unified-5h-utilization` and `-7d-` response headers:
  strings in the 2.1.319 binary, undocumented.
- Hooks: `StopFailure` has a `rate_limit` matcher and `Notification` has `quota_auto_resume_*` types
  ([hooks](https://code.claude.com/docs/en/hooks)). They say when you hit a limit, not how close you
  are.

## 2. Codex CLI on ChatGPT Pro

**The limits.** Plus has a five-hour window; "Pro plans currently have no five-hour limit"; "weekly
limits may also apply"; local and cloud tasks share one allowance
([pricing](https://learn.chatgpt.com/docs/pricing)). A local session file agrees: one window,
`window_minutes: 10080` (7 days), `secondary: null`, `plan_type: "pro"`.

Paths below are in openai/codex at `57a808a`.

| Source | What it gives | Stable? |
|---|---|---|
| `token_count` event, `rate_limits` | `primary` and `secondary` windows: `used_percent` 0 to 100, `window_minutes`, `resets_at` in epoch seconds; `credits`, `plan_type`, `rate_limit_reached_type` | Typed in `codex-rs/protocol/src/protocol.rs:2626-2684`; the file format is undocumented |
| Session file `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | The same event, plus `total_token_usage` | Undocumented |
| `codex app-server`: `account/rateLimits/read`, `account/rateLimitsUpdated` | The same snapshot, keyed by `limit_id`, plus `ordinary_usage_allowed` | `codex-rs/app-server-protocol/src/protocol/v2/account.rs:345-368, 711-716`; the CLI marks app-server experimental |
| `/status` in the terminal app | Remaining limits and reset times | Documented ([pricing](https://learn.chatgpt.com/docs/pricing)); a screen for a person |
| `codex exec --json` | `turn.completed.usage` tokens only, no `rate_limits` | `codex-rs/exec/src/exec_events.rs:50-72` |
| OpenTelemetry | `codex.turn.token_usage`; `codex.sse_event` with kind `rate_limits` | `codex-rs/otel/src/metrics/names.rs:46`, `codex-rs/otel/src/events/session_telemetry.rs:1433`; the values are likely not exported (a guess) |

- The number comes from `x-codex-primary-used-percent` style headers or a `codex.rate_limits`
  websocket event (`codex-rs/codex-api/src/rate_limits.rs:57-79, 135-137`).

## 3. What people running many agents do

- **ccusage** ([repo](https://github.com/ccusage/ccusage)) reads local transcripts for Claude and
  Codex. It shows tokens, list-price cost and guessed five-hour blocks. It does not know the real
  limits.
- **Claude-Code-Usage-Monitor** moved to the official status line `rate_limits` and labels each
  number `official` or `local_estimate`
  ([README](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)). The tools are moving away
  from estimates.
- **CodexBar**, a menu-bar app, calls the private `api.anthropic.com/api/oauth/usage` and
  `chatgpt.com/backend-api/wham/usage`, and drives `codex app-server`'s `account/rateLimits/read`
  ([claude.md](https://github.com/steipete/CodexBar/blob/main/docs/claude.md),
  [codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)).
- **Claude Code itself** can wait for the reset and carry on (`autoContinueAtUsageLimit`,
  `/rate-limit-options`). Its advice is smaller models for subagents and small teams
  ([costs](https://code.claude.com/docs/en/costs)).
- A guess: teams gate how many agents start on one of the percent sources above. No published
  write-up was found.

## 4. Subscription or key, per run

| Signal | What it says | Good for every run? |
|---|---|---|
| Claude `apiKeySource` on `system/init` | `ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, or `none` (`sdk.d.ts:132-135, 6241`) | Yes: the first message, free. But `none` also covers a bearer token, Bedrock and Vertex |
| SDK `accountInfo()` | `subscriptionType`, `tokenSource`, `apiKeySource`, `apiProvider` (`sdk.d.ts:23-32, 3218`) | Yes, with the line above |
| `claude auth status --json` | `authMethod`, `subscriptionType` (`max` here), `apiProvider` (`firstParty`) | Before the run only; the run's environment can still change it |
| A `rate_limit_event` arrives | Only claude.ai subscribers get one | A good second check |
| Codex `auth.json` `auth_mode` | `chatgpt` here | Only with file storage; keyring or ephemeral storage skips it ([auth](https://learn.chatgpt.com/docs/auth)) |
| `codex login status` | "Logged in using ChatGPT" | Before the run only |
| App-server `Account` | `apiKey`, or `chatgpt` with `planType` (`codex-rs/app-server-protocol/src/protocol/v2/account.rs:22-37`) | Yes, if we drive app-server |
| Codex snapshot `plan_type` | `pro` | Yes, as a check; likely absent on a key run (a guess) |

- **Claude's trap.** `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` both outrank `/login`. In `-p`
  mode "the key is always used when present", with no prompt
  ([authentication](https://code.claude.com/docs/en/authentication#authentication-precedence)). A key
  left in the environment quietly moves a run to per-token billing.
- **Codex's trap.** `CODEX_API_KEY` "takes precedence over any other auth method" where it is turned
  on, which includes `codex exec` (`codex-rs/login/src/auth/manager.rs:1618-1625`; the test
  `codex-rs/exec/tests/suite/auth_env.rs:15`). The source also reads `OPENAI_API_KEY`
  (`manager.rs:1049-1054`), and the terminal app's onboarding uses it. Whether it overrides a ChatGPT
  login is not confirmed.
- **What to record each run:** Claude's `apiKeySource` and `subscriptionType`; Codex's auth mode and
  the first snapshot's `plan_type`; and whether `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CODEX_API_KEY` and `OPENAI_API_KEY` were set, yes or no, never the value. The owner decided this
  the same day, and that fabrika records a set key but never refuses a run for it.

## What this cannot tell us

- How often `utilization`, `unifiedWindows` and Codex's `rate_limits` arrive on headless runs of
  today's CLIs. Both shapes were seen on disk but not counted. A short logged run of each would
  settle it.
- The real size of each window in tokens. Neither company publishes it, so a percent cannot be
  turned back into "N more agent runs".
- Whether `usage_…()` or the private usage endpoints survive the next release. One is named
  experimental; the others are private.
- Whether Codex's `OPENAI_API_KEY` overrides a ChatGPT login. Not traced.
- What a new agent knows before its first call: nothing. Each process learns the percent only from
  its own calls.
- Whether `/login managed key` always means per-token billing. It is read here as a Console key; not
  checked on a real login.
