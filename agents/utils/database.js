import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AgentDatabase {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;
        
        this.db = await open({
            filename: path.join(__dirname, '../../data/agents.db'),
            driver: sqlite3.Database
        });

        await this.createTables();
        return this.db;
    }

    async createTables() {
        // Agent execution logs
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_name TEXT NOT NULL,
                execution_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT NOT NULL,
                data TEXT,
                error_message TEXT,
                duration_ms INTEGER
            )
        `);

        // Task conflicts and resolutions
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS conflict_resolutions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                conflict_type TEXT NOT NULL,
                original_time TEXT,
                resolved_time TEXT,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Agent learning data
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS learning_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // System state
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                state_key TEXT UNIQUE NOT NULL,
                state_value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    async logAgentExecution(agentName, status, data = null, errorMessage = null, durationMs = 0) {
        await this.db.run(
            'INSERT INTO agent_logs (agent_name, status, data, error_message, duration_ms) VALUES (?, ?, ?, ?, ?)',
            [agentName, status, JSON.stringify(data), errorMessage, durationMs]
        );
    }

    async getAgentHistory(agentName, limit = 50) {
        return await this.db.all(
            'SELECT * FROM agent_logs WHERE agent_name = ? ORDER BY execution_time DESC LIMIT ?',
            [agentName, limit]
        );
    }

    async saveConflictResolution(taskId, conflictType, originalTime, resolvedTime, reason) {
        await this.db.run(
            'INSERT INTO conflict_resolutions (task_id, conflict_type, original_time, resolved_time, reason) VALUES (?, ?, ?, ?, ?)',
            [taskId, conflictType, originalTime, resolvedTime, reason]
        );
    }

    async saveLearningData(key, value) {
        await this.db.run(
            'INSERT OR REPLACE INTO learning_data (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, JSON.stringify(value)]
        );
    }

    async getLearningData(key) {
        const result = await this.db.get('SELECT value FROM learning_data WHERE key = ?', [key]);
        return result ? JSON.parse(result.value) : null;
    }

    async setState(key, value) {
        await this.db.run(
            'INSERT OR REPLACE INTO system_state (state_key, state_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, JSON.stringify(value)]
        );
    }

    async getState(key) {
        const result = await this.db.get('SELECT state_value FROM system_state WHERE state_key = ?', [key]);
        return result ? JSON.parse(result.state_value) : null;
    }
}

export default new AgentDatabase();
