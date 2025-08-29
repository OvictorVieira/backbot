import OrdersService from './OrdersService.js';
import DatabaseService from './DatabaseService.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('OrdersService', () => {
  let dbService;
  const testDbPath = path.join(process.cwd(), 'src', 'persistence', 'test_orders.db');

  beforeEach(async () => {
    // Clean up any existing test files
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File might not exist, which is fine
    }

    dbService = new DatabaseService();
    dbService.dbPath = testDbPath;
    await dbService.init();
    OrdersService.init(dbService);
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

  describe('Orders Management', () => {
    it('deve adicionar uma nova ordem', async () => {
      const testOrder = {
        botId: 1,
        externalOrderId: '12345',
        symbol: 'BTC_USDC_PERP',
        side: 'BUY',
        quantity: 0.001,
        price: 50000,
        orderType: 'LIMIT',
        status: 'PENDING',
      };

      const result = await OrdersService.addOrder(testOrder);

      expect(result).toBeTruthy();
      expect(result.botId).toBe(1);
      expect(result.symbol).toBe('BTC_USDC_PERP');
      expect(result.side).toBe('BUY');
    });

    it('deve obter ordens de um bot específico', async () => {
      // Adiciona algumas ordens de teste
      await OrdersService.addOrder({
        botId: 1,
        externalOrderId: '12345',
        symbol: 'BTC_USDC_PERP',
        side: 'BUY',
        quantity: 0.001,
        price: 50000,
        orderType: 'LIMIT',
      });

      await OrdersService.addOrder({
        botId: 1,
        externalOrderId: '12346',
        symbol: 'ETH_USDC_PERP',
        side: 'SELL',
        quantity: 0.01,
        price: 3000,
        orderType: 'MARKET',
      });

      await OrdersService.addOrder({
        botId: 2,
        externalOrderId: '12347',
        symbol: 'SOL_USDC_PERP',
        side: 'BUY',
        quantity: 1,
        price: 100,
        orderType: 'LIMIT',
      });

      const bot1Orders = await OrdersService.getOrdersByBotId(1);
      const bot2Orders = await OrdersService.getOrdersByBotId(2);

      expect(bot1Orders.length).toBe(2);
      expect(bot2Orders.length).toBe(1);
      expect(bot1Orders[0].botId).toBe(1);
      expect(bot2Orders[0].botId).toBe(2);
    });

    it('deve limpar ordens de um bot específico', async () => {
      // Adiciona ordens para dois bots
      await OrdersService.addOrder({
        botId: 1,
        externalOrderId: '12345',
        symbol: 'BTC_USDC_PERP',
        side: 'BUY',
        quantity: 0.001,
        price: 50000,
        orderType: 'LIMIT',
      });

      await OrdersService.addOrder({
        botId: 2,
        externalOrderId: '12346',
        symbol: 'ETH_USDC_PERP',
        side: 'SELL',
        quantity: 0.01,
        price: 3000,
        orderType: 'MARKET',
      });

      // Verifica que existem ordens
      const allOrders = await OrdersService.getOrdersByBotId(1);
      expect(allOrders.length).toBe(1);

      // Remove ordens do bot 1
      const removedCount = await OrdersService.clearOrdersByBotId(1);

      expect(removedCount).toBe(1);

      // Verifica que as ordens foram removidas
      const remainingOrders = await OrdersService.getOrdersByBotId(1);
      expect(remainingOrders.length).toBe(0);

      // Verifica que ordens do bot 2 ainda existem
      const bot2Orders = await OrdersService.getOrdersByBotId(2);
      expect(bot2Orders.length).toBe(1);
    });

    it('deve obter estatísticas das ordens', async () => {
      // Adiciona ordens de teste
      await OrdersService.addOrder({
        botId: 1,
        externalOrderId: '12345',
        symbol: 'BTC_USDC_PERP',
        side: 'BUY',
        quantity: 0.001,
        price: 50000,
        orderType: 'LIMIT',
      });

      await OrdersService.addOrder({
        botId: 1,
        externalOrderId: '12346',
        symbol: 'ETH_USDC_PERP',
        side: 'SELL',
        quantity: 0.01,
        price: 3000,
        orderType: 'MARKET',
      });

      const stats = await OrdersService.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byBot[1]).toBe(2);
      expect(stats.bySymbol['BTC_USDC_PERP']).toBe(1);
      expect(stats.bySymbol['ETH_USDC_PERP']).toBe(1);
      expect(stats.bySide['BUY']).toBe(1);
      expect(stats.bySide['SELL']).toBe(1);
      expect(stats.byType['LIMIT']).toBe(1);
      expect(stats.byType['MARKET']).toBe(1);
    });
  });
});
