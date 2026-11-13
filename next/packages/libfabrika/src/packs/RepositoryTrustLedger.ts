/**
 * `RepositoryTrust` on the ledger: one stream per person and clone.
 *
 * @stability unstable
 */
import { Effect, Layer, Option, Redacted, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { Ledger } from "../ledger/Ledger.ts";
import { lineFor, valueFor } from "../ledger/Log.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";
import {
  Event,
  InvalidHistory,
  RepositoryTrust,
  RepositoryTrustError,
  Storage,
  type Recorded,
} from "./RepositoryTrust.ts";

// A bounded read fails closed instead of trusting a truncated history. Never discard old decisions.
const LIMIT = 4096;
const stream = (key: string, person: string) => `repository/${person}/${key}`;
const storage = (cause: unknown) => new RepositoryTrustError({ reason: new Storage({ cause: Redacted.make(cause) }) });

const invalid = (cause: unknown) =>
  new RepositoryTrustError({ reason: new InvalidHistory({ cause: Redacted.make(cause) }) });

/**
 * Layer that provides `RepositoryTrust` on the ledger, in the stream `repository/<person>/<key>`.
 * It asks for `Ledger` and `Digest`.
 *
 * **Details**
 *
 * `history` checks every entry: the event decodes with no extra key, belongs to this key and
 * person, keeps one repository id, and each `decision` and `opened` follows a `selected` with the
 * same commit, hash and trace. Saved settings are read again against the declared settings.
 * `write` appends under an id made from the event's `request`, so a retry of the same event is
 * one entry.
 *
 * **Gotchas**
 *
 * `history` reads at most 4096 entries. Past that it fails as `InvalidHistory`: it never answers a
 * cut-off history, and old decisions are never dropped to make room.
 *
 * @stability unstable
 * @category layers
 */
export const layer = Layer.effect(
  RepositoryTrust,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const digest = yield* Digest.Digest;
    const checkSettings = (saved: Snapshot.Snapshot) =>
      Snapshot.read(Declarations.all, saved).pipe(
        Effect.provideService(Digest.Digest, digest),
        Effect.mapError(invalid),
      );
    return RepositoryTrust.of({
      history: Effect.fn("repositoryTrust.history")(function* (key: string, person: string) {
        const rows = yield* ledger
          .read(stream(key, person), 0)
          .pipe(Stream.take(LIMIT + 1), Stream.runCollect, Effect.mapError(storage));

        if (rows.length > LIMIT) {
          return yield* invalid("history limit exceeded");
        }

        const events: Array<Event> = [];
        const selections = new Map<string, typeof Event.cases.selected.Type>();
        const traces = new Map<string, string>();
        let repository: (typeof Event.Type)["repository"] | undefined;

        for (const row of rows) {
          const event = yield* Schema.decodeUnknownEffect(Event)(valueFor(row), { onExcessProperty: "error" }).pipe(
            Effect.mapError(invalid),
          );

          if (event.key !== key || row.for !== person) {
            return yield* invalid("identity mismatch");
          }

          if (repository !== undefined && repository !== event.repository) {
            return yield* invalid("repository identity changed");
          }

          repository = event.repository;

          if (event._tag === "selected") {
            if (row.parent !== null || row.id !== event.request) {
              return yield* invalid("invalid selection");
            }

            yield* checkSettings(event.settings);
            selections.set(event.request, event);
            traces.set(event.request, row.traceId);
          } else {
            const selected = selections.get(event.selection);

            if (
              selected === undefined ||
              row.parent !== event.selection ||
              row.traceId !== traces.get(event.selection) ||
              selected.repository !== event.repository ||
              selected.commit !== event.commit ||
              selected.hash !== event.hash
            ) {
              return yield* invalid("invalid parent");
            }

            if (event._tag === "decision" && event.actor !== person) {
              return yield* invalid("invalid actor");
            }

            if (event._tag === "opened") {
              yield* checkSettings(event.settings);
            }
          }

          events.push(event);
        }

        return events;
      }),
      write: Effect.fn("repositoryTrust.write")(function* (event: Event, recorded: Recorded) {
        const encoded = yield* Schema.encodeEffect(Event)(event).pipe(Effect.mapError(invalid));
        const id = event._tag === "selected" ? event.request : `repository/${event._tag}/${event.request}`;
        let from = recorded;

        if (event._tag === "selected") {
          if (recorded.parent !== null) {
            return yield* invalid("selection must be an own write");
          }
        } else {
          const stored = yield* ledger.read(stream(event.key, recorded.for), 0).pipe(
            Stream.take(LIMIT + 1),
            Stream.filter((row) => row.id === event.selection),
            Stream.runHead,
            Effect.mapError(storage),
          );

          if (Option.isNone(stored)) {
            return yield* invalid("selection is not stored");
          }

          const parent = stored.value;
          const selected = yield* Schema.decodeUnknownEffect(Event.cases.selected)(valueFor(parent), {
            onExcessProperty: "error",
          }).pipe(Effect.mapError(invalid));

          if (
            parent.parent !== null ||
            parent.for !== recorded.for ||
            selected.repository !== event.repository ||
            selected.key !== event.key ||
            selected.commit !== event.commit ||
            selected.hash !== event.hash ||
            (event._tag === "decision" && event.actor !== recorded.for)
          ) {
            return yield* invalid("selection does not match");
          }

          from = { ...recorded, parent: parent.id, traceId: parent.traceId };
        }

        const answer = yield* ledger
          .append(stream(event.key, recorded.for), id, lineFor(from, encoded))
          .pipe(Effect.mapError(storage));

        if (answer._tag === "refused") {
          return yield* storage(answer.reason);
        }

        return { rev: answer.rev, pos: answer.pos };
      }),
    });
  }),
);
