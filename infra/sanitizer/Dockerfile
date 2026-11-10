# The file sanitizer: rebuilds uploaded PDFs and images so nothing hidden in them survives.
# It gets a file over HTTP and answers with the clean copy. It holds no secrets (no database,
# no storage keys) and needs no network access of its own.
#
# Build context: the repository root (see docker-compose.yml).
FROM node:24-slim

WORKDIR /app
# The only two libraries it needs; versions match apps/api/package.json.
RUN npm init -y >/dev/null \
 && npm pkg set type=module \
 && npm install --omit=dev --no-audit --no-fund pdf-lib@1.17.1 sharp@0.34.5 \
 && npm cache clean --force

# Node 24 runs these TypeScript files as they are (they use no TypeScript-only syntax).
COPY apps/api/src/sanitizer/sanitize.ts apps/api/src/sanitizer/sanitize-child.ts apps/api/src/sanitizer/run.ts apps/api/src/sanitizer/server.ts ./

USER node
ENV NODE_ENV=production SANITIZER_PORT=4010
EXPOSE 4010
CMD ["node", "--disable-warning=ExperimentalWarning", "server.ts"]
