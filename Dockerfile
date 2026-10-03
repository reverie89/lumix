FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:26-alpine AS production
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=2 \
    CMD wget -q --spider http://127.0.0.1:55913/manifest.json || exit 1

EXPOSE 55913
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]