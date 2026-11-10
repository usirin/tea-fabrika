// Saved state, next/: a model saved with its shape's number, the build that saved it and the inbox
// rev it has folded up to (Tier 1, P11; saved-state S3). An old number climbs through named
// upgrades, one number each, and decodes only at the end. A failure keeps the old bytes.
import { Result, Schema } from "effect";
import { Rev } from "../coordination/index.ts";
import { ProgramDown, type State } from "./program.ts";

const Row = Schema.Struct({
  v: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  build: Schema.NonEmptyString,
  model: Schema.Json,
  /** The last inbox rev this model has folded. */
  after: Rev,
});

const decodeRow = Schema.decodeUnknownResult(Row);
const decodeJson = Schema.decodeUnknownResult(Schema.Json);

const down = (): ProgramDown => new ProgramDown({ why: "saved_state" });

export class Saved extends Schema.Opaque<Saved>()(Row) {
  /**
   * Climbs `raw` to `state.v` through `state.upgrades`, in order, then decodes it with the state's
   * schema. Answers the new saved value, stamped with `build`, and the upgrades that ran. A gap, a
   * repeated `from`, a future version, a throw or a bad final model throws ProgramDown
   * `saved_state`; each upgrade works on a copy, so `raw` is never changed.
   */
  static upgrade(
    raw: unknown,
    state: State,
    build: string,
  ): { readonly saved: Saved; readonly ran: ReadonlyArray<string> } {
    const row = decodeRow(raw);

    if (Result.isFailure(row) || row.success.v > state.v) {
      throw down();
    }

    const froms = state.upgrades.map((u) => u.from);

    if (new Set(froms).size !== froms.length) {
      throw down();
    }

    let model: unknown = structuredClone(row.success.model);
    const ran: Array<string> = [];

    for (let v = row.success.v; v < state.v; v++) {
      const upgrade = state.upgrades.find((u) => u.from === v);

      if (upgrade === undefined) {
        throw down();
      }

      const input = structuredClone(model);
      const next = Result.try({ try: () => upgrade.run(input), catch: down });

      if (Result.isFailure(next)) {
        throw next.failure;
      }

      model = next.success;
      ran.push(upgrade.name);
    }

    const decoded = Schema.decodeUnknownResult(state.schema)(model);

    if (Result.isFailure(decoded)) {
      throw down();
    }

    const encoded = Schema.encodeUnknownResult(state.schema)(decoded.success);
    const json = Result.isSuccess(encoded) ? decodeJson(encoded.success) : Result.fail(null);

    if (Result.isFailure(json)) {
      throw down();
    }

    return {
      saved: Saved.make({ v: state.v, build, model: json.success, after: row.success.after }),
      ran,
    };
  }
}
