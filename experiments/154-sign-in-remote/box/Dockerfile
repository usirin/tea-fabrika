# Experiment 154's box: Node 26 and the bundled box (box.mjs, from ../build.ts), the agent probe,
# and two users. The box runs as root inside the container, so it can start the agent's commands
# as `agent`, a user that may not read root's processes. The same image is the Cloudflare
# container's (../cloud/wrangler.jsonc).
FROM node:26.12.0-slim
RUN useradd --create-home --uid 1001 agent && mkdir -p /work/agent && chown agent:agent /work/agent
WORKDIR /app
COPY box.mjs agent-probe.mjs /app/
WORKDIR /work
CMD ["node", "/app/box.mjs"]
