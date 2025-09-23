import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { promises as fs } from 'fs';
import Logger from '../Utils/Logger.js';
import FeatureToggleService from './FeatureToggleService.js';

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
        driver: sqlite3.Database,
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
          bot_type TEXT NOT NULL DEFAULT 'TRADITIONAL',
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

      // Create trading_locks table for HFT semaphore system
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS trading_locks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          botId INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          lockType TEXT NOT NULL,
          lockReason TEXT,
          positionId TEXT,
          lockedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          unlockAt TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          metadata TEXT,
          UNIQUE(botId, symbol, lockType),
          FOREIGN KEY (botId) REFERENCES bot_configs(botId) ON DELETE CASCADE
        );
      `);

      // Create index for trading locks
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trading_locks_active ON trading_locks(botId, symbol, status) WHERE status = 'ACTIVE';
      `);

      // Create feature_toggles table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS feature_toggles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_name TEXT UNIQUE NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Migra tabela existente se necessário
      await this.migrateBotOrdersTable();
      await this.migrateTrailingStateTable();
      await this.migrateTrailingStateActiveStopColumn();
      await this.migrateBotConfigsBotTypeColumn();

      // Initialize feature toggles
      await this.initializeFeatureToggles();

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
      const tableInfo = await this.getAll('PRAGMA table_info(bot_orders)');
      const columnNames = tableInfo.map(col => col.name);

      const newColumns = [
        { name: 'exchangeCreatedAt', type: 'TEXT' },
        { name: 'closePrice', type: 'REAL' },
        { name: 'closeTime', type: 'TEXT' },
        { name: 'closeQuantity', type: 'REAL' },
        { name: 'closeType', type: 'TEXT' },
        { name: 'pnl', type: 'REAL' },
        { name: 'pnlPct', type: 'REAL' },
        { name: 'clientId', type: 'TEXT' },
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
      const tableInfo = await this.getAll('PRAGMA table_info(trailing_state)');
      const columnNames = tableInfo.map(col => col.name);

      // Se não tem botId, precisa migrar
      if (!columnNames.includes('botId')) {
        console.log(`🔄 [DATABASE] Migrando trailing_state para incluir botId`);

        // Busca dados existentes
        const existingData = await this.getAll(
          'SELECT symbol, state, updatedAt FROM trailing_state'
        );

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

        console.log(
          `✅ [DATABASE] Migração da trailing_state concluída - ${existingData.length} registros migrados para botId=1`
        );
      }
    } catch (error) {
      console.error(`❌ [DATABASE] Erro na migração da tabela trailing_state:`, error.message);
    }
  }

  /**
   * Migra a tabela bot_configs para incluir a coluna bot_type se necessário
   */
  async migrateBotConfigsBotTypeColumn() {
    try {
      // Verifica se a coluna bot_type já existe
      const tableInfo = await this.getAll('PRAGMA table_info(bot_configs)');
      const columnNames = tableInfo.map(col => col.name);

      // Se não tem bot_type, adiciona a coluna
      if (!columnNames.includes('bot_type')) {
        Logger.info(`🔄 [DATABASE] Adicionando coluna bot_type à tabela bot_configs`);

        await this.db.exec(`
          ALTER TABLE bot_configs
          ADD COLUMN bot_type TEXT NOT NULL DEFAULT 'TRADITIONAL'
        `);

        Logger.info(`✅ [DATABASE] Migração da coluna bot_type concluída`);
      }
    } catch (error) {
      console.error(`❌ [DATABASE] Erro na migração da coluna bot_type:`, error.message);
    }
  }

  /**
   * Migra a tabela trailing_state para incluir a coluna active_stop_order_id
   */
  async migrateTrailingStateActiveStopColumn() {
    try {
      // Verifica se a coluna active_stop_order_id já existe
      const tableInfo = await this.getAll('PRAGMA table_info(trailing_state)');
      const columnNames = tableInfo.map(col => col.name);

      // Se não tem active_stop_order_id, adiciona a coluna
      if (!columnNames.includes('active_stop_order_id')) {
        Logger.info(
          `🔄 [DATABASE] Adicionando coluna active_stop_order_id à tabela trailing_state`
        );

        await this.db.exec(`
          ALTER TABLE trailing_state 
          ADD COLUMN active_stop_order_id TEXT DEFAULT NULL
        `);

        Logger.info(`✅ [DATABASE] Migração da coluna active_stop_order_id concluída`);
      }
    } catch (error) {
      console.error(
        `❌ [DATABASE] Erro na migração da coluna active_stop_order_id:`,
        error.message
      );
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
   * Trading Lock Management Methods
   */

  /**
   * Check if there's an active trading lock for a bot/symbol
   */
  async hasActiveTradingLock(botId, symbol, lockType = 'POSITION_OPEN') {
    try {
      const lock = await this.get(
        'SELECT * FROM trading_locks WHERE botId = ? AND symbol = ? AND lockType = ? AND status = ?',
        [botId, symbol, lockType, 'ACTIVE']
      );
      return !!lock;
    } catch (error) {
      Logger.error(`❌ [DATABASE] Error checking trading lock:`, error.message);
      return false;
    }
  }

  /**
   * Create a trading lock
   */
  async createTradingLock(botId, symbol, lockType, lockReason, positionId = null, metadata = null) {
    try {
      await this.run(
        `INSERT OR REPLACE INTO trading_locks
         (botId, symbol, lockType, lockReason, positionId, lockedAt, status, metadata)
         VALUES (?, ?, ?, ?, ?, datetime('now'), 'ACTIVE', ?)`,
        [
          botId,
          symbol,
          lockType,
          lockReason,
          positionId,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
      Logger.info(
        `🔒 [TRADING_LOCK] Created lock for bot ${botId}, symbol ${symbol}, type ${lockType}`
      );
      return true;
    } catch (error) {
      Logger.error(`❌ [DATABASE] Error creating trading lock:`, error.message);
      return false;
    }
  }

  /**
   * Release a trading lock
   */
  async releaseTradingLock(botId, symbol, lockType = 'POSITION_OPEN') {
    try {
      await this.run(
        `UPDATE trading_locks
         SET status = 'RELEASED', unlockAt = datetime('now')
         WHERE botId = ? AND symbol = ? AND lockType = ? AND status = 'ACTIVE'`,
        [botId, symbol, lockType]
      );
      Logger.info(
        `🔓 [TRADING_LOCK] Released lock for bot ${botId}, symbol ${symbol}, type ${lockType}`
      );
      return true;
    } catch (error) {
      Logger.error(`❌ [DATABASE] Error releasing trading lock:`, error.message);
      return false;
    }
  }

  /**
   * Get active trading lock details
   */
  async getTradingLock(botId, symbol, lockType = 'POSITION_OPEN') {
    try {
      return await this.get(
        'SELECT * FROM trading_locks WHERE botId = ? AND symbol = ? AND lockType = ? AND status = ?',
        [botId, symbol, lockType, 'ACTIVE']
      );
    } catch (error) {
      Logger.error(`❌ [DATABASE] Error getting trading lock:`, error.message);
      return null;
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
   * Initialize feature toggles with default values
   */
  async initializeFeatureToggles() {
    try {
      // Initialize FeatureToggleService with this database instance
      FeatureToggleService.initialize(this);

      // Set up default toggles
      await FeatureToggleService.initializeDefaultToggles();

      Logger.info('🎛️ [DATABASE] Feature toggles initialized');
    } catch (error) {
      Logger.error('❌ [DATABASE] Error initializing feature toggles:', error.message);
      throw error;
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
