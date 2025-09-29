import database from './utils/database.js';
import aiService from './utils/ai-service.js';
import CollectorAgent from './collector-agent.js';
import { addHours, parseISO, format, isAfter, isBefore } from 'date-fns';

class PlannerAgent {
    constructor() {
        this.name = 'PlannerAgent';
        this.conflictThreshold = 0.7; // AI confidence threshold for conflict resolution
    }

    async execute() {
        const startTime = Date.now();
        console.log(`[${this.name}] Starting intelligent planning...`);

        try {
            await database.init();

            // Get latest collected data
            const latestData = await CollectorAgent.getLatestData();
            if (!latestData) {
                throw new Error('No data available from CollectorAgent');
            }

            // Get user preferences and learning data
            const userPreferences = await this.getUserPreferences();
            const learningData = await this.getLearningData();

            // Generate AI-powered plan
            const aiPlan = await aiService.generateTaskPlan(
                latestData.notionTasks,
                latestData.calendarEvents,
                latestData.weatherData,
                { ...userPreferences, ...learningData }
            );

            // Analyze and resolve conflicts
            const resolvedPlan = await this.resolveConflicts(aiPlan, latestData);

            // Optimize plan based on learning data
            const optimizedPlan = await this.optimizePlan(resolvedPlan, learningData);

            const finalPlan = {
                timestamp: new Date().toISOString(),
                schedule: optimizedPlan.schedule,
                conflicts: resolvedPlan.conflicts,
                optimizations: optimizedPlan.optimizations,
                recommendations: aiPlan.recommendations || [],
                metadata: {
                    tasksScheduled: optimizedPlan.schedule.length,
                    conflictsResolved: resolvedPlan.conflicts.length,
                    planningConfidence: this.calculatePlanConfidence(optimizedPlan)
                }
            };

            // Store the plan for ExecutorAgent
            await database.setState('latest_plan', finalPlan);
            await database.setState('last_planning_time', new Date().toISOString());

            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'success', finalPlan.metadata, null, duration);

            console.log(`[${this.name}] Planning completed successfully in ${duration}ms`);
            console.log(`[${this.name}] Scheduled ${finalPlan.metadata.tasksScheduled} tasks, resolved ${finalPlan.metadata.conflictsResolved} conflicts`);

            return finalPlan;

        } catch (error) {
            const duration = Date.now() - startTime;
            await database.logAgentExecution(this.name, 'error', null, error.message, duration);
            console.error(`[${this.name}] Planning failed:`, error);
            throw error;
        }
    }

    async getUserPreferences() {
        // Get stored user preferences with sensible defaults
        const stored = await database.getLearningData('user_preferences') || {};
        
        return {
            workingHours: {
                start: '09:00',
                end: '18:00'
            },
            peakProductivityHours: ['09:00-11:00', '14:00-16:00'],
            minimumBreakTime: 15, // minutes
            preferredTaskDuration: 60, // minutes
            avoidWeatherConditions: ['rain', 'storm'],
            maxDailyTasks: 8,
            priorityWeights: {
                'High': 3,
                'Medium': 2,
                'Low': 1
            },
            ...stored
        };
    }

    async getLearningData() {
        const patterns = await database.getLearningData('task_patterns') || {};
        const performance = await database.getLearningData('performance_insights') || {};
        
        return {
            patterns,
            performance,
            adaptations: await database.getLearningData('adaptations') || {}
        };
    }

    async resolveConflicts(aiPlan, latestData) {
        const conflicts = aiPlan.conflicts_detected || [];
        const resolvedConflicts = [];
        let updatedSchedule = [...aiPlan.schedule];

        for (const conflict of conflicts) {
            console.log(`[${this.name}] Resolving conflict: ${conflict.type}`);
            
            const resolution = await aiService.analyzeConflict({
                conflict,
                schedule: updatedSchedule,
                calendarEvents: latestData.calendarEvents,
                weatherData: latestData.weatherData
            });

            if (resolution && resolution.confidence > this.conflictThreshold) {
                // Apply the resolution
                updatedSchedule = this.applyConflictResolution(updatedSchedule, resolution);
                
                // Log the resolution
                await database.saveConflictResolution(
                    conflict.tasks?.join(',') || 'unknown',
                    conflict.type,
                    JSON.stringify(conflict),
                    resolution.newTime,
                    resolution.reason
                );

                resolvedConflicts.push({
                    originalConflict: conflict,
                    resolution,
                    applied: true
                });

                console.log(`[${this.name}] Conflict resolved: ${resolution.reason}`);
            } else {
                console.warn(`[${this.name}] Could not resolve conflict with sufficient confidence`);
                resolvedConflicts.push({
                    originalConflict: conflict,
                    resolution: null,
                    applied: false
                });
            }
        }

        return {
            schedule: updatedSchedule,
            conflicts: resolvedConflicts
        };
    }

    applyConflictResolution(schedule, resolution) {
        const updatedSchedule = [...schedule];
        
        switch (resolution.resolution) {
            case 'move_task':
                // Find and move the task to new time
                const taskIndex = updatedSchedule.findIndex(task => 
                    task.startTime === resolution.originalTime
                );
                if (taskIndex !== -1) {
                    const task = updatedSchedule[taskIndex];
                    const originalDuration = new Date(task.endTime) - new Date(task.startTime);
                    
                    task.startTime = resolution.newTime;
                    task.endTime = new Date(new Date(resolution.newTime).getTime() + originalDuration).toISOString();
                    task.reason = `Moved due to conflict: ${resolution.reason}`;
                }
                break;

            case 'split_task':
                // Implementation for splitting tasks
                // This would require more complex logic
                break;

            case 'reschedule_event':
                // Mark for executor to reschedule calendar event
                break;
        }

        return updatedSchedule;
    }

    async optimizePlan(resolvedPlan, learningData) {
        const optimizations = [];
        let optimizedSchedule = [...resolvedPlan.schedule];

        // Apply learning-based optimizations
        if (learningData.patterns.productiveTimeSlots) {
            optimizedSchedule = this.optimizeForProductiveTimeSlots(
                optimizedSchedule, 
                learningData.patterns.productiveTimeSlots
            );
            optimizations.push('Applied productive time slot optimization');
        }

        // Optimize task ordering based on historical performance
        if (learningData.performance.taskTypeEfficiency) {
            optimizedSchedule = this.optimizeTaskOrdering(
                optimizedSchedule,
                learningData.performance.taskTypeEfficiency
            );
            optimizations.push('Optimized task ordering based on efficiency patterns');
        }

        // Add buffer time between tasks
        optimizedSchedule = this.addBufferTime(optimizedSchedule);
        optimizations.push('Added buffer time between tasks');

        return {
            schedule: optimizedSchedule,
            optimizations
        };
    }

    optimizeForProductiveTimeSlots(schedule, productiveSlots) {
        // Sort tasks by priority and move high-priority tasks to productive slots
        const sortedTasks = [...schedule].sort((a, b) => {
            const priorityWeight = { 'High': 3, 'Medium': 2, 'Low': 1 };
            return (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
        });

        // Reassign time slots starting with most productive times for high-priority tasks
        return sortedTasks.map((task, index) => {
            if (task.priority === 'High' && productiveSlots.length > 0) {
                const productiveSlot = productiveSlots[index % productiveSlots.length];
                return {
                    ...task,
                    startTime: productiveSlot.start,
                    endTime: productiveSlot.end,
                    reason: `Scheduled during productive time slot: ${task.reason || ''}`
                };
            }
            return task;
        });
    }

    optimizeTaskOrdering(schedule, efficiencyData) {
        // Reorder tasks based on when they're typically completed most efficiently
        return schedule.sort((a, b) => {
            const aEfficiency = efficiencyData[a.title] || efficiencyData.default || 0.5;
            const bEfficiency = efficiencyData[b.title] || efficiencyData.default || 0.5;
            return bEfficiency - aEfficiency; // Higher efficiency first
        });
    }

    addBufferTime(schedule) {
        const bufferedSchedule = [];
        const bufferMinutes = 15;

        for (let i = 0; i < schedule.length; i++) {
            const task = { ...schedule[i] };
            
            if (i > 0) {
                // Add buffer time after previous task
                const prevTask = bufferedSchedule[i - 1];
                const prevEndTime = new Date(prevTask.endTime);
                const bufferEndTime = addHours(prevEndTime, bufferMinutes / 60);
                
                // Adjust current task start time if needed
                const currentStartTime = new Date(task.startTime);
                if (isBefore(currentStartTime, bufferEndTime)) {
                    const duration = new Date(task.endTime) - new Date(task.startTime);
                    task.startTime = bufferEndTime.toISOString();
                    task.endTime = new Date(bufferEndTime.getTime() + duration).toISOString();
                }
            }
            
            bufferedSchedule.push(task);
        }

        return bufferedSchedule;
    }

    calculatePlanConfidence(plan) {
        // Calculate overall confidence based on various factors
        let confidence = 0.8; // Base confidence

        // Reduce confidence for each unresolved conflict
        const unresolvedConflicts = plan.conflicts?.filter(c => !c.applied).length || 0;
        confidence -= unresolvedConflicts * 0.1;

        // Increase confidence for successful optimizations
        const optimizationCount = plan.optimizations?.length || 0;
        confidence += optimizationCount * 0.05;

        return Math.max(0.0, Math.min(1.0, confidence));
    }

    // Static method to get the latest plan
    static async getLatestPlan() {
        await database.init();
        return await database.getState('latest_plan');
    }

    // Check if plan is fresh (within last 2 hours)
    static async isPlanFresh() {
        await database.init();
        const lastPlanning = await database.getState('last_planning_time');
        if (!lastPlanning) return false;

        const lastTime = new Date(lastPlanning);
        const now = new Date();
        const diffHours = (now - lastTime) / (1000 * 60 * 60);
        
        return diffHours < 2;
    }
}

export default PlannerAgent;
