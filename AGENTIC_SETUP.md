# 🤖 Personal Task Planner Bot - Agentic AI System

A fully autonomous AI system that intelligently schedules tasks, resolves conflicts, and continuously learns from your patterns without requiring user prompts.

## 🎯 What Makes This Agentic?

This system operates **completely autonomously** with four specialized AI agents:

### 📊 **Collector Agent (WT1)**
- **Runs every 15 minutes** automatically
- Gathers data from Notion, Google Calendar, and weather APIs
- Provides fresh data to other agents
- Self-monitors data quality and freshness

### 🧠 **Planner Agent (WT2) - The Brain**
- **Runs every 30 minutes** during work hours
- Uses **Google Gemini AI** for intelligent planning
- Automatically detects and resolves scheduling conflicts
- Considers weather, user patterns, and task priorities
- **Makes decisions without user input**

### ⚡ **Executor Agent (WT3)**
- **Runs every 2 hours** during work hours
- Executes plans by updating calendars and Notion
- Sends proactive notifications via Telegram
- Handles errors and retries automatically

### 📈 **Reviewer Agent (WT4) - The Learner**
- **Runs daily at 10 PM**
- Analyzes performance and learns patterns
- Adapts user preferences automatically
- Provides insights for continuous improvement

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your API keys (see setup guide below)
```

### 3. Start the System
```bash
# Start server with automatic agent system
npm start

# Or start agents separately
npm run agents
```

### 4. Access the Interface
- Open `http://localhost:3000`
- Go to **Architecture** tab to monitor agents
- Agents will start working automatically!

## 🔧 Detailed Setup Guide

### Google Gemini AI (Required for Intelligence)
1. Get API key from [Google AI Studio](https://aistudio.google.com/)
2. Add to `.env`: `GEMINI_API_KEY=your-key`

### Google Calendar Integration
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Enable **Google Calendar API**
4. Create **OAuth 2.0 credentials**
5. Add redirect URI: `http://localhost:3000/auth/google/callback`
6. Add credentials to `.env`

### Notion Database Setup
1. Create Notion integration at [Notion Developers](https://developers.notion.com/)
2. Create database with these **exact properties**:
   - **Title** (Title): Task name
   - **Status** (Select): Todo, In progress, Today, Done, Scheduled
   - **Priority** (Select): High, Medium, Low
   - **Due** (Date): Due date and time
   - **EventId** (Rich Text): Google Calendar event ID
3. Share database with your integration
4. Add token and database ID to `.env`

### Telegram Notifications (Optional)
1. Create bot with [@BotFather](https://t.me/botfather)
2. Get your chat ID from [@userinfobot](https://t.me/userinfobot)
3. Add to `.env`: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

### Weather Integration (Optional)
1. Get free API key from [OpenWeatherMap](https://openweathermap.org/api)
2. Add to `.env`: `OWM_API_KEY=your-key`

## 🎮 Using the Agentic System

### Automatic Operation
Once started, the system operates completely autonomously:
- **No manual triggers needed**
- **No user prompts required**
- **Continuous learning and adaptation**

### Manual Controls (Optional)
Access via API or Architecture tab:

```bash
# Check agent status
curl http://localhost:3000/api/agents/status

# Trigger specific agent
curl -X POST http://localhost:3000/api/agents/trigger/collector
curl -X POST http://localhost:3000/api/agents/trigger/planner
curl -X POST http://localhost:3000/api/agents/trigger/executor
curl -X POST http://localhost:3000/api/agents/trigger/reviewer

# Run full workflow
curl -X POST http://localhost:3000/api/agents/trigger/fullWorkflow

# Start/stop agent system
curl -X POST http://localhost:3000/api/agents/start
curl -X POST http://localhost:3000/api/agents/stop
```

### Architecture Tab Features
- **Real-time agent monitoring**
- **Manual agent triggers**
- **System health dashboard**
- **Performance metrics**
- **Learning insights**

## 🔄 Autonomous Workflow

### Daily Cycle
```
09:00 → Collector gathers morning data
09:30 → Planner creates optimal schedule
11:00 → Executor updates calendars & sends notifications
13:00 → Collector checks for changes
13:30 → Planner adjusts afternoon schedule
15:00 → Executor implements updates
...
22:00 → Reviewer analyzes day's performance
22:05 → System learns and adapts preferences
```

### Conflict Resolution Example
1. **Collector** detects outdoor task during rain forecast
2. **Planner** uses AI to reschedule indoor tasks first
3. **Executor** updates calendar and notifies via Telegram
4. **Reviewer** learns that user prefers morning rescheduling

## 🧠 AI Intelligence Features

### Smart Planning
- **Weather-aware scheduling** (outdoor tasks on sunny days)
- **Energy-based task ordering** (hard tasks during peak hours)
- **Deadline prioritization** with buffer time
- **Conflict prediction and prevention**

### Continuous Learning
- **Task completion patterns** (when you're most productive)
- **Priority effectiveness** (which tasks you actually complete)
- **Time estimation improvement** (learning your actual pace)
- **Preference adaptation** (automatically adjusting settings)

### Conflict Resolution
- **Automatic rescheduling** when conflicts detected
- **Resource optimization** (avoiding double bookings)
- **Weather adaptation** (moving outdoor tasks)
- **User pattern respect** (not scheduling during known busy times)

## 📊 Monitoring & Insights

### System Health
- Agent execution success rates
- Data collection freshness
- AI planning confidence scores
- Error tracking and recovery

### Performance Analytics
- Task completion rates by priority
- Most productive time slots
- Weather impact on scheduling
- Learning system effectiveness

## 🔧 Customization

### Agent Schedules
Edit `agents/agent-runner.js` to modify:
- Collection frequency (default: 15 minutes)
- Planning frequency (default: 30 minutes)
- Execution frequency (default: 2 hours)
- Review timing (default: 10 PM daily)

### AI Prompts
Customize AI behavior in `agents/utils/ai-service.js`:
- Planning rules and priorities
- Conflict resolution strategies
- Learning algorithms

### Notification Templates
Modify notification formats in `agents/executor-agent.js`

## 🚨 Troubleshooting

### Agent Not Running
```bash
# Check status
curl http://localhost:3000/api/agents/status

# View logs
tail -f logs/agent.log
```

### AI Planning Issues
- Verify `GEMINI_API_KEY` is set
- Check API quota and billing
- Review planning confidence scores

### Integration Problems
- Test API connections individually
- Verify OAuth tokens are fresh
- Check database permissions

## 🌟 Advanced Features

### Custom Agent Development
Create your own agents by extending the base agent pattern:
```javascript
class CustomAgent {
    async execute() {
        // Your autonomous logic here
    }
}
```

### Webhook Integration
Add webhooks to trigger agents on external events:
```javascript
app.post('/webhook/trigger-planning', async (req, res) => {
    await agentRunner.triggerPlanning();
    res.json({ triggered: true });
});
```

## 📈 Success Metrics

The system measures its own success:
- **Scheduling accuracy** (99%+ conflict-free scheduling)
- **Task completion rates** (learning improves over time)
- **User satisfaction** (fewer manual interventions needed)
- **Adaptation speed** (how quickly it learns your patterns)

---

## 🎉 You're Now Running an Autonomous AI Assistant!

The system will continuously:
- **Monitor** your tasks and calendar
- **Plan** optimal schedules using AI
- **Execute** changes automatically  
- **Learn** from your patterns
- **Adapt** to serve you better

**No more manual scheduling - just pure AI-powered productivity!** 🚀
