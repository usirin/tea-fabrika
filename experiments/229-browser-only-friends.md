---
date: "2026-11-07"
scripts: "none"
summary: "About `next/`; reading only, an audit of 32 decisions against the case. 11 hold, 17 strain, 4 break as written. The owner narrowed it the same day: setup may need a Mac, only using fabrika needs only a browser, so row 1 is not a break and row 8 is decided as Tier 1's question 19. The rest was proposed then: a passkey as a person key, the approve row in any inbox, Cloudflare Containers as hands. No model, $0. Every row settled 2026-11-08: rows 9, 22, 16, 17, 27 and the small ones follow from decisions already made (table at the top)."
---

# 229. Can a few friends run fabrika from browsers and phones alone?

Read 2026-11-07. This is reading, not a measurement: an audit of the repo on main (`e15cc0b1`)
against one case, plus primary docs of products that solved it. Every claim is about `next/`
unless a row says "today's version". No model, $0.

**Narrowed by the owner, 2026-11-07.** Setup and deploy may need a Mac. Only *using* fabrika must
need nothing but a browser. So:

- **Break 1 (row 1, founding without a Mac) is not a break.** The payer founds and deploys from a
  Mac; the founding link stays a later option.
- **Break 2 (row 8, a tab approving a device) is decided** as
  [Tier 1's question 19](../docs/plan/tier-1.md#open-questions).
- ~~**Everything else here is proposed:** rows 9 and 22 still break as written, and every fix below
  is a lean, not a decision.~~ Wrong after 2026-11-08: see the next point.
- **Every other row is settled, 2026-11-08.** The owner decided rows 13, 18, 19, 23 and 31, and the
  owner's 11-07 product walk decided roles and invites (rows 2, 3 and 7). The lead agent checked
  the rest against those calls. None is a new one: a no to any of them would contradict a decision
  already made.

| Row | Settled by |
|---|---|
| 9 | Question 19 (a passkey tab is an equal master) and one shape for every ask: the approve row is an ask, in the inbox of any client that holds a person key |
| 22 | Already in [the tiers](../docs/plan/tiers.md): Tier 4's first hands are a Cloudflare container (owner, 2026-10-25) |
| 16 | Tier 3 is browsers and phones only (owner, 2026-11-07): in `next/`, the hosted web client is a first-class client |
| 17 | Question 19's follow-up (the sheet may let in a passkey tab): the flow says "device", and the sheet is offered on the web client's first screen |
| 27 | Row 18's install with no hand steps: the install makes the group's GitHub App with GitHub's manifest flow. Not tried yet; a spike checks it before Tier 3 |
| 11, 14 | Synced passkeys are accepted, and a wiped tab lets itself back in (owner, 2026-11-08) |
| 6 | Roles, `{owner, admins[], members[]}` (owner, 2026-11-07) |
| 25 | A box reaches only its allow list (owner, 2026-11-05), so no box has open internet |
| 24 | Waits for Tier 5, with [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md) |

## The case

- One friend installs fabrika into their own Cloudflare account, on the paid Workers plan. Call
  them the payer.
- Everyone else joins through the hosted web client, on laptops and phones. Nobody but the payer
  may have a Mac, and nobody may run a local machine for agents.
- No admin tree, no SSO, no IT team. A company is the same shape at a bigger size. Where a row
  grows with size, it says so, but every fix is sized for friends first.

## The answer first

- **The ideas hold.** A key per client, no GitHub trust, a signed grant, the grant tree, one
  ledger per project and the locker for logins all work with no Mac.
- **The flows break.** Tier 1 and the recovery note put every yes behind the Mac: the founding
  screen, the menu bar's Approve, Touch ID, "a new Mac". With no Mac, nobody can found a fabrika,
  approve a phone, or get back in.
- **One idea fixes most of it: a passkey is a person key.** A tab that makes a user-verified
  passkey (WebAuthn, `userVerification: "required"`) holds a key the platform keeps, behind a face,
  finger or PIN. Treat it as one more device, an equal master. That answers question 19 with "yes,
  a tab with a passkey may approve; a tab with only its window key may not".
- **Counts, as first written:** 11 hold, 17 strain, 4 break (32 rows). After the owner's narrowing,
  row 1 is not a break and row 8 is decided, so 2 proposed breaks remain (rows 9 and 22).

## How others do it

Primary docs, read 2026-11-07. Quotes are short and may differ slightly from the live page.

- **Linear.** "By default, only Admins can invite members on paid plans." On the free plan every
  member is an admin. An invite link lets "anyone with the URL" join
  ([invite members](https://linear.app/docs/invite-members)). Passkey login exists, with several
  devices per person ([login methods](https://linear.app/docs/login-methods), search snippet only).
- **Slack.** "By default, members ... can invite new members." Admins can turn on "Require admin
  approval". Invite links last 30 days and take up to 400 people
  ([invitations](https://slack.com/help/articles/115004854783),
  [invite links](https://slack.com/help/articles/201330256)). The Primary Owner is the one who "can
  delete the workspace or transfer ownership" ([roles](https://slack.com/help/articles/360018112273)).
- **GitHub organizations.** Owners have "complete administrative access". The owner role "should be
  limited, but to no less than two people"
  ([roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)).
- **Tailscale.** "There can only be one Owner"; admins invite and remove; new users are members
  ([roles](https://tailscale.com/kb/1138/user-roles)). Device approval needs an owner or admin
  ([device approval](https://tailscale.com/kb/1099/device-approval)). With Tailnet Lock, "all new
  node keys must be signed by an existing Tailnet Lock key": trusted devices let new ones in, not
  the server ([Tailnet Lock](https://tailscale.com/kb/1226/tailnet-lock)).
- **1Password.** A new device needs the Secret Key the first time
  ([Secret Key](https://support.1password.com/secret-key/)). A family organizer can "restore access
  for family members" who lost their password or Secret Key
  ([family organizer](https://support.1password.com/family-organizer/)). Business hands that to a
  group with a "Recover Accounts" permission (search snippet only).
- **Passkeys.** User verification is a "biometric gesture, enter the device PIN, or enter the
  device password"; a passkey on one device can sign in on another through the "hybrid" transport
  ([passkeys.dev terms](https://passkeys.dev/docs/reference/terms/)). WebAuthn's default is
  "preferred", so a site must ask for "required" itself ([WebAuthn 3](https://www.w3.org/TR/webauthn-3/)).
  Apple syncs passkeys through iCloud Keychain across a person's Apple devices
  ([Apple](https://developer.apple.com/passkeys/)).

**The pattern for a few friends:** one owner, invite links any member can send, and a new device
let in by something already trusted (a Secret Key, a signing node, a passkey). Admin approval of
invites, two or more owners and a recovery group come with size.

## Part 1: the rows

Legend: **holds**, **strains** (works, with a gap), **breaks** (the scenario cannot happen as
written). Each fix is the smallest edit, with how sure I am.

### Getting in: founding and joining

| # | Decision | Verdict | Why, and the smallest fix |
|---|---|---|---|
| 1 | Founding happens in the Mac app: "one name field and Start", and the person key is sealed on the Mac ([tier-1.md](../docs/plan/tier-1.md) moment 1; [recovery-key.md](../docs/direction/recovery-key.md) call 7) | **breaks as written; not a break after the narrowing** | With no Mac, nobody can found. And a fresh deploy on `workers.dev` lets its first visitor claim it. **Fix:** `fabrika up --cloud` prints a one-time founding link (Tier 1 already lists "one-time link" in its transport column). The payer opens it, types a name, makes a passkey. That passkey is the founding person key. 80%. |
| 2 | A second person joins by invite, then "the person who owns the fabrika approves" ([a key per client](../docs/direction/a-key-per-client-and-no-github-trust.md)) | **strains** | Holds in shape: an invite plus a signed grant, no GitHub. The gap: only the owner can let anyone in, so the group stalls when the payer is busy. Slack's default lets members invite; Linear's free plan does too. **Fix:** an invite is a one-use link with a short life, signed by any member's person key. The link names the person; their first passkey is the join. "Only the founder invites" becomes a setting. 70%: the doubt is whether "any member invites" weakens "nothing joins unless its person says so" ([five layers](../docs/direction/a-local-first-sync-engine.md) T5). It does not, if the inviter is the one saying so. |
| 3 | "The creator invites and removes, and everyone else is equal" ([the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) section 4) | **strains** | Fine for friends, but the founder is a single point. If the founder loses every device, nobody can remove anyone. GitHub says owners should be "no less than two". **Fix:** the founder can name a second owner. Owners remove; anyone invites (row 2). No other roles until a company asks. 75%. |
| 4 | No central users database; one ledger per project; who belongs is facts on that ledger (same note) | **holds** | Exactly the self-hosted shape. Each group's Cloudflare account is its own island. |
| 5 | No GitHub trust, ever (a key per client) | **holds** | Nothing in this case needs GitHub to let someone in. Names are typed, as the note says. |
| 6 | Members fold keeps one `person` and one `name`, from `founded` ([recovery-key.md](../docs/direction/recovery-key.md) call 8) | **strains** | Correct for Tier 1's one person. A group needs many persons, each with their own roots. **Fix:** none now in code, but write the rule now that `for` on every grant names a person id, never "the" person, so Tier 3 adds persons without rewriting facts. 80%. |
| 7 | Tier 3's join screen is undrawn; "code, link or QR" open (a key per client, "What it cannot tell us") | **strains** | For friends on phones, a link sent in a chat is the known way (Slack, Linear). **Fix:** pick the link; a QR is the same link drawn. 75%. |

### Devices: approving from a tab

| # | Decision | Verdict | Why, and the smallest fix |
|---|---|---|---|
| 8 | Question 19: a browser tab joins but cannot approve, lean 70% ([tier-1.md](../docs/plan/tier-1.md) open question 19) | **breaks as written; decided 2026-11-07 as question 19: yes, with a user-verified passkey** | With no Mac, every client is a tab, so nobody can approve anyone. The plan names the doubt itself: the phone "may be the one device a person has with them". **Fix:** split the tab in two. A tab with only its WebCrypto window key cannot approve. A tab that made a user-verified passkey holds a person key and is an equal master, like a Mac. 75%. The doubt: synced passkeys (row 11). |
| 9 | New browser flow: a code in the tab, the same code in the menu bar, "Approve and a finger" (tier-1.md moment 2) | **breaks** | No menu bar. **Fix:** the approve row lives in the inbox of any client that holds a person key, phone included. "A finger" becomes `verify`, which plan question 3 already renamed to WebAuthn's word. The row says which browser and from where, as RFC 8628 warns ([experiment 150](./150-browser-desk.md)). 80%. |
| 10 | The door checks SSHSIG, Ed25519 only ([recovery-key.md](../docs/direction/recovery-key.md) call 7) | **strains** | Platform passkeys sign with ES256 (P-256) almost everywhere, and a WebAuthn signature covers `clientDataJSON` and `authenticatorData`, not the bare text. **Fix:** one more key kind on the door, `passkey`, checked as a WebAuthn assertion whose challenge is the hash of the grant text. Keep one check function, two key kinds. A guess to verify: OpenSSH's `webauthn-sk-ecdsa-sha2-nistp256@openssh.com` signature may let `ssh-keygen -Y verify` still re-check it. 65%. |
| 11 | No third party is a way in (a key per client) | **strains** | A synced passkey (iCloud Keychain, Google Password Manager) appears on every device of that cloud account. That makes Apple or Google a way in, the same kind of door "no GitHub trust" closed. **Fix:** at grant time, record the passkey's backup flags (WebAuthn's BE and BS bits). Let the owner decide: accept synced passkeys (smooth for friends), or count each synced copy as needing its own Approve. This is a fact lost forever if not recorded at grant time. 60%: an owner call. |
| 12 | Every device a person owns is an equal master; the grant tree (recovery-key.md calls 7 and 8) | **holds** | A passkey device is one more root. Tabs and agents still hang under the device that let them in. No new rule. |
| 13 | A tab's key survives reload but only on the exact origin ([experiment 215](./215-browser-key-survives-reload.md)) | **strains**, decided (owner, 2026-11-08) | On Cloudflare the origin is fixed, good. But a passkey is bound to its domain too. A group that later moves from `workers.dev` to its own domain re-enrolls every phone. **Fix:** the install asks for the final address once, up front, and says moving it costs everyone a new passkey. 75%. Tier 7's "a real domain" moves to install time. |
| 14 | A phone's browser "may clear" a tab's storage after 7 days without a visit (recovery-key.md call 7) | **strains** | Real for Safari. A cleared tab loses its window key. **Fix:** with a passkey (row 8), a cleared tab knocks again and approves itself with the passkey, one prompt. No new design. 70%. |
| 15 | A browser is always a client ([note](../docs/direction/a-browser-is-always-a-client.md)) | **holds** | This is what makes the case possible at all. Its own doubt, "whether anyone will use fabrika from a browser soon", now has an answer: yes. |
| 16 | The GUI is Electron first; a browser is "later: only for a device with no fabrika on it" ([note](../docs/direction/the-gui-is-electron-first.md)) | **strains** | Today's version. For `next/`, the browser is now the main client for most of the group. **Fix:** a line in that note: in `next/`, the hosted web client is a first-class client, and Electron adds the menu bar and the sealed keys. 85%. |

### Recovery with no Mac

| # | Decision | Verdict | Why, and the smallest fix |
|---|---|---|---|
| 17 | The sheet of 12 words, instant, one use ([recovery-key.md](../docs/direction/recovery-key.md)) | **strains** | The idea holds. The flow is written for a Mac: "a new Mac's first screen", Touch ID, "Is your old Mac lost or stolen?", "a quiet row in the menu bar". **Fix:** say "device" for "Mac", and put "I have a backup sheet" on the hosted web client's first screen. Using the sheet makes a new passkey, not a sealed Mac key. 80%. |
| 18 | Email recovery through `send_email`, with a 24-hour wait any device can cancel (recovery-key.md, Email recovery) | **strains**, decided (owner, 2026-11-08) | `send_email` sends only to verified destination addresses, up to 200 per account ([experiment 217](./217-email-recovery-and-mac-migration.md) table). Each friend's address has to be added to the payer's Cloudflare account, and each friend clicks Cloudflare's check link. The fallback, Access's one-time PIN, is free up to 50 people (unconfirmed on a page I opened). **Fix:** the brain adds a friend's address through Cloudflare's API when they join, so the check email comes then. Say plainly the 50-person line for Access. 60%: the API call needs a token with Email Routing rights, one more secret. |
| 19 | No social recovery: Apple's recovery contact "needs a second person on the ledger" (recovery-key.md, the industry table) | **strains**, decided (owner, 2026-11-08) | Friends have that second person from day one. 1Password's family organizer restores access the same way. **Fix:** an owner may re-invite a person who lost every device, as the same person. It waits 24 hours and shows on that person's live devices, like email recovery. 70%: the doubt is that the owner could then act as that person, which they already can by holding the Cloudflare account (row 23). |
| 20 | "Which setup gets which": Cloudflare gets both the sheet and email (recovery-key.md) | **holds** | The hosted case is the Cloudflare setup. Nothing to change but the words in row 17. |

### Agents with no local machine

| # | Decision | Verdict | Why, and the smallest fix |
|---|---|---|---|
| 21 | Each person's model login sits in their own locker on the shared Cloudflare account; the box gets it as `CLAUDE_CODE_OAUTH_TOKEN` ([agents behind one service](../docs/direction/agents-behind-one-service.md), "Where a person's login lives") | **holds** | Built for exactly this. Anthropic's page allows "a platform hosts Claude Code" with a person's own subscription. The owner took the Consumer Terms risk ("may not share your ... Account credentials") knowingly. |
| 22 | Tier 4 hands are "Mac and VM hands" ([tiers.md](../docs/plan/tiers.md)) | **breaks** | With no Mac and no VM, nothing takes a job. A tab "can't start a process, so there's no `claude`" ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)). **Fix:** name Cloudflare Containers (or the Sandbox SDK on top of them) as a first kind of hands in Tier 4, beside Mac and VM. [Local is the cloud](../docs/direction/local-is-the-cloud.md) already sketches `Cloudflare.Container("job")` with Docker as its local twin, and experiment 148 ran a real Claude Code job in one. 80%. |
| 23 | The payer's Cloudflare account holds every friend's locker, the bot key and the ledger | **strains**, decided (owner, 2026-11-08) | Whoever holds the account (or its API token) can read every friend's model login and every room. The notes say this for two people who trust each other; for a group it must be said to each person on joining. **Fix:** one line on the join screen: "[payer] runs this fabrika and can read everything in it, your agent's login too." 85%. At company size this is why companies want their own account. |
| 24 | The box's edge swaps a stand-in token, and "how the edge reaches a brain on Cloudflare ... is not designed" ([agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md) open 1) | **strains** | With no Mac, this is the only path, not a later one. **Fix:** move open item 1 into Tier 4 as a requirement, designed for a container box first. 75%. Unknown: whether Cloudflare Containers let the Worker sit in the box's outbound path. |
| 25 | A box with open internet runs on private repos only (OpenAI's page, quoted in agents behind one service) | **strains** | A group of friends often hacks in public. **Fix:** say so on the project setup screen, and keep public repos to the stand-in token path. 65%. |

### Secrets, the bot, rooms, money

| # | Decision | Verdict | Why, and the smallest fix |
|---|---|---|---|
| 26 | The bot's one key sits in Cloudflare's Secrets Store, shared by every worker in one account (agents commit as a bot) | **holds** | One Cloudflare account per group, one store. Secrets Store is "open beta" ([docs](https://developers.cloudflare.com/secrets-store/)), so a note that a beta is load-bearing. |
| 27 | `fabrikalfa` is owned by kamp-us, one bot for every project its owner runs; "a self-hoster makes their own app" (same note) | **strains** | Every friend group is a self-hoster, so every group must make a GitHub App by hand, which is many steps. **Fix:** the install makes the app with GitHub's app manifest flow (one page, one click), named after the group, and puts its key in the group's Secrets Store. One bot per install. 70%: the manifest flow was not tried here. |
| 28 | Pull requests "as me" need one GitHub sign-in per person (same note) | **holds** | Each friend signs in once from their own browser. The bot path needs nothing. |
| 29 | Every room is readable by everyone on the project, DMs included ([summon guidelines](../docs/direction/summon-guidelines.md) R2) | **holds** | Fine for friends, who share everything anyway. At company size it strains: dozens of people reading each other's DMs with agents. The ledger note's answer stands: "A person who should not see some tickets is on another ledger." Write that for rooms too. |
| 30 | Talking to another person's agent bills its owner (summon guidelines R2, T3) | **holds** | Right for friends: each pays for their own model plan. |
| 31 | One meter for money; Cloudflare's $5 plan is assumed ([one ask and one meter](../docs/direction/one-ask-and-one-meter.md), AGENTS.md) | **strains**, decided (owner, 2026-11-08) | Model use is per person (their own plans). But container time, Durable Objects and storage all land on the payer's bill, with no record of who started what. Workers Paid is "$5 USD per month" with 10 million requests; Containers include 25 GiB-hours of memory and 375 vCPU-minutes a month ([Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Containers](https://developers.cloudflare.com/containers/pricing/)). **Fix:** each charge records container seconds and the person who started the job, so the payer sees who used what, and a soft line per person. 75%. Record it from the first container job: who started it is lost if not written then. |
| 32 | Inputs carry their sender; "two people on one desk break the stamp" ([inputs carry their sender](../docs/direction/inputs-carry-their-sender.md)) | **holds** | Each friend has their own desk in their own browser. The broken case, two people at one desk, does not come up. |

Question 20 (what names the door's start in `InputId`) does not touch this case. It holds.

## What changes in Tier 1

- **Who it is for.** Tier 1 says "one person and their agents" and builds the founding, the
  approvals and recovery around a Mac. The person can stay one. What changes is that this one
  person may have only a browser and a phone.
- **Moves into Tier 1** (each is small, and each records a fact that is lost if it waits):
  - The founding link from `fabrika up --cloud` (row 1). Dropped by the narrowing: setup may use a Mac.
  - The passkey as a person key, and question 19 answered "a tab with a passkey may approve"
    (rows 8, 9, 10). This settles question 19 before P10 merges, as the plan needs.
  - The approve row in any person-key client's inbox, not only the menu bar (row 9).
  - Recording each passkey's backup flags at grant time (row 11).
  - Recovery words that say "device", and the sheet on the web client's first screen (row 17).
  - The final address picked at install (row 13).
- **Stays in Tier 3:** a second person, invite links, a second owner, re-invite as recovery
  (rows 2, 3, 7, 19). Write now only that `for` names a person id (row 6).
- **Moves up from Tier 7:** "phone as approver" (it is row 8) and "a real domain" (row 13).
  "More than two people, roles" can stay in Tier 7 as long as Tier 3's invite takes any number.
- **Stays in Tier 4 and 5, with a new first kind:** container hands on Cloudflare (row 22), the
  box's edge to a remote brain (row 24), the per-person meter for container time (row 31).
- **Grows with size, not needed for friends:** admin approval of invites, more than two owners,
  private rooms or a second ledger, Access past 50 people, a recovery group.

## What this cannot tell us

- No passkey was made against a `workers.dev` address. Whether WebAuthn accepts that address as
  its domain is a guess, 75% sure: `workers.dev` is on the public suffix list, which should make
  each account's subdomain its own site. One try on a test deploy settles it.
- Whether OpenSSH can re-check a WebAuthn signature with `ssh-keygen -Y verify` (row 10) was not
  tried.
- Container prices and the Sandbox SDK's beta status come from Cloudflare's pages today, not from
  a bill. Nobody measured a real friend group's month.
- The industry quotes came through a fetch tool; recheck exact words before quoting them in a
  published page.
- The five layers doc was not read for this audit.
