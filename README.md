# Slack Standup Bot

AI-powered Slack standup bot with intelligent response analysis, automated scheduling, and smart out-of-office handling.

## Features

- 🤖 **AI-Powered Analysis** - Uses OpenAI to analyze standup responses and generate insightful summaries
- ⏰ **Automated Scheduling** - Configure standups to run automatically on specific days and times
- 🏝️ **Smart OOO Handling** - Automatically detects out-of-office team members and adapts standups accordingly
- 📊 **Smart Summaries** - Get AI-generated summaries highlighting achievements, blockers, and next steps
- 🔔 **Intelligent Reminders** - Automatic reminders for team members who haven't responded
- 👥 **Flexible Participation** - Include all channel members or specific participants
- 🌍 **Timezone Support** - Configure standups for different timezones
- 📈 **Analytics** - Track response rates, participation, and team engagement

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Slack workspace with bot permissions
- MongoDB Atlas account (free tier available)
- OpenAI API key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd slack-standup-bot
   ```

2. **Initial setup**
   ```bash
   ./scripts/setup.sh
   ```

3. **Configure environment**
   
   Edit the `.env` file:
   ```env
   # Slack Configuration (Required)
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token

   # MongoDB Atlas (Required)
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/slack-standup-bot

   # OpenAI (Optional - for AI features)
   OPENAI_API_KEY=sk-your-openai-api-key
   OPENAI_MODEL=gpt-4o-mini
   ```

4. **Start the bot**
   ```bash
   ./scripts/start.sh
   ```

That's it! 🎉

### Slack App Setup

1. **Create a Slack App** at [api.slack.com](https://api.slack.com/apps)

2. **Configure OAuth & Permissions** with these scopes:
   ```
   Bot Token Scopes:
   - app_mentions:read         # View messages that mention the bot
   - channels:history          # View messages in public channels
   - channels:read             # View basic info about public channels
   - chat:write                # Send messages as the bot
   - commands                  # Add slash commands
   - groups:history            # View messages in private channels
   - im:history                # View direct messages
   - im:write                  # Start direct messages
   - reactions:write           # Add emoji reactions
   - team:read                 # View workspace info
   - users:read                # View people in workspace
   - users.profile:read        # Read user profile info (for OOO status)
   ```

3. **Set up App-Level Token** (for Socket Mode):
   ```
   App-Level Token Scopes:
   - connections:write         # For Socket Mode connections
   - authorizations:read       # For event authorizations
   ```

4. **Set up Slash Commands**:
   - `/standup-setup` - Configure standup for a channel
   - `/standup-start` - Manually start a standup
   - `/standup-status` - Check current configuration and stats
   - `/standup-complete` - Manually complete an active standup
   - `/standup-remind` - Send reminders to users who haven't responded

5. **Configure Event Subscriptions**:
   - Enable Socket Mode for real-time events
   - Subscribe to bot events:
     - `app_mention` - When bot is mentioned
     - `message.channels` - Messages in public channels
     - `message.groups` - Messages in private channels
     - `message.im` - Direct messages

6. **Install the app** to your Slack workspace

## Usage

### Basic Setup

1. **Invite the bot** to your channel:
   ```
   /invite @StandupBot
   ```

2. **Configure standup** using the slash command:
   ```
   /standup-setup
   ```

3. **Fill out the configuration modal**:
   - Set your standup questions
   - Choose time and days
   - Select timezone
   - Optionally specify participants

### Commands

| Command | Description |
|---------|-------------|
| `/standup-setup` | Open configuration modal for the current channel |
| `/standup-start` | Manually start a standup (for testing) |
| `/standup-status` | View current configuration, stats, and team availability |
| `/standup-complete` | Manually complete an active standup |
| `/standup-remind` | Send reminders to users who haven't responded |

### How Standups Work

1. **Automatic Start** - Bot posts standup questions at configured time
2. **OOO Detection** - Bot checks team member statuses and excludes those out of office
3. **Team Responses** - Available team members reply in the thread with their answers
4. **Real-time Tracking** - Bot tracks responses and sends reminders
5. **AI Analysis** - When complete, AI analyzes all responses
6. **Smart Summary** - Bot posts a summary with insights and next steps

## Out-of-Office (OOO) Features

The bot intelligently handles team members who are out of office:

### Automatic OOO Detection
- **Status Text**: Recognizes keywords like "vacation", "sick", "pto", "out of office", "travel"
- **Status Emojis**: Detects OOO emojis like 🏝️, ✈️, 🤒, 😴
- **Time-based**: Respects temporary statuses with expiration times

### Smart Standup Behavior
- **Partial Team OOO**: Excludes OOO members and runs standup with available team
- **Entire Team OOO**: Skips standup entirely and posts notification
- **OOO Information**: Shows who's out and why in standup messages
- **Automatic Resume**: Resumes normal standups when team returns

### Examples

**Partial Team Out:**
```
🚀 Daily Standup Started!
@john @sarah

📴 Out of Office (2):
• Mike - vacation
• Lisa - sick leave

Please answer these questions...
```

**Entire Team Out:**
```
🏝️ Standup Skipped - Team Out of Office
90% of the team is currently out of office.

📴 Out of Office (3):
• Mike - vacation  
• Lisa - sick leave
• John - travel

🔄 Next scheduled standup: Monday at 09:00 (UTC)
💡 Standup will resume automatically when team members return.
```

## Management Commands

### Simple Scripts:
```bash
./scripts/setup.sh     # Initial setup
./scripts/start.sh     # Start the bot
./scripts/stop.sh      # Stop the bot
./scripts/restart.sh   # Restart the bot
./scripts/logs.sh      # View logs
./scripts/health.sh    # Check bot health
./scripts/update.sh    # Update and restart
./scripts/clean.sh     # Clean Docker resources
```

### NPM Scripts:
```bash
npm run docker:setup    # Initial setup
npm run docker:start    # Start the bot
npm run docker:stop     # Stop the bot
npm run docker:logs     # View logs
npm run docker:health   # Check health
```

### Direct Docker Commands:
```bash
# Check status
docker-compose ps

# View bot logs
docker-compose logs -f standup-bot

# Stop the bot
docker-compose down

# Restart the bot
docker-compose restart standup-bot

# Update and restart
git pull && docker-compose up --build -d
```

## Development

For local development with a local MongoDB:

```bash
# Start development environment
./scripts/dev.sh

# Access MongoDB Express at http://localhost:8081
# Credentials: admin / admin123
```

Make sure your `.env` uses local MongoDB for development:
```env
MONGODB_URI=mongodb://mongodb:27017/slack-standup-bot
```

## Architecture

```
standup-bot/
├── app.js                    # Main application entry point
├── config/database.js        # MongoDB connection and setup
├── models/                   # Data models
│   ├── Team.js              # Slack workspace data
│   ├── Channel.js           # Channel configurations
│   ├── Standup.js          # Active standup sessions
│   └── Response.js         # User responses
├── handlers/                # Slack event handlers
│   ├── commands.js         # Slash command handlers
│   ├── events.js          # Message and event handlers
│   ├── actions.js         # Interactive component handlers
│   └── views.js           # Modal and view handlers
├── services/               # Business logic services
│   ├── standupService.js   # Core standup functionality
│   ├── llmService.js      # AI analysis service
│   ├── slackService.js    # Slack API helpers
│   └── userStatusService.js # OOO detection and filtering
├── jobs/scheduler.js       # Automated scheduling system
├── scripts/                # Management scripts
└── utils/constants.js      # Configuration constants
```

## Configuration Options

### Standup Questions
Customize up to 10 questions for your team. Default questions:
- What did you accomplish yesterday?
- What are you working on today?
- Any blockers or challenges?

### Scheduling
- **Time**: Choose any time between 6 AM - 6 PM
- **Days**: Select specific weekdays
- **Timezone**: Support for major timezones
- **Response Window**: 3-hour default response deadline

### OOO Detection
The bot automatically recognizes these out-of-office indicators:

**English Keywords:**
- vacation, holiday, pto, sick, leave, travel, out of office, ooo, away, offline, absent

**Common Emojis:**
- 🏝️ 🌴 ✈️ 🏖️ 🤒 💊 🏥 😴 💤

### AI Features
When OpenAI API key is configured, the bot provides:
- **Intelligent Summaries** - Key points from all responses
- **Achievement Tracking** - Highlights team accomplishments
- **Blocker Detection** - Identifies challenges and issues
- **Next Steps** - Extracts action items and priorities
- **Team Mood Analysis** - Assesses overall team sentiment

## Advanced Features

### Automated Scheduling
The bot runs a scheduler that:
- Checks for scheduled standups every minute
- Processes expired standups every 5 minutes
- Sends reminders every 2 minutes
- Cleans up old data daily

### OOO-Aware Operations
- **Smart Filtering**: Automatically excludes OOO team members
- **Threshold Detection**: Skips standups when >90% of team is out
- **Status Monitoring**: Continuously checks team availability
- **Intelligent Notifications**: Clear communication about OOO situations

### Response Tracking
- Real-time response validation
- Edit tracking for updated responses
- Response time analytics
- Participation rate monitoring (excluding OOO members)

### Fallback Modes
- Works without OpenAI API (basic summaries)
- Graceful error handling
- Manual standup management
- Cloud database persistence

## Deployment

### Production Setup
- Uses MongoDB Atlas (cloud database) - no local database dependencies
- Dockerized application for easy deployment
- Automatic container restart on failure
- Logs stored in `./logs/` directory
- Stateless application - easy to scale and update

### Environment Variables
See [Installation](#installation) section for required environment variables.

## Troubleshooting

### Common Issues

**Bot not responding to commands:**
- Verify bot token and signing secret
- Check if bot is invited to the channel
- Review Slack app permissions

**Standups not starting automatically:**
- Check timezone configuration
- Verify scheduler is running
- Review MongoDB connection with `./scripts/health.sh`

**OOO detection not working:**
- Ensure `users.profile:read` permission is granted
- Check if team members have status text/emojis set
- Verify user profiles are accessible to the bot

**AI analysis not working:**
- Verify OpenAI API key is set
- Check API quota and billing
- Review model configuration

**Database connection issues:**
- Verify MongoDB Atlas connection string
- Check if your IP is whitelisted in Atlas
- Ensure database user has proper permissions

### Debug Commands
```bash
./scripts/logs.sh      # View detailed logs
./scripts/health.sh    # Check system health
docker-compose ps      # Check container status
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

- 📖 [Documentation](docs/)
- 🐛 [Issue Tracker](issues/)
- 💬 [Discussions](discussions/)

---

**Made with ❤️ for productive teams everywhere**