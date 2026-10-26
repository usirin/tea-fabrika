# Experiment 148's job box: Node 26, the job runner, the stand-in agent and the probe. One box
# runs one job, as the image's own `node` user; the probe runs as root, by exec, to see everything.
FROM node:26.12.0-slim
WORKDIR /app
COPY run.mjs ask.mjs probe.mjs /app/
RUN mkdir -p /work && chown node:node /work
USER node
WORKDIR /work
CMD ["node", "/app/run.mjs"]
