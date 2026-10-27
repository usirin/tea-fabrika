# 154: Sign in with ChatGPT from a remote box, while fabrika never holds the login

**Answer: yes against a fake sign-in server, live run still to do.** A box (a stand-in for a
Cloudflare container) can use one person's own ChatGPT plan each time it starts, and the shared
ledger never carries a pass or a renewal key. All 26 checks and 14 machine checks pass, both with
the boxes as processes on a Mac and in Docker. Three places for the renewal key (the refresh
token) were built and tested. **The lean is way (c): the person's own app signs in and keeps the
refresh token on their machine; the box gets one sealed, short pass at a time and never sees a
renewal key.** About 75% sure; the doubts are at the end of section 4.

The whole idea, as the rows that cross the shared ledger in way (c):

```ts
// box -> the person's app: "lend me pass 3", with the box's public key
{kind: "pass_wanted", box: "b18", turn: 3, key: "{\"kty\":\"EC\",\"crv\":\"P-256\",...}"}
// the person's app -> box: the access token, sealed to that key for that box and turn
{kind: "pass", turn: 3, sealed: "{\"epk\":...,\"iv\":...,\"ct\":...}", expires_in: 3540, scopes: [...]}
// at the end: the box forgets; the person's app may revoke its own session
{kind: "sign_in_ended", box: "b18", why: "done", revoked: false}
```

Everything here is this repo's code. No part of today's fabrika ran: no agent of it, no ledger of
it. The ledger is `@kampus/fabrika`'s, in Miniflare. No real sign-in happened, no OpenAI endpoint
was called except to read docs pages, and nothing was deployed. $0.

## 1. What was built

- **A fake sign-in server** (`154-sign-in-remote/fake-auth.ts`). OpenAI's endpoints as its docs
  describe them, strict where they are strict:
  - PKCE S256 checked for real (RFC 7636 section 4.6).
  - A code works once; a second use revokes what the first gave (RFC 6749 section 4.1.2).
  - The redirect must be `127.0.0.1` loopback; dynamic registration hands out a new client id.
  - Refresh tokens rotate; a spent one is answered `refresh_token_reused` and its family dies.
  - RFC 7009 revocation; `/v1/responses` wants the pass as a bearer and `store: false`,
    `stream: true`.
  - No `offline_access` asked: no refresh token given. (Whether OpenAI does the same is not
    documented. The live run will say.)
- **The box** (`box.ts`), one process, bundled into one Docker image (`box/Dockerfile`, built by
  `build.ts`). It runs one of two tea machines, does one Responses call and one agent command, and
  forgets.
- **The person's app**, in two shapes: `app.ts` (ways a and b: it only catches the callback) and
  `lender.ts` (way c: it signs in itself and lends passes).
- **The Cloudflare path** (`cloud/worker.ts`), experiment 148's container shape. Checked with
  `wrangler deploy --dry-run` only (section 6).
- **The driver** (`154-sign-in-remote.ts`): fake mode, Docker mode, and a live runner for a person
  at the laptop (section 7).

## 2. The machines

Way (a) and way (b) share one machine, `signIn` (`machine.ts`). The pass is never in the state.
The tokens and the PKCE verifier sit in the box's `Vault` (`vault.ts`), in memory, each value
`Redacted`.

```ts
type SignIn =
	| {at: "asking"; round: number; port: number | null} // told the app; waits for its port
	| {at: "waiting"; round: number; state: string; waitMs: number} // the URL is out
	| {at: "trading"; round: number} // code + verifier -> pass
	| {at: "signed"; round: number; scopes: readonly string[]; refreshInMs: number; turn: number}
	| {at: "refreshing"; round: number; turn: number}
	| {at: "ending"; why: Why} // revoke (RFC 7009), clear the vault
	| {at: "ended"; why: Why; revoked: boolean};
```

The branches that hold the rules:

```ts
code: (s, m) =>
	s.at !== "waiting" ? same(s)                       // a code after that is dropped: one trade
	: m.state !== s.state ? ending("state_mismatch")
	: [{at: "trading", round: s.round}, [trade({code: m.code, client: m.client})]],

refresh_err: (s, m) =>
	s.at !== "refreshing" ? same(s)
	: m.error._tag === "no_renewal"                    // way (b): no refresh token was given
		? [{at: "asking", round: s.round + 1, port: null}, [want({round: s.round + 1})]]
		: ending("refresh_refused"),
```

```ts
replay(signIn, {ctx: undefined, msgs: [{type: "catcher", port: 1455}]})
// state {at: "asking", round: 0, port: 1455}
// cmds  [want {round: 0}, offer {port: 1455, round: 0}]
```

Way (c) has its own small machine, `lent` (`lent.ts`). The box never signs in; it asks.

```ts
type Lent =
	| {at: "asking"; turn: number; waitMs: number | null} // asked the app for pass `turn`
	| {at: "opening"; turn: number} // opens the sealed pass into the vault
	| {at: "holding"; turn: number; renewInMs: number} // a timer asks for the next one
	| {at: "ending"; why: LentWhy} // clears the vault; nothing to revoke
	| {at: "ended"; why: LentWhy};

pass: (s, m) =>
	s.at === "asking" && m.turn === s.turn             // only the pass asked for, once
		? [{at: "opening", turn: s.turn}, [open({turn: m.turn, sealed: m.sealed, expires_in: m.expires_in})]]
		: same(s),
renew_due: (s, m) =>
	s.at === "holding" && m.turn === s.turn
		? [{at: "asking", turn: s.turn + 1, waitMs: null}, [ask({turn: s.turn + 1})]]
		: same(s),
```

The seal (`seal.ts`) has HPKE's shape (RFC 9180, base mode): a fresh ECDH P-256 key for each
message, HKDF-SHA256, AES-256-GCM, with `box/turn` bound into the key and the tag. It is
hand-made on Web Crypto, which a box, a Worker and the app all have. A real build would use an
HPKE library. The box's private key is made non-extractable, so no code in the box can export it.

## 3. What the fake run found

`node experiments/154-sign-in-remote.ts` (boxes as processes, 59 s) and `... docker` (each box in
its own container, the local twin of a Cloudflare container, 86 s). Every check passed in both
modes. The pass is 56 characters long because the fake makes it that long; the real length is to
fill after the live run. The fake's pass lives 4 s, so refreshes and renewals happen inside a
5 s hold.

| Check | Process | Docker |
|---|---|---|
| Signs in, refreshes while held, answers ("Hi there", 12 in, 2 out), forgets | ok, 0.8 s to sign in, 2 refreshes | ok, 1.4 s, 2 refreshes |
| The agent's commands find no pass and no refresh token | ok (same user; files and `ps -E`) | ok (uid 1001, 6,667 files; the box's environment and memory refused: EACCES) |
| Ending revoked every refresh token of the box | ok | ok |
| Wrong verifier refused; code used twice refused and its pass revoked; S256 is real | ok | ok |
| A forged code with another state: the app refuses it, the box ends | ok | ok |
| Denied; nobody answers (timed out) | ok | ok |
| Two boxes at once: two new clients, ports 1455 and a free one | ok | ok |
| A saved client: no new client, no name hint, two passes that do not spoil each other | ok | ok |
| A phone: the pasted callback works; a tampered one is refused | ok | ok |
| Told to end: revokes at once (0 refresh tokens live after) | ok | ok |
| **Finding:** killed with SIGKILL, no forget runs, 1 refresh token stays live at the server | 1 | 1 |
| A grant without `chatgpt.tokens.use.direct` is not kept, and is revoked | ok | ok |
| Port 1455 taken: another loopback port, signed in | ok | ok |
| Control: the probe does find a pass when it may read one | a planted file | root reads the box's memory: 6 pass hits, **6 refresh-token hits** |
| Way (b): no refresh token at all; asked again when the pass runs out | 3 sign-ins, 3 clicks, 0 refresh tokens, 1 client | the same |
| **Finding,** way (b): nothing to revoke; the last pass lives out its life | live after end | live after end |
| Way (c): one sign-in lends two boxes passes across expiry | 1 sign-in, 1 refresh, 8 passes lent | 1 sign-in, 2 refreshes, 9 lent |
| Way (c): the agent's commands find no pass and no refresh token | ok | ok |
| Way (c): the ledger holds only sealed passes; no refresh token reaches a box | ok, 8 rows | ok, 9 rows |
| **Finding,** way (c): a box's end leaves its last pass live; the person's revoke kills every pass lent | live, then 0 | live, then 0 |
| Way (c): a sealed pass opens only in its own box, for its own turn | ok | ok |
| Way (c) control: the box's own user finds the pass, never a refresh token | 0 refresh | root: 6 pass hits, **0 refresh** |
| No pass, refresh token or verifier in ledger rows, logs or any file of the run | 29 places, 27 files | 27 places, 25 files |

- **Codes are on the ledger, on purpose.** The leak search found sign-in codes in 14 ledger rows
  and in the ledger's write-ahead file. A code is worth nothing without the box's verifier, which
  never leaves the box, and it works once.
- **The two control rows are the point of the comparison.** Whoever can read a way (a) box's
  memory finds the refresh token there (6 hits). In way (c) the same reader finds the short pass
  and no refresh token, because none was ever there.
- On a Mac the agent's commands run as the same user as the box, and another process's memory is
  not read (that takes debugger rights). So on a Mac "found nothing" covers files and
  environments only. Docker covers memory too.

## 4. Where the renewal key lives: three ways

| | (a) The box refreshes | (b) No renewal key | (c) The person's app lends passes |
|---|---|---|---|
| What the box holds | access + refresh token | access token only | access token only, one at a time |
| Longest life of what the box holds | refresh token: 30 days, renewed on each use | 1 hour | 1 hour |
| Clicks for the person | one per box | one per box, then one an hour | one per person, then none |
| The person's machine must be on | at the start | at the start and each hour | at the start and about each hour |
| A killed box leaves behind | a live 30-day refresh token | a pass, under an hour | a pass, under an hour |
| Connected apps in ChatGPT | one client per first sign-in, unless a saved client is reused | the same | one, the person's app |
| Revoke at the end | the box, RFC 7009 | nothing documented to revoke | the app, RFC 7009, when the person is done |
| Fake run | all pass | all pass | all pass |

The token lives are OpenAI's ([token
reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)): "Access
tokens are valid for one hour (`expires_in: 3600`)" and "Refresh tokens are valid for 30 days".

**Lean: way (c).**

- **Why.** It is the only way where nothing that outlives a box is ever in a box. A box's worst
  case is one pass, under an hour. The login itself stays where the direction put it
  ([logins never leave a person's
  machine](../docs/direction/agents-behind-one-service.md#logins-never-leave-a-persons-machine)):
  on the person's machine. It also fits OpenAI's own
  advice for remote boxes: their self-hosted VM page has the person sign in on their own computer,
  because "A 127.0.0.1 callback reaches the computer running the browser, not the remote VM". One
  sign-in per person, not per box, means one connected app in ChatGPT, and "serialize refreshes
  for the same session" is easy: there is one place that refreshes.
- **Cost.** The person's app must be running for a box to start and about once an hour after
  that, or the box stops at the end of its pass. The app needs a keychain for the refresh token
  (here it sits in memory, as a stand-in). About 560 lines over way (a): the lender, the seal, the
  second machine and its cells. Ending a box cannot kill its last pass; only the person's revoke
  does, and that kills every box's pass at once. All boxes of one person share one access token
  at a time.
- **Against the direction as written.** The direction's own shape runs the job on the person's
  machine, which needs no pass to leave it at all. Way (c) is for the case where the job must run
  in a remote box: the login stays home, and an hour's pass goes out. Whether a remote box is
  wanted at all is the direction's call, not this experiment's.
- **Confidence: about 75%.** The doubts, and what would settle each:
  - Whether a SIWC access token works from a host other than the one that signed in. The docs'
    VM page moves a whole session to another machine and says "Host-specific usage attribution and
    revocation of ChatGPT plan access for transferred sessions are not yet available", which reads
    to me as: it works, and is not yet tied to a host. The live run with `--way c --remote` settles
    it: the app signs in on the Mac, the pass is used from a Docker container.
  - Whether a friend's box on another person's Cloudflare account is "a remote runtime only that
    user controls". My reading: no, not if the account owner can reach the container. That is a
    question for OpenAI, not a test; way (c) shrinks what is exposed but does not answer it.
    Running each friend's box on that friend's own account would.
  - Whether "Use the user's plan only for the application they connected" lets one person's app
    lend to several boxes of the same project. My reading: yes, it is one application. Not
    stated.

Way (a) is the simplest and works today (all checks pass). It is the right fallback for a box the
person fully controls, on their own account. Way (b) is weaker than both: an hourly click, and it
depends on an undocumented grant without `offline_access`.

## 5. What OpenAI's docs say

Pages read on 2026-10-26. Quotes are OpenAI's; lines marked "My reading" are mine.

- **Can Codex app-server run on a SIWC pass?** Yes. "Configure Codex app-server to use an OAuth
  access token authorized for ChatGPT plan usage" and "No separate Codex sign-in is required". The
  pass goes into the app-server's own environment (`env_key = "ACCESS_TOKEN"`,
  `requires_openai_auth = false`), and a new pass means restarting it and `thread/resume`
  ([codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)).
  My reading: in a box, the pass then sits in the agent's own environment, which this experiment's
  box avoids. Way (c) fits it well (a restart about once an hour); way (a) needs the box to restart
  the app-server on each refresh.
- **Can the approval tap come from a phone?**
  - Non-loopback redirect: no. "Use an HTTP loopback callback on `127.0.0.1` from initial
    registration onward", and on later sign-ins "only the port may vary"
    ([registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)).
  - Device grant (RFC 8628): not documented for SIWC. The Codex CLI has its own
    `codex login --device-auth` ([auth](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)),
    a different flow.
  - Pasted redirect: not documented. Built and tested here: the phone's browser lands on a
    loopback address that goes nowhere, the person pastes that URL into the app, and the app checks
    its state. My reading: it is standard OAuth on the wire, but OpenAI does not describe it.
- **Does each box show up as a new connected app?** Not stated. A first sign-in with
  `dynamic_agent_client` "returns code, state, and the issued client_id", and the issued id is
  per ChatGPT account and is to be reused. Users "manage each app's access to their ChatGPT plan"
  in ChatGPT Settings ([accounts and
  sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)).
  My reading: a box that registers anew each time could show up as a new app each time; reusing
  the saved client id, or way (c), avoids it. The live run can look in ChatGPT Settings.
- **Is there a revoke endpoint?** Yes. The `revocation_endpoint` in
  `https://auth.openai.com/.well-known/openid-configuration`, with `token=<REFRESH_TOKEN>`,
  `token_type_hint=refresh_token` and the issued client id; an empty 200
  ([accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)).
  Only refresh-token revocation is documented. Also: "OpenAI does not currently notify your tool
  when a user disconnects the app"
  ([errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)).
- **Do the terms cover a friend's box on someone else's Cloudflare account?** Not directly. The
  terms (the page refused our fetch; quoted from search results and experiment 152): "Requests
  must originate from the user's local runtime or a remote runtime only that user controls" and
  "Use the user's plan only for the application they connected"
  ([terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)). The overview covers "open-source
  and locally hosted apps", and "If you're interested in offering it in a paid or remotely hosted
  app, complete the interest form" ([overview](https://developers.openai.com/siwc/token-sharing-open-source)).
  My reading: a box on the friend's own account fits; a box on another person's account does not
  clearly fit, whichever way the key lives.
- **Is there a storage rule?** Yes. "Any persistent storage of Authentication Tokens must be local
  and under the user's control" (terms), and store credentials with mode 0600, "never commit or
  log them" (registration and sign-in page). The CI page says "Use one `auth.json` per runner or
  per serialized workflow stream" and "Do not share the same file across concurrent jobs or
  multiple machines" ([CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)). Way (c)
  stores nothing in a box; way (a) and way (b) keep the pass in memory only.
- **Can a grant leave out `offline_access`?** Not documented either way. The scope list in the
  docs always has it. Way (b) depends on this; the live run with `--way b` will show whether a
  refresh token still comes back.

## 6. The Cloudflare path

`cloud/worker.ts` follows experiment 148: one Durable Object per box starts the container, with
`enableInternet: true`, since 148 found that Cloudflare's only HTTPS lock ends TLS in our Worker,
which would put the pass in the shared side's hands. The box's calls to `http://ledger.internal`
are caught outside it by `LedgerDoor`, which stamps the writer and lets a box register its own
name, read its own inbox and write to its person's inbox, nothing else. `RENEW` and `PASS_FROM`
pick the way.

```sh
cd experiments/154-sign-in-remote/cloud
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID WRANGLER_SEND_METRICS=false \
  ../node_modules/.bin/wrangler deploy --dry-run --outdir ../dist
# Total Upload: 1009.21 KiB / gzip: 207.61 KiB, and the image builds; nothing is uploaded
```

The local twin is the same Docker image with the Miniflare ledger, which is what Docker mode
runs. A `wrangler dev` run of the Worker with its container was not done.

## 7. The live run (to fill after it)

For the owner, at the laptop. It is a real sign-in with OpenAI, so it is not run by the agent that
built this. It prints only: that the sign-in URL was opened, the pass's length, `expires_in`, the
scopes, whether a refresh token was given, one answer's short text with its token counts, and
"forgotten".

```sh
# once: the box's own deps, and the image for --remote
(cd experiments/154-sign-in-remote && pnpm install --ignore-workspace)
node experiments/154-sign-in-remote/build.ts

env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
  node experiments/154-sign-in-remote.ts live --local --way a   # then --way b, --way c, and --remote
```

- **What the owner does:** close any Codex CLI login first, so port 1455 is free (another port is
  used if not). A ChatGPT page opens in the browser; click Allow. Nothing else.
- **What it answers:** way a, the real pass length and scopes; way b, whether a grant without
  `offline_access` is given and with or without a refresh token; way c with `--remote`, whether a
  pass made on the Mac works from a container. Then look in ChatGPT Settings for how many apps
  show up.

| Way | Pass length | `expires_in` | Refresh token given | Answer and tokens | Apps in Settings |
|---|---|---|---|---|---|
| a, local | to fill | to fill | to fill | to fill | to fill |
| b, local | to fill | to fill | to fill | to fill | to fill |
| c, remote | to fill | to fill | (stays in the app) | to fill | to fill |

## What this cannot tell us

- **Nothing here touched OpenAI.** Every behavior of the server is the fake's, built from the docs.
  Where the docs are silent (a grant without `offline_access`, a pass used from another host, how
  apps show up in Settings), the fake picked an answer and the live run must check it.
- **The terms question is not a test.** No run can say whether a box on someone else's account is
  "a remote runtime only that user controls".
- **Memory on a Mac was not read.** The Mac probe covers files and process environments only.
  Docker covers memory, as another user and, in the control, as the box's own user.
- **The seal is hand-made.** It has HPKE's shape and passes its tests here; it is not an audited
  HPKE build.
- **The keychain is a stand-in.** The person's app holds the refresh token in memory. A real app
  would need the OS keychain, and that part was not built.
- **No real Cloudflare container ran.** The Worker was bundled, not run, and `wrangler dev` was
  not tried.
- **Small numbers.** One run per mode, a pass that lives 4 s, at most two boxes at once.

Node at the edge, said here: `node:http` for the fake server and the app's loopback catcher (one
exact port, and "taken" told apart), `child_process` to start boxes, `fs` for the leak search.
Everything else is Effect and Web Crypto.

## Running it

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/154-sign-in-remote.ts
# docker: build the image first with node experiments/154-sign-in-remote/build.ts, then add `docker`
```

Runs write under `runs/exp-154/` (ignored by git) and save `results/154-sign-in-remote.json` and
`results/154-sign-in-remote-docker.json`.
