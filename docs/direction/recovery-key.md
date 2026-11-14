---
state: "decided 2026-11-06, two email unknowns open"
summary: "`next/`, Tier 1's P5. Retitled 2026-11-06 from \"A lost Mac comes back with a recovery key on paper\", once both ways were offered. The sheet: a recovery key kept as 12 numbered words, printed first or saved as a PDF, joins `founded.keys` through an `added` fact. On a new Mac it lets in one fresh device at once, once; one question, \"Is your old Mac lost or stolen?\" (default yes), drops the old Mac and everything it let in, and the old Mac is told at once. No wait, no passphrase, a new sheet kills the old one, \"Check my sheet\" offline any time, no GitHub. Email, for the Cloudflare setup: a 6-digit code sent free through Cloudflare, every live device told, and a 24-hour wait any of them can cancel. Every device the person owns is an equal person key; an agent never is, and a tab cannot approve (lean 70%). A dropped key drops its whole grant tree, for Remove too. A Mac whose keys did not come across goes to the recovery screen, never a new founding. Open: whether email works with no domain, and whether the code reaches the inbox. From experiments 216 and 217."
---

# Account recovery: a sheet of 12 words, and email for the cloud

**Proposed 2026-11-05. Decided by the owner, 2026-11-06, except two unknowns on the email path.
The read call (call 13) and the key's derivation decided 2026-11-09, built by P28.**

Its decided rules are in: [0328](../../.decisions/0328-a-device-comes-back-by-sheet-or-email.md),
[0329](../../.decisions/0329-the-words-are-a-key.md),
[0330](../../.decisions/0330-words-become-the-key-by-hkdf.md),
[0331](../../.decisions/0331-a-sheet-works-at-once-and-once.md),
[0332](../../.decisions/0332-recovery-asks-if-the-old-device-is-lost.md),
[0333](../../.decisions/0333-every-device-is-an-equal-person-key.md),
[0334](../../.decisions/0334-a-dropped-key-drops-all-below.md),
[0335](../../.decisions/0335-the-sheet-is-printed-words.md),
[0336](../../.decisions/0336-a-recovery-ends-by-counting.md),
[0337](../../.decisions/0337-a-new-device-reads-before-recovery.md),
[0338](../../.decisions/0338-email-recovery-waits-a-day.md),
[0339](../../.decisions/0339-an-admin-can-re-invite-a-person.md),
[0138](../../.decisions/0138-email-recovery-lets-in-at-once.md) (replaces 0338's wait and cancel).

This is about `next/`. It is Tier 1's P5, the backup's design pass ([the plan](../plan/tier-1.md)),
and the owner reads it before anyone writes a test for P28. Nothing here is built. The research
behind several calls is experiment 216, how products do recovery kits
([PR 405](https://github.com/usirin/tea-fabrika/pull/405)), and experiment 217, email recovery and
what a new Mac gets back ([PR 406](https://github.com/usirin/tea-fabrika/pull/406)).

The industry calls this account recovery. Two ways back in are offered, and the person picks:

- **The sheet:** a recovery key kept as 12 words on paper or in a PDF. No email needed, and the way
  back for a local setup restored from Time Machine. It works at once.
- **Email:** for the Cloudflare setup. A 6-digit code to the person's checked address lets the
  device in at once, and every live device is told ([below](#email-recovery-decided-two-unknowns-open)).
  Decided too. Two unknowns stay open: whether the no-domain route works, and whether the code
  reaches the inbox.

A calm move to a new Mac needs neither. Migration Assistant most likely carries the keys across
(experiment 217), and any device the person owns can let in another ([call 7](#7-who-may-sign-what-decided)).

*Retitled 2026-11-06. It was "A lost Mac comes back with a recovery key on paper", until the owner
decided both ways are offered. The file name stays, so links hold.*

```ts
// A sketch. The sheet in one block: a second key, kept off the device, that lets in one new device, once.

// 1. While the Mac lives. Once, from a quiet row in the menu bar. The app makes a recovery key,
//    prints its 12 words, keeps only its public half, and signs one fact with the person key.
{_tag: "added", add: {adds: {_tag: "recovery", key: "ssh-ed25519 AAAA...r1", v: 1}, drops: [],
  saw: {how: "sheet", check: "touch", typed: true, kept: "print"}}, signed: sshsig(personKey)}

// 2. On a new device. The person types the address and the 12 words. The app rebuilds the recovery
//    key, makes a fresh person key and window key, and signs one fact with the recovery key.
{_tag: "added", add: {adds: {_tag: "person", key: "...p2", window: "...w2"}, drops: ["...p1", "...w1"],
  saw: {how: "recovery", check: "touch", old: "lost"}}, signed: sshsig(recoveryKey)}

// 3. The door checks it like a grant: SSHSIG, one namespace, one check. The fold then says:
//    p2 and w2 are in. p1, w1 and everything p1 let in are out, forever. The sheet r1 is spent.
//    The old device, if online, is told at once. Same ledger, same `founded`, same notes, same name.
//    The 12 words never left the new device.
```

## The answer first

- **The sheet holds 12 words in numbered slots, the address, and a short label** such as `r1-7f3a`.
  It is printed first, and a PDF is allowed. No QR in Tier 1.
- **The words are a key, not a password.** They rebuild an Ed25519 recovery key. Its public half
  joins `founded.keys` through an `added` fact. The door never sees the words.
- **A recovery key does one thing, once:** it lets in one new device (a person key and its window key)
  and drops the keys the person picks. Then it is spent. Making a new sheet kills the old one.
- **Every device the person owns is an equal person key,** as on Apple and Keybase. Any one may let
  in tabs, agents and other devices, and remove any of them. The sheet is the backstop. An agent is
  never one, and a browser tab cannot approve others (lean, 70%). *Changed 2026-11-07 (owner): a
  tab with a passkey made with user verification can approve, as an equal person key.*
- **A device whose keys did not come across goes to the recovery screen,** never to a new founding.
- **Recovery asks once: "Is your old device lost or stolen?"** The default is yes. Yes drops the old
  device and everything it let in, all the way down. The old device is told at once if online.
- **No wait and no passphrase,** for the sheet, ever. A stolen sheet stays the known hole. This
  matches products whose recovery secret is a strong key (experiment 216). Email does not wait
  either ([0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)).
- **The person meets the sheet twice in the life of a Mac:** once to make it, once to use it. "Check
  my sheet" is there any time, offline, and never nags.
- **No GitHub.** The owner decided on 2026-11-05 that no GitHub trust is automatic, ever.

## Which version

`next/` only. Today's version has no person key on a Mac and keeps its keys on GitHub
([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)). Nothing here changes it.

The sketches use the owner's 2026-11-05 words, which the plan uses too since its refresh
([PR 397](https://github.com/usirin/tea-fabrika/pull/397)): `initialize` for the first message, and
`sentAt` and `arrivedAt` for an entry's two clocks (today's code says `said` and `at`). `sentAt` is the writer's clock, shown and
never used to decide. `arrivedAt` is the referee's. Every entry carries `cause`, the id of the
input the door stamped. There is one ledger, a Durable Object everywhere: Miniflare on the laptop,
Cloudflare in the cloud.

## Which way, for which setup

| Setup | Way back after a lost Mac | What the person is told at setup |
|---|---|---|
| Cloudflare | The sheet, at once; or email, at once, with every live device told | Both are offered |
| Local, with Time Machine | Restore the Mac from it. If the keys did not come across, the sheet lets the new Mac's keys in | The sheet is offered |
| Local, no copy | None. A ledger that is gone cannot come back | "Your notes live only on this Mac." A plain warning, once, at setup |

**A move or a restore, from experiment 217** (75% sure, since nobody has moved a Mac yet; one real
move settles it):

- **Migration Assistant and Time Machine most likely carry the keys.** `safeStorage` keeps its
  "<app> Safe Storage" item in the login Keychain file, and that file moves with Migration
  Assistant, from the old Mac or from a Time Machine backup. iCloud Keychain never carries it, and a
  Keychain copied by hand fails on macOS 26.4 and later. So a calm move needs no sheet, and the
  local instance's ledger comes back with the app's home. The sheet's help says so: "Moving to a new
  Mac? Migration Assistant brings fabrika with it."
- **If the item did not come across,** Chromium quietly makes a new one, and every sealed key fails
  to open. **Then the app goes to the recovery screen, never to a new founding (decided):** "This
  Mac's keys did not come across. [I have a backup sheet]". It never makes new keys by itself, as
  the plan already says. The sheet then lets the new Mac's keys in on the restored ledger, the same
  as on Cloudflare.
- **A restored Mac after a recovery is refused,** since its keys were dropped. Experiment 217 shows
  a restore really does bring the old keys back, so this case is real.
- For a local setup, the sheet's address line reads "local, on <the Mac's name>".

## The known way

Every big product that keeps keys on a device has met this. Here is what each does, and what we
take. Experiment 216 reads about 20 products in more depth.

| Who | What the person keeps | What it can do | What we take |
|---|---|---|---|
| [Keybase paper key](https://book.keybase.io/account) | A long string of random words, linked to the account "the same way a device is" | Lets in a new device and revokes others, with no server help | The model: the sheet is one more key on the person's list, and the list lives in the signed record ([Keybase's sigchain](https://book.keybase.io/docs/server)). Also its public label: the first words name the key |
| [Apple recovery key](https://support.apple.com/en-us/109345) | A 28-character code, plus a trusted phone number | Account recovery with no trusted device. "Apple can't provide you with your recovery key" | Saying plainly that nobody can help, and confirming the key at setup |
| [Apple recovery contact](https://support.apple.com/102641) | A friend who can show a six-digit code | Helps you back in, and never gets access | Not in Tier 1. It needs a second person on the ledger, which is Tier 3 |
| [Proton recovery phrase](https://proton.me/support/recovery-phrase) | 12 words, offered as a PDF | Opens the account and its data | The precedent for a PDF of the whole secret, and for marking a spent method |
| [1Password Emergency Kit](https://support.1password.com/emergency-kit/) | A PDF with the address, email and Secret Key; the password goes only on a printed copy | Sign in on a new device | The address on the sheet. **Not** the precedent for a PDF: its PDF holds half the secret, ours holds all of it (experiment 216) |
| [Signal PIN and Registration Lock](https://support.signal.org/hc/en-us/articles/360007059792-Signal-PIN) | A PIN, and a recovery key for backups | Stops anyone else re-registering your number, until 7 days without use | The line "Signal will never message you for your recovery key", as "fabrika will never ask for these words" |
| [Bitwarden emergency access](https://bitwarden.com/help/emergency-access/) | A trusted contact's own key | The contact asks; after a wait the owner sets, access opens unless the owner rejects | Not for the sheet. A wait fits where another person or weak proof acts, so maybe for email |
| [Tailscale Tailnet Lock](https://tailscale.com/kb/1226/tailnet-lock) | Ten disablement secrets, "printing them and keeping them in a secure safe" | Trusted keys sign each new node. A revoked key's nodes "lose their authorization and require a new signature" | The paper, and the cascade: a dropped key takes what it let in with it |
| Trezor and Ledger | 12 to 24 words on a numbered card | Restore a wallet; Trezor's Check backup and Ledger's Recovery Check are dry runs | Numbered slots, and "Check my sheet" |
| [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) | 12 to 24 words from a list of 2048 | Rebuilds a wallet's keys on any device | The word list and its checksum, through a library ([below](#how-the-words-become-a-key)) |

**What none of them does:** trust an outside account to vouch for a new device without a secret
the person kept. That matches the owner's rule: no automatic GitHub trust.

## The data shape first

What exists only at the moment it happens, and is lost forever if not written then:

- **When the sheet is made:** the recovery key's public half, which person key signed it, how the
  person was checked (`check`), where (`where`, recorded and never trusted), whether they typed two
  words back (`typed`), and how they kept it (`kept`: printed, saved as a PDF, or written by hand).
  Also the sheet's version (`v: 1`), since a later sheet may use more words or a QR, and an old
  sheet must still be read the old way.
- **When the sheet is used:** which recovery key signed (the signer), the new person key and window
  key, which keys the person chose to drop, what they answered (`old: "lost"` or `"kept"`), how the
  new Mac checked them, and the new Mac's `has` and `platform`, recorded and never trusted.
- **Never written:** the words, the seed, or the recovery key's private half. Not in the ledger,
  not on the wire, not in a log, not sealed on the Mac. The app holds them in memory while the sheet
  is on screen, and drops them after. The same goes for "Check my sheet".
- **Written down as lost, on purpose:** a wrong sheet at the door. It is refused with the same
  answer as any unknown key, and only a count goes to the Worker's logs. Why: as with a knock,
  writing it would let anyone grow the log. Sure: 80%.
- **At email setup:** which address, and when it was checked (`verified`, in the
  [email section](#email-recovery-decided-two-unknowns-open)).
- **Each "Check my sheet" (decided, owner 2026-11-06):** when, which device, and whether it
  matched. Never the words. "When did they last know they had it" is what a lockout story asks
  later (experiment 216). The device writes one `checked` fact when it is next online, signed with
  its window key, so `by` is the device; `sentAt` is when the person checked, and is only shown.

```ts
{_tag: "checked", matched: true}   // by: the device's window key; sentAt: when; never the words
```

```ts
// A sketch. The new parts of next/packages/libfabrika/src/coordination/client-manager.ts.
// Names marked in "Made up here" are proposals.

/** What the person saw when a key was added. In the signed text, as a grant's `saw` is. */
export const AddSaw = Schema.Struct({
	// made a sheet; used one; a device let in by another device; by email; developer path
	how: Schema.Literals(["sheet", "recovery", "device", "email", "command"]),
	check: Schema.Literals(["touch", "click", "none"]),
	where: Schema.String,                 // recorded, never trusted
	has: Schema.Array(Schema.String),     // recorded, never trusted
	typed: Schema.Boolean,                // on "sheet": the person typed two words back
	kept: Schema.NullOr(Schema.Literals(["print", "pdf", "hand"])), // on "sheet": the button they used
	old: Schema.NullOr(Schema.Literals(["lost", "kept"])), // on "recovery": their answer
});

/** What joins. A union, so a sheet with a window key cannot be said. */
export const Adds = Schema.TaggedUnion({
	person: {key: Schema.String, window: Schema.String}, // a new device: its person key and window key
	recovery: {key: Schema.String, v: Schema.Literal(1)}, // a new sheet: the public half only
});

export const Add = Schema.Struct({
	id: Schema.String,
	for: Schema.String,    // the person; the signer must be one of their keys
	to: Schema.String,     // this ledger's name, so a signed `added` cannot be replayed elsewhere
	adds: Adds,
	drops: Schema.Array(Schema.String), // this person's keys that stop now, forever, with all they let in
	saw: AddSaw,
	sentAt: Schema.String, // the writer's clock, shown, never used to decide
});

export const MemberFact = Schema.TaggedUnion({
	founded: {id: Schema.String, name: Schema.String, keys: Schema.Array(Schema.String), window: Schema.NullOr(Schema.String)},
	granted: {grant: Grant, signed: Signed},
	denied: {key: Schema.String, saw: Saw, by: Schema.String},
	revoked: {key: Schema.String, saw: Took, signed: Signed},
	added: {add: Add, signed: Signed}, // new
});
```

The entry around each fact keeps `arrivedAt`, `by` (the checked signer), `cause` and `sentAt`, as
every entry does. `founded` is never rewritten. `founded.keys` stays the first list, and `added`
facts grow it.

## The calls

Each call is answered as branches: the case, then what happens. **Every call in this section is
decided by the owner, 2026-11-06,** whether or not its heading says so.

### 1. What is on the sheet, and in what form (decided)

```text
fabrika backup sheet                                   sheet r1-7f3a, made 5 Nov 2026
for        <the founded name>
address    https://<the ledger's address>

 1 ocean      2 tackle     3 ......     4 ......
 5 ......     6 ......     7 ......     8 ......
 9 ......    10 ......    11 ......    12 ......

These 12 words open your fabrika. We cannot get them back for you.
Keep this with your passport. fabrika will never ask for these words.
Only type them on a new device's first screen. It works once.
```

- **Numbered slots in a grid,** as Ledger's and Trezor's cards. The top failure after "never made"
  is words copied out of order (experiment 216).
- **The label `r1-7f3a` at the top,** the sheet's number and the first characters of its key's
  fingerprint. The menu bar shows the same label for the live sheet: "Backup sheet r1-7f3a, made 5
  Nov". A person holding a paper can tell if it is the live one without typing a word. The label
  is public and gives a thief nothing.
- **"fabrika will never ask for these words."** Phishing for recovery keys is a live attack on
  Signal users (experiment 216).
- **Print first, PDF allowed (decided).** The screen offers Print, then Save as PDF, then "I'll
  write them down". Proton is the precedent for a PDF of the whole secret; 1Password is not, since
  its PDF holds half (experiment 216). Two guards come with it:
  - **The old Mac is told at once on any recovery** (call 10).
  - **The save screen says where not to keep it:** "Not only on this Mac, and not in a folder that
    syncs everywhere. A password manager or a USB stick is fine." Apple and Proton both name the
    place the key unlocks.
- **Words, not a QR.** QR is already Tier 7 in the plan, and `v: 1` lets a later sheet carry one.
- **The address is on the sheet.** Without it a new Mac does not know where to go. It also tells a
  thief where to go, but anyone who knows the person can likely guess it.

### How the words become a key

```ts
// A sketch. next/packages/tuval/src/desktop/sheet.ts: pure, runs on Node in tests.
// @scure/bip39 2.4.0 and @noble/hashes 2.4.0, exact. Their subpaths end in .js.
import {entropyToMnemonic, mnemonicToEntropy, validateMnemonic} from "@scure/bip39";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {hkdf} from "@noble/hashes/hkdf.js";
import {sha256} from "@noble/hashes/sha2.js";

// 16 random bytes = 128 bits = 12 words with a 4-bit checksum (BIP39's table).
export const wordsFor = (entropy: Uint8Array): ReadonlyArray<string> =>
	entropyToMnemonic(entropy, wordlist).split(" ");

// The 32-byte Ed25519 seed is HKDF-SHA256 of the entropy, with a fixed label.
// Not BIP39's own PBKDF2 seed: that is for wallets' key trees, which we do not need.
export const seedFrom = (words: ReadonlyArray<string>): Effect.Effect<Uint8Array, BadWords> => /* ... */;
```

- **12 words, 128 bits.** That is Proton's length and the common wallet length. Ed25519 itself gives
  about 128 bits of security, so more words add typing and no safety. Sure: 80%.
- **`@scure/bip39` 2.4.0, pinned exact, with `@noble/hashes` 2.4.0 (decided).** It is MIT, small,
  audited, and runs in a browser and Node. The builder reads that version's docs first.
- **The recovery key is a plain Ed25519 key.** Its public half is an `ssh-ed25519 AAAA...` line,
  like the person key. A developer can write it to a temp file and use `ssh-keygen -Y sign`, so
  recovery has a command path too, as grants do with `grant.ts`.

### 2. No wait, and no passphrase (decided)

- **No wait before a sheet recovery takes effect, ever.** The owner judges that a wait harms more
  than it helps on this path: it would leave a person who lost their Mac waiting, and a thief who
  holds the Mac could stop it. Experiment 216 found waits only where the proof is weak (email,
  phone) or another person acts. Products whose recovery secret is a strong key (Apple's key path,
  Proton, Keybase, Tailscale, wallets) do not wait.
- **No passphrase on top of the sheet.** A forgotten passphrase makes the sheet useless exactly when
  it is needed.
- **What this costs:** a stolen sheet, or a copied PDF, is a stolen fabrika. That is the known hole,
  and it stays. Experiment 216 flags that no wait plus a PDF makes a copied file a silent, instant
  takeover, and that Apple and 1Password each add a second factor. The owner's answer is the two
  guards in call 1, not a wait.

### 3. Does recovery revoke the old Mac's keys (decided)

The recovery screen asks once: "Is your old device lost or stolen?", with **Yes, remove it and
everything it let in** picked by default, and **No, I still have it** beside it.

- **Yes (`old: "lost"`)** → `drops` names the old Mac's person key and window key, and every other
  live recovery key. They stop at once and forever, and everything they let in goes with them
  (call 9).
- **No (`old: "kept"`)** → `drops` is empty. The old Mac keeps working, and the person has two
  Macs. A calm move rarely comes here: Migration Assistant carries the keys, or the old Mac lets
  the new one in (call 7), and neither spends the sheet.

Why ask, and why default yes: the person knows which case they are in, and most people reach this
screen because the old Mac is gone. No product in experiment 216 asks this; Keybase and Tailscale
revoke as a separate step. Nothing found argues against it.

### 4. What the new Mac's window key does

- **The new Mac makes both keys fresh,** a person key and a window key, sealed with `safeStorage` as
  the first open does. Nothing is copied from the old Mac.
- **The window key rides in the same `added` fact** (`adds.person.window`), and the fold admits it
  with no grant, the same rule as `founded.window`. Why: one fact, one signature, one write. Either
  the new Mac is all in or not at all. Cost: one rule in the fold, which already exists for
  founding. Sure: 75%.
- **The other way:** `added` holds only the person key, and the new person key then signs a normal
  `granted` for its window. It leaves a moment where a person key is in and its window is not, and
  a crash there needs a retry. Not the lean.
- **The menu bar's link** is `<window fingerprint>/menubar`, signed with the new window key, as on
  the first open. So reading rows still never touches the person key.
- **The app reads the name from `founded`,** not from a field, so the new Mac shows the same name.

### 5. A wrong sheet, a used sheet, a replaced sheet

Every refusal writes nothing. The words never leave the Mac in any branch.

- **A word not on the list** → caught on the Mac, before any dial: "Word 7 is not on the list." Each
  field completes after four letters, since the BIP39 list is made that way.
- **The checksum or the label does not match** → caught on the Mac: "Word N looks wrong. Check it
  against your sheet." The 4-bit checksum lets one wrong word through about 1 time in 16; the
  label catches the rest.
- **Good words, but not a key of this ledger** → the door says `not_member`, the same answer as any
  other signer. The app says "This sheet is not for this fabrika." A count goes to the Worker's
  logs, nothing to the ledger.
- **A spent sheet** → the door says `used`. The app says "This sheet was used on 5 Nov 2026. Use
  the sheet you made after that." Saying `used` tells only someone who already has the exact
  words, so it costs nothing.
- **A sheet replaced by a newer one** → the door says `replaced`, with the same kind of words.
- **The same `added` sent twice** (a drop, then a retry) → one fact and the same answer, by its
  `id`, as a grant.
- **No sheet at all** → a new Mac that just opens fabrika and dials the address is a new window. It
  gets the waiting screen and nothing else, as any unknown key does.

### 6. A sheet works once, and a new one kills the old (decided)

- **A recovery key signs one `added` and is then spent,** by a rule in the fold, with no second
  fact. A sheet that has been out of the drawer, typed on a new Mac, maybe photographed, is no
  longer trusted. Bitwarden's and Google's codes are single use the same way.
- **Making a new sheet kills the old one,** in the same `added` (its `drops`). The screen says it
  before Touch ID: "Your sheet r1-7f3a will stop working." Google, Microsoft, 1Password, Bitwarden,
  Keybase and Tailscale all do this (experiment 216). Copies of one sheet are fine, since they are
  the same words.

### 7. Who may sign what (decided)

**Decided by the owner, 2026-11-06: every device the person owns is a master, an equal person key.
Any one may let in tabs, agents and other devices, and remove any of them, as Apple and Keybase
do. The sheet is the backstop: a recovery drops the lost device and everything it let in.**

The door already checks a grant: SSHSIG, Ed25519 only, namespace `fabrika-client`, text decoded
through the schema, `to` is this ledger, the signer is a live key of the person named in `for`.
`added` goes through the same function, on the same `/grant` route. The new part is who may sign
what.

```ts
// A sketch. One pure check, beside foldMembers. A key's rank comes from the fact that added it.
type Rank = "person" | "window" | "agent" | "recovery" | "email"; // "email": the brain's own key

export const mayAdd = (members: Members, signer: string, add: Add):
	{readonly ok: true} | {readonly why: "not_member" | "used" | "replaced" | "not_allowed"} => {
	// signer is a live person key of `for`:  may add a person (a device) or a recovery key (a sheet).
	//                                        drops may name any key of `for` but its own.
	// signer is a live recovery key of `for`, not spent, not replaced:
	//                                        may add a person (one new device), once.
	//                                        drops may name any key of `for`.
	// A window key or an agent's key never signs an `added`, a grant or a revoke.
	// A recovery key never signs a grant or a revoke.
};
```

- **A person key may** let in tabs, agents and other devices, remove any of them, and make a new
  sheet. Each device has its own person key, and they are equal.
- **An agent is never a master.** Already decided: an agent can never let anyone in.
- **A browser tab joins and works, but cannot approve others.** A tab holds only a window key.
  Why: browser storage is weaker than a sealed key, and a phone's browser may clear it after 7 days
  without a visit. **Lean, 70%,** not yet settled. What would settle it: a phone as approver, which
  the plan puts later. *Changed 2026-11-07 (owner): a tab can approve when the approval is signed by
  a passkey (WebAuthn) made with user verification required; that tab is a person key. A tab with
  only its window key still cannot ([Tier 1's question 19](../plan/tier-1.md#open-questions)).*
- **A recovery key may** let in one new device and drop keys, once. It never grants a tab or an
  agent. The sheet's only job is to bring a device back.
- **Anyone can re-check it later** with `ssh-keygen -Y verify`, since the signed text and the
  signature are kept whole, as for a grant.

**Dropped: "a person key may not add or drop another person key".** The first draft had it, so a
thief who got one Mac's person key could not lock out the person's other Macs. It was over-caution:
a stolen device is already a master in every way that matters, since it can read and let in. The
answer to a stolen device is the sheet, which drops it and everything it let in. The rule also made
a calm second Mac spend the sheet, and no peer product has it (Keybase, Apple and Tailscale's
signing nodes all let a peer add a peer; experiment 217).

**Letting in a second device while the first lives** goes the way a tab does: the new Mac knocks
with its person key and window key, the old Mac's menu bar shows a row, and Approve with Touch ID
signs one `added` with `saw.how: "device"`. How it looks is P21's and P28's to draw.

### 8. How `founded.keys` folds with `added`, and the grant tree

**Decided, as a general rule: a dropped key drops everything it let in, all the way down.** That
holds for a recovery and for Remove in the menu bar alike. The tree is folded from the ledger.
**Decided by the owner, 2026-11-06:** the person's own devices are equal roots, and the sheet
belongs to the person. Only tabs and agents hang under the device that let them in.

```ts
// A sketch of what foldMembers keeps, in ledger order (by rev).
type Members = {
	readonly person: string;                         // from founded, never changed
	readonly name: string;                           // from founded, never changed
	readonly keys: ReadonlyMap<string, {
		readonly rank: Rank;
		readonly live: boolean;
		readonly under: string | null;               // the key that let it in; null for a root
	}>;
	readonly spent: ReadonlySet<string>;             // recovery keys that signed once
};
// founded             -> each of keys as a "person" root; window under them
// added (recovery)    -> the new key as "recovery", a root of the person's own; each of drops not live
// added (person)      -> key as a "person" root, window under it; each of drops not live
//                        (by a sheet: signer spent; by a device: nothing more)
// granted             -> the tab's or agent's key, under the person key that signed it
// revoked                      -> the key not live
// admitted(key)                -> the key and every key above it are live
```

- **Every device of the person is a root,** however it came in: named at `founded`, let in by
  another device, or let in by a sheet. A device never hangs under another device, so dropping
  one never drops another. A device is dropped only by name, in `drops` or by Remove.
- **Only tabs and agents hang under a device,** the one whose person key let them in, and they
  drop with it. So the recovery screen lists what will drop with the old Mac: its own tabs and
  agents, not the person's other devices.
- **The sheet belongs to the person, not to a device.** Removing any device leaves the live sheet
  alone. Only using it or making a new one kills it. A spent sheet signs nothing more, and the
  device it let in stays.
- **The rule is written for any depth,** so a phone as approver or an invite later needs no new
  rule.

The laws P28 adds to p28, all property-based, over any list of facts:

- `founded` stays first and is never replaced, whatever `added` facts come after.
- A dropped key stays out forever, as a revoked one does. A later `added` cannot bring it back.
- A key is admitted only while every key above it is live. Removing one drops all below it.
- Dropping a device never drops another device of the person, and never drops the live sheet.
- A recovery key that signed once never signs again. A spent key's children stay admitted.
- An `added`, a grant or a revoke signed by a window key or an agent's key changes nothing. A
  `granted` signed by a recovery key changes nothing.
- Any live person key may add and drop another; the result is the same whichever device signed.
- The same `added` twice changes nothing.
- A good thing happens: after a recovery, the new person key and window key are admitted, and
  `person` and `name` are the same as before.

### 9. Tabs and agents the old Mac let in (decided)

- **Old Mac dropped** → everything its person key let in stops, by the tree rule in call 8, as
  Tailscale does with a revoked signer's nodes. Each tab sees "This window was removed. [Ask
  again]", and Ask again knocks with a new key. An agent asks once more, through `claude mcp add`
  and one Approve.
- **Old Mac kept** → nothing changes for its tabs and agents.
- **What stays either way:** everything already written. A note's `by` is still the old agent's
  key, and `for` still the person. History does not change, so the same notes show.

### 10. The end of a recovery (decided)

```text
Done. This Mac is in.
Your old Mac, its 2 windows and 1 agent are removed.
Sheet r1-7f3a is used up.  [Make a new sheet]
```

- **It counts what was removed,** from the fold, so the person knows what stopped. 1Password lists
  each effect of a recovery; Proton marks the spent method (experiment 216).
- **"Make a new sheet" sits right there,** not only in the menu bar row.
- **The old Mac is told at once if online.** Its gateways close with 4003, as for any removed key,
  and it shows "This Mac was removed by your backup sheet just now." If it is offline, it shows the
  same on its next open, with the date. With no wait, telling cannot stop a thief, but it tells the
  person within seconds.

### 11. What a person meets, and how often

| Moment | What they do | How often |
|---|---|---|
| Any normal day | Nothing. No reminder, no nag | Never asked |
| No sheet yet | A quiet row in the menu bar: "No backup sheet. [Make one]". Never a prompt on open | Until one exists |
| Making a sheet | Touch ID, print or save or write 12 words, type two of them back | Once per person, and after each recovery, about 2 minutes |
| Checking a sheet | "Check my sheet" in the menu bar: type all 12 into numbered slots, offline. It answers "This is your live sheet, r1-7f3a", "Word N looks wrong" or "This is an old sheet. It no longer works" | Only when they choose |
| Using a sheet | On a new device's first screen: "I have a backup sheet". Type the address and 12 words, answer once, Touch ID | Once in years |
| After a recovery that dropped the old device | Each browser and agent that was let in asks again, one Approve each | Once, a handful of times |

**Two words typed back at setup, plus "Check my sheet" (decided).** Two words catch a person who
never wrote anything down. "Check my sheet" catches the order mistakes two words miss, as Trezor's
Check backup and Ledger's Recovery Check do. It rebuilds the public key from the words and compares
it with the keys the Mac already folded, so it never dials and never saves the words. It never
nags: Signal asks on a schedule, and that is not copied.

### 12. The attack stories

Each says what the attacker gets in Tier 1.

- **A stolen sheet, old Mac still yours.** The thief types it on their own Mac and keeps the default,
  "lost". They get everything: the notes, and your Mac is dropped. Your Mac is told at once if
  online, so you know within seconds, but you cannot undo it. This is the known hole, the same as
  Keybase paper keys, Proton's phrase, BIP39 wallets and Tailscale's disablement secrets. The owner
  decided no wait (call 2).
- **A copied PDF.** The same as a stolen sheet, and you may not know until your Mac is told. The
  save screen's line about where not to keep it is the guard.
- **A photographed sheet.** The same again. If you suspect it, make a new sheet, which kills the
  old one. The app never shows the words again after making, so a photo can only be of the paper
  or of the screen that one time.
- **A phishing page or message asking for the words.** The sheet says "fabrika will never ask for
  these words. Only type them on a new device's first screen."
- **A stolen Mac, off or locked.** FileVault and the login Keychain hold the sealed person key. The
  thief gets nothing without the login password. You recover on a new Mac, answer "lost", and the
  old Mac and everything it let in are dead.
- **A stolen Mac, awake and unlocked.** An open window keeps working, since the window key signs
  each `initialize` silently, by design. So the thief can read notes until you recover. Approve,
  Remove and making a sheet need Touch ID. Reading the sealed key outside the app makes macOS ask
  for the login password. **With the login password,** the thief can sign as the person key. Since
  every device is a master (call 7), they can let in their own tabs and devices, remove your other
  devices, and make a new sheet, which kills yours. If they have not made a new sheet yet, your
  sheet drops the stolen Mac and everything it let in, their devices included. If they have, you
  cannot recover with the sheet. This hole needs both the Mac and its password. Tier 1 accepts it,
  as Apple and Keybase do once a device's login is known. Email recovery does not help here: the
  thief can remove the recovered device from the stolen Mac's list.
- **Someone in your mailbox.** They can ask for a code and get in at once. Every live device shows
  a notice, and you remove their device from the list of let-in devices. Until you do, they are in.
  That is the cost of offering email, accepted by the owner: a person whose mailbox is taken has
  lost far more than fabrika ([0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)).
- **A Time Machine disk.** It is a sealed copy of the person key, opened by the login password
  (experiment 217). A stolen disk plus the password is the story above. Experiment 217 leans
  toward "encrypt your Time Machine backup" in the sheet's help rather than keeping the key out of
  backups, since that would make every restore need the sheet. 60%, not decided.
- **Someone on the network.** The words never cross the wire, only a public key and a signature. A
  replayed `added` is the same `id` (one fact), or for another ledger (`to`), or from a spent sheet.
- **Guessing the words.** 128 bits, against a public key members can read. Not doable.
- **Malware on the new Mac while the sheet is typed.** It gets the words. Nothing in this design
  stops that. A clean Mac is the only answer, as for every product above.

### 13. A new device sees what it will drop, first (decided 2026-11-09, built by P28)

Before a sheet recovery, the new device makes one read-only call at the door. It is signed by the
recovery key and tied to a fresh challenge. It answers the ledger's name, the ledger position it
saw, and which devices would drop. It spends nothing and lets nothing in.

```ts
// A sketch. The call's and fields' names are P28's to pick.
// read (signed by the recovery key, over a fresh challenge)
//   -> {name: "home", seen: 4182, drops: ["mbp-2024", "tab-7f3a"]}
// added (signed, with seen inside the signed text) -> the door checks membership again,
//   and refuses if the person's keys changed since seen
```

- **Every refusal answers the same,** so a wrong, spent or replaced sheet tells an attacker
  nothing. The screen still shows one plain line for a spent, replaced or other-fabrika sheet.
- **The challenge is one-time and short-lived.**
- **The read returns the ledger position it saw.** The `added` carries it back as `seen`, inside
  its signed text, so the check does not rest on TLS alone. The door refuses the `added` if the
  person's keys changed since `seen`: the race where a thief adds a key between the read and the
  join.
- **`added` still checks membership again,** whatever the read said.
- **The 12 words become the key by HKDF-SHA256 over the entropy,** with an empty salt and the label
  `fabrika-recovery-v1`, as in [the sketch above](#how-the-words-become-a-key).
- The owner approved P28's exam on 2026-11-09: 28 laws, the read call's conditions included.

## Email recovery (decided, two unknowns open)

**Decided by the owner, 2026-11-05 and 2026-11-06,** after walking experiment 217
([PR 406](https://github.com/usirin/tea-fabrika/pull/406)). Email recovery is offered for the
Cloudflare setup. The sheet stays the way with no email, and the way for a local setup.
**Changed by the owner, 2026-11-11** ([0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)):
the 24-hour wait and its Cancel are gone. The right code lets the device in at once.

```text
On a new device:  "Email me a code" -> a 6-digit code to the checked address -> typed on this device
                  -> "Is your old device lost or stolen?" -> Touch ID
                  -> the new device is in, and the drops apply, at once.
Every live device:  "A device came back by email: mbp-2025, Lisbon, 14:02."  (nothing to press)
Not you?  Remove it from the list of let-in devices, as any device.
```

- **Sent free through Cloudflare.** Email Routing's `send_email` binding sends to the person's own
  verified address at no cost, on the account the brain already runs on. It needs a domain whose
  DNS is on Cloudflare. With no domain, the fallback is Cloudflare Access's one-time PIN (open,
  below).
- **A 6-digit code, not a link,** typed on the device that asked. A link opened on another device,
  or by a mail scanner, would let in the wrong device.
- **No wait, and no step of its own to undo it.** Email is weak proof: anyone who gets into the
  mailbox gets the code. The owner ruled that recovery gets no barriers, as for the admin's
  re-invite ([0339](../../.decisions/0339-an-admin-can-re-invite-a-person.md)): a person whose
  mailbox is taken has lost far more than fabrika, and a wait costs every honest person a day. The
  industry does the same for an emailed password reset: it takes effect at once, and the account
  is told afterward ([OWASP's forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)).
  No recovery path gets a waiting period; a new limit on something a person should do easily
  needs the owner's yes.
- **Every live device shows a plain notice** that a device came back by email. The notice carries
  no action: no Cancel and no "not me". It is a view of the `added` fact, so a device that was off
  sees it when it reconnects.
- **The recovered device is a device like any other.** It is in the list of let-in devices, and
  the list's own Remove works on it, as on every device
  ([call 7](#7-who-may-sign-what-decided)).
- **The sheet stays instant too.** There is no third way, sheet plus email: each works alone.
- **At setup, record which email and when it was checked.** A later recovery can only trust an
  address that was on the ledger before the Mac was lost. This fact exists only at that moment.
- **The drops apply at once,** with the `added`. The "lost or stolen?" answer is asked as for the
  sheet.

```ts
// The facts. Their fields are a sketch.
// At setup: the person types their address, gets a code, types it back. A person key signs:
{_tag: "verified", email: "<address>", signed: sshsig(personKey)}       // its arrivedAt is "when checked"
// On a new device, the right code inside 10 minutes and 5 tries. The email key signs at once:
{_tag: "added", add: {adds: {_tag: "person", key: "...p2", window: "...w2"}, drops: ["...p1", "...w1"],
  saw: {how: "email", check: "touch", old: "lost"}}, signed: sshsig(emailKey)}
// Every live device folds it and shows the notice. Nothing is written to send the notice.
```

- **Who signs the `added`:** a key the brain holds for this one job, its public half on the
  ledger with the rank `email`. It signs only the `added` of the device whose code was just right,
  and never leaves the brain (experiment 217's lesson from Matrix, which handed its top key to
  every device). So the door keeps its one signature check. Decided by the owner, 2026-11-06.
- **The code:** good for 10 minutes and 5 tries, then a new one. Only its hash is kept, and never
  in the ledger. Decided by the owner, 2026-11-06.
- **Who it stops:** a wrong code, an old code, a sixth try, or an address not `verified` before the
  loss. Someone who holds the mailbox and no device gets in at once; the person learns from the
  notice and removes the device. Accepted by the owner in 0138.

*Changed 2026-11-11. Until then this section had a 24-hour wait any live device could cancel, with
the facts `requested` and `canceled` and the brain's alarm signing the `added` when the wait ended
([0338](../../.decisions/0338-email-recovery-waits-a-day.md)). 0138 replaced those parts.*

**Open, and the first build tries both:**

- **Whether the no-domain route works:** Access's one-time PIN on a Worker with no domain of its
  own. Untried, 50%.
- **Whether the code reaches the inbox,** and not spam, from Cloudflare's sending.

## How it would be tested

P28 is "its own small exam, then the sheet". The exam, written by an agent that is not the
builder and read by the owner, holds:

- **p28's new laws** (call 8), property-based, on Node.
- **Real `ssh-keygen` vectors** for `added`, as p27 has for grants: a recovery key rebuilt from
  fixed test words, written to a temp file, signs; it passes. A person key adding a device passes.
  A spent sheet, a replaced sheet, a window key or an agent's key signing, a recovery key signing a
  grant, drops naming another person's key, and another ledger's `to` are each refused, with the
  answers in call 5.
- **The sheet's pure laws:** words to key and back. One changed word fails the checksum or gives
  another key. The label matches only the right key. "Check my sheet" answers live, old or wrong,
  and makes no network call.
- **The secret stays home:** during a full recovery on an instance, every frame sent, every ledger row
  and every log line is searched for each of the 12 words, the entropy and the seed. None is found.
- **The done check, end to end,** on real Electron with a test `PersonCheck` and a stand-in
  printer that writes the sheet to the temp home:
  1. Home A founds, saves a note on an instance that stands in for the cloud, lets in a tab and an
     agent, and makes a sheet.
  2. Home B opens, picks "I have a backup sheet", types the address and words, and keeps the
     default, "lost".
  3. Home B shows the same note and the same name, and the end screen counts the old Mac, its
     windows and its agent. The ledger's `founded` is unchanged, and its `rev` goes on from where
     it was: no new ledger.
  4. Home A, still open, is closed with 4003 at once and says it was removed by a backup sheet. Its
     tab and agent are refused.
  5. The same words again on home C: "This sheet was used". Home B's menu bar shows "No backup
     sheet. [Make one]".
  6. Home C with no sheet: the waiting screen and nothing else.
  7. A local setup with no copy shows the warning once at setup, and never again.
  8. A home whose sealed keys will not open (the stand-in fails to unseal) goes to the recovery
     screen, never to the founding screen, and makes no new keys.
  9. Home B lets in home D as a second device. Removing D from B's menu bar drops D and the tab D
     let in.
- **Email, on a stand-in sender and a test clock:** a right code writes one email-signed `added`
  at once, with no fact before it, and its drops apply with it. Every live device shows the notice,
  and a device that was off shows it on reconnect. The notice sends nothing. The recovered device
  is in the list of let-in devices, and another device's Remove drops it and all it let in. A wrong
  code, an old code, a sixth try, and an address not `verified` before the loss each let in
  nothing. The code is never in the ledger. The brain's email key signs nothing but that `added`.
- **The two unknowns,** in the first build, on a real account: one code through `send_email` to
  a real inbox, and one through Access with no domain. Each logged in `field/`.
- **Plants:** spent rule skipped; a window key or an agent's key accepted as a signer; a recovery
  key used twice; drops not applied; the tree not walked (a removed device's tabs stay); a
  device dropped with another device; the sheet dropped with a removed device; a check not
  recorded, or recorded with its words; a key that will not open sent to founding; words
  sent in the request; the label ignored; the old Mac not told; the email `added` held back; the
  notice shown only on the asking device; the email-added device hidden from the list or refused
  by Remove.
- **Only a person can pass:** a real print and a real recovery on a second home, with a real finger,
  logged in `field/`. A Time Machine restore on a real Mac, once, if the owner wants that path
  proven in Tier 1.

## Size, and the plan rows it touches

For the sheet only: about 10 files, product 500 to 800 lines, tests 500 to 800 lines, 1.5 to 2
builder agent hours, plus the exam. 55% sure: the plan guessed 0.5 to 1, and the screens are where
it grows.

Email recovery, on top: about 6 files, product 300 to 500 lines, tests 300 to 500 lines, 1 to 2
builder agent hours, 45% sure, since its two unknowns can change the sending part.

- **P9** (`MemberFact`, `foldMembers`, p28): `added`, `Adds`, `AddSaw`, the rank and `under` on
  each key, the spent set, and `admitted` walking the tree. The tree rule also changes how a
  `revoked` folds for Remove, so P9 should build `under` from the start. If P9 lands first without
  it, no fact is lost: `under` folds from the signer each fact already keeps.
- **P10** (the door): `/grant` takes `added`, and `mayAdd` gives `used`, `replaced` and
  `not_allowed`. The same SSHSIG check.
- **P19** (the app): the founding screen gains "I have a backup sheet", the local warning, and the
  removed Mac's screen in plain words. A sealed key that will not open goes to the recovery screen.
  It never makes new keys by itself.
- **P21** (the menu bar): the "No backup sheet" row, the live sheet's label, "Check my sheet", the
  making flow behind Touch ID, and a row for a device asking to join. Remove drops the subtree.
- **P28** (the backup): all of the above, on top of P26's cloud notes, with its own exam first.
  Email is its own row, P36, after P28 (the plan, 2026-11-06).
- **P26** (Cloudflare): the `send_email` binding, or Access. Email recovery needs no alarm (0138).
- **The plan's s13 and check 6** get their words from "How it would be tested" above.

New files, a guess: `tuval/src/desktop/sheet.ts` (pure), `tuval/electron/sheet.*` (the screens,
print and PDF), `tuval/electron/recover.*` (the founding screen's second path), and
`apps/fabrika/recover.ts` (the developer path). Two new dependencies, `@scure/bip39` 2.4.0 and
`@noble/hashes` 2.4.0, exact.

## What is decided, and what is open

Decided by the owner, 2026-11-05 and 2026-11-06:

The sheet, all of it. The calls the owner made on it:

1. No wait before a sheet recovery takes effect, ever. A stolen sheet stays the known hole.
2. No passphrase on top of the sheet.
3. Ask once "Is your old device lost or stolen?", default yes.
4. A dropped key drops everything it let in, all the way down, for Remove too.
5. A sheet works once, and making a new sheet kills the old one.
6. Print first, PDF allowed, with two guards: the old Mac told at once, and the save screen's
   line about where not to keep it.
7. Two words typed back at setup, plus "Check my sheet". Numbered slots, the label on the sheet
   and in the menu bar, and "fabrika will never ask for these words".
8. `@scure/bip39` 2.4.0, exact, with `@noble/hashes`.
9. The end screen counts what was removed, offers "Make a new sheet", and the old Mac is told.
10. Both ways are offered: email for the Cloudflare setup, the sheet without email and for local
    with Time Machine, and a plain warning for local with no copy. No third way, sheet plus email.
11. Every device the person owns is an equal person key; an agent never is. The "a person key may
    not add a person key" rule is dropped.
12. A Mac whose keys did not come across goes to the recovery screen, never to a new founding.
13. Email recovery for the Cloudflare setup, sent free through Cloudflare (`send_email`, or
    Access's one-time PIN with no domain); a 6-digit code typed on the device that asked; every
    live device told at once. Which email and when it was checked are recorded at setup. The code
    is good for 10 minutes and 5 tries; the brain holds one key that signs only the `added`.
    *Changed 2026-11-11 ([0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)):* the right
    code lets the device in at once, with no wait and no Cancel. Every live device shows a plain
    notice with nothing to act on, and the list's Remove works on the recovered device as on any.
    The facts are `verified` and `added`; `requested` and `canceled` are gone.
14. The person's devices are equal roots in the grant tree; only tabs and agents hang under a
    device. The sheet belongs to the person, and removing a device leaves it alone.
15. Each "Check my sheet" is recorded: when, which device, matched or not. Never the words.

Decided by the owner, 2026-11-08, for a few friends on one Cloudflare account
([experiment 229](../../experiments/229-browser-only-friends.md) rows 18 and 19):

16. Recovery mail goes to any friend: Email Sending with the group's own domain, Access's
    one-time PIN with only `workers.dev`. No check per friend. The install sets up the address,
    the domain's DNS and the mail route through alchemy, with no steps by hand.
17. An admin can re-invite a person who lost every device, as the same person, at once, with no
    wait. An admin's invite is already trust, so recovery has no barrier
    ([principles](./principles.md)). The ledger records who re-invited whom.

Decided by the owner, 2026-11-09, built by P28 (call 13):

18. One read-only door call shows a new device what it will drop, signed by the recovery key over
    a fresh one-time, short-lived challenge. It spends nothing and lets nothing in.
19. Every refusal answers the same. The read returns the ledger position it saw, the `added`
    carries it back as `seen` inside its signed text, and the door refuses the `added` if the
    person's keys changed since.
20. The words become the key by HKDF-SHA256 over the entropy, empty salt, label
    `fabrika-recovery-v1`.

Inside the decided part, still a lean:

- **A browser tab cannot approve others.** 70% (call 7).

Open, and the first build tries both:

- **Whether the no-domain route works** (Access's one-time PIN, untried, 50%).
- **Whether the code reaches the inbox.**

## What it cannot tell us

- **Whether people keep the sheet.** Every product in experiment 216 loses accounts because the
  paper was never made or was thrown out. Only real use shows it.
- **Whether Touch ID really guards the person key** against someone at an unlocked Mac. P4 found
  `canPromptTouchID()` true on an unsigned build, but `promptTouchID` itself was never called, and
  nobody tried reading the `safeStorage` item from another process.
- **Whether Migration Assistant and Time Machine really carry the sealed keys.** Experiment 217
  says most likely, 75%, from docs and one careful blog. Nobody has moved a Mac. Whether the new
  password Migration Assistant asks for keeps the login Keychain open was not researched.
- **Where the owner's files sync,** which decides how real the PDF risk is.
- **Whether the cascade's cost is small.** It is a handful of Approves with Tier 1's few clients.
  With many tabs and agents it could be a chore.
- **Whether the new Mac's first `initialize` works before the menu bar is up.** The order of the
  screens is a guess until P19 exists.

## Made up here

These are proposals, not settled words or numbers:

- The field names `adds`, `drops`, `typed`, `kept`, `old`, `v`, `under`, `matched`, the `how` words
  `device` and `email`, the struct names `Add`, `Adds`, `AddSaw`, the `Rank` type, the rank word
  `email`, the fact name `checked`, and the function `mayAdd`.
- The fields inside `verified` (its name is decided).
- The `why` words `used`, `replaced` and `not_allowed`.
- The label's shape, `r1-7f3a`.
- Every screen's words, the sheet's layout, and the file names.
- The size and hours.
- The example name, the date, the counts and the words on the sample sheet and screens.
