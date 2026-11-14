---
date: "2026-11-05"
scripts: "none"
summary: "`next/`, for the backup note (pull request 404); research, not a measurement, reading the docs, string files and forums of about 20 products (1Password, Bitwarden, Apple, Signal, WhatsApp, Proton, Ente, Keybase, Tailscale, Ledger, Trezor, Google, Microsoft and others). The best ones share five things: they say plainly they cannot help, setup is not done until you prove you have the key, a new one kills the old one, they name where not to keep it (the place it unlocks), and a later check is offline and on demand. A PDF of the whole secret has precedent (Proton's 12-word phrase; Signal and Tailscale accept a password manager), but not 1Password's, whose PDF is half the secret. Waits come only where the proof is weak or another person acts, so the owner's no-wait call fits the strong-key group; flagged: no wait plus a PDF makes a copied file an instant takeover, while Apple and 1Password each add a second factor. To copy: numbered slots, the check code as a public label (Keybase), \"fabrika will never ask for these words\" (Signal), an offline \"Check my sheet\", an end screen that counts what was removed, and telling the old Mac at once. Leans 70% to 85%. No model, $0."
---

# How do the best products do a recovery kit, and what should fabrika's backup sheet copy?

Read 2026-11-05. **This is research, not a measurement.** Nobody ran a recovery, printed a sheet or
watched a person. It reads public docs, support pages, two apps' own string files and forum threads
from about 20 products. Every link below was read on 2026-11-05. A claim marked *unverified* was seen
only in a search snippet or a second-hand source. No model, $0.

It is for `next/` only: the proposed note
[A lost Mac comes back with a recovery key on paper](../docs/direction/recovery-key.md) (pull request
404). It does not change that note. The owner's calls of 2026-11-05 are taken as given: no wait before
a recovery takes effect, no passphrase on top, one question on recovery ("Is your old Mac lost or
stolen?", default yes), a dropped key drops everything it let in, a sheet works once, and a new sheet
kills the old one.

*Later, 2026-11-06:* the owner decided the note, now titled
[Account recovery: a sheet of 12 words, and email for the cloud](../docs/direction/recovery-key.md).
It takes this write-up's leans: print first with a PDF allowed, two words back plus "Check my sheet",
numbered slots and a public label, and the old Mac told at once. The open point in step 3, where a
check is written, is decided: a `checked` fact on the ledger, signed by the device, never the words.

```text
What the best ones share, as fabrika's sheet would do it (a sketch):

  make it      once, from a quiet row        12 numbered words, printed or saved, plus a public label
  prove it     right after making            type some words back, or setup is not done
  live with it never asked                   a "Check my sheet" any time, offline, never a nag
  replace it   on purpose, or after a use    the new one kills the old one, every time
  use it       once in years                 words, then the app says plainly what it just did
  after        the next open                 the old device and the person are told, in plain words
```

## The answer first

- **Five patterns the best ones share:**
  1. **They say "we cannot help" plainly.** Apple, Signal, WhatsApp, Ente, Obsidian, Tailscale and
     Bitwarden all say, in the setup copy itself, that losing the key means losing the account, and
     that they cannot get it back. None softens it.
  2. **Setup is not done until you prove you have it.** Apple ("To complete setup, confirm your
     recovery key"), Signal (type all 64 characters back), Ledger (all 24 words) and Trezor (picked
     words) all check. Proton and 1Password do not, and their forums hold the lost-kit stories.
  3. **A new one kills the old one,** wherever the docs say: Google, Microsoft, 1Password, Bitwarden,
     Keybase, Tailscale. Nobody keeps two live codes from two printings.
  4. **They name where not to keep it:** the place it unlocks. Apple: not in iCloud. Proton: not in
     Proton Drive or Pass. Signal: only "a password manager that you trust".
  5. **A later check exists, and it is offline and on demand.** Trezor's Check backup, Ledger's Recovery
     Check, Ente's verify screen. Only Signal asks on a schedule, and it lets you say "Not now".
- **Paper or PDF.** A PDF that holds the whole secret has good company: Proton offers its 12-word
  phrase as a PDF download, Signal has a "Save to password manager" button, Tailscale suggests a
  password manager. **But 1Password is the wrong reason.** Its PDF holds only half the secret; the
  docs say to write the password only on a printed copy. Lean: print first, PDF second, with one line
  on where not to keep it. 75%.
- **Confirming the save.** Two words typed back is the light end of what others do. Lean: keep it, and
  add an offline "Check my sheet" that types all 12 any time. 75%.
- **Single use, and a new one kills the old.** Both have precedent (Bitwarden and Google codes are
  single use; everyone kills the old one). 1Password made its code reusable on purpose. Lean: keep the
  owner's calls. 80%.
- **The moment of recovery.** Products whose recovery secret is a strong key (Apple's key path, Proton's
  phrase, Keybase, Tailscale, wallets) do not wait. Waits come where the proof is weak (email, phone)
  or another person acts (Bitwarden, Signal, Apple without a key, 1Password's recovery code). The
  owner's no-wait call fits the strong-key group.
- **One flag for the owner (below):** no wait plus a PDF makes a copied file a silent, instant
  takeover. Apple and 1Password, the two closest consumer products, each add a second thing (a phone
  code, an email code). Each call is fine alone; together they deserve one look.

## The products

One row each. "New kills old" means a new code or key makes the previous one stop working.

| Product | What you get | When you meet it | Prove you saved it | Use once? New kills old? | On use | Wait |
|---|---|---|---|---|---|---|
| [1Password Emergency Kit](https://support.1password.com/emergency-kit/) | PDF: address, email, Secret Key (34 characters), a blank box for the password, a QR Setup Code | At signup; downloadable again later | None found (*unverified*) | Reusable; holds half the secret | Sign in on a new device, with the password too | None |
| [1Password recovery code](https://support.1password.com/recovery-codes/) | A code (format not published) | Made ahead, in settings, since [June 2024](https://1password.com/blog/introducing-1password-recovery-codes) | None found | "reusable and will remain valid after it's used"; replacing "will invalidate your previous code" | Plus an email code: new password, new Secret Key, new kit, sign in again everywhere, data kept | 1 hour after making it; 24 hours blocked after a recent sign-in |
| [Bitwarden recovery code](https://bitwarden.com/help/two-step-recovery-code/) | A code, behind the master password | In settings, any time | None | Single use: "After using a recovery code, a new one is generated" | Turns off every two-step method | None |
| [Bitwarden emergency access](https://bitwarden.com/help/emergency-access/) | A trusted contact's own key | Set up by the owner | Fingerprint phrase checked with the contact | Contact can ask again | View or takeover; takeover replaces the master password | At least one day; the owner can deny |
| [Apple recovery key](https://support.apple.com/en-us/109345) | 28 characters | In settings; Advanced Data Protection [asks for a recovery method](https://support.apple.com/en-us/108756) | Yes: "To complete setup, confirm your recovery key" | "Replace Recovery Key"; old one's fate not stated | Plus a code to the trusted phone number | None with the key |
| [Apple account recovery](https://support.apple.com/HT204921) | Nothing kept; identity checks | Only when locked out | n/a | n/a | Access back | "several days or longer"; a signed-in device cancels it |
| [Signal secure backups](https://signal.org/blog/introducing-secure-backups/) | 64 characters | When turning backups on | Yes: type it all back ([app strings](https://github.com/signalapp/Signal-Android/blob/main/app/src/main/res/values/strings.xml)); re-asked later, "We will ask you again in a week" | Reusable; a new key is allowed once per 7 days and needs a re-upload | Restore only at first setup | None |
| [WhatsApp backups](https://faq.whatsapp.com/490592613091019) | 64 digits, a password, or a passkey | When turning encryption on | Asked to "affirm" at launch ([2021 press](https://tomsguide.com/news/whatsapp-encrypted-backups), *unverified* today) | Reusable | Restores the backup | Password guesses are limited by a hardware vault |
| [Proton recovery phrase](https://proton.me/support/recovery-phrase) | 12 words; PDF download or copy | At signup; again in settings | None: "That's it. Your recovery phrase is now active." | "one-time backup password" ([reset page](https://proton.me/support/reset-password)); the [2023 blog](https://proton.me/blog/data-recovery-end-to-end-encryption) says older methods "remain usable" | Password and data back; the Recovery page marks a spent method "outdated" | None |
| [Ente recovery key](https://ente.com/help/photos/faq/security-and-privacy) | 24 words | At signup, "before uploading any photos" | A verify screen exists ([strings](https://github.com/ente-io/ente/blob/main/mobile/packages/strings/lib/l10n/arb/strings_en.arb)); when it shows is *unverified* | "Your recovery key cannot be changed." | New password | None; its legacy kit waits and lets the owner reject |
| [Keybase paper key](https://book.keybase.io/account) | About 13 to 14 words; [the first two are a public label](https://keybase.io/blog/keybase-new-key-model) | First login | Not found | Reusable; [a new one offers to revoke old ones](https://github.com/angelkey/angelkey/blob/483990c30ec8/go/engine/paperkey.go) (a fork of the client) | Adds a device; can revoke others | None |
| [Tailscale disablement secrets](https://tailscale.com/kb/1226/tailnet-lock) | Ten long passwords, shown once | `tailscale lock init` | None | Using one makes it public; re-enabling makes new ones | Turns the lock off for everyone | None |
| [Ledger](https://www.ledger.com/academy/glossary/recovery-sheet) | 24 words on a numbered card in the box | First setup | Confirm every word on the device | Never changes | Restores the wallet | None |
| [Trezor](https://trezor.io/guides/trezor-devices/trezor-safe-5/get-started-with-the-trezor-safe-5) | 20 words (or 12) on backup cards, shown "one by one" | First setup | Pick "specific words from your backup" | Never changes; [Check backup](https://trezor.io/guides/backups-recovery/general-standards/check-backup-on-trezor-safe-5) dry run any time | Restores the wallet | None |
| [Google backup codes](https://support.google.com/accounts/answer/1187538) | 10 codes of 8 digits; print or a `.txt` | In settings | None | "Each code can be used only once"; "the old set automatically becomes inactive" | Signs in | None |
| [Microsoft recovery code](https://support.microsoft.com/en-us/accounts-billing/manage/how-to-get-a-microsoft-account-recovery-code) | 25 characters | In settings | None | "any previous codes will no longer work" | Offers a password reset | None |

Also read: [Standard Notes](https://standardnotes.com/help/6/i-ve-forgotten-my-password-what-should-i-do)
and [Obsidian Sync](https://obsidian.md/help/Obsidian+Sync/Security+and+privacy) offer no recovery key
at all; a forgotten password means exporting from a device still signed in, or starting over.
[FIDO's guidance](https://fidoalliance.org/white-paper-multiple-authenticators-for-reducing-account-recovery-needs-for-fido-enabled-consumer-accounts/)
says the first answer is "register multiple authenticators, to reduce the need for account recovery".

### How they fail

- **Never made, or thrown out.** The most common story by far, at
  [1Password](https://1password.community/discussion/92656/loss-of-secret-key),
  [Apple](https://discussions.apple.com/thread/255055785) (new iPhone, key lost, cannot sign in to
  make a new one), [WhatsApp](https://discussions.apple.com/thread/255234496) and
  [Obsidian](https://forum.obsidian.md/t/how-to-reset-vault-encryption-password/44650).
- **Written wrong.** Words copied out of order or a 24-word phrase typed as 12, on
  [Trezor's forum](https://forum.trezor.io/t/help-with-recovery-from-seed/21405) and
  [again](https://forum.trezor.io/t/trezor-t-invalid-recovery-phrase/7369). An industry survey says only
  15% had ever tested their recovery ([Oobit](https://www.oobit.com/lost-or-locked-out), not peer
  reviewed).
- **Phished.** Campaigns pose as Signal support to ask for recovery keys
  ([report](https://www.newsbytesapp.com/news/science/hackers-are-stealing-signal-users-recovery-keys-via-phishing-attacks/story)).
  Signal's answer is a warning sheet: "Signal will never message you for your registration code, PIN,
  or recovery key."
- **Misread.** Bitwarden users think the recovery code resets the master password; it only removes
  two-step login ([forum](https://community.bitwarden.com/t/locked-myself-out-of-bitwarden-master-password/97217)).
- **A recovery that silently stopped.** A 1Password thread says a background sign-in canceled a
  recovery in progress ([thread](https://1password.community/discussions/1password/account-recovery-fails-despite-having-secret-key-and-recovery-code-password-forg/166069),
  *unverified*, not read in full).
- **A file left where malware reads.** A 1Password user found the kit sitting in Downloads; staff said
  that is fine because "The Secret Key alone cannot be used to sign in or unlock an account"
  ([thread](https://www.1password.community/1password-at-home-31/my-emergency-kit-pdf-was-left-readable-in-the-downloads-folder-after-my-1password-installation-25520)).
  That defense does not hold for a sheet that is the whole key.

## What fabrika should copy, step by step as a person meets it

### 1. No sheet yet: a quiet row, already in the note

Proton's Recovery page shows each method with a status, and a spent one reads "outdated" with an
**Update** button ([Proton](https://proton.me/support/set-account-recovery-methods)). The note's menu bar
row is the same idea and needs no change. When met: until a sheet exists. How often: never pushed.

### 2. Making the sheet: words in numbered slots, and the label on top

```text
fabrika backup sheet                                   sheet r1-7f3a, made 5 Nov 2026
for        <the founded name>
address    https://<the ledger's address>

 1 ocean      2 tackle     3 ......     4 ......
 5 ......     6 ......     7 ......     8 ......
 9 ......    10 ......    11 ......    12 ......

These 12 words open your fabrika. We cannot get them back for you.
Keep this with your passport. fabrika will never ask for these words.
Only type them on a new Mac's first screen.
```

- **Numbered slots in a grid** (Ledger's card, Trezor's cards). Why: the top failure after "never made"
  is words copied out of order. Cost: none. Sure: 85%.
- **The check code becomes a public label at the top** (Keybase: "the first 2 words ... are a public
  label"). The menu bar shows the same label: "Backup sheet r1-7f3a, made 5 Nov". Why: a person holding
  a paper can tell if it is the live one without typing a word, and a reprint is easy to tell from an
  old one. Cost: none; the note already has the check code. Sure: 80%.
- **"We cannot get them back for you"** in the first lines, as Apple, Signal and Ente say it. Why: every
  good product says it plainly, and it is the one line that makes people keep the paper. Sure: 80%.
- **"fabrika will never ask for these words. Only type them on a new Mac's first screen."** (Signal's
  warning sheet; Trezor's "Never enter your backup anywhere other than directly on your Trezor
  device"). Why: phishing is a live attack on exactly this kind of key. Cost: one line. Sure: 85%.
- **Print first, then "Save as PDF", then "I'll write them down".** The save line under it names where
  not to keep it: "Not in fabrika's notes, and not only on this Mac. A password manager or a USB stick
  is fine." Why: Apple and Proton both name the place the key unlocks; Signal and Tailscale accept a
  password manager. Cost: one line, and a file the app cannot track once saved. Sure: 75%.

### 3. Proving the save: two words now, a full check any time

```ts
// A sketch. Pure, beside sheet.ts in the note. Nothing leaves the Mac; no dial.
type SheetCheck =
	| {readonly _tag: "right"; readonly label: string} // "r1-7f3a": the live sheet
	| {readonly _tag: "old"; readonly label: string} // a real sheet of this fabrika, replaced
	| {readonly _tag: "wrong"; readonly word: number | null}; // a word off the list, or no match

// Rebuild the public key from the 12 words and compare it with the keys the Mac already holds.
declare const checkSheet: (words: ReadonlyArray<string>, members: Members) => SheetCheck;
```

- **Two words typed back when making** (the owner's call). Apple and Signal ask for the whole key,
  Ledger for every word, Trezor for picked words. Two is the light end, and it catches a person who
  never wrote anything. Cost: 20 seconds once. Sure: 70% that two is enough; the doubt is order
  mistakes, which two words rarely catch.
- **"Check my sheet", any time, offline** (Trezor's Check backup, Ledger's Recovery Check, Ente's
  verify). The person types all 12; the Mac answers "This is your live sheet, r1-7f3a", "This is an
  old sheet. It no longer works" or "Word 7 does not match". Why: it is the one way to catch an order
  mistake without a real recovery, and it costs nothing on a normal day. Cost: one screen and one pure
  function; the words stay in memory, as when making. Sure: 75%.
- **No schedule.** Signal asks weekly, then less often. Not copied: AGENTS.md wants nothing on a
  normal day. When met: only when the person opens it.
- **Record that a check happened** (when, which label, which answer), never the words. A check is a
  fact that exists only at that moment, and "when did they last know they had it" is the question a
  lockout story asks later. Where it is written (the ledger or the Mac's own log) is open.

### 4. Living with it, and replacing it

- **Nothing on a normal day.** Matches every product above except Signal.
- **"Make a new sheet" kills the old one,** as Google, Microsoft, 1Password and Bitwarden say in the
  same words. The screen says it before the Touch ID: "Your sheet r1-7f3a will stop working." Sure: 85%.

### 5. The moment of recovery

```text
  I have a backup sheet
  address   https://...
  words     [ocean ] [tack|le ] ...          each field completes after 4 letters (BIP39 list)
            Word 7 is not on the list.       caught on the Mac, before any dial
  check     r1-7f3a  This is your live sheet.

  Is your old Mac lost or stolen?
  (*) Yes, remove it and everything it let in       ( ) No, I still have it

  [Touch ID]

  Done. This Mac is in. Your old Mac, its 2 windows and 1 agent are removed.
  Sheet r1-7f3a is used up. [Make a new sheet]
```

- **Say what just happened, with numbers.** 1Password lists every effect of a recovery on its page
  (new key, sign in again everywhere, data kept); Proton marks the spent method. Why: a calm end screen
  is the cool part, and the person needs to know what stopped. Cost: the fold already knows the counts.
  Sure: 80%.
- **The new-sheet button sits on the end screen,** not only in the menu bar row. Proton's "Update" on a
  spent method is the model. Sure: 75%.
- **Tell the old Mac at once if it is online,** not only on its next open. Proton sends an email and a
  push on a reset; Apple's wait is canceled by a signed-in device, which means the device is told.
  With no wait, telling cannot stop a thief, but it tells the person within seconds. Cost: the window
  already holds a live connection. Sure: 70%.

## Owner calls this touches

- **Paper vs PDF: allow the PDF, but not for 1Password's reason.** 1Password's PDF is safe in the cloud
  because it is half a secret; ours is the whole thing. Proton is the right precedent: a 12-word phrase
  that opens the account, offered as a PDF. This does not change the lean, only the reason and one line
  of copy.
- **No wait, flagged plainly.** No wait matches the strong-key products. But with a PDF allowed, a copied
  file in a synced folder becomes an instant, silent takeover, and the closest consumer products each
  add a second thing: Apple a code to the trusted phone, 1Password an email code and a 24-hour block
  after a recent sign-in. Each owner call is fine alone. Together they are worth one look, and the
  cheapest middle is not a wait: it is telling the old Mac at once (step 5) and saying "not only on this
  Mac" when saving.
- **Two words typed back.** Holds. The full check in step 3 covers what two words miss.
- **A sheet works once, a new one kills the old.** Holds, with Bitwarden, Google and Microsoft. 1Password
  chose reusable because it adds an email code each time; fabrika has no second factor, so single use is
  the safer match.
- **"Is your old Mac lost or stolen?", default yes.** No product above asks this. Keybase and Tailscale
  revoke as a separate step. Nothing here argues against it.
- **12 words.** Matches Proton and BIP39 wallets. Ente and Ledger use 24, Trezor 20. Nothing argues for
  more.

## What it cannot tell us

- **How people use any of this.** No product publishes how many kits are printed, kept, or used. The
  only numbers are wallet surveys, one peer reviewed
  ([Krombholz et al., 2016](https://eprints.cs.univie.ac.at/6493): 22.5% of 990 users lost bitcoins, a
  figure *unverified* from a second-hand copy) and one not (Oobit).
- **Real screens.** This reads docs and string files, not the apps. Ledger's consumer confirm screen,
  1Password's signup step (can you skip the kit?), Ente's verify trigger and WhatsApp's confirm today
  are *unverified*. Signal's help center refused the fetcher; its strings file was read instead.
- **What a recovery does to other devices,** for most products. Only 1Password says "sign in again on
  all your devices". Apple and Proton do not say.
- **Whether a new Apple or Proton key kills the old one.** Not stated on either page.
- **Whether the PDF risk is real for this owner.** That is a judgment about where the owner's files sync, not a
  fact any doc settles.
