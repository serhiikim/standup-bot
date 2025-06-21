#!/bin/bash

echo "🔄 Restarting Slack Standup Bot..."

# Stop containers
docker-compose down

# Start again
docker-compose up --build -d

echo "✅ Bot restarted successfully!"
echo "📋 View logs: docker-compose logs -f standup-bot"