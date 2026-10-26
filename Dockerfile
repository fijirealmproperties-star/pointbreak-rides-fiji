# ---- Mobile web build (rider + driver app served by the API) ----
FROM node:20-alpine AS mobile-web
WORKDIR /app
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./
# Basemap style baked into the web build (defaults to OpenFreeMap in code).
ARG EXPO_PUBLIC_MAP_STYLE_URL
ENV EXPO_PUBLIC_MAP_STYLE_URL=${EXPO_PUBLIC_MAP_STYLE_URL}
RUN npm run export

# ---- Server dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# ---- Runtime ----
FROM node:20-alpine
ENV NODE_ENV=production

WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY web ./web
COPY --from=mobile-web /app/dist ./mobile-web

ENV MOBILE_WEB_DIR=/app/mobile-web

RUN mkdir -p /app/data && chown -R node:node /app

WORKDIR /app/server
USER node

EXPOSE 3003
CMD ["node", "index.js"]
