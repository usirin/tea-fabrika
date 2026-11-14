REPORT: experiment 287 follow-up done; with a committed allow rule no call asked, but the log credits auto mode's classifier, not the rule

Answer to 1, "does the committed allow rule skip the per-call prompt?": no prompt came. There was
no `can_use_tool` request and no REQUIRES_ACTION, and both searches returned. But each MCP call's
result records `{ decision: "accept", reason_type: "classifier", source: "config" }`, the same as
its Bash call. Only its ToolSearch call says `reason_type: "rule"`. So the calls ran with no
person, and the log does not say the rule is why. One run cannot tell "the rule did nothing and
the classifier said yes" from "the rule turned child 2's `server_policy_ask_only` prompt into a
classifier check". I am about 65% sure the rule is the part that matters. A child without the rule,
with the hosts allowed and nothing else changed, would settle it.

Answer to 2, "does a call return once approved?": not reached, because nothing waited for a yes.

| What | Value |
|---|---|
| Hosts before start | both answered `initialize` with 200 from this box, both listed in the environment |
| Branch | fabrikalfa/x287b-mcp-allow-rule: 9cba12e adds `.mcp.json` and `.claude/settings.json`, fba1b99 removes both |
| Rule | `{"permissions":{"allow":["mcp__cfdocs","mcp__mslearn"]}}`, the server-wide form in the permissions docs |
| Child | one, on Opus, permission mode auto |
| cfdocs "Workers KV" | first result "Kv" |
| mslearn "Azure Functions" | first result "What is Azure Functions?" |
| Time and cost | 18.6 s turn; $0.50 at list price (54,231 cache write, 234,421 cache read, 740 out) |

Write-up: experiment 287 updated on a new branch, fabrikalfa/x287-allow-rule-answer, commit
7ef1485. It adds "Child 3" to part 4, a table row, the answer, the cost (now about $2.0 in all),
and three new lines under what this cannot tell us. `pnpm format` and `pnpm lint` passed. The
child session's link goes to the owner in the coordinator's chat, not here.

Experiment 288 and 289 reports follow.
