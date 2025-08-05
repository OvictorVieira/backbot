import { AlphaFlowStrategy } from './AlphaFlowStrategy.js';

describe('AlphaFlowStrategy - Teste de Cálculo de Ordens', () => {
  let strategy;

  beforeEach(() => {
    strategy = new AlphaFlowStrategy();
  });

  describe('calculateOrders', () => {
    test('deve calcular ordens LONG com primeira ordem próxima e outras com ATR', () => {
      // Mock dos dados
      const signal = {
        action: 'long',
        conviction: 'BRONZE'
      };
      
      const currentPrice = 50000; // BTC a $50,000
      const atr = 1000; // ATR de $1,000
      const investmentUSD = 1000; // $1,000 para investir
      const symbol = 'BTC_USDC_PERP';
      
      const market = {
        decimal_quantity: 5,
        decimal_price: 1,
        stepSize_quantity: 0.00001,
        min_quantity: 0.00001
      };

      // Chama o método calculateOrders
      const orders = strategy.calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market);

      // Validações
      expect(orders).toHaveLength(3);
      
      // Ordem 1: Deve estar muito próxima do preço atual (0.8% de spread)
      const order1 = orders[0];
      const expectedOrder1Price = currentPrice - (currentPrice * 0.008); // 49,600 (0.8% de 50,000)
      expect(order1.entryPrice).toBeCloseTo(expectedOrder1Price, -1);
      expect(order1.spreadMultiplier).toBe(0); // Não usa ATR para primeira ordem
      expect(order1.orderNumber).toBe(1);
      
      // Ordem 2: Deve usar ATR × 1.0 × 2 = 2000
      const order2 = orders[1];
      const expectedOrder2Price = currentPrice - (atr * 1.0 * 2); // 48,000
      expect(order2.entryPrice).toBeCloseTo(expectedOrder2Price, -1);
      expect(order2.spreadMultiplier).toBe(1.0);
      expect(order2.orderNumber).toBe(2);
      
      // Ordem 3: Deve usar ATR × 1.5 × 3 = 4500
      const order3 = orders[2];
      const expectedOrder3Price = currentPrice - (atr * 1.5 * 3); // 46,500
      expect(order3.entryPrice).toBeCloseTo(expectedOrder3Price, -1);
      expect(order3.spreadMultiplier).toBe(1.5);
      expect(order3.orderNumber).toBe(3);

      // Valida que as ordens estão em ordem decrescente de preço (para LONG)
      expect(order1.entryPrice).toBeGreaterThan(order2.entryPrice);
      expect(order2.entryPrice).toBeGreaterThan(order3.entryPrice);
    });

    test('deve calcular ordens SHORT com primeira ordem próxima e outras com ATR', () => {
      // Mock dos dados
      const signal = {
        action: 'short',
        conviction: 'BRONZE'
      };
      
      const currentPrice = 50000; // BTC a $50,000
      const atr = 1000; // ATR de $1,000
      const investmentUSD = 1000; // $1,000 para investir
      const symbol = 'BTC_USDC_PERP';
      
      const market = {
        decimal_quantity: 5,
        decimal_price: 1,
        stepSize_quantity: 0.00001,
        min_quantity: 0.00001
      };

      // Chama o método calculateOrders
      const orders = strategy.calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market);

      // Validações
      expect(orders).toHaveLength(3);
      
      // Ordem 1: Deve estar muito próxima do preço atual (0.8% de spread)
      const order1 = orders[0];
      const expectedOrder1Price = currentPrice + (currentPrice * 0.008); // 50,400 (0.8% de 50,000)
      expect(order1.entryPrice).toBeCloseTo(expectedOrder1Price, -1);
      expect(order1.spreadMultiplier).toBe(0); // Não usa ATR para primeira ordem
      expect(order1.orderNumber).toBe(1);
      
      // Ordem 2: Deve usar ATR × 1.0 × 2 = 2000
      const order2 = orders[1];
      const expectedOrder2Price = currentPrice + (atr * 1.0 * 2); // 52,000
      expect(order2.entryPrice).toBeCloseTo(expectedOrder2Price, -1);
      expect(order2.spreadMultiplier).toBe(1.0);
      expect(order2.orderNumber).toBe(2);
      
      // Ordem 3: Deve usar ATR × 1.5 × 3 = 4500
      const order3 = orders[2];
      const expectedOrder3Price = currentPrice + (atr * 1.5 * 3); // 53,500
      expect(order3.entryPrice).toBeCloseTo(expectedOrder3Price, -1);
      expect(order3.spreadMultiplier).toBe(1.5);
      expect(order3.orderNumber).toBe(3);

      // Valida que as ordens estão em ordem crescente de preço (para SHORT)
      expect(order1.entryPrice).toBeLessThan(order2.entryPrice);
      expect(order2.entryPrice).toBeLessThan(order3.entryPrice);
    });

    test('deve validar spreads corretos para diferentes ATRs', () => {
      const signal = { action: 'long', conviction: 'BRONZE' };
      const currentPrice = 1000;
      const atr = 50; // ATR menor
      const investmentUSD = 100;
      const symbol = 'ETH_USDC_PERP';
      
      const market = {
        decimal_quantity: 4,
        decimal_price: 2,
        stepSize_quantity: 0.0001,
        min_quantity: 0.0001
      };

      const orders = strategy.calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market);

      expect(orders).toHaveLength(3);
      
      // Ordem 1: 0.8% do preço atual = 8 pontos
      const order1 = orders[0];
      expect(order1.entryPrice).toBeCloseTo(992, -1); // 1000 - 8 (0.8% de 1000)
      
      // Ordem 2: ATR × 1.0 × 2 = 100 pontos
      const order2 = orders[1];
      expect(order2.entryPrice).toBeCloseTo(900, -1); // 1000 - 100
      
      // Ordem 3: ATR × 1.5 × 3 = 225 pontos
      const order3 = orders[2];
      expect(order3.entryPrice).toBeCloseTo(775, -1); // 1000 - 225
    });

    test('deve validar pesos das ordens', () => {
      const signal = { action: 'long', conviction: 'BRONZE' };
      const currentPrice = 1000;
      const atr = 50;
      const investmentUSD = 1000;
      const symbol = 'BTC_USDC_PERP';
      
      const market = {
        decimal_quantity: 5,
        decimal_price: 1,
        stepSize_quantity: 0.00001,
        min_quantity: 0.00001
      };

      const orders = strategy.calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market);

      expect(orders).toHaveLength(3);
      
      // Valida pesos: 50%, 30%, 20%
      expect(orders[0].weight).toBe(0.5); // 50%
      expect(orders[1].weight).toBe(0.3); // 30%
      expect(orders[2].weight).toBe(0.2); // 20%
    });

    test('deve validar estrutura das ordens', () => {
      const signal = { action: 'long', conviction: 'BRONZE' };
      const currentPrice = 1000;
      const atr = 50;
      const investmentUSD = 1000;
      const symbol = 'BTC_USDC_PERP';
      
      const market = {
        decimal_quantity: 5,
        decimal_price: 1,
        stepSize_quantity: 0.00001,
        min_quantity: 0.00001
      };

      const orders = strategy.calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market);

      orders.forEach((order, index) => {
        // Valida propriedades obrigatórias
        expect(order).toHaveProperty('market');
        expect(order).toHaveProperty('symbol');
        expect(order).toHaveProperty('orderNumber');
        expect(order).toHaveProperty('action');
        expect(order).toHaveProperty('entryPrice');
        expect(order).toHaveProperty('quantity');
        expect(order).toHaveProperty('stopLoss');
        expect(order).toHaveProperty('takeProfit');
        expect(order).toHaveProperty('weight');
        expect(order).toHaveProperty('spreadMultiplier');
        expect(order).toHaveProperty('decimal_quantity');
        expect(order).toHaveProperty('decimal_price');
        expect(order).toHaveProperty('stepSize_quantity');
        expect(order).toHaveProperty('min_quantity');

        // Valida valores
        expect(order.market).toBe(symbol);
        expect(order.symbol).toBe(symbol);
        expect(order.orderNumber).toBe(index + 1);
        expect(order.action).toBe('long');
        expect(order.entryPrice).toBeGreaterThan(0);
        expect(order.quantity).toBeGreaterThan(0);
        expect(order.stopLoss).toBeGreaterThan(0);
        expect(order.takeProfit).toBeGreaterThan(0);
        expect(order.weight).toBeGreaterThan(0);
        expect(order.weight).toBeLessThanOrEqual(1);
      });
    });
  });
}); 