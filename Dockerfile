FROM node:20

WORKDIR /app

# Accept DATABASE_URL as a build argument (with fallback for build time)
ARG DATABASE_URL=postgresql://user:password@localhost:5432/dbname?schema=public
ENV DATABASE_URL=$DATABASE_URL

# Copy package files first for caching
COPY package.json package-lock.json* ./

# Copy Prisma schema
COPY prisma ./prisma

# Install dependencies (this runs postinstall which generates Prisma client)
RUN npm install

# Copy the rest of your source code
COPY . ./

# Build TypeScript to JavaScript
RUN npm run build

EXPOSE 3000

# Start the compiled app
CMD ["npm", "start"]