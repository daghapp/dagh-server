FROM node:20

WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json* ./

# Copy Prisma schema
COPY prisma ./prisma

# Install dependencies and generate Prisma client
RUN npm install

# Copy the rest of your source code
COPY . ./

# Build TypeScript to JavaScript
RUN npm run build

# Generate Prisma client after build so generated files exist in /dist
RUN npx prisma generate

EXPOSE 3000

# Start the compiled app
CMD ["npm", "start"]