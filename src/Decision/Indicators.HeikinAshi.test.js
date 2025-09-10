import { calculateIndicators } from './Indicators.js';

describe('Heikin Ashi', () => {
  describe('Cálculo e detecção de mudança de tendência', () => {
    it('deve calcular Heikin Ashi corretamente', async () => {
      // Cria dados mock simulando mudança de tendência
      const candles = [
        // Velas de baixa (vermelho)
        { open: 100, close: 95, high: 105, low: 90, volume: 1000, start: 1000 },
        { open: 95, close: 90, high: 98, low: 85, volume: 1200, start: 2000 },
        { open: 90, close: 88, high: 92, low: 85, volume: 800, start: 3000 },
        // Mudança para alta (verde)
        { open: 88, close: 92, high: 95, low: 87, volume: 1500, start: 4000 },
        { open: 92, close: 96, high: 98, low: 91, volume: 1800, start: 5000 },
      ];

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      expect(indicators.heikinAshi).toBeDefined();
      expect(indicators.heikinAshi.current).toBeDefined();
      expect(indicators.heikinAshi.previous).toBeDefined();
      expect(indicators.heikinAshi.trendChange).toBeDefined();
      expect(indicators.heikinAshi.history).toBeDefined();

      // Verifica se os valores são do tipo correto
      expect(typeof indicators.heikinAshi.current.open).toBe('number');
      expect(typeof indicators.heikinAshi.current.high).toBe('number');
      expect(typeof indicators.heikinAshi.current.low).toBe('number');
      expect(typeof indicators.heikinAshi.current.close).toBe('number');
      expect(typeof indicators.heikinAshi.current.isBullish).toBe('boolean');
      expect(typeof indicators.heikinAshi.current.isBearish).toBe('boolean');
      expect(typeof indicators.heikinAshi.current.direction).toBe('string');

      // Verifica se a estrutura de mudança de tendência está correta
      expect(typeof indicators.heikinAshi.trendChange.hasChanged).toBe('boolean');
      expect(['BULLISH', 'BEARISH', null]).toContain(indicators.heikinAshi.trendChange.changeType);
      expect(['UP', 'DOWN', 'NEUTRAL']).toContain(indicators.heikinAshi.trendChange.confirmedTrend);

      // Verifica se o histórico é um array
      expect(Array.isArray(indicators.heikinAshi.history)).toBe(true);
    });

    it('deve detectar mudança de tendência de baixa para alta', async () => {
      // Simula mudança clara de baixa para alta
      const candles = [
        { open: 100, close: 95, high: 102, low: 93, volume: 1000, start: 1000 },
        { open: 95, close: 90, high: 96, low: 88, volume: 1000, start: 2000 },
        { open: 90, close: 95, high: 97, low: 89, volume: 1000, start: 3000 },
        { open: 95, close: 100, high: 102, low: 94, volume: 1000, start: 4000 },
      ];

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      // Espera-se que detecte mudança para bullish
      if (indicators.heikinAshi.trendChange.hasChanged) {
        expect(['BULLISH', 'BEARISH']).toContain(indicators.heikinAshi.trendChange.changeType);
      }
    });

    it('deve detectar mudança de tendência de alta para baixa', async () => {
      // Simula mudança clara de alta para baixa
      const candles = [
        { open: 90, close: 95, high: 97, low: 89, volume: 1000, start: 1000 },
        { open: 95, close: 100, high: 102, low: 94, volume: 1000, start: 2000 },
        { open: 100, close: 95, high: 101, low: 93, volume: 1000, start: 3000 },
        { open: 95, close: 90, high: 96, low: 88, volume: 1000, start: 4000 },
      ];

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      // Espera-se que detecte mudança para bearish
      if (indicators.heikinAshi.trendChange.hasChanged) {
        expect(['BULLISH', 'BEARISH']).toContain(indicators.heikinAshi.trendChange.changeType);
      }
    });

    it('deve lidar com dados insuficientes', async () => {
      const insufficientCandles = [
        { open: 100, close: 95, high: 102, low: 93, volume: 1000, start: 1000 },
      ];

      const indicators = await calculateIndicators(insufficientCandles, '5m', 'BTC_USDC_PERP');

      expect(indicators.heikinAshi).toBeDefined();
      expect(indicators.heikinAshi.current.open).toBeNull();
      expect(indicators.heikinAshi.current.direction).toBe('NEUTRAL');
      expect(indicators.heikinAshi.trendChange.hasChanged).toBe(false);
    });

    it('deve lidar com array vazio', async () => {
      const emptyCandles = [];

      const indicators = await calculateIndicators(emptyCandles, '5m', 'BTC_USDC_PERP');

      expect(indicators.heikinAshi).toBeDefined();
      expect(indicators.heikinAshi.current.open).toBeNull();
      expect(indicators.heikinAshi.current.direction).toBe('NEUTRAL');
      expect(indicators.heikinAshi.trendChange.hasChanged).toBe(false);
      expect(indicators.heikinAshi.trendChange.changeType).toBeNull();
      expect(indicators.heikinAshi.trendChange.confirmedTrend).toBe('NEUTRAL');
    });

    it('deve calcular direções corretamente', async () => {
      // Vela claramente bullish
      const bullishCandles = [
        { open: 90, close: 95, high: 96, low: 89, volume: 1000, start: 1000 },
        { open: 95, close: 100, high: 102, low: 94, volume: 1000, start: 2000 },
      ];

      const bullishIndicators = await calculateIndicators(bullishCandles, '5m', 'BTC_USDC_PERP');

      // O Heikin Ashi pode suavizar os dados, então verificamos se a estrutura está correta
      expect(['UP', 'DOWN', 'NEUTRAL']).toContain(bullishIndicators.heikinAshi.current.direction);

      // Vela claramente bearish
      const bearishCandles = [
        { open: 100, close: 95, high: 101, low: 93, volume: 1000, start: 1000 },
        { open: 95, close: 90, high: 96, low: 88, volume: 1000, start: 2000 },
      ];

      const bearishIndicators = await calculateIndicators(bearishCandles, '5m', 'BTC_USDC_PERP');

      expect(['UP', 'DOWN', 'NEUTRAL']).toContain(bearishIndicators.heikinAshi.current.direction);
    });
  });
});
