/**
 * The control plugin the local brain's driver hands to Alchemy's local runtime.
 *
 * @stability unstable
 */
import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";

const identifier = "cloudflare-runtime/plugin/FabrikaControl";

/**
 * Service for the local runtime's control socket, under the name Alchemy's plugin contract gives
 * it. The driver provides it with one socket on 127.0.0.1 and a `start` that hears the port the
 * runtime chose.
 *
 * @stability unstable
 * @category services
 */
export class ControlPlugin extends Plugin.Service<ControlPlugin>()(identifier) {}
