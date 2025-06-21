#!/bin/bash

echo "🔄 Updating Slack Standup Bot..."

# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up --build -d

echo "✅ Bot updated and restarted!"
echo "📋 View logs: docker-compose logs -f standup-bot"