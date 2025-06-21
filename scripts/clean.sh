#!/bin/bash

echo "🧹 Cleaning up Docker resources..."
echo "⚠️  This will remove all stopped containers and unused images"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Stop containers
    docker-compose down
    
    # Remove unused resources
    docker system prune -f
    
    echo "✅ Cleanup complete!"
else
    echo "Cleanup cancelled"
fi