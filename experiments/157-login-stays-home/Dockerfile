# Experiment 157's box: real Codex and real Claude Code from npm at exact versions, and the helper
# the Sandbox SDK's `Files` runs. Cloudflare's own Claude Code tutorial builds the same way. Every
# job gets its own folder under /work, made by the box's Durable Object; no login is in the image.
FROM node:26.12.0-slim
# Claude Code's install script puts its native program in place; npm runs it only when allowed.
RUN npm install -g --allow-scripts=@anthropic-ai/claude-code \
	@openai/codex@0.163.0 @anthropic-ai/claude-code@2.1.310 && npm cache clean --force
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
# Claude Code reads a project's settings from this empty folder instead of the working one
# (experiment 155, MAKE_EMPTY_FOLDER in packages/fabrika/src/agents/claude/rules.ts).
# Debian does not ship it. Root owns it and nobody may write in it.
RUN mkdir -p -m 0555 /var/empty && mkdir -p /work && chown node:node /work
# Not root: root may write in a read-only folder, so an agent run as root could put settings there.
USER node
WORKDIR /work
CMD ["sleep", "infinity"]
