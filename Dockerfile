# Image for the hosted connector on Fly.io (`fly deploy` from the repo root).
#
# Two stages: the first compiles the server with tsc, which needs the
# devDependencies; the second carries only the production dependencies and
# dist/. The server is plain Node on the MCP SDK: no framework, no bundler, no
# static assets.
# Pinned to an exact tag (engines says >= 24.14.0) so a deploy today and a
# deploy next month build the same image; bump it deliberately.
FROM node:24.21.0-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY server/ server/
RUN npm run build \
 && test -f dist/server/src/index.js

FROM node:24.21.0-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist dist

EXPOSE 8080

# Run as the unprivileged user the base image provides; the app writes
# nothing to disk.
USER node

# Streamable HTTP on all interfaces at $PORT: /mcp for the protocol, /healthz
# for liveness, 404 for everything else. The server handles SIGINT and SIGTERM
# itself, so it stops cleanly as PID 1 without an init.
CMD ["node", "dist/server/src/index.js"]
