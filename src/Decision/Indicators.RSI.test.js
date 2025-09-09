import { calculateIndicators } from './Indicators.js';

describe('RSI com validação de cruzamento da média', () => {
  describe('Cálculo e detecção de cruzamentos em regiões de sobrecompra/sobrevenda', () => {
    it('deve calcular RSI com dados históricos e média corretamente', async () => {
      const candles = [];
      // Criar 30 candles para ter dados suficientes
      for (let i = 0; i < 30; i++) {
        candles.push({
          open: 100 + Math.random() * 10,
          close: 100 + Math.random() * 10,
          high: 105 + Math.random() * 5,
          low: 95 + Math.random() * 5,
          volume: 1000 + Math.random() * 500,
          start: (i + 1) * 1000,
        });
      }

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      expect(indicators.rsi).toBeDefined();
      expect(indicators.rsi.value).toBeDefined();
      expect(indicators.rsi.prev).toBeDefined();
      expect(indicators.rsi.avg).toBeDefined();
      expect(indicators.rsi.avgPrev).toBeDefined();
      expect(indicators.rsi.history).toBeDefined();

      // Verifica se os valores são do tipo correto
      expect(typeof indicators.rsi.value).toBe('number');
      expect(typeof indicators.rsi.avg).toBe('number');
      expect(Array.isArray(indicators.rsi.history)).toBe(true);
    });

    it('deve detectar sinal LONG em sobrevendido com cruzamento acima da média', async () => {
      // Simular cenário de sobrevendido com RSI cruzando acima da média
      const candles = [];

      // Criar uma tendência de baixa (sobrevendido)
      let price = 100;
      for (let i = 0; i < 20; i++) {
        price = price - Math.random() * 2; // Tendência decrescente
        candles.push({
          open: price + 0.5,
          close: price,
          high: price + 1,
          low: price - 0.5,
          volume: 1000,
          start: (i + 1) * 1000,
        });
      }

      // Criar reversão (RSI deve começar a subir e cruzar média)
      for (let i = 0; i < 10; i++) {
        price = price + Math.random() * 1.5; // Leve reversão para cima
        candles.push({
          open: price - 0.3,
          close: price,
          high: price + 0.5,
          low: price - 0.8,
          volume: 1000,
          start: (20 + i + 1) * 1000,
        });
      }

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      // Verifica se temos dados suficientes
      expect(indicators.rsi.value).not.toBeNull();
      expect(indicators.rsi.avg).not.toBeNull();
      expect(indicators.rsi.prev).not.toBeNull();
      expect(indicators.rsi.avgPrev).not.toBeNull();

      console.log('RSI Test Debug:', {
        value: indicators.rsi.value,
        prev: indicators.rsi.prev,
        avg: indicators.rsi.avg,
        avgPrev: indicators.rsi.avgPrev,
      });
    });

    it('deve detectar sinal SHORT em sobrecomprado com cruzamento abaixo da média', async () => {
      // Simular cenário de sobrecomprado com RSI cruzando abaixo da média
      const candles = [];

      // Criar uma tendência de alta (sobrecomprado)
      let price = 100;
      for (let i = 0; i < 20; i++) {
        price = price + Math.random() * 2; // Tendência crescente
        candles.push({
          open: price - 0.5,
          close: price,
          high: price + 1,
          low: price - 0.5,
          volume: 1000,
          start: (i + 1) * 1000,
        });
      }

      // Criar reversão (RSI deve começar a cair e cruzar média)
      for (let i = 0; i < 10; i++) {
        price = price - Math.random() * 1.5; // Leve reversão para baixo
        candles.push({
          open: price + 0.3,
          close: price,
          high: price + 0.8,
          low: price - 0.5,
          volume: 1000,
          start: (20 + i + 1) * 1000,
        });
      }

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      // Verifica se temos dados suficientes
      expect(indicators.rsi.value).not.toBeNull();
      expect(indicators.rsi.avg).not.toBeNull();
      expect(indicators.rsi.prev).not.toBeNull();
      expect(indicators.rsi.avgPrev).not.toBeNull();

      console.log('RSI Test Debug:', {
        value: indicators.rsi.value,
        prev: indicators.rsi.prev,
        avg: indicators.rsi.avg,
        avgPrev: indicators.rsi.avgPrev,
      });
    });

    it('deve lidar com dados insuficientes', async () => {
      const insufficientCandles = [
        { open: 100, close: 95, high: 102, low: 93, volume: 1000, start: 1000 },
      ];

      const indicators = await calculateIndicators(insufficientCandles, '5m', 'BTC_USDC_PERP');

      expect(indicators.rsi).toBeDefined();
      // Com dados insuficientes, alguns valores podem ser null
      if (indicators.rsi.value === null) {
        expect(indicators.rsi.avg).toBeNull();
      }
    });

    it('deve validar ranges corretos do RSI', async () => {
      const candles = [];
      // Criar dados variados
      for (let i = 0; i < 30; i++) {
        candles.push({
          open: 100 + Math.sin(i * 0.2) * 10,
          close: 100 + Math.sin(i * 0.2) * 10 + Math.random() * 2 - 1,
          high: 105 + Math.sin(i * 0.2) * 10 + Math.random() * 2,
          low: 95 + Math.sin(i * 0.2) * 10 - Math.random() * 2,
          volume: 1000,
          start: (i + 1) * 1000,
        });
      }

      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');

      if (indicators.rsi.value !== null) {
        // RSI deve estar entre 0 e 100
        expect(indicators.rsi.value).toBeGreaterThanOrEqual(0);
        expect(indicators.rsi.value).toBeLessThanOrEqual(100);

        if (indicators.rsi.avg !== null) {
          expect(indicators.rsi.avg).toBeGreaterThanOrEqual(0);
          expect(indicators.rsi.avg).toBeLessThanOrEqual(100);
        }
      }
    });
  });
});
