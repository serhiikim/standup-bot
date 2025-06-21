#!/bin/bash

echo "📋 Viewing Slack Standup Bot logs..."
echo "Press Ctrl+C to exit"
echo ""

docker-compose logs -f standup-bot