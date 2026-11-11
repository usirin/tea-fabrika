import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";

const identifier = "cloudflare-runtime/plugin/FabrikaControl";

/** The local runtime's control socket, as Alchemy's plugin contract names it. */
export class ControlPlugin extends Plugin.Service<ControlPlugin>()(identifier) {}
