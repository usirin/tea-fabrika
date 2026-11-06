# A lost Mac comes back with a recovery key on paper

**Proposed 2026-11-05.** This is about `next/`. It is Tier 1's P5, the backup's design pass
([the plan](../plan/tier-1.md)), and the owner reads it before anyone writes a test for P28.
Nothing here is built. The industry calls this account recovery with a recovery key. "The
sheet" below is the plan's backup sheet: the paper that holds the recovery key.

```ts
// A sketch. The whole idea: a second key, kept only on paper, that can let in one new Mac, once.

// 1. While the Mac lives. Once, from a quiet row in the menu bar. The app makes a recovery key,
//    prints its 12 words, keeps only its public half, and signs one fact with the person key.
{_tag: "added", add: {adds: {_tag: "recovery", key: "ssh-ed25519 AAAA...r1"}, drops: [],
  saw: {how: "sheet", check: "touch"}}, signed: sshsig(personKey)}

// 2. On a new Mac. The person types the address and the 12 words. The app rebuilds the recovery
//    key, makes a fresh person key and window key, and signs one fact with the recovery key.
{_tag: "added", add: {adds: {_tag: "person", key: "...p2", window: "...w2"}, drops: ["...p1", "...w1"],
  saw: {how: "recovery", check: "touch", old: "lost"}}, signed: sshsig(recoveryKey)}

// 3. The door checks it like a grant: SSHSIG, one namespace, one check. The fold then says:
//    p2 and w2 are in. p1, w1 and every grant p1 signed are out, forever. The sheet r1 is spent.
//    Same ledger, same `founded`, same notes, same name. The 12 words never left the new Mac.
```

## The answer first

- **The sheet holds 12 words and an address,** printed on paper. No file, no QR in Tier 1.
- **The words are a key, not a password.** They rebuild an Ed25519 key, the recovery key. Its
  public half joins `founded.keys` through an `added` fact. The door never sees the words.
- **A recovery key does one thing, once:** it lets in one new Mac (a person key and its window key)
  and drops the keys the person picks. Then it is spent. The new Mac asks for a new sheet.
- **Recovery asks one question:** "Is your old Mac lost or stolen?" Yes drops the old Mac's keys and
  every tab and agent it let in. No keeps them.
- **The person meets it twice in the life of a Mac:** once to print a sheet, once to use it. Never
  on a normal day.
- **No GitHub, and nothing outside the sheet and the ledger.** The owner decided on 2026-11-05 that
  no GitHub trust is automatic, ever.
- **A stolen sheet is a stolen fabrika in Tier 1.** That is the known way (Keybase, BIP39 wallets,
  Tailscale's disablement secrets), and the sheet is kept like a passport. A wait before a recovery
  takes effect, with a stop from a live Mac, is the first thing to harden, and nothing is lost by waiting.
  This is an open call for the owner.

## Which version

`next/` only. Today's version has no person key on a Mac and keeps its keys on GitHub
([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)). Nothing here changes it.

The sketches use the owner's 2026-11-05 words, which are not in the plan or the other notes yet:
`initialize` for the first message (the plan says `hello` in places), and `sentAt` and `arrivedAt`
for an entry's two clocks (the plan says `said` and `at`). `sentAt` is the writer's clock, shown and
never used to decide. `arrivedAt` is the referee's. Every entry carries `cause`, the id of the
input the door stamped. There is one ledger, a Durable Object everywhere: Miniflare on the laptop,
Cloudflare in the cloud.

## The known way

Every big product that keeps keys on a device has met this. Here is what each does, and what we
take.

| Who | What the person keeps | What it can do | What we take |
|---|---|---|---|
| [Keybase paper key](https://book.keybase.io/account) | A long string of random words, linked to the account "the same way a device is" | Lets in a new device and revokes others, with no server help | The model: the sheet is one more key on the person's list, and the list lives in the signed record ([Keybase's sigchain](https://book.keybase.io/docs/server): `sibkey` adds a key, `revoke` removes one, old links stay valid) |
| [Apple recovery key](https://support.apple.com/en-us/109345) | A 28-character code, plus a trusted phone number | Account recovery with no trusted device. "Apple can't provide you with your recovery key" | Nobody else can help, and the product says so plainly. We do not take the phone number: it is a second outside party |
| [Apple recovery contact](https://support.apple.com/102641) | A friend who can show a six-digit code | Helps you back in, and never gets access | Not in Tier 1. It needs a second person on the ledger, which is Tier 3 |
| [1Password Emergency Kit](https://support.1password.com/emergency-kit/) | A PDF with the sign-in address, email, Secret Key and a space for the password; a QR Setup Code | Sign in on a new device | The address on the sheet, and "print it, keep it with your passport". We do not save a file by default (below) |
| [Signal PIN and Registration Lock](https://support.signal.org/hc/en-us/articles/360007059792-Signal-PIN) | A PIN | Stops anyone else re-registering your number, until 7 days without use | The idea of a wait that a live device keeps alive. Proposed for later, not Tier 1 |
| [Bitwarden emergency access](https://bitwarden.com/help/emergency-access/) | A trusted contact's own key | The contact asks; after a wait the owner sets, access opens unless the owner rejects | The wait with a stop, again. Later, with a second person |
| [Tailscale Tailnet Lock](https://tailscale.com/kb/1226/tailnet-lock) | Ten disablement secrets, "printing them and keeping them in a secure safe" | Trusted keys sign each new node. A revoked key's nodes "lose their authorization and require a new signature" | Two things: the paper, and the cascade, so a dropped Mac takes its grants with it |
| [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) | 12 to 24 words from a list of 2048 | Rebuilds a wallet's keys on any device | The word list and its checksum, through a library ([below](#how-the-words-become-a-key)) |
| OpenSSH and age | A second key kept offline | `allowed_signers` and `authorized_keys` list many keys; age encrypts to many recipients | The plain rule under all of these: a backup is one more public key on the list, with its private half somewhere else |

**What none of them does:** trust an outside account to vouch for a new device without a secret
the person kept. Apple and 1Password still need their own secret. That matches the owner's rule:
no automatic GitHub trust.

## The data shape first

What exists only at the moment it happens, and is lost forever if not written then:

- **When the sheet is made:** the recovery key's public half, which person key signed it, how the
  person was checked (`check`), where (`where`, recorded and never trusted), and whether they typed
  two words back (`typed`). Also the sheet's version (`v: 1`), since a later sheet may use more
  words or a QR, and an old sheet must still be read the old way.
- **When the sheet is used:** which recovery key signed (the signer), the new person key and window
  key, which keys the person chose to drop, what they answered (`old: "lost"` or `"kept"`), how the
  new Mac checked them, and the new Mac's `has` and `platform`, recorded and never trusted.
- **Never written:** the words, the seed, or the recovery key's private half. Not in the ledger,
  not on the wire, not in a log, not sealed on the Mac. The app holds them in memory while the sheet
  is on screen, and drops them after.
- **Written down as lost, on purpose:** a wrong sheet. It is refused with the same answer as any
  unknown key, and only a count goes to the Worker's logs. Why: as with a knock, writing it would
  let anyone grow the log. Sure: 80%.

```ts
// A sketch. The new parts of next/packages/libfabrika/src/coordination/client-manager.ts.
// Names marked in "Made up here" are proposals.

/** What the person saw when a key was added. In the signed text, as a grant's `saw` is. */
export const AddSaw = Schema.Struct({
	how: Schema.Literals(["sheet", "recovery", "command"]), // made a sheet; used one; developer path
	check: Schema.Literals(["touch", "click", "none"]),
	where: Schema.String,                 // recorded, never trusted
	has: Schema.Array(Schema.String),     // recorded, never trusted
	typed: Schema.Boolean,                // on "sheet": the person typed two words back
	old: Schema.NullOr(Schema.Literals(["lost", "kept"])), // on "recovery": their answer
});

/** What joins. A union, so a sheet with a window key cannot be said. */
export const Adds = Schema.TaggedUnion({
	person: {key: Schema.String, window: Schema.String}, // a new Mac: its person key and window key
	recovery: {key: Schema.String, v: Schema.Literal(1)}, // a new sheet: the public half only
});

export const Add = Schema.Struct({
	id: Schema.String,
	for: Schema.String,    // the person; the signer must be one of their keys
	to: Schema.String,     // this ledger's name, so a signed `added` cannot be replayed elsewhere
	adds: Adds,
	drops: Schema.Array(Schema.String), // this person's keys that stop now, forever
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

## The questions

Each question is answered as branches: the case, then what happens. Each lean says why, what it
costs and how sure.

### 1. What is on the sheet, and in what form

```text
fabrika backup sheet, v1                      made 5 Nov 2026 on "MacBook Pro"
for:       <the founded name>
address:   https://<the ledger's address>
words:      1 ocean    2 tackle   3 ...      (12 words, numbered)
check:     r1 7f3a                            (the first 4 of the key's fingerprint)

Anyone with these words can take over this fabrika. Keep it with your passport.
It works once. After you use it, print a new one.
```

- **Paper** → the lean. The app shows the sheet and a Print button, with "or write the words down".
  Why: paper is offline, and a file gets copied by sync, backups and Downloads. Tailscale and
  1Password both say to print. Cost: the person needs a printer or a pen. macOS's print dialog
  offers "Save as PDF", and we cannot stop that, so the sheet says plainly that it is a key.
  Sure: 75%.
- **A file the app saves** → not in Tier 1. 1Password does save one to your cloud, but their file is
  only half the secret (the account password is the other half). Ours would be all of it.
- **Words** → the lean. They survive a bad print, can be read out loud and typed on any keyboard.
  The BIP39 list is made so the first four letters pick a word, so the field can complete each one.
- **A QR code** → not in Tier 1. QR is already Tier 7 in the plan, and a reprint is cheap, so no
  fact is lost by waiting. `v: 1` lets a later sheet carry one.
- **The address** → on the sheet. Without it a new Mac does not know where to go, and a person may
  not remember a cloud address years later. It also tells a thief where to go. It is not a secret,
  though: anyone who knows the person can likely guess it. Sure: 70%.
- **The check code** → on the sheet, so the new Mac can say "these words are right" before it
  dials anything. It is four characters of a public key's fingerprint and gives a thief nothing.

### How the words become a key

```ts
// A sketch. next/packages/tuval/src/desktop/sheet.ts: pure, runs on Node in tests.
import {entropyToMnemonic, mnemonicToEntropy, validateMnemonic} from "@scure/bip39";
import {wordlist} from "@scure/bip39/wordlists/english";

// 16 random bytes = 128 bits = 12 words with a 4-bit checksum (BIP39's table).
export const wordsFor = (entropy: Uint8Array): ReadonlyArray<string> =>
	entropyToMnemonic(entropy, wordlist).split(" ");

// The 32-byte Ed25519 seed is HKDF-SHA256 of the entropy, with a fixed label.
// Not BIP39's own PBKDF2 seed: that is for wallets' key trees, which we do not need.
export const seedFrom = (words: ReadonlyArray<string>): Effect.Effect<Uint8Array, BadWords> => /* ... */;
```

- **12 words, 128 bits.** That is the most common wallet length, and Ed25519 itself gives about
  128 bits of security, so more words add typing and no safety. Sure: 80%.
- **A library for the list, not a copy.** `@scure/bip39` is small, audited, runs in a browser and
  Node, and pins at an exact version. The builder reads the installed version's docs first.
  Sure: 80%. The other way is to copy the 2048-word list into the repo, which is one more file to
  keep right.
- **The recovery key is a plain Ed25519 key.** Its public half is an `ssh-ed25519 AAAA...` line,
  like the person key. A developer can write it to a temp file and use `ssh-keygen -Y sign`, so
  recovery has a command path too, as grants do with `grant.ts`.

### 2. Does recovery revoke the old Mac's keys

The recovery screen asks one question, with no default focus: "Is your old Mac lost or stolen?
[Yes, remove it] [No, I still have it]".

- **Yes (`old: "lost"`)** → `drops` holds every person key and window key of this person except the
  new ones, and every other live recovery key. They stop at once and forever. Their tabs and agents
  stop too (question 9).
- **No (`old: "kept"`)** → `drops` is empty. The old Mac keeps working, and the person has two
  Macs. This is how someone with a new Mac and a working old one moves over in Tier 1.
- **Always drop, no question** → not the lean. It locks out a Mac the person still has and is happy
  with.
- **Never drop, and Remove later** → not the lean. A thief holding a stolen Mac keeps working until
  the person thinks to look, and Tier 1 has no Remove for a person key in the menu bar.

Lean: ask. Why: it is one answer in a moment that comes once in years, and the person knows which
case they are in. Cost: one screen. Sure: 70%. The doubt: someone in a panic may press No. What
would settle it: the owner's own walk through the screen.

### 3. What the new Mac's window key does

- **The new Mac makes both keys fresh,** a person key and a window key, sealed with `safeStorage` as
  the first open does. Nothing is copied from the old Mac.
- **The window key rides in the same `added` fact** (`adds.person.window`), and the fold admits it
  with no grant, the same rule as `founded.window`. Why: one fact, one signature, one write. Either
  the new Mac is all in or not at all. Cost: one rule in the fold, which already exists for
  founding. Sure: 75%.
- **The other way:** `added` holds only the person key, and the new person key then signs a normal
  `granted` for its window. It reuses the grant path, but leaves a moment where a person key is in
  and its window is not, and a crash there needs a retry. Not the lean.
- **The menu bar's link** is `<window fingerprint>/menubar`, signed with the new window key, as on
  the first open. So reading rows still never touches the person key.
- **The app reads the name from `founded`,** not from a field, so the new Mac shows the same name.

### 4. A wrong sheet, a used sheet, a replaced sheet

Every refusal writes nothing. The words never leave the Mac in any branch.

- **A word not on the list** → caught on the Mac, before any dial: "Word 7 is not on the list."
- **The checksum or the check code does not match** → caught on the Mac: "These words do not add
  up. Check each one against your sheet." The 4-bit checksum lets one wrong word through about 1
  time in 16; the check code catches the rest.
- **Good words, but not a key of this ledger** → the door says `not_member`, the same answer as any
  other signer. The app says "This sheet is not for this fabrika." A count goes to the Worker's
  logs, nothing to the ledger.
- **A spent sheet** → the door says `used`. The app says "This sheet was used on 5 Nov 2026. Use
  the sheet you printed after that." Saying `used` tells only someone who already has the exact
  words, so it costs nothing.
- **A sheet replaced by a newer one** → the door says `replaced`, with the same kind of words.
- **The same `added` sent twice** (a drop, then a retry) → one fact and the same answer, by its
  `id`, as a grant.
- **No sheet at all** → a new Mac that just opens fabrika and dials the address is a new window. It
  gets the waiting screen and nothing else, as any unknown key does.

### 5. Used once, then spent

- **A recovery key signs one `added` and is then spent,** by a rule in the fold, with no second
  fact. Why: a sheet that has been out of the drawer, typed on a new Mac, maybe photographed, is no
  longer trusted. One-time recovery codes work the same way. Cost: the person must print a new
  sheet after a recovery. Until they do, the menu bar shows "No backup sheet. [Make one]". Sure: 80%.
- **One live sheet at a time.** Making a new sheet drops the old recovery key in the same `added`.
  Copies of one sheet are fine, since they are the same words. Sure: 75%.

### 6. How the door reads `added`, in its one signature shape

The door already checks a grant: SSHSIG, Ed25519 only, namespace `fabrika-client`, text decoded
through the schema, `to` is this ledger, the signer is a live key of the person named in `for`.
`added` goes through the same function, on the same `/grant` route. The only new part is who may
sign what.

```ts
// A sketch. One pure check, beside foldMembers. A key's rank comes from the fact that added it.
type Rank = "person" | "window" | "recovery";

export const mayAdd = (members: Members, signer: string, add: Add):
	{readonly ok: true} | {readonly why: "not_member" | "used" | "replaced" | "not_allowed"} => {
	// adds.person:   signer must be a live recovery key of `for`, not spent, not replaced.
	//                drops may name any key of `for`.
	// adds.recovery: signer must be a live person key of `for`.
	//                drops may name only recovery keys.
	// A window key never signs an `added`. A recovery key never signs a grant or a revoke.
};
```

- **A person key may** grant and remove windows and agents, and make a new sheet.
- **A person key may not** add or drop another person key. Why: a thief who gets one Mac's person
  key cannot lock out the person's other Macs. Linking a second Mac while the first lives goes
  through the sheet in Tier 1 (question 2, No).
- **A recovery key may** let in one new Mac and drop keys, once.
- **A recovery key may not** grant a tab or an agent. Why: the sheet's only job is to bring a Mac
  back, and a narrow key is easier to reason about.
- **Anyone can re-check it later** with `ssh-keygen -Y verify`, since the signed text and the
  signature are kept whole, as for a grant.

Lean: these four rules. Sure: 75%. The doubt is the "person may not add a person" rule, which
makes a calm move to a new Mac spend the sheet. Keybase lets any device add any device. What would
settle it: Tier 3's invites, which need a person key to add someone's key anyway.

### 7. How `founded.keys` folds with `added`

```ts
// A sketch of what foldMembers keeps, in ledger order (by rev).
type Members = {
	readonly person: string;                         // from founded, never changed
	readonly name: string;                           // from founded, never changed
	readonly keys: ReadonlyMap<string, {readonly rank: Rank; readonly live: boolean}>;
	readonly spent: ReadonlySet<string>;             // recovery keys that signed once
	readonly grants: ReadonlyMap<string, {readonly as: "window" | "agent"; readonly by: string}>;
};
// founded            -> each of keys as "person", window as "window"
// added (recovery)   -> the new key as "recovery"; each of drops not live
// added (person)     -> key as "person", window as "window"; signer spent; each of drops not live
// granted            -> the key, with `by`, the person key that signed it
// revoked            -> the key not live
// admitted(key)      -> live, and if it came by a grant, the grant's signer is still live
```

The laws P28 adds to p28, all property-based, over any list of facts:

- `founded` stays first and is never replaced, whatever `added` facts come after.
- A dropped key stays out forever, as a revoked one does. A later `added` cannot bring it back.
- A recovery key that signed once never signs again.
- An `added` of a person signed by a person key changes nothing. An `added` signed by a window key
  changes nothing. A `granted` signed by a recovery key changes nothing.
- A grant whose signer was dropped no longer admits (question 9).
- The same `added` twice changes nothing.
- A good thing happens: after a recovery, the new person key and window key are admitted, and
  `person` and `name` are the same as before.

### 8. What a person meets, and how often

| Moment | What they do | How often |
|---|---|---|
| Any normal day | Nothing. No reminder, no check of the sheet | Never asked |
| No sheet yet | A quiet row in the menu bar: "No backup sheet. [Make one]". Never a prompt on open, never a popup | Until one exists |
| Making a sheet | Touch ID, print or write down 12 words, type two of them back | Once per Mac, and after each recovery, about 2 minutes |
| Using a sheet | On a new Mac's first screen: "I have a backup sheet". Type the address and 12 words, answer lost or kept, Touch ID | Once in years |
| After a recovery that dropped the old Mac | Each browser and agent that was let in asks again, one Approve each | Once, a handful of times |

Why the two words typed back: a sheet nobody printed right is the most common way a backup fails.
Wallets ask the same thing. Cost: 20 seconds once. Sure: 70%.

Why no prompt on the first open: AGENTS.md says no prompt when opening the app, and the plan's first
open is a name and Start. The row stays until a sheet exists, so it is not forgotten.

### 9. Tabs and agents the old Mac let in

- **Old Mac dropped** → every grant its person key signed stops, as Tailscale does with a revoked
  signer's nodes. Each tab sees "This window was removed. [Ask again]", and Ask again knocks with a
  new key. An agent asks once more, through `claude mcp add` and one Approve. Why: the old Mac's own
  tabs are on the lost Mac, and the person cannot tell the rows apart for sure, since `where` is
  recorded and never trusted. Cost: a handful of Approves, once. Sure: 75%.
- **Old Mac kept** → nothing changes for its tabs and agents.
- **Keep every grant, and Remove by hand** → Keybase's way, where old links stay valid. Not the lean:
  a thief's tab on a stolen Mac would stay in.
- **What stays either way:** everything already written. A note's `by` is still the old agent's
  key, and `for` still the person. History does not change, so the same notes show.

### 10. The attack stories

Each says what the attacker gets in Tier 1, and what would take it away later.

- **A stolen sheet, old Mac still yours.** The thief types it on their own Mac and answers "lost".
  They get everything: the notes, and your Mac is dropped. Your Mac shows "This Mac was removed by
  a backup sheet on <date>" on its next open, so you know, but you cannot undo it. This is how
  Keybase paper keys, BIP39 wallets and Tailscale's disablement secrets work. **What takes it
  away:** a wait before the new key takes effect, which your live Mac can stop with a finger (Signal,
  Bitwarden). It is the first thing to harden, and nothing is lost by waiting, since `door/hellos`
  already records when each key was last seen. **An owner call.**
- **A photographed sheet.** The same as stolen, and you do not know. If you suspect it, make a new
  sheet, which drops the old one. The app never shows the words again after making, so a photo can
  only be of the paper or of the screen that one time.
- **A stolen Mac, off or locked.** FileVault and the login Keychain hold the sealed person key. The
  thief gets nothing without the login password. You recover on a new Mac, answer "lost", and the
  old Mac's keys and grants are dead.
- **A stolen Mac, awake and unlocked.** An open window keeps working, since the window key signs
  each `initialize` silently, by design. So the thief can read notes until you recover. Approve,
  Remove and making a sheet need Touch ID. Reading the sealed key outside the app makes macOS ask
  for the login password. **With the login password,** the thief can sign as the person key: let
  their own tabs in, and make a new sheet, which drops yours. Then you cannot recover. This is the
  hole that remains, and it needs both the Mac and its password. The wait above would close it too,
  and so would a person key that cannot drop a sheet. Tier 1 accepts it, as most products do once a
  device's login is known. Sure this is the right call for Tier 1: 60%.
- **Someone on the network.** The words never cross the wire, only a public key and a signature. A
  replayed `added` is the same `id` (one fact), or for another ledger (`to`), or from a spent sheet.
- **Guessing the words.** 128 bits, against a public key members can read. Not doable.
- **Malware on the new Mac while the sheet is typed.** It gets the words. Nothing in this design
  stops that. A clean Mac is the only answer, as for every product above.

## What it does not cover

- **The local stage's ledger.** It lives in Miniflare's storage on the lost Mac's disk, and goes with
  it. The new Mac founds a fresh local stage. Real notes are on Cloudflare, which is what the sheet
  brings back. Sure this is fine: 75%, since the local stage holds the counter and tests.
- **Losing the Cloudflare account itself.** That is Cloudflare's own sign-in and recovery. The sheet
  needs the ledger to be reachable.
- **Moving with Migration Assistant or a Time Machine restore.** These may carry the sealed keys and
  the Keychain item across, so the new Mac could just work with no sheet. That is a guess, not run.
  If it works, a restored Mac that was dropped by a recovery sees its keys refused, as above.

## How it would be tested

P28 is "its own small exam, then the sheet". The exam, written by an agent that is not the
builder and read by the owner, holds:

- **p28's new laws** (above), property-based, on Node.
- **Real `ssh-keygen` vectors** for `added`, as p27 has for grants: a recovery key rebuilt from
  fixed test words, written to a temp file, signs; it passes. A spent sheet, a replaced sheet, a
  person key adding a person, a window key signing, a recovery key signing a grant, drops naming
  another person's key, and another ledger's `to` are each refused, with the answers above.
- **The sheet's pure law:** words to key and back. One changed word fails the checksum or gives
  another key. The check code matches only the right key.
- **The secret stays home:** during a full recovery on a stage, every frame sent, every ledger row
  and every log line is searched for each of the 12 words, the entropy and the seed. None is found.
- **The done check, end to end,** on real Electron with a test `PersonCheck` and a stand-in
  printer that writes the sheet to the temp home:
  1. Home A founds, saves a note on a stage that stands in for the cloud, and makes a sheet.
  2. Home A is closed for good. Home B opens, picks "I have a backup sheet", types the address
     and words, and answers "lost".
  3. Home B shows the same note and the same name. The ledger's `founded` is unchanged, and its
     `rev` goes on from where it was: no new ledger.
  4. Home A, opened again, is refused and says it was removed by a backup sheet.
  5. The same words again on home C: "This sheet was used". Home B's menu bar shows "No backup
     sheet. [Make one]".
  6. Home C with no sheet: the waiting screen and nothing else.
- **Plants:** spent rule skipped; rank rule skipped (a person key adds a person); drops not applied;
  cascade skipped; words sent in the request; the check code ignored.
- **Only a person can pass:** a real print and a real recovery on a second home, with a real finger,
  logged in `field/`.

## Size, and the plan rows it touches

About 9 files: product 450 to 700 lines, tests 450 to 700 lines, 1 to 2 builder agent hours, plus
the exam. 55% sure: the plan guessed 0.5 to 1, and the screens are where it may grow.

- **P9** (`MemberFact`, `foldMembers`, p28): `added`, `Adds`, `AddSaw`, the rank on each key, the
  spent set and the cascade in `admitted`. P9 can leave room for them now. If P9 lands first, P28
  adds them, and no fact written before is lost, since a reader skips a tag it does not know.
- **P10** (the door): `/grant` takes `added`, and `mayAdd` gives `used`, `replaced` and
  `not_allowed`. The same SSHSIG check.
- **P19** (the app): the founding screen gains "I have a backup sheet", and a removed Mac's screen
  says so in plain words. It never makes new keys by itself.
- **P21** (the menu bar): the "No backup sheet. [Make one]" row, and the making flow behind Touch ID.
- **P28** (the backup): all of the above, on top of P26's cloud notes, with its own exam first.
- **The plan's s13 and check 6** get their words from "How it would be tested" above.

New files, a guess: `tuval/src/desktop/sheet.ts` (pure), `tuval/electron/sheet.*` (the screen and
the print), `tuval/electron/recover.*` (the founding screen's second path), and
`apps/fabrika/recover.ts` (the developer path). One new dependency, `@scure/bip39`, at an exact
version.

## The open calls for the owner

1. **A wait before a recovery takes effect, with a stop from a live Mac.** Lean: not in Tier 1, first in
   the next hardening. 60%.
2. **A passphrase on top of the sheet** (1Password's two halves). Lean: no. A forgotten passphrase
   makes the sheet useless exactly when it is needed, the way Signal's PIN is often forgotten. 70%.
3. **Recovery asks lost or kept,** instead of always dropping the old Mac. Lean: ask. 70%.
4. **A dropped Mac takes its tabs and agents with it.** Lean: yes. 75%.
5. **A sheet works once, and one sheet is live at a time.** Lean: yes. 80% and 75%.
6. **Paper only; the app saves no file.** Lean: yes. 75%.
7. **The rank rules:** a person key cannot add or drop a person key; a recovery key only lets in a
   Mac. Lean: yes. 75%.
8. **Type two words back when making a sheet.** Lean: yes. 70%.
9. **`@scure/bip39` as a new dependency** rather than a copied word list. Lean: yes. 80%.

## What it cannot tell us

- **Whether people keep the sheet.** Every product above loses accounts because the paper was
  never printed or was thrown out. Only real use shows it.
- **Whether Touch ID really guards the person key** against someone at an unlocked Mac. P4 found
  `canPromptTouchID()` true on an unsigned build, but `promptTouchID` itself was never called, and
  nobody tried reading the `safeStorage` item from another process.
- **Whether Migration Assistant or Time Machine carry the sealed keys.** Not run.
- **How the stolen-sheet risk weighs against a lost-sheet risk** for this owner. That is a call,
  not a measurement.
- **Whether the cascade's cost is small.** It is a handful of Approves with Tier 1's few clients.
  With many tabs and agents it could be a chore, and a later tier may want to pick which to keep.
- **Whether the new Mac's first `initialize` works before the menu bar is up.** The order of the
  screens is a guess until P19 exists.

## Made up here

These are proposals, not settled words or numbers:

- The field names `adds`, `drops`, `typed`, `old`, `v`, the struct names `Add`, `Adds`, `AddSaw`,
  the `Rank` type, and the function `mayAdd`.
- The `why` words `used`, `replaced` and `not_allowed`.
- The HKDF label and the choice of HKDF over BIP39's own seed.
- 12 words; the four-character check code; two words typed back.
- Every screen's words, the sheet's layout, and the file names.
- The size and hours.
- The example name "MacBook Pro", the date and the words on the sample sheet.
