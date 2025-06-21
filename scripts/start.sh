#!/bin/bash

echo "🚀 Starting Slack Standup Bot..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run ./scripts/setup.sh first."
    exit 1
fi

# Build and start production containers
docker-compose up --build -d

echo ""
echo "✅ Bot started successfully!"
echo ""
echo "📊 Check status:"
echo "   docker-compose ps"
echo ""
echo "📋 View logs:"
echo "   docker-compose logs -f standup-bot"
echo ""
echo "🛑 Stop bot:"
echo "   ./scripts/stop.sh"