// (moved endpoints defined later, after app initialization)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import cors from 'cors';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import agentRunner from './agents/agent-runner.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax', secure: false }
}));

// Serve static frontend (index.html) from project root
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, '.')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Google OAuth setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`
);

const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'openid',
    'email',
    'profile'
];

app.get('/auth/google/start', (req, res) => {
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: GOOGLE_SCOPES, prompt: 'consent' });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code } = req.query;
        const { tokens } = await oauth2Client.getToken(String(code));
        req.session.googleTokens = tokens;
        res.send('<script>window.close();</script>');
    } catch (err) {
        res.status(500).json({ error: 'Google OAuth failed', details: String(err) });
    }
});

app.get('/auth/status', (req, res) => {
    res.json({ authenticated: Boolean(req.session.googleTokens) });
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

function getGoogleClientFromSession(req) {
    const tokens = req.session.googleTokens;
    if (!tokens) return null;
    const client = oauth2Client; client.setCredentials(tokens); return client;
}

app.get('/api/calendar/events', async (req, res) => {
    try {
        const client = getGoogleClientFromSession(req);
        if (!client) return res.status(401).json({ error: 'Not authenticated with Google' });
        const calendar = google.calendar({ version: 'v3', auth: client });
        const now = new Date();
        const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: end.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 25
        });
        res.json({ events: data.items || [] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch events', details: String(err) });
    }
});

// Create/update batch of events from Notion tasks
app.post('/api/calendar/events/batch', async (req, res) => {
    try {
        const client = getGoogleClientFromSession(req);
        if (!client) return res.status(401).json({ error: 'Not authenticated with Google' });
        const calendar = google.calendar({ version: 'v3', auth: client });
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const created = [], updated = [], skipped = [];
        const markScheduled = String(req.body?.markScheduled || 'false') === 'true';
        const statusProp = req.body?.statusProp || 'Status';
        const scheduledValue = req.body?.scheduledStatus || 'Scheduled';
        const eventIdProp = req.body?.eventIdProp || 'EventId';

        for (const it of items) {
            const notionId = it.notionId;
            const eventBody = {
                summary: it.title || 'Task',
                start: it.start?.includes('T') ? { dateTime: it.start } : { date: it.start },
                end: it.end ? (it.end.includes('T') ? { dateTime: it.end } : { date: it.end }) : undefined,
                description: it.description || undefined,
                extendedProperties: notionId ? { private: { notionId } } : undefined
            };

            let result;
            if (it.eventId) {
                // Prefer updating by eventId if provided
                result = await calendar.events.update({ calendarId: 'primary', eventId: it.eventId, requestBody: eventBody }).then(r => ({ type: 'updated', data: r.data })).catch(async () => {
                    // If update fails (deleted/missing), create new
                    const r = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
                    return { type: 'created', data: r.data };
                });
            } else {
                // Fallback: find by notionId in extendedProperties
                let existing = null;
                if (notionId) {
                    const now = new Date();
                    const past = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
                    const future = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
                    const list = await calendar.events.list({ calendarId: 'primary', timeMin: past, timeMax: future, maxResults: 2500, singleEvents: true, orderBy: 'startTime' });
                    existing = (list.data.items || []).find(ev => ev.extendedProperties?.private?.notionId === notionId);
                }
                if (existing) {
                    const r = await calendar.events.update({ calendarId: 'primary', eventId: existing.id, requestBody: eventBody });
                    result = { type: 'updated', data: r.data };
                } else {
                    const r = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
                    result = { type: 'created', data: r.data };
                }
            }

            if (result.type === 'created') created.push(result.data); else updated.push(result.data);

            // Write eventId back to Notion property if available
            if (process.env.NOTION_TOKEN && notionId && result?.data?.id) {
                try {
                    await fetch(`https://api.notion.com/v1/pages/${notionId}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
                            'Notion-Version': '2022-06-28',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ properties: { [eventIdProp]: { rich_text: [{ text: { content: result.data.id } }] } } })
                    });
                } catch (e) { /* ignore */ }
            }
        }
        // Optionally mark Notion pages as scheduled
        if (markScheduled && process.env.NOTION_TOKEN) {
            const headers = {
                'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            };
            const pages = items.map(i => i.notionId).filter(Boolean);
            for (const pageId of pages) {
                try {
                    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({ properties: { [statusProp]: { status: { name: scheduledValue } } } })
                    });
                } catch (e) { /* ignore per-page error */ }
            }
        }

        res.json({ createdCount: created.length, updatedCount: updated.length, skippedCount: skipped.length, created, updated, skipped });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create events', details: String(err) });
    }
});

// Fetch calendar events by IDs
app.post('/api/calendar/events/byIds', async (req, res) => {
    try {
        const client = getGoogleClientFromSession(req);
        if (!client) return res.status(401).json({ error: 'Not authenticated with Google' });
        const calendar = google.calendar({ version: 'v3', auth: client });
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const results = [];
        for (const id of ids) {
            try {
                const ev = await calendar.events.get({ calendarId: 'primary', eventId: id });
                results.push(ev.data);
            } catch (e) { /* skip not found */ }
        }
        res.json({ events: results });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch events', details: String(err) });
    }
});

// Notion tasks (token-based for simplicity). Use NOTION_TOKEN and NOTION_TASK_DATABASE_ID
app.get('/api/notion/tasks', async (req, res) => {
    try {
        const token = process.env.NOTION_TOKEN;
        const databaseId = (req.query.databaseId && String(req.query.databaseId)) || process.env.NOTION_TASK_DATABASE_ID;
        if (!token || !databaseId) return res.status(400).json({ error: 'Missing NOTION_TOKEN or NOTION_TASK_DATABASE_ID' });
        const statusProp = (req.query.statusProp && String(req.query.statusProp)) || 'Status';
        const priorityProp = (req.query.priorityProp && String(req.query.priorityProp)) || 'Priority';
        const dueProp = (req.query.dueProp && String(req.query.dueProp)) || 'Due';
        const allowStatuses = (req.query.statuses && String(req.query.statuses).split(',').map(s => s.trim()).filter(Boolean)) || ['Todo','In progress','Today'];
        const dueToday = String(req.query.dueToday || 'true') === 'true';
        const priorityOrder = (req.query.priorityOrder && String(req.query.priorityOrder).split(',').map(s => s.trim())) || ['High','Medium','Low'];

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        };

        function buildQuery({ fallback = false } = {}) {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const dateFilter = dueToday ? {
                property: dueProp,
                date: fallback ? { on_or_after: startOfDay.toISOString() } : { on_or_after: startOfDay.toISOString(), on_or_before: endOfDay.toISOString() }
            } : undefined;

            const filter = {
                and: [
                    { property: statusProp, status: { equals: allowStatuses[0] } }
                ]
            };
            // Replace first condition with OR of allowed statuses
            filter.and[0] = {
                or: allowStatuses.map(v => ({ property: statusProp, status: { equals: v } }))
            };
            if (dateFilter) filter.and.push(dateFilter);

            const sorts = [
                { property: dueProp, direction: 'ascending' }
            ];
            // Notion doesn't support sorting by select order directly; we can sort client-side later.

            return { page_size: 25, filter, sorts };
        }

        // First attempt: due today
        const queryBody = buildQuery();
        let resp = await fetch('https://api.notion.com/v1/databases/' + databaseId + '/query', { method: 'POST', headers, body: JSON.stringify(queryBody) });
        let data = await resp.json();

        // Fallback: nearest upcoming
        if ((!data.results || data.results.length === 0) && dueToday) {
            const fallbackBody = buildQuery({ fallback: true });
            resp = await fetch('https://api.notion.com/v1/databases/' + databaseId + '/query', { method: 'POST', headers, body: JSON.stringify(fallbackBody) });
            data = await resp.json();
        }

        // Attach helper fields for client sorting by priority
        const orderMap = Object.fromEntries(priorityOrder.map((p, i) => [p, i]));
        data.results = (data.results || []).map(r => {
            const props = r.properties || {};
            const priorityVal = props[priorityProp]?.select?.name || null;
            return { ...r, _priorityIndex: priorityVal in orderMap ? orderMap[priorityVal] : 999 };
        }).sort((a, b) => (a._priorityIndex - b._priorityIndex));

        res.json({ ...data, _meta: { statusProp, priorityProp, dueProp, allowStatuses, dueToday, priorityOrder } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch Notion tasks', details: String(err) });
    }
});

// Notion: update page status
app.post('/api/notion/pages/:id/status', async (req, res) => {
    try {
        const token = process.env.NOTION_TOKEN;
        if (!token) return res.status(400).json({ error: 'Missing NOTION_TOKEN' });
        const pageId = req.params.id;
        const statusProp = req.body?.statusProp || 'Status';
        const value = req.body?.value || 'Done';
        const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ properties: { [statusProp]: { status: { name: value } } } })
        });
        const data = await resp.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update status', details: String(err) });
    }
});

// Notion: update page due date
app.post('/api/notion/pages/:id/due', async (req, res) => {
    try {
        const token = process.env.NOTION_TOKEN;
        if (!token) return res.status(400).json({ error: 'Missing NOTION_TOKEN' });
        const pageId = req.params.id;
        const dueProp = req.body?.dueProp || 'Due';
        const start = req.body?.start;
        const end = req.body?.end || null;
        if (!start) return res.status(400).json({ error: 'Missing start date' });
        const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ properties: { [dueProp]: { date: { start, end } } } })
        });
        const data = await resp.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update due date', details: String(err) });
    }
});

// Notion: quick-add a task page
app.post('/api/notion/quick-add', async (req, res) => {
    try {
        const token = process.env.NOTION_TOKEN;
        const databaseId = req.body?.databaseId || process.env.NOTION_TASK_DATABASE_ID;
        if (!token || !databaseId) return res.status(400).json({ error: 'Missing NOTION_TOKEN or databaseId' });
        
        const titleProp = req.body?.titleProp || 'Title';
        const dueProp = req.body?.dueProp || 'Due';
        const statusProp = req.body?.statusProp || 'Status';
        const priorityProp = req.body?.priorityProp || 'Priority';
        const title = req.body?.title || 'New Task';
        const due = req.body?.due || null;
        const status = req.body?.status || null;
        const priority = req.body?.priority || null;
        
        const properties = {
            [titleProp]: { title: [{ text: { content: title } }] }
        };
        
        if (due) properties[dueProp] = { date: { start: due } };
        if (status) properties[statusProp] = { status: { name: status } };
        if (priority) properties[priorityProp] = { select: { name: priority } };
        
        const resp = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ parent: { database_id: databaseId }, properties })
        });
        
        const data = await resp.json();
        if (!resp.ok) {
            return res.status(resp.status).json({ error: 'Notion API error', details: data });
        }
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to quick-add task', details: String(err) });
    }
});
// OpenWeatherMap current weather
app.get('/api/weather', async (req, res) => {
    try {
        const apiKey = process.env.OWM_API_KEY;
        const q = req.query.q || process.env.OWM_DEFAULT_CITY || 'London,GB';
        if (!apiKey) return res.status(400).json({ error: 'Missing OWM_API_KEY' });
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(String(q))}&appid=${apiKey}&units=metric`;
        const resp = await fetch(url);
        const data = await resp.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch weather', details: String(err) });
    }
});

// Basic Calendar -> Notion sync endpoint: expects items with notionId and updated start/end/title
app.post('/api/sync/calendar-to-notion', async (req, res) => {
    try {
        const token = process.env.NOTION_TOKEN;
        if (!token) return res.status(400).json({ error: 'Missing NOTION_TOKEN' });
        const statusProp = req.body?.statusProp || 'Status';
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        };
        const updates = Array.isArray(req.body?.items) ? req.body.items : [];
        for (const u of updates) {
            const props = {};
            if (u.title) props.Title = { title: [{ text: { content: u.title } }] };
            if (u.due) props.Due = { date: { start: u.due } };
            if (u.status) props[statusProp] = { status: { name: u.status } };
            await fetch(`https://api.notion.com/v1/pages/${u.notionId}`, { method: 'PATCH', headers, body: JSON.stringify({ properties: props }) });
        }
        res.json({ updated: updates.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to sync to Notion', details: String(err) });
    }
});

// ===============================
// AGENTIC AI ENDPOINTS
// ===============================

// Get agent system status
app.get('/api/agents/status', async (req, res) => {
    try {
        const status = await agentRunner.getSystemStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get agent status', details: error.message });
    }
});

// Start the agent system
app.post('/api/agents/start', async (req, res) => {
    try {
        await agentRunner.start();
        res.json({ message: 'Agent system started successfully', status: 'running' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start agents', details: error.message });
    }
});

// Stop the agent system
app.post('/api/agents/stop', async (req, res) => {
    try {
        await agentRunner.stop();
        res.json({ message: 'Agent system stopped successfully', status: 'stopped' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to stop agents', details: error.message });
    }
});

// Trigger specific agent manually
app.post('/api/agents/trigger/:agentName', async (req, res) => {
    try {
        const { agentName } = req.params;
        const validAgents = ['collector', 'planner', 'executor', 'reviewer', 'fullWorkflow'];
        
        if (!validAgents.includes(agentName)) {
            return res.status(400).json({ 
                error: 'Invalid agent name', 
                validAgents 
            });
        }

        let result;
        switch (agentName) {
            case 'collector':
                result = await agentRunner.triggerCollection();
                break;
            case 'planner':
                result = await agentRunner.triggerPlanning();
                break;
            case 'executor':
                result = await agentRunner.triggerExecution();
                break;
            case 'reviewer':
                result = await agentRunner.triggerReview();
                break;
            case 'fullWorkflow':
                result = await agentRunner.triggerFullWorkflow();
                break;
        }

        res.json({ 
            message: `${agentName} agent triggered successfully`,
            result: result ? 'success' : 'failed',
            data: result
        });
    } catch (error) {
        res.status(500).json({ 
            error: `Failed to trigger ${req.params.agentName}`, 
            details: error.message 
        });
    }
});

// Get agent execution history
app.get('/api/agents/history/:agentName', async (req, res) => {
    try {
        const { agentName } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        
        const history = await agentRunner.agents[agentName]?.constructor.getAgentHistory?.(agentName, limit) || 
                       await database.getAgentHistory(agentName, limit);
        
        res.json({ agent: agentName, history });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to get agent history', 
            details: error.message 
        });
    }
});

// Get latest collected data
app.get('/api/agents/data/latest', async (req, res) => {
    try {
        const CollectorAgent = (await import('./agents/collector-agent.js')).default;
        const latestData = await CollectorAgent.getLatestData();
        res.json(latestData || { message: 'No data available' });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to get latest data', 
            details: error.message 
        });
    }
});

// Get latest plan
app.get('/api/agents/plan/latest', async (req, res) => {
    try {
        const PlannerAgent = (await import('./agents/planner-agent.js')).default;
        const latestPlan = await PlannerAgent.getLatestPlan();
        res.json(latestPlan || { message: 'No plan available' });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to get latest plan', 
            details: error.message 
        });
    }
});

// Get performance review
app.get('/api/agents/review/latest', async (req, res) => {
    try {
        const ReviewerAgent = (await import('./agents/reviewer-agent.js')).default;
        const latestReview = await ReviewerAgent.getLatestReview();
        res.json(latestReview || { message: 'No review available' });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to get latest review', 
            details: error.message 
        });
    }
});

// Store Google tokens for agents
app.post('/api/agents/auth/google', (req, res) => {
    try {
        if (req.session.googleTokens) {
            // Store tokens for agent use
            req.session.agentTokens = req.session.googleTokens;
            res.json({ message: 'Google tokens stored for agent use' });
        } else {
            res.status(401).json({ error: 'No Google tokens found in session' });
        }
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to store tokens', 
            details: error.message 
        });
    }
});

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Initialize and start the agent system
    console.log('\n🤖 Initializing Agentic AI System...');
    try {
        const initialized = await agentRunner.initialize();
        if (initialized) {
            // Auto-start agents if AGENT_AUTO_START is true
            if (process.env.AGENT_AUTO_START === 'true') {
                await agentRunner.start();
                console.log('🚀 Agentic AI System started automatically');
            } else {
                console.log('🤖 Agentic AI System ready (manual start required)');
            }
        }
    } catch (error) {
        console.error('❌ Failed to initialize Agentic AI System:', error);
    }
});


