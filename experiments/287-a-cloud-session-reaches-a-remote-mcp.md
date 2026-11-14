---
date: "2026-11-14"
summary: "`next/` (the tracker as MCP on a Worker); about $1.5 at list price on the subscription. Partly. Two public servers, Cloudflare's docs and Microsoft Learn's. With the environment at Limited and nothing listed, the session's egress proxy refused both with a 403 on every path; `allow_mcp_servers` covers claude.ai connectors, not `.mcp.json`. With the two hosts allowed: a local agent listed 2 and 3 tools and ran a search on each in 15 s; a new cloud session started on the branch (`create_session` takes `source_revision`) loaded both servers with no approval, but each tool call stopped at a permission prompt (`server_policy_ask_only`), untested whether an allow rule lifts it, and the owner's later yes came after the hosts were removed, so no call returned; this running session did not gain a server added mid-run. Login, read in docs only: a network secret the proxy adds by host, or a claude.ai connector with OAuth"
---

# 287. Can a Claude cloud session use an MCP server at a public HTTPS address?

Run on 2026-11-14 (UTC) inside one Claude cloud session (Anthropic's own cloud, Linux, Claude Code
CLI 2.1.325), on the repository's own cloud environment. It is about `next/`: the plan to serve
the tracker as MCP over HTTP from a Cloudflare Worker. No key, token or login was added, and
nothing was deployed. Two public MCP servers that need no login were used, read and search tools
only. Cost: subscription usage only, **about $1.5 at list price** (the tools' own `costUSD`
figures, list basis, 2026-11-14), most of it the two child sessions' first turns ($0.76 and
$0.39).

**The answer: partly. Once the server's host is on the cloud environment's network allowlist, a
local agent in the box uses it fully, and a new cloud session started on a branch with a
committed `.mcp.json` connects and lists its tools. But that session's first call to each tool
stopped at a permission prompt for a person, so it did not run unattended. With the environment as
it was (Limited, nothing listed), every path was refused by the session's own egress proxy, and a
session that is already running did not pick up a new server.**

| Way | Reached the server? | Ran or read | What it needs |
|---|---|---|---|
| Plain HTTPS from the box (curl) | no, then yes | ran | the host on the environment's allowlist |
| Local agent in the box (`claude -p --mcp-config`) | no, then yes | ran | the same |
| New cloud session started on a branch with `.mcp.json` | no, then tools loaded but each call waited for a person | ran | the same, plus a branch picked with `source_revision`, plus a yes per tool call (or a rule, untested) |
| This running session, after `.mcp.json` and `claude mcp add` | no | ran | a new session; see part 5 |
| A claude.ai connector delivered to the session | not tried | read in docs | the server added at claude.ai, login done there |

"No, then yes" means: refused before the owner added the two hosts to the environment's allowed
domains, and working after. That change was made for this experiment and removed at the end.

```jsonc
// The whole idea: this .mcp.json, committed on the experiment branch only.
{
  "mcpServers": {
    "cfdocs": { "type": "http", "url": "https://docs.mcp.cloudflare.com/mcp" },
    "mslearn": { "type": "http", "url": "https://learn.microsoft.com/api/mcp" },
  },
}
// A cloud session started on that branch loaded both servers without asking.
// Its proxy then decided: host not allowed -> 403 on CONNECT; host allowed -> tools work.
```

## The two servers

Both addresses come from their makers' own pages, read through GitHub (the box could not reach
Cloudflare's docs site, see part 2):

- Cloudflare's documentation server, `https://docs.mcp.cloudflare.com/mcp`, from the server table
  in the README of `cloudflare/mcp-server-cloudflare`. Its `serverInfo` says `docs-ai-search`
  0.5.0.
- Microsoft Learn's server, `https://learn.microsoft.com/api/mcp`, from the README of
  `MicrosoftDocs/mcp`, which says "No API keys, no logins, no sign-ups required". Its
  `serverInfo` says `Microsoft Learn MCP Server` 1.0.0.

## 1. What the box has (ran)

- `claude mcp list`: "No MCP servers configured."
- The repository has no `.mcp.json` on `origin/main` (checked with `ls -a`). Its `.claude/` holds
  only `skills/`.
- This session's own MCP tools come from its host, not from any config file: the session tools
  (`claude-code-remote`), claude.ai connectors (Claude Docs, Google Calendar, artifacts) and GitHub.
  A `claude -p` started in the box sees none of them (also found in 286).

## 2. The network path (ran)

The environment, as `get_environment` showed it: network `limited`, `allow_package_managers:
true`, `allow_mcp_servers: true`, `allowed_hosts: []`.

| Request, before | Result |
|---|---|
| `curl https://developers.cloudflare.com/...` | `CONNECT tunnel failed, response 403` |
| `curl https://docs.mcp.cloudflare.com/mcp`, GET and an MCP `initialize` POST | `CONNECT tunnel failed, response 403` |
| `curl https://learn.microsoft.com/api/mcp`, the same two | `CONNECT tunnel failed, response 403` |

The box's local proxy status page logged each one as `connect_rejected`: "gateway answered 403 to
CONNECT (policy denial or other refusal)". So the refusal came from the session's egress proxy,
and no request reached either server.

After the owner approved adding `docs.mcp.cloudflare.com` and `learn.microsoft.com` to the
allowed domains (it took effect in under 20 seconds, in this running session):

| Request, after | Result |
|---|---|
| GET on either address | `405` from the server (Streamable HTTP wants a POST) |
| `initialize` POST on either address | `200`, an SSE `event: message` with the server's capabilities |

What `allow_mcp_servers` means, read in docs: the cloud environments page says MCP connectors "work
without adding their hosts to Allowed domains, because connector traffic travels through
Anthropic's servers rather than the session's network". So the setting covers connectors from
claude.ai. It does not cover a server named in a repository's `.mcp.json`. Part 4 shows that.

## 3. A local agent in the box (ran)

`claude -p "<list the tools, call each search once>" --mcp-config mcp.json --strict-mcp-config
--allowedTools "mcp__cfdocs,mcp__mslearn"`, with the config above.

- **Before the allowlist change:** exit 0 in about 10 s, and the agent said both servers "didn't
  connect. The proxy refused the tunnel with a 403 Forbidden error, so 0 tools are available".
  Cost $0.082.
- **After:** exit 0 in 15 s wall time (13.7 s of turn time, 4 turns). Answer:
  - cfdocs, 2 tools: `search_cloudflare_documentation`, `migrate_pages_to_workers_guide`.
  - mslearn, 3 tools: `microsoft_docs_search`, `microsoft_docs_fetch`,
    `microsoft_code_sample_search`.
  - cfdocs search "Workers KV", first result: "Kv" (Cloudflare Workers KV).
  - mslearn search "Azure Functions", first result: "What is Azure Functions?".
  - Tokens: 8 in, 447 out, 62,223 cache read, 30,001 cache write. Cost $0.261.

## 4. A new cloud session with the server in `.mcp.json` (ran)

`create_session` can pick a branch: it takes `source_url` and `source_revision`, and the session
it made reported `sources: [{ git_repository: { url, revision:
"fabrikalfa/x287-cloud-session-remote-mcp" } }]`. The `.mcp.json` above was committed and pushed
on this branch first. Two child sessions were started, each with a prompt that does the one check
and stops.

**Child 1, before the allowlist change.** It was on the right branch and saw the file. Its
answer: "I have no `mcp__cfdocs*` or `mcp__mslearn*` tools ... Both servers are configured, but
neither connected. The session reported this error for both: `ERR_PROXY_TUNNEL: "Proxy refused to
open a tunnel: 403 Forbidden"`." Its own curl to the Cloudflare address got the same 403. So the
session loaded the project servers with no approval prompt (as the MCP docs say for cloud
sessions), and the network refused them. Turn time 15.2 s; $0.757 at list price, nearly all of it
writing about 90,000 tokens of system prompt and tools to the cache.

**Child 2, after the allowlist change.** Same branch, same file. Read from its event log:

- `git rev-parse` gave the branch. `ToolSearch "+cfdocs"` found
  `mcp__cfdocs__migrate_pages_to_workers_guide` and `mcp__cfdocs__search_cloudflare_documentation`;
  `"+mslearn"` found `microsoft_code_sample_search`, `microsoft_docs_fetch` and
  `microsoft_docs_search`. So both servers connected in the cloud session, about 15 s after it
  was created.
- It then called `search_cloudflare_documentation` with "Workers KV" and `microsoft_docs_search`
  with "Azure Functions". Each call raised a `can_use_tool` control request with
  `mcp_server: { name, source: "project" }`, `server_policy_ask_only: true`, and a suggested rule
  `allow mcp__cfdocs__search_cloudflare_documentation` for `localSettings`. The session's summary
  became "Waiting on permission" for mslearn's Microsoft Docs Search tool, status
  `REQUIRES_ACTION`.
- Its Bash and ToolSearch calls before that were accepted by a rule (`source: "config"`). The two
  MCP calls were not.
- No agent answered the prompts: no agent answers a question the machine put to a person
  (AGENTS.md). The owner approved them about six minutes later, by hand. By then the two hosts
  had already been taken off the allowlist, and the session's worker had restarted (its result
  says `turn_start_resume_kind: "orphaned_permission"`). After the restart, the cut-off Cloudflare
  search returned nothing and its tool was gone. The Microsoft call failed with "MCP server
  'mslearn' has disconnected", and both servers then reported `ERR_PROXY_TUNNEL ... 403
  Forbidden`. So no search result came back from a cloud session. The timing was this
  experiment's mistake: the hosts should have stayed listed until the child's prompt was settled.
  Child 2 cost $0.39 at list price in all.

What `server_policy_ask_only` means is not documented on the pages read. It reads like a policy
that sends project MCP tools to a person whatever the session's mode. Whether a committed
`.claude/settings.json` allow rule such as `mcp__cfdocs` lifts it was not tested: the brief allowed
two child sessions, and both were used. That is the first thing to test next.

## 5. This running session, mid-run (ran)

- After `.mcp.json` was committed into this session's working folder, `ToolSearch` found no
  `cfdocs` or `mslearn` tool.
- After the hosts were allowed, the documented CLI way was tried once:
  `claude mcp add --transport http cfdocs-live https://docs.mcp.cloudflare.com/mcp`. It said
  "Added HTTP MCP server cfdocs-live ... to local config". `claude mcp list` then showed
  `cfdocs-live ... √ Connected`, and the two `.mcp.json` servers `⏸ Pending approval (run claude
  to approve)`. But `ToolSearch` in this session still found no such tool.
- So the CLI writes the config and can connect on its own, but the running agent does not load
  the server. The docs name `/mcp` (an interactive panel) for reconnecting, which an agent in a
  cloud session cannot type. The entry was removed again with `claude mcp remove cfdocs-live`.
- Read in docs: a network allowlist change reaches a running session within about a minute. That
  held here: this session's own curl worked about 20 seconds after the change. So for the network
  a running session follows; for the MCP server list it does not.

## 6. How a login would get in (read in docs only)

Nothing here was tried. Every line is **read in docs**, from the cloud environments page
(<https://code.claude.com/docs/en/cloud-environments.md>) and the MCP page
(<https://code.claude.com/docs/en/mcp.md>).

- **Network secrets on the environment (read in docs).** The owner adds a secret in the
  environment's Network secrets, with its allowed hosts and a header (default `Authorization:
  Bearer`). "The agent proxy attaches a secret to a request when the request's host matches one
  you listed", in every session of that environment, and the key "doesn't appear in the session's
  environment variables or in any file". A host with a secret is reachable "even when the
  environment's network access level wouldn't otherwise allow" it. For a tracker this looks like
  the best fit: `.mcp.json` names only the URL, and the proxy adds the token on the way out. Not
  tested: whether the proxy adds the header to MCP traffic the CLI itself sends, as it does for
  curl. That is the first thing to test once a real server with a token exists.
- **Environment variables plus `${VAR}` in `headers` (read in docs).** `.mcp.json` may say
  `"headers": { "Authorization": "Bearer ${TRACKER_TOKEN}" }`, and the environment's variables
  set `TRACKER_TOKEN`. But environment variables are stored in plain text and are readable by
  every session in the environment, and the docs say not to put secrets there. Claude Code also
  reads its own credential names as empty in a remote server's headers (`ANTHROPIC_API_KEY`,
  `HTTPS_PROXY` and others), so the variable must have its own name.
- **`headersHelper` (read in docs).** A command that prints headers at connect time. In a cloud
  session it would still need the secret from somewhere, so it only moves the problem.
- **OAuth from the session (read in docs).** Claude Code does OAuth 2.0 for HTTP servers, through
  `/mcp` and a browser. A cloud session has no browser and no way to type `/mcp`, so this path
  does not fit an unattended cloud session.
- **A claude.ai connector (read in docs).** The owner adds the server once at
  claude.ai/customize/connectors and signs in there. In a cloud session "the cloud host passes them
  in", "the session's proxy authenticates to the connector with the authorization you granted in
  claude.ai", and the traffic "travels through Anthropic's servers", so it needs no allowlist entry.
  On Team and Enterprise only admins can add one. This is the path built for this exact case. It
  needs the Worker to speak MCP over HTTP with OAuth that claude.ai can complete.

## What a fabrika tracker on a Worker would have to offer

- **Transport: MCP Streamable HTTP at one public HTTPS URL.** Both servers here speak it (POST,
  SSE replies, GET gives 405), and Claude Code's `type: "http"` reached both. About 90% sure this
  is enough on the transport side. Cloudflare's own `agents` package serves this shape from a
  Worker, and its docs server is a Worker. This holds for a browser too: it is plain HTTPS
  ([a browser is always a client](../docs/direction/a-browser-is-always-a-client.md)).
- **Login, one of two:**
  1. **OAuth 2.0 as the MCP spec has it**, so the server can be a claude.ai connector: one sign-in
     by the owner, and every cloud session gets it with no secret in the environment. About 70%
     sure this works end to end. Not tested: custom connectors in cloud sessions, and whether a
     session started by `create_session` gets them.
  2. **A bearer token checked by the Worker**, held as a network secret on the cloud environment
     and named only by host in `.mcp.json`. Simpler to build. About 60% sure, because the proxy's
     handling of the CLI's own MCP traffic was not tested.
- **On the cloud side, whichever login:** the Worker's host goes on the environment's allowed
  domains (not needed for a connector), and the `.mcp.json` is on the branch a session starts
  from. A session that is already running needs a restart to see a new server. And each tool call
  must be allowed without a person: a committed allow rule for `mcp__<server>` is the guess, but
  child 2 shows that the default is a prompt, and the rule was not tested.

## What this cannot tell us

- Whether a network secret's header reaches MCP traffic, and whether a claude.ai custom connector
  reaches a session made by `create_session`. Both need a real server with a login, so neither ran.
- How either server behaves under load, or how long tool calls take on a cold Worker. One search
  per server ran.
- Whether a cloud thread inside a claude.ai project loads `.mcp.json`. The docs say a project
  thread loads only `CLAUDE.md` and rules from the repository, so probably not. Not tested.
- Whether `/mcp` or anything else can add a server to a running cloud session. Only the CLI way
  was tried, once.
- The allowlist change was made by the owner on a card and removed afterward. A real setup would
  keep the Worker's host listed for good.
- Whether an allow rule in `.claude/settings.json`, or anything else, lets a cloud session call a
  project MCP tool with no person. Child 2 stopped at the prompt, and nothing more was tried.
- Whether a cloud session's MCP call returns a result once a person approves it. The approval in
  child 2 came after the hosts were removed and the worker had restarted, so it says nothing
  either way.
- Whether a worker restart drops a session's MCP servers by itself. In child 2 it came together
  with the allowlist change, so the two cannot be told apart.
- Probe outputs are not kept. The short lines above are all there is. The `.mcp.json` was
  committed on this branch for the child sessions and removed again in the final commit, so the
  branch adds no MCP server; its content is the block at the top.
