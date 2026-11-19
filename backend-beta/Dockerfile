FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
# Migrations run on demand: docker compose exec backend node src/ops/migrate.js
COPY --chown=node:node db/migrations ./db/migrations
# Cover images for the demo events (seed-demo.js, attach-demo-covers.js).
COPY --chown=node:node db/demo-images ./db/demo-images
# Club icons for the demo clubs (seed-demo.js, attach-demo-club-icons.js).
COPY --chown=node:node db/demo-icons ./db/demo-icons
# Event cover images live on a named volume mounted here (see compose.yaml).
RUN mkdir -p /app/data/covers && chown -R node:node /app/data
USER node
CMD ["node", "src/index.js"]
