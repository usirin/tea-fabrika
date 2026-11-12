// Experiment 275, lab code. Door B's wall: a Worker in the same local runtime as the brain that
// loads each agent script into its own Worker Loader isolate (Dynamic Workers), as experiment 173 did.
// The isolate gets `globalOutbound: null` and one binding, FABRIKA: a Handle stub with props (the
// script's run id and the bridge's callback). Each Handle call goes back to the bridge, which sends
// it through the same door as door A's tools. The time limit and the call cap are the bridge's,
// not this runtime's: local workerd does not enforce `limits.cpuMs` (experiment 173).
import { WorkerEntrypoint } from "cloudflare:workers";

export class Handle extends WorkerEntrypoint {
  async call(input, value) {
    const { run, callback } = this.ctx.props;
    const answer = await fetch(callback, { method: "POST", body: JSON.stringify({ run, input, value }) });
    return await answer.json();
  }
}

// libfabrika's local dev adds a control socket to every Worker in the stack, aimed at an entrypoint
// named Control (next/packages/libfabrika/src/node/dev/dev.ts:183). The brain's answers it; this
// Worker has nothing to control, so its Control answers nothing.
export class Control extends WorkerEntrypoint {
  fetch() {
    return new Response("not the brain", { status: 404 });
  }
}

const hex = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// The script's module: the agent's code is the body of `run`, and `fabrika` is made from the
// names its grant allows. Nothing else is in scope but the platform's own globals.
const moduleOf = (code, names) => `import { WorkerEntrypoint } from "cloudflare:workers";
const NAMES = ${JSON.stringify(names)};
export default class extends WorkerEntrypoint {
  async run() {
    const handle = this.env.FABRIKA;
    const notes = {};
    for (const n of NAMES) {
      notes[n] = async (value) => {
        const a = await handle.call(n, value ?? {});
        if (a.refused !== undefined) throw new Error("refused: " + a.refused);
        if (a.error !== undefined) throw new Error(a.error);
        return a.result;
      };
    }
    const fabrika = { notes };
    const printed = [];
    const console = { log: (...xs) => printed.push(xs.map((x) => JSON.stringify(x)).join(" ")) };
    try {
      const result = await (async () => {
${code}
      })();
      return JSON.stringify({ result: result ?? null, printed });
    } catch (e) {
      return JSON.stringify({ error: String(e), printed });
    }
  }
}
`;

export default {
  async fetch(request, env, ctx) {
    const { run, code, names, callback } = await request.json();
    const hash = await hex(code);
    const worker = env.LOADER.get(`${hash}/${run}`, () => ({
      compatibilityDate: "2026-10-12",
      mainModule: "script.js",
      modules: { "script.js": moduleOf(code, names) },
      env: { FABRIKA: ctx.exports.Handle({ props: { run, callback } }) },
      globalOutbound: null,
    }));

    try {
      const text = await worker.getEntrypoint().run();
      return new Response(text, { headers: { "content-type": "application/json" } });
    } catch (e) {
      return Response.json({ error: `load: ${String(e)}` });
    }
  },
};
