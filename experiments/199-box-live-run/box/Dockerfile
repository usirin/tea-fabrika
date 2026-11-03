# Experiment 199's box: what a daily check's hands need, and no copy of the code. The box clones
# the public repo itself, at the commit it is given, and installs from nothing, so the run times a
# fresh box. Node and pnpm at the repo's own exact versions (package.json); the apt list is the
# one CI's test job adds (.github/workflows/check.yaml), plus git, GNU time and procps to measure.
FROM node:26.13.0-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates time procps expect zsh bubblewrap socat ripgrep \
	&& rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.16.1 && npm cache clean --force
WORKDIR /app
COPY run-all.mjs /app/
RUN mkdir -p /w && chown node:node /w
USER node
WORKDIR /w
CMD ["node", "/app/run-all.mjs"]
