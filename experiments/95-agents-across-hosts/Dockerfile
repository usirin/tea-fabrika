# Host B of experiment 95: a tea-host in a container. Only Node (the repo's version, see
# `volta` in package.json) and pnpm. No source, no node_modules and no secret goes into the
# image: the repo is mounted read-only at /repo when a container starts, and the Linux
# node_modules come from a named volume mounted over /repo/node_modules (filled once by
# ./install.sh). A real agent's login is an environment variable given at `docker run`, never
# a file here.
#
#   docker build -t exp95-host -f experiments/95-agents-across-hosts/Dockerfile experiments/95-agents-across-hosts
FROM node:26.12.0-slim

RUN npm install --global pnpm@10.27.0 && npm cache clean --force

USER node
WORKDIR /repo
ENTRYPOINT ["node", "--no-warnings"]
CMD ["experiments/95-agents-across-hosts/host.ts"]
