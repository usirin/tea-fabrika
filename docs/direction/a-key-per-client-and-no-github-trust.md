---
state: "decided 2026-11-05"
summary: "`next/`. Each client signs `initialize` with its own key pair; the person key grants each new client in SSHSIG's shape. No key is ever let in because GitHub lists it: GitHub's key list is at most a way to look one up. A second person (Tier 3) joins by invite and approval, the same flow as a new tab, and `next/` depends on GitHub as little as it can. Today's version keeps its GitHub sign-in until `next/` replaces it. Answers Tier 1's question 10."
---

# A key per client, and GitHub is never a way in

**Decided by the owner, 2026-11-05.** This is about `next/`. Today's version keeps its GitHub
sign-in until `next/` replaces it. It answers Tier 1's open question 10.

Its decided rules are in: [0322](../../.decisions/0322-a-key-per-client-github-never-a-way-in.md),
[0323](../../.decisions/0323-an-invite-is-a-one-day-link.md).

```ts
// A sketch, next/. Two keys, two jobs, and no third party.
send(initialize({key: tab.publicKey, signed: yield* tab.sign({nonce, url, tab})})); // each client, its own key
// unknown key: {why: "not_granted"}. The person says yes once, with the person key, in SSHSIG's shape:
{_tag: "granted", key: tab.publicKey, for: person, as: "window", signed: sshsig(personKey, grantText)}
// What GitHub's key list may do, at most, in a later tier: help a person find a key to paste.
// It never writes `granted`, and no key passes the door because GitHub lists it.
```

- **Each client signs `initialize` with its own key pair.** A browser tab keeps a WebCrypto key, an
  Electron window and the menu bar extra keep theirs sealed on the Mac, and an agent's bridge keeps
  its own. This is the five layers' T5 as written.
- **The person key grants each new client,** and the grant is written in SSHSIG's shape, the one the
  door already checks (the Tier 1 detail's call 2). Revoking is one fact.
- **No automatic GitHub trust, ever.** A key is never let in because GitHub lists it for a login.
  GitHub's list is at most a way to look up someone's public key, never a pass in.
- **A second person joins the way a new tab does** (Tier 3): an invite, then the person who owns
  the fabrika approves, and that approval is the grant. No new way in.
- **Depend on GitHub as little as possible in `next/`.** GitHub stays the code host, reached through
  a typed service. Who may be in a fabrika is the fabrika's own fact, never GitHub's.

## Why

- **The door keeps one check.** Every way in is a signed grant from the person key. A second rule
  ("or GitHub lists it") would be a second door, and the weaker one decides.
- **A key on GitHub is not a yes.** Anyone who can add a key to an account, or who holds one of
  its old keys, would be let in with no person saying so. The five layers' T5 says "nothing joins
  without its person saying so", as Signal's linked devices and Tailscale's node approval do.
- **The industry's way.** Signal links a device by a scan on a device already in; Tailscale
  approves each node; SSH itself trusts only `authorized_keys`, which a person writes. None trusts a
  public key list it does not own.

## What it changes

- **Tier 1:** nothing in its shape. P9 and P10 already build a key per client and a person-signed
  grant. The open question is closed.
- **Tier 3:** "GitHub as a keys source" leaves the tier. A second person comes in by invite and
  approval; looking up a key on GitHub, if ever built, only fills in a field a person then approves.
- **[The ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md):** its rule "every key
  GitHub lists for their login works" holds for today's version only.

## What it costs

- A person with a new machine gets one Approve, from a client already in, or the backup sheet (P5),
  instead of signing in with a GitHub key they already have.
- Tier 3's join flow cannot lean on GitHub logins for names; a person types or pastes them.

How sure: 90%. The owner decided it. The doubt is only Tier 3's join screen, which no one has drawn.

## What it cannot tell us

- How a second person's invite is carried: *decided 2026-11-07 (owner):* a one-time link, also
  shown as a QR code, that expires in a day, sent by an admin or the owner; the ledger records the
  join and who invited ([Tier 3's invites](../plan/tiers.md#tier-3s-invites-owner-2026-11-07)).
  It said: a code, a link or a QR, open until Tier 3.
- Whether a lookup on GitHub is worth building at all. Nothing needs it yet.
