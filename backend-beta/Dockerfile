FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
# Migrations run on demand: docker compose exec backend node src/ops/migrate.js
COPY --chown=node:node db/migrations ./db/migrations
# Event cover images live on a named volume mounted here (see compose.yaml).
RUN mkdir -p /app/data/covers && chown -R node:node /app/data
USER node
CMD ["node", "src/index.js"]
