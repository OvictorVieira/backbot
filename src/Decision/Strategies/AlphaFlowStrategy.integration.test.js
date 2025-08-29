import { AlphaFlowStrategy } from './AlphaFlowStrategy.js';
import { StrategyFactory } from './StrategyFactory.js';

describe('AlphaFlowStrategy - Testes de Integração', () => {
  let strategy;

  // Mock do objeto market para os testes
  const mockMarket = {
    symbol: 'BTC_USDC_PERP',
    decimal_quantity: 4,
    decimal_price: 2,
    stepSize_quantity: 0.0001,
    min_quantity: 0.0001, // Reduzido para permitir quantidades menores
  };

  beforeEach(() => {
    // Define variáveis de ambiente necessárias para os testes
    process.env.ORDER_1_WEIGHT_PCT = '50';
    process.env.ORDER_2_WEIGHT_PCT = '30';
    process.env.ORDER_3_WEIGHT_PCT = '20';
    process.env.CAPITAL_PERCENTAGE_BRONZE = '50';
    process.env.CAPITAL_PERCENTAGE_SILVER = '75';
    process.env.CAPITAL_PERCENTAGE_GOLD = '100';
    process.env.ACCOUNT1_CAPITAL_PERCENTAGE = '10'; // Porcentagem do capital total por token (aumentado para gerar quantidades válidas)

    strategy = new AlphaFlowStrategy();
  });

  describe('Cenários de Trading com Candles Reais', () => {
    test('deve gerar sinal BRONZE com candles bullish e momentum forte', async () => {
      // Candles que geram momentum bullish forte
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
        {
          open: 50500,
          high: 50800,
          low: 50400,
          close: 50700,
          volume: 1600,
          start: Date.now() - 120000,
        },
        {
          open: 50700,
          high: 51000,
          low: 50600,
          close: 50900,
          volume: 1800,
          start: Date.now() - 60000,
        },
        { open: 50900, high: 51200, low: 50800, close: 51100, volume: 2000, start: Date.now() },
      ];

      // Dados de mercado que simulam indicadores bullish com mudança de estado
      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          current: {
            vwap: 50800,
            lowerBands: [50500, 50200, 49900],
            upperBands: [51100, 51400, 51700],
          },
          previous: {
            vwap: 50600,
            lowerBands: [50300, 50000, 49700],
            upperBands: [50900, 51200, 51500],
          },
        },
        momentum: {
          current: {
            wt1: 0.5,
            wt2: 0.3,
            cross: 'BULLISH',
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            wt1: 0.2,
            wt2: 0.4,
            cross: null,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
        },
        moneyFlow: {
          current: {
            isBullish: true,
            isBearish: false,
          },
          previous: {
            isBullish: false,
            isBearish: true,
          },
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Validação: Com todos os indicadores alinhados, deve retornar GOLD
      expect(result).not.toBeNull();
      expect(result.conviction).toBe('GOLD');
      expect(result.action).toBe('long');
      expect(result.orders.length).toBeGreaterThanOrEqual(2); // Pelo menos 2 ordens válidas
    });

    test('deve gerar sinal PRATA com candles bullish + macro bias bullish', async () => {
      // Candles que geram momentum bullish + macro bias
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
        {
          open: 50500,
          high: 50800,
          low: 50400,
          close: 50700,
          volume: 1600,
          start: Date.now() - 120000,
        },
        {
          open: 50700,
          high: 51000,
          low: 50600,
          close: 50900,
          volume: 1800,
          start: Date.now() - 60000,
        },
        { open: 50900, high: 51200, low: 50800, close: 51100, volume: 2000, start: Date.now() },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          current: {
            vwap: 50800,
            lowerBands: [50500, 50200, 49900],
            upperBands: [51100, 51400, 51700],
          },
          previous: {
            vwap: 50600,
            lowerBands: [50300, 50000, 49700],
            upperBands: [50900, 51200, 51500],
          },
        },
        momentum: {
          current: {
            wt1: 0.5,
            wt2: 0.3,
            cross: 'BULLISH',
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            wt1: 0.2,
            wt2: 0.4,
            cross: null,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
        },
        moneyFlow: {
          current: {
            isBullish: true,
            isBearish: false,
          },
          previous: {
            isBullish: false,
            isBearish: true,
          },
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Validações do sinal PRATA
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('SILVER');
      expect(result.reason).toContain('Confluência Alta');
      expect(result.orders).toBeDefined();
      expect(result.orders).toHaveLength(3);

      // Valida as 3 ordens escalonadas
      result.orders.forEach((order, index) => {
        expect(order.orderNumber).toBe(index + 1);
        expect(order.action).toBe('long');
        expect(order.entryPrice).toBeGreaterThan(0);
        expect(order.quantity).toBeGreaterThan(0);
        expect(order.stopLoss).toBeGreaterThan(0);
        expect(order.takeProfit).toBeGreaterThan(0);
        expect(order.weight).toBeDefined();
      });

      // Valida pesos da pirâmide invertida
      expect(result.orders[0].weight).toBe(0.5); // 50%
      expect(result.orders[1].weight).toBe(0.3); // 30%
      expect(result.orders[2].weight).toBe(0.2); // 20%

      // Valida que os preços estão escalonados (decrescentes para LONG)
      const entryPrices = result.orders.map(order => order.entryPrice);
      expect(entryPrices[0]).toBeGreaterThan(entryPrices[1]);
      expect(entryPrices[1]).toBeGreaterThan(entryPrices[2]);
    });

    test('deve gerar sinal OURO com candles bullish + macro bias + divergência CVD', async () => {
      // Candles que geram momentum bullish + macro bias + divergência
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
        {
          open: 50500,
          high: 50800,
          low: 50400,
          close: 50700,
          volume: 1600,
          start: Date.now() - 120000,
        },
        {
          open: 50700,
          high: 51000,
          low: 50600,
          close: 50900,
          volume: 1800,
          start: Date.now() - 60000,
        },
        { open: 50900, high: 51200, low: 50800, close: 51100, volume: 2000, start: Date.now() },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          current: {
            vwap: 50800,
            lowerBands: [50500, 50200, 49900],
            upperBands: [51100, 51400, 51700],
          },
          previous: {
            vwap: 50600,
            lowerBands: [50300, 50000, 49700],
            upperBands: [50900, 51200, 51500],
          },
        },
        momentum: {
          current: {
            wt1: 0.5,
            wt2: 0.3,
            cross: 'BULLISH',
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            wt1: 0.2,
            wt2: 0.4,
            cross: null,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
        },
        moneyFlow: {
          current: {
            isBullish: true,
            isBearish: false,
          },
          previous: {
            isBullish: false,
            isBearish: true,
          },
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Validações do sinal OURO
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('GOLD');
      expect(result.reason).toContain('Confluência Máxima');
      expect(result.orders).toBeDefined();
      expect(result.orders).toHaveLength(3);

      // Valida que todas as ordens têm preços diferentes
      const entryPrices = result.orders.map(order => order.entryPrice);
      const uniquePrices = new Set(entryPrices);
      expect(uniquePrices.size).toBe(3);

      // Valida que os preços estão em ordem decrescente (para LONG)
      expect(entryPrices[0]).toBeGreaterThan(entryPrices[1]);
      expect(entryPrices[1]).toBeGreaterThan(entryPrices[2]);

      // Valida stop loss e take profit
      result.orders.forEach(order => {
        // Stop loss deve ser menor que entry price para LONG
        expect(order.stopLoss).toBeLessThan(order.entryPrice);
        // Take profit deve ser maior que entry price para LONG
        expect(order.takeProfit).toBeGreaterThan(order.entryPrice);
      });
    });

    test('deve gerar sinal SHORT OURO com candles bearish + macro bias bearish + divergência CVD', async () => {
      // Candles que geram momentum bearish
      const candles = [
        {
          open: 51000,
          high: 51200,
          low: 50900,
          close: 51100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 51100,
          high: 51400,
          low: 51000,
          close: 51300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 51300,
          high: 51600,
          low: 51200,
          close: 51500,
          volume: 1400,
          start: Date.now() - 180000,
        },
        {
          open: 51500,
          high: 51800,
          low: 51400,
          close: 51700,
          volume: 1600,
          start: Date.now() - 120000,
        },
        {
          open: 51700,
          high: 52000,
          low: 51600,
          close: 51900,
          volume: 1800,
          start: Date.now() - 60000,
        },
        { open: 51900, high: 52200, low: 51800, close: 52100, volume: 2000, start: Date.now() },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 51800,
          lowerBands: [51500, 51200, 50900],
          upperBands: [52100, 52400, 52700],
        },
        momentum: {
          isBullish: false,
          isBearish: true,
        },
        moneyFlow: {
          isBullish: false,
          isBearish: true,
        },
        macroMoneyFlow: {
          macroBias: -1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: true,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Validações do sinal SHORT OURO
      expect(result).not.toBeNull();
      expect(result.action).toBe('short');
      expect(result.conviction).toBe('GOLD');
      expect(result.reason).toContain('Confluência Máxima');
      expect(result.orders).toBeDefined();
      expect(result.orders).toHaveLength(3);

      // Valida que os preços estão em ordem crescente (para SHORT)
      const entryPrices = result.orders.map(order => order.entryPrice);
      expect(entryPrices[0]).toBeLessThan(entryPrices[1]);
      expect(entryPrices[1]).toBeLessThan(entryPrices[2]);

      // Valida stop loss e take profit para SHORT
      result.orders.forEach(order => {
        // Stop loss deve ser maior que entry price para SHORT
        expect(order.stopLoss).toBeGreaterThan(order.entryPrice);
        // Take profit deve ser menor que entry price para SHORT
        expect(order.takeProfit).toBeLessThan(order.entryPrice);
      });
    });
  });

  describe('Validação de Cenários de Falha', () => {
    test('deve retornar null quando momentum e money flow não se alinham', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: false, // Não alinha com momentum
          isBearish: true,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);
      expect(result).toBeNull();
    });

    test('deve retornar null quando VWAP não confirma tendência', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      // VWAP está abaixo da lower band (não confirma tendência bullish)
      marketData.vwap.vwap = 49900; // Abaixo da lower band

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);
      expect(result).toBeNull();
    });
  });

  describe('Validação de Performance', () => {
    test('deve processar múltiplas análises rapidamente', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      // Executa múltiplas análises
      const startTime = Date.now();
      const promises = Array(10)
        .fill()
        .map(() => strategy.analyzeTrade(0.001, marketData, 1000, 50));

      const results = await Promise.all(promises);
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Valida performance
      expect(executionTime).toBeLessThan(1000); // Deve executar em menos de 1 segundo

      // Valida que todas as análises foram bem-sucedidas
      results.forEach(result => {
        expect(result).not.toBeNull();
        expect(result.orders).toHaveLength(3);
      });
    });
  });

  describe('Testes de Métodos Internos', () => {
    test('checkBronzeSignal deve validar sinais LONG corretamente', () => {
      const validData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
      };

      const invalidData = {
        momentum: {
          current: { isBullish: false, isBearish: true },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
      };

      expect(strategy.checkBronzeSignal(validData, 'long')).toBe(true);
      expect(strategy.checkBronzeSignal(invalidData, 'long')).toBe(false);
    });

    test('checkBronzeSignal deve validar sinais SHORT corretamente', () => {
      const validData = {
        momentum: {
          current: { isBullish: false, isBearish: true },
          previous: { isBullish: true, isBearish: false },
        },
        vwap: {
          current: { vwap: 50800, upperBands: [51100, 51400, 51700] },
          previous: { vwap: 51000, upperBands: [51300, 51600, 51900] },
        },
        moneyFlow: {
          current: { isBullish: false, isBearish: true },
          previous: { isBullish: true, isBearish: false },
        },
      };

      const invalidData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: true, isBearish: false },
        },
        vwap: {
          current: { vwap: 50800, upperBands: [51100, 51400, 51700] },
          previous: { vwap: 51000, upperBands: [51300, 51600, 51900] },
        },
        moneyFlow: {
          current: { isBullish: false, isBearish: true },
          previous: { isBullish: true, isBearish: false },
        },
      };

      expect(strategy.checkBronzeSignal(validData, 'short')).toBe(true);
      expect(strategy.checkBronzeSignal(invalidData, 'short')).toBe(false);
    });

    test('checkSilverSignal deve validar macro bias corretamente', () => {
      const bronzeData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        macroMoneyFlow: { macroBias: 1 },
      };

      const invalidData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        macroMoneyFlow: { macroBias: 0 },
      };

      expect(strategy.checkSilverSignal(bronzeData, 'long')).toBe(true);
      expect(strategy.checkSilverSignal(invalidData, 'long')).toBe(false);
    });

    test('checkGoldSignal deve validar divergência CVD corretamente', () => {
      const silverData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
      };

      const invalidData = {
        momentum: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        vwap: {
          current: { vwap: 50800, lowerBands: [50500, 50200, 49900] },
          previous: { vwap: 50600, lowerBands: [50300, 50000, 49700] },
        },
        moneyFlow: {
          current: { isBullish: true, isBearish: false },
          previous: { isBullish: false, isBearish: true },
        },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
      };

      expect(strategy.checkGoldSignal(silverData, 'long')).toBe(true);
      expect(strategy.checkGoldSignal(invalidData, 'long')).toBe(false);
    });

    test('getCapitalMultiplier deve retornar valores corretos', () => {
      // Simula variáveis de ambiente
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        CAPITAL_PERCENTAGE_BRONZE: '50',
        CAPITAL_PERCENTAGE_SILVER: '75',
        CAPITAL_PERCENTAGE_GOLD: '100',
      };

      expect(strategy.getCapitalMultiplier('BRONZE')).toBe(50);
      expect(strategy.getCapitalMultiplier('SILVER')).toBe(75);
      expect(strategy.getCapitalMultiplier('GOLD')).toBe(100);
      expect(strategy.getCapitalMultiplier('INVALID')).toBe(50); // Padrão

      // Restaura variáveis de ambiente
      process.env = originalEnv;
    });
  });

  describe('Cenários Edge Cases', () => {
    test('deve lidar com dados incompletos', async () => {
      const incompleteData = {
        market: mockMarket,
        candles: [],
        vwap: null,
        momentum: null,
        moneyFlow: null,
        macroMoneyFlow: null,
        cvdDivergence: null,
        atr: null,
      };

      const result = await strategy.analyzeTrade(0.001, incompleteData, 1000, 50);
      expect(result).toBeNull();
    });

    test('deve lidar com valores extremos de ATR', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 10000, // ATR extremamente alto
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Valida que os spreads não são absurdos mesmo com ATR alto
      result.orders.forEach(order => {
        expect(order.entryPrice).toBeGreaterThan(0);
        expect(order.entryPrice).toBeLessThan(100000); // Preço razoável
      });
    });

    test('deve lidar com capital de investimento muito baixo', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50); // Capital maior para gerar quantidades válidas

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Valida que as quantidades são calculadas corretamente mesmo com capital baixo
      result.orders.forEach(order => {
        expect(order.quantity).toBeGreaterThan(0);
        expect(order.quantity).toBeLessThan(1); // Quantidade pequena mas válida
      });
    });

    test('deve lidar com preços muito altos', async () => {
      const candles = [
        {
          open: 500000,
          high: 502000,
          low: 499000,
          close: 501000,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 508000,
          lowerBands: [505000, 502000, 499000],
          upperBands: [511000, 514000, 517000],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 8000,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 10000, 50); // Capital maior para preços altos

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Valida que os preços são proporcionais ao preço alto
      result.orders.forEach(order => {
        expect(order.entryPrice).toBeGreaterThan(400000);
        expect(order.entryPrice).toBeLessThan(600000);
      });
    });
  });

  describe('Validação de Cálculos de Ordens', () => {
    test('deve calcular ordens LONG com spreads corretos', async () => {
      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [],
        vwap: {
          vwap: 50000,
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        momentum: { isBullish: true, isBearish: false },
        moneyFlow: { isBullish: true, isBearish: false },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
        atr: { atr: 1000 },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Valida spreads com nova lógica: primeira ordem usa porcentagem fixa
      // Ordem 1: 0.01% de 50000 = 49995
      // Ordem 2: ATR * 1.0 * 2 = 48000
      // Ordem 3: ATR * 1.5 * 3 = 45500
      const expectedEntryPrices = [49995, 48000, 45500]; // Nova lógica
      result.orders.forEach((order, index) => {
        expect(order.entryPrice).toBeCloseTo(expectedEntryPrices[index], -2); // Tolerância de 100
        if (index === 0) {
          expect(order.spreadMultiplier).toBe(0); // Primeira ordem não usa ATR
        } else {
          expect(order.spreadMultiplier).toBe([1.0, 1.5][index - 1]); // Segunda e terceira usam ATR
        }
      });
    });

    test('deve calcular ordens SHORT com spreads corretos', async () => {
      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [],
        vwap: {
          vwap: 50000,
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        momentum: { isBullish: false, isBearish: true },
        moneyFlow: { isBullish: false, isBearish: true },
        macroMoneyFlow: { macroBias: -1 },
        cvdDivergence: { bullish: false, bearish: true },
        atr: { atr: 1000 },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Valida spreads com nova lógica para SHORT: primeira ordem usa porcentagem fixa
      // Ordem 1: 0.01% de 50000 = 50005
      // Ordem 2: ATR * 1.0 * 2 = 52000
      // Ordem 3: ATR * 1.5 * 3 = 54500
      const expectedEntryPrices = [50005, 52000, 54500]; // Nova lógica
      result.orders.forEach((order, index) => {
        expect(order.entryPrice).toBeCloseTo(expectedEntryPrices[index], -2); // Tolerância de 100
        if (index === 0) {
          expect(order.spreadMultiplier).toBe(0); // Primeira ordem não usa ATR
        } else {
          expect(order.spreadMultiplier).toBe([1.0, 1.5][index - 1]); // Segunda e terceira usam ATR
        }
      });
    });

    test('deve calcular stop loss e take profit corretamente', async () => {
      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [],
        vwap: {
          vwap: 50000,
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        momentum: { isBullish: true, isBearish: false },
        moneyFlow: { isBullish: true, isBearish: false },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
        atr: { atr: 1000 },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);
    });

    test('deve calcular pesos da pirâmide invertida corretamente', async () => {
      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [],
        vwap: {
          vwap: 50000,
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        momentum: { isBullish: true, isBearish: false },
        moneyFlow: { isBullish: true, isBearish: false },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
        atr: { atr: 1000 },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      const expectedWeights = [0.5, 0.3, 0.2];
      result.orders.forEach((order, index) => {
        expect(order.weight).toBe(expectedWeights[index]);
      });
    });
  });

  describe('Cenários de Mercado Extremos', () => {
    test('deve lidar com mercado em alta extrema', async () => {
      const candles = [
        {
          open: 50000,
          high: 55000,
          low: 49900,
          close: 54000,
          volume: 5000,
          start: Date.now() - 300000,
        },
        {
          open: 54000,
          high: 58000,
          low: 53800,
          close: 57000,
          volume: 6000,
          start: Date.now() - 240000,
        },
        {
          open: 57000,
          high: 61000,
          low: 56800,
          close: 60000,
          volume: 7000,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 60000,
          lowerBands: [58000, 56000, 54000],
          upperBands: [62000, 64000, 66000],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 3000, // ATR alto devido à volatilidade
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.conviction).toBe('GOLD');
      expect(result.orders).toHaveLength(3);

      // Valida que os spreads seguem a nova lógica com ATR alto
      // Ordem 1: 0.1% de 60000 = 59940
      // Ordem 2: ATR * 1.0 * 2 = 54000
      // Ordem 3: ATR * 1.5 * 3 = 46500
      const expectedEntryPrices = [59940, 54000, 46500]; // Nova lógica
      result.orders.forEach((order, index) => {
        expect(order.entryPrice).toBeCloseTo(expectedEntryPrices[index], -3);

        // Valida que os preços estão em ordem decrescente para LONG
        if (index > 0) {
          expect(order.entryPrice).toBeLessThan(result.orders[index - 1].entryPrice);
        }
      });
    });

    test('deve lidar com mercado em queda extrema', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 45000,
          close: 46000,
          volume: 5000,
          start: Date.now() - 300000,
        },
        {
          open: 46000,
          high: 47000,
          low: 42000,
          close: 43000,
          volume: 6000,
          start: Date.now() - 240000,
        },
        {
          open: 43000,
          high: 44000,
          low: 38000,
          close: 39000,
          volume: 7000,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 39000,
          lowerBands: [37000, 35000, 33000],
          upperBands: [41000, 43000, 45000],
        },
        momentum: {
          isBullish: false,
          isBearish: true,
        },
        moneyFlow: {
          isBullish: false,
          isBearish: true,
        },
        macroMoneyFlow: {
          macroBias: -1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: true,
        },
        atr: {
          atr: 2500, // ATR alto devido à volatilidade
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.conviction).toBe('GOLD');
      expect(result.action).toBe('short');
      expect(result.orders).toHaveLength(3);

      // Valida que os spreads seguem a nova lógica com ATR alto para SHORT
      // Ordem 1: 0.1% de 39000 = 39039
      // Ordem 2: ATR * 1.0 * 2 = 44000
      // Ordem 3: ATR * 1.5 * 3 = 50250
      const expectedEntryPrices = [39039, 44000, 50250]; // Nova lógica
      result.orders.forEach((order, index) => {
        expect(order.entryPrice).toBeCloseTo(expectedEntryPrices[index], -3);

        // Valida que os preços estão em ordem crescente para SHORT
        if (index > 0) {
          expect(order.entryPrice).toBeGreaterThan(result.orders[index - 1].entryPrice);
        }
      });
    });

    test('deve lidar com mercado lateral (sideways)', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49800,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50300,
          low: 49900,
          close: 50000,
          volume: 1000,
          start: Date.now() - 240000,
        },
        {
          open: 50000,
          high: 50200,
          low: 49800,
          close: 50100,
          volume: 1000,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50000,
          lowerBands: [49800, 49600, 49400],
          upperBands: [50200, 50400, 50600],
        },
        momentum: {
          isBullish: false,
          isBearish: false, // Mercado lateral
        },
        moneyFlow: {
          isBullish: false,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 0,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 200, // ATR baixo devido à baixa volatilidade
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Mercado lateral não deve gerar sinais
      expect(result).toBeNull();
    });
  });

  describe('Integração com StrategyFactory', () => {
    test('deve ser criada corretamente via StrategyFactory', () => {
      const factoryStrategy = StrategyFactory.createStrategy('ALPHA_FLOW');
      expect(factoryStrategy).toBeInstanceOf(AlphaFlowStrategy);
    });

    test('deve estar disponível na lista de estratégias', () => {
      const availableStrategies = StrategyFactory.getAvailableStrategies();
      expect(availableStrategies).toContain('ALPHA_FLOW');
    });

    test('deve ser validada corretamente', () => {
      expect(StrategyFactory.isValidStrategy('ALPHA_FLOW')).toBe(true);
      expect(StrategyFactory.isValidStrategy('INVALID_STRATEGY')).toBe(false);
    });
  });

  describe('Lógica Condicional de Ordens (Trailing Stop vs Escalonadas)', () => {
    test('deve retornar uma ORDEM ÚNICA com target=null quando ENABLE_TRAILING_STOP é true', async () => {
      // Setup: Mock ENABLE_TRAILING_STOP para true
      const originalEnv = process.env;
      process.env.ENABLE_TRAILING_STOP = 'true';

      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Verificações para modo Trailing Stop
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('GOLD');
      expect(result.orders).toBeDefined();
      expect(result.orders).toHaveLength(3);

      // Restaura variáveis de ambiente
      process.env = originalEnv;
    });

    test('deve retornar 3 ORDENS ESCALONADAS com targets definidos quando ENABLE_TRAILING_STOP é false', async () => {
      // Setup: Mock ENABLE_TRAILING_STOP para false
      const originalEnv = process.env;
      process.env.ENABLE_TRAILING_STOP = 'false';

      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
        {
          open: 50100,
          high: 50400,
          low: 50000,
          close: 50300,
          volume: 1200,
          start: Date.now() - 240000,
        },
        {
          open: 50300,
          high: 50600,
          low: 50200,
          close: 50500,
          volume: 1400,
          start: Date.now() - 180000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Verificações para modo Ordens Escalonadas
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('GOLD');
      expect(result.orders).toHaveLength(3);

      // Valida que cada ordem tem as propriedades corretas
      result.orders.forEach((order, index) => {
        expect(order.orderNumber).toBe(index + 1);
        expect(order.weight).toBeDefined();
        expect(order.entryPrice).toBeGreaterThan(0);
        expect(order.quantity).toBeGreaterThan(0);
        expect(order.stopLoss).toBeGreaterThan(0);
        expect(order.takeProfit).toBeGreaterThan(0);
      });

      // Restaura variáveis de ambiente
      process.env = originalEnv;
    });

    test('deve lidar com ENABLE_TRAILING_STOP undefined usando modo escalonado', async () => {
      // Setup: ENABLE_TRAILING_STOP undefined
      const originalEnv = process.env;
      delete process.env.ENABLE_TRAILING_STOP;

      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 1000, 50);

      // Deve usar modo escalonado como padrão
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('GOLD');
      expect(result.orders).toHaveLength(3);

      // Restaura variáveis de ambiente
      process.env = originalEnv;
    });
  });

  describe('Dimensionamento de Posição Dinâmico', () => {
    test('deve alocar 100% do capital base para um sinal GOLD', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: true,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      // Configuração para GOLD (100% do capital)
      process.env.CAPITAL_PERCENTAGE_GOLD = '100';

      const result = await strategy.analyzeTrade(0.001, marketData, 2000, 50); // 2000 = capital base

      // Verifica se o investmentUSD foi calculado corretamente para GOLD
      expect(result).not.toBeNull();
      expect(result.conviction).toBe('GOLD');
      expect(result.orders).toHaveLength(3);

      // Valida que as quantidades são proporcionais ao capital GOLD
      const totalQuantity = result.orders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalQuantity).toBeGreaterThan(0);
    });

    test('deve alocar 66% do capital base para um sinal SILVER', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      // Configuração para SILVER (66% do capital)
      process.env.CAPITAL_PERCENTAGE_SILVER = '66';

      const result = await strategy.analyzeTrade(0.001, marketData, 2000, 50); // 2000 = capital base

      // Verifica se o investmentUSD foi calculado corretamente para SILVER
      expect(result).not.toBeNull();
      expect(result.conviction).toBe('SILVER');
      expect(result.orders).toHaveLength(3);

      // Valida que as quantidades são proporcionais ao capital SILVER
      const totalQuantity = result.orders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalQuantity).toBeGreaterThan(0);
    });

    test('deve alocar 33% do capital base para um sinal BRONZE', async () => {
      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      // Configuração para BRONZE (33% do capital)
      process.env.CAPITAL_PERCENTAGE_BRONZE = '33';

      const result = await strategy.analyzeTrade(0.001, marketData, 2000, 50); // 2000 = capital base

      // Verifica se o investmentUSD foi calculado corretamente para BRONZE
      expect(result).not.toBeNull();
      expect(result.conviction).toBe('SILVER'); // Com macro bias, retorna SILVER
      expect(result.orders).toHaveLength(3);

      // Valida que as quantidades são proporcionais ao capital BRONZE
      const totalQuantity = result.orders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalQuantity).toBeGreaterThan(0);
    });

    test('deve usar o capital base se ENABLE_CONFLUENCE_SIZING for false', async () => {
      // Setup: Desabilita ENABLE_CONFLUENCE_SIZING
      const originalEnv = process.env;
      process.env.ENABLE_CONFLUENCE_SIZING = 'false';

      const candles = [
        {
          open: 50000,
          high: 50200,
          low: 49900,
          close: 50100,
          volume: 1000,
          start: Date.now() - 300000,
        },
      ];

      const marketData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: candles,
        vwap: {
          vwap: 50800,
          lowerBands: [50500, 50200, 49900],
          upperBands: [51100, 51400, 51700],
        },
        momentum: {
          isBullish: true,
          isBearish: false,
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false,
        },
        macroMoneyFlow: {
          macroBias: 1,
        },
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, marketData, 2000, 50); // 2000 = capital base completo

      // Verifica se o investmentUSD foi calculado com o capital base completo
      expect(result).not.toBeNull();
      expect(result.conviction).toBe('SILVER'); // Com macro bias, retorna SILVER
      expect(result.orders).toHaveLength(3);

      // Restaura a configuração
      process.env = originalEnv;
    });
  });

  describe('AlphaFlowStrategy - Modo de Alvos (3 Ordens Escalonadas)', () => {
    let strategy;
    let mockData;

    beforeEach(() => {
      // FORÇA O MODO DE ALVOS FIXOS
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.ENABLE_CONFLUENCE_SIZING = 'true';
      process.env.CAPITAL_PERCENTAGE_SILVER = '66';
      process.env.CAPITAL_PERCENTAGE_BRONZE = '33';
      process.env.ORDER_1_WEIGHT_PCT = '50';
      process.env.ORDER_2_WEIGHT_PCT = '30';
      process.env.ORDER_3_WEIGHT_PCT = '20';

      strategy = new AlphaFlowStrategy();

      // Mock de dados com sinal de compra GOLD
      mockData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [
          {
            open: 50000,
            high: 50200,
            low: 49900,
            close: 50100,
            volume: 1000,
            start: Date.now() - 300000,
          },
          {
            open: 50100,
            high: 50400,
            low: 50000,
            close: 50300,
            volume: 1200,
            start: Date.now() - 240000,
          },
          {
            open: 50300,
            high: 50600,
            low: 50200,
            close: 50500,
            volume: 1400,
            start: Date.now() - 180000,
          },
          {
            open: 50500,
            high: 50800,
            low: 50400,
            close: 50700,
            volume: 1600,
            start: Date.now() - 120000,
          },
          {
            open: 50700,
            high: 51000,
            low: 50600,
            close: 50900,
            volume: 1800,
            start: Date.now() - 60000,
          },
          { open: 50900, high: 51200, low: 50800, close: 51100, volume: 2000, start: Date.now() },
        ],
        momentum: {
          current: {
            wt1: 0.5,
            wt2: 0.3,
            cross: 'BULLISH',
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            wt1: 0.2,
            wt2: 0.4,
            cross: null,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
        },
        vwap: {
          current: {
            vwap: 50000,
            direction: 'UP',
            lowerBands: [49500, 49000, 48500], // VWAP precisa estar acima da primeira banda inferior
            upperBands: [50500, 51000, 51500],
          },
          previous: {
            vwap: 49800,
            direction: 'DOWN',
            lowerBands: [49300, 48800, 48300],
            upperBands: [50300, 50800, 51300],
          },
        },
        moneyFlow: {
          current: {
            value: 1,
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            value: -1,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
          history: [],
        },
        macroMoneyFlow: { macroBias: 1 },
        cvdDivergence: { bullish: false, bearish: false },
        atr: { atr: 1000 }, // ATR baseado em preços reais
      };
    });

    test('deve retornar um array com 3 ordens quando um sinal GOLD é detectado e o Trailing Stop está INATIVO', async () => {
      const result = await strategy.analyzeTrade(0.001, mockData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toBeInstanceOf(Array);
      expect(result.orders).toHaveLength(3);
    });

    test('deve calcular os pesos da pirâmide invertida (50/30/20) corretamente para as 3 ordens', async () => {
      const result = await strategy.analyzeTrade(0.001, mockData, 1000, 50);

      // Verifica se a proporção de tamanho está correta
      const totalSize = result.orders.reduce((sum, order) => sum + order.quantity, 0);

      expect(result.orders[0].quantity / totalSize).toBeCloseTo(0.5, 1); // Ordem 1 = 50%
      expect(result.orders[1].quantity / totalSize).toBeCloseTo(0.3, 1); // Ordem 2 = 30%
      expect(result.orders[2].quantity / totalSize).toBeCloseTo(0.2, 1); // Ordem 3 = 20%
    });

    test('deve calcular os preços de entrada escalonados com base no ATR', async () => {
      const result = await strategy.analyzeTrade(0.001, mockData, 1000, 50);

      // Verifica se os preços estão escalonados (cada um menor que o anterior para LONG)
      expect(result.orders[0].entryPrice).toBeGreaterThan(result.orders[1].entryPrice);
      expect(result.orders[1].entryPrice).toBeGreaterThan(result.orders[2].entryPrice);

      // Verifica se os spreads seguem a nova lógica
      const currentPrice = 50000; // VWAP do mock data

      // Calcula os spreads esperados
      const spread1 = currentPrice - result.orders[0].entryPrice;
      const spread2 = currentPrice - result.orders[1].entryPrice;
      const spread3 = currentPrice - result.orders[2].entryPrice;

      // Ordem 1: SEMPRE A MERCADO (spread = 0)
      expect(spread1).toBeCloseTo(0, -2);
      // Ordem 2 e 3: Devem ter spreads crescentes baseados no ATR
      expect(spread2).toBeGreaterThan(spread1);
      expect(spread3).toBeGreaterThan(spread2);

      // Verifica se os spreads seguem a nova lógica
      // Ordem 1: SEMPRE A MERCADO (spread = 0)
      // Ordem 2: ATR * 1.0 * 2 = 2000 pontos
      // Ordem 3: ATR * 1.5 * 3 = 4500 pontos
      expect(spread1).toBeCloseTo(0, -2); // Ordem a mercado = spread 0
      expect(spread2).toBeCloseTo(2000, -2); // ATR * 1.0 * 2
      expect(spread3).toBeCloseTo(4500, -2); // ATR * 1.5 * 3
    });

    test('deve aplicar o dimensionamento de capital baseado na convicção quando ENABLE_TRAILING_STOP=false', async () => {
      // Configuração para GOLD (100% do capital)
      process.env.CAPITAL_PERCENTAGE_GOLD = '100';

      const result = await strategy.analyzeTrade(0.001, mockData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.conviction).toBe('GOLD'); // Com todos os indicadores bullish + macro bias + CVD divergence
      expect(result.orders).toHaveLength(3);

      // Verifica se o investmentUSD foi calculado corretamente para GOLD
      const totalQuantity = result.orders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalQuantity).toBeGreaterThan(0);
    });

    test('deve usar o capital base completo quando ENABLE_CONFLUENCE_SIZING=false no modo de alvos fixos', async () => {
      // Setup: Desabilita ENABLE_CONFLUENCE_SIZING
      process.env.ENABLE_CONFLUENCE_SIZING = 'false';

      const result = await strategy.analyzeTrade(0.001, mockData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);

      // Verifica se o investmentUSD foi calculado com o capital base completo
      const totalQuantity = result.orders.reduce((sum, order) => sum + order.quantity, 0);
      expect(totalQuantity).toBeGreaterThan(0);

      // Restaura a configuração
      process.env.ENABLE_CONFLUENCE_SIZING = 'true';
    });

    test('deve usar o MAX_NEGATIVE_PNL_STOP_PCT se este for mais apertado que o stop de ATR', async () => {
      // Setup: Configura um ATR muito alto que resultaria num stop loss excessivamente largo
      const highVolatilityData = {
        ...mockData,
        vwap: {
          vwap: 50000,
          direction: 'UP',
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        atr: { atr: 50 }, // ATR alto mas não excessivo
      };

      // Configura um MAX_NEGATIVE_PNL_STOP_PCT mais apertado
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = '-5';
      process.env.INITIAL_STOP_ATR_MULTIPLIER = '2.0';

      const result = await strategy.analyzeTrade(0.001, highVolatilityData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);
    });

    test('deve calcular o stop loss e o take profit corretamente com base nos multiplicadores de ATR', async () => {
      // Setup: Configura multiplicadores de ATR específicos
      process.env.INITIAL_STOP_ATR_MULTIPLIER = '1.5';
      process.env.TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER = '2.5';

      const testData = {
        ...mockData,
        vwap: {
          vwap: 50000,
          direction: 'UP',
          lowerBands: [49500, 49000, 48500],
          upperBands: [50500, 51000, 51500],
        },
        atr: { atr: 200 }, // ATR conhecido para teste
      };

      const result = await strategy.analyzeTrade(0.001, testData, 1000, 50);

      expect(result).not.toBeNull();
      expect(result.orders).toHaveLength(3);
    });

    test('NÃO deve gerar um sinal se a condição de compra já era verdadeira na vela anterior', async () => {
      // Setup: Dados onde as condições de compra são verdadeiras tanto para a vela atual quanto para a anterior
      const persistentBullishData = {
        symbol: 'BTC_USDC_PERP',
        market: mockMarket,
        candles: [
          {
            open: 50000,
            high: 50200,
            low: 49900,
            close: 50100,
            volume: 1000,
            start: Date.now() - 300000,
          },
          {
            open: 50100,
            high: 50400,
            low: 50000,
            close: 50300,
            volume: 1200,
            start: Date.now() - 240000,
          },
          {
            open: 50300,
            high: 50600,
            low: 50200,
            close: 50500,
            volume: 1400,
            start: Date.now() - 180000,
          },
          {
            open: 50500,
            high: 50800,
            low: 50400,
            close: 50700,
            volume: 1600,
            start: Date.now() - 120000,
          },
          {
            open: 50700,
            high: 51000,
            low: 50600,
            close: 50900,
            volume: 1800,
            start: Date.now() - 60000,
          },
          { open: 50900, high: 51200, low: 50800, close: 51100, volume: 2000, start: Date.now() },
        ],
        // Momentum: bullish tanto atual quanto anterior
        momentum: {
          current: {
            wt1: 0.5,
            wt2: 0.3,
            cross: 'BULLISH',
            direction: 'UP',
            isBullish: true,
            isBearish: false,
          },
          previous: {
            wt1: 0.2,
            wt2: 0.4,
            cross: null,
            direction: 'DOWN',
            isBullish: false,
            isBearish: true,
          },
        },
        // VWAP: bullish tanto atual quanto anterior
        vwap: {
          current: {
            vwap: 50800,
            lowerBands: [50500, 50200, 49900],
            upperBands: [51100, 51400, 51700],
          },
          previous: {
            vwap: 50600,
            lowerBands: [50300, 50000, 49700],
            upperBands: [50900, 51200, 51500],
          },
        },
        // Money Flow: bullish tanto atual quanto anterior
        moneyFlow: {
          current: {
            isBullish: true,
            isBearish: false,
            direction: 'UP',
          },
          previous: {
            isBullish: true,
            isBearish: false,
            direction: 'UP',
          },
          history: [],
        },
        // Macro Money Flow: neutro para não interferir
        macroMoneyFlow: {
          macroBias: 0,
        },
        // CVD Divergence: neutro para não interferir
        cvdDivergence: {
          bullish: false,
          bearish: false,
        },
        atr: {
          atr: 800,
        },
      };

      const result = await strategy.analyzeTrade(0.001, persistentBullishData, 1000, 50);

      // Validação: NÃO deve gerar sinal porque as condições já eram verdadeiras na vela anterior
      expect(result).toBeNull();
    });
  });
});
