import 'dotenv/config';
import cron from 'node-cron';
import CollectorAgent from './collector-agent.js';
import PlannerAgent from './planner-agent.js';
import ExecutorAgent from './executor-agent.js';
import ReviewerAgent from './reviewer-agent.js';
import database from './utils/database.js';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AgentRunner {
    constructor() {
        this.agents = {
            collector: new CollectorAgent(),
            planner: new PlannerAgent(),
            executor: new ExecutorAgent(),
            reviewer: new ReviewerAgent()
        };
        
        this.isRunning = false;
        this.jobs = new Map();
        this.metrics = {
            totalRuns: 0,
            successfulRuns: 0,
            errors: 0,
            lastRun: null
        };
    }

    async initialize() {
        console.log('🚀 Initializing Agentic AI Task Scheduler...');
        
        try {
            // Ensure data directory exists
            const dataDir = path.join(__dirname, '../data');
            mkdirSync(dataDir, { recursive: true });
            
            // Initialize database
            await database.init();
            console.log('✅ Database initialized');

            // Initialize metrics
            await this.loadMetrics();
            console.log('✅ Metrics loaded');

            console.log('🎯 Agentic AI System ready for autonomous operation');
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    async start() {
        if (this.isRunning) {
            console.log('⚠️ Agent system is already running');
            return;
        }

        console.log('🔄 Starting autonomous agent system...');
        this.isRunning = true;

        // Schedule Collector Agent - every 15 minutes
        this.jobs.set('collector', cron.schedule('*/15 * * * *', async () => {
            await this.runAgent('collector', false);
        }, { scheduled: false }));

        // Schedule Planner Agent - every 30 minutes during work hours (9 AM - 6 PM)
        this.jobs.set('planner', cron.schedule('*/30 9-18 * * 1-5', async () => {
            await this.runAgent('planner', false);
        }, { scheduled: false }));

        // Schedule Executor Agent - every 2 hours during work hours
        this.jobs.set('executor', cron.schedule('0 */2 9-18 * * 1-5', async () => {
            await this.runAgent('executor', false);
        }, { scheduled: false }));

        // Schedule Reviewer Agent - daily at 10 PM
        this.jobs.set('reviewer', cron.schedule('0 22 * * *', async () => {
            await this.runAgent('reviewer', false);
        }, { scheduled: false }));

        // Schedule full workflow - every 4 hours during work days
        this.jobs.set('fullWorkflow', cron.schedule('0 */4 9-18 * * 1-5', async () => {
            await this.runFullWorkflow();
        }, { scheduled: false }));

        // Start all scheduled jobs
        this.jobs.forEach((job, name) => {
            job.start();
            console.log(`✅ Scheduled ${name} agent`);
        });

        // Run initial collection and planning
        setTimeout(() => this.runInitialWorkflow(), 5000);

        console.log('🎯 Autonomous agent system is now running');
        this.logSystemStatus();
    }

    async stop() {
        console.log('🛑 Stopping agent system...');
        
        this.jobs.forEach((job, name) => {
            job.stop();
            console.log(`⏹️ Stopped ${name} agent`);
        });
        
        this.jobs.clear();
        this.isRunning = false;
        
        await this.saveMetrics();
        console.log('✅ Agent system stopped gracefully');
    }

    async runAgent(agentName, standalone = true) {
        const agent = this.agents[agentName];
        if (!agent) {
            console.error(`❌ Unknown agent: ${agentName}`);
            return null;
        }

        const startTime = Date.now();
        console.log(`\n🤖 Running ${agentName.toUpperCase()} Agent...`);

        try {
            this.metrics.totalRuns++;
            
            const result = await agent.execute();
            
            this.metrics.successfulRuns++;
            this.metrics.lastRun = new Date().toISOString();
            
            const duration = Date.now() - startTime;
            console.log(`✅ ${agentName.toUpperCase()} completed in ${duration}ms`);
            
            if (standalone) {
                await this.saveMetrics();
            }
            
            return result;
            
        } catch (error) {
            this.metrics.errors++;
            const duration = Date.now() - startTime;
            
            console.error(`❌ ${agentName.toUpperCase()} failed after ${duration}ms:`, error.message);
            
            // Log critical errors
            await database.logAgentExecution(
                `${agentName.toUpperCase()}_RUNNER`, 
                'critical_error', 
                null, 
                error.message, 
                duration
            );
            
            if (standalone) {
                await this.saveMetrics();
            }
            
            return null;
        }
    }

    async runFullWorkflow() {
        console.log('\n🔄 Starting FULL AGENTIC WORKFLOW...');
        const workflowStart = Date.now();

        try {
            // Step 1: Collect data
            console.log('📊 Phase 1: Data Collection');
            const collectionResult = await this.runAgent('collector', false);
            if (!collectionResult) {
                throw new Error('Data collection failed');
            }

            // Wait a moment for data to be processed
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 2: Plan with AI
            console.log('🧠 Phase 2: AI Planning');
            const planningResult = await this.runAgent('planner', false);
            if (!planningResult) {
                throw new Error('AI planning failed');
            }

            // Wait for planning to be stored
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 3: Execute the plan
            console.log('⚡ Phase 3: Plan Execution');
            const executionResult = await this.runAgent('executor', false);
            if (!executionResult) {
                console.warn('⚠️ Plan execution had issues, but continuing...');
            }

            const workflowDuration = Date.now() - workflowStart;
            console.log(`\n🎉 FULL WORKFLOW COMPLETED in ${workflowDuration}ms`);
            console.log('📈 Summary:');
            console.log(`   • Tasks collected: ${collectionResult.metadata.tasksCount}`);
            console.log(`   • Events found: ${collectionResult.metadata.eventsCount}`);
            console.log(`   • Tasks scheduled: ${planningResult.metadata.tasksScheduled}`);
            console.log(`   • Conflicts resolved: ${planningResult.metadata.conflictsResolved}`);
            
            if (executionResult) {
                console.log(`   • Calendar updates: ${executionResult.results.calendarUpdates.length}`);
                console.log(`   • Notion updates: ${executionResult.results.notionUpdates.length}`);
                console.log(`   • Notifications sent: ${executionResult.results.notifications.length}`);
            }

            // Log successful workflow
            await database.logAgentExecution(
                'FULL_WORKFLOW', 
                'success', 
                {
                    duration: workflowDuration,
                    phases: ['collection', 'planning', 'execution'],
                    results: {
                        collection: collectionResult.metadata,
                        planning: planningResult.metadata,
                        execution: executionResult?.results || null
                    }
                }, 
                null, 
                workflowDuration
            );

        } catch (error) {
            const workflowDuration = Date.now() - workflowStart;
            console.error(`❌ FULL WORKFLOW FAILED after ${workflowDuration}ms:`, error.message);
            
            await database.logAgentExecution(
                'FULL_WORKFLOW', 
                'failed', 
                null, 
                error.message, 
                workflowDuration
            );
        }

        await this.saveMetrics();
    }

    async runInitialWorkflow() {
        console.log('🚀 Running initial workflow to bootstrap the system...');
        
        // Check if we have fresh data
        const hasData = await CollectorAgent.isDataFresh();
        const hasPlan = await PlannerAgent.isPlanFresh();

        if (!hasData) {
            console.log('📊 No fresh data found, collecting...');
            await this.runAgent('collector', false);
        }

        if (!hasPlan) {
            console.log('🧠 No fresh plan found, planning...');
            await this.runAgent('planner', false);
        }

        console.log('✅ Initial workflow completed');
    }

    async getSystemStatus() {
        const status = {
            isRunning: this.isRunning,
            metrics: this.metrics,
            agents: {},
            jobs: Array.from(this.jobs.keys()),
            database: await database.getState('system_health') || 'unknown'
        };

        // Get last execution time for each agent
        for (const agentName of Object.keys(this.agents)) {
            const history = await database.getAgentHistory(agentName, 1);
            status.agents[agentName] = {
                lastRun: history[0]?.execution_time || null,
                lastStatus: history[0]?.status || 'never_run'
            };
        }

        return status;
    }

    async loadMetrics() {
        const stored = await database.getState('runner_metrics');
        if (stored) {
            this.metrics = { ...this.metrics, ...stored };
        }
    }

    async saveMetrics() {
        await database.setState('runner_metrics', this.metrics);
        await database.setState('system_health', {
            timestamp: new Date().toISOString(),
            isRunning: this.isRunning,
            activeJobs: this.jobs.size,
            metrics: this.metrics
        });
    }

    logSystemStatus() {
        console.log('\n📊 SYSTEM STATUS:');
        console.log(`   Running: ${this.isRunning ? '✅' : '❌'}`);
        console.log(`   Active Jobs: ${this.jobs.size}`);
        console.log(`   Total Runs: ${this.metrics.totalRuns}`);
        console.log(`   Success Rate: ${this.metrics.totalRuns > 0 ? 
            ((this.metrics.successfulRuns / this.metrics.totalRuns) * 100).toFixed(1) : 0}%`);
        console.log(`   Last Run: ${this.metrics.lastRun || 'Never'}`);
        console.log('\n🤖 Agents will run automatically according to schedule');
        console.log('   • Collector: Every 15 minutes');
        console.log('   • Planner: Every 30 minutes (work hours)');
        console.log('   • Executor: Every 2 hours (work hours)');
        console.log('   • Reviewer: Daily at 10 PM');
        console.log('   • Full Workflow: Every 4 hours (work days)');
    }

    // Manual trigger methods for testing/debugging
    async triggerCollection() { return await this.runAgent('collector'); }
    async triggerPlanning() { return await this.runAgent('planner'); }
    async triggerExecution() { return await this.runAgent('executor'); }
    async triggerReview() { return await this.runAgent('reviewer'); }
    async triggerFullWorkflow() { return await this.runFullWorkflow(); }
}

// Create singleton instance
const agentRunner = new AgentRunner();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received shutdown signal...');
    await agentRunner.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received termination signal...');
    await agentRunner.stop();
    process.exit(0);
});

// Auto-start if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    (async () => {
        const initialized = await agentRunner.initialize();
        if (initialized) {
            await agentRunner.start();
            
            // Keep the process running
            setInterval(() => {
                // Heartbeat every 5 minutes
                console.log(`💓 System heartbeat - ${new Date().toISOString()}`);
            }, 5 * 60 * 1000);
        } else {
            console.error('❌ Failed to initialize. Exiting...');
            process.exit(1);
        }
    })();
}

export default agentRunner;
