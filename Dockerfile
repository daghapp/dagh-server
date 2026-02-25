FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Provide DATABASE_URL for prisma
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Build project
RUN npm run build

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
