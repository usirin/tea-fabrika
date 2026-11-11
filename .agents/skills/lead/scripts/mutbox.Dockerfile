# The mutation container's image (0045). Today's lead tooling, not product.
# Built with the network on, run with `--network none`. mutbox.ts builds it from a folder that
# holds only this file, mutbox-entry.sh and the commit's lockfile, workspace file and patches,
# so the image holds no secret and no file from outside the checkout.
# The base is pinned by digest: the multi-platform index of node:26.13.0-bookworm, which brings git.
FROM node:26.13.0-bookworm@sha256:a546d3f8acd2af4382668a7e6acd3bc4418e6a27478373e3246f8162f5181509
ARG PNPM
RUN npm install --global "pnpm@${PNPM}"
COPY mutbox-entry.sh /usr/local/bin/mutbox-entry
USER node
WORKDIR /repo
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node patches ./patches
# pnpm's own way for an image (https://pnpm.io/docker): fetch needs only the lockfile, and the
# offline install that links node_modules runs later, in the container, with no network.
RUN pnpm fetch
