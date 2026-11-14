---
date: "2026-11-07"
summary: "`next/`, P10. Yes: real Chromium 156.0.8078.4 assertion passes WebCrypto and OpenSSH_9.4p1, including BE/BS and counter zero. All 29 changed-byte and policy-control cases match expectations. OpenSSH runs inside the sandbox; browser capture needed the lead outside it. UV and backup policy require our own checks. The process-id prerequisite is resolved on main; P10 owns its generator's laws. No model called by the scripts, $0."
---

# Passkey SSHSIG: capture outside the sandbox

`next/`, Tier 1 P10, ticket 248. Started on 2026-11-07. **The real Chromium
assertion passes both WebCrypto and OpenSSH.** All 29 positive, changed-byte
and policy-control cases matched their expected answers. The passkey SSHSIG
path works for this captured browser and virtual authenticator.

```ts
// The split. Only the browser capture runs outside the sandbox.
// 230-passkey-sshsig.ts -> signed-data hex -> 230-capture.ts -> public assertion JSON
// 230-check.ts reads that JSON and checks the packed SSHSIG with both verifiers.
```

## What broke first

Base commit `d618bfd3`, after ticket 246's parent and traceId changes. Playwright
1.64.1, Node 26.13.0, macOS arm64. Playwright selected its installed
`chromium_headless_shell-1248`. The process was headless, used Playwright's fresh
temporary profile, and made no request to a site. No private key file was read.

The smallest case is [the startup script](./230-browser-startup.ts). Command from the repo
root, with the paid API key unset:

```sh
env -u TYPESAFE_API_KEY nice -n 19 node experiments/230-browser-startup.ts
```

The initial check ran the same three operations through Node's `--input-type=module`.
It exited 1. Running the saved script also exited 1 with the same diagnostics.
Relevant browser diagnostics, with machine paths omitted:

```text
browserType.launch: Target page, context or browser has been closed
ThermalStateObserverMac unable to register to power notifications. Result: 9
exception while trying to kill process: Error: kill EPERM
process did exit: exitCode=null, signal=SIGTRAP
```

The shell also reported `nice: setpriority: Operation not permitted`. It still
started Node and Chromium. The browser failure happened inside this restricted
execution environment. Its cause was initially unknown. The lead then ran the
same seven-line script outside the sandbox and reported Chromium 156.0.8078.4
starting successfully. That comparison identifies Codex's macOS seatbelt
restriction as the browser startup blocker. The first attempt ended at
`stuck:passkey_sshsig`; it did not test the signature protocol.

The startup script was first committed as `230-passkey-sshsig.ts` in `d2076b47`.
It is kept separately now so the original failure remains reproducible. No
attempt was made to bypass the sandbox. The lead supplies the browser run.

## The capture handoff

[The challenge writer](./230-passkey-sshsig.ts) hashes this fixed UTF-8 message
with SHA-512. The final newline is part of the message:

```text
P10 passkey SSHSIG spike
```

It encodes `SSHSIG`, the namespace `fabrika-client`, an empty reserved field,
`sha512`, and the 64-byte message hash, using SSH's length-prefixed fields. The
result is the entire WebAuthn challenge, not just the message hash. Measured
output, 106 bytes:

```text
5353485349470000000e66616272696b612d636c69656e740000000000000006736861353132000000402ce747626374ac70a08ffcb2d32bc21ded319399be9e66a251470f6adf6cbd6dc336b9a9ae03e5e059ef24d9bded40af4310da1e7556e0cc413d23de07533a06
```

An independent Python encoding using `struct.pack` and `hashlib.sha512` produced
the same bytes. Both new TypeScript scripts passed Node's syntax check. The
lead ran the capture outside the sandbox. Its UP, UV, BE and BS checks passed,
as did its zero-counter check. The packing mode and both verifiers then ran
inside the sandbox.

The lead ran this exact command from the repo root, outside the sandbox:

```sh
env -u TYPESAFE_API_KEY nice -n 19 node experiments/230-capture.ts "$(node experiments/230-passkey-sshsig.ts)"
```

[The capture script](./230-capture.ts) serves `https://fabrika.test/` through
`page.route`. Other page requests are aborted, and service workers are blocked.
It creates one ES256 resident credential in a CDP CTAP2 virtual authenticator
with internal transport and user verification enabled. It requests and checks
user verification for its one assertion. It requests backup eligibility and
backup state, and sets the credential's counter to zero through CDP. The script
requires UP, UV, BE and BS in the returned flags and a zero returned counter.
The captured assertion has flags `0x1d`, UP, UV, BE and BS, and counter zero. If
that check fails in a future capture, the public bytes are still saved for inspection.

The output is `experiments/results/230-assertion.json`. The script refuses to
overwrite an existing capture. Every saved byte string is base64url, including
UTF-8 RP id, origin and browser version. `publicKey` is the 65-byte uncompressed
P-256 point; `publicKeySpki` is its SPKI encoding. `flags` is one byte. The file
also keeps the credential id, challenge, exact assertion `authenticatorData`,
original `clientDataJSON` and DER signature. Its `enrollment` object keeps the
public registration data and attestation object. No private key is requested
from CDP, printed or saved. The temporary browser closes in `finally`.

The writer's `--pack` mode reads that file and builds SSHSIG armor. It uses the
SK public-key type with the RP application, converts DER integers to SSH
mpints, and packs the original client data, flags, counter, origin and
extensions in OpenSSH's WebAuthn signature. The independent checker reads that
armor back, reconstructs the authenticator bytes and compares them with the
original capture. It converts the two SSH integers to WebCrypto's 64-byte
P1363 signature, then verifies P-256 over the original client-data hash.

## The two checkers and the changed bytes

Run from the repo root, inside the sandbox:

```sh
env -u TYPESAFE_API_KEY nice -n 19 node experiments/230-check.ts
```

This completed with exit 0. The real fixture passed WebCrypto and OpenSSH.
[The public assertion](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/230-assertion.json) keeps the exact browser
bytes. [The results](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/230-checks.json) keep its SHA-256, every tested
SSHSIG, the public signer line, both answers and the independent CLI output.
The script makes no browser or network call. It deletes its temporary CLI
files after the checks.

The independent command, with paths supplied by the script's temporary folder:

```sh
ssh-keygen -Y verify -n fabrika-client -I spike -f allowed_signers -s assertion.sig < message
```

`message` is the exact fixed text above. `allowed_signers` contains the principal
`spike`, the SK public-key type and the base64 public-key blob, with no extra
options. Local OpenSSH_9.4p1, LibreSSL 3.3.6 accepted it with exit 0. No newer
OpenSSH, verification option or execution outside the sandbox was needed.

| Case group | Observed result |
|---|---|
| Real assertion, BE and BS set, counter zero | WebCrypto signature and policy pass; OpenSSH passes. |
| Changed expected text or namespace | Binding check and OpenSSH refuse. The unchanged assertion's raw P-256 signature remains valid. |
| Wrong configured RP or origin | Our policy refuses. OpenSSH still accepts the original signed bytes, since the application's settings are not its input. |
| Changed challenge, type, client origin, crossOrigin, UV, UP, BE, BS, reserved flag, counter, RP application or signature | Our policy refuses; raw WebCrypto verification and OpenSSH also fail. |
| Changed unsigned wrapper origin | Our policy and OpenSSH refuse its mismatch with the signed client data; the raw P-256 signature remains valid. |
| Client data reformatted, inconsistent extension flag or bytes, truncated or trailing blob | Both checks refuse. Reformatting the JSON breaks the signature even when its decoded fields match. |
| Synthetic, correctly signed BE/BS combinations 00, 10 and 11, all counter zero | Our policy, WebCrypto and OpenSSH pass all three. |
| Synthetic, correctly signed BS without BE or UP without UV | Our policy refuses each for its own reason; raw WebCrypto and OpenSSH pass. |

The five synthetic controls use a separate throwaway P-256 key made in memory.
They are not claimed as browser assertions. No private bytes leave memory or
enter the saved results. They isolate policy from signature failure: invalid
backup state and missing UV are refused even with a valid signature. The real
browser fixture remains the independent positive case.

OpenSSH proves the byte format, not the application's entire policy. In this
run it accepted the synthetic missing-UV and invalid-backup signatures. The
product checker must enforce those rules itself. No protocol change is needed.

## The answer so far

| Check | Observed answer |
|---|---|
| Real browser assertion using CDP WebAuthn | Captured outside the sandbox in Chromium 156.0.8078.4; public bytes saved. |
| WebCrypto policy and signature verification | Pass on the real fixture. |
| Independent `ssh-keygen -Y verify -n fabrika-client` | Pass inside the sandbox on OpenSSH_9.4p1; no extra option. |
| Changed text, namespace, RP id, origin, challenge, UV, flags, signature | Expected refusals, with binding failures distinguished from raw signature failures. |
| Backup flags and zero counter | Real BE/BS 11 and zero pass. Synthetic 00 and 10 pass; invalid 01 is refused by our policy with a valid signature. |

The spike's byte gate is passed. No P10 product code was written.

The intended byte format remains [OpenSSH's SSHSIG format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig)
and [its WebAuthn SK signature format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.u2f).
Both checkers accepted the completed signature in these formats. No change to
either format is proposed.

## A prerequisite found before the laws

Ticket 246 renamed the field to `parent` and added `traceId`, but its
`ParentText` schema still accepts only the old eight-hex input ids. The approved
P10 plan explicitly requires process-based ids before the P10 tests and leaves
that follow-up with the lead, outside P10's product changes. A direct decode of
`in-process_01m6v5270hetdrt4r8h9vvjwjr-1` returned failure on this base. The
shared process-id helper's contract must also be supplied by the two row leads,
as the plan requires. The lead has been asked for both prerequisites.

Resolved in [PR 490](https://github.com/usirin/tea-fabrika/pull/490), now merged
into this branch from main at `bde48daa`, merge commit `06d4fecb`. `ProcessId`
lives in `data/trace.ts`, and `ParentText` accepts process-based input ids. The
lead assigned P10 the UUIDv7 TypeID generator at
`next/packages/libfabrika/src/coordination/process-id.ts`; P33 will reuse it.
The generator's shape, monotonicity and fresh door-start laws are in the P10
test change. The test writer did not add its implementation.

## Cost and limits

No model or paid service was called by the script. Script cost was $0. The
authoring session's token counts and list-price dollars were not available.
No real account, hardware authenticator, external server or persistent profile
was used by the startup runs. The capture uses a fresh temporary browser and a
virtual authenticator too.

This proves one Chromium version and a virtual authenticator. It does not prove
Safari, Firefox, a physical security key or a synced passkey provider. It tests
extension consistency, not every possible valid CBOR extension. It does not
measure workerd, phone approval UX or every P10 law. Ordinary CI will use the
recorded public fixture; it will not need a browser gesture or a private key.
