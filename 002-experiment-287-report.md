REPORT: experiment 287 done; a cloud session can use a remote MCP server once its host is allowed, but each tool call waited for a person

Answer: partly. Two public servers that need no login, Cloudflare's docs server
(https://docs.mcp.cloudflare.com/mcp) and Microsoft Learn's (https://learn.microsoft.com/api/mcp),
both taken from their makers' READMEs on GitHub. With the environment as it was (Limited, no
allowed hosts), the session's own egress proxy refused both with a 403 on CONNECT, on every path.
The setting `allow_mcp_servers: true` covers claude.ai connectors, whose traffic goes through
Anthropic. It does not cover servers named in a repository's `.mcp.json`. With the two hosts added
to the environment's allowed domains (the owner approved the change, and I removed it again at the
end), it worked as in the table.

| Way | Reached the server? | Ran or read | What it needs |
|---|---|---|---|
| curl from the box | no, then yes (initialize 200, GET 405) | ran | the host on the allowlist |
| local agent, `claude -p --mcp-config` | no, then yes: 2 and 3 tools, one search each, 15 s, $0.26 | ran | the same |
| new cloud session on a branch with `.mcp.json` | no, then tools loaded but each call stopped at a permission prompt | ran, 2 child sessions | the allowlist, `create_session` with `source_revision`, and a yes per call (an allow rule is untested) |
| this running session, mid-run | no: `claude mcp add` showed Connected, but no tool appeared | ran | a new session |
| claude.ai connector | not tried | read in docs | added and signed in at claude.ai |

Points to know:
- `create_session` can pick a branch (`source_url` plus `source_revision`). The child loaded the
  project servers with no approval prompt, as the docs say for cloud sessions.
- Child 2's MCP calls raised `can_use_tool` with `server_policy_ask_only: true`, and the session
  went to "requires action". I did not answer the prompt, because no agent answers a question the
  machine put to a person. That child session is still waiting: the owner may deny or archive it.
  Whether a committed `.claude/settings.json` allow rule lifts the prompt is the first thing to
  test next.
- Login, read in docs only: a network secret on the environment, which the proxy attaches to
  requests for its host (not tested on MCP traffic). Or `${VAR}` in `headers` from environment
  variables, which are plain text, so not for secrets. Or a claude.ai connector with OAuth, which
  the cloud host passes in. OAuth from the session itself needs `/mcp` and a browser, so it does
  not fit.
- What the Worker would need: MCP Streamable HTTP at one HTTPS URL (about 90% sure). For the
  login, either OAuth so it can be a claude.ai connector (about 70%), or a bearer token held as
  a network secret (about 60%).
- Cost: about $1.1 at list price on the subscription, most of it the first child session's first
  turn (about 90,000 tokens of setup, $0.76).
- The probe `.mcp.json` was committed for the child sessions and removed again in the final
  commit. The write-up shows its content.

Commit 616c7d2 on fabrikalfa/x287-cloud-session-remote-mcp, pushed. `pnpm format` and `pnpm lint`
passed. Write-up: experiments/287-a-cloud-session-reaches-a-remote-mcp.md, plus its README row.
The two child sessions' links are given to the owner in the coordinator's chat, not here, since
this branch is public.
