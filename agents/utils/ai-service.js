import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

class AIService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }

    async generateTaskPlan(tasks, calendarEvents, weatherData, userPreferences = {}) {
        const prompt = this.buildPlanningPrompt(tasks, calendarEvents, weatherData, userPreferences);
        
        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            return this.parsePlanningResponse(text);
        } catch (error) {
            console.error('AI Planning Error:', error);
            throw new Error('Failed to generate AI plan');
        }
    }

    async analyzeConflict(conflictData) {
        const prompt = `
        Analyze this scheduling conflict and provide a resolution:
        
        Conflict Data: ${JSON.stringify(conflictData, null, 2)}
        
        Consider factors like:
        - Task priority levels
        - Weather conditions for outdoor tasks
        - User's typical productivity patterns
        - Time constraints and deadlines
        
        Provide a JSON response with:
        {
            "resolution": "move_task" | "reschedule_event" | "split_task",
            "newTime": "ISO datetime string",
            "reason": "explanation of the resolution",
            "confidence": 0.0-1.0
        }
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            return this.parseConflictResponse(text);
        } catch (error) {
            console.error('AI Conflict Analysis Error:', error);
            return null;
        }
    }

    async analyzeDailyPerformance(completedTasks, missedTasks, timeUsage) {
        const prompt = `
        Analyze daily task performance and suggest improvements:
        
        Completed Tasks: ${JSON.stringify(completedTasks)}
        Missed Tasks: ${JSON.stringify(missedTasks)}
        Time Usage: ${JSON.stringify(timeUsage)}
        
        Provide insights and recommendations in JSON format:
        {
            "efficiency_score": 0.0-1.0,
            "recommendations": ["suggestion1", "suggestion2"],
            "patterns": ["pattern1", "pattern2"],
            "optimizations": {
                "time_blocks": ["morning", "afternoon", "evening"],
                "task_types": ["focus", "routine", "creative"]
            }
        }
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            return this.parsePerformanceResponse(text);
        } catch (error) {
            console.error('AI Performance Analysis Error:', error);
            return null;
        }
    }

    buildPlanningPrompt(tasks, calendarEvents, weatherData, userPreferences) {
        return `
        You are an AI task planning assistant. Create an optimal daily schedule considering:
        
        TASKS TO SCHEDULE:
        ${JSON.stringify(tasks, null, 2)}
        
        EXISTING CALENDAR EVENTS:
        ${JSON.stringify(calendarEvents, null, 2)}
        
        WEATHER DATA:
        ${JSON.stringify(weatherData, null, 2)}
        
        USER PREFERENCES:
        ${JSON.stringify(userPreferences, null, 2)}
        
        RULES:
        1. High priority tasks should be scheduled during peak productivity hours (9-11 AM, 2-4 PM)
        2. Outdoor tasks should be avoided during rain/bad weather
        3. Buffer time (15-30 min) between tasks
        4. Respect existing calendar events
        5. Consider task dependencies and deadlines
        
        Provide a JSON response with:
        {
            "schedule": [
                {
                    "taskId": "task_id",
                    "title": "task title",
                    "startTime": "2024-01-01T09:00:00Z",
                    "endTime": "2024-01-01T10:00:00Z",
                    "priority": "high|medium|low",
                    "conflicts": ["conflict_description"],
                    "reason": "why scheduled at this time"
                }
            ],
            "conflicts_detected": [
                {
                    "type": "overlap|weather|resource",
                    "tasks": ["task1", "task2"],
                    "severity": "high|medium|low"
                }
            ],
            "recommendations": ["recommendation1", "recommendation2"]
        }
        `;
    }

    parsePlanningResponse(text) {
        try {
            // Extract JSON from the response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            // Fallback parsing if no JSON found
            return {
                schedule: [],
                conflicts_detected: [],
                recommendations: ["Failed to parse AI response"]
            };
        } catch (error) {
            console.error('Failed to parse AI planning response:', error);
            return {
                schedule: [],
                conflicts_detected: [],
                recommendations: ["Error parsing AI response"]
            };
        }
    }

    parseConflictResponse(text) {
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (error) {
            console.error('Failed to parse conflict response:', error);
            return null;
        }
    }

    parsePerformanceResponse(text) {
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (error) {
            console.error('Failed to parse performance response:', error);
            return null;
        }
    }
}

export default new AIService();
