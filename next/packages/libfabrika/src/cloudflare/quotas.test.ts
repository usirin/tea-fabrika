// P34c Q14 and the strict Worker handoff, next/. RPC encodings use product schemas.
import { describe, expect, it } from "@effect/vitest";
import { ByteSize, Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import { expectTypeOf } from "vitest";
import { Appended } from "../ledger/Log.ts";
import { MailRefusal } from "../processes/ProgramMail.ts";
import type { QuotasError, RecoveryReserveExhausted } from "../processes/Quotas.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";
import * as Sources from "../settings/Sources.ts";
import { CommitReply, MailReplies } from "./bindings.ts";
import * as QuotaSettings from "./QuotaSettings.ts";

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));

const Tape = Schema.Array(Schema.Struct({ pick: Nat, bytes: Nat })).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(12),
);

const empty = { value: {}, spans: [] };

const defaults = Effect.fnUntraced(function* () {
  const resolved = yield* Sources.resolve(Declarations.all, {
    flags: Sources.flags({}),
    env: Sources.env({}),
    repo: Sources.file("repo.toml", empty),
    person: Sources.file("person.toml", empty),
  });
  return yield* Snapshot.make(Declarations.all, resolved);
});

describe("P34c typed quota boundaries", () => {
  it.prop(
    "Q14 append, mail and commit preserve the closed quota refusal",
    { word: Schema.String },
    ({ word }) => {
      const refused = Appended.cases.refused.make({ reason: "quota" });
      expectTypeOf<typeof refused.reason>().toEqualTypeOf<typeof Appended.cases.refused.Type.reason>();
      expectTypeOf<QuotasError["reason"]["_tag"]>().toEqualTypeOf<
        "Exceeded" | "RecoveryReserveExhausted" | "Storage" | "BadRow"
      >();
      expectTypeOf<RecoveryReserveExhausted["resource"]>().toEqualTypeOf<"writes" | "storage">();
      expectTypeOf<RecoveryReserveExhausted["location"]>().toEqualTypeOf<"project" | "process">();
      const codec = Schema.fromJsonString(Appended);
      expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(refused))).toEqual(refused);
      const commit = CommitReply.cases.ok.make({ value: refused });
      expect(Schema.decodeSync(Schema.fromJsonString(CommitReply))(JSON.stringify(commit))).toEqual(commit);
      const mail = MailReplies.cases.refused.make({ reason: "quota" });
      expect(Schema.decodeSync(Schema.fromJsonString(MailReplies))(JSON.stringify(mail))).toEqual(mail);

      if (
        !["bad_line", "bad_parent", "bad_trace", "seen_ahead", "id_reused", "too_big", "forbidden", "quota"].includes(
          word,
        )
      ) {
        expect(Schema.decodeUnknownResult(Appended)({ ...refused, reason: word })._tag).toBe("Failure");
      }

      expect(Schema.is(MailRefusal)("quota")).toBe(true);
    },
    { arbitrary: { seed: 119120, runs: 100 } },
  );

  it.effect.prop(
    "Q11 Worker accepts only the checked complete snapshot and never supplies a quota fallback",
    { tape: Tape },
    ({ tape }) =>
      Effect.gen(function* () {
        const saved = yield* defaults();
        const good = yield* QuotaSettings.read(saved);
        expect(good.writes).toBe(13_760);
        expect(ByteSize.toNumberUnsafe(good.storage)).toBe(1_000_000_000);

        for (const cell of tape) {
          const paths = ["limits.writes", "limits.storage", "limits.recovery"];
          const path = paths[cell.pick % paths.length]!;
          const missing = { ...saved, values: { ...saved.values } };
          delete missing.values[path];
          expect(yield* Effect.result(QuotaSettings.read(missing))).toMatchObject({ _tag: "Failure" });
          const corrupted = { ...saved, values: { ...saved.values, [path]: cell.bytes } };
          expect(yield* Effect.result(QuotaSettings.read(corrupted))).toMatchObject({ _tag: "Failure" });
          expect(yield* Effect.result(QuotaSettings.read(undefined))).toMatchObject({ _tag: "Failure" });
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
