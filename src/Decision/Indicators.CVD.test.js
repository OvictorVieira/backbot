import { calculateIndicators } from './Indicators.js';

describe('CVD Periódico e Divergências', () => {
  
  describe('Cálculo do CVD Periódico', () => {
    it('deve calcular o CVD corretamente para velas de alta', async () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvd).toBeDefined();
      expect(indicators.cvd.values).toBeDefined();
      expect(indicators.cvd.current).toBeDefined();
      
      // Para o período 8, o CVD deve ser a soma dos deltas das últimas 8 velas
      // Vela 1: +1000 (alta), Vela 2: +1500 (alta), Vela 3: +800 (alta)
      // Total esperado: 3300
      expect(indicators.cvd.current).toBe(3300);
    });

    it('deve calcular o CVD corretamente para velas de baixa', async () => {
      const candles = [
        { open: 100, close: 90, volume: 1000, high: 100, low: 90, start: 1000 },
        { open: 90, close: 80, volume: 1500, high: 90, low: 80, start: 2000 },
        { open: 80, close: 75, volume: 800, high: 80, low: 75, start: 3000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      // Vela 1: -1000 (baixa), Vela 2: -1500 (baixa), Vela 3: -800 (baixa)
      // Total esperado: -3300
      expect(indicators.cvd.current).toBe(-3300);
    });

    it('deve calcular o CVD corretamente para velas mistas', async () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 }, // +1000
        { open: 110, close: 105, volume: 1500, high: 110, low: 105, start: 2000 }, // -1500
        { open: 105, close: 115, volume: 800, high: 115, low: 105, start: 3000 }   // +800
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      // Total esperado: +1000 - 1500 + 800 = +300
      expect(indicators.cvd.current).toBe(300);
    });

    it('deve lidar com velas com preço de abertura igual ao fechamento', async () => {
      const candles = [
        { open: 100, close: 100, volume: 1000, high: 100, low: 100, start: 1000 }, // 0
        { open: 100, close: 110, volume: 1500, high: 110, low: 100, start: 2000 }, // +1500
        { open: 110, close: 110, volume: 800, high: 110, low: 110, start: 3000 }   // 0
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      // Total esperado: 0 + 1500 + 0 = 1500
      expect(indicators.cvd.current).toBe(1500);
    });
  });

  describe('Detecção de Divergências', () => {
    it('deve detectar uma DIVERGÊNCIA BULLISH corretamente', async () => {
      // Cria dados mock onde o preço faz um fundo mais baixo e o volume na segunda queda é menor
      const candles = [
        // Primeira queda - preço alto, volume alto
        { open: 100, close: 90, volume: 2000, high: 100, low: 90, start: 1000, quoteVolume: 2000 },
        { open: 90, close: 80, volume: 1800, high: 90, low: 80, start: 2000, quoteVolume: 1800 },
        { open: 80, close: 70, volume: 1600, high: 80, low: 70, start: 3000, quoteVolume: 1600 },
        { open: 70, close: 60, volume: 1400, high: 70, low: 60, start: 4000, quoteVolume: 1400 },
        { open: 60, close: 50, volume: 1200, high: 60, low: 50, start: 5000, quoteVolume: 1200 },
        // Recuperação
        { open: 50, close: 60, volume: 1000, high: 60, low: 50, start: 6000, quoteVolume: 1000 },
        { open: 60, close: 70, volume: 1200, high: 70, low: 60, start: 7000, quoteVolume: 1200 },
        { open: 70, close: 80, volume: 1400, high: 80, low: 70, start: 8000, quoteVolume: 1400 },
        { open: 80, close: 90, volume: 1600, high: 90, low: 80, start: 9000, quoteVolume: 1600 },
        { open: 90, close: 100, volume: 1800, high: 100, low: 90, start: 10000, quoteVolume: 1800 },
        { open: 100, close: 110, volume: 2000, high: 110, low: 100, start: 11000, quoteVolume: 2000 },
        // Segunda queda - preço MAIS BAIXO, mas volume menor (divergência bullish)
        { open: 110, close: 100, volume: 800, high: 110, low: 100, start: 12000, quoteVolume: 800 },
        { open: 100, close: 90, volume: 600, high: 100, low: 90, start: 13000, quoteVolume: 600 },
        { open: 90, close: 80, volume: 400, high: 90, low: 80, start: 14000, quoteVolume: 400 },
        { open: 80, close: 70, volume: 200, high: 80, low: 70, start: 15000, quoteVolume: 200 },
        { open: 70, close: 60, volume: 100, high: 70, low: 60, start: 16000, quoteVolume: 100 },
        { open: 60, close: 50, volume: 50, high: 60, low: 50, start: 17000, quoteVolume: 50 },
        { open: 50, close: 40, volume: 25, high: 50, low: 40, start: 18000, quoteVolume: 25 },
        // Recuperação
        { open: 40, close: 50, volume: 300, high: 50, low: 40, start: 19000, quoteVolume: 300 },
        { open: 50, close: 60, volume: 500, high: 60, low: 50, start: 20000, quoteVolume: 500 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(true);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve detectar uma DIVERGÊNCIA BEARISH corretamente', async () => {
      // Cria dados mock onde o preço faz um topo mais alto mas o volume na segunda alta é menor
      const candles = [
        // Primeira alta - preço baixo, volume alto
        { open: 50, close: 60, volume: 2000, high: 60, low: 50, start: 1000, quoteVolume: 2000 },
        { open: 60, close: 70, volume: 1800, high: 70, low: 60, start: 2000, quoteVolume: 1800 },
        { open: 70, close: 80, volume: 1600, high: 80, low: 70, start: 3000, quoteVolume: 1600 },
        { open: 80, close: 90, volume: 1400, high: 90, low: 80, start: 4000, quoteVolume: 1400 },
        { open: 90, close: 100, volume: 1200, high: 100, low: 90, start: 5000, quoteVolume: 1200 },
        // Queda
        { open: 100, close: 90, volume: 1000, high: 100, low: 90, start: 6000, quoteVolume: 1000 },
        { open: 90, close: 80, volume: 1200, high: 90, low: 80, start: 7000, quoteVolume: 1200 },
        { open: 80, close: 70, volume: 1400, high: 80, low: 70, start: 8000, quoteVolume: 1400 },
        { open: 70, close: 60, volume: 1600, high: 70, low: 60, start: 9000, quoteVolume: 1600 },
        { open: 60, close: 50, volume: 1800, high: 60, low: 50, start: 10000, quoteVolume: 1800 },
        { open: 50, close: 40, volume: 2000, high: 50, low: 40, start: 11000, quoteVolume: 2000 },
        // Segunda alta - preço MAIS ALTO, mas volume menor (divergência bearish)
        { open: 40, close: 50, volume: 800, high: 50, low: 40, start: 12000, quoteVolume: 800 },
        { open: 50, close: 60, volume: 600, high: 60, low: 50, start: 13000, quoteVolume: 600 },
        { open: 60, close: 70, volume: 400, high: 70, low: 60, start: 14000, quoteVolume: 400 },
        { open: 70, close: 80, volume: 200, high: 80, low: 70, start: 15000, quoteVolume: 200 },
        { open: 80, close: 90, volume: 100, high: 90, low: 80, start: 16000, quoteVolume: 100 },
        { open: 90, close: 100, volume: 50, high: 100, low: 90, start: 17000, quoteVolume: 50 },
        { open: 100, close: 110, volume: 25, high: 110, low: 100, start: 18000, quoteVolume: 25 },
        // Queda
        { open: 110, close: 100, volume: 300, high: 110, low: 100, start: 19000, quoteVolume: 300 },
        { open: 100, close: 90, volume: 500, high: 100, low: 90, start: 20000, quoteVolume: 500 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(true);
    });

    it('deve retornar false quando não há divergência', async () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 130, volume: 2000, high: 130, low: 120, start: 3000 },
        { open: 130, close: 120, volume: 1800, high: 130, low: 120, start: 4000 },
        { open: 120, close: 110, volume: 1600, high: 120, low: 110, start: 5000 },
        { open: 110, close: 120, volume: 1400, high: 120, low: 110, start: 6000 },
        { open: 120, close: 130, volume: 1200, high: 130, low: 120, start: 7000 },
        { open: 130, close: 140, volume: 1000, high: 140, low: 130, start: 8000 },
        { open: 140, close: 150, volume: 800, high: 150, low: 140, start: 9000 },
        { open: 150, close: 160, volume: 600, high: 160, low: 150, start: 10000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve lidar com dados insuficientes', async () => {
      // Dados com menos de 10 candles
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve lidar com dados vazios', async () => {
      const indicators = await calculateIndicators([], '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });
  });

  describe('Integração com calculateIndicators', () => {
    it('deve incluir CVD e divergências no objeto de retorno', async () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = await calculateIndicators(candles, '5m', 'BTC_USDC_PERP');
      
      // Verifica se os novos campos estão presentes
      expect(indicators.cvd).toBeDefined();
      expect(indicators.cvd.values).toBeDefined();
      expect(indicators.cvd.current).toBeDefined();
      expect(indicators.cvd.history).toBeDefined();
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBeDefined();
      expect(indicators.cvdDivergence.bearish).toBeDefined();
      
      // Verifica se os campos antigos ainda estão presentes
      expect(indicators.ema).toBeDefined();
      expect(indicators.rsi).toBeDefined();
      expect(indicators.macd).toBeDefined();
    });

    it('deve lidar com array vazio', async () => {
      const indicators = await calculateIndicators([], '5m', 'BTC_USDC_PERP');
      
      expect(indicators.cvd).toBeDefined();
      expect(indicators.cvd.values).toEqual([]);
      expect(indicators.cvd.current).toBeNull();
      expect(indicators.cvd.history).toEqual([]);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });
  });
}); 