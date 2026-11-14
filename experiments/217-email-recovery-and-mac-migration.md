---
date: "2026-11-06"
scripts: "none"
summary: "`next/`, for the backup note (PR 404); reading only, not a measurement. Sending: $0 on Cloudflare's free plan through Email Routing's `send_email` to the person's one verified address, which needs a domain on Cloudflare DNS; with no domain, Access's one-time PIN in front of the Worker (free to 50 people, not tried). Resend, Postmark and SES each add an account and a party. The careful tools keep email out of a takeover or put it second (Bitwarden, 1Password, Proton; Tailscale has none); NIST 800-63B rev 4 bars email for sign-in and wants two recovery codes at two-factor level. Lean: a 6-digit code typed on the asking Mac, a notice to every live Mac, and a wait a live Mac can stop; the sheet skips it. Tailscale is the lead reference: tailnet lock is the person key granting, its disablement secrets are blunter than the sheet, and it leans on an outside identity provider fabrika does not have. Migration Assistant, from a Mac or Time Machine, likely carries the \"<app> Safe Storage\" item (login Keychain file, not ThisDeviceOnly, never iCloud), the app folder and the local stage; a hand copy fails on macOS 26.4+; a missing item makes Chromium silently make a new key, so the app must route to recovery. No product matches the proposed key ranks whole; only Matrix ranks a person's own keys. One change to a decision: \"no wait\" fits the sheet, not email. Five research subagents, tokens not logged, $0."
---

# Email recovery, a recovery sheet, and what a new Mac gets back

Read 2026-11-05 and 2026-11-06. **This is research, not a measurement.** Nobody sent an email,
ran a recovery, moved a Mac or watched a person. It reads vendor docs, standards, changelogs and
issue threads. Each link was read on one of those two days; a claim marked *unverified* was seen
only in a search snippet, a forum or a second-hand page. No model, $0 (five research subagents,
their tokens not logged).

It is for `next/` only, for the backup's design pass: the proposed note
[A lost Mac comes back with a recovery key on paper](../docs/direction/recovery-key.md)
([PR 404](https://github.com/usirin/tea-fabrika/pull/404)) and experiment 216
([PR 405](https://github.com/usirin/tea-fabrika/pull/405)). The owner decided on 2026-11-05 to offer
**both** ways back: email recovery and the recovery sheet. This write-up asks what each needs. It
changes no note.

**What the owner decided after reading this, 2026-11-06** (in
[account recovery](../docs/direction/recovery-key.md)). Where a lean below differs, the decision wins,
and the lean stays here as written:

- **The wait is 24 hours,** not the "3 days" placeholder, and any live device cancels it with no finger.
- **No third way.** "Sheet and email together skip the wait" is dropped: the sheet alone is instant.
- **Every device the person owns is a master.** The rule "a person key may not add or drop another
  person key", which this kept at 65%, is dropped. Devices are equal roots in the grant tree.
- **The facts are `verified`, `requested` and `canceled`.** The sketch's `asked`, `stopped` and
  `waitUntil` are not used: the brain's email key signs the final `added` only after the wait.
- **The code is good for 10 minutes and 5 tries,** only its hash kept, never in the ledger.

```text
The two ways back, as fabrika could hold them (a sketch):

  the sheet    12 words on paper   a key the person holds   strong   works at once, once
  email        a 6-digit code      a key the brain holds    weak     works after a wait a live Mac can stop
  both         words and code      -                        -        the way to skip the wait

  what lets the brain trust an email:  the person's mail account (an outside party, like GitHub would be)
  what sends the email for free:       Cloudflare, on the account the brain already runs on
  what a new Mac gets with no cloud:   its files, and maybe its Keychain; neither is a plan to lean on
```

## The answer first

1. **Sending the email is free on Cloudflare, with a catch.** Email Routing's `send_email`
   binding sends to *verified* addresses for $0 on the free Workers plan, and one person mailing
   themselves is exactly that case. It needs a domain whose DNS is on Cloudflare. With no domain,
   Cloudflare Access's one-time PIN sends the code for us, free up to 50 people, on a Worker's own
   address. Both keep the outside parties to Cloudflare, which already runs the brain. Sure: 75%.
2. **The industry does not let email alone take over a strong account at once.** NIST's 2025
   rules forbid email for sign-in proof and want two independent recovery codes at the two-factor
   level. Bitwarden uses an email code only as a second check, 1Password pairs it with a recovery
   code and a wait, Proton lets email reset the password but not open the data, Tailscale has no
   email path at all. Lean: email recovery waits (Apple's "several days", 1Password's 24-hour block),
   a live Mac can stop it, and the sheet skips the wait. Sure: 75%.
3. **A Mac moved with Migration Assistant, from the old Mac or from Time Machine, most likely
   keeps its keys and its local stage.** The "<app> Safe Storage" item is in the login Keychain
   file, which moves; "ThisDeviceOnly" does not apply to it; iCloud never carries it; a hand copy of
   the Keychain fails on macOS 26.4 and later. If the item does not come across, Chromium silently
   makes a new one and every sealed key fails to open, so the app must send the person to the
   recovery screen, never found anew. Sure: 75%; one real move settles it.
4. **Products that offer both make the strong one first and the weak one a fallback.** Proton
   labels each method by what it brings back; Apple turns its own recovery off when you make a key;
   1Password asks for both at once. Lean: one setup row each, the sheet named first; on a new Mac,
   two buttons, and the email path says the wait out loud. Sure: 70%.

**Tailscale is the closest product** and the lead reference ([below](#tailscale-the-lead-reference)).
Its tailnet lock is fabrika's person-key granting, nearly piece for piece. The big difference: who a
person is comes from an outside identity provider, and fabrika has none. Email recovery would make
the person's mail account fabrika's one identity provider, for one fact.

**What each key may do:** no product matches the proposed rule whole
([below](#what-each-key-may-do-in-each-product)). Keybase and Apple let any device add and remove any
other; Signal and WhatsApp give one phone all the power; only Matrix ranks a person's own keys. A
recovery key that does one narrow thing, once, is stricter than anything shipped, which is fine for a
key with no password behind it. Sure: 70%.

**One thing should change a decision already made** ([below](#what-should-change-a-decision)):
"no wait" fits the sheet and does not fit email. Everything else holds.

## Tailscale, the lead reference

The owner named it the closest product. Each piece, what Tailscale does, and fabrika's piece.

| Piece | Tailscale | fabrika (`next/`, proposed) |
|---|---|---|
| Who the person is | Whatever the identity provider says: "Tailscale is not an identity provider", and "there are no Tailscale passwords" ([SSO](https://tailscale.com/kb/1013/sso-providers)) | The person key on the Mac, made at founding. No provider. With email recovery, the mail account vouches for one fact |
| A key per device | A machine key, made at install, never rotated, and a node key "generated each time a user authenticates" ([node keys](https://tailscale.com/kb/1010/node-keys)); "the private key never, ever leaves its node" ([how it works](https://tailscale.com/blog/how-tailscale-works)) | A key per client: each tab, window and agent makes its own Ed25519 key and keeps it |
| Expiry | 180 days by default, 1 to 180, renewed by a provider sign-in; can be turned off ([key expiry](https://tailscale.com/docs/features/access-control/key-expiry)) | None in Tier 1. A grant lives until revoked or its signer drops |
| Approval | Device approval: an admin clicks, Tailscale's server enforces it ([device approval](https://tailscale.com/kb/1099/device-approval)). Tailnet lock: "All new node keys must be signed by an existing Tailnet Lock key" ([lock](https://tailscale.com/docs/features/tailnet-lock)) | The person key signs a grant in SSHSIG; the door checks the signature. This is tailnet lock, with one signer instead of 2 to 20 |
| Signers | At least two signing nodes, at most 20; each node makes a lock key, you pick which to trust | One person key per Mac. A second Mac's person key comes only through the sheet in Tier 1 |
| Removing a lost device | Removal "immediately revokes its node key" ([remove](https://tailscale.com/docs/features/access-control/device-management/how-to/remove)). A lost signing node: `lock revoke-keys`, co-signed by several, and "nodes that were previously signed by a revoked key lose their authorization and require a new signature" | "Is your old Mac lost or stolen?" Yes drops its keys and every grant it signed, the same cascade |
| The paper | `lock init` "creates and displays ten disablement secrets", 32 random bytes each, stored only as an Argon2 hash; one used is "public" ([lock](https://tailscale.com/docs/features/tailnet-lock), [whitepaper](https://tailscale.com/docs/concepts/tailnet-lock-whitepaper)) | The sheet: 12 words, a key whose public half is on the ledger. Spent after one use |
| What the paper does | Turns tailnet lock **off for everyone**, then you start it again | Lets one new Mac in, and drops the keys the person picks. The ledger stays signed |
| A copy held by the service | Optional: "you can optionally generate a disablement secret for Tailscale support" | Email recovery is this: the brain holds a key that can let a Mac in, once it checks the mail |
| All devices lost | Sign in with the provider on a new device. With the lock on, it shows "Locked out" until a signing node signs it. No signing node left: a disablement secret. None left: "the tailnet cannot be recovered" | The sheet, or email after the wait. Neither: the founded name is gone, as Tailscale says |
| Still trusted | The provider for identity; the server for availability, rules, relays and the first lock setup ("customers must initially trust Tailscale's control plane") | Cloudflare for availability and the first `founded`. With email: the person's mail provider |

What this tells fabrika:

- **The match is close where it counts.** A signature from a key the person holds, not a server's
  say-so, is what lets a device in. Tailscale built tailnet lock because "You have still needed to
  trust our coordination server" ([blog](https://tailscale.com/blog/tailnet-lock)). The person key
  granting in SSHSIG is the same move, made first instead of added later.
- **Tailscale leans on an outside provider for who you are, every 180 days and on every new
  device.** fabrika has no provider, by the owner's rule of 2026-11-05 (no GitHub trust, ever). So
  fabrika needs what Tailscale gets for free from Google or GitHub: a way back with no device. The
  sheet is that way. Email is a small provider: it vouches for one fact, once, after a wait.
- **Tailscale's paper is blunter than ours.** A disablement secret drops the lock for the whole
  tailnet; fabrika's sheet lets one Mac in and keeps every other rule. Tailscale's is also never the
  only path: the provider sign-in still works. fabrika's sheet is the only path when email is off.
- **Tailscale has no email path and no passkey recovery.** "Tailscale does not support sign-up with
  email addresses"; passkey sign-in is beta, can only join, and "If the tailnet for a given passkey
  username is deleted, the tailnet cannot be recovered" ([passkeys](https://tailscale.com/kb/1269/passkeys)).
  Their advice for a provider outage is a second admin who signs in with a passkey
  ([passkey admin](https://tailscale.com/docs/reference/tailnet-passkey-admin)): a second, independent
  way in, made ahead. That is the sheet next to email.
- **Their copy for support is the honest frame for email recovery.** Giving the service a way to
  help you is a choice the person makes, off by default, and named plainly.

## 1. Sending email from Cloudflare for free

**Answer: yes, $0, if the person's own address is the only one we mail.** That is our case: one
person, mailing themselves.

| Route | Price | Needs | Can send to |
|---|---|---|---|
| [Email Routing's `send_email`](https://developers.cloudflare.com/email-service/platform/limits/) | $0 on every plan, Workers Free included: "Sends to verified destination addresses are always free" | A domain on Cloudflare DNS with Email Routing on; the address verified once by a click; "You can only send from your routing domains" | Only verified addresses, up to 200 per account ([addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)); a binding can be pinned to one with `destination_address` ([bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)) |
| [Email Sending](https://developers.cloudflare.com/email-service/platform/pricing/) (beta since [2026-04-16](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/)) | Workers Free: "Not available". Workers Paid ($5 a month): "3,000 included per month, then $0.35 per 1,000 emails" | "You must be using Cloudflare DNS to use Email Service"; SPF, DKIM and DMARC records added for you ([setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)) | Anyone, after onboarding, with a "conservative daily quota" at first |
| [Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) | Zero Trust Free: $0, 50 users ([plans](https://www.cloudflare.com/plans/sase-zero-trust.md)) | Access turned on for the Worker ([2026-08-14](https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/): one switch, covers the Worker's own address); no domain of ours | The allowed address. Cloudflare sends it from `noreply@notify.cloudflare.com`; "This secure PIN expires 10 minutes after the initial request"; "Each PIN is single-use" |
| [MailChannels](https://www.mailchannels.com/pricing/) | The free Workers deal ended on 2024-08-31. Its Email API has a free plan: 3,000 a month, 100 a day | Its own account and a `_mailchannels` record on our domain (*unverified*) | Anyone |
| [Resend](https://resend.com/pricing) | 3,000 a month, 100 a day | Its own account; with no domain, from `onboarding@resend.dev` "to the user's own address" ([setup](https://resend.com/setup.md)) | Own address only, until a domain is verified |
| [Postmark](https://postmarkapp.com/pricing) | 100 a month, "No Credit Card Required" | Its own account; manual approval before mail leaves your own domains ([approval](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work)) | Own domains only, until approved |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | Free only through AWS credits for 6 months, then $0.10 per 1,000 | An AWS account with a card; requests signed with SigV4 | Sandbox: "only send mail to verified email addresses", 200 a day ([sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)) |

Also seen: Mailgun's free plan is 100 a day, its sandbox sends to at most 5 authorized addresses
([sandbox](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox)).
SendGrid retired its free plan in 2025 (*unverified*). Brevo says 300 a day free (*unverified*).

Lean, in order:

1. **The person has a domain on Cloudflare:** Email Routing's binding, pinned to their one address.
   Why: $0 on the free plan, no new account, no new party, and the pin means a bug cannot mail anyone
   else. Cost: a domain (about $10 a year at Cloudflare's registrar, *unverified* price), one DNS
   setup, one verify click. Sure: 80%.
2. **No domain:** Access's one-time PIN in front of the Worker's recovery page. Cloudflare sends and
   checks the code; the Worker reads who passed with `ctx.access.getIdentity()`. Why: $0, no domain,
   and still no party beyond Cloudflare. Cost: the recovery page is a browser page, not the app's
   screen, so the new Mac shows a short code to match (question 2). Sure it works end to end: 50%;
   nobody has tried Access on a Worker with the one-time PIN as the only login. One try on a test
   account settles it.
3. **Not Resend, Postmark or SES** for Tier 1. Each is a new account and a new party that sees the
   person's address and the code. AGENTS.md says no new paid accounts; these are free, but each adds a
   place a code can leak from.

What the free route cannot do:

- **Mail anyone but the person,** with no domain. Every free path is "your own inbox" until a domain
  is verified. Fine for Tier 1; Tier 3's invites would need Email Sending and Workers Paid.
- **Promise the inbox.** Cloudflare says "inbox placement problems are common" for new, low-volume
  domains ([deliverability](https://developers.cloudflare.com/email-service/concepts/deliverability/)).
  A recovery code in spam is a recovery that waits until the person looks there.
- **Work with the domain's DNS elsewhere,** for both Cloudflare mail routes.
- **Stay put.** Email Sending is beta; the Access-on-Workers switch is three months old.
- **Mail a changed address safely.** The verified address is set once. Changing it is a person-key
  act, and OWASP says not to trust "recently added or changed recovery information"
  ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)).

**Which account.** The brain on Cloudflare runs on the person's own Cloudflare account. Both
Cloudflare routes live in that same account, so no new account is needed. Whether that account has a
domain on Cloudflare DNS is a fact about the person, not about fabrika: the founding screen has to ask
or look.

## 2. How developer tools do sign-in and recovery by email

**Answer: the careful ones keep email out of the takeover path, or put it second.** Where email is
the way in, it is a 6-digit code next to a link, good for 10 minutes, used once, with a notice to the
person. None of them would let one email silently replace every device.

| Product | Email path | What else |
|---|---|---|
| [Linear](https://linear.app/docs/login-methods) | A link and a code in one email | Passkeys; sign out of "all other sessions" |
| Cursor | A 6-digit code, 10 minutes, one use, if it runs WorkOS defaults ([WorkOS](https://workos.com/docs/authkit/magic-auth)) | *unverified* for Cursor itself |
| [Vercel CLI](https://vercel.com/changelog/new-vercel-cli-login-flow) | Dropped: email login "no longer supported beginning February 26, 2026", "To prioritize user security" | OAuth device flow; "verify the location, IP, and request time before granting access" |
| [Zed](https://zed.dev/docs/authentication) | None. GitHub sign-in in the browser | Recovery belongs to GitHub |
| [Raycast](https://manual.raycast.com/account-management) | Email on the website; link or code *unverified* | Google, GitHub, Apple |
| [Warp](https://docs.warp.dev/support-and-community/troubleshooting-and-support/troubleshooting-login-issues) | An email link; fallback is to copy a token from the page into Warp | That copy step is a phishing shape |
| [Tailscale](https://tailscale.com/kb/1013/sso-providers) | None: "Tailscale does not support sign-up with email addresses" | A trusted node signs new nodes |
| [Bitwarden](https://bitwarden.com/help/new-device-verification/) | An emailed one-time code on a new device, after the master password | Skipped with any two-step method on; email is a second check, never the key |
| [Slack](https://slack.com/help/articles/212681477-Sign-in-to-Slack) | A confirmation code | A QR from a signed-in desktop to sign in a phone |
| [Notion](https://notion.com/help/log-in-and-out) | A code | "You may receive an email alert if you log into Notion from a new device"; "This was not me" logs it out |

The attacks, and what stops each:

- **Mail scanners spend one-use links.** Gateways open every URL, so the token is gone before the
  person clicks ([Supabase](https://github.com/orgs/supabase/discussions/41618)). Stop: a code, not a
  link; or a link whose page spends nothing until a button is pressed.
- **Whoever owns the mail owns the account.** Truffle Security bought dead startups' domains, rebuilt
  old work addresses, and got into Slack, Notion and Zoom through email resets
  ([Truffle](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw)). For
  fabrika this is the cost of email recovery, stated plainly: **the mail account becomes a master key,
  after the wait.** Stop: the wait, a live Mac's stop, and the sheet as the strong path.
- **Phishing the code in real time.** The attacker starts a recovery on their Mac, and the person is
  talked into reading out the code. Storm-2372 did this with device codes
  ([Microsoft, 2025-02-13](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)).
  RFC 8628 says the server "SHOULD display information about the device"
  ([§5.4](https://www.rfc-editor.org/rfc/rfc8628#section-5.4)). Stop: the email names the asking Mac
  (its name, the time, the place as recorded and never trusted) and says "fabrika will never ask you for
  this code"; the code is typed only on the asking Mac; and the wait gives a live Mac time to say no.
- **Link to the wrong site.** A reset link built from a request header can point at the attacker
  ([PortSwigger](https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning)).
  Stop: a code has no link; the brain's address is fixed, not read from the request.

What the standards say:

- **NIST SP 800-63B rev 4** ([§3.1.3.1](https://pages.nist.gov/800-63-4/sp800-63b.html)): "Email SHALL
  NOT be used for out-of-band authentication", for "Interception in transit or at intermediate mail
  servers" and DNS rerouting. Codes "issued as recovery codes ... are not authentication processes",
  so email recovery is allowed, but: a code mailed for recovery is good for "24 hours" (§4.2.1.2);
  recovery at the two-factor level needs "Two recovery codes obtained using different methods" or a
  code plus a bound device (§4.2.2.2); and recovery "SHALL cause a notification" (§4.2.3).
- **NIST rev 3** ([§5.1.3.1](https://pages.nist.gov/800-63-3/sp800-63b.html)) said the same about email
  for sign-in.
- **OWASP's forgot-password sheet** ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)):
  tokens "Single use and expire after an appropriate period", PINs "between 6 and 12 digits", limit
  guesses, and "Notify the user through all applicable registered notification addresses".

What fabrika's email recovery would look like, from these (a sketch, names marked made up here):

```ts
// A sketch. The brain holds one key that may sign one kind of fact: "this mail was checked".
// Made up here: `mailed`, `checked`, the `email` rank, `waitUntil`.

// 1. The new Mac asks. It makes its person key and window key, and sends their public halves.
{_tag: "asked", for: "<person>", adds: {_tag: "person", key: "...p2", window: "...w2"},
  where: "MacBook Air", sentAt: "..."}                 // `where` recorded, never trusted

// 2. The brain mails a 6-digit code to the one verified address. The code is kept only as a hash,
//    good for 10 minutes, at most 5 tries, then a new code and the count goes on (NIST §3.2.2).

// 3. The person types the code on the new Mac. The brain's email key signs one fact:
{_tag: "added", add: {adds: {_tag: "person", key: "...p2", window: "...w2"}, drops: [],
  saw: {how: "email", check: "code", old: "lost"}, waitUntil: "<arrivedAt + the wait>"},
  signed: sshsig(brainEmailKey)}

// 4. Every live Mac and the mail get a notice at once: "A Mac named MacBook Air asked to come in
//    with your email. It gets in on <date>. Not you? [Stop it]". A live person key's `stopped`
//    fact ends it. If nobody stops it, the fold admits p2 and w2 when `waitUntil` passes,
//    and drops what the person picked, only then.
```

- **A code, not a link.** Why: scanners, and the code is typed on the asking Mac, so the session is
  bound to it. Cost: six digits typed. Sure: 85%.
- **The wait, with a stop.** Why: every product where the proof is weak waits (Apple "several days",
  1Password a day after a failed try, Bitwarden emergency access at least a day, Signal 7 days). Cost:
  a person who lost every device waits; the sheet is the way to skip it. Sure: 75%. How long is an
  owner call; 1Password's 24 hours and Apple's days bound it.
- **The brain's email key may sign only a person `added`, with a wait, and never a grant.** Why: it is
  the weakest key on the list, so it gets the narrowest job. Sure: 75%.
- **Off until the person turns it on,** like Tailscale's support copy. Why: it trusts an outside mail
  account, which the owner's no-GitHub rule says never happens by default. Sure: 70%.

## 3. What a new Mac gets back with no cloud

**Answer: a Mac moved with Migration Assistant, from the old Mac or from a Time Machine backup,
most likely gets everything: the app's folder, the local stage's SQLite files, and the login
Keychain with the "<app> Safe Storage" item, so the sealed person key opens.** A hand copy of the
Keychain does not work on macOS 26.4 and later, and iCloud never helps. Sure: 75%, because the one
test of the 26.4 change is a careful blog's, not Apple's. Nothing was run here, on purpose.

| What | Moves with Migration Assistant | From a Time Machine backup | Source |
|---|---|---|---|
| `~/Library/Application Support/<app>` (sealed keys, the Miniflare data, SQLite and its `-wal`) | Yes: "everything in your user account" | Yes, unless the app flags it out; taken from a snapshot, so the db and `-wal` are from one instant, as after a crash (an inference) | [Apple 102551](https://support.apple.com/en-us/102551), [what isn't backed up](https://eclecticlight.co/2025/05/02/what-isnt-backed-up/), [snapshots](https://eclecticlight.co/2020/07/29/time-machine-and-snapshots/) |
| The login Keychain, with "<app> Safe Storage" | Yes: "Migration Assistant does copy the contents of the login keychain successfully", tested on 26.6.2 and 27.0 RC | Yes since 26.4: Time Machine "Added the protected directory at /var/db/SystemKeys to backups", and migrating "now copies any required keychain entropy files" | [Eclectic Light, 2026-09-11](https://eclecticlight.co/2026/09/11/keychain-copying-migration-and-upgrading-vms/), [2026-10-03](https://eclecticlight.co/2026/10/03/what-changed-in-macos-tahoe-26-4-take-2/) |
| The same Keychain file, copied by hand | No, on 26.4+: "you need both the keychain password and the protected entropy file" | No | [TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains) |
| Local Items (the data protection keychain), Secure Enclave keys | No; "only the Secure Enclave that created the key can make use of the key" | No | [Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave); Local Items not moving is a forum report (*unverified*) |
| iCloud Keychain | Does not carry it: Chromium's item is not `kSecAttrSynchronizable` | n/a | [kSecAttrSynchronizable](https://developer.apple.com/documentation/security/ksecattrsynchronizable), [Chromium keychain_v2.mm](https://chromium.googlesource.com/chromium/src/+/main/crypto/apple/keychain_v2.mm) |

The details that matter:

- **Which keychain.** Electron's `safeStorage` sits on Chromium's code, which calls `SecItemAdd`
  without `kSecUseDataProtectionKeychain` or `kSecAttrSynchronizable`. Apple: SecItem "defaults to
  targeting the file-based keychain" ([TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)).
  So the item is in the login Keychain file, the one that moves. Experiment 214 saw the item made
  there on Electron 45.2.1.
- **"ThisDeviceOnly" does not apply.** Apple: such items "do not migrate to a new device"
  ([Apple](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly)),
  but on macOS the flag works only with the data protection keychain or a synced item
  ([kSecAttrAccessible](https://developer.apple.com/documentation/security/ksecattraccessible)).
  Chromium passes plain `kSecAttrAccessibleWhenUnlocked`
  ([keychain_util.mm](https://chromium.googlesource.com/chromium/src/+/main/crypto/apple/keychain_util.mm)).
- **Encrypted backups.** On an iPhone, an unencrypted backup leaves keychain items out
  ([Apple 108353](https://support.apple.com/en-us/108353)). No Mac source says the same of Time Machine;
  one forum answer says it backs up the Keychain with no extra step (*unverified*). So the backup disk
  holds the sealed person key and what opens it, less the login password.
- **When the item is missing, nothing warns.** If the lookup finds no item, Chromium makes a new random
  key and stores it ([keychain_password_mac.mm](https://chromium.googlesource.com/chromium/src/+/main/components/os_crypt/common/keychain_password_mac.mm)).
  Every old sealed blob then fails to open, and `decryptString` throws "Error while decrypting the
  ciphertext provided to safeStorage.decryptString"
  ([Electron source](https://ayakael.net/mirrors/electron/raw/commit/1d6885c781b446987c53325d68f4ef13baeaa42a/shell/browser/api/electron_api_safe_storage.cc)).
  Signal Desktop users hit this exact error on a Mac and were told to erase and re-link
  ([thread](https://reddit.birdcat.cafe/r/signal/comments/1ilz950/database_startup_error_on_macbook_pro_desktop_app),
  *unverified*); browsers lose saved passwords the same way after a move (*unverified*, forums). Note
  for the builder: Electron 46 removed the sync `safeStorage` calls, and the async API has
  `isTemporarilyUnavailable` and `shouldReEncrypt`, which its docs do not explain
  ([docs](https://raw.githubusercontent.com/electron/electron/main/docs/api/safe-storage.md)).
- **A new password on migration.** Migration Assistant now has you set a new password for a migrated
  admin account ([Apple 102613](https://support.apple.com/en-us/102613)). Whether the login Keychain
  keeps the old one, and asks at first login, was not researched.

What it means for fabrika:

- **A calm move to a new Mac needs no sheet and no email,** if the person uses Migration Assistant.
  The person key, the window key and the local stage come across. Lean: let them, and say so in the
  sheet's copy ("Moving to a new Mac? Migration Assistant brings fabrika with it"). Why: the daily
  moment first, and it spends no sheet. Cost: nothing to build. Sure: 70%, until one real move.
- **The app must catch a missing key, never make a new founding.** A sealed person key that will not
  open is a third way into the recovery screen: "This Mac's keys did not come across. [I have a backup
  sheet] [Email me a code]". The note already says the app "never makes new keys by itself"; this names
  the case. Sure: 85%.
- **The local stage is not lost after all, for a move.** The note says the local stage "goes with" a
  lost Mac. True for a lost Mac with no backup. With a Time Machine backup, the Miniflare folder comes
  back with the Mac.
- **A Time Machine disk is a copy of the person key,** sealed, opened by the login password. A stolen
  backup disk plus the password is the "stolen Mac with its password" story in the note. Lean: say
  "encrypt your Time Machine backup" in the sheet's help, and do not flag the key out of backups. Why:
  flagging it out makes every restore need the sheet. Sure: 60%; the owner may weigh it the other way.
- **A restored Mac after a recovery is refused,** as the note says: its keys were dropped. This now
  has a source behind it, since the restore really does carry the old keys.

## The two ways together

**Answer: the products that offer more than one way rank them, and say what each brings back.**

- **Apple** ([recovery key](https://support.apple.com/en-us/109345)): "When you set up a recovery key,
  you turn off Apple's standard account recovery process." The key works only "with ... a verification
  code sent to your trusted phone number". For Advanced Data Protection you "decide if you want a
  recovery key or a recovery contact" ([ADP](https://support.apple.com/en-us/108756)); a contact "won't
  have any access to your account, only the ability to give you a code"
  ([contact](https://support.apple.com/en-us/102641)). Without either, recovery "can take longer".
- **Proton** ([methods](https://proton.me/support/set-account-recovery-methods)): one table with two
  columns, "Password reset?" and "Data recovery?". The phrase does both; email and phone only reset the
  password, marked "Combine with a data recovery method". At reset: "Email verification gets you back
  into your account, but you may lose access to your pre-existing data", and "Try another way" moves
  between methods ([reset](https://proton.me/support/reset-password)).
- **1Password** ([recovery codes](https://support.1password.com/recovery-codes/)): both at once. "You'll
  need access to the email address associated with your 1Password account", and the code; "Wait at
  least one hour" after making one, and a stopped recovery blocks the code "a day".
- **Bitwarden** ([new device](https://bitwarden.com/help/new-device-verification/)): the master password
  is the key; email is a second check on a new device, never a way in alone.

Lean for fabrika: **the sheet is the strong way, email is the fallback, and both together skip the
wait.** Why: it is Proton's ranking and 1Password's pairing, and it keeps "no wait" true for the sheet.
Cost: two rows in the menu bar instead of one, and one more button on a new Mac. Sure: 70%.

A screen sketch, in plain words:

```text
In the menu bar, under the person's name (quiet rows, never a popup):

  Ways back in
    Backup sheet     none yet                        [Make one]
    Email            off                             [Turn on]
                     A code to you@example.com lets a new Mac in after 3 days.
                     Any of your Macs can stop it.

On a new Mac's first screen:

  Welcome back to fabrika

  [I have my backup sheet]        Back in now.
  [Email me a code]               Back in after 3 days, unless one of your Macs says no.
                                  Have your sheet too? Then no wait.
  [Start a new fabrika]

After "Email me a code":

  We sent a 6-digit code to y••@example.com.
  It says this Mac's name, "MacBook Air". fabrika will never ask you for it anywhere else.
  Code: [ _ _ _ _ _ _ ]

  Is your old Mac lost or stolen?   [Yes, remove it]   [No, I still have it]

  Done. This Mac gets in on 9 Nov at 14:20. We told your other Macs and your email.
```

- **Name the sheet first** on both screens. Why: it is the one that works with no wait and no outside
  party. Sure: 75%.
- **Say the wait and the stop out loud** where the person picks email. Why: a person who picks email in
  a panic must not think it failed. Sure: 80%.
- **Mask the address** on the new Mac. Why: a thief with the Mac should not learn the mail address.
  Cost: none. Sure: 70%.
- **"3 days" is a placeholder.** The length is an owner call; 1Password's 24 hours and Apple's
  "several days" bound it.

## What each key may do, in each product

The proposed rule ([recovery-key.md, question 6](../docs/direction/recovery-key.md)): a person key
may let in tabs, agents and its own Mac's window key, and may make a new sheet, but may not add or
drop another person key. A recovery key may only let in one new Mac (a person key and its window
key), once, and drop the keys the person picks. Email would add a third, narrower key: the brain's,
which may sign only a person `added` with a wait.

**Answer: no product matches the whole rule.** Most are flat (any device adds and removes any
other) or have one primary device that holds all the power. Only Matrix ranks a person's own keys,
and its recovery key unlocks the top one. A recovery key that does one narrow thing, once, is
stricter than anything shipped.

| Product | What the recovery secret does | One device adds a full device? | One device removes another? | Ranks among own keys |
|---|---|---|---|---|
| [Keybase](https://book.keybase.io/docs/crypto/kbfs) | A full device: "It's a full-powered key, just like a device key" ([cli](https://book.keybase.io/docs/cli)) | Yes: "Any active sibling key can provision or revoke another device" | Yes, any | None; the first key "can be revoked without affecting its other live siblings" |
| [Matrix](https://raw.githubusercontent.com/matrix-org/matrix-spec/main/content/client-server-api/modules/end_to_end_encryption.md) | Opens secret storage, which holds the master key too: near full power | Any device holding the self-signing key, which "signs the user's own device keys" | No signed step for it; logging out is an account act | Yes: the master key "signs their user-signing and self-signing keys". But a new master key can be uploaded with the account password ([cross_signing.yaml](https://raw.githubusercontent.com/matrix-org/matrix-spec/main/data/api/client-server/cross_signing.yaml)) |
| [Signal](https://signal.org/blog/a-synchronized-start-for-linked-devices/) | The PIN guards re-registering the number; not a device (*unverified*) | Only the primary phone links | Only the phone unlinks (*unverified*) | Two levels: phone and linked devices |
| [WhatsApp](https://faq.whatsapp.com/378279804439436) | None; you re-register with the phone number | "You'll still need your primary phone to ... link new devices" | The phone logs out any linked device | Two levels |
| [Apple](https://support.apple.com/guide/security/secure-keychain-syncing-sec0a319b35f/web) | The recovery key resets the password, with the trusted phone; a recovery contact only gives a code | Yes: "The sponsor adds the public key of the new member to the syncing circle" | Yes, any device or the web: "Remove from Account" ([102649](https://support.apple.com/en-us/102649)) | None among devices |
| [Tailscale](https://tailscale.com/kb/1226/tailnet-lock) | One thing: it is "required to globally disable Tailnet Lock" ([whitepaper](https://tailscale.com/kb/1230/tailnet-lock-whitepaper)) | Yes, any signing node adds a lock key or signs a node | Not alone: "requires several signing nodes to co-sign" | Weights only |
| [Bitwarden emergency access](https://bitwarden.com/help/emergency-access/) | View ("view/read access to all items") or takeover (a new master password that "will replace your previous master password") | n/a | n/a | n/a |
| [1Password](https://support.1password.com/recovery-codes/) | A full reset, "reusable"; then "sign in again on all your devices" | Any device with the Secret Key and password | From the website (*unverified*) | None |

What it means for the rule:

- **"A recovery key does one narrow thing"** has two precedents, Tailscale's disablement secret and
  Apple's recovery contact, and two counter-examples, Keybase's paper key and Matrix's recovery key.
  Ours is narrower than all four. That is a choice, and a good one: with no account password behind
  it, the sheet carries the whole job, so a narrow job is easier to reason about. Keep it. Sure: 75%.
- **"Once" has no precedent for a key that adds a device.** One-use recovery *codes* do (Google,
  Bitwarden; experiment 216). A one-use device-adding key is our own, so the exam must test it, as
  the note already plans.
- **"A person key may not add or drop another person key" is unusual.** Keybase, Apple and
  Tailscale's signing nodes all let a peer add a peer; Signal and WhatsApp let the primary do
  everything. The rule's only cover is Tailscale's co-signing for removal, and Signal's "a linked
  device cannot unlink the phone". Its cost was the calm move to a new Mac spending the sheet. Section
  3 takes most of that cost away: a move by Migration Assistant carries the person key and spends
  nothing. What stays: a second Mac kept beside the first. Lean: keep the rule for Tier 1, 65%; the
  doubt is a two-Mac person, and Tier 3's invites settle it.
- **Matrix's lesson for the email key:** rank keys by what they may sign, and never send the top key
  to a device. Matrix ships secret storage that hands the master key to every verified device, which
  undoes its ranks. The brain's email key must never leave the brain, and may sign one kind of fact.

## What should change a decision

The owner's calls of 2026-11-05, each checked against what came back.

- **No wait.** Holds **for the sheet**. Does not fit **email**: every product whose proof is weak
  waits or pairs it with a second secret (Apple, 1Password, Bitwarden emergency access, Signal), and
  NIST rev 4 wants two codes from different methods for recovery at the two-factor level. Lean: email
  recovery waits, a live Mac can stop it, the sheet skips it. **This is the one change.** Sure: 75%.
- **No passphrase on the sheet.** Holds. The products that add a second thing add a phone or an email
  code, not a passphrase. "Sheet and email together, no wait" is the same idea, offered and not forced.
- **Ask "Is your old Mac lost or stolen?"** Holds, on both paths. On the email path the drops happen
  only when the wait ends, so a stop also keeps the old Mac in.
- **A dropped key drops everything it let in.** Holds, with Tailscale: "Any nodes that were previously
  signed by a revoked key lose their authorization". Tailscale's calm `lock remove` re-signs by default;
  that is the note's "No, I still have it" branch.
- **A sheet works once.** Holds, and is our own for a device-adding key (above). Test it.
- **One live sheet.** Holds: everyone kills the old one (experiment 216).
- **New, not a reversal:** a Mac whose Keychain item did not come across goes to the recovery screen,
  never to a new founding. And the note's "Moving with Migration Assistant ... is a guess" now has a
  sourced answer: it likely just works.

## What it cannot tell us

- **Whether any of it works.** No email was sent, no Access login was tried, no Mac was moved. The
  Access one-time PIN on a Worker with no domain is the least sure piece (50%); one try on a test
  account settles it.
- **macOS 26.4's Keychain change rests on one careful blog** and Apple's TN3137, not on Apple's user
  docs. A real Migration Assistant move, and a Time Machine restore to a second Mac, would settle
  section 3. So would checking the first login after Migration Assistant sets a new password.
- **How long the email wait should be.** The sources bound it (24 hours to "several days"); none says
  what fits one person with a few Macs. An owner call.
- **Whether email lands in the inbox.** Deliverability for a new domain is a known weak spot, and
  nothing here measured it.
- **Signal and WhatsApp device powers** rest partly on search snippets; Signal's help center refused
  the fetcher.
- **Cursor, Raycast and Warp** publish almost nothing on code length, lifetime or notices; their rows
  are thin.
- **What the person's mail provider does.** Email recovery trusts the mail account, and how well that
  account is guarded (its own two-factor, its own recovery) is outside fabrika. That is the same kind
  of trust the owner refused for GitHub; offering it off by default, with a wait, is the only answer
  found, and the owner should see it named.
