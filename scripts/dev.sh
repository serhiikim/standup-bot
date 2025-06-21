#!/bin/bash

echo "🔧 Starting development environment..."

# Start with local MongoDB for development
docker-compose --profile local-dev up --build

echo ""
echo "🛠️ Development environment started!"
echo ""
echo "📊 MongoDB Express available at: http://localhost:8081"
echo "   Username: admin"
echo "   Password: admin123"
echo ""
echo "💡 Make sure your .env uses local MongoDB:"
echo "   MONGODB_URI=mongodb://mongodb:27017/slack-standup-bot"