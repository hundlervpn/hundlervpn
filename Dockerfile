# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage  
FROM node:20-alpine AS runner

WORKDIR /app

# Set to production
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public files
COPY --from=builder /app/public ./public

# Copy all standalone files
COPY --from=builder /app/.next/standalone/ ./temp_standalone/

# Find and copy from nested directory (handles Windows path structure)
RUN STANDALONE_DIR=$(find ./temp_standalone -name "server.js" -type f -exec dirname {} \; | head -1) && \
    echo "Found standalone at: $STANDALONE_DIR" && \
    cp -r "$STANDALONE_DIR"/* ./ && \
    cp -r "$STANDALONE_DIR"/.[!.]* ./ 2>/dev/null || true && \
    rm -rf ./temp_standalone

# Copy static files
COPY --from=builder /app/.next/static ./.next/static

# Change ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
