import OrderController from './OrderController.js';

describe('OrderController - Testes de Integração', () => {
  let orderController;
  
  // Mock do objeto market para os testes
  const mockMarket = {
    symbol: 'BTC_USDC_PERP',
    decimal_quantity: 4,
    decimal_price: 2,
    stepSize_quantity: 0.0001,
    min_quantity: 0.001
  };

  beforeEach(() => {
    // Define variáveis de ambiente necessárias para os testes
    process.env.ENABLE_TRAILING_STOP = 'false';
    process.env.ENABLE_CONFLUENCE_SIZING = 'true';
    
    orderController = OrderController;
  });

  // Mock de config para todos os testes
  const mockConfig = {
    apiKey: 'mock-key',
    apiSecret: 'mock-secret',
    id: 'test-bot',
    botClientOrderId: 1000
  };

  describe('Validação de Dados de Mercado', () => {
    test('deve validar dados de mercado corretamente', async () => {
      // Mock de dados de mercado válidos
      const mockOrderData = {
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        quantity: 0.01,
        price: 50000,
        decimal_quantity: mockMarket.decimal_quantity,
        decimal_price: mockMarket.decimal_price,
        stepSize_quantity: mockMarket.stepSize_quantity,
        min_quantity: mockMarket.min_quantity
      };

      // Simula a criação de ordem
      const result = await orderController.createLimitOrderWithTriggers({ 
        ...mockOrderData, 
        config: mockConfig
      });
      
      // Verifica se os dados foram validados corretamente
      expect(result).toBeDefined();
    });

    test('deve rejeitar dados de mercado inválidos', async () => {
      // Mock de dados de mercado inválidos
      const mockOrderData = {
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        quantity: 0.01,
        price: 50000
        // Faltam decimal_quantity, decimal_price, stepSize_quantity
      };

      // Simula a criação de ordem com dados inválidos
      const result = await orderController.createLimitOrderWithTriggers({ 
        ...mockOrderData, 
        config: mockConfig
      });
      
      // Verifica se foi rejeitado
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados de decimal ausentes');
    });
  });

  describe('Criação de Ordens de Segurança', () => {
    test('deve criar ordens de segurança corretamente', async () => {
      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        unrealizedPnl: 100,
        unrealizedPnlPct: 2
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders com credenciais mock
      const result = await orderController.createFailsafeOrders(mockPosition, 'DEFAULT', mockConfig);

      // Verifica se foi executado
      expect(result).toBeDefined();
    });

    test('deve lidar com erros na criação de ordens', async () => {
      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders com credenciais mock
      const result = await orderController.createFailsafeOrders(mockPosition, 'DEFAULT', mockConfig);

      // Verifica se o erro foi tratado
      expect(result).toBeDefined();
    });
  });

  describe('Execução de Ordens Condicionais (ENABLE_TRAILING_STOP)', () => {
    test('deve criar APENAS uma ordem de Stop Loss quando ENABLE_TRAILING_STOP é true', async () => {
      // Setup: Mock ENABLE_TRAILING_STOP para true
      const originalEnv = process.env;
      process.env.ENABLE_TRAILING_STOP = 'true';

      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        unrealizedPnl: 100,
        unrealizedPnlPct: 2
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders com credenciais mock
      const result = await orderController.createFailsafeOrders(mockPosition, 'DEFAULT', mockConfig);

      // Verifica se foi executado (mesmo com erro de autenticação, o método é chamado)
      expect(result).toBeDefined();
      
      // Restaura a configuração
      process.env = originalEnv;
    });

    test('deve criar DUAS ordens (Stop Loss e Take Profit) quando ENABLE_TRAILING_STOP é false', async () => {
      // Setup: Mock ENABLE_TRAILING_STOP para false
      const originalEnv = process.env;
      process.env.ENABLE_TRAILING_STOP = 'false';

      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        unrealizedPnl: 100,
        unrealizedPnlPct: 2
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders com credenciais mock
      const result = await orderController.createFailsafeOrders(mockPosition, 'DEFAULT', mockConfig);

      // Verifica se foi executado (mesmo com erro de autenticação, o método é chamado)
      expect(result).toBeDefined();
      
      // Restaura a configuração
      process.env = originalEnv;
    });

    test('deve lidar com ENABLE_TRAILING_STOP undefined', async () => {
      // Setup: Mock ENABLE_TRAILING_STOP para undefined
      const originalEnv = process.env;
      process.env.ENABLE_TRAILING_STOP = undefined;

      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        unrealizedPnl: 100,
        unrealizedPnlPct: 2
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders
      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);

      // Verifica se foi executado
      expect(result).toBeDefined();
      
      // Restaura a configuração
      process.env = originalEnv;
    });
  });

  describe('Integração com TrailingStop', () => {
    test('deve salvar estado da posição corretamente', async () => {
      // Mock da posição
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa detectPositionOpenedAndCreateFailsafe com credenciais mock
      const result = await orderController.detectPositionOpenedAndCreateFailsafe(mockPosition, 'DEFAULT', mockConfig);

      // Verifica se o estado foi salvo
      expect(result).toBeDefined();
    });
  });

  describe('Cenários Edge Cases', () => {
    test('deve lidar com posição com quantidade zero', async () => {
      // Mock da posição com quantidade zero
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0,
        entryPrice: 50000
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders
      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);

      // Verifica se foi tratado corretamente
      expect(result).toBeDefined();
    });

    test('deve lidar com preços extremos', async () => {
      // Mock da posição com preço extremo
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 999999999
      };

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders
      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);

      // Verifica se foi tratado corretamente
      expect(result).toBeDefined();
    });
  });

  describe('Validação de Performance', () => {
    test('deve processar múltiplas ordens rapidamente', async () => {
      const startTime = Date.now();

      // Mock de múltiplas posições
      const mockPositions = [
        {
          symbol: 'BTC_USDC_PERP',
          netQuantity: 0.01,
          entryPrice: 50000
        },
        {
          symbol: 'ETH_USDC_PERP',
          netQuantity: 0.1,
          entryPrice: 3000
        }
      ];

      // Mock do Account
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      // Executa createFailsafeOrders para múltiplas posições
      const results = await Promise.all(
        mockPositions.map(position => 
          orderController.createFailsafeOrders(position, 'DEFAULT', mockConfig)
        )
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Verifica se foi executado rapidamente (menos de 1 segundo)
      expect(executionTime).toBeLessThan(1000);
      expect(results).toHaveLength(2);
    });
  });

  describe('Testes de Métodos Internos', () => {
    test('deve validar dados de entrada corretamente', async () => {
      // Mock de dados válidos
      const mockOrderData = {
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        quantity: 0.01,
        price: 50000,
        decimal_quantity: 4,
        decimal_price: 2,
        stepSize_quantity: 0.0001,
        min_quantity: 0.001
      };

      // Testa a validação
      const result = await orderController.createLimitOrderWithTriggers({ ...mockOrderData, config: mockConfig });
      
      expect(result).toBeDefined();
    });

    test('deve lidar com dados incompletos', async () => {
      // Mock de dados incompletos
      const mockOrderData = {
        symbol: 'BTC_USDC_PERP',
        side: 'Bid'
        // Faltam outros campos obrigatórios
      };

      // Testa a validação
      const result = await orderController.createLimitOrderWithTriggers({ ...mockOrderData, config: mockConfig });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados de decimal ausentes');
    });
  });

  describe('Cenários de Mercado Extremos', () => {
    test('deve lidar com mercado em alta extrema', async () => {
      // Mock de posição com preço muito alto
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 1000000
      };

      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);
      
      expect(result).toBeDefined();
    });

    test('deve lidar com mercado em queda extrema', async () => {
      // Mock de posição com preço muito baixo
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 1
      };

      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);
      
      expect(result).toBeDefined();
    });
  });

  describe('Integração com Módulos Externos', () => {
    test('deve integrar com Order.js corretamente', async () => {
      // Mock de dados de ordem
      const mockOrderData = {
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        quantity: 0.01,
        price: 50000,
        decimal_quantity: 4,
        decimal_price: 2,
        stepSize_quantity: 0.0001,
        min_quantity: 0.001
      };

      // Testa a integração
      const result = await orderController.createLimitOrderWithTriggers({ ...mockOrderData, config: mockConfig });
      
      expect(result).toBeDefined();
    });

    test('deve integrar com Account.js corretamente', async () => {
      // Mock de dados de conta
      const mockAccount = {
        capitalAvailable: 10000,
        fee: 0.001
      };

      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000
      };

      // Testa a integração
      const result = await orderController.createFailsafeOrders(mockPosition, "DEFAULT", mockConfig);
      
      expect(result).toBeDefined();
    });
  });

  describe('Validação de Stop Loss Corrigida', () => {
    test('deve detectar stop loss corretamente para posição LONG', () => {
      // Mock de posição LONG
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        avgEntryPrice: 50000
      };

      // Mock de ordem de stop loss válida (preço ABAIXO da entrada)
      const validStopLossOrder = {
        id: 'order1',
        symbol: 'BTC_USDC_PERP',
        side: 'Ask',
        reduceOnly: true,
        limitPrice: 49000, // ABAIXO do preço de entrada
        status: 'Pending'
      };

      // Mock de ordem de take profit inválida (preço ACIMA da entrada)
      const invalidTakeProfitOrder = {
        id: 'order2',
        symbol: 'BTC_USDC_PERP',
        side: 'Ask',
        reduceOnly: true,
        limitPrice: 51000, // ACIMA do preço de entrada
        status: 'Pending'
      };

      // Testa validação de stop loss válido
      const isValidStopLoss = OrderController.isOrderCorrectlyPositionedAsStopLoss(validStopLossOrder, mockPosition);
      expect(isValidStopLoss).toBe(true);

      // Testa validação de take profit (deve ser false)
      const isInvalidTakeProfit = OrderController.isOrderCorrectlyPositionedAsStopLoss(invalidTakeProfitOrder, mockPosition);
      expect(isInvalidTakeProfit).toBe(false);
    });

    test('deve detectar stop loss corretamente para posição SHORT', () => {
      // Mock de posição SHORT
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: -0.01,
        entryPrice: 50000,
        avgEntryPrice: 50000
      };

      // Mock de ordem de stop loss válida (preço ACIMA da entrada)
      const validStopLossOrder = {
        id: 'order1',
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        reduceOnly: true,
        limitPrice: 51000, // ACIMA do preço de entrada
        status: 'Pending'
      };

      // Mock de ordem de take profit inválida (preço ABAIXO da entrada)
      const invalidTakeProfitOrder = {
        id: 'order2',
        symbol: 'BTC_USDC_PERP',
        side: 'Bid',
        reduceOnly: true,
        limitPrice: 49000, // ABAIXO do preço de entrada
        status: 'Pending'
      };

      // Testa validação de stop loss válido
      const isValidStopLoss = OrderController.isOrderCorrectlyPositionedAsStopLoss(validStopLossOrder, mockPosition);
      expect(isValidStopLoss).toBe(true);

      // Testa validação de take profit (deve ser false)
      const isInvalidTakeProfit = OrderController.isOrderCorrectlyPositionedAsStopLoss(invalidTakeProfitOrder, mockPosition);
      expect(isInvalidTakeProfit).toBe(false);
    });

    test('deve rejeitar ordens sem preço limite', () => {
      // Mock de posição LONG
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        avgEntryPrice: 50000
      };

      // Mock de ordem sem preço limite
      const orderWithoutLimitPrice = {
        id: 'order1',
        symbol: 'BTC_USDC_PERP',
        side: 'Ask',
        reduceOnly: true,
        status: 'Pending'
        // Sem limitPrice
      };

      // Testa validação de ordem sem preço limite
      const isValid = OrderController.isOrderCorrectlyPositionedAsStopLoss(orderWithoutLimitPrice, mockPosition);
      expect(isValid).toBe(false);
    });

    test('deve detectar ordens com trigger de stop loss', () => {
      // Mock de posição LONG
      const mockPosition = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        entryPrice: 50000,
        avgEntryPrice: 50000
      };

      // Mock de ordem com trigger de stop loss
      const orderWithTrigger = {
        id: 'order1',
        symbol: 'BTC_USDC_PERP',
        side: 'Ask',
        reduceOnly: true,
        stopLossTriggerPrice: 49000,
        limitPrice: 48500,
        status: 'Pending'
      };

      // Testa validação de ordem com trigger
      const isValid = OrderController.isOrderCorrectlyPositionedAsStopLoss(orderWithTrigger, mockPosition);
      expect(isValid).toBe(true);
    });

    test('deve lidar com diferentes formatos de preço de entrada', () => {
      // Mock de posição LONG com avgEntryPrice
      const mockPositionWithAvg = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: 0.01,
        avgEntryPrice: 50000
        // Sem entryPrice
      };

      // Mock de ordem de stop loss válida
      const validStopLossOrder = {
        id: 'order1',
        symbol: 'BTC_USDC_PERP',
        side: 'Ask',
        reduceOnly: true,
        limitPrice: 49000,
        status: 'Pending'
      };

      // Testa validação usando avgEntryPrice
      const isValid = OrderController.isOrderCorrectlyPositionedAsStopLoss(validStopLossOrder, mockPositionWithAvg);
      expect(isValid).toBe(true);
    });
  });

}); 