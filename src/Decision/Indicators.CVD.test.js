import { calculateIndicators } from './Indicators.js';

describe('CVD Periódico e Divergências', () => {
  
  describe('Cálculo do CVD Periódico', () => {
    it('deve calcular o CVD corretamente para velas de alta', () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      expect(indicators.cvd).toBeDefined();
      expect(indicators.cvd.values).toBeDefined();
      expect(indicators.cvd.current).toBeDefined();
      
      // Para o período 8, o CVD deve ser a soma dos deltas das últimas 8 velas
      // Vela 1: +1000 (alta), Vela 2: +1500 (alta), Vela 3: +800 (alta)
      // Total esperado: 3300
      expect(indicators.cvd.current).toBe(3300);
    });

    it('deve calcular o CVD corretamente para velas de baixa', () => {
      const candles = [
        { open: 100, close: 90, volume: 1000, high: 100, low: 90, start: 1000 },
        { open: 90, close: 80, volume: 1500, high: 90, low: 80, start: 2000 },
        { open: 80, close: 75, volume: 800, high: 80, low: 75, start: 3000 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      // Vela 1: -1000 (baixa), Vela 2: -1500 (baixa), Vela 3: -800 (baixa)
      // Total esperado: -3300
      expect(indicators.cvd.current).toBe(-3300);
    });

    it('deve calcular o CVD corretamente para velas mistas', () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 }, // +1000
        { open: 110, close: 105, volume: 1500, high: 110, low: 105, start: 2000 }, // -1500
        { open: 105, close: 115, volume: 800, high: 115, low: 105, start: 3000 }   // +800
      ];
      
      const indicators = calculateIndicators(candles);
      
      // Total esperado: +1000 - 1500 + 800 = +300
      expect(indicators.cvd.current).toBe(300);
    });

    it('deve lidar com velas com preço de abertura igual ao fechamento', () => {
      const candles = [
        { open: 100, close: 100, volume: 1000, high: 100, low: 100, start: 1000 }, // 0
        { open: 100, close: 110, volume: 1500, high: 110, low: 100, start: 2000 }, // +1500
        { open: 110, close: 110, volume: 800, high: 110, low: 110, start: 3000 }   // 0
      ];
      
      const indicators = calculateIndicators(candles);
      
      // Total esperado: 0 + 1500 + 0 = 1500
      expect(indicators.cvd.current).toBe(1500);
    });
  });

  describe('Detecção de Divergências', () => {
    it('deve detectar uma DIVERGÊNCIA BULLISH corretamente', () => {
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
      
      const indicators = calculateIndicators(candles);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(true);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve detectar uma DIVERGÊNCIA BEARISH corretamente', () => {
      // Cria dados mock onde o preço faz um topo mais alto e o volume na segunda subida é menor
      const candles = [
        // Primeira subida - preço baixo, volume alto
        { open: 50, close: 55, volume: 2000, high: 55, low: 50, start: 1000, quoteVolume: 2000 },
        { open: 55, close: 60, volume: 1800, high: 60, low: 55, start: 2000, quoteVolume: 1800 },
        { open: 60, close: 65, volume: 1600, high: 65, low: 60, start: 3000, quoteVolume: 1600 },
        { open: 65, close: 70, volume: 1400, high: 70, low: 65, start: 4000, quoteVolume: 1400 },
        { open: 70, close: 75, volume: 1200, high: 75, low: 70, start: 5000, quoteVolume: 1200 },
        // Queda
        { open: 75, close: 70, volume: 1000, high: 75, low: 70, start: 6000, quoteVolume: 1000 },
        { open: 70, close: 65, volume: 1200, high: 70, low: 65, start: 7000, quoteVolume: 1200 },
        { open: 65, close: 60, volume: 1400, high: 65, low: 60, start: 8000, quoteVolume: 1400 },
        { open: 60, close: 55, volume: 1600, high: 60, low: 55, start: 9000, quoteVolume: 1600 },
        { open: 55, close: 50, volume: 1800, high: 55, low: 50, start: 10000, quoteVolume: 1800 },
        { open: 50, close: 45, volume: 2000, high: 50, low: 45, start: 11000, quoteVolume: 2000 },
        // Segunda subida - preço MAIS ALTO, mas volume menor (divergência bearish)
        { open: 45, close: 50, volume: 800, high: 50, low: 45, start: 12000, quoteVolume: 800 },
        { open: 50, close: 55, volume: 600, high: 55, low: 50, start: 13000, quoteVolume: 600 },
        { open: 55, close: 60, volume: 400, high: 60, low: 55, start: 14000, quoteVolume: 400 },
        { open: 60, close: 65, volume: 200, high: 65, low: 60, start: 15000, quoteVolume: 200 },
        { open: 65, close: 70, volume: 100, high: 70, low: 65, start: 16000, quoteVolume: 100 },
        { open: 70, close: 75, volume: 50, high: 75, low: 70, start: 17000, quoteVolume: 50 },
        { open: 75, close: 80, volume: 25, high: 80, low: 75, start: 18000, quoteVolume: 25 },
        // Queda
        { open: 80, close: 75, volume: 300, high: 80, low: 75, start: 19000, quoteVolume: 300 },
        { open: 75, close: 70, volume: 500, high: 75, low: 70, start: 20000, quoteVolume: 500 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(true);
    });

    it('NÃO deve detectar divergência quando preço e CVD estão em confluência', () => {
      // Cria dados mock onde preço e volume seguem a mesma tendência
      const candles = [
        // Tendência de alta consistente
        { open: 50, close: 55, volume: 1000, high: 55, low: 50, start: 1000 },
        { open: 55, close: 60, volume: 1200, high: 60, low: 55, start: 2000 },
        { open: 60, close: 65, volume: 1400, high: 65, low: 60, start: 3000 },
        { open: 65, close: 70, volume: 1600, high: 70, low: 65, start: 4000 },
        { open: 70, close: 75, volume: 1800, high: 75, low: 70, start: 5000 },
        { open: 75, close: 80, volume: 2000, high: 80, low: 75, start: 6000 },
        { open: 80, close: 85, volume: 2200, high: 85, low: 80, start: 7000 },
        { open: 85, close: 90, volume: 2400, high: 90, low: 85, start: 8000 },
        { open: 90, close: 95, volume: 2600, high: 95, low: 90, start: 9000 },
        { open: 95, close: 100, volume: 2800, high: 100, low: 95, start: 10000 },
        { open: 100, close: 105, volume: 3000, high: 105, low: 100, start: 11000 },
        { open: 105, close: 110, volume: 3200, high: 110, low: 105, start: 12000 },
        { open: 110, close: 115, volume: 3400, high: 115, low: 110, start: 13000 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve lidar com dados insuficientes', () => {
      // Dados com menos de 10 candles
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });

    it('deve lidar com dados vazios', () => {
      const indicators = calculateIndicators([]);
      
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBe(false);
      expect(indicators.cvdDivergence.bearish).toBe(false);
    });
  });

  describe('Integração com calculateIndicators', () => {
    it('deve incluir CVD e divergências no objeto de retorno', () => {
      const candles = [
        { open: 100, close: 110, volume: 1000, high: 110, low: 100, start: 1000 },
        { open: 110, close: 120, volume: 1500, high: 120, low: 110, start: 2000 },
        { open: 120, close: 125, volume: 800, high: 125, low: 120, start: 3000 }
      ];
      
      const indicators = calculateIndicators(candles);
      
      // Verifica se o CVD está presente
      expect(indicators.cvd).toBeDefined();
      expect(indicators.cvd.values).toBeDefined();
      expect(indicators.cvd.current).toBeDefined();
      expect(indicators.cvd.history).toBeDefined();
      
      // Verifica se as divergências estão presentes
      expect(indicators.cvdDivergence).toBeDefined();
      expect(indicators.cvdDivergence.bullish).toBeDefined();
      expect(indicators.cvdDivergence.bearish).toBeDefined();
      
      // Verifica se os valores são do tipo correto
      expect(Array.isArray(indicators.cvd.values)).toBe(true);
      expect(typeof indicators.cvd.current).toBe('number');
      expect(typeof indicators.cvdDivergence.bullish).toBe('boolean');
      expect(typeof indicators.cvdDivergence.bearish).toBe('boolean');
    });
  });
}); 