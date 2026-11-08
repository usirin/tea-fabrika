# Passkey SSHSIG: capture outside the sandbox

`next/`, Tier 1 P10, ticket 248. Started on 2026-11-07. The browser capture now
waits for the lead to run it outside Codex's sandbox. Neither WebCrypto nor
`ssh-keygen -Y verify` has checked an assertion yet. The challenge writer is ready
and prints 106 bytes as hex.

```ts
// The split. Only the browser capture runs outside the sandbox.
// 230-passkey-sshsig.ts -> signed-data hex -> 230-capture.ts -> public assertion JSON
// The two independent checkers will read that JSON after the capture returns.
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
browser capture and the SSHSIG packing mode have not run yet.

The lead runs this exact command from the repo root, outside the sandbox:

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
These are capture settings, not observed assertion results yet. If that check
fails, the public bytes are still saved for inspection.

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
extensions in OpenSSH's WebAuthn signature. Packing is not a verification
result. WebCrypto and OpenSSH checks remain the next work after the lead's
capture. No P10 product tests may start before they pass.

## The answer so far

| Check | Observed answer |
|---|---|
| Real browser assertion using CDP WebAuthn | Initial sandbox launch failed. The lead's startup check passed outside it; assertion capture pending. |
| WebCrypto policy and signature verification | Not run. No assertion bytes exist. |
| Independent `ssh-keygen -Y verify -n fabrika-client` | Not run. No SSHSIG exists. Local `ssh -V` reports OpenSSH_9.4p1, LibreSSL 3.3.6; support was not tested. |
| Changed text, namespace, RP id, origin, challenge, UV, flags, signature | Not run. |
| Backup flags and zero counter | Not run. |

There is no public assertion fixture yet. No P10 product tests or product code
were written. The lead's browser capture is the next required input.

The intended byte format remains [OpenSSH's SSHSIG format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig)
and [its WebAuthn SK signature format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.u2f).
The challenge writer follows the SSHSIG format. Its completed signature has
not been checked yet. No change to either format is proposed.

## Cost and limits

No model or paid service was called by the script. Script cost was $0. The
authoring session's token counts and list-price dollars were not available.
No real account, hardware authenticator, external server or persistent profile
was used by the startup runs. The capture uses a fresh temporary browser and a
virtual authenticator too.

This run cannot tell us whether a real assertion passes either checker. It
cannot tell us whether the local OpenSSH needs an option or a newer supporting
version. It also cannot tell us whether any P10 law holds. It preserves only a
browser startup failure identified as the sandbox restriction. Assertion
compatibility remains an open measurement.
