FROM node:20

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm install

COPY . .

# Provide DATABASE_URL for prisma
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Build project
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
