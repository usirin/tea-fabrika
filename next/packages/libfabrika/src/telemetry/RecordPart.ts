/**
 * The record part's own entry: it offers only `recordPart` from `Records.ts`, which the Cloudflare
 * record part object in `cloudflare/record.ts` builds each part with. Importing it still loads all
 * of `Records.ts`; only the names offered are fewer.
 *
 * @stability unstable
 */
/**
 * Re-export of `recordPart`, the one name this file offers.
 *
 * @stability unstable
 */
export {
  /**
   * Creates one record part's four calls over its own `Sql`: `write`, `read`, `content` and
   * `deleteContent`. A throw from storage is a `SinkError`.
   *
   * @stability unstable
   * @category constructors
   */
  recordPart,
} from "./Records.ts";
