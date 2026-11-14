FYI: experiment 287, child 2 still gave no result after the owner approved its prompts

The owner approved child 2's two MCP permission prompts by hand, about six minutes after they
were raised. By then I had already removed the two hosts from the environment's allowlist, and
the child's worker had restarted (its result says it resumed from an "orphaned permission"). After
the restart, the cut-off Cloudflare search returned nothing and its tool was gone. The Microsoft
call failed with "MCP server 'mslearn' has disconnected", and both servers then reported the
proxy's 403. So no cloud session returned an MCP result in this experiment. The timing was my
mistake: the hosts should have stayed listed until the prompt was settled.

What stays open: whether a call returns once a person approves it, and whether a committed allow
rule skips the prompt. Testing either needs the two hosts allowed again and one more child
session. The brief's cap of two is used up, so I will not start one unless you say so.

The write-up and README row now say this, and the cost is now about $1.5 (child 2 cost $0.39).
Commit cfb11f0 on fabrikalfa/x287-cloud-session-remote-mcp, pushed, lint passed.
