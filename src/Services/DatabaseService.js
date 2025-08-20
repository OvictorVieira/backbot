import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { promises as fs } from 'fs';
import Logger from '../Utils/Logger.js';

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

      // Configure SQLite for better concurrency
      await this.db.exec('PRAGMA journal_mode = WAL;');
      await this.db.exec('PRAGMA synchronous = NORMAL;');
      await this.db.exec('PRAGMA busy_timeout = 30000;');
      await this.db.exec('PRAGMA cache_size = 10000;');

      Logger.info(`🔧 [DATABASE] Database connection established: ${this.dbPath}`);

      // Create tables
      await this.createTables();

      Logger.info(`✅ [DATABASE] Database initialized successfully`);
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
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          botId INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          state TEXT NOT NULL,
          active_stop_order_id TEXT,
          updatedAt TEXT NOT NULL,
          UNIQUE(botId, symbol),
          FOREIGN KEY (botId) REFERENCES bot_configs(botId) ON DELETE CASCADE
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
          status TEXT DEFAULT 'PENDING',
          exchangeCreatedAt TEXT,
          closePrice REAL,
          closeTime TEXT,
          closeQuantity REAL,
          closeType TEXT,
          pnl REAL,
          pnlPct REAL
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

      // Create positions table for position tracking
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          entryPrice REAL NOT NULL,
          initialQuantity REAL NOT NULL,
          currentQuantity REAL NOT NULL,
          pnl REAL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'OPEN',
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          botId INTEGER,
          FOREIGN KEY (botId) REFERENCES bot_configs(id)
        );
      `);

      // Create index for better query performance
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
      `);

      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
      `);

      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_positions_botId ON positions(botId);
      `);

      // Migra tabela existente se necessário
      await this.migrateBotOrdersTable();
      await this.migrateTrailingStateTable();
      await this.migrateTrailingStateActiveStopColumn();

      Logger.info(`📋 [DATABASE] Tables created successfully`);
    } catch (error) {
      console.error(`❌ [DATABASE] Error creating tables:`, error.message);
      throw error;
    }
  }

  /**
   * Migra a tabela bot_orders para incluir novas colunas se necessário
   */
  async migrateBotOrdersTable() {
    try {
      // Verifica se as novas colunas já existem
      const tableInfo = await this.getAll("PRAGMA table_info(bot_orders)");
      const columnNames = tableInfo.map(col => col.name);
      
      const newColumns = [
        { name: 'exchangeCreatedAt', type: 'TEXT' },
        { name: 'closePrice', type: 'REAL' },
        { name: 'closeTime', type: 'TEXT' },
        { name: 'closeQuantity', type: 'REAL' },
        { name: 'closeType', type: 'TEXT' },
        { name: 'pnl', type: 'REAL' },
        { name: 'pnlPct', type: 'REAL' },
        { name: 'clientId', type: 'TEXT' }
      ];

      for (const column of newColumns) {
        if (!columnNames.includes(column.name)) {
          Logger.info(`🔄 [DATABASE] Adicionando coluna ${column.name} à tabela bot_orders`);
          await this.db.exec(`ALTER TABLE bot_orders ADD COLUMN ${column.name} ${column.type}`);
        }
      }

      Logger.info(`✅ [DATABASE] Migração da tabela bot_orders concluída`);
    } catch (error) {
      console.error(`❌ [DATABASE] Erro na migração da tabela bot_orders:`, error.message);
    }
  }

  /**
   * Migra a tabela trailing_state para incluir botId se necessário
   */
  async migrateTrailingStateTable() {
    try {
      // Verifica se a tabela tem a estrutura antiga (só com symbol, state, updatedAt)
      const tableInfo = await this.getAll("PRAGMA table_info(trailing_state)");
      const columnNames = tableInfo.map(col => col.name);
      
      // Se não tem botId, precisa migrar
      if (!columnNames.includes('botId')) {
        console.log(`🔄 [DATABASE] Migrando trailing_state para incluir botId`);
        
        // Busca dados existentes
        const existingData = await this.getAll('SELECT symbol, state, updatedAt FROM trailing_state');
        
        // Remove a tabela antiga
        await this.db.exec('DROP TABLE IF EXISTS trailing_state');
        
        // Recria a tabela com a nova estrutura
        await this.db.exec(`
          CREATE TABLE trailing_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            botId INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            state TEXT NOT NULL,
            active_stop_order_id TEXT,
            updatedAt TEXT NOT NULL,
            UNIQUE(botId, symbol),
            FOREIGN KEY (botId) REFERENCES bot_configs(botId) ON DELETE CASCADE
          );
        `);
        
        // Migra dados existentes, assumindo botId = 1 para dados órfãos
        for (const row of existingData) {
          await this.db.run(
            'INSERT INTO trailing_state (botId, symbol, state, updatedAt) VALUES (?, ?, ?, ?)',
            [1, row.symbol, row.state, row.updatedAt]
          );
        }
        
        console.log(`✅ [DATABASE] Migração da trailing_state concluída - ${existingData.length} registros migrados para botId=1`);
      }
      
    } catch (error) {
      console.error(`❌ [DATABASE] Erro na migração da tabela trailing_state:`, error.message);
    }
  }

  /**
   * Migra a tabela trailing_state para incluir a coluna active_stop_order_id
   */
  async migrateTrailingStateActiveStopColumn() {
    try {
      // Verifica se a coluna active_stop_order_id já existe
      const tableInfo = await this.getAll("PRAGMA table_info(trailing_state)");
      const columnNames = tableInfo.map(col => col.name);
      
      // Se não tem active_stop_order_id, adiciona a coluna
      if (!columnNames.includes('active_stop_order_id')) {
        Logger.info(`🔄 [DATABASE] Adicionando coluna active_stop_order_id à tabela trailing_state`);
        
        await this.db.exec(`
          ALTER TABLE trailing_state 
          ADD COLUMN active_stop_order_id TEXT DEFAULT NULL
        `);
        
        Logger.info(`✅ [DATABASE] Migração da coluna active_stop_order_id concluída`);
      }
      
    } catch (error) {
      console.error(`❌ [DATABASE] Erro na migração da coluna active_stop_order_id:`, error.message);
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
