import database from './utils/database.js';
import aiService from './utils/ai-service.js';
import ExecutorAgent from './executor-agent.js';
import { Client } from '@notionhq/client';
import { differenceInMinutes, parseISO, startOfDay, endOfDay } from 'date-fns';

class ReviewerAgent {
    constructor() {
        this.name = 'ReviewerAgent';
        this.notion = new Client({ auth: process.env.NOTION_TOKEN });
    }

    async execute() {
        const startTime = Date.now();
        console.log(`[${this.name}] Starting daily performance review...`);

        try {
            await database.init();

            // Analyze yesterday's performance
            const performanceData = await this.analyzeYesterdayPerformance();
            
            // Generate insights using AI
            const aiInsights = await aiService.analyzeDailyPerformance(
                performanceData.completedTasks,
                performanceData.missedTasks,
                performanceData.timeUsage
            );

            // Update learning patterns
            await this.updateLearningPatterns(performanceData, aiInsights);

            // Generate performance report
            const report = {
                timestamp: new Date().toISOString(),
                date: new Date().toDateString(),
                performance: performanceData,
                insights: aiInsights,
                learningUpdates: await this.getLearningUpdates()
            };

            // Store the report
            await database.setState('latest_review', report);
            await database.setState('last_review_time', new Date().toISOString());

            const duration = Date.now() - startTime;
            const metadata = {
                completedTasks: performanceData.completedTasks.length,
                missedTasks: performanceData.missedTasks.length,
                efficiencyScore: aiInsights?.efficiency_score || 0,
                newPatterns: report.learningUpdates.patterns.length
            };

            await database.logAgentExecution(this.name, 'success', metadata, null, duration);

            console.log(`[${this.name}] Review completed successfully in ${duration}ms`);
            console.log(`[${this.name}] Efficiency: ${(metadata.efficiencyScore * 100).toFixed(1)}%, Patterns: ${metadata.newPatterns}`);

            return report;

        } catch (error) {
            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'error', null, error.message, duration);
            console.error(`[${this.name}] Review failed:`, error);
            throw error;
        }
    }

    async analyzeYesterdayPerformance() {
        console.log(`[${this.name}] Analyzing yesterday's task performance...`);

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const startDate = startOfDay(yesterday).toISOString();
        const endDate = endOfDay(yesterday).toISOString();

        // Get completed tasks from Notion
        const completedTasks = await this.getCompletedTasks(startDate, endDate);
        const missedTasks = await this.getMissedTasks(startDate, endDate);
        const timeUsage = await this.analyzeTimeUsage(completedTasks);

        return {
            date: yesterday.toDateString(),
            completedTasks,
            missedTasks,
            timeUsage,
            metrics: {
                completionRate: completedTasks.length / (completedTasks.length + missedTasks.length) || 0,
                totalTasksPlanned: completedTasks.length + missedTasks.length,
                averageTaskDuration: timeUsage.averageDuration,
                productiveHours: timeUsage.productiveHours
            }
        };
    }

    async getCompletedTasks(startDate, endDate) {
        try {
            if (!process.env.NOTION_TOKEN || !process.env.NOTION_TASK_DATABASE_ID) {
                return [];
            }

            const response = await this.notion.databases.query({
                database_id: process.env.NOTION_TASK_DATABASE_ID,
                filter: {
                    and: [
                        {
                            property: 'Status',
                            status: { equals: 'Done' }
                        },
                        {
                            property: 'Due',
                            date: {
                                on_or_after: startDate,
                                on_or_before: endDate
                            }
                        }
                    ]
                }
            });

            return response.results.map(page => this.formatTaskForAnalysis(page));
        } catch (error) {
            console.error(`[${this.name}] Error fetching completed tasks:`, error);
            return [];
        }
    }

    async getMissedTasks(startDate, endDate) {
        try {
            if (!process.env.NOTION_TOKEN || !process.env.NOTION_TASK_DATABASE_ID) {
                return [];
            }

            const response = await this.notion.databases.query({
                database_id: process.env.NOTION_TASK_DATABASE_ID,
                filter: {
                    and: [
                        {
                            or: [
                                {
                                    property: 'Status',
                                    status: { equals: 'Todo' }
                                },
                                {
                                    property: 'Status',
                                    status: { equals: 'In progress' }
                                }
                            ]
                        },
                        {
                            property: 'Due',
                            date: {
                                before: endDate
                            }
                        }
                    ]
                }
            });

            return response.results.map(page => this.formatTaskForAnalysis(page));
        } catch (error) {
            console.error(`[${this.name}] Error fetching missed tasks:`, error);
            return [];
        }
    }

    formatTaskForAnalysis(page) {
        const properties = page.properties;
        
        return {
            id: page.id,
            title: properties.Title?.title?.[0]?.text?.content || 'Untitled',
            status: properties.Status?.status?.name || 'Unknown',
            priority: properties.Priority?.select?.name || 'Medium',
            due: properties.Due?.date?.start || null,
            dueEnd: properties.Due?.date?.end || null,
            lastEdited: page.last_edited_time,
            created: page.created_time
        };
    }

    analyzeTimeUsage(completedTasks) {
        const durations = [];
        const hourlyDistribution = Array(24).fill(0);
        
        completedTasks.forEach(task => {
            if (task.due && task.dueEnd) {
                const start = parseISO(task.due);
                const end = parseISO(task.dueEnd);
                const duration = differenceInMinutes(end, start);
                
                if (duration > 0 && duration < 480) { // Reasonable task duration (0-8 hours)
                    durations.push(duration);
                    hourlyDistribution[start.getHours()]++;
                }
            }
        });

        const averageDuration = durations.length > 0 ? 
            durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;

        // Find most productive hours (top 3)
        const productiveHours = hourlyDistribution
            .map((count, hour) => ({ hour, count }))
            .filter(h => h.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(h => `${h.hour}:00-${h.hour + 1}:00`);

        return {
            averageDuration,
            productiveHours,
            totalMinutesWorked: durations.reduce((sum, d) => sum + d, 0),
            taskCount: durations.length,
            hourlyDistribution
        };
    }

    async updateLearningPatterns(performanceData, aiInsights) {
        console.log(`[${this.name}] Updating learning patterns...`);

        // Update task completion patterns
        const currentPatterns = await database.getLearningData('task_patterns') || {};
        
        const updatedPatterns = {
            ...currentPatterns,
            productiveTimeSlots: this.updateProductiveTimeSlots(
                currentPatterns.productiveTimeSlots,
                performanceData.timeUsage.productiveHours
            ),
            taskCompletionRates: this.updateCompletionRates(
                currentPatterns.taskCompletionRates,
                performanceData
            ),
            priorityEffectiveness: this.updatePriorityEffectiveness(
                currentPatterns.priorityEffectiveness,
                performanceData
            )
        };

        await database.saveLearningData('task_patterns', updatedPatterns);

        // Update performance insights
        if (aiInsights) {
            const currentInsights = await database.getLearningData('performance_insights') || {};
            
            const updatedInsights = {
                ...currentInsights,
                lastEfficiencyScore: aiInsights.efficiency_score,
                recommendations: aiInsights.recommendations,
                patterns: aiInsights.patterns,
                optimizations: aiInsights.optimizations,
                lastUpdated: new Date().toISOString()
            };

            await database.saveLearningData('performance_insights', updatedInsights);
        }

        // Update user preferences based on learning
        await this.adaptUserPreferences(performanceData, aiInsights);
    }

    updateProductiveTimeSlots(current = [], newSlots) {
        // Combine and weight historical data with new observations
        const slotMap = new Map();
        
        // Add current slots with existing weight
        current.forEach(slot => {
            slotMap.set(slot.time || slot, { time: slot.time || slot, weight: slot.weight || 1 });
        });

        // Add new slots or increase weight of existing ones
        newSlots.forEach(slot => {
            if (slotMap.has(slot)) {
                slotMap.get(slot).weight++;
            } else {
                slotMap.set(slot, { time: slot, weight: 1 });
            }
        });

        // Return top 5 most productive slots
        return Array.from(slotMap.values())
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 5);
    }

    updateCompletionRates(current = {}, performanceData) {
        const { completedTasks, missedTasks } = performanceData;
        
        // Calculate completion rates by priority
        const priorityStats = {};
        
        [...completedTasks, ...missedTasks].forEach(task => {
            const priority = task.priority;
            if (!priorityStats[priority]) {
                priorityStats[priority] = { completed: 0, total: 0 };
            }
            priorityStats[priority].total++;
            if (completedTasks.includes(task)) {
                priorityStats[priority].completed++;
            }
        });

        // Update running averages
        const updated = { ...current };
        Object.keys(priorityStats).forEach(priority => {
            const stats = priorityStats[priority];
            const newRate = stats.completed / stats.total;
            
            if (updated[priority]) {
                // Weighted average with previous data
                updated[priority] = (updated[priority] * 0.7) + (newRate * 0.3);
            } else {
                updated[priority] = newRate;
            }
        });

        return updated;
    }

    updatePriorityEffectiveness(current = {}, performanceData) {
        // Analyze how well different priorities are being handled
        const effectiveness = { ...current };
        
        performanceData.completedTasks.forEach(task => {
            const priority = task.priority;
            if (!effectiveness[priority]) {
                effectiveness[priority] = { completionRate: 0, avgDelay: 0, count: 0 };
            }
            
            effectiveness[priority].count++;
            effectiveness[priority].completionRate = 
                (effectiveness[priority].completionRate * (effectiveness[priority].count - 1) + 1) / 
                effectiveness[priority].count;
        });

        return effectiveness;
    }

    async adaptUserPreferences(performanceData, aiInsights) {
        const currentPrefs = await database.getLearningData('user_preferences') || {};
        
        const adaptations = {};
        
        // Adapt peak productivity hours based on actual performance
        if (performanceData.timeUsage.productiveHours.length > 0) {
            adaptations.peakProductivityHours = performanceData.timeUsage.productiveHours;
        }

        // Adapt task duration preferences
        if (performanceData.timeUsage.averageDuration > 0) {
            adaptations.preferredTaskDuration = Math.round(performanceData.timeUsage.averageDuration);
        }

        // Adapt max daily tasks based on completion rate
        if (performanceData.metrics.completionRate < 0.7 && currentPrefs.maxDailyTasks > 3) {
            adaptations.maxDailyTasks = Math.max(3, currentPrefs.maxDailyTasks - 1);
        } else if (performanceData.metrics.completionRate > 0.9 && currentPrefs.maxDailyTasks < 12) {
            adaptations.maxDailyTasks = Math.min(12, (currentPrefs.maxDailyTasks || 8) + 1);
        }

        if (Object.keys(adaptations).length > 0) {
            await database.saveLearningData('user_preferences', {
                ...currentPrefs,
                ...adaptations,
                lastAdapted: new Date().toISOString()
            });

            console.log(`[${this.name}] Adapted preferences:`, adaptations);
        }
    }

    async getLearningUpdates() {
        return {
            patterns: await database.getLearningData('task_patterns') || {},
            insights: await database.getLearningData('performance_insights') || {},
            preferences: await database.getLearningData('user_preferences') || {}
        };
    }

    // Static method to get the latest review
    static async getLatestReview() {
        await database.init();
        return await database.getState('latest_review');
    }
}

export default ReviewerAgent;
