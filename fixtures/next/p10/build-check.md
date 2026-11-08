# P10 tests on the build

`next/`, test-writer correction on product commit `78d49cab`.
No product file changed.

## Corrections

| Test location | Test mistake fixed | Law and plant retained |
|---|---|---|
| [answer.test.ts:133](../../../next/packages/libfabrika/src/transport/answer.test.ts#L133) | The route mock now declares method, params and checked-writer arguments. | Additive fields cannot change the reply id or writer. The third call argument is still checked. |
| [text.test.ts:35](../../../next/packages/libfabrika/src/coordination/text.test.ts#L35) | The grant satisfies the real Grant schema type. | The independently written grant bytes, including its rank and saw fields, are unchanged. |
| [hello.test.ts:91](../../../next/packages/libfabrika/src/transport/hello.test.ts#L91) | The checked identity satisfies the real Who schema type. | Claimed capability or platform cannot grant rank. |
| [hello.test.ts:204](../../../next/packages/libfabrika/src/transport/hello.test.ts#L204) | An assertion narrows the result to online before reading hello. | Additive fields, preserved metadata and clamped ping are still checked. |
| [door.test.ts:1934](../../../next/apps/fabrika/src/door.test.ts#L1934) | After advancing the clock, a later authenticated read ends a real span before flush. | Archive output must exist and contain none of the planted content markers. |

The archive test was wrong. A quiet clock advance and flush cannot archive
an unsummarized hour. The merged
[P37 case](../../../next/packages/libfabrika/src/data/health.test.ts#L418)
requires a later span first. That law and product behavior stay unchanged.
The test keeps its positive archive assertion, so its archive-content check
cannot pass by inspecting an empty list.

## Tests run

The final run passed **121/121 cases** with one worker:

- `door.test.ts`: 66.
- `answer.test.ts`: 15.
- `hello.test.ts`: 19.
- `text.test.ts`: 4.
- P37's unchanged `health.test.ts`: 17.

This used the ordinary root Vitest config and the real built product.
The first completed run passed the same 121 cases. The final run followed
the additional local type corrections below.

## One workspace typecheck

The requested single workspace typecheck exited 1 in libfabrika. It used
`GOMAXPROCS=1` and workspace concurrency 1.

Product diagnostics left for the builder:

- [client-manager.ts:181](../../../next/packages/libfabrika/src/coordination/client-manager.ts#L181),
  **TS2345**. The fact passed to `lineFor` has an optional passkey field
  whose type includes `undefined`; that is not JSON.
- [webauthn.ts:23](../../../next/packages/libfabrika/src/transport/webauthn.ts#L23),
  **TS2375**. `passkeyBlob` returns `Option<Uint8Array<ArrayBufferLike>>`
  where `Option<Bytes>` requires an owned `ArrayBuffer`.
- [process-id.ts:35](../../../next/packages/libfabrika/src/coordination/process-id.ts#L35),
  warning **TS377011**. The `Effect.fn` function is immediately invoked.

That run also found two more local success-only attachment reads and an
untyped retry mock in `answer.test.ts`. These were fixed afterward:
[58](../../../next/packages/libfabrika/src/transport/answer.test.ts#L58) and
[126](../../../next/packages/libfabrika/src/transport/answer.test.ts#L126)
now assert the online case;
[69](../../../next/packages/libfabrika/src/transport/answer.test.ts#L69)
uses the explicit Route callback type. The retry still covers both typed
failure and defect, with the same two calls and recovered answer.

The workspace checker stopped before the app package. No second typecheck
was run, as instructed. The final 121-case runtime run passed after those
last type edits. This report does not claim a green app or workspace
typecheck.

## Check setup

The first command attempts stopped before formatting or tests ran. pnpm
started an automatic install, but npm DNS was unavailable in the sandbox.
The retries were interrupted. Existing installed dependencies of the same
versions were reused through local links. No manifest or lockfile changed.

The subsequent commands used
`pnpm_config_verify_deps_before_run=false` and
`--config.verifyDepsBeforeRun=false` to keep pnpm from trying another install.
That is a per-command setting, documented in
[pnpm's build settings](https://pnpm.io/settings/build#verifydepsbeforerun).
It changes no project check or committed configuration.
The sandbox denied `nice`; the one-worker and single-thread caps held.

## Limits

The tests cover the requested local type fixes and the archive setup on this
build. They do not replace the builder's remaining type fixes, the complete
P10 suite, mutation testing or independent review.
