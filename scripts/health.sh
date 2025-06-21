#!/bin/bash

echo "🏥 Checking bot health..."

# Check if container is running
if ! docker-compose ps | grep -q "standup-bot.*Up"; then
    echo "❌ Bot container is not running"
    echo "Start with: ./scripts/start.sh"
    exit 1
fi

echo "✅ Bot container is running"

# Try health endpoint if available
if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Health endpoint responding"
    curl -s http://localhost:3000/health | jq '.' 2>/dev/null || curl -s http://localhost:3000/health
else
    echo "⚠️  Health endpoint not available"
fi

echo ""
echo "📊 Container status:"
docker-compose ps