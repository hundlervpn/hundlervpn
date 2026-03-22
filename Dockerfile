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

# Copy standalone output (build runs in Linux — paths are flat)
COPY --from=builder /app/.next/standalone ./

# Copy static files (not included in standalone)
COPY --from=builder /app/.next/static ./.next/static

# Fix Next.js 15 standalone missing @mswjs/interceptors
RUN mkdir -p ./node_modules/next/dist/compiled/@mswjs
COPY --from=builder /app/node_modules/next/dist/compiled/@mswjs/ ./node_modules/next/dist/compiled/@mswjs/

# Change ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
