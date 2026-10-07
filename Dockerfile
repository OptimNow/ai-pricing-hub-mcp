# Image for the hosted connector on Fly.io (`fly deploy` from the repo root).
#
# Two stages: the first runs `skybridge build` (vite for the widgets, tsc for
# the server), which needs the devDependencies; the second carries only the
# production dependencies and dist/. `skybridge start` must run from /app,
# because it serves the widget assets from `process.cwd()/dist/assets`.
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY server/ server/
COPY web/ web/
RUN npm run build \
 && test -f dist/server/src/index.js \
 && test -d dist/assets

FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist dist

EXPOSE 8080

# Streamable HTTP on 0.0.0.0:$PORT, route /mcp only (Alpic also mapped it to
# the root; Fly does not). Skybridge reads PORT and binds all interfaces.
CMD ["node_modules/.bin/skybridge", "start"]
