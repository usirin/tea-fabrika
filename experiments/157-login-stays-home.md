# 157: The login lives in the person's own locker

**Answer: it works on this laptop, with fake logins, built the way others
already do it.** Each person has a locker: one Durable Object holding their
Claude token and their Codex `auth.json`, both sealed with a Worker secret.
The box is a container started through Cloudflare's Sandbox SDK shape, with no
internet; every call it makes lands in the Worker's Outbound handler, which is
the allow list.

- **Claude Code follows Cloudflare's own tutorial.** The box holds a
  placeholder; the Outbound handler adds the locker's token on the way out. The
  token it adds showed up 0 times in any box.
- **Codex follows OpenAI's CI page as written.** The locker lends `auth.json`
  for one job, Codex refreshes it inside the box, and the locker takes back the
  refreshed copy. The next job works. A second job of the same person waits.
- **What breaks:** a box that dies after its refresh and before it gives the
  login back leaves a dead login, as expected. The smallest fix that held: the
  Outbound handler, which already sits on the refresh path, keeps each refresh
  answer in the locker before the box sees it.

```ts
// The whole idea, from worker.ts, shortened.
// Claude: the box sends "box-holds-no-key"; the handler swaps in the locker's token.
const token = await env.LOCKER.getByName(props.person).claude(props.box);
return fetch(ANTHROPIC + url.pathname, {headers: claudeHeaders(req.headers, token), body});

// Codex: the box's object lends auth.json for one job, then takes back what Codex left.
const lent = await locker.lend(box, true);            // waits while another job holds it
await files.writeFile(`${codexHome}/auth.json`, JSON.stringify(lent.auth));
await container.exec(["codex", "exec", ...]);         // may refresh inside the box
await locker.back(box, JSON.parse(await (await files.readFile(`${codexHome}/auth.json`)).text()));
```

How we got here, one line each:

- **The laptop line was tried and dropped.** The Worker held a line open to
  the person's laptop, and the laptop added the login. It needs the laptop
  awake for every model call.
- **A middle shape ran and was set aside.** The locker refreshed the Codex
  login itself and handed the box only a one-hour pass. It worked on the
  fakes, but nobody else runs Codex that way, so we took the shape OpenAI
  documents.
- **Claude follows Cloudflare's tutorial**
  ([Claude Code in a sandbox](https://developers.cloudflare.com/sandbox/tutorials/claude-code/)):
  a placeholder in the box, the token added by the Worker on the way out.
- **Codex follows OpenAI's CI page**
  ([CI/CD authentication](https://developers.openai.com/codex/auth/ci-cd-auth)):
  `auth.json` in before the job, the refreshed copy out after. The page says
  "Do not use this workflow for public or open-source repositories."

**This is the proposed change to a decided note.**
[Logins never leave a person's machine](../docs/direction/agents-behind-one-service.md#logins-never-leave-a-persons-machine)
(decided 2026-10-26) says "The shared fabrika stores no provider login, no
key, no token, for anyone." The same section now carries a proposed change:
each person's login in their own locker on the shared Cloudflare account,
tested here. This write-up does not rewrite the note; the recommendation
below says what the rewrite should hold.

## Who did what

- **This repo's code:** the Worker, the locker, the box object, the Outbound
  handler, both fake servers and the driver.
- **Real programs, unchanged, in the boxes:** Codex 0.163.0 and Claude Code
  2.1.310, from npm.
- **Cloudflare's local twin:** `wrangler dev` 4.153.0 (workerd) with Docker
  for the boxes, through the container API that Sandbox SDK 1.0.3 uses.
- **Today's fabrika:** none. No agent of today's fabrika, no ledger.
- **Cost:** $0. Every login is fake. No call went to an OpenAI or Anthropic
  host, nothing signed in, nothing was deployed.
- **Run:** one full run of every step, 3 min 3 s once the box image was built.
  The first build takes about 2 to 3 minutes. Two earlier runs found the bugs
  told below.

## The machine

Three parts in one Worker. The person's app talks to the front door with the
person's own key. Everything else is inside.

```ts
// worker.ts, the parts and who talks to whom.
// person's app --key--> POST /login ------------------------------> Locker "a"
// Box "a-1" ----Files: auth.json in, then out --------------------> Locker "a"
// container --anthropic.internal--> Outbound {person: "a"} --token-> fake Anthropic
// container --chatgpt.internal----> Outbound --as sent------------> fake OpenAI
type Props = {readonly person: string; readonly box: string; readonly catch: boolean};
// The box's object sets the props. The box cannot change them.
```

The locker keeps both logins sealed (AES-256-GCM, one key per person from the
Worker's secret, the person and the provider bound into the seal), and one
Codex loan at a time. The loan lives in storage, not in memory. Why is told
under "The local twin and the cloud".

```ts
// worker.ts, Locker, shortened.
type Loan = {readonly box: string; readonly caught: boolean};

async lend(box: string, queue: boolean) {
	if (!(await this.boxIs(box, "codex"))) return null;           // not this person's Codex box
	const t0 = Date.now();
	while (queue && (await this.loan()) !== null) await new Promise((r) => this.line.push(r));
	await this.store.put("loan", {box, caught: false});           // taken before any other wait
	return {auth: await this.get("codex"), waitedMs: Date.now() - t0};
}

async back(box: string, auth: unknown) {
	const loan = await this.loan();
	if (loan?.box !== box) return "not the box that holds the loan";
	if (!loan.caught) await this.put("codex", auth);   // the box's copy, refreshed or not
	await this.release();                              // the next job in line goes
	return loan.caught ? "kept the caught copy" : "kept";
}
```

The Outbound handler is the allow list (`gate.ts`). A call off the list gets
403. On the list, it does one of three things.

```ts
// gate.ts: every host and path a box may reach. Anything else: 403.
// anthropic.internal  POST /v1/messages?beta=true, two Haiku models, max_tokens up to 64,000
//                     -> the box's credentials dropped, the locker's token added
// chatgpt.internal    POST /backend-api/codex/responses, one model
//                     -> passed on as sent: the box holds its own lent auth.json
// auth.internal       POST /oauth/token
//                     -> passed on; with the fix, the answer goes to the locker first
```

```ts
// worker.ts, Outbound, the fix on the refresh path.
const res = await fetch(`${env.OPENAI_UP}${url.pathname}`, {method: "POST", headers, body});
if (route.kind === "token" && props.catch && res.ok) {
	const answer = await res.text();
	await locker.caught(props.box, JSON.parse(answer));   // the locker holds the new tokens now
	return new Response(answer, {status: res.status});    // then the box gets them
}
```

## How Codex was pointed at the fakes

Codex reads its ChatGPT login from `auth.json` in `CODEX_HOME`. Three settings
and one environment variable send every call to a made-up name, which the
Outbound handler catches.

```toml
# CODEX_HOME/config.toml, written into the box before each job.
cli_auth_credentials_store = "file"
chatgpt_base_url = "https://chatgpt.internal/backend-api/"
model_provider = "chatgpt"
[model_providers.chatgpt]
name = "chatgpt"
base_url = "https://chatgpt.internal/backend-api/codex"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
stream_max_retries = 1
[analytics]
enabled = false
[features]
apps = false
plugins = false
```

```sh
# The job's environment.
CODEX_HOME=/work/<run>/home/.codex
CODEX_REFRESH_TOKEN_URL_OVERRIDE=https://auth.internal/oauth/token
SSL_CERT_FILE=/etc/cloudflare/certs/cloudflare-containers-ca.crt   # the platform's CA for HTTPS
```

- **The fake login looks like a real one.** `auth_mode: "chatgpt"`, an id
  token and an access token as JWTs, and a refresh token. The access token's
  `exp` is set in the past, so Codex refreshes before its first call and
  writes the new tokens into `auth.json`, as it does for real.
- **The fake rotates refresh tokens.** Each refresh token works once. A second
  use kills its whole family, and the person must sign in again. That is
  OAuth's reuse rule
  ([RFC 9700, 4.14.2](https://www.rfc-editor.org/rfc/rfc9700#section-4.14.2)).
  New access tokens live one hour, as OpenAI's
  [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
  says.
- **Apps, plugins and analytics had to go off.** With them on, Codex called a
  host that was not on the list and asked for tools through
  `/backend-api/ps/mcp`, which set off a run of refreshes. With them off,
  Codex called the model, the refresh, and a list of models, which is refused
  and does no harm.
- **Claude Code needed less.** `ANTHROPIC_BASE_URL=https://anthropic.internal`,
  `CLAUDE_CODE_OAUTH_TOKEN=box-holds-no-key` and the CA. On Cloudflare the
  catch would name `api.anthropic.com` and no base URL would be set.

## What came back

Every job worked on the same toy project (`fixtures/format-bytes`): the fake
model asks the agent to run a check, and the job is right when the answer
says what the check printed.

### Claude: the box never saw the token

- One job, ok and right, 15.0 s.
- The fake saw a's token on both calls (a tool call, then the answer).
- a's fake Claude token showed up **0 times** in any box, across 18 boxes:
  their files under `/work`, `/root` and `/tmp`, and every process's
  environment and command line.

### Codex (a): refresh in the box, take back, next job works

- First job: Codex refreshed inside the box (one refresh, ok), the job was
  right, 10.1 s. The locker took back the refreshed copy: `"kept"`.
- Second job: ok and right on the new access token, with no refresh, 4.1 s.

### Codex (b): the box dies after its refresh, before the take-back

The driver waits for the fake to answer the box's refresh, then kills the box.

| | Without the fix | With the fix |
|---|---|---|
| The dying job | died, loan dropped | died, loan dropped |
| What the locker holds | the old refresh token, already used | the new tokens, caught on the way |
| The next job | failed: "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again." | ok and right, 10.5 s, no refresh |
| The login | dead: the person signs in again | alive |

- **Without the fix the login dies, as expected.** The next job sent the old
  refresh token again, the fake saw a second use and killed the family. Codex
  tried three more times and was refused each time.
- **The fix held.** The Outbound handler already sits on the refresh path. It
  hands the refresh answer to the locker first and only then to the box. So
  the window shrinks from the whole job to the few milliseconds between the
  provider's answer and the locker's write.
- **The take-back is still needed for the normal case.** Without the fix
  turned on, it is the only way the new tokens get home. With the fix, the
  locker keeps its caught copy and ignores the box's. That normal path with
  the fix on (a job that refreshes and ends well) did not run in this round.

### Why not a write-back after each turn

The smallest change one might try first is to copy `auth.json` back after
each turn instead of at the end. It was not built. Codex refreshes when its
access token has run out, at the start of a turn. A `codex exec` job is one
turn. So "after each turn" is "after the job", and the window stays the same
size. The catch is the smaller fix.

### Codex (c): a second job of the same person while the first runs

Two jobs, the second started 300 ms after the first.

- **With the queue:** the second job waited 14.4 s, which is how long the first
  ran (14.2 s), then ran on the refreshed login. Both ok and right. One
  refresh, no second use. The locker counted one job queued.
- **With the queue switched off on purpose:** both boxes got the same
  `auth.json` and both refreshed with the same token. The second use killed
  the family, and **both jobs failed**: the one that refreshed first lost its
  new token too. The login was dead.
- So the queue is not optional. It is OpenAI's own rule: "Do not share the
  same file across concurrent jobs or multiple machines."
- **What it costs:** one person runs one Codex job at a time. A second Codex
  sign-in of their own, with its own refresh token, would be a second lane.
  Not tried.

### Two people, two lockers

Four jobs at once: a and b, each with Claude and Codex. All four ok and right.
Each fake call carried its own person's token.

| The wrong ask | Answer |
|---|---|
| a's key names b in the body | 403 |
| b's key asks to run a's box | 403 |
| a's box asks b's locker for both logins | both refused (b's locker counted 2) |
| a's key sends a login marked for b | 403 |
| no key | 401 |
| a's box says it is b: `x-person: b`, a bearer and an `x-api-key` | the call went out on a's token |

The last row is the one that matters most. The handler goes by its props,
which the box's object set, and drops every credential the box sends.

### The allow list, from inside a box

- Refused with 403 by the handler: `example.com` over HTTPS and over HTTP, the
  Codex models list, a GET to the Anthropic host, another model, `max_tokens`
  over the cap, another path on the token host.
- `127.0.0.1:8787` from the box: connection refused.
- Raw TCP to `1.1.1.1`: the connection opens, but only to the local helper.
  Port 443 closed with no answer; on port 80 the helper read the bytes as HTTP
  and the handler answered 403.
- DNS resolves, to the local helper's address.
- Neither fake saw a single call from this probe.

### Time each call adds

- **The whole catch path,** from inside a box to a route the Worker answers
  itself: median 17.4 ms over HTTPS and 27 ms over HTTP, 20 tries each after 5
  warm-ups. We do not know why HTTPS came out faster.
- **The Worker's own part** of a passed-on call (its total minus the fake's
  time, from its log): median 2 ms for Claude (7 calls), 1 ms for Codex (20),
  0 ms for the refresh (16).
- **The locker lookup** inside that: median 1 ms.
- These are a laptop's numbers under emulation (see below). The cloud's were
  not measured.

### Leaks, counted, never printed

| Where | What was looked for | Count |
|---|---|---|
| All 18 boxes | the Claude token | 0 |
| b's boxes | a's Codex tokens | 0 |
| a's boxes | b's Codex and Claude tokens | 0 |
| Claude boxes | any Codex token | 0 |
| a's Codex boxes | a's own Codex tokens | 27, by design |
| Worker log, 27 KB | any fake login; the Worker secret | 0; 0 |
| The object storage folder, 50 files, 5.5 MB | any fake login; the Worker secret | 0; 0 |

**In v1 `auth.json` sits inside the box.** That is OpenAI's CI shape: Codex
reads it from a file and writes the refreshed copy back. Anything in a Codex
box can read its own person's ChatGPT login for as long as the job runs,
refresh token included. The Claude box holds only the placeholder.

## The local twin and the cloud

- **The box runs under emulation.** `wrangler dev` builds the image for
  `linux/amd64`, and this laptop is arm64. Jobs were slow: a Claude job took
  15 s here, 4.8 s live in experiment 148.
- **The local helper image was set by hand.** Wrangler's default did not pull
  here ("cannot overwrite digest"), so `MINIFLARE_CONTAINER_EGRESS_IMAGE`
  names experiment 148's arm64 one. Each box's helper outlives wrangler and is
  removed by the driver.
- **Raw TCP "connects" locally,** to the helper only, and nothing gets out.
  Experiment 148 saw the same.
- **Made-up names locally.** On Cloudflare the catch would name
  `api.anthropic.com`, `chatgpt.com` and `auth.openai.com`. The real hosts
  were not tried, and Codex may call more of them.
- **An idle object loses its memory, here and on the cloud.** In the first
  run the loan lived in memory. During a 10 s Codex job nothing called the
  locker, workerd dropped it, and the take-back was refused as "not the box
  that holds the loan". The locker kept the old refresh token, and the next
  job used it a second time: a dead login, by a road nobody planned.
  Experiment 148 saw an idle object dropped after about 10 s too. The loan and
  the counts now live in storage.
- **Wrangler reloads the Worker when a file in its folder changes,** and a
  run going at that moment fails with 503. Leave the folder alone during a
  run.

## Live-run steps, written, not run

The deploy waits for the owner's yes.

1. Deploy one Worker with the real hosts in the allow list:
   `api.anthropic.com` with the token added, `chatgpt.com` and
   `auth.openai.com` passed on, with the catch. Set the secret with
   `wrangler secret put SECRET`.
2. Each person makes logins of their own for it:
   - `claude setup-token`;
   - `codex login` with `CODEX_HOME` set to a new empty folder and
     `cli_auth_credentials_store = "file"` in its config. A sign-in of its
     own, so the laptop's own Codex login never shares a refresh token with
     the locker.
3. The person's app sends both once, with the person's key, then deletes the
   folder.
4. One job of each, on a private toy repository only, with the same
   count-only checks.
5. Clean up: delete the stored logins, revoke the setup token, sign out the
   Codex sign-in made for this, delete the Worker.

## Recommendation

**Lean: take the proposed change, with four conditions.** Why: it is the
shape Cloudflare and OpenAI document, it ran on the fakes, jobs no longer
need a laptop awake, and every failure found here has a small fix. What it
costs is in "What it cannot tell us". Confidence 70% that it holds on the
real servers; the doubt is how `auth.openai.com` treats a reused refresh
token, and the live-run steps settle it.

1. **Keep both the catch and the queue.** Each one, left out, ended in a
   dead login in a measured case. Cost: about 30 lines for the catch, a few
   for the queue. Confidence 85% that both are needed against the real
   server.
2. **Give a loan an end time before any live run.** Today a box object that
   dies without calling `drop` leaves the loan held, and that person's next
   Codex job waits forever. Cost: an alarm and about 30 lines. Not built.
3. **One Cloudflare account per person for the lockers, not one shared
   account.** Why:
   [Programs run in a box](../docs/direction/programs-run-in-a-box.md)
   already found that a person's token in an account another person holds
   runs into Anthropic's Consumer Terms, however much the two trust each
   other. Whoever holds an account can open every sealed login in it. In
   their own account, the locker is "a remote box only they control", which
   the decided note allows. Cost: each person has an account and a deploy,
   and the shared ledger hands jobs to two Workers. Confidence 65%: it fits
   the words, but Anthropic may still see our Worker passing a token on.
4. **Lift experiment 148's TLS rule on purpose, and ask first.** Both paths
   end TLS in our Worker with a real token, which 148 said not to do again.
   Write the change down, and send Anthropic and OpenAI one short question
   each before the live run. Their answers settle more than any run here.

## What it cannot tell us

- **Whether the providers allow it.**
  - Anthropic: the
    [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) say "You
    may not share your … Account credentials with anyone else", and the
    [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance)
    asks products built on Claude Code to use an API key and bars them from
    holding or passing on other people's logins. Here the login is the
    person's own, but our Worker holds it and adds it to each call. Whether
    that counts as passing it on is Anthropic's call.
    [Programs run in a box](../docs/direction/programs-run-in-a-box.md) reads
    this as the way the page bars.
  - OpenAI: the CI page is written for a trusted runner, says not to use it
    for public or open-source repositories, and not to share the file across
    concurrent jobs or machines. This repository is public; the jobs would run
    on private ones only. Whether a hosted box counts as a trusted runner is
    OpenAI's call.
- **Experiment 148's rule.** 148 decided that a lock which ends TLS in our
  Worker is not used with a real token again. Both paths here end TLS in our
  Worker and read the tokens there. This shape needs the owner to lift that
  rule, or it stays a measurement.
- **The real servers.** Whether `auth.openai.com` rotates and kills a family
  on reuse the way the fake does, whether it has a grace window, and which
  other hosts Codex calls there. The fake follows RFC 9700; the real server
  may differ in detail.
- **The cloud.** No deploy. The times are a laptop's under emulation, and the
  raw TCP and DNS results are the local helper's.
- **Small numbers.** One full run, one or two jobs a case.
- **Two windows left open.** The Worker itself dying between the provider's
  refresh answer and the locker's write; and the normal take-back with the
  catch on, which did not run this round.
- **The seal is only as good as the secret.** Anyone with the Worker's secret,
  or its Cloudflare account, can open every login in it.

## Files and how to run

- `157-login-stays-home.ts`: the driver. Steps: claude, codex, kill, killFixed,
  queue, queuePlantedOff, two, allow, time, then the leak count.
- `157-login-stays-home/`: `worker.ts` (locker, box, Outbound, front door),
  `gate.ts` (the allow list), `seal.ts`, `ticket.ts` (the person's key),
  `fake-openai.ts`, `fake-anthropic.ts`, `dev.ts` (the fakes and
  `wrangler dev`), `Dockerfile`, `wrangler.jsonc`, its own `package.json`.
- `results/157-login-stays-home.json`: every step's answer.

```sh
# Once: pnpm install --ignore-workspace in experiments/157-login-stays-home. Needs Docker.
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY -u ANTHROPIC_API_KEY \
  -u CLAUDE_CODE_OAUTH_TOKEN nice -n 15 node experiments/157-login-stays-home.ts
```
