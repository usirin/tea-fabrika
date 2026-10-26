# The ledger goes to Cloudflare, for two people

**Decided 2026-10-25: two people share one fabrika.** They work the same
tickets, and their agents talk to each other across the two machines. This is
a core goal now, not a later team feature. Cost is not a blocker: a Workers
Paid plan is already paid for.

**Decided 2026-10-25: no central users database, no central service.** Each
ledger stands alone, in its own Durable Object or its own Cloudflare account.
A person first picks which ledger to connect to, by its address. Invited, they
get in. Not invited, they are refused. Who belongs is facts on that ledger, and
nothing outside it knows.

**Decided 2026-10-25: a person signs in with their SSH key, and every key
GitHub lists for their login works.** No key is pinned to a ledger. In the
first version GitHub is the one place a person's keys live (see the next
decision): they remove an old key there, and every
ledger follows at the next login. So the ledger reads the keys again at each
login, and its sessions are short. See section 1.

**Decided the same day: where keys come from is an Effect service, and GitHub
is only its first version.** The door asks one service which keys may sign
for a person, and never calls GitHub itself. The aim is that each person puts
their own public keys on the ledger, so a ledger needs no GitHub at all. That
is OpenSSH's allowed signers list, the one `git` reads to check signed commits
([ssh-keygen](https://man.openbsd.org/ssh-keygen#ALLOWED_SIGNERS),
[git](https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgsshallowedSignersFile)).
A person's id comes from the service too, so `github:<n>` is one kind of id,
not the only one.

```ts
// A sketch. One question the door asks, two answers to it.
class Keys extends Context.Service<Keys, {
	readonly of: (name: string) => Effect.Effect<{id: string; keys: ReadonlyArray<string>} | null, KeysUnreachable>;
}>()("fabrika/door/Keys") {}

const layerGitHub = Layer.effect(Keys, /* GET /users/{login} and /users/{login}/keys */);
const layerOnLedger = Layer.effect(Keys, /* "key added" and "key removed" facts, each written by its person */);
```

**Decided the same day: access starts from an invitation.** The door asks the
keys service only about someone this ledger already knows: the founder, an
open invite, or a member. Any other name is refused, and nothing outside is
asked. An invite binds a name to an id once. After that, sign-in goes by that
id, so a person renamed on GitHub still gets in by the name this ledger knows
them by. Why: a sign-in anyone can start must not spend a budget outside the
ledger. GitHub answers 60 calls an hour per address without a token, and
Cloudflare's outgoing addresses are shared
([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
The GitHub Layer also takes an optional token, which gives it 5,000 calls an
hour of its own.

```ts
// A sketch. The door looks in its own members first, then asks by id.
const login = (name: string, signed: Signed) => {
	const id = known(members, name); // founder, invited or member; else null
	if (id === null) return refuse(401, "not signed in"); // the same answer as a bad signature
	return keysOf(id).pipe(/* check the signature against them */);
};
```

**Decided 2026-10-25: a project lives on one ledger server, never two, and
the app opens several projects the way Obsidian opens vaults.**

- **One project, one server.** By default a project's server runs on the
  laptop: the same Durable Object code, in Miniflare. Or the project is on a
  remote server on Cloudflare.
- **Never a local copy beside a remote one.** Within a project, that mix is
  where things go bad. Hosts that each hold their own full copy would be the
  sync-engine model, a separate idea for later. One server is the easier take.
- **Several projects, like vaults.** In Obsidian a vault is a folder with its
  own settings, each vault opens in its own window, and a vault switcher moves
  between them
  ([Obsidian](https://obsidian.md/help/manage-vaults)). The same here: a solo
  project on the laptop's server and a shared one on Cloudflare, each in its
  own window, with its own desk.
- **One host per project, decided the same day.** Each open project gets its
  own host, and so its own tsh: its own jobs, its own history, its own
  programs, all on that project's server. This is how Erlang runs two
  separate systems on one machine, as two nodes, each with its own database
  folder and its own cookie. It keeps [tea-host](./tea-host.md)'s rule, every
  host uses exactly one ledger, as written.

```text
A sketch. Two projects open on one laptop.

window "solo"     host "solo"     the laptop's server     like solo@laptop
window "shared"   host "shared"   the server on Cloudflare  like shared@laptop

The shared host crashes: only its window says so. The solo window never notices.
```

*Changed the same day, twice.* First: a project is connected on its own, like
`git remote add`, with the screen in a second, local ledger. Then: the whole
app talks to one server. The owner settled on the lines above.

**Decided 2026-10-25: a ledger server is the whole storage layer, made of many
Durable Objects, used fully from the start.** One object per project holds the
shared work. One object per person holds that person's layout, workspaces and
settings, so two people's desks stay apart on one server. One per lane may
come too. This replaces section 9's lean of one object first. Experiments 144,
real Cloudflare measured from a laptop, and 145, the many-objects shape in
Miniflare, are running to settle the details.

**Decided 2026-10-25: one Worker per project.** Each project's server is its
own Worker with its own deploy. In it sit the project's object and one object
per person. The Worker's name is the project's pick, a key in its
[fabrika.toml](./one-fabrika-toml-per-repo.md):

```toml
[ledger]
name = "acme-ledger"   # the project's Worker. A new name is a new, empty server.
```

- **Why:** a deploy is easy; experiment 147 runs one from code. A careless
  rename or a bad deploy then hits one project, not all of them, and one
  project can try a new server version first.
- **Cost:** a new project needs a deploy, and a person logs in to each
  project's server.
- **A rename is kept safe by what Alchemy and the file already give,** with no
  check of our own. `RemovalPolicy.retain()` stays on the Worker, so a rename
  leaves the old Worker and its data in place, and putting the old name back
  takes it back (experiment 147). tsh reads `fabrika.toml` only from the
  default branch, so a rename comes only through a reviewed pull request.
- The account's own part of the Worker's address stays out of the file.
- The other choice was one Worker in front of every project, an object each.
  Its connect example, `…/acme`, is further down and is to be redrawn.

**Decided 2026-10-25: the server is declared and deployed with Alchemy,** the
same setup kamp-us/phoenix uses (`.patterns/alchemy-overview.md` there), on
Alchemy's latest version rather than phoenix's pinned one. Experiment 144
deploys with it, and says how today's Durable Object ledger fits Alchemy's
shape. The owner wants Alchemy to deploy a host and the storage layer from
code, on the laptop too, with its custom resources for our own kinds.
*Corrected the same day:* this line first said Alchemy would be the one way to
stand up any infrastructure. That was a misreading. Experiment 146 tried that
wider reading with small spikes, and found Alchemy fits long-lived things a
person deploys, not per-run boxes or jobs. It timed only the command-line
path; a deploy called from code is still to measure.

**Everything else below is proposed.** The Door is built and in review.
Nothing is deployed yet.

```text
The first version is three things, and nothing else:

1. connect     fabrika connect https://ledger.example.workers.dev/acme
2. log in      as your GitHub login: the ledger checks a signature from your SSH key
               against the keys GitHub publishes for that login
3. invite      the creator invites a collaborator by GitHub login; they get in on first login
```

The answer first:

- **A ledger server is one Worker in front of many Durable Objects.** One
  object per project holds the shared work. One per person holds that
  person's desk and settings. The Worker is the door. It stamps who wrote each
  fact from the login, never from the request.
- **A person proves who they are with their SSH key** (decided). The ledger
  checks it against the public keys GitHub lists for that login. No token
  leaves the laptop, and no OAuth app is needed.
- **An agent holds a key its person signed,** so it writes as "agent for X",
  and only agent facts.
- **Members are facts on the ledger:** created, invited, joined, removed.
- **Each person's desk lives in their own object,** which only that person
  can open.
- **The first build step is the Door.** It is built and in review: it stamps
  writers and checks members, against a fake GitHub, with the proof as a
  swappable service.

```ts
// A sketch. At the door, before any ledger call.
const who = yield* door.check(request); // session → {kind: "user", id: "gh:1234"}
//                                         agent session → {kind: "agent", id: "gh:1234.triage", for: "gh:1234"}
ledger.append(stream, rev, {...event, writer: writerText(who)}); // the body's own `writer` is dropped
```

## What is already decided, and not argued again here

- One ledger, a Durable Object everywhere: Cloudflare for a team, Miniflare on
  a laptop ([the sync note](./a-local-first-sync-engine.md), decided
  2026-10-19).
- The ledger is a service, and it is tea-host's
  ([the ledger behind a service](./ledger-behind-a-service.md),
  [tea-host](./tea-host.md)).
- Tickets are facts in our own tracker, and only people on the ledger write
  them ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
- Which ledger a repository uses is `[ledger] at` in its `fabrika.toml`
  (experiment 107). Two people on one repository pick the same one.
- The host runs apart from the app, and everything the app keeps sits on the
  host's ledger
  ([the GUI note](./the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart)).
  This note leans on that work and does not change it.

## What exists today, and what it lacks for two people

| Piece | What it covers | What it lacks for two people |
|---|---|---|
| `host/durable-object.ts` | The `Ledger` class: claims, fenced appends, inboxes, the alarm, OTP's calls, limits. A WebSocket tail that sleeps with the object. A plain HTTP face, `POST /<ledger>/<method>`. | No login at all. Every method is open to anyone who can reach it. `writer` and `holder` are arguments the caller fills in. Never deployed. |
| `host/rules.ts` | All the SQL, shared with node:sqlite. Refuses the ledger's own words (`DOWN`, `exited`) from callers. | It trusts the `writer` text it gets. No table of who may write which kind of fact. |
| `host/http.ts` | `layerHttp`: a `Ledger` over HTTP, a small pool, a 3 s timeout, and the doorbell (a WebSocket that rings on each write and on each reconnect). | Sends no login. Ready for a remote URL in every other way. |
| `host/local.ts`, `daemon.ts` | The Durable Object in Miniflare, in its own process group, restarted past 500 MB. | Serves on 127.0.0.1 with no login. Fine for one person, not as a shared door. |
| `host/sqlite.ts` | `layerSqliteSync`, what the fabrika app uses today. Sees other writers by polling. | One file on one laptop. Nobody else can reach it. |
| `host/ledger.ts` | The service, its tagged errors. `LedgerUnreachable` already says "send it again with its id". | Nothing for "who am I", which a host needs to stop picking its own writer. |
| `host/writer.ts` | `Writer`: `{kind: "user" \| "agent", id}`, stored as `user:<id>` or `agent:<id>`. | No link from an agent to its person. Nothing proves the text. |
| `host/host.ts`, `observer.ts` | `cast` puts one message in a name's inbox, sent again under the same id. `whereis` says who holds a name. | `cast` takes its `writer` from the caller. |
| `programs/tracker` | Tickets as facts. Reads `by` from the row's `writer` column, never from the fact's body. Polls once a second. | Its `Author` service is filled by the host, and today the app hard-codes `{kind: "user", id: "owner"}` (`apps/fabrika/src/host.ts`). |

- **Has the Durable Object ledger ever run on real Cloudflare? No.**
  Experiment 93 says "Not run on Cloudflare itself". Experiments 94, 96, 98, 99,
  100 and 102 each list "a deployed Durable Object" as not done, and the host
  README lists it under "Not in it yet". There is no `wrangler` config in the
  repo. Every latency we have is workerd on 127.0.0.1, about 2 ms a call.
- **The good news.** The tracker already reads the writer from the row, not
  from the fact. So if the server stamps the row, the tracker needs no change
  to show the truth.

## 1. Who may reach it, and how a person proves who they are

Anyone can reach a ledger's address. The door refuses every call that does not
carry a session from that ledger. A session comes from a proof that the caller
is a GitHub login the ledger has invited. The open part is the proof.

```ts
// A sketch. The proof is a service, so the way a person proves who they are can be swapped.
class Proof extends Context.Service<
	Proof,
	{
		readonly challenge: (login: string) => Effect.Effect<Challenge>;
		readonly check: (answer: Answer) => Effect.Effect<GitHubUser, NotProven>;
	}
>()("Proof") {}

const GitHubUser = Schema.Struct({id: Schema.Int, login: Schema.String}); // id never changes; login can

// Branch (b), the lean. The ledger hands out a challenge; the laptop signs it with its SSH key.
const Challenge = Schema.Struct({
	ledger: Schema.String, // this ledger's address: a signature for one ledger is no good at another
	login: Schema.String,
	nonce: Schema.String, // fresh, used once, ends in 5 minutes
});
// On the laptop:  ssh-keygen -Y sign -n fabrika-login -f ~/.ssh/id_ed25519.pub   (the key may be in ssh-agent)
// At the ledger:  the signature's key must be one of GET /users/{login}/keys, and the login invited

const layers = {ssh: Proof.ssh, oauth: Proof.githubOAuth, fake: Proof.fake}; // tests use the fake
```

- **(a) GitHub OAuth** → works, and is what most apps do.
  - The desktop app would use GitHub's device flow, as `gh auth login` does:
    show a code, the person types it at `github.com/login/device`, the app
    polls for the token
    ([GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)).
  - The cost, with no central service: each ledger needs its own OAuth app,
    made by hand on GitHub. Or each ledger is handed a GitHub token, which it
    could act with on GitHub as that person. Both go against "each ledger
    stands alone".
- **(b) The person signs a challenge with their SSH key** → lean.
  - GitHub lists each user's public SSH keys, and the list is "accessible by
    anyone" (`GET /users/{username}/keys`,
    [GitHub](https://docs.github.com/en/rest/users/keys)).
  - Others already trust this list. Ubuntu's `ssh-import-id gh:<user>` adds a
    GitHub user's published keys to a server's `authorized_keys`
    ([manpage](https://manpages.debian.org/trixie/ssh-import-id/ssh-import-id.1.en.html)).
  - OpenSSH signs any data with `ssh-keygen -Y sign`. The `-n` namespace
    keeps a login signature from being reused as any other signature, and a
    key held in ssh-agent works
    ([ssh-keygen](https://man.openbsd.org/ssh-keygen)). The format is
    OpenSSH's `SSHSIG`
    ([PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig)).
    Git signs commits the same way.
  - No token leaves the laptop. No OAuth app. And it is the first step toward
    the sync note's signed facts: the same key could later sign each fact.
- **(c) Cloudflare Access in front** → not taken. It needs a Cloudflare Zero
  Trust team per ledger, and invites would live in a Cloudflare dashboard, not
  in the app. A desktop app's login through it is also unproven.
- **(d) One shared secret** → no. It names no person, so nothing can be
  stamped from it.

After the proof, the ledger gives its own session token. It names the GitHub
user id, is signed with a secret only this ledger's Worker holds, and ends
after a few hours. Each call is still checked against the members facts, so a
removed member's token stops working at once. An agent's grant ends no later
than the session of the person who signed it.

**Decided the same day: (b), an SSH signature checked against GitHub's
published keys, with every key GitHub lists accepted.** Why: it needs nothing
outside the ledger but a public list, and no token leaves the laptop. Cost: the
Worker must read `SSHSIG` and check three kinds of key. The app must reach the
person's SSH key.

Key pinning, where the ledger remembers the key used at join and refuses any
other, was proposed and not taken. A person keeps their GitHub key list clean
themselves, the way `ssh-import-id` users already do. What pinning would have
caught, an old forgotten key, is caught by removing it on GitHub. The ledger
reads the keys again at each login, with at most a few minutes of cache, so a
removed key stops working within one session's length.

What is left to try, and what would settle each:

- **Passphrase keys.** A key with a passphrase that is not in ssh-agent needs
  the passphrase typed. The app has no terminal, so it needs its own prompt or
  `SSH_ASKPASS`. A first try on a laptop settles it.
- **Reaching ssh-agent from the app.** On macOS a GUI app gets
  `SSH_AUTH_SOCK` from launchd. But an agent set only in `~/.ssh/config`
  (`IdentityAgent`, as 1Password's is) is not in the app's environment. The
  host would read that setting too. A guess, to try.
- **Hardware keys** (`ed25519-sk`, `ecdsa-sk`). They sign, and ask for a touch
  each time ([ssh-keygen](https://man.openbsd.org/ssh-keygen)). One touch at
  login is fine. Their signature also carries flags and a counter, so the
  Worker checks one more format. Whether GitHub's `/keys` lists them the same
  way is to check.
- **Key types.** Ed25519, ECDSA and RSA are the common ones. A Worker checks
  signatures with WebCrypto. Ed25519 there is to check.
- **GitHub's rate limit.** Unauthenticated calls to GitHub's API are limited
  per IP, and a Worker's calls leave from Cloudflare's shared addresses. The
  ledger keeps the keys it saw and reads again only at login. Whether that is
  enough is measured in the experiment.
- **A login renamed and taken by someone else.** The invite also keeps the
  GitHub user id, public from `GET /users/{username}`, and each login checks
  it. A new owner of an old login has another id.

## 2. Who wrote a fact, proven and not claimed

Today the caller names its own writer. On a shared ledger, any member could
write a fact under the other person's name. That includes an answer in a box.
The design need: **the writer comes from the session, and only from the
session.**

```ts
// A sketch. Writer gains `for`: an agent always belongs to one person.
const Id = Schema.String.check(Schema.isPattern(/^\S+$/));
export const Writer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("user"), id: Id}), // "gh:1234"
	Schema.Struct({kind: Schema.Literal("agent"), id: Id, for: Id}), // "gh:1234.triage", for "gh:1234"
]);

// An agent's key, signed by its person's key: the shape of an SSH certificate, in one SSHSIG.
const Grant = Schema.Struct({
	key: Schema.String, // the agent's public key; its private half stays on the person's host
	as: Id, // "gh:1234.triage"
	for: Id, // "gh:1234": the signer must be this member's key
	can: Schema.Literal("agent"), // agent facts only
	until: Schema.Number, // a short life; the host signs a new one
});
// ssh-keygen -Y sign -n fabrika-agent -f ~/.ssh/id_ed25519.pub grant.json

// The kinds only a person may write. The door refuses them from an agent's session.
const PersonOnly = Schema.Literals(["answered", "approved", "ruling", "invited", "removed"]);
```

- **The door stamps; the body cannot.**
  - Every argument that names who is filled from the session: `writer` on an
    append, a send or a `cast`, `holder` on a claim (as `<writer>@<host>`),
    `writer` on `register`, `cancel`, `setLimits` and `redrive`. Anything the
    body says there is dropped.
  - This is the common pattern. Firebase rules compare `request.auth.uid` to
    the data, so a client cannot write as someone else
    ([Firebase](https://firebase.google.com/docs/rules/rules-and-auth)).
    Zero (Rocicorp) checks the client's `userID` against the token's `sub`
    ([Zero](https://zero.rocicorp.dev/docs/auth)). Replicache's launch list
    says to check that a client id belongs to the logged-in user
    ([Replicache](https://doc.replicache.dev/howto/launch)).
  - The Durable Object gets a writer from the Worker, which is the only thing
    that can call it. The local door in Miniflare stamps the one person who
    owns the laptop.
- **An agent writes under its person, and only agent facts.**
  - The person's host makes a key pair for its agents, and the person's own
    SSH key signs a `Grant` for it. That is an SSH certificate's idea: a
    trusted key signs another key, with an identity, what it may do and an
    end date (`ssh-keygen -s`, `-I`, `-n`, `-V`,
    [ssh-keygen](https://man.openbsd.org/ssh-keygen)). The grant uses the same
    `SSHSIG` format as the login, so the Worker has one checker, not two.
  - The agent logs in like a person: it signs the challenge with its own key
    and shows the grant. The door checks that the grant's signer is a key of
    the member it names. Its session says `{kind: "agent", for: <person>}`.
  - It is OAuth's token exchange idea too: a token that says who acts (`act`)
    and for whom (`sub`), so the server knows "this is not the user itself"
    ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)). We get it from keys,
    with no token server.
  - **A person's answer needs the person's own session.** The door refuses a
    `PersonOnly` kind from an agent's session, so an agent's write of an
    answer fails at the door. It does not depend on a check inside a stage.
    An answer must also name an ask that is still open.
  - The agent's box never holds a key or a session
    ([programs run in a box](./programs-run-in-a-box.md)). The host holds both
    sessions, and uses the person's only on the path where the window sends an
    answer.

**Lean: the door stamps every writer, agents hold a grant signed by their
person, answers need a person's session.** Why: a writer the client picks can
be forged by any member, and the one place every write passes is the door.
Cost: `Writer` gains `for` (stored as `agent:<person>.<name>`, so old rows
still read). Each ledger method that takes a writer or holder takes it from
the door. `Author` stops being a choice: the host asks the door who it is.
**How sure: 80%.** The doubt: the host holds both the person's session and the
agent's, so a bug in the host could send an agent's text down the person's
path. A law test that walks every way a write leaves the host would settle it.

## 3. What each object on the server holds

**Decided the same day: every client reads and writes the one server, and a
project's object is shared whole, with no list per program.** Nothing syncs
between clients; the doorbell only tells each client that something new
landed. Every stream in a project goes with it, so a new program needs no line
here. A person's own screen lives in that person's object on the same server.

```ts
// A sketch. One server per project, local or remote; many objects inside it.
const server = connected ? layerHttp({url}) : layerLocal({home}); // never both

//   project/<id>      shared work: tickets, lanes, asks, agents' talk, members
//   person/<id>       one person's desk, workspaces, tsh history, settings; open to that person only

// A program is handed one object's ledger and never learns where it lives.
// The desk, tsh and the host's kept programs are handed the person's object.
```

| Kind of fact | Where | Why |
|---|---|---|
| Tickets: filed, edited, commented, closed, reopened | shared | Both people work the same tickets. |
| Asks and their answers, a yes and the text it covers | shared | Either person may answer; the answer must be stamped. |
| Lanes, claims (leases), fences, released | shared | The referee must be one place, or two agents take one ticket. |
| Stage facts and inboxes (`pipeline/ticket/…`) | shared | The ticket's timeline is the lane's one view, for both. |
| Agents' names and their talk (section 10) | shared | Agents on two machines talk through the ledger. |
| A run's beats (`runs/<run>/beats`) | shared | One small row per step: turns, last tool, waits on a person or not. Either person sees what an agent is doing, from any machine, later. The ticket's fold never reads them ([what a ticket shows](./what-a-ticket-shows.md)). |
| A run's full log | shared, in `Blobs` (R2), by hash | "Open log" works from any machine. A log is MBs; a Durable Object row stops at 2 MB ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). The ledger keeps only the hash. |
| Spend and limits per ticket | shared | A cap must hold across both people's agents. |
| Members | shared | The door reads them on every call. |
| CI jobs and results | shared | Any runner may claim a job. |
| Desk layout, tiles, workspaces, focus | the person's object | One person's screen. The other person never sees it. |
| Each tile's tsh jobs, history | the person's object | Same. A tile's tsh runs on this host only. |
| Scrollback | this laptop, not a fact | The terminal's own buffer. |
| A half-written comment | this laptop, not a fact | Not a fact until it is sent. |
| Who is online now | neither, for now | Live only, never a fact. Later, if needed. |

- **A project's object is the whole project; a person's object is their
  screen.** Why: one server keeps one truth, and the second person has no use
  for the owner's tiles. A program never has to say where its rows go. Cost:
  the desk needs the server to come back. On the laptop's own server that is
  always there. On a remote one, an offline start is the open question:
  experiment 145 tries a read copy of the person's object kept as a cache,
  and says whether that is still one ledger. **How sure: 75%,** until 145
  answers it.
- **A stream lives wholly in one object.** So a claim, its fence and its
  appends never cross, and a read never spans two: `pos` counts per object.

## 4. A ledger, and who belongs to it

A project's ledger is one Durable Object, `project/<id>` (section 3), shared
by everyone on it. In the first version it holds one repository's work. Who belongs is four kinds of fact on it, and
nothing else knows.

```ts
// A sketch. The members stream on one ledger. Nothing outside the ledger knows who belongs.
const Member = Schema.Union([
	// The first fact. Its login comes from the ledger's own config, set by whoever made it.
	Schema.Struct({type: Schema.Literal("created"), login: Schema.String, id: Schema.Int}),
	// By the creator, in the first version. The id is read from GitHub at invite time.
	Schema.Struct({type: Schema.Literal("invited"), login: Schema.String, id: Schema.Int}),
	// Written by the door at that person's first login. `keys` records which key signed; it never gates a later login.
	Schema.Struct({type: Schema.Literal("joined"), id: Schema.Int, keys: Schema.Array(Schema.String)}),
	// The one addition to the three: by the creator. A wrong invite must be undoable.
	Schema.Struct({type: Schema.Literal("removed"), id: Schema.Int}),
]);

// Who may call: a member is someone created or invited, and not removed since.
const isMember = (facts: ReadonlyArray<typeof Member.Type>, id: number) => /* the fold */ true;
```

- **Creating a ledger makes you its first member.** The one who makes the
  ledger sets its creator's GitHub login in its config, and the first fact is
  `created`. The first person to connect does not get to claim it.
- **The creator invites a GitHub login.** The door reads that login's user id
  from GitHub and keeps both.
- **That person joins on their first login.** The door checks their proof
  (section 1) and writes `joined`. It notes which key signed, as a record
  only: any key GitHub lists for that login works at the next login.
- **Removing a member is one more fact, `removed`.** It is the one thing added
  beyond the three, because a wrong invite must be undoable. The door checks
  the fold on every call, so the removed person's session stops at once.
- **Who sees what:** everyone on a ledger sees all of it. A person who should
  not see some tickets is on another ledger.

Other shapes, weighed:

- **One ledger, everyone on it equal** → the lean above.
- **One ledger per person, shared by sync** → the vision in the sync note. It
  needs signed lines, gossip and a referee elected among peers. Too much for
  the first two people. Kept open, behind the same `Ledger` service.
- **One Durable Object per ticket or lane** → section 9.
- **A central list of users across ledgers** → no, by the decision above.

**Lean: a project is one Durable Object; created, invited, joined and removed
are facts on it.** Why: it matches what tsh and `fabrika.toml` do (one ledger
per repository), the referee needs no election, and no outside service holds
anyone's name. Cost: no per-ticket privacy, and roles wait. **How sure: 80%.**
The doubt is the creator's first fact: setting it in config is safe but one
more step when a ledger is made.

## 5. Offline, or when Cloudflare is slow

```ts
// A sketch. What the window is told. The tracker's `Shown` already has `unreachable`.
type Link =
	| {state: "live"} // the tail is open; news arrives as it lands
	| {state: "slow"; ms: number} // calls answer, past 1 s at p99
	| {state: "away"; since: number; waiting: number}; // no answer; `waiting` writes held, by id
```

- **The live tail becomes the WebSocket doorbell, not a 1 s poll.**
  - The pieces exist. The object holds sleeping sockets and sends a small
    `{stream, rev, pos}` note after each write. `layerHttp`'s `watch` rings on
    each note and on each reconnect. The tracker's `tail` reads from its own
    cursor. A lost or doubled note costs a read, never a fact.
  - A poll leaves the laptop once a second. That is 86,400 requests a day per
    open tracker, 172,800 for two people, and the bulk of the bill (section
    7). A socket costs one request to open. Messages out are free. Messages in
    are billed at 20 to 1
    ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
  - Linear's client works this way: a socket for changes, then it fetches
    what it missed by sync id when it falls behind. Linear has not published
    this; it comes from people taking the client apart
    ([reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)).
  - A deploy restarts every object and drops every socket
    ([Cloudflare](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
    The doorbell already reconnects and rings once on reconnect, so a write
    made during the gap is read.
- **When the ledger cannot be reached:**
  - **The window shows it, plainly.** "Can't reach the ledger since 14:02;
    2 writes waiting." Tickets stay on screen as last read, marked stale.
  - **Writes wait and go again under the same id.** A send is already
    deduped by message id, so sending twice lands once. The tracker keeps
    them in its `saving` list today; they go out when the link is back.
  - **No new claim, no new agent.** The sync note's rule for a split: read and
    plan, start nothing. A running lane whose lease runs out is fenced, as it
    is today. A lane loses its ticket after about 30 s away (the claim's ttl).
    That is honest, and costs a restart of that lane.
  - **The desk stays on screen.** On the laptop's own server it never goes
    away. On a remote one, its changes wait like any other write. Starting
    the app while away is the open question in section 3.
- **When it is slow:** each call already times out at 3 s and fails as
  `LedgerUnreachable`. The window says "slow" past a p99 we pick after
  measuring, not before.

**Lean: the tail on the WebSocket doorbell, writes held by id, no new work
while away.** Why: the code exists, it is the industry's shape, and the poll
is what costs most. Cost: the tracker's poll Sub moves to `tail`. The window
needs one "away" banner. A lane can lose its ticket on a long drop. **How
sure: 80%.** The doubt is a laptop that sleeps: how often its socket comes back
broken. The experiment below measures it.

**Decided the same day: the first version rides out a wifi blip. A laptop that
stays offline for long waits.**

```ts
// A sketch, to be measured in experiment 149. A lane's own view of its lease.
type Lease =
	| {state: "held"; until: number} // renewed on time
	| {state: "jeopardy"; since: number} // a renew failed: keep working, hold outside writes
	| {state: "lost"}; // the grace ran out, or the ledger says another host has it
```

- **Why blips come first.** Every laptop's wifi drops for seconds or minutes.
  Today that costs a lane its ticket after about 30 s and a restart. Long
  offline work matters less: an agent needs Anthropic's servers, so a laptop
  with no internet cannot run agent steps anyway.
- **What "rides out" means.** The lane keeps its ticket and does not restart.
  Its writes land once and in order. Nothing outside happens twice. The window
  says plainly what happened.
- **How it is found.** Experiment 149 measures today's behaviour on drops from
  2 s to 5 min, for both a clean refusal and a silent hang. It tries ttl and
  renew pairs and a grace period, the shape Chubby calls "jeopardy" (a lease
  in doubt, held while the client waits)
  ([Burrows, OSDI 2006](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/)).
  It also counts how often this laptop's link really drops.
- **Hosts can be anywhere either way.** Every host uses the project's one
  ledger, so a lane on the laptop, one on Cloudflare and one on another
  person's laptop are already one record. Offline work is the only thing a
  branch-and-merge ledger would add.
- **Kept for later: a checked-out lane.** The lane takes its claim online with
  a long ttl. Offline, it writes only its own one-writer streams to an outbox.
  It uploads them in order under the same fence: a fast-forward, or nothing.
  A person can free the ticket, and that fences the upload. It is LiveStore's
  shape (the server sets the order, and the client replays on top before it
  pushes) ([LiveStore](https://docs.livestore.dev/reference/syncing/)) with a
  git-lfs-style lock for the claim
  ([git-lfs](https://github.com/git-lfs/git-lfs/wiki/File-Locking)). It would
  need program cursors keyed by message id instead of inbox rev, and it would
  block asks, outside writes and new tickets while offline.

## 6. Sharing a project: the whole ledger is copied

**Decided the same day: sharing a project copies its whole ledger, every row of
every table, with no code for any one program.** It is the first version's only
sync: like `git push -u origin main` to an empty repository. Long work on the
laptop that is pushed later, git-style two-way sync, waits until it is needed.
Today the app's file holds 27 rows, all `tracker/`, so today's copy is the
whole thing.

```ts
// A sketch. One call, on an empty object, by the creator only. Rows keep their pos, rev, at and writer.
const Imported = Schema.Struct({rows: Schema.Int, last: Schema.Int, hash: Schema.String});
ledger.import(batch); // refused unless the object is empty, or `last` is the batch's first pos - 1

// The check, on both sides: same count, same last pos, same hash over every row in pos order.
const hash = sha256(rows.map((r) => JSON.stringify([r.pos, r.stream, r.rev, r.writer, r.kind, r.at, r.data, r.id])));
```

- **Stop, copy, check, switch.** There are no live leases to move if every
  lane has stopped first.
  1. The owner stops every lane. The host stops. The laptop's file is now
     still.
  2. A script reads `events` in `pos` order, and the other tables
     (`names`, `leases`, `jobs`, `monitors`, `links`, `migrations`) as they
     are.
  3. It sends them in batches to an `import` call on the new object. One
     JSON array per call, read with `json_each`, since a call binds at most
     100 values but a value may be 2 MB
     ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
     Each batch is one transaction. A batch that does not follow the last one
     is refused, so a retry cannot leave a gap or a double.
  4. Both sides give a count, the last `pos`, and a hash over every row in
     order. They must match.
  5. `[ledger] at` in `fabrika.toml` changes to the ledger's address. The old
     file stays, read-only, as the backup.
- **Old rows keep their writer.** `user:owner` stays `user:owner`. The
  `created` fact's id maps that old name to the creator, so old and new rows
  name the same person.
- **A way back.** A Durable Object's SQLite can be put back to any point in
  the last 30 days
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)).
  Not in local dev. And the same SQL runs on node:sqlite, so the laptop file
  stays usable.
- **Pick where the object lives.** It is placed near its first request and
  never moves. A `locationHint` on that first call picks the region
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/reference/data-location/)).
  The first call must come from the import, with the hint set between the
  two people. It must not come from a test made from somewhere else.

**Lean: stop, copy in `pos` order, check by hash, switch.** Why: a still file
and an exact copy cannot lose a fact. Cost: every lane stops for minutes. One
`import` method, which must be off once the copy is done. **How sure: 85%.**
The doubt: no row has crossed from node:sqlite to a deployed object yet.

## 7. Cost

The Workers Paid plan ($5 a month) is already paid for, so the question is
only what comes on top. Assumed load for two people. Each is a guess until the
experiment counts it:

- 4 lanes at once per person, 8 hours a day. A lease renews every 10 s (ttl
  30 s, `claims.ts`): 23,000 renews a day.
- 20 agent runs a day in all, about 500 ledger calls each: 10,000 a day.
- One beat per tool call, at the high end of 50 to 200 per run: 4,000 a day.
- Two hosts on the doorbell, each reading after each ring: 28,000 reads a day.
- An agent's log: a few MB per run (a guess). 5 MB × 20 runs = 100 MB a day,
  in R2.

| Item | Per month | What is included | On top |
|---|---|---|---|
| Durable Object requests | about 2 M (65,000 a day) | 1 M | about $0.15 ($0.15 per M) |
| The same, with the 1 s poll kept | about 7 M | 1 M | about $0.95 |
| Worker requests | 2 to 7 M | 10 M | $0 |
| Object duration, awake all day | about 325,000 GB-s (128 MB × 30 days) | 400,000 GB-s | $0 |
| SQLite rows written | about 4 M (3 to 4 rows per write, a guess) | 50 M | $0 |
| SQLite storage | under 1 GB | 5 GB | $0 |
| R2, agent logs | 3 GB more each month | 10 GB-months | $0 for about three months, then $0.015 per GB-month ([R2](https://developers.cloudflare.com/r2/pricing/)) |
| GitHub's public keys list | a few reads a day | free | $0 |

- **Under $1 a month on top of the plan.** Durable Object prices are from
  [Cloudflare's pricing page](https://developers.cloudflare.com/durable-objects/platform/pricing/),
  Worker prices from
  [its Workers page](https://developers.cloudflare.com/workers/platform/pricing/).
- **The Free plan would not fit.** Its 100,000 rows written a day is under our
  guess of 130,000. It no longer matters, since the plan is paid.

## 8. Where it slots in the app's build order

The decision at the top moves this work earlier. The sync note's "Nothing else
moves early. The real run comes first." no longer holds for it.

- **Lane 2, the host running apart,** is built and in review. This note does not
  touch it. It needs one thing from it: the host is the only process that
  talks to the ledger, so sessions live in one place.
- **The Door is built and in review.** It is the Door, which stamps writers and
  checks members, against a fake GitHub. The proof is a swappable `Proof`
  service (section 1), with the SSH signature as the first real Layer and
  OAuth kept as a second.
  - A Worker entry in front of the `Ledger` class. Every method that takes a
    writer or holder takes it from the door. The body's own is dropped.
  - `Writer` gains `for`. The door refuses `PersonOnly` kinds from an agent.
  - The members fold: created, invited, joined, removed.
  - `Author` in the app comes from asking the door, not a constant.
  - Tests in Miniflare: a forged writer is stamped over, an agent's answer is
    refused, an unknown or removed login is refused. No deploy, no money.
- **Lane 3, app state on the ledger and restore.** One ask of it: put the
  app's own state, `desk/`, `tsh/` and `host/`, in the person's object, and
  hand programs the project's object. Then connecting a project in section 3 is a
  Layer change, not a rewrite.
- **Then, in order:** the deploy experiment (144, the owner said yes), `connect`
  and the invite in the app, one agent message across two laptops (section
  10), the tracker's poll moved to the tail, and the whole-ledger copy.
- **Lane 4, the jump list,** does not wait on any of it.

## 9. One object for the whole ledger, or one per lane

*Replaced the same day:* the owner chose many objects from the start (the
decision at the top). This section is kept as it was argued, with its lean of
one object first. What it found a split costs still holds.

Section 4 makes a ledger one object. This section asks whether each lane, or
each ticket, should get its own object with its own ledger, for real data
isolation. Cloudflare's own rules lean that way: "Create one Durable Object
per logical unit that needs coordination" and "Do not create a single 'global'
Durable Object". One object handles about 500 to 1,000 simple requests a
second. For the shape, they say: "The parent coordinates and tracks children,
while children handle their own state independently"
([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).

```ts
// A sketch. The split, if it comes: a parent per ledger, a child per lane.
//
//   ledger object "acme"          the ticket list and each ticket's top line, ticket numbers,
//                                 "waits on you" across all tickets, members, spend caps
//   lane object "acme#t-41"       the lane's facts and inbox, its claim and lease, its beats
//
// The child tells the parent one small line after each write that changes the top line.
const TopLine = Schema.Struct({
	ticket: Schema.String,
	title: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	waits: Schema.NullOr(Schema.Literals(["plan", "stuck", "ruling", "check"])), // an open ask
	rev: Schema.Int, // the child's rev it was made from: an old line never replaces a newer one
});
```

- **What lives in a lane's object.**
  - The lane's facts and inbox (`pipeline/ticket/<t>/facts`, `/inbox`), the
    tracker's ticket stream, its claim and lease, its fences, its beats.
  - The lease is one object's job, so the claim's compare-and-set still has
    one referee. Two agents on one ticket still cannot both win.
- **What needs a parent per ledger.**
  - The ticket list and each ticket's top line. Today the tracker reads every
    ticket with one `read(after, PAGE, "tracker/")`. With a split, that read
    goes to the parent's index.
  - Ticket numbers. Today a new number is the first `tracker/ticket/<n>`
    nobody registered. With a split, the parent hands out numbers.
  - "Waits on you" across all tickets: the parent's index of open asks.
  - Members, which the door reads on every call.
  - Spend caps across tickets. Today a charge counts up the tree in one
    transaction. Across objects it becomes a message to the parent, so a cap
    can be passed by the turns in flight.
  - The cost: each write that moves a top line is two requests, not one. The
    parent's index can lag the child by one message.
- **A fact that spans two lanes.** A duplicate ("same as t-12"), a ruling for
  two tickets, a plan with child tasks.
  - **The fact has one home, and the other lane gets a send** → lean. That is
    today's shape already: every name has an open inbox, deduped by message
    id. The home writes its fact. The other lane gets a message with the same
    id, sent again until it lands. No transaction spans two objects.
  - **Both writes in one transaction** → not possible across Durable Objects.
    Each object is its own database.
  - **The parent holds it, the lanes read it** → fits a fact about many
    tickets at once, such as a project's plan. Not for a lane's own work.
- **An agent's key scoped to one lane.**
  - **Yes, at the door, even with one object.** On a claim, the door gives
    the lane a short-lived token. It names the lane's prefix and its fence,
    is signed with a secret only the Worker holds, and ends with the lease.
    The agent's writes go with it, and the door refuses any stream outside
    that prefix. It is a capability (a key that says what it opens), the idea
    of Google's macaroons
    ([Google Research](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/)).
  - With a split, the door also routes that token to the lane's object only.
    The agent cannot even name another lane's data.
- **Could today's `Ledger` route a stream to its own object, behind the same
  interface? Partly. It is a Layer change for most calls, but not for all.**
  This comes from reading `host/ledger.ts` and `host/rules.ts`.
  - **Routes by name, no change:** `register`, `append`, `send`, `claim`,
    `cancel`, `setLimits`, `usage`, `processInfo`, `readStream`, `readLast`,
    `lease`, `watch`. Each names its stream or name, and a name's streams
    share its prefix (`streams(name)`, `inboxOf`). A router Layer can pick the
    object from the name.
  - **Needs a change: calls that name only a fence.** `renew` names its name
    too, but `monitor`, `demonitor`, `link`, `unlink`, `trapExit`,
    `startChild`, `hold`, `charge` and `exitChild` take a bare `fence: number`.
    The rules look the name up from it (`SELECT stream FROM leases WHERE
    fence = ?`). A fence is a `pos` in one database. Across objects, two
    fences could be the same number. A fence would have to carry its home.
  - **Needs a change: reads in one global order.** `read(fromPos, limit,
    prefix)` walks `pos`, one counter per database. The tracker's list and
    `tail` over a prefix use it. Across objects there is no single `pos`.
  - **Needs a change: OTP's calls across names, in one transaction.** `exit`
    writes DOWN to every monitor's inbox and EXIT to every link. `charge`
    counts up the whole tree. `startChild` registers and links two names.
    Today each is one transaction. Across objects they become messages,
    delivered at least once, so the laws must be run again.
  - So the split is a Layer change plus three interface changes: fences that
    carry their home, a parent index in place of the global `read`, and OTP's
    cross-name writes as messages. **How sure: 85%,** from reading the code,
    not from trying it.

**Lean: start with one object per ledger, and keep the door open to the
split.** Why: two people and their agents are far under one object's limit.
The code runs on one object today. The split costs three interface changes,
and the laws must hold again across objects. Write isolation, the part that
guards most, comes from lane tokens at the door with no split. **How sure:
75%.** The doubt is data isolation at rest. With one object, a bug in the
rules could let one lane read or write another's rows. Only a split stops
that.

| | Start with one object | Start split, one per lane |
|---|---|---|
| Build | The Door, nothing more | The Door, plus fences with a home, a parent index, OTP's calls as messages, and the laws again |
| Requests | One per call | About two per write that moves a top line |
| Isolation | Writes, by lane tokens at the door. Data, shared in one database | Writes and data, each lane its own database |
| Moving later | One object's rows split out by prefix; `pos` changes, so keep the old one beside it | Nothing to move |
| Bill at two people | Under $1 on top (section 7) | About the same: more objects, each asleep most of the time |

To keep a later split cheap, three rules now. They cost nearly nothing:

- A lane's facts stay under its own name's prefix. That is already true.
- A new read across tickets goes through one place (the tracker's list), so
  that place can become the parent's index.
- A fact about two lanes has one home and a send to the other, never two
  writes that must agree.

## 10. How agents talk to each other across two people

```ts
// A sketch. One message from the owner's planner to the second person's reviewer, about t-41.
// Its home is the ticket, so both people see it there. The receiver's inbox gets the same id.
const Talk = Schema.Struct({
	id: Schema.String, // A2A's messageId: sent again under the same id, it lands once
	ticket: Schema.String, // every talk is about a ticket; there is no talk outside one
	to: Schema.String, // "agents/gh:5678/reviewer"
	thread: Schema.String, // A2A's contextId: the conversation it belongs to
	parts: Schema.Array(Schema.Struct({text: Schema.String})), // A2A's parts, text only for now
	replyTo: Schema.NullOr(Schema.String), // the talk this answers
});
// writer, stamped by the door: agent:gh:1234.planner, for gh:1234
//
// tracker/ticket/41/talk          the message, in the ticket's own stream: the person's view
// agents/gh:5678/reviewer/inbox   {talk: id, ticket: 41}: the ring for the receiver
```

**The industry's standards first.**

- **Agent2Agent (A2A)** is the standard for agents talking to agents. Google
  started it, and it is now a Linux Foundation project
  ([Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)).
  The spec is at version 1.0
  ([spec](https://a2a-protocol.org/latest/specification/)).
  - An agent publishes an Agent Card at `/.well-known/agent-card.json`: its
    name, skills, address and how to log in.
  - A Message has a `messageId`, a `role`, `parts`, and optional `contextId`
    and `taskId`. A Task has states, including `input-required`, when the
    agent waits on its person.
  - It runs over HTTP: JSON-RPC, gRPC or REST, with streaming and webhooks.
  - "The A2A Server authorizes requests based on the authenticated identity
    and its own policies." Who may do what is left to us.
- **MCP (Model Context Protocol)** connects a model's app to tools and data:
  hosts, clients and servers, with tools, resources and prompts
  ([spec](https://modelcontextprotocol.io/specification/2025-11-25)). It is
  agent to tool, not agent to agent. An agent here already gets its tools
  through tsh ([tsh](./tsh-a-shell-for-tea-programs.md)).

**What exists here.**

- **Registered names, `cast` and `whereis`** (`host/host.ts`,
  `host/observer.ts`). A name is registered once. Anyone may put a message in
  its inbox, deduped by id. `whereis` says which host holds it now.
- **Experiment 95** ([write-up](../../experiments/95-agents-across-hosts.md))
  asked an agent on another host a question through the shared ledger, with
  hosts killed and taken over. Every question got exactly one answer. It
  already laid A2A beside ours: their Message is our ask and reply, their
  `messageId` our message id, their `contextId` our `corr`. Their Task has no
  match yet. The answers came from a stub, not a real agent.
- **Asks and inboxes** (`packages/pipeline/src/asks/`). An ask waits on a
  person, and only a person answers it.

**Use A2A's words, not its wire, between our two hosts** → lean.

- Why not its wire. Both hosts sit behind home routers, so neither can take
  an HTTP call from the other. The ledger already gives order, exactly-once by
  id, replay after a crash, and a record both people can read. A2A over HTTP
  would be a second path the ticket's timeline does not see.
- Why its words. Our message is shaped as A2A's (`messageId`, `contextId`,
  `parts`), so a gateway at the door can later serve a ledger's agents as A2A
  servers to agents outside. Experiment 95 already sketched that gateway.
- **How sure: 75%.** The doubt: a real outside agent that only speaks A2A
  would show whether the gateway is as thin as the sketch says.

**How an agent is named and found, per person.**

- **By person and role: `agents/<member>/<role>`** → lean. The second
  person's reviewer is `agents/gh:5678/reviewer`. Its registration carries a
  small card, A2A's fields cut down: name, what it does, its person. Listing
  `agents/` is the directory. `whereis` says whether it is running now.
- **By lane: `lane/<ticket>/<stage>`** → good for the agent working one
  ticket. It is found from the ticket. It does not cover an agent that serves
  many tickets.
- **By role only, any person's host may hold it** → that is a work queue, not
  talk. Claims already cover it.
- **How sure: 70%.** The doubt is whether people will want to talk to "the
  agent on t-41" more than to "their reviewer". The first real exchanges
  would show it.

**Who may send to whom.**

- **Any member's agent to any member's agent, on the same ledger** → lean.
  Everyone on a ledger is already trusted with all of it (section 4). Nothing
  crosses ledgers.
- **Only between agents on a ticket both people work** → safer, but needs a
  notion of "works on" the ledger does not have.
- **A list per agent, kept by its person** → later, if a person wants it.
- The door stamps the sender, so a talk cannot claim another sender.
- **How sure: 75%.** The doubt is a loop: two agents answering each other
  for ever. A limit on talks per thread, counted by the ledger as spend is,
  would stop it.

**What an incoming message may make an agent do.**

**The design need: prompt injection.** A message from the other person's
agent is input nobody here controls. It may carry text that agent read on a
bad web page. The Door stops it from writing as a person. The Door cannot stop
the agent that reads it from using its own powers afterwards, such as pushing
code or posting on GitHub.

- **Filters are not the answer.** "The Attacker Moves Second" tested 12
  recent defenses against prompt injection and jailbreaks with adaptive
  attacks. It broke most of them over 90% of the time, though most had
  reported near-zero success at first
  ([arXiv](https://arxiv.org/abs/2510.09023)).
- **Meta's "Agents Rule of Two"** (2025-10-31). Within one session, an agent
  has at most two of: [A] input nobody trusts, [B] sensitive systems or
  private data, [C] the power to change state or send things out. When all
  three are needed, it needs supervision, such as a person's approval
  ([Meta](https://ai.meta.com/blog/practical-ai-agent-security/)).
- **Simon Willison's "lethal trifecta"** names the same three for stealing
  data: private data, exposure to untrusted content, and a way to send it out
  ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)).
- A step that reads a talk has [A] for sure, and usually [B] (the repo, the
  ticket). So it must not have [C].

```ts
// A sketch. Held in code, not in a prompt.

// 1. A talk lands as a comment or a ticket, marked as written by an agent for its person.
{fact: "commented", ticket: "t-41", body: "…"} // writer: agent:gh:1234.planner, for gh:1234

// 2. The step that reads it gets no push and no GitHub write. Its only Cmds:
type ReadsTalk = ReplyOnLedger | FileTicketAsItself; // no CodeHostWrites, no Ci, no network out

// 3. Nothing outside the ledger starts from a talk alone. Code asks the receiver's own person first.
const onTalk = (talk: Talk): Cmd =>
	wantsWork(talk)
		? ask({who: "person", for: "start", ticket: talk.ticket, from: talk.from}) // a box on the ticket
		: reply(talk); // on the ledger, as itself
```

- **A talk is data, never an instruction above the agent's own person.** It
  lands as a comment or a ticket, marked "agent for X". The model sees it
  inside a quoted block, labelled with who sent it.
- **Code never starts a lane, a push or any outside write from a talk
  alone.** A person on the receiving side says yes first, as an ask in a box
  on the ticket. That yes is the supervision Meta's rule asks for.
- **The step that reads a talk has no [C].** It gets no `CodeHostWrites`, no
  GitHub write and no network out. It may reply on the ledger, or file a
  ticket as itself. Both stay inside the ledger, where a person sees them.
- **It never answers a person's ask, and files or comments only as itself.**
  Both hold at the door (section 2), for any writer.
- **Lean: these three rules, in code.** Why: no filter holds against an
  adaptive attacker, but a step that cannot push cannot be talked into
  pushing. Cost: every piece of work an agent asks of another person's agent
  waits for that person's yes. **How sure: 75%.** The doubt that remains: once
  the person says yes, a fresh session that reads the same text later is
  still reading text nobody here controls. Starting it fresh does not make the
  text safe. So the person's yes is the real gate, and it is only as good as
  what the box shows them. The box must show the talk's full text and who sent
  it, not a summary an agent wrote.

**How a person sees the conversation.**

- **On the ticket, in its timeline** → lean. The talk's home is
  `tracker/ticket/<n>/talk`, so each message is a row on the ticket, marked
  agent to agent, with both persons' names. It folds like a comment, not like
  an answer, so it never changes what a yes covers. The receiver's inbox gets
  only a ring with the same id.
- **In each agent's inbox only** → the person would have to look in two
  places, and a talk outside a ticket would be seen by nobody.
- That is why every talk names a ticket. A talk with no ticket is refused, so
  nothing two agents say is out of sight.

**The smallest first step.** One agent on each laptop exchanging one message
through the shared ledger.

1. Both laptops are logged in to one deployed ledger (sections 1 and 4).
2. The second person's host registers `agents/gh:5678/answerer`.
3. The owner's host sends one `Talk` on a test ticket, from
   `agents/gh:1234/asker`: "What is 17 times 23?", as experiment 95 asked.
4. The answerer replies once. Both rows show on the ticket, each with its
   stamped writer. The answer lands once, even when sent twice.

It needs the Door and a deployed ledger. Before the deploy, the same steps run
in Miniflare with the second host in a container, as experiment 95 did.

## The experiment that would settle the biggest doubt

The biggest doubt: nothing has run on a deployed Durable Object. We do not know
its latency from the owner's laptop, whether the tail holds up over a real
network and a sleeping laptop, whether the laws hold with two writers far
apart, or whether GitHub's keys list answers a Worker reliably.

```ts
// A sketch. One deploy of the existing class with the Door in front, four parts.
// 1. Latency: from the owner's laptop, 10 min each of append, read, claim, renew.  → p50, p99
// 2. Tail: the same writes watched by a 1 s poll and by the doorbell, for 1 h,
//    with the laptop put to sleep twice.                       → delay to see a write; requests
// 3. Two writers: the law suite (`runLaws`) over `layerHttp` to the deployed URL, then a 2 h soak
//    from the laptop and from a second network (a container on a cloud machine, or the second
//    person's laptop), many claims on few tickets, one deploy halfway through.
//    → no gap, no double, one holder per ticket, every acknowledged write read back
// 4. Login: 50 SSH logins from the Worker, with GitHub's keys list read each time.
//    → how many answers GitHub refused or slowed
```

- **Cost: under $1** on top of the plan already paid. A 2 h soak at 50 calls
  a second is 360,000 requests. The laws, latency and login runs add less. No
  model calls.
- **The owner said yes the same day,** under $1, with everything deleted
  after. It is experiment 144. The account and its keys are not in this repo.
- **It settles:** the 50 ms p99 bar in [tea-host](./tea-host.md) ("If a
  deployed ledger's p99 append is over about 50 ms, a direct host-to-host path
  comes next"); poll or tail; whether a deploy mid-run loses anything; and
  whether the SSH proof can lean on GitHub's public list.

## Where it disagrees with a decided note

- **[tea-host](./tea-host.md) says "every host uses exactly one ledger"**, and
  the GUI note says everything the app keeps is on the host's one ledger.
  It no longer disagrees. Each open project gets its own host (decided at
  the top), and that host uses one server: the project's object and the
  person's object sit on it. Each program is handed one object. The rule
  holds as written.
  - *Overtaken the same day.* This bullet first gave each host two ledgers,
    the project's and the app's for the screen, and leaned to changing the
    rule to "a host holds the app's ledger and one per project" (80%). The
    one-server decision at the top replaced both.
- **[The services note](./services-and-our-own-ci.md#open-questions) asks
  where the ledger lives for one owner with two machines.** This note leans to
  Cloudflare. A second person on another network makes the always-on home
  machine need a private network for them too. Cloudflare needs only HTTPS
  out.
- **[The sync note](./a-local-first-sync-engine.md) said nothing else moves
  early.** Changed 2026-10-25 for this work, by the decision at the top. That
  line is marked there.

## Later

None of these is in the first version.

- Roles: who may invite, who may remove, read-only members. In the first
  version the creator invites and removes, and everyone else is equal.
- More than one repository on a ledger.
- One Durable Object per lane (section 9), and lane tokens at the door.
- Each fact signed by its writer's key, the sync note's signed lines. The SSH
  proof is the first step to it.
- A fresh proof for each yes (a step-up check), if a host bug ever writes an
  agent's text as a person.
- A read cache on each laptop, if a deployed ledger is slow.
- The box that asks a person to start work from a talk. The first version
  only replies. An A2A gateway for agents
  outside a ledger.
- Who is online now.
- GitHub OAuth as a second `Proof` Layer, for a person with no SSH key.

## What would change it

- A p99 append from the laptop far above 50 ms. Then a read cache comes before
  the switch.
- GitHub's keys list refusing a Worker too often. Then the ledger keeps the
  keys it saw at join and reads GitHub again only when a new key shows up, or
  OAuth comes first.
- Passphrase or hardware keys that the app cannot use without a terminal.
  Then OAuth's device flow comes first.
- A person who should not see every ticket. Then "who sees what" comes back,
  and per-prefix rules at the door.

## What it cannot tell us

- Nothing here has run on Cloudflare. The Door runs in Miniflare tests only.
  No deploy, no SSH login against the real GitHub, no agent talk across two
  laptops. Every Cloudflare and GitHub number is from their docs, read
  2026-10-25, not measured.
- The load in section 7 is guessed: lanes at once, calls per run, beats per
  run, rows per write and MB per log. The bill is small enough that a guess
  twice too low still costs little.
- Reaching ssh-agent from a GUI app, and the 1Password case, are guesses.
- Whether GitHub's `/keys` lists hardware keys is still to check. An Ed25519
  SSH signature checks in workerd, in the Door's tests, but not yet on
  Cloudflare itself.
- It says nothing about more than two people, people in far-apart regions, or
  a team that wants no Cloudflare. That team runs the same bundle on workerd,
  as the sync note says, and needs its own door.
