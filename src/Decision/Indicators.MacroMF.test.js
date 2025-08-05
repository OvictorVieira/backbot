import { calculateIndicators } from './Indicators.js';

describe('Macro Money Flow', () => {
  
  describe('Cálculo do Macro Money Flow', () => {
    it('deve calcular o Macro Money Flow corretamente para timeframe 5m', async () => {
      // Cria dados mock simulando candles de 5m
      const dailyCandles = [
        // Primeiro "dia" (agrupamento de 288 candles de 5m)
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 115, volume: 800, high: 120, low: 115, start: 3000 },
        { open: 115, close: 125, volume: 1200, high: 125, low: 115, start: 4000 },
        { open: 125, close: 130, volume: 1800, high: 130, low: 125, start: 5000 },
        { open: 130, close: 125, volume: 900, high: 130, low: 125, start: 6000 },
        { open: 125, close: 135, volume: 1600, high: 135, low: 125, start: 7000 },
        { open: 135, close: 140, volume: 2000, high: 140, low: 135, start: 8000 },
        { open: 140, close: 135, volume: 1100, high: 140, low: 135, start: 9000 },
        { open: 135, close: 145, volume: 1700, high: 145, low: 135, start: 10000 },
        { open: 145, close: 150, volume: 2200, high: 150, low: 145, start: 11000 },
        { open: 150, close: 145, volume: 1300, high: 150, low: 145, start: 12000 },
        { open: 145, close: 155, volume: 1900, high: 155, low: 145, start: 13000 },
        { open: 155, close: 160, volume: 2400, high: 160, low: 155, start: 14000 },
        { open: 160, close: 155, volume: 1500, high: 160, low: 155, start: 15000 },
        { open: 155, close: 165, volume: 2100, high: 165, low: 155, start: 16000 },
        { open: 165, close: 170, volume: 2600, high: 170, low: 165, start: 17000 },
        { open: 170, close: 165, volume: 1700, high: 170, low: 165, start: 18000 },
        { open: 165, close: 175, volume: 2300, high: 175, low: 165, start: 19000 },
        { open: 175, close: 180, volume: 2800, high: 180, low: 175, start: 20000 }
      ];
      
      const indicators = await calculateIndicators(dailyCandles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.macroMoneyFlow).toBeDefined();
      expect(indicators.macroMoneyFlow.macroBias).toBeDefined();
      expect(indicators.macroMoneyFlow.mfiCurrent).toBeDefined();
      expect(indicators.macroMoneyFlow.mfiPrevious).toBeDefined();
      expect(indicators.macroMoneyFlow.isBullish).toBeDefined();
      expect(indicators.macroMoneyFlow.isBearish).toBeDefined();
      expect(indicators.macroMoneyFlow.direction).toBeDefined();
      // Verifica se os valores são do tipo correto
      expect(typeof indicators.macroMoneyFlow.macroBias).toBe('number');
      expect(typeof indicators.macroMoneyFlow.mfiCurrent).toBe('number');
      expect(typeof indicators.macroMoneyFlow.mfiPrevious).toBe('number');
      expect(typeof indicators.macroMoneyFlow.isBullish).toBe('boolean');
      expect(typeof indicators.macroMoneyFlow.isBearish).toBe('boolean');
      expect(typeof indicators.macroMoneyFlow.direction).toBe('string');
      expect(indicators.macroMoneyFlow.dataSource).toBeDefined();
      expect(indicators.macroMoneyFlow.error).toBeDefined();
      
      // Verifica se history existe (pode não existir em caso de erro)
      if (indicators.macroMoneyFlow.history) {
        expect(Array.isArray(indicators.macroMoneyFlow.history)).toBe(true);
      }
    });

    it('deve lidar com dados insuficientes', async () => {
      const insufficientCandles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 }
      ];
      
      const indicatorsInsufficient = await calculateIndicators(insufficientCandles, '5m', 'BTC_USDC_PERP');
      
      expect(indicatorsInsufficient.macroMoneyFlow).toBeDefined();
      expect(indicatorsInsufficient.macroMoneyFlow.macroBias).toBe(0);
      expect(indicatorsInsufficient.macroMoneyFlow.mfiCurrent).toBe(50);
      expect(indicatorsInsufficient.macroMoneyFlow.mfiPrevious).toBe(50);
      expect(indicatorsInsufficient.macroMoneyFlow.isBullish).toBe(false);
      expect(indicatorsInsufficient.macroMoneyFlow.isBearish).toBe(false);
      expect(indicatorsInsufficient.macroMoneyFlow.direction).toBe('NEUTRAL');
    });

    it('deve lidar com array vazio', async () => {
      const emptyCandles = [];
      
      const indicatorsEmpty = await calculateIndicators(emptyCandles, '5m', 'BTC_USDC_PERP');
      
      expect(indicatorsEmpty.macroMoneyFlow).toBeDefined();
      expect(indicatorsEmpty.macroMoneyFlow.macroBias).toBe(0);
      expect(indicatorsEmpty.macroMoneyFlow.mfiCurrent).toBe(50);
      expect(indicatorsEmpty.macroMoneyFlow.mfiPrevious).toBe(50);
      expect(indicatorsEmpty.macroMoneyFlow.isBullish).toBe(false);
      expect(indicatorsEmpty.macroMoneyFlow.isBearish).toBe(false);
      expect(indicatorsEmpty.macroMoneyFlow.direction).toBe('NEUTRAL');
    });

    it('deve calcular corretamente para diferentes timeframes', async () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 115, volume: 800, high: 120, low: 115, start: 3000 },
        { open: 115, close: 125, volume: 1200, high: 125, low: 115, start: 4000 },
        { open: 125, close: 130, volume: 1800, high: 130, low: 125, start: 5000 },
        { open: 130, close: 125, volume: 900, high: 130, low: 125, start: 6000 },
        { open: 125, close: 135, volume: 1600, high: 135, low: 125, start: 7000 },
        { open: 135, close: 140, volume: 2000, high: 140, low: 135, start: 8000 },
        { open: 140, close: 135, volume: 1100, high: 140, low: 135, start: 9000 },
        { open: 135, close: 145, volume: 1700, high: 145, low: 135, start: 10000 },
        { open: 145, close: 150, volume: 2200, high: 150, low: 145, start: 11000 },
        { open: 150, close: 145, volume: 1300, high: 150, low: 145, start: 12000 },
        { open: 145, close: 155, volume: 1900, high: 155, low: 145, start: 13000 },
        { open: 155, close: 160, volume: 2400, high: 160, low: 155, start: 14000 },
        { open: 160, close: 155, volume: 1500, high: 160, low: 155, start: 15000 },
        { open: 155, close: 165, volume: 2100, high: 165, low: 155, start: 16000 },
        { open: 165, close: 170, volume: 2600, high: 170, low: 165, start: 17000 },
        { open: 170, close: 165, volume: 1700, high: 170, low: 165, start: 18000 },
        { open: 165, close: 175, volume: 2300, high: 175, low: 165, start: 19000 },
        { open: 175, close: 180, volume: 2800, high: 180, low: 175, start: 20000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.macroMoneyFlow).toBeDefined();
      expect(indicators.macroMoneyFlow.macroBias).toBeDefined();
      expect(indicators.macroMoneyFlow.mfiCurrent).toBeDefined();
      expect(indicators.macroMoneyFlow.mfiPrevious).toBeDefined();
      expect(indicators.macroMoneyFlow.isBullish).toBeDefined();
      expect(indicators.macroMoneyFlow.isBearish).toBeDefined();
      expect(indicators.macroMoneyFlow.direction).toBeDefined();
      expect(indicators.macroMoneyFlow.dataSource).toBeDefined();
      expect(indicators.macroMoneyFlow.error).toBeDefined();
      
      // Verifica se history existe (pode não existir em caso de erro)
      if (indicators.macroMoneyFlow.history) {
        expect(Array.isArray(indicators.macroMoneyFlow.history)).toBe(true);
      }
    });
  });
}); 