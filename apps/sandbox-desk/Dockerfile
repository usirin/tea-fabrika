ARG FABRIKA_BASE_IMAGE=node:26-bookworm
FROM ${FABRIKA_BASE_IMAGE}
RUN if ! command -v tini >/dev/null; then apt-get update && apt-get install -y --no-install-recommends tini procps git && rm -rf /var/lib/apt/lists/*; fi
RUN if ! test -f /tools/node_modules/@lydell/node-pty/package.json; then npm install --prefix /tools @lydell/node-pty@1.2.0-beta.15; fi
COPY --from=docker.io/cloudflare/sandbox:1.0.1@sha256:e796e813de8213fb062bba279ddeddbf61277389a2cc7b3e4620075a9188843b /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY dist/ /opt/fabrika/
RUN mkdir -p /opt/fabrika/app/node_modules/@lydell && ln -s /tools/node_modules/@lydell/node-pty /opt/fabrika/app/node_modules/@lydell/node-pty
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "/opt/fabrika/runtime.mjs"]
