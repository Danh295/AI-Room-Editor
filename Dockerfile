# Build and run the whole app as one container: the API and the built client
# are the same process, exactly as `npm start` runs it on a laptop.
FROM node:22-slim AS build

WORKDIR /app

# Install with the lockfile first so a source-only change doesn't reinstall
# every dependency.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY data/seed/ data/seed/

RUN npm run build

# ---------------------------------------------------------------------------

FROM node:22-slim AS runtime

ENV NODE_ENV=production
# Inside a container, loopback-only would make the published port useless.
# The container boundary is the thing keeping this private now, so publish it
# to 127.0.0.1 on the host (as compose does) unless you mean to share it.
ENV HOST=0.0.0.0
ENV PORT=8787
ENV ROOM_DATA_DIR=/data

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# sharp ships platform-specific binaries, so install rather than copy them in.
RUN npm ci --omit=dev --workspace server --include-workspace-root && npm cache clean --force

# The volume is written as `node`, so it has to be owned by `node`. Without
# this, a fresh named volume mounts root-owned and the first save fails.
RUN mkdir -p /data && chown -R node:node /data

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/data/seed data/seed

# The library is seeded into this volume on first run.
VOLUME ["/data"]
EXPOSE 8787

USER node

CMD ["node", "server/dist/index.js"]
