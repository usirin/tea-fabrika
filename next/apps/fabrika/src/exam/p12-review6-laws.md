# P12 review 6 laws

`next/`, ticket 270, PR <https://github.com/usirin/tea-fabrika/pull/530>.
The base for these laws is `9e73abf7`. Product code stays unchanged. The twin
scanner and lint rules belong to the tests step and are changed here.
All generated laws use seed 119120.

## Runner failures

`workers/supervision.laws.test.ts` uses real `programBox` methods,
`workerExecution`, Node execution, ProgramRunner, ProcessManager, RecoveryStore,
Mailbox and SQLite. Only Cloudflare's base class and platform transport are supplied.

- Rejected RPC and malformed-answer properties both fail on the durable receipt
  before checking the caller's answer. At a delivery limit of one, HEAD writes
  `tries: 1`, a terminal dead result and `Error` or `SchemaError`. The law requires
  zero deliveries, no error, no dead fact, a typed infrastructure failure and a
  cleared attempt. Generated sequences mix both infrastructure failures and real
  program throws, recover real processes between throws and finally retry a good
  letter. Examples name the review's limit-one failures.
- The same generated throw runs through both supervised adapters. Node's receipt
  and dead fact must name the actual thrown class. The Worker records must match.
  HEAD records `ProgramDown` for the pinned TypeError. The generator includes
  Error subclasses, a custom subclass, JSON values, undefined, bigint, symbols
  and functions. A separate generated Node baseline is green for these values.

## Twin sweep

The sweep starts with every path from `git diff origin/main --name-only`.
The only P12 resource declaration is `next/apps/fabrika/alchemy.run.ts`.
The guard and its installed-package readers live in `src/exam/twin.ts`.
The actual stack has zero findings.

The new plants put each form beside that valid stack. They cover both a resource
and `remote`: computed literal and computed expression members, optional members
and calls, bare/renamed/default/computed/rest/assignment destructuring, namespace
and array spread, call/apply/Reflect.apply/Reflect.get/bind, function arguments,
returned references, object properties, conditionals, sequences, tagged templates
and exported references. Module plants cover named/star/namespace re-exports,
local re-exports, named/namespace/default imports passed on, side-effect imports,
external helpers, dynamic import, require and Alchemy subpaths.

The first run exposed 44 missed forms among 59 plants. Four more bare/default
destructuring plants were added afterward. The scanner now rejects every escaped
reference and every module it cannot follow. Direct resource calls still use
the installed provider registrations. No second resource list was introduced.

## Outside-input decoder sweep

The sweep searches every changed TypeScript file for URI, JSON, URL, base64,
Schema, text and byte readers, then reads each product caller. Findings:

- `workers/fetch.ts`: the grant target's `decodeURIComponent` throws a URIError
  defect. Its generated malformed-escape law is red. Malformed POST JSON already
  fails without a defect and without a Project call; that new law is green.
- `next/apps/fabrika/grant.ts`: `new URL` on CLI input also throws a defect.
  `src/grant-readers.laws.test.ts` captures the real command at NodeRuntime and is
  red before HTTP or signing. No key file is read.
- `workers/control.ts`: both bucket keys and the put checksum use `String` on
  arbitrary wire arguments. A JSON object with a non-callable `toString` throws
  a defect. Other malformed values are silently coerced. Three new generated
  reader laws are red and require typed `bad_row` before a bucket call.
- `data/records.ts`: synchronous saved-row decoders cover span columns, sequence,
  content state, kept content, deleted content and roll state. The real part's
  failure wrapper catches them. Six corruption properties are green.
- `data/sink.ts`: saved chain, span row and part decoders sit inside its typed
  wrapper. Three generated corruption properties are green and keep unsent rows.
- `workers/gateway.ts`: URL segments use Effect.try. Attachment, name, tags, wait
  replies and close-time tags use Effect Schema. Existing generated reader laws
  cover these paths. Its URL comes from a constructed Request, which has already
  rejected an invalid URL.
- `workers/runtime.ts`, `workers/record.ts`, `workers/index.ts`: descriptor,
  bootstrap, owner/build, object-name and RPC readers use typed Schema decoders.
  Existing reader, runtime and execution laws cover these calls.
- `app/execution.ts`: synchronous reply encoders/decoders run inside `attempt`.
  Worker replies and step answers use checked schemas. Existing execution and
  reply laws remain the controls.
- `app/runner.ts`: policy decoding is inside Effect.try. The synchronous Cmd
  answer check receives the checked execution reply. Saved inputs use Effect
  decoders. `app/program.ts` checks author declarations and catches stepping
  through its guard; its synchronous author constructor is outside wire input.
- `transport/gateway.ts`: JSON.parse uses Result.try. Malformed frames are ignored
  without a defect. The new secret flows include this case.
- App `src/runtime.ts`, `dev.ts`, `src/build.ts` and library `node/local-stage.ts`
  use typed readers for settings, compiler ledger, pending facts and last start.
  Existing generated settings, file-service and outbox laws cover them.
- `node/stage.ts` uses typed HTTP JSON and port decoders. Checksum hex conversion
  runs on a checked string and cannot throw. `stage-recording.ts` checks archive
  replies through Effect Schema.

There is no product `atob` or fatal TextDecoder in P12. The ordinary TextDecoders
found are test helpers. Synchronous parsers in the exam, test fixtures, browser
driver and experiment 238 were also counted and read. They run outside the
product's Effect input path; this step does not turn those lab/driver scripts
into product services or run a socket benchmark.

## Filesystem sweep

The import sweep found seven native imports in six product files:

- Library `node/stage-recording.ts`: node:fs and node:path.
- Library `node/build.ts`: node:path.
- App `build.ts`, `dev.ts`, `src/local-stage.ts`, `src/stage.ts`: node:path each.

`fabrika/no-node-filesystem` is scoped to next/ product files. Its generated
plants cover native and prefixed module names, static imports, re-exports,
dynamic imports, require, TypeScript import assignments and literal templates.
They also check that tests and exam code remain usable. All seven product
findings are real; there are no false alarms in this sweep.

`node/stage-recording.laws.test.ts` supplies FileSystem and Path, including a
directory-creation refusal. Both cases are red: HEAD bypasses the supplied
service. Tests use their own temporary folders.

## Secret sweep

The new secret is the local control bearer. Public keys, fingerprints, nonces
and signed public grants are not private key bytes. The grant command passes a
key path to ssh-keygen and never reads the private file. Other generated keys,
passes and bodies in the law are made-up input values.

The sweep found three unprotected reads and one plain service parameter:

- `node/stage.ts`: randomBytes creates the plain token, which travels to the
  Authorization send and plugin props.
- `workers/control.ts`: the token parameter is string, and Authorization is
  read as plain text for comparison.
- App `src/brain.ts`: the platform's props token goes straight to control.

`secret-types.ts` checks the actual types from source to the first binding or
statement. It recognizes Effect's Redacted type through its brand, independent
of a wrapper's name. Its generated source plants prove that all three reads
fail plain and pass wrapped. The actual-source law is red at all three reads.
The control-parameter type equality and generated Redacted control call also
hold the service contract; HEAD returns 403 for the latter.

`node/stage-secrets.laws.test.ts` marks the content law `[secrets]`. Generated
flows use the real stage, durable outbox, lifecycle queue, Gateway parsing,
SQLite sinks, record parts and a real ledger for the lifecycle journal. The
platform sends and child RSS source are supplied. Both the HTTP header and the
serialized plugin props must carry the correct bearer at the send. A wrong
Authorization header must still be refused. Flows vary bodies, fake private
material, passes and operation orders, including refusals, RPC rejection,
malformed frames and restart. They inspect spans and deletable content, every
console log method and Effect logs, lifecycle entries, health rows and outbox
snapshots/files. Health includes raw rows, summaries, sizes and archive rows.
Each value is planted into each output in plain, base64,
base64url, URL and JSON-escaped forms, and the same check must fail.

The content flow and all its leak plants are green. This is evidence of the
observed outputs, not a claim that HEAD follows the Redacted type contract.
The untracked plan's content row now has the required marker and flow wording;
that plan and the review reports are never committed.

## Validation

The final command ran 14 narrow files with one Vitest worker: 247 checks passed
and 12 failed for the intended product gaps. The existing runner-supervision,
execution and Worker-reply controls passed. The twin's 83 checks, the filesystem
plants, all nine saved-record reader checks and the generated content flow with
its leak plants passed. The remaining reds are the supervised failures, Worker
class mismatch, five unsafe input conversions, recording service bypass and
Redacted contract.

A later focused run added the Node throw baseline and checked both platform
bearer sends. It had three passes and the same four expected reds in those two
files. Across the 14 files, 248 distinct checks now pass and 12 remain red.

`pnpm lint` ran once. It stopped on exactly seven findings from the new native
filesystem/path rule; there were no other blocking findings. Its later commands
did not run. The real twin command is also exercised by its passing command test.

`pnpm format` ran once. Its formatter completed; its lint step initially found
test-side issues, which were fixed. The changed paths were then formatted again
directly with oxfmt. One root `pnpm typecheck` found fixture type errors and the
intended control-parameter type failure. The fixture errors were fixed. Narrow
TypeScript queries of both next/ projects then found only the intended
`string` versus `Redacted<string>` error. No second root typecheck was run.

## Limits

These are socket-free laws on next/, not a live run of today's pipeline.
No workerd socket, browser, real process kill, benchmark, paid call or key read
is needed. The builder must make the red product laws green without editing
them. Transport adapters cannot prove the behavior of Cloudflare's real RPC.
Usage and dollar totals for this agent are unavailable in the session and must
not be invented.
