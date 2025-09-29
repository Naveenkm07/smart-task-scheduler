import 'dotenv/config';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import database from './utils/database.js';

class CollectorAgent {
    constructor() {
        this.name = 'CollectorAgent';
        this.notion = new Client({ auth: process.env.NOTION_TOKEN });
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
    }

    async execute() {
        const startTime = Date.now();
        console.log(`[${this.name}] Starting data collection...`);

        try {
            await database.init();

            // Collect data from all sources in parallel
            const [calendarEvents, notionTasks, weatherData] = await Promise.all([
                this.collectCalendarEvents(),
                this.collectNotionTasks(),
                this.collectWeatherData()
            ]);

            const collectedData = {
                timestamp: new Date().toISOString(),
                calendarEvents,
                notionTasks,
                weatherData,
                metadata: {
                    eventsCount: calendarEvents.length,
                    tasksCount: notionTasks.length,
                    weatherCondition: weatherData?.weather?.[0]?.main || 'unknown'
                }
            };

            // Store structured data for other agents
            await database.setState('latest_collected_data', collectedData);
            await database.setState('last_collection_time', new Date().toISOString());

            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'success', collectedData.metadata, null, duration);

            console.log(`[${this.name}] Collection completed successfully in ${duration}ms`);
            return collectedData;

        } catch (error) {
            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'error', null, error.message, duration);
            console.error(`[${this.name}] Collection failed:`, error);
            throw error;
        }
    }

    async collectCalendarEvents() {
        try {
            // Get stored tokens (in a real implementation, you'd manage OAuth tokens properly)
            const tokens = await database.getState('google_tokens');
            if (!tokens) {
                console.warn('[CollectorAgent] No Google tokens available');
                return [];
            }

            this.oauth2Client.setCredentials(tokens);
            const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

            const now = new Date();
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999);

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                timeMax: endOfDay.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 50
            });

            const events = response.data.items || [];
            console.log(`[CollectorAgent] Collected ${events.length} calendar events`);
            return events;

        } catch (error) {
            console.error('[CollectorAgent] Calendar collection error:', error);
            return [];
        }
    }

    async collectNotionTasks() {
        try {
            if (!process.env.NOTION_TOKEN || !process.env.NOTION_TASK_DATABASE_ID) {
                console.warn('[CollectorAgent] Missing Notion configuration');
                return [];
            }

            const response = await this.notion.databases.query({
                database_id: process.env.NOTION_TASK_DATABASE_ID,
                filter: {
                    or: [
                        {
                            property: 'Status',
                            status: { equals: 'Todo' }
                        },
                        {
                            property: 'Status',
                            status: { equals: 'In progress' }
                        },
                        {
                            property: 'Status',
                            status: { equals: 'Today' }
                        }
                    ]
                },
                sorts: [
                    {
                        property: 'Due',
                        direction: 'ascending'
                    }
                ],
                page_size: 50
            });

            const tasks = response.results.map(page => this.formatNotionTask(page));
            console.log(`[CollectorAgent] Collected ${tasks.length} Notion tasks`);
            return tasks;

        } catch (error) {
            console.error('[CollectorAgent] Notion collection error:', error);
            return [];
        }
    }

    async collectWeatherData() {
        try {
            if (!process.env.OWM_API_KEY) {
                console.warn('[CollectorAgent] Missing weather API key');
                return null;
            }

            const city = process.env.OWM_DEFAULT_CITY || 'London,GB';
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${process.env.OWM_API_KEY}&units=metric`;
            
            const response = await fetch(url);
            const data = await response.json();

            if (response.ok) {
                console.log(`[CollectorAgent] Collected weather data for ${city}`);
                return data;
            } else {
                console.error('[CollectorAgent] Weather API error:', data);
                return null;
            }

        } catch (error) {
            console.error('[CollectorAgent] Weather collection error:', error);
            return null;
        }
    }

    formatNotionTask(page) {
        const properties = page.properties;
        
        return {
            id: page.id,
            title: properties.Title?.title?.[0]?.text?.content || 'Untitled Task',
            status: properties.Status?.status?.name || 'Todo',
            priority: properties.Priority?.select?.name || 'Medium',
            due: properties.Due?.date?.start || null,
            dueEnd: properties.Due?.date?.end || null,
            eventId: properties.EventId?.rich_text?.[0]?.text?.content || null,
            url: page.url,
            lastEdited: page.last_edited_time,
            created: page.created_time
        };
    }

    // Method to get the latest collected data
    static async getLatestData() {
        await database.init();
        return await database.getState('latest_collected_data');
    }

    // Method to check if data is fresh (within last 20 minutes)
    static async isDataFresh() {
        await database.init();
        const lastCollection = await database.getState('last_collection_time');
        if (!lastCollection) return false;

        const lastTime = new Date(lastCollection);
        const now = new Date();
        const diffMinutes = (now - lastTime) / (1000 * 60);
        
        return diffMinutes < 20; // Data is fresh if collected within 20 minutes
    }
}

export default CollectorAgent;
