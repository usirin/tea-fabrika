# Experiment 148's job box: Node 26, the job runner, the stand-in agent, the probe, the network
# check, and Claude Code itself, unmodified, from npm at an exact version. One box runs one job, as
# the image's own `node` user; the probe runs as root, by exec, to see everything.
FROM node:26.12.0-slim
RUN npm install -g @anthropic-ai/claude-code@2.1.310 && npm cache clean --force
WORKDIR /app
COPY run.mjs ask.mjs probe.mjs net.mjs /app/
RUN mkdir -p /work && chown node:node /work
USER node
WORKDIR /work
CMD ["node", "/app/run.mjs"]
