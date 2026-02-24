FROM node:20

WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json* ./

# # Copy Prisma schema
# COPY prisma ./prisma


# Copy the rest of your source code
COPY . ./

# Install dependencies and generate Prisma client
RUN npm install

# Accept DATABASE_URL as a build argument
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Build TypeScript to JavaScript
RUN npm run build

# Generate Prisma client after build so generated files exist in /dist
RUN npx prisma generate

EXPOSE 3000

# Start the compiled app
CMD ["npm", "start"]
