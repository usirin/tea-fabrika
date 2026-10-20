# Host B of experiment 97: experiment 95's container (../95-agents-across-hosts/Dockerfile), the
# same in every line but the file it runs. Only Node (the repo's version, see `volta` in
# package.json) and pnpm. No source, no node_modules and no secret goes into the image: the repo is
# mounted read-only at /repo when a container starts, and the Linux node_modules come from a named
# volume mounted over /repo/node_modules (filled once by ./install.sh).
#
#   docker build -t exp97-host:local -f experiments/97-one-ledger/Dockerfile experiments/97-one-ledger
FROM node:26.12.0-slim

RUN npm install --global pnpm@10.27.0 && npm cache clean --force

USER node
WORKDIR /repo
ENTRYPOINT ["node", "--no-warnings"]
CMD ["experiments/97-one-ledger/agents-host.ts"]
