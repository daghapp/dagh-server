FROM node:20.19-alpine3.21 AS builder

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build

FROM node:20.19-alpine3.21 AS runner

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]
