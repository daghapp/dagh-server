FROM node:20.19-alpine3.21 AS builder

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build

# Optional Sentry source-map upload (skipped when SENTRY_AUTH_TOKEN is absent).
# Pass --build-arg SENTRY_AUTH_TOKEN etc. when building. Also set the matching
# SENTRY_RELEASE at runtime so errors are symbolicated against these maps.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$SENTRY_RELEASE

RUN npm run sentry:sourcemaps

FROM node:20.19-alpine3.21 AS runner

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY src/views ./dist/src/views

ENV NODE_ENV=production

EXPOSE 5000

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && npm start"]
