# P10 test-writer record

The [check on the built product](./build-check.md) records the later test
corrections, 121 passing cases and the remaining workspace type errors.

The follow-up [type audit](./type-audit.md) lists the test-only fixes and every
remaining build diagnostic, with a single-thread check config. That follow-up
reran the door file once and refreshed its 66 case locations below.

`next/`, tracker ticket 248. The approved P10 plan, plus the lead's process-id
contract, on merge `06d4fecb` of main `bde48daa`. Main's prerequisite landed in
[PR 490](https://github.com/usirin/tea-fabrika/pull/490).

```ts
// The test boundary: real P6 + P9 + P37 over node:sqlite, with a P11 delivery callback.
// No Durable Object class, real socket, program runner or product implementation is added.
const tests = {total: 159, failed: 157, passed: 2};
```

## Observed red

All nine new test files were run with one worker. **157 failed and 2
passed.** The two passing controls are ordinary Ed25519 Signed compatibility
and the independent OpenSSH check of the recorded browser assertion. P7's
unchanged existing suite separately passed all 61 tests. Typecheck was left to
the lead as instructed.

`pnpm format` and `pnpm lint` passed. No product implementation was added.

Commands requested `nice -n 19`, but the sandbox denied changing priority.
The one-worker limit was used throughout.

[red.json](./red.json) records every individual case, its file and line, and
its observed first failure. Machine paths and stacks are omitted. There is no
skip, todo or assertion that treats a missing implementation as success.

Most cases stop at a missing P10 API, or at the missing `door.ts` loaded by
the test hook. The two passkey schema extension tests reach their assertions
and fail because decoding drops the new fields. These are pre-build results.
They do **not** claim that every described behavioral plant has already been
killed. The mutation step must demonstrate that after the builder exists.
The integration setup itself cannot be exercised through the absent door yet.

The door and door-spans laws share one `door.test.ts` world to avoid duplicating
its real service setup. The saved browser fixture is inline in
`sshsig-webauthn.test.ts`, as the plan requires. Synthetic P-256 policy controls
are labeled separately from that real fixture. Signer helpers are inline too:
relative code imports from root fixtures cross the workspace boundary.

## Laws, source and plant

Each location below is the first representative case for that law. The JSON
record expands every parameterized case with its own observed failure.

| Law | File:line | How it failed on the base | Wrong code it must catch |
|---|---|---|---|
| p23, replies, retry and parked data | [answer.test.ts:29](../../../next/packages/libfabrika/src/transport/answer.test.ts#L29) | Answer/Attached are absent, so the cases fail at the missing constructors. | Reply to news; turn a typed failure into a domain err; lose reply id zero. |
| p26, hello proof and nonce | [hello.test.ts:108](../../../next/packages/libfabrika/src/transport/hello.test.ts#L108) | checkHello is not a function; each changed binding and refusal case ran red. | Skip nonce, URL, tab or name; admit an unknown key; consume before the checks. |
| p26, origin and Host | [hello.test.ts:212](../../../next/packages/libfabrika/src/transport/hello.test.ts#L212) | sameOrigin is not a function. | Substring-match the origin or trust a forwarded Host. |
| p82, version and additive fields | [hello.test.ts:118](../../../next/packages/libfabrika/src/transport/hello.test.ts#L118) | selectVersion is absent; fast-check shrank to empty lists, seed 119120. | Pick the first/lowest shared version; reject additive fields. |
| p42/p66, claimed hello metadata | [door.test.ts:563](../../../next/apps/fabrika/src/door.test.ts#L563) | door.ts is absent, before this integration body's assertions. | Drop os/has/build/location or derive writer rank from a claim. |
| p43, waiting state | [waiting.test.ts:28](../../../next/packages/libfabrika/src/transport/waiting.test.ts#L28) | Waiting.make is absent. SQLite cap/reopen cases also fail on absent door.ts. | Count duplicate tabs; code per tab; skip expiry/cap; keep rows only in memory. |
| p43, code and grant notification | [door.test.ts:683](../../../next/apps/fabrika/src/door.test.ts#L683) | door.ts is absent. | Authorize by comparison code; clear only one tab; accept the old nonce after approval. |
| p27, grant/revoke/add target | [door.test.ts:892](../../../next/apps/fabrika/src/door.test.ts#L892) | All three wrong-to cases fail on absent door.ts. | Skip to on one case or call ClientManager.write before checking it. |
| p27, WebAuthn writer and checker | [sshsig-webauthn.test.ts:214](../../../next/packages/libfabrika/src/transport/sshsig-webauthn.test.ts#L214) | verifySshsig, writeWebauthnSshsig and PasskeyLine are absent. The independent OpenSSH control passes. | Treat DER as fixed-width; hash only the text; allow bare ECDSA, raw WebAuthn or a type prefix. |
| question 19, person roots and enrollment | [door.test.ts:1310](../../../next/apps/fabrika/src/door.test.ts#L1310) | door.ts is absent; all six changed enrollment bindings have named red cases. | Let a window/agent self-promote; accept an SK root without UV or a bound proof. |
| question 19, durable backup metadata | [passkey.test.ts:15](../../../next/packages/libfabrika/src/coordination/passkey.test.ts#L15) | Actual assertion failure: Signed decoding drops passkey. Adds decoding drops enrollment. | Trust caller flags; discard verified flags/proof; reject BE or zero counters. |
| question 19, recovery and cleared storage | [door.test.ts:1436](../../../next/apps/fabrika/src/door.test.ts#L1436) | door.ts is absent. | Use a sheet twice; report an ignored recovery as applied; block a passkey from admitting a fresh window. |
| p42, original signed text and retries | [text.test.ts:47](../../../next/packages/libfabrika/src/coordination/text.test.ts#L47) | Text writers are absent. The original-text, removed-signer resend and real P9 race cases fail on absent door.ts. | Reserialize before checking; drop saw/has; mint a new parent on resend; turn ignored into applied. |
| p67, stamped envelope | [door.test.ts:1151](../../../next/apps/fabrika/src/door.test.ts#L1151) | door.ts is absent. | Trust sentAt or a supplied id/by; omit an envelope on a read, wait or refusal. |
| p67, spoofing | [door.test.ts:1170](../../../next/apps/fabrika/src/door.test.ts#L1170) | All eight reserved-field cases fail on absent door.ts. | Strip sender claims silently; reject ordinary RPC/letter/nested domain ids; route forged input. |
| p67, durable input retry | [door.test.ts:1090](../../../next/apps/fabrika/src/door.test.ts#L1090) | door.ts is absent. | Allocate another id/trace after a lost append answer; dedupe only by letter. |
| question 16, four signer refusals | [session-manager.test.ts:139](../../../next/packages/libfabrika/src/coordination/session-manager.test.ts#L139) | SessionManager.layer is absent; all four named refusal cases ran red. | Fallback to owner; borrow another process's parent; let an agent or a person comment approve. |
| signer retry, wake and atomic receipt | [session-manager.test.ts:191](../../../next/packages/libfabrika/src/coordination/session-manager.test.ts#L191) | SessionManager.layer is absent. | Spend in a Map; split receipt from spend; revive an ended process; reuse a revoked receipt. |
| P37, bounded reader and content deletion | [door.test.ts:1573](../../../next/apps/fabrika/src/door.test.ts#L1573) | door.ts is absent. | Read only part zero; collect the whole chain; let an agent delete; use the claimed deleter. |
| door input log, span order and links | [door.test.ts:1799](../../../next/apps/fabrika/src/door.test.ts#L1799) | door.ts is absent. | Deliver before recording/flushing; flush before route span end; select writer by traceId. |
| no content leak | [door.test.ts:1886](../../../next/apps/fabrika/src/door.test.ts#L1886) | door.ts is absent. | Log the raw frame, encode a secret in clear, retain raw input bodies or put content in tags. |
| revocation and append race | [door.test.ts:1501](../../../next/apps/fabrika/src/door.test.ts#L1501) | door.ts is absent. | Cache admission forever; treat a signer answer as permanent append permission. |
| shared UUIDv7 TypeID shape | [process-id.test.ts:16](../../../next/packages/libfabrika/src/coordination/process-id.test.ts#L16) | ProcessIdGenerator.layer is absent. | Use UUIDv4, the wrong prefix, encoding, version, variant or timestamp. |
| monotonic within one process | [process-id.test.ts:34](../../../next/packages/libfabrika/src/coordination/process-id.test.ts#L34) | ProcessIdGenerator.layer is absent. | Generate unordered random ids in one millisecond or return a constant. |
| monotonic across clock rollback | [process-id.test.ts:45](../../../next/packages/libfabrika/src/coordination/process-id.test.ts#L45) | ProcessIdGenerator.layer is absent. | Let a backward clock lower or reuse an id. |
| fresh door start and id collision | [door.test.ts:1214](../../../next/apps/fabrika/src/door.test.ts#L1214) | door.ts is absent. | Reuse the door's start id; ignore the saved allocated-start collision. |

The real P9 ignored-recovery case interleaves another real ClientManager write
at the ledger boundary, so the losing write's second fold produces `ignored`.
It does not supply a fake receipt. The bounded-reader case adds a failing tail
after row 256; collecting the whole stream reaches it. The recording and
atomic-spend cases inject failures into the real service/SQLite path. P11's
handoff uses the real Mailbox for durable JSON input, and keeps raw terminal
input and Redacted content out of that mailbox.

## Contract details for the builder

`coordination/process-id.ts` supplies `ProcessIdGenerator.layer` and its
`next: Effect<ProcessId>`, exported through coordination's existing public
index for the door and P33. The data schema remains in `data/trace.ts`.
Tests decode the TypeID independently and check UUIDv7's version, variant,
clock and ordering. A logical timestamp may stay ahead after a clock rollback.
The first fresh id uses the supplied clock. This follows
[RFC 9562's UUIDv7 layout](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7)
and the lead's TypeID contract.

`SessionManager` has trusted internal `record`, `delivered` and `end`
operations in addition to `signer`. The door and P33 need those operations;
they are not public JSON-RPC methods. `SignRequest` carries the stable write
id in internal context. The unit tests play that trusted caller, never a public
decoder of InputId. The public method-table cases refuse attempts to call the
signer, append membership facts or end a process.

`Door.layer(options)` composes the real services. Options supply the founder
needed for a no-founding bootstrap check, the shared next-process function,
typed input/fact declarations, delivery, notifications and settings.
`challenge`, `initialize`, `knock`, `watch`, `deny`, `grant` and
`route` are its checked adapters. `enrollment`, `signer` and `append`
are internal calls for the adapters that P12 builds. Delivery gets the
four-field envelope and a separate trace/span link, so the envelope never
grows extra fields.

The fixture config resolves real public package names before the builder adds
the app's package dependencies. It adds no replacement service, weakened rule
or fake product module. After dependencies exist, the ordinary root config
can run the same tests.

## Plan findings

The old CauseText spelling is now ParentText. The TypeID prerequisite and
generator owner are resolved by main and the lead's instruction.

The sketch's `Wait.id: Schema.String` needs to accept numeric request ids too.
[JSON-RPC 2.0](https://www.jsonrpc.org/specification#request_object) allows them
and requires preserving the id. Both immediate and parked id `0` have laws.
This corrects the sketch while keeping the protocol.

P10's node:sqlite record tests use P37's existing 64 KiB test cap, above the
empty file's table/index overhead. A smaller cap can roll an empty part forever;
it would test the setup instead of the door. This is a test setting, not a new
product storage limit.

## Reproduce

From the repo root, with no paid API key:

```sh
env -u TYPESAFE_API_KEY nice -n 19 pnpm exec vitest run \
  --config fixtures/next/p10/vitest.config.ts --maxWorkers=1 \
  next/packages/libfabrika/src/transport/{hello,answer,waiting,sshsig-webauthn}.test.ts \
  next/packages/libfabrika/src/coordination/{text,session-manager,passkey,process-id}.test.ts \
  next/apps/fabrika/src/door.test.ts
```

The captured spike is already proved in
[experiment 230](../../../experiments/230-passkey-sshsig.md). Its WebCrypto
checker and OpenSSH both passed; all 29 spike controls matched expectations.
The test suite needs the saved public bytes, never the capture's private key
or a browser gesture.

## What this cannot tell us

There is no P10 implementation yet. Missing-API reds do not demonstrate that
the finished wiring, storage caps, authorization or leak guards are correct.
The builder must make every case green without changing the exam. The mutation
step and independent review still follow. P12 still owns workerd, real
WebSocket, Host-upgrade and inter-object behavior. No performance or physical
authenticator claim comes from this test-writing step.
