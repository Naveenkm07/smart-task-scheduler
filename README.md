# Smart Task Scheduler

An intelligent task planning bot that integrates Notion, Google Calendar, and weather data to automatically schedule and manage your daily tasks with AI-powered conflict resolution.

## 🚀 Features

### Core Functionality
- **Notion Integration**: Sync tasks from your Notion database
- **Google Calendar Sync**: Bidirectional synchronization with Google Calendar
- **Weather-Aware Scheduling**: Automatically reschedules outdoor tasks based on weather
- **Smart Conflict Resolution**: AI-powered planning to avoid scheduling conflicts

### User Interface
- **Focus Tab**: Current task with reschedule and mark-as-done functionality
- **Timeline Tab**: Visual timeline of your day with real-time updates
- **Architecture Tab**: Agentic workflow controls and system monitoring

### Planned Agentic Workflow
1. **Collector Agent**: Gathers data from Notion, Calendar, and Weather APIs (15min intervals)
2. **Planner Agent**: AI-powered planning with conflict detection and resolution
3. **Executor Agent**: Updates calendars, sends notifications via Telegram
4. **Reviewer Agent**: Daily analysis and rule refinement for continuous improvement

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Frontend**: HTML5, Tailwind CSS, Vanilla JavaScript
- **APIs**: Google Calendar API, Notion API, OpenWeatherMap API
- **Authentication**: Google OAuth 2.0

## 📋 Prerequisites

- Node.js (v14 or higher)
- Google Cloud Console project with Calendar API enabled
- Notion workspace and API token
- OpenWeatherMap API key (optional)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Naveenkm07/smart-task-scheduler.git
   cd smart-task-scheduler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory:
   ```env
   # Google OAuth
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   
   # Notion API
   NOTION_TOKEN=your_notion_token
   NOTION_TASK_DATABASE_ID=your_notion_database_id
   
   # Weather API (Optional)
   OWM_API_KEY=your_openweathermap_api_key
   OWM_DEFAULT_CITY=London,GB
   
   # Session Secret
   SESSION_SECRET=your_session_secret
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open in browser**
   Navigate to `http://localhost:3000`

## ⚙️ Configuration

### Google Calendar Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials
5. Add `http://localhost:3000/auth/google/callback` to authorized redirect URIs

### Notion Setup
1. Create a Notion integration at [Notion Developers](https://developers.notion.com/)
2. Get your integration token
3. Share your task database with the integration
4. Copy the database ID from the URL

### Notion Database Schema
Your Notion database should have these properties:
- **Title** (Title): Task name
- **Status** (Status): Todo, In progress, Today, Done, Scheduled
- **Priority** (Select): High, Medium, Low
- **Due** (Date): Due date and time
- **EventId** (Rich Text): Google Calendar event ID for sync

## 🎯 Usage

### Focus Tab
- View your current priority task
- **Request Reschedule**: Change task timing with date/time picker
- **Mark as Done**: Update task status in Notion

### Timeline Tab
- See your daily schedule with calendar events and Notion tasks
- Visual timeline with time slots and task details

### Architecture Tab
- **Export Notion → Calendar**: Sync Notion tasks to Google Calendar
- **Sync Calendar → Notion**: Update Notion with calendar changes
- **Simulate Plan**: Test the AI planning workflow
- **Run Executor**: Execute planned changes

### Settings
- Configure Notion database connection
- Set property mappings for your database schema
- Connect Google Calendar authentication
- Set weather location preferences

## 🔄 API Endpoints

### Authentication
- `GET /auth/google/start` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/status` - Check authentication status
- `POST /auth/logout` - Sign out

### Calendar Operations
- `GET /api/calendar/events` - Fetch today's events
- `POST /api/calendar/events/batch` - Create/update multiple events
- `POST /api/calendar/events/byIds` - Fetch events by IDs

### Notion Operations
- `GET /api/notion/tasks` - Fetch tasks with filtering
- `POST /api/notion/pages/:id/status` - Update task status
- `POST /api/notion/pages/:id/due` - Update due date
- `POST /api/notion/quick-add` - Create new task

### Utilities
- `GET /api/weather` - Current weather data
- `POST /api/sync/calendar-to-notion` - Sync calendar to Notion

## 🚧 Roadmap

- [ ] Implement full agentic workflow with cron jobs
- [ ] Add AI integration (Google Gemini) for intelligent planning
- [ ] Telegram bot notifications
- [ ] Advanced conflict resolution algorithms
- [ ] Machine learning for personalized scheduling
- [ ] Mobile-responsive design
- [ ] Dark mode support

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Notion API](https://developers.notion.com/) for task management
- [Google Calendar API](https://developers.google.com/calendar) for scheduling
- [OpenWeatherMap API](https://openweathermap.org/api) for weather data
- [Tailwind CSS](https://tailwindcss.com/) for styling

## 📞 Support

For support, email naveenkm07@example.com or open an issue on GitHub.

---

**Made with ❤️ by [Naveen Kumar](https://github.com/Naveenkm07)**
