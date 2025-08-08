import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { promises as fs } from 'fs';

class DatabaseService {
  constructor() {
    // Define the database file path
    this.dbPath = path.join(process.cwd(), 'src', 'persistence', 'bot.db');
    this.db = null;
  }

  /**
   * Initialize the database connection and create tables if they don't exist
   */
  async init() {
    try {
      // Ensure the directory exists
      const dir = path.dirname(this.dbPath);
      await fs.mkdir(dir, { recursive: true });

      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      console.log(`🔧 [DATABASE] Database connection established: ${this.dbPath}`);

      // Create tables
      await this.createTables();

      console.log(`✅ [DATABASE] Database initialized successfully`);
    } catch (error) {
      console.error(`❌ [DATABASE] Error initializing database:`, error.message);
      throw error;
    }
  }

  /**
   * Create all necessary tables
   */
  async createTables() {
    try {
      // Create trailing_state table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS trailing_state (
          symbol TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);

      // Create bot_orders table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS bot_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          botId INTEGER NOT NULL,
          externalOrderId TEXT NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL NOT NULL,
          orderType TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING'
        );
      `);

      // Create bot_configs table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS bot_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          botId INTEGER UNIQUE NOT NULL,
          config TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);

      console.log(`📋 [DATABASE] Tables created successfully`);
    } catch (error) {
      console.error(`❌ [DATABASE] Error creating tables:`, error.message);
      throw error;
    }
  }

  /**
   * Execute a query that returns a single row
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<object|null>} - Single row result or null
   */
  async get(query, params = []) {
    try {
      return await this.db.get(query, params);
    } catch (error) {
      console.error(`❌ [DATABASE] Error in get query:`, error.message);
      throw error;
    }
  }

  /**
   * Execute a query that returns multiple rows
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} - Array of results
   */
  async getAll(query, params = []) {
    try {
      return await this.db.all(query, params);
    } catch (error) {
      console.error(`❌ [DATABASE] Error in getAll query:`, error.message);
      throw error;
    }
  }

  /**
   * Execute a query that doesn't return results (INSERT, UPDATE, DELETE)
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<object>} - Result object with lastID and changes
   */
  async run(query, params = []) {
    try {
      return await this.db.run(query, params);
    } catch (error) {
      console.error(`❌ [DATABASE] Error in run query:`, error.message);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.db) {
      await this.db.close();
      console.log(`🔒 [DATABASE] Database connection closed`);
    }
  }

  /**
   * Check if the database is initialized
   * @returns {boolean} - True if database is initialized
   */
  isInitialized() {
    return this.db !== null;
  }
}

export default DatabaseService;
