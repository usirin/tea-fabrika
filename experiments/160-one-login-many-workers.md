# 160: One login, many Codex jobs at once

**Answer: yes, on fakes.** Four Codex jobs of one person ran at the same time.
One login manager held the refresh token, and each job got only access
tokens. When the access token ran out under all four at once, the manager made
**one** refresh and all four jobs went on. Over 3 rounds: 12 of 12 jobs right,
3 refreshes in all, no dead login. Each job lost about 12 ms to the refresh.
No job ever saw the refresh token.

- **The jobs are the real `codex app-server`** (codex-cli 0.165.0) in its
  experimental `chatgptAuthTokens` mode. The model and the token server are
  experiment 157's fakes.
- **Both guards are needed.** With the manager's guards off, all four jobs
  sent the same refresh token. The fake killed the login, and 0 of 12 jobs
  finished. That is 157's copied-file case again.
- **A refresh slower than 10 s still worked,** but it cost 12 s. app-server
  gave up on the first answer after about 10 s and asked again. The manager
  answered the second ask with the same refresh, so no second refresh was
  spent.
- **How sure: 80%** that this shape holds against the real servers. The
  app-server half is real; the token server half is a fake. What would settle
  the rest is under "What it cannot tell us".

```ts
// The whole idea, from lib/login-manager.ts, shortened.
// A job's token `stale` was refused. One refresh at a time; a late ask gets the newer token.
const renew = (stale: string) =>
	permit.withPermit(
		Effect.gen(function* () {
			const held = yield* live;                              // fails if the login is dead
			if (held.grant.accessToken !== stale) return held.grant; // someone renewed already
			return yield* spend(held);                             // the one real refresh
		}),
	);
```

## Who did what

- **This repo's code:** the login manager (`lib/login-manager.ts`), the driver
  that starts each `codex app-server` and answers it, and a small proxy in
  front of the fake that holds calls so the expiry lands on all jobs at once.
- **Real program, unchanged:** `codex app-server` from codex-cli 0.165.0, one
  process per job, each with its own throwaway `CODEX_HOME`, deleted after.
- **Faked:** the model server and the token server, from experiment 157
  (`157-login-stays-home/fake-openai.ts`), unchanged. Every login is fake.
- **Today's fabrika:** none. No agent of today's fabrika, no ledger.
- **Cost:** $0. No call went to OpenAI, nothing signed in, nothing was
  deployed. The laptop's own Codex and Claude folders were not read.
- **Runs:** five full runs of every case while the script grew, 2 min 2 s
  each, the same outcome each time. The numbers below are from the last run,
  on the code as committed. The median time a refresh added was 9 to 12 ms
  across the runs.

## The machine

One manager per person. It is the only thing that holds the refresh token.
Each job is one `codex app-server` that the manager feeds.

```ts
// lib/login-manager.ts: what the manager holds. A dead login holds no token.
type Login =
	| {kind: "live"; grant: Grant; refresh: Redacted<string>}
	| {kind: "dead"; status: number};

// What a job gets: the answer app-server wants to `account/chatgptAuthTokens/refresh`.
const Grant = Schema.Struct({
	accessToken: Schema.String,
	chatgptAccountId: Schema.String,
	chatgptPlanType: Schema.NullOr(Schema.String),
});
```

Each job talks JSON-RPC over stdio. These are the four steps the driver sends,
and the one ask app-server sends back when its token is refused:

```jsonc
// driver -> app-server
{"method": "initialize", "id": 1, "params": {"clientInfo": {...}, "capabilities": {"experimentalApi": true, "requestAttestation": false}}}
{"method": "account/login/start", "id": 2, "params": {"type": "chatgptAuthTokens", "accessToken": "<access>", "chatgptAccountId": "acct-...", "chatgptPlanType": "plus"}}
{"method": "thread/start", "id": 3, "params": {"model": "gpt-6-luna", "cwd": "...", "approvalPolicy": "never", "sandbox": "workspace-write", "ephemeral": true}}
{"method": "turn/start", "id": 4, "params": {"threadId": "...", "input": [{"type": "text", "text": "Run the check ... [[run:together-r1-1]]", "text_elements": []}]}}

// app-server -> driver, after the model host answered 401. Seen as sent:
{"method": "account/chatgptAuthTokens/refresh", "id": 0, "params": {"reason": "unauthorized", "previousAccountId": "acct-b1c38f9b5a09"}}
// driver -> app-server: the manager's answer. Only an access token, never the refresh token.
{"id": 0, "result": {"accessToken": "<new access>", "chatgptAccountId": "acct-...", "chatgptPlanType": "plus"}}
```

- **The ask does not say which token failed.** It carries only the account id.
  So the driver remembers the last access token it gave each job and passes
  that to `renew` as `stale`.
- **Codex was pointed at the fakes by config,** the same way as in 157:
  `chatgpt_base_url` and a `model_providers.chatgpt` block with a `base_url`
  on the proxy. `cli_auth_credentials_store = "file"`, so nothing goes to the
  laptop's keychain. Apps, plugins and analytics off.
- **Codex's own refresh path went to a trap.**
  `CODEX_REFRESH_TOKEN_URL_OVERRIDE` named a path on the proxy that counts
  calls and refuses them. It was called 0 times: in this mode Codex does not
  refresh by itself.

### How the expiry lands on every job at once

- The first access token lives 10 s. Each job makes its first model call well
  inside that (0.1 to 0.3 s after the sign-in) and gets a tool call back.
- The proxy holds each job's second model call until all of them are waiting
  and the token has run out. Then it lets them go together (or 400 ms apart,
  in the staggered case).
- The fake then refuses each one with 401, as a real expired token would be.
  Nothing in the fake was changed for this.

## What came back

| Case | Jobs at once | Jobs right | Real refreshes | Login killed | Time the refresh added |
|---|---|---|---|---|---|
| 157, copied `auth.json` (queue off) | 2 | 0 of 2 | 1, then a reuse | yes | none: both died |
| 157, the queue | 1, the second waits | 2 of 2 | 1 | no | the second job waited 14.4 s |
| 160, one manager, all asks at once | 4 | 12 of 12 | 1 a round, 3 in all | no | median 12 ms, worst 43 ms |
| 160, one manager, asks 400 ms apart | 4 | 12 of 12 | 1 a round, 3 in all | no | median 7 ms, worst 30 ms |
| 160, the manager's guards off | 4 | 0 of 12 | 1 a round, then a reuse | yes, every round | none: all died |
| 160, a refresh 12 s late | 1 | 1 of 1 | 1 | no | 12.0 s |

"Time the refresh added" is, for each job, the time from the 401 it got to its
next model call with a new token.

### All asks at once

- The four asks reached the manager within 2 to 6 ms of each other.
- The manager counted 4 asks a round: 1 spent the refresh token, 3 got the
  newer token without a refresh. The refresh itself took 2 to 6 ms on the
  fake.
- Every job's next call carried generation 2, the refreshed token, and was
  answered.

### Asks 400 ms apart

- The first ask spent the refresh. The next three came after it had finished,
  saw that their token was older than the one held, and got the new one at
  once. Still one refresh a round.
- This is the case a lock alone would get wrong. A lock without the "is it
  newer" check would make each late ask spend a refresh of its own: four
  rotations where one is enough. Not run; it follows from the code. On the
  fake that is only waste; on a server with a limit it is risk.

### The guards off, on purpose

- Every ask spent the refresh token the manager held at that moment. Three
  or four spends went out within 3 ms, three of them with the same token. (A
  fourth ask found the login already dead and spent nothing.)
- The fake answered: 1 ok, 1 reuse (the login family dies here, as RFC 9700
  section 4.14.2 says), then 1 or 2 refused because the family was already
  dead. In two rounds the last spend carried the new refresh token, and it
  was refused too: it belonged to the dead family.
- **Even the job whose refresh came back ok failed.** Its next model call
  carried the new token, and the fake refused it: the whole family was dead.
  157 saw the same with two boxes.
- app-server asked each refresh twice, about 200 ms apart, then ended the turn
  with `auth refresh request failed: code=-32000`. 8 asks a round.

### A refresh slower than app-server waits

The manager waited 12 s before each refresh, on one job.

- At 10.2 s app-server sent the refresh ask.
- About 10.2 s later it stopped waiting, sent the model call again with the
  old token, got 401 again, and asked again.
- The second ask waited behind the first one's lock. When the first refresh
  came back, the second saw a newer token and took it: 1.8 s, no second spend.
- The job finished right. The cost was 12.0 s, not a dead login.
- The about 10 s limit matches OpenAI's app-server page. We did not test a
  manager slower than two such rounds.

### Does a job ever see the refresh token?

No. Counted, never printed, over 37 jobs:

| Where we looked | Refresh tokens | Access tokens |
|---|---|---|
| Everything on each job's stdio, both ways | 0 | 2 a job, by design: the sign-in and the refreshed one |
| Every request a job sent to the model host, headers and body | 0 | (each call's bearer, by design) |
| Every file in each job's folder: its home, its copy of the project, its temp folder | 0 | 0 |

- **No `auth.json` was written.** In this mode app-server kept the access
  token in memory. About 60 files were left in each home (state databases,
  logs, system skills), with no token in any.
- **This is by construction, and the count checks it.** The refresh token
  lives only in the manager's process, inside an Effect `Redacted`, and goes
  out only to the token server.

### Other calls Codex made

Each job, at start, called three paths besides the model:
`/backend-api/wham/accounts/check`, `/backend-api/codex/models` and
`/backend-api/wham/settings/user`. The fake answered 404 to all three, and the
jobs did not mind. On the real server these carry the access token too.

## What this means for the settled direction

[Where a person's login lives](../docs/direction/agents-behind-one-service.md#where-a-persons-login-lives)
(ruled 2026-10-26) says Codex runs one job per person at a time, because
`auth.json` is lent to one box. This experiment shows a way to lift that limit,
**if** the manager can run where the direction allows a login to be:

- **On the person's own machine:** fits "logins never leave a person's
  machine". Several app-servers on that machine, one manager. Cost: jobs run
  only while the machine is on.
- **In one box that runs several jobs:** fits "the box holds the login". The
  manager and four app-servers in one box. Cost: the jobs share one box.
- **In the locker (our Durable Object):** does **not** fit. Our code would
  then hold and spend a real refresh token, which experiment 148's rule bars
  ("our Worker never sees a real token").

This write-up does not change the direction. It is a measurement the owner
can use if the one-job limit starts to hurt.

## Recommendation

**Lean: keep this as the known way to run several Codex jobs for one person,
and do not build it yet.** Why: it works with the real app-server, it costs
about 12 ms a refresh instead of a whole job's wait, and the manager is about
150 lines with its comments. What it costs: it depends on an experimental app-server mode, and
OpenAI's page says app-server authentication "has never been permitted for
commercial or hosted services". Confidence 80% that it holds on the real
servers; 60% that it is allowed for how we would use it.

1. **If built, keep both guards: the lock and the "is it newer" check.** The
   lock alone holds the login but spends a refresh per late ask. No lock
   killed the login in 3 rounds of 3. Confidence 90%.
2. **Answer the refresh ask in under 10 s, or expect a 10 s stall.** The
   manager should never wait on anything slow before it refreshes. Confidence
   85%; the real token server's speed was not measured.
3. **Ask OpenAI before any live use.** The hosted-use line is theirs to read,
   and it is not ours to resolve here.

## What it cannot tell us

- **The real servers.** The token server and the model server are fakes. We
  do not know whether `auth.openai.com` rotates and kills a family on reuse
  the way the fake does, whether it has a grace window for a token used twice
  within seconds, or whether the ChatGPT backend accepts one access token
  from four sessions at once.
- **How long a real access token lives.** The fake gives one hour, from
  OpenAI's token reference. If it is shorter, the manager refreshes more
  often; with the guards that should not matter, but it was not measured.
- **Who may refresh.** The manager refreshes with a client id. A real manager
  would sign in through Codex's own flow and refresh with Codex's client id.
  Whether a host app may do that is OpenAI's call.
- **Whether this is allowed at all.** OpenAI's app-server page: "App-server
  authentication has never been permitted for commercial or hosted services."
  Our use would be a person's own plan, for their own private work, run by
  their own copy of fabrika. Whether that counts as "hosted" is not resolved
  here.
- **An experimental mode.** `chatgptAuthTokens` needs
  `capabilities.experimentalApi`. Its shape may change in any Codex release.
  This ran on 0.165.0 only.
- **One kind of job.** Each job was one short turn with one tool call on
  `fixtures/format-bytes`. Long turns, several turns, or a refresh during a
  stream were not tried.
- **A refresh the manager starts on its own.** app-server's docs say a host
  may also push new tokens with `account/login/start` before they run out.
  That would save the 401 round. Not tried.
- **A laptop's numbers.** All on 127.0.0.1. Real network time to the token
  server comes on top of the 12 ms.

## Files and how to run

- `160-one-login-many-workers.ts`: the driver, the proxy and the leak count.
  Cases: together, staggered, loose, slow.
- `lib/login-manager.ts`: the login manager, in Effect.
- `157-login-stays-home/fake-openai.ts`: the fake model and token server,
  used as it is.
- `results/160-one-login-many-workers.json`: every case's answer.

```sh
# Runs ~/.local/bin/codex, or CODEX=<path>. Each job gets a throwaway CODEX_HOME under tmp/exp160,
# deleted at the end (KEEP=1 keeps it). CASES=together,slow picks cases; ROUNDS=3 by default.
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 \
  node experiments/160-one-login-many-workers.ts
```
