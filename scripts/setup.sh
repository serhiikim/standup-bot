#!/bin/bash

echo "🚀 Setting up Slack Standup Bot..."

# Check dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "✅ Created .env file"
    echo "📋 Please edit .env file with your configuration:"
    echo "   1. Add your Slack app credentials"
    echo "   2. Add your MongoDB Atlas connection string"
    echo "   3. Optionally add OpenAI API key for AI features"
else
    echo "✅ .env file already exists"
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p logs

# Make scripts executable
echo "🔧 Setting up scripts..."
chmod +x scripts/*.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo ""
echo "1. Edit .env file with your credentials:"
echo "   nano .env"
echo ""
echo "2. Start the bot:"
echo "   ./scripts/start.sh"
echo ""
echo "3. Check status:"
echo "   docker-compose ps"
echo "   docker-compose logs -f standup-bot"
echo ""
echo "📚 Other commands:"
echo "   ./scripts/stop.sh    # Stop the bot"
echo "   ./scripts/restart.sh # Restart the bot"
echo "   ./scripts/dev.sh     # Development mode"