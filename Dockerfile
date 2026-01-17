# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy backend files
COPY server.js ./
COPY api ./api
COPY utils ./utils

# Expose port
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
