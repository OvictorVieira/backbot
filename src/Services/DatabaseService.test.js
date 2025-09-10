import DatabaseService from './DatabaseService.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('DatabaseService', () => {
  let dbService;
  const testDbPath = path.join(process.cwd(), 'src', 'persistence', 'test_bot.db');

  beforeEach(() => {
    dbService = new DatabaseService();
    // Override the database path for testing
    dbService.dbPath = testDbPath;
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.close();
    }
    // Clean up test database file
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File might not exist, which is fine
    }
  });

  describe('Initialization', () => {
    it('deve criar o arquivo da base de dados e a tabela trailing_state na inicialização', async () => {
      await dbService.init();

      expect(dbService.isInitialized()).toBe(true);

      // Check if database file exists
      const fileExists = await fs
        .access(testDbPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Check if trailing_state table exists
      const tableExists = await dbService.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='trailing_state'"
      );
      expect(tableExists).toBeTruthy();
    });
  });

  describe('Database Operations', () => {
    beforeEach(async () => {
      await dbService.init();
    });

    it('deve conseguir inserir, obter e apagar um registo da tabela trailing_state', async () => {
      const testBotId = 1;
      const testSymbol = 'BTC_USDC_PERP';
      const testState = {
        symbol: testSymbol,
        trailingStopPrice: 50000,
        activated: true,
        createdAt: new Date().toISOString(),
      };

      // Insert test data
      const insertResult = await dbService.run(
        'INSERT OR REPLACE INTO trailing_state (botId, symbol, state, updatedAt) VALUES (?, ?, ?, ?)',
        [testBotId, testSymbol, JSON.stringify(testState), new Date().toISOString()]
      );
      expect(insertResult.changes).toBe(1);

      // Get the inserted data
      const retrievedData = await dbService.get(
        'SELECT * FROM trailing_state WHERE symbol = ? AND botId = ?',
        [testSymbol, testBotId]
      );
      expect(retrievedData).toBeTruthy();
      expect(retrievedData.symbol).toBe(testSymbol);
      expect(retrievedData.botId).toBe(testBotId);

      const retrievedState = JSON.parse(retrievedData.state);
      expect(retrievedState.trailingStopPrice).toBe(50000);
      expect(retrievedState.activated).toBe(true);

      // Delete the test data
      const deleteResult = await dbService.run(
        'DELETE FROM trailing_state WHERE symbol = ? AND botId = ?',
        [testSymbol, testBotId]
      );
      expect(deleteResult.changes).toBe(1);

      // Verify deletion
      const deletedData = await dbService.get(
        'SELECT * FROM trailing_state WHERE symbol = ? AND botId = ?',
        [testSymbol, testBotId]
      );
      expect(deletedData).toBeUndefined();
    });

    it('deve conseguir executar queries getAll', async () => {
      const testBotId = 1;
      const testData = [
        { symbol: 'BTC_USDC_PERP', state: JSON.stringify({ price: 50000 }) },
        { symbol: 'ETH_USDC_PERP', state: JSON.stringify({ price: 3000 }) },
      ];

      // Insert test data
      for (const data of testData) {
        await dbService.run(
          'INSERT OR REPLACE INTO trailing_state (botId, symbol, state, updatedAt) VALUES (?, ?, ?, ?)',
          [testBotId, data.symbol, data.state, new Date().toISOString()]
        );
      }

      // Get all data
      const allData = await dbService.getAll('SELECT * FROM trailing_state');
      expect(allData.length).toBe(2);
      expect(allData.some(row => row.symbol === 'BTC_USDC_PERP')).toBe(true);
      expect(allData.some(row => row.symbol === 'ETH_USDC_PERP')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('deve lidar com erros de query inválida', async () => {
      await dbService.init();

      await expect(dbService.run('INVALID SQL QUERY')).rejects.toThrow();
    });
  });
});
