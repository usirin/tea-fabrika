FYI: experiment 289 parts 1 and 2 are done; the hosted half waits on the owner's yes

Answer so far: move first, and let the brain's answer win. Every multiplayer system read moves
first: tldraw sync, Liveblocks, the Cloudflare Agents SDK, Figma, Linear, Zero. Only Cloudflare's
plain Durable Objects chat demo waits. For one person at a desk, moving first costs nothing.
With two people on one shared focus it costs snaps, and they grow with the round trip. So focus
is better kept per person, and only shared changes (split, close) can clash. About 75% sure. The
doubts are the deployed round trip and what a snap looks like in a real window.

Part 2, local workerd (Miniflare 4.20260730.0 from the lockfile, one Worker plus one Durable
Object, JSON-RPC 2.0 over one WebSocket):

| Measure | Result |
|---|---|
| 1,000 focus keys, one client | p50 0.16 ms, p95 0.26 ms, p99 0.65 ms, max 36.5 ms (one outlier) |
| two clients, about 8 keys/s each, 60 s, last writer wins: keys overwritten mid-flight | loopback 0.6% and 1.2%; 20 ms round trip 23.0% and 17.1%; 80 ms 64.8% and 63.9% |
| the same with a version check: keys refused | loopback 1.5% and 1.9%; 20 ms 16.8% and 19.7%; 80 ms 53.4% and 46.6% |

The 20 ms and 80 ms round trips were simulated by holding each frame for half the round trip on
the client. workerd itself ran on loopback.

Part 1:
- The research ran on one agent on Opus. I checked its key quotes against the source: tldraw's
  "immediately applied", Liveblocks' "preserve optimistic" and "hard/impossible", and the chat
  demo's send-then-wait.
- This box cannot reach developers.cloudflare.com, figma.com, tldraw.dev or zero.rocicorp.dev.
  So the Figma, Zero and Agents-SDK refusal rows rest on search summaries, and the write-up says
  so.

Branches: draft write-up fabrikalfa/x289-desk-move-first (commit e831575); script
fabrikalfa/x289-desk-script (1fc5af9). `pnpm lint` passed on the write-up. The draft has a
section ready for the hosted numbers. I will fill it if the owner says yes, and drop it if he
says no. To run the hosted half I need a deployed Worker URL that this box may reach. I deploy
nothing myself and hold no key.
