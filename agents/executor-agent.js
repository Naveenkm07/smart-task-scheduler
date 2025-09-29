import database from './utils/database.js';
import PlannerAgent from './planner-agent.js';
import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';
import 'dotenv/config';

class ExecutorAgent {
    constructor() {
        this.name = 'ExecutorAgent';
        this.notion = new Client({ auth: process.env.NOTION_TOKEN });
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        
        // Initialize Telegram bot if token is provided
        this.telegramBot = process.env.TELEGRAM_BOT_TOKEN ? 
            new Telegraf(process.env.TELEGRAM_BOT_TOKEN) : null;
    }

    async execute() {
        const startTime = Date.now();
        console.log(`[${this.name}] Starting plan execution...`);

        try {
            await database.init();

            // Get the latest plan from PlannerAgent
            const latestPlan = await PlannerAgent.getLatestPlan();
            if (!latestPlan) {
                throw new Error('No plan available from PlannerAgent');
            }

            const executionResults = {
                timestamp: new Date().toISOString(),
                planExecuted: latestPlan.timestamp,
                results: {
                    calendarUpdates: [],
                    notionUpdates: [],
                    notifications: [],
                    errors: []
                }
            };

            // Execute plan in parallel where possible
            const [calendarResults, notionResults, notificationResults] = await Promise.all([
                this.executeCalendarUpdates(latestPlan),
                this.executeNotionUpdates(latestPlan),
                this.sendNotifications(latestPlan)
            ]);

            executionResults.results.calendarUpdates = calendarResults;
            executionResults.results.notionUpdates = notionResults;
            executionResults.results.notifications = notificationResults;

            // Store execution results
            await database.setState('latest_execution', executionResults);
            await database.setState('last_execution_time', new Date().toISOString());

            const duration = Date.now() - startTime;
            const metadata = {
                calendarUpdates: calendarResults.length,
                notionUpdates: notionResults.length,
                notifications: notificationResults.length,
                totalErrors: executionResults.results.errors.length
            };

            await database.logAgentExecution(this.name, 'success', metadata, null, duration);

            console.log(`[${this.name}] Execution completed successfully in ${duration}ms`);
            console.log(`[${this.name}] Calendar: ${metadata.calendarUpdates}, Notion: ${metadata.notionUpdates}, Notifications: ${metadata.notifications}`);

            return executionResults;

        } catch (error) {
            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'error', null, error.message, duration);
            console.error(`[${this.name}] Execution failed:`, error);
            throw error;
        }
    }

    async executeCalendarUpdates(plan) {
        const results = [];
        console.log(`[${this.name}] Executing calendar updates...`);

        try {
            // Get stored tokens
            const tokens = await database.getState('google_tokens');
            if (!tokens) {
                console.warn('[ExecutorAgent] No Google tokens available for calendar updates');
                return results;
            }

            this.oauth2Client.setCredentials(tokens);
            const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

            // Process scheduled tasks
            for (const task of plan.schedule) {
                try {
                    const eventData = {
                        summary: task.title,
                        start: {
                            dateTime: task.startTime,
                            timeZone: 'UTC'
                        },
                        end: {
                            dateTime: task.endTime,
                            timeZone: 'UTC'
                        },
                        description: `AI-scheduled task | Priority: ${task.priority} | ${task.reason || ''}`,
                        extendedProperties: {
                            private: {
                                notionId: task.taskId,
                                agentScheduled: 'true',
                                planTimestamp: plan.timestamp
                            }
                        }
                    };

                    let result;
                    if (task.eventId) {
                        // Update existing event
                        try {
                            const response = await calendar.events.update({
                                calendarId: 'primary',
                                eventId: task.eventId,
                                requestBody: eventData
                            });
                            result = { action: 'updated', event: response.data, task: task.title };
                        } catch (updateError) {
                            // If update fails, create new event
                            const response = await calendar.events.insert({
                                calendarId: 'primary',
                                requestBody: eventData
                            });
                            result = { action: 'created', event: response.data, task: task.title };
                        }
                    } else {
                        // Create new event
                        const response = await calendar.events.insert({
                            calendarId: 'primary',
                            requestBody: eventData
                        });
                        result = { action: 'created', event: response.data, task: task.title };

                        // Update Notion with the new event ID
                        if (task.taskId) {
                            await this.updateNotionEventId(task.taskId, response.data.id);
                        }
                    }

                    results.push(result);
                    console.log(`[${this.name}] Calendar ${result.action}: ${task.title}`);

                } catch (error) {
                    console.error(`[${this.name}] Failed to process calendar task ${task.title}:`, error);
                    results.push({ action: 'failed', task: task.title, error: error.message });
                }
            }

        } catch (error) {
            console.error(`[${this.name}] Calendar execution error:`, error);
        }

        return results;
    }

    async executeNotionUpdates(plan) {
        const results = [];
        console.log(`[${this.name}] Executing Notion updates...`);

        try {
            if (!process.env.NOTION_TOKEN) {
                console.warn('[ExecutorAgent] No Notion token available');
                return results;
            }

            // Update task statuses to "Scheduled" for successfully planned tasks
            for (const task of plan.schedule) {
                try {
                    if (task.taskId) {
                        const response = await this.notion.pages.update({
                            page_id: task.taskId,
                            properties: {
                                Status: {
                                    status: {
                                        name: 'Scheduled'
                                    }
                                },
                                Due: {
                                    date: {
                                        start: task.startTime,
                                        end: task.endTime
                                    }
                                }
                            }
                        });

                        results.push({
                            action: 'updated',
                            taskId: task.taskId,
                            title: task.title,
                            status: 'Scheduled'
                        });

                        console.log(`[${this.name}] Notion updated: ${task.title} -> Scheduled`);
                    }
                } catch (error) {
                    console.error(`[${this.name}] Failed to update Notion task ${task.title}:`, error);
                    results.push({
                        action: 'failed',
                        taskId: task.taskId,
                        title: task.title,
                        error: error.message
                    });
                }
            }

        } catch (error) {
            console.error(`[${this.name}] Notion execution error:`, error);
        }

        return results;
    }

    async sendNotifications(plan) {
        const results = [];
        console.log(`[${this.name}] Sending notifications...`);

        try {
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            if (!this.telegramBot || !chatId) {
                console.warn('[ExecutorAgent] Telegram bot not configured');
                return results;
            }

            // Prepare plan summary
            const summary = this.generatePlanSummary(plan);
            
            // Send plan summary
            await this.telegramBot.telegram.sendMessage(chatId, summary, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

            results.push({
                type: 'plan_summary',
                recipient: 'telegram',
                sent: true
            });

            // Send urgent task notifications
            const urgentTasks = plan.schedule.filter(task => 
                task.priority === 'High' || 
                (new Date(task.startTime) - new Date()) < 60 * 60 * 1000 // Within 1 hour
            );

            for (const task of urgentTasks) {
                const message = `🚨 *Urgent Task Scheduled*\n\n` +
                              `**${task.title}**\n` +
                              `⏰ ${new Date(task.startTime).toLocaleString()}\n` +
                              `🔥 Priority: ${task.priority}\n` +
                              `📝 ${task.reason || 'AI scheduled'}`;

                await this.telegramBot.telegram.sendMessage(chatId, message, {
                    parse_mode: 'Markdown'
                });

                results.push({
                    type: 'urgent_task',
                    task: task.title,
                    recipient: 'telegram',
                    sent: true
                });
            }

            // Send conflict alerts if any
            if (plan.conflicts && plan.conflicts.length > 0) {
                const conflictMessage = `⚠️ *Scheduling Conflicts Detected*\n\n` +
                                      plan.conflicts.map(c => 
                                          `• ${c.originalConflict.type}: ${c.applied ? '✅ Resolved' : '❌ Unresolved'}`
                                      ).join('\n');

                await this.telegramBot.telegram.sendMessage(chatId, conflictMessage, {
                    parse_mode: 'Markdown'
                });

                results.push({
                    type: 'conflict_alert',
                    conflicts: plan.conflicts.length,
                    recipient: 'telegram',
                    sent: true
                });
            }

        } catch (error) {
            console.error(`[${this.name}] Notification error:`, error);
            results.push({
                type: 'error',
                error: error.message,
                sent: false
            });
        }

        return results;
    }

    generatePlanSummary(plan) {
        const scheduledCount = plan.schedule.length;
        const conflictsCount = plan.conflicts?.length || 0;
        const confidence = (plan.metadata.planningConfidence * 100).toFixed(0);

        let summary = `🤖 *AI Task Plan Generated*\n\n`;
        summary += `📅 **${new Date().toLocaleDateString()}**\n`;
        summary += `✅ Tasks Scheduled: ${scheduledCount}\n`;
        summary += `⚠️ Conflicts: ${conflictsCount}\n`;
        summary += `🎯 Confidence: ${confidence}%\n\n`;

        if (plan.schedule.length > 0) {
            summary += `**Today's Schedule:**\n`;
            plan.schedule.slice(0, 5).forEach(task => {
                const time = new Date(task.startTime).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                summary += `• ${time} - ${task.title} (${task.priority})\n`;
            });

            if (plan.schedule.length > 5) {
                summary += `... and ${plan.schedule.length - 5} more tasks\n`;
            }
        }

        if (plan.recommendations && plan.recommendations.length > 0) {
            summary += `\n**AI Recommendations:**\n`;
            plan.recommendations.slice(0, 3).forEach(rec => {
                summary += `💡 ${rec}\n`;
            });
        }

        return summary;
    }

    async updateNotionEventId(taskId, eventId) {
        try {
            await this.notion.pages.update({
                page_id: taskId,
                properties: {
                    EventId: {
                        rich_text: [
                            {
                                text: {
                                    content: eventId
                                }
                            }
                        ]
                    }
                }
            });
        } catch (error) {
            console.error(`[${this.name}] Failed to update Notion EventId:`, error);
        }
    }

    // Static method to get the latest execution results
    static async getLatestExecution() {
        await database.init();
        return await database.getState('latest_execution');
    }
}

export default ExecutorAgent;
