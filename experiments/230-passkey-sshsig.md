# Passkey SSHSIG: browser startup blocked the first assertion

`next/`, Tier 1 P10, ticket 248. Run on 2026-11-07. **`stuck:passkey_sshsig`.**
Chromium exited before opening a page. No WebAuthn assertion was made. Neither
the proposed WebCrypto checker nor `ssh-keygen -Y verify` ran. This is a startup
failure, not evidence of a protocol mismatch.

```ts
// The complete failing operation. No credential exists yet.
const browser = await chromium.launch({headless: true});
```

## What ran

Base commit `d618bfd3`, after ticket 246's parent and traceId changes. Playwright
1.64.1, Node 26.13.0, macOS arm64. Playwright selected its installed
`chromium_headless_shell-1248`. The process was headless, used Playwright's fresh
temporary profile, and made no request to a site. No private key file was read.

The smallest case is [the script](./230-passkey-sshsig.ts). Command from the repo
root, with the paid API key unset:

```sh
env -u TYPESAFE_API_KEY nice -n 19 node experiments/230-passkey-sshsig.ts
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
execution environment. The output does not establish which restriction caused
the crash. No attempt was made to bypass those restrictions.

## The answer so far

| Check | Observed answer |
|---|---|
| Real browser assertion using CDP WebAuthn | Not reached. Chromium exited during launch. |
| WebCrypto policy and signature verification | Not run. No assertion bytes exist. |
| Independent `ssh-keygen -Y verify -n fabrika-client` | Not run. No SSHSIG exists. Local `ssh -V` reports OpenSSH_9.4p1, LibreSSL 3.3.6; support was not tested. |
| Changed text, namespace, RP id, origin, challenge, UV, flags, signature | Not run. |
| Backup flags and zero counter | Not run. |

There is no public fixture to preserve. Inventing one would not answer the
plan's first question. No P10 product tests or product code were written.
This stop follows the approved plan's first-step exit. The browser needs to run
before the rest of the test-writer step can begin.

The intended byte format remains [OpenSSH's SSHSIG format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig)
and [its WebAuthn SK signature format](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.u2f).
Neither was exercised here. No change to either format is proposed.

## Cost and limits

No model or paid service was called by the script. Script cost was $0. The
authoring session's token counts and list-price dollars were not available.
No real account, hardware authenticator, external server or persistent profile
was used.

This run cannot tell us whether a real assertion passes either checker. It
cannot tell us whether the local OpenSSH needs an option or a newer supporting
version. It also cannot tell us whether any P10 law holds. It preserves only a
browser startup failure that must be cleared before those questions are tested.
