FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs



# Start application
CMD ["npm", "start"]