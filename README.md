# Slack Standup Bot

AI-powered Slack standup bot with intelligent response analysis and automated scheduling.

## Features

- 🤖 **AI-Powered Analysis** - Uses OpenAI to analyze standup responses and generate insightful summaries
- ⏰ **Automated Scheduling** - Configure standups to run automatically on specific days and times
- 📊 **Smart Summaries** - Get AI-generated summaries highlighting achievements, blockers, and next steps
- 🔔 **Intelligent Reminders** - Automatic reminders for team members who haven't responded
- 👥 **Flexible Participation** - Include all channel members or specific participants
- 🌍 **Timezone Support** - Configure standups for different timezones
- 📈 **Analytics** - Track response rates, participation, and team engagement

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB database
- Slack workspace with bot permissions
- OpenAI API key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd slack-standup-bot
   npm install
   ```

2. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Slack Configuration
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token  # For Socket Mode

   # MongoDB
   MONGODB_URI=mongodb://localhost:27017/slack-standup-bot

   # OpenAI (Optional - for AI features)
   OPENAI_API_KEY=sk-your-openai-api-key
   OPENAI_MODEL=gpt-4o-mini

   # Server
   PORT=3000
   ```

3. **Start the application**
   ```bash
   # Production
   npm start

   # Development with auto-reload
   npm run dev
   ```

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

5. **Install the app** to your Slack workspace

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
| `/standup-status` | View current configuration and statistics |
| `/standup-complete` | Manually complete an active standup |
| `/standup-remind` | Send reminders to users who haven't responded |

### How Standups Work

1. **Automatic Start** - Bot posts standup questions at configured time
2. **Team Responses** - Team members reply in the thread with their answers
3. **Real-time Tracking** - Bot tracks responses and sends reminders
4. **AI Analysis** - When complete, AI analyzes all responses
5. **Smart Summary** - Bot posts a summary with insights and next steps

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
│   └── slackService.js    # Slack API helpers
├── jobs/scheduler.js       # Automated scheduling system
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

### Response Tracking
- Real-time response validation
- Edit tracking for updated responses
- Response time analytics
- Participation rate monitoring

### Fallback Modes
- Works without OpenAI API (basic summaries)
- Graceful error handling
- Manual standup management
- Offline data persistence

## Deployment

### Environment Variables
See [Installation](#installation) section for required environment variables.

### MongoDB Setup
The bot automatically creates necessary indexes and collections on startup.

### Production Considerations
- Use Socket Mode for real-time events in production
- Set up proper MongoDB clustering for high availability
- Configure log rotation and monitoring
- Use environment-specific configuration

## Troubleshooting

### Common Issues

**Bot not responding to commands:**
- Verify bot token and signing secret
- Check if bot is invited to the channel
- Review Slack app permissions

**Standups not starting automatically:**
- Check timezone configuration
- Verify scheduler is running
- Review MongoDB connection

**AI analysis not working:**
- Verify OpenAI API key is set
- Check API quota and billing
- Review model configuration

### Debug Mode
Enable detailed logging by setting:
```env
NODE_ENV=development
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](docs/)
- 🐛 [Issue Tracker](issues/)
- 💬 [Discussions](discussions/)

---

**Made with ❤️ for productive teams everywhere**