/**
 * Entry point for building one record part over a SQL handle, re-exported from `Records.ts` so a
 * runner can open a part without the rest of that module.
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
