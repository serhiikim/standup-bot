#!/bin/bash

echo "🛑 Stopping Slack Standup Bot..."

# Stop production containers
docker-compose down

echo "✅ Bot stopped successfully!"