import { jest } from '@jest/globals';
import OrderController from './OrderController.js';
import AccountController from './AccountController.js';
import { StrategyFactory } from '../Decision/Strategies/StrategyFactory.js';
import Decision from '../Decision/Decision.js';

describe('OrderController Module', () => {
  describe('calcSlippagePct', () => {
    test('should calculate slippage percentage correctly', () => {
      const priceLimit = 50000;
      const priceCurrent = 50100;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      // (50100 - 50000) / 50000 * 100 = 0.2%
      expect(slippage).toBeCloseTo(0.2, 2);
    });

    test('should handle zero current price', () => {
      const priceLimit = 50000;
      const priceCurrent = 0;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      expect(slippage).toBe(100);
    });

    test('should handle negative slippage', () => {
      const priceLimit = 50000;
      const priceCurrent = 49900;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      // (49900 - 50000) / 50000 * 100 = -0.2%
      expect(slippage).toBeCloseTo(0.2, 2); // Math.abs torna positivo
    });

    test('should handle equal prices', () => {
      const priceLimit = 50000;
      const priceCurrent = 50000;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      expect(slippage).toBe(0);
    });

    test('should handle very large price differences', () => {
      const priceLimit = 50000;
      const priceCurrent = 100000;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      expect(slippage).toBe(100);
    });

    test('should handle very small price differences', () => {
      const priceLimit = 50000;
      const priceCurrent = 50001;
      
      // Chama o método real
      const slippage = OrderController.calcSlippagePct(priceLimit, priceCurrent);
      
      expect(slippage).toBeCloseTo(0.002, 3);
    });
  });

  describe('calculateATR', () => {
    test('should calculate ATR correctly with valid candles', () => {
      const candles = [
        { open: 50000, high: 50200, low: 49900, close: 50100 },
        { open: 50100, high: 50400, low: 50000, close: 50300 },
        { open: 50300, high: 50600, low: 50200, close: 50500 },
        { open: 50500, high: 50800, low: 50400, close: 50700 },
        { open: 50700, high: 51000, low: 50600, close: 50900 },
        { open: 50900, high: 51200, low: 50800, close: 51100 },
        { open: 51100, high: 51400, low: 51000, close: 51300 },
        { open: 51300, high: 51600, low: 51200, close: 51500 },
        { open: 51500, high: 51800, low: 51400, close: 51700 },
        { open: 51700, high: 52000, low: 51600, close: 51900 },
        { open: 51900, high: 52200, low: 51800, close: 52100 },
        { open: 52100, high: 52400, low: 52000, close: 52300 },
        { open: 52300, high: 52600, low: 52200, close: 52500 },
        { open: 52500, high: 52800, low: 52400, close: 52700 },
        { open: 52700, high: 53000, low: 52600, close: 52900 }
      ];
      
      // Chama o método real
      const atr = OrderController.calculateATR(candles, 14);
      
      expect(atr).toBeGreaterThan(0);
      expect(typeof atr).toBe('number');
    });

    test('should handle insufficient candles', () => {
      const candles = [
        { open: 50000, high: 50200, low: 49900, close: 50100 }
      ];
      
      // Chama o método real
      const atr = OrderController.calculateATR(candles, 14);
      
      expect(atr).toBeNull(); // Retorna null quando dados insuficientes
    });

    test('should handle empty candles array', () => {
      const candles = [];
      
      // Chama o método real
      const atr = OrderController.calculateATR(candles, 14);
      
      expect(atr).toBeNull(); // Retorna null quando dados insuficientes
    });

    test('should handle custom period', () => {
      const candles = [
        { open: 50000, high: 50200, low: 49900, close: 50100 },
        { open: 50100, high: 50400, low: 50000, close: 50300 },
        { open: 50300, high: 50600, low: 50200, close: 50500 },
        { open: 50500, high: 50800, low: 50400, close: 50700 },
        { open: 50700, high: 51000, low: 50600, close: 50900 },
        { open: 50900, high: 51200, low: 50800, close: 51100 }
      ];
      
      // Chama o método real com período customizado
      const atr = OrderController.calculateATR(candles, 5);
      
      expect(atr).toBeGreaterThan(0);
      expect(typeof atr).toBe('number');
    });
  });

  describe('addPendingEntryOrder and removePendingEntryOrder', () => {
    test('should add and remove pending entry order correctly', () => {
      const market = 'BTC_USDC_PERP';
      const orderData = {
        stop: 49000,
        isLong: true,
        quantity: 0.1
      };
      const accountId = 'DEFAULT';
      
      // Chama os métodos reais
      OrderController.addPendingEntryOrder(market, orderData, accountId);
      
      // Verifica se foi adicionado
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market]).toBeDefined();
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market].stop).toBe(49000);
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market].isLong).toBe(true);
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market].quantity).toBe(0.1);
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market].createdAt).toBeDefined();
      
      // Remove a ordem
      OrderController.removePendingEntryOrder(market, accountId);
      
      // Verifica se foi removida
      expect(OrderController.pendingEntryOrdersByAccount[accountId][market]).toBeUndefined();
    });

    test('should handle multiple accounts correctly', () => {
      const market = 'ETH_USDC_PERP';
      const orderData = {
        stop: 3000,
        isLong: false,
        quantity: 1.0
      };
      
      // Adiciona para CONTA1
      OrderController.addPendingEntryOrder(market, orderData, 'CONTA1');
      
      // Adiciona para CONTA2
      OrderController.addPendingEntryOrder(market, orderData, 'CONTA2');
      
      // Verifica se ambas foram adicionadas
      expect(OrderController.pendingEntryOrdersByAccount['CONTA1'][market]).toBeDefined();
      expect(OrderController.pendingEntryOrdersByAccount['CONTA2'][market]).toBeDefined();
      
      // Remove apenas de CONTA1
      OrderController.removePendingEntryOrder(market, 'CONTA1');
      
      // Verifica se apenas CONTA1 foi removida
      expect(OrderController.pendingEntryOrdersByAccount['CONTA1'][market]).toBeUndefined();
      expect(OrderController.pendingEntryOrdersByAccount['CONTA2'][market]).toBeDefined();
      
      // Limpa CONTA2
      OrderController.removePendingEntryOrder(market, 'CONTA2');
    });
  });

  describe('clearStopLossCheckCache', () => {
    test('should clear stop loss check cache correctly', () => {
      const symbol = 'BTC_USDC_PERP';
      
      // Adiciona dados ao cache com o formato correto (symbol_accountId)
      OrderController.stopLossCheckCache.set(`${symbol}_DEFAULT`, {
        lastCheck: Date.now(),
        hasStopLoss: true
      });
      OrderController.stopLossCheckCache.set(`${symbol}_CONTA2`, {
        lastCheck: Date.now(),
        hasStopLoss: false
      });
      
      // Verifica se foram adicionados
      expect(OrderController.stopLossCheckCache.has(`${symbol}_DEFAULT`)).toBe(true);
      expect(OrderController.stopLossCheckCache.has(`${symbol}_CONTA2`)).toBe(true);
      
      // Limpa o cache
      OrderController.clearStopLossCheckCache(symbol);
      
      // Verifica se foram removidos
      expect(OrderController.stopLossCheckCache.has(`${symbol}_DEFAULT`)).toBe(false);
      expect(OrderController.stopLossCheckCache.has(`${symbol}_CONTA2`)).toBe(false);
    });
  });

  describe('removeFromStopLossCache', () => {
    test('should remove from stop loss cache correctly', () => {
      const symbol = 'ETH_USDC_PERP';
      const accountId = 'CONTA2';
      
      // Adiciona dados ao validatedStopLossPositions (que é onde removeFromStopLossCache atua)
      const positionKey = `${accountId}_${symbol}`;
      OrderController.validatedStopLossPositions.add(positionKey);
      
      // Verifica se foi adicionado
      expect(OrderController.validatedStopLossPositions.has(positionKey)).toBe(true);
      
      // Remove do cache
      OrderController.removeFromStopLossCache(symbol, accountId);
      
      // Verifica se foi removido
      expect(OrderController.validatedStopLossPositions.has(positionKey)).toBe(false);
    });
  });
});

describe('Market Data Validation', () => {
  test('should validate market data is passed correctly to strategy', async () => {
    // Mock dos dados de mercado
    const mockMarketData = {
      symbol: 'BTC_USDC_PERP',
      decimal_quantity: 4,
      decimal_price: 2,
      stepSize_quantity: 0.0001,
      min_quantity: 0.001
    };

    // Mock dos dados da conta
    const mockAccount = {
      markets: [mockMarketData],
      capitalAvailable: 1000,
      leverage: 5
    };

    // Mock do AccountController
    jest.spyOn(AccountController, 'get').mockResolvedValue(mockAccount);

    // Mock da estratégia
    const mockStrategy = {
      analyzeTrade: jest.fn().mockReturnValue({
        action: 'long',
        conviction: 'BRONZE',
        orders: [
          {
            market: 'BTC_USDC_PERP',
            action: 'long',
            entry: 50000,
            quantity: 0.001,
            decimal_quantity: 4,
            decimal_price: 2,
            stepSize_quantity: 0.0001,
            min_quantity: 0.001
          }
        ]
      })
    };

    // Mock da StrategyFactory
    jest.spyOn(StrategyFactory, 'createStrategy').mockReturnValue(mockStrategy);

    const decision = new Decision('ALPHA_FLOW');
    
    // Mock dos dados de entrada
    const mockData = {
      symbol: 'BTC_USDC_PERP',
      momentum: { isBullish: true },
      moneyFlow: { isBullish: true },
      vwap: { vwap: 50000 },
      atr: { atr: 1000 }
    };

    const result = await decision.analyzeTrades(0.001, [mockData], 100, 50, { accountId: 'DEFAULT' });

    // Verifica se a estratégia foi chamada com os dados de mercado
    expect(mockStrategy.analyzeTrade).toHaveBeenCalledWith(
      0.001,
      expect.objectContaining({
        symbol: 'BTC_USDC_PERP',
        market: mockMarketData
      }),
      100,
      50,
      { accountId: 'DEFAULT' },
      'NEUTRAL'
    );

    // Verifica se o resultado contém ordens com dados de mercado
    expect(result[0].orders[0]).toHaveProperty('decimal_quantity', 4);
    expect(result[0].orders[0]).toHaveProperty('decimal_price', 2);
    expect(result[0].orders[0]).toHaveProperty('min_quantity', 0.001);
  });

  test('should handle missing market data gracefully', async () => {
    // Mock dos dados da conta sem o mercado específico
    const mockAccount = {
      markets: [],
      capitalAvailable: 1000,
      leverage: 5
    };

    jest.spyOn(AccountController, 'get').mockResolvedValue(mockAccount);

    const decision = new Decision('ALPHA_FLOW');
    
    const mockData = {
      symbol: 'BTC_USDC_PERP',
      momentum: { isBullish: true }
    };

    const result = await decision.analyzeTrades(0.001, [mockData], 100, 50, { accountId: 'DEFAULT' });

    // Verifica se retorna array vazio quando não encontra o mercado
    expect(result).toEqual([]);
  });

  test('should validate margin before analysis', async () => {
    // Mock dos dados da conta com capital insuficiente
    const mockAccount = {
      markets: [],
      capitalAvailable: 0, // Capital zero
      leverage: 5,
      fee: 0.001
    };

    jest.spyOn(AccountController, 'get').mockResolvedValue(mockAccount);

    // Mock do Futures.getOpenPositions para evitar erro de autenticação
    const Futures = await import('../Backpack/Authenticated/Futures.js');
    jest.spyOn(Futures.default, 'getOpenPositions').mockResolvedValue([]);

    // Mock do Order.getOpenOrders para evitar erro de autenticação
    const Order = await import('../Backpack/Authenticated/Order.js');
    jest.spyOn(Order.default, 'getOpenOrders').mockResolvedValue([]);

    const decision = new Decision('ALPHA_FLOW');
    
    // Mock do console.log para capturar a mensagem de aviso
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await decision.analyze(null, null, { accountId: 'DEFAULT' });

    // Verifica se a mensagem de margem insuficiente foi logada
    const calls = consoleSpy.mock.calls;
    const marginMessage = calls.find(call => 
      call[0] && typeof call[0] === 'string' && 
      call[0].includes('⚠️ [CAPITAL] Margem insuficiente para iniciar nova análise')
    );
    
    expect(marginMessage).toBeDefined();

    consoleSpy.mockRestore();
  });

  test('should validate symbol before processing orders', async () => {
    // Mock dos dados da conta
    const mockAccount = {
      markets: [
        {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.001
        }
      ],
      capitalAvailable: 1000,
      leverage: 5,
      fee: 0.001
    };

    jest.spyOn(AccountController, 'get').mockResolvedValue(mockAccount);

    // Mock da estratégia retornando decisão sem símbolo
    const mockStrategy = {
      analyzeTrade: jest.fn().mockReturnValue(null) // Retorna null para simular decisão inválida
    };

    jest.spyOn(StrategyFactory, 'createStrategy').mockReturnValue(mockStrategy);

    const decision = new Decision('ALPHA_FLOW');
    
    const mockData = {
      symbol: 'BTC_USDC_PERP',
      momentum: { isBullish: true }
    };

    const result = await decision.analyzeTrades(0.001, [mockData], 100, 50, { accountId: 'DEFAULT' });

    // Verifica se retorna array vazio quando não há símbolo válido
    expect(result).toEqual([]);
  });
}); 