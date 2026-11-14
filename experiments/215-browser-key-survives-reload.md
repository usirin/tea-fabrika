---
date: "2026-11-05"
summary: "`next/`, Tier 1 row P3 (plan task T5); a spike. Yes in Chromium 156.0.8078.4 (Playwright 1.64.1, headless shell and full headless, temp profile): a key made with `generateKey({name: \"Ed25519\"}, false, [\"sign\", \"verify\"])` and kept in IndexedDB on `http://127.0.0.1:<port>` is the same key after a reload and after a browser restart on the same profile, signs after each, and `exportKey` (`pkcs8`, `jwk`, `raw`) and `wrapKey` all reject with `InvalidAccessError`. The key is per origin: a second port or `localhost` sees none, so the brain's URL must keep its port. `storage.persisted()` is false. Safari's seven-day cap on script-written storage is reading only (WebKit 2020, 2023): daily use resets it, a Home Screen web app has its own counter. Lean: keep T5 step 2 as written, 90% for desktop Chromium. Not tested: other browsers, eviction, a crash, time. No model, $0."
---

# A browser tab's key survives a reload and a restart in Chromium

**Yes, in Chromium 156.** A non-extractable Ed25519 key, kept in IndexedDB by a page served from
`http://127.0.0.1:<port>`, is still there after a page reload and after the whole browser is closed
and started again on the same profile. It signs after each, and every way to get its private half
out (`exportKey` as `pkcs8`, `jwk` and `raw`, and `wrapKey`) rejects with `InvalidAccessError`. So
Tier 1's P3 does not stop the plan: T5's step 2 ("tab makes an Ed25519 key, not extractable, keeps
it in IndexedDB") works as written.

One thing the plan must hold on to: **the key belongs to the origin, port included.** The same page
on a second port of 127.0.0.1, or as `http://localhost:<same port>`, sees no key. A brain that comes
up on a new port would make every tab a new client, asking for Approve again.

```js
// The whole idea, from experiments/215-browser-key-survives-reload/index.html.
const pair = await crypto.subtle.generateKey({name: "Ed25519"}, false, ["sign", "verify"]);
await put("keys", "tab", pair); // IndexedDB keeps the CryptoKeyPair as it is (structured clone)

// after a reload, or a browser restart:
const kept = await get("keys", "tab");
await crypto.subtle.sign({name: "Ed25519"}, kept.privateKey, data); // 64 bytes, verifies
await crypto.subtle.exportKey("pkcs8", kept.privateKey); // rejects: InvalidAccessError
```

**Which version.** `next/` design work, a throwaway spike for Tier 1 row P3 (plan task T5, the
browser tab's own key). No product code changed.

## The question

T5 has a browser tab make its own key on its first visit and sign every hello with it. If the key
did not survive a reload, a tab would need a new Approve each time the page reloads, and the only
fallback is a key the page can read, which any script on the page could copy. The plan says: if it
fails, stop and tell the owner.

## The known way

This is how the web platform means a key to be kept: WebCrypto's `CryptoKey` is serializable, so
IndexedDB stores it whole, and `extractable: false` makes the browser refuse to hand its bytes back
(W3C Web Cryptography API, `exportKey` and `wrapKey` both throw `InvalidAccessError` when
`[[extractable]]` is false). WebAuthn keys are the stronger option (held by the platform, not the
page), but they ask the person for a gesture each time, which a silent hello cannot do. The
question here is not whether the spec allows it, but whether Chromium keeps it over a restart on a
plain `http://127.0.0.1` page.

## What was built

- `215-browser-key-survives-reload/index.html`: one page with no dependencies. It makes the key
  if none is kept, signs a fresh text and verifies it, and tries `exportKey` in three formats and
  `wrapKey` under an AES-GCM key. It never returns key bytes: only names, flags, and a SHA-256
  fingerprint of the public key.
- `215-browser-key-survives-reload.ts`: serves the page from Node on `127.0.0.1`, a random port
  kept for the whole run, and drives it with Playwright 1.64.1 (from `apps/fabrika`'s
  dependencies). It opens a persistent context in a fresh temp folder, never a real profile.

Cases, each checked for the same public fingerprint, a good signature, and four rejections:

| Case | What happens | Same key | Signs | Export and wrap |
|---|---|---|---|---|
| first | first visit, key made | (made now) | yes | all `InvalidAccessError` |
| reload | `page.reload()` | yes | yes | all `InvalidAccessError` |
| restart | browser closed, started again on the same profile folder | yes | yes | all `InvalidAccessError` |
| other port | same page, second port on 127.0.0.1 | no key there | - | - |
| localhost | same page, `http://localhost:<same port>` | no key there | - | - |

It ran twice, one browser at a time, with the same answers both times: Playwright's headless shell
(Chromium 156.0.8078.4) and channel `chromium`, the full browser in its new headless mode (same
build). Other facts the page saw: `isSecureContext` is true on `http://127.0.0.1`, which WebCrypto
needs; the kept private key reads back `extractable: false`, `type: "private"`, usages `["sign"]`;
and `navigator.storage.persisted()` is false, so the storage is best effort (see below). Saved in
`results/215-browser-key-survives-reload.json`.

## Safari, WebKit and iOS (reading, not tested)

Nothing below was run. It comes from WebKit's own posts, read on 2026-11-05.

- **The seven-day cap.** Since Safari 13.1 and iOS 13.4 (March 2020), Intelligent Tracking
  Prevention deletes "all of a website's script-writable storage after seven days of Safari use
  without user interaction on the site", IndexedDB included. Days count only when Safari is used,
  and using the site resets the count. A web app added to the Home Screen has its own counter and
  is not expected to lose first-party data
  ([WebKit, March 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
- **For fabrika,** a tab a person uses daily resets the count, so the key stays. A phone that opens
  fabrika once a fortnight may lose the key and ask for one more Approve, as the plan already says.
  A Home Screen web app would avoid it.
- **`persist()`.** Since Safari 17, an origin "might be excluded from eviction if it has active
  page at the time of eviction, or its storage is in persistent mode", and WebKit grants
  `navigator.storage.persist()` by heuristics such as being a Home Screen web app
  ([WebKit, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)).
  That post does not say whether persistent mode lifts the seven-day cap. Not settled here.
- **Whether the cap applies to `127.0.0.1` or `localhost` at all** is not said in either post.
  Unknown.

## Lean

Keep T5's step 2 as written: a non-extractable Ed25519 key in IndexedDB, no fallback. Sure: 90% for
Chromium on a desktop, from this run. Two things the plan should add, both small:

- **A fixed port for the brain's URL** (or a fixed host name), because the key is per origin. A
  changed port means a new key and a new Approve for every tab. Costs nothing if the URL is
  already fixed; check where the brain picks its port.
- **Call `navigator.storage.persist()` once after the grant.** Chromium grants it by its own
  heuristics (often to a bookmarked or installed site); it was false here. It is one line and
  lowers the chance that storage pressure clears the key. Its effect was not measured.

## What this cannot tell us

- **Only Chromium 156, headless, on macOS.** Not a headed Chrome with a person's real profile,
  not Edge, Firefox, Safari or a phone. Whether each of those supports Ed25519 in WebCrypto was not
  checked here.
- **Not eviction.** Chromium can clear best-effort storage under disk pressure, and the person can
  clear site data. Neither was tried; either loses the key, and the tab then asks again, which T5
  already handles as an unknown key.
- **Not time.** The restart was seconds after the first visit. Safari's seven-day rule is reading
  only, above.
- **Not a crash.** The browser was closed cleanly. A killed browser might lose a write that was
  not yet flushed; the key is written once, on first visit, so the window for that is small.
- **Not what the page can still do with the key.** Non-extractable stops copying the bytes, not
  using them: a script injected into the page can still sign with it while the page is open. That
  is the known limit of any page-held key, and the brain's checks (nonce, URL, tab) are what bound
  it.
- **Not Electron.** Electron's window keeps its key in the main process (the note's T3), so this
  run says nothing about it.

## How to run it

```sh
env -u TYPESAFE_API_KEY nice -n 19 node experiments/215-browser-key-survives-reload.ts
```

No model, no key of ours, no network beyond 127.0.0.1, $0. About 10 seconds.
