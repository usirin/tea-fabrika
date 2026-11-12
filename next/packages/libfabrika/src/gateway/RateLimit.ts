/**
 * Schemas for a sender's gateway budget and its decision.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";
import { gatewayLimit, gatewayWindow } from "../settings/Declarations.ts";

/**
 * Schema for the instance operator's fixed-window budget, read at trusted startup.
 *
 * @stability unstable
 * @category models
 */
export const Policy = Schema.Struct({ limit: gatewayLimit.schema, window: gatewayWindow.schema });
/**
 * The instance operator's resolved gateway budget.
 *
 * @stability unstable
 * @category models
 */
export type Policy = typeof Policy.Type;

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/**
 * Schema for one attempt's result. Refusals do not consume more saved budget.
 *
 * @stability unstable
 * @category models
 */
export const Decision = Schema.TaggedUnion({
  allowed: { count: Positive, ttl: Positive },
  refused: { retryAfter: Positive },
  invalid: { cause: Schema.Defect() },
});
