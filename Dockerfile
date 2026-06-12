FROM node:20-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

# Start application
CMD ["npm", "start"]