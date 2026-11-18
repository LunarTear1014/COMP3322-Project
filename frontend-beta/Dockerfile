FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
# openssl issues the self-signed certificate when APP_ORIGIN is https://
# (see nginx/40-clubspace-site.sh, which writes conf.d/default.conf at start).
RUN apk add --no-cache openssl && rm -f /etc/nginx/conf.d/default.conf
COPY nginx/locations.conf /etc/nginx/clubspace/locations.conf
COPY --chmod=755 nginx/40-clubspace-site.sh /docker-entrypoint.d/40-clubspace-site.sh
COPY --from=build /app/dist /usr/share/nginx/html
