FROM node:26-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 ships its prebuilds in the tarball, but its
# bundled binding.gyp makes npm attempt a source build (no toolchain here).
# No runtime dependency needs an install script; prebuilds load at require.
RUN npm ci --omit=dev --ignore-scripts

FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Runtime is bare alpine + the Node binary only — npm/corepack/headers from the
# node image never ship. The node image adds exactly libstdc++ + libatomic on
# alpine (no tzdata, no extra CA certs), so this mirrors it; busybox wget/sh stay.
FROM alpine:3.24
RUN apk add --no-cache libstdc++ libatomic
COPY --from=node:26-alpine /usr/local/bin/node /usr/local/bin/node
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=2 \
    CMD wget -q --spider http://127.0.0.1:55913/manifest.json || exit 1

EXPOSE 55913
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
