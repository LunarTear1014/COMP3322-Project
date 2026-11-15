FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
# Migrations run on demand: docker compose exec backend node src/ops/migrate.js
COPY --chown=node:node db/migrations ./db/migrations
USER node
CMD ["node", "src/index.js"]
