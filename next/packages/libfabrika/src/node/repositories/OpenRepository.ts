import { DateTime, Effect, Redacted, Schema } from "effect";
import * as Id from "../../Id.ts";
import * as Log from "../../ledger/Log.ts";
import * as Open from "../../packs/Open.ts";
import { Event, RepositoryId, RepositoryTrust, TrustDecision } from "../../packs/RepositoryTrust.ts";
import { Repositories } from "../../repositories/Repositories.ts";
import * as Load from "../settings/Load.ts";

class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}
class InvalidDocument extends Schema.TaggedError<InvalidDocument>()("InvalidDocument", { cause: Schema.Defect() }) {}
class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", { cause: Schema.Defect() }) {}

class OpenRepositoryError extends Schema.TaggedError<OpenRepositoryError>()("OpenRepositoryError", {
  reason: Schema.Union([Storage, InvalidDocument, ReadFailed]),
  message: Schema.String,
}) {}

const failed = (reason: "storage" | "document" | "read", cause: unknown) =>
  new OpenRepositoryError({
    reason: new (reason === "storage" ? Storage : reason === "document" ? InvalidDocument : ReadFailed)({
      cause: Redacted.make(cause),
    }),
    message:
      reason === "document"
        ? "Selected repository: settings document is invalid."
        : reason === "read"
          ? "Selected repository: read failed."
          : "Selected repository: trust could not be saved.",
  });

/** Validate before starting the shipped instance. No source resolution or code loading happens here. */
export const prepare = Effect.fn("repositoryOpen.prepare")(function* (
  location: string,
  options: Omit<Parameters<typeof Load.load>[0], "repo">,
) {
  const repository = yield* (yield* Repositories)
    .open(location)
    .pipe(Effect.mapError((cause) => failed("read", cause)));
  const loaded = yield* Load.load({
    ...options,
    repo: { name: repository.snapshot.file, text: repository.snapshot.text },
  }).pipe(Effect.mapError((cause) => failed("document", cause)));
  const { text, ...snapshot } = repository.snapshot;
  return { snapshot: { ...snapshot, present: text !== null }, settings: loaded.snapshot, values: loaded.values };
});

/** Local identity is supplied by the instance, never the document or terminal answer. */
export const open = Effect.fn("repositoryOpen.open")(function* <R>(
  prepared: Effect.Success<ReturnType<typeof prepare>>,
  options: {
    readonly selection: Id.InputId;
    readonly request: Id.InputId;
    readonly actor: typeof Id.Person.Type;
    readonly by: string;
    readonly build: string;
    readonly interactive: boolean;
    readonly confirm: (selection: Open.CheckedSelection) => Effect.Effect<boolean, unknown, R>;
  },
) {
  const trust = yield* RepositoryTrust;
  const session = yield* Open.session();
  const selection = options.selection;
  yield* session.send({ type: "select", selection });
  const history = yield* trust
    .history(prepared.snapshot.key, options.actor)
    .pipe(Effect.mapError((cause) => failed("storage", cause)));
  const first = history.find((event) => event._tag === "selected");
  const repository =
    first?.repository ??
    (yield* Id.Generator.use((ids) => ids.next(RepositoryId)).pipe(
      Effect.provide(Id.Generator.layer),
      Effect.mapError((cause) => failed("storage", cause)),
    ));
  const snapshot: Open.CheckedSelection = {
    ...prepared.snapshot,
    repository,
    label: `Repository ${prepared.snapshot.key.slice(0, 12)}`,
    settings: prepared.settings,
    person: options.actor,
  };
  const selected = Event.cases.selected.make({ ...snapshot, request: selection });
  const from = yield* Log.fromHere({ by: options.by, for: options.actor, seen: 0, parent: null, build: options.build });
  // A retry keeps the same append id; the ledger retains the first placing's writer clock and trace.
  const placed = yield* trust.write(selected, from).pipe(Effect.mapError((cause) => failed("storage", cause)));
  const answerFrom = { ...from, seen: placed.rev, parent: selection, sentAt: DateTime.formatIso(yield* DateTime.now) };
  yield* session.send({ type: "checked", selection, snapshot });
  let state = yield* session.send({ type: "history", selection, events: history });

  if (state._tag === "awaiting_trust") {
    if (!options.interactive) {
      return state;
    }

    const accepted = yield* options.confirm(snapshot).pipe(Effect.mapError((cause) => failed("storage", cause)));
    const decision = accepted ? TrustDecision.cases.accepted.make({}) : TrustDecision.cases.denied.make({});
    yield* trust
      .write(
        Event.cases.decision.make({
          repository,
          key: snapshot.key,
          selection,
          request: options.request,
          commit: snapshot.commit,
          hash: snapshot.hash,
          decision,
          actor: options.actor,
          method: "terminal",
        }),
        answerFrom,
      )
      .pipe(Effect.mapError((cause) => failed("storage", cause)));
    state = yield* session.send({ type: "answer", selection, request: options.request, decision });
  }

  if (state._tag !== "saving" && !(state._tag === "refused" && state.reason === "denied")) {
    return state;
  }

  const accepted = state._tag === "saving" && state.decision._tag === "accepted";

  const receipt = yield* trust
    .write(
      Event.cases.opened.make({
        repository,
        key: snapshot.key,
        selection,
        request: selection,
        commit: snapshot.commit,
        hash: snapshot.hash,
        settings: snapshot.settings,
        result: accepted ? "ready" : "refused",
        ...(accepted ? {} : { reason: "denied" as const }),
      }),
      answerFrom,
    )
    .pipe(Effect.mapError((cause) => failed("storage", cause)));
  return state._tag === "saving"
    ? yield* session.send({ type: "saved", selection, request: state.request, receipt })
    : state;
});
