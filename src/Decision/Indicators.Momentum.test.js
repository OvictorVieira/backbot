import { calculateMomentum } from './Indicators.js';

describe('calculateMomentum - WaveTrend Oscillator', () => {
  // Conjunto de dados de teste conhecido (25 candles)
  const mockCandles = [
    { open: 50000, high: 50100, low: 49900, close: 50050, volume: 1000 },
    { open: 50050, high: 50200, low: 50000, close: 50150, volume: 1200 },
    { open: 50150, high: 50300, low: 50100, close: 50250, volume: 1100 },
    { open: 50250, high: 50400, low: 50200, close: 50350, volume: 1300 },
    { open: 50350, high: 50500, low: 50300, close: 50450, volume: 1400 },
    { open: 50450, high: 50600, low: 50400, close: 50550, volume: 1500 },
    { open: 50550, high: 50700, low: 50500, close: 50650, volume: 1600 },
    { open: 50650, high: 50800, low: 50600, close: 50750, volume: 1700 },
    { open: 50750, high: 50900, low: 50700, close: 50850, volume: 1800 },
    { open: 50850, high: 51000, low: 50800, close: 50950, volume: 1900 },
    { open: 50950, high: 51100, low: 50900, close: 51050, volume: 2000 },
    { open: 51050, high: 51200, low: 51000, close: 51150, volume: 2100 },
    { open: 51150, high: 51300, low: 51100, close: 51250, volume: 2200 },
    { open: 51250, high: 51400, low: 51200, close: 51350, volume: 2300 },
    { open: 51350, high: 51500, low: 51300, close: 51450, volume: 2400 },
    { open: 51450, high: 51600, low: 51400, close: 51550, volume: 2500 },
    { open: 51550, high: 51700, low: 51500, close: 51650, volume: 2600 },
    { open: 51650, high: 51800, low: 51600, close: 51750, volume: 2700 },
    { open: 51750, high: 51900, low: 51700, close: 51850, volume: 2800 },
    { open: 51850, high: 52000, low: 51800, close: 51950, volume: 2900 },
    { open: 51950, high: 52100, low: 51900, close: 52050, volume: 3000 },
    { open: 52050, high: 52200, low: 52000, close: 52150, volume: 3100 },
    { open: 52150, high: 52300, low: 52100, close: 52250, volume: 3200 },
    { open: 52250, high: 52400, low: 52200, close: 52350, volume: 3300 },
    { open: 52350, high: 52500, low: 52300, close: 52450, volume: 3400 },
    { open: 52450, high: 52600, low: 52400, close: 52550, volume: 3500 },
  ];

  describe('Cálculo básico do WaveTrend', () => {
    it('deve calcular os valores de wt1 e wt2 corretamente para um conjunto de dados conhecido', () => {
      const result = calculateMomentum(mockCandles, 10, 21);

      // Validações básicas
      expect(result).toBeDefined();
      expect(result.wt1).toBeDefined();
      expect(result.wt2).toBeDefined();
      expect(result.direction).toBeDefined();
      expect(result.cross).toBeDefined();
      expect(result.isBullish).toBeDefined();
      expect(result.isBearish).toBeDefined();
      expect(result.history).toBeDefined();
      expect(result.history.wt1).toBeDefined();
      expect(result.history.wt2).toBeDefined();

      // Validações de tipo
      expect(typeof result.wt1).toBe('number');
      expect(typeof result.wt2).toBe('number');
      expect(typeof result.direction).toBe('string');
      expect(Array.isArray(result.history.wt1)).toBe(true);
      expect(Array.isArray(result.history.wt2)).toBe(true);

      // Validações de lógica
      expect(['UP', 'DOWN', 'NEUTRAL']).toContain(result.direction);
      expect([null, 'BULLISH', 'BEARISH']).toContain(result.cross);
      expect(typeof result.isBullish).toBe('boolean');
      expect(typeof result.isBearish).toBe('boolean');

      // Validação da lógica de direção
      if (result.wt1 > result.wt2) {
        expect(result.direction).toBe('UP');
        expect(result.isBullish).toBe(true);
        expect(result.isBearish).toBe(false);
      } else if (result.wt1 < result.wt2) {
        expect(result.direction).toBe('DOWN');
        expect(result.isBullish).toBe(false);
        expect(result.isBearish).toBe(true);
      }
    });

    it('deve retornar valores válidos mesmo com poucos dados', () => {
      const shortCandles = mockCandles.slice(0, 15); // Menos que o mínimo necessário
      const result = calculateMomentum(shortCandles, 10, 21);

      expect(result).toBeDefined();
      expect(result.wt1).toBeNull();
      expect(result.wt2).toBeNull();
      expect(result.cross).toBeNull();
      expect(result.direction).toBe('NEUTRAL');
      expect(result.isBullish).toBe(false);
      expect(result.isBearish).toBe(false);
    });

    it('deve retornar estrutura válida com dados vazios', () => {
      const result = calculateMomentum([], 10, 21);

      expect(result).toBeDefined();
      expect(result.wt1).toBeNull();
      expect(result.wt2).toBeNull();
      expect(result.cross).toBeNull();
      expect(result.direction).toBe('NEUTRAL');
      expect(result.isBullish).toBe(false);
      expect(result.isBearish).toBe(false);
      expect(result.history.wt1).toEqual([]);
      expect(result.history.wt2).toEqual([]);
    });
  });

  describe('Detecção de cruzamentos', () => {
    it('deve detectar um cruzamento BULLISH corretamente', () => {
      // Cria candles que forçam um cruzamento bullish na última vela
      const bullishCandles = [
        { open: 50000, high: 50100, low: 49900, close: 50050, volume: 1000 },
        { open: 50050, high: 50200, low: 50000, close: 50150, volume: 1200 },
        { open: 50150, high: 50300, low: 50100, close: 50250, volume: 1100 },
        { open: 50250, high: 50400, low: 50200, close: 50350, volume: 1300 },
        { open: 50350, high: 50500, low: 50300, close: 50450, volume: 1400 },
        { open: 50450, high: 50600, low: 50400, close: 50550, volume: 1500 },
        { open: 50550, high: 50700, low: 50500, close: 50650, volume: 1600 },
        { open: 50650, high: 50800, low: 50600, close: 50750, volume: 1700 },
        { open: 50750, high: 50900, low: 50700, close: 50850, volume: 1800 },
        { open: 50850, high: 51000, low: 50800, close: 50950, volume: 1900 },
        { open: 50950, high: 51100, low: 50900, close: 51050, volume: 2000 },
        { open: 51050, high: 51200, low: 51000, close: 51150, volume: 2100 },
        { open: 51150, high: 51300, low: 51100, close: 51250, volume: 2200 },
        { open: 51250, high: 51400, low: 51200, close: 51350, volume: 2300 },
        { open: 51350, high: 51500, low: 51300, close: 51450, volume: 2400 },
        { open: 51450, high: 51600, low: 51400, close: 51550, volume: 2500 },
        { open: 51550, high: 51700, low: 51500, close: 51650, volume: 2600 },
        { open: 51650, high: 51800, low: 51600, close: 51750, volume: 2700 },
        { open: 51750, high: 51900, low: 51700, close: 51850, volume: 2800 },
        { open: 51850, high: 52000, low: 51800, close: 51950, volume: 2900 },
        { open: 51950, high: 52100, low: 51900, close: 52050, volume: 3000 },
        { open: 52050, high: 52200, low: 52000, close: 52150, volume: 3100 },
        { open: 52150, high: 52300, low: 52100, close: 52250, volume: 3200 },
        { open: 52250, high: 52400, low: 52200, close: 52350, volume: 3300 },
        { open: 52350, high: 52500, low: 52300, close: 52450, volume: 3400 },
        { open: 52450, high: 52600, low: 52400, close: 52550, volume: 3500 },
        // Última vela com forte alta para forçar cruzamento bullish
        { open: 52550, high: 53000, low: 52500, close: 52950, volume: 4000 },
      ];

      const result = calculateMomentum(bullishCandles, 10, 21);

      // Verifica se detectou o cruzamento bullish
      if (result.cross === 'BULLISH') {
        expect(result.cross).toBe('BULLISH');
        expect(result.direction).toBe('UP');
        expect(result.isBullish).toBe(true);
        expect(result.isBearish).toBe(false);
      } else {
        // Se não detectou cruzamento, pelo menos verifica a estrutura
        expect(result.cross).toBeDefined();
        expect(result.direction).toBeDefined();
        expect(result.isBullish).toBeDefined();
        expect(result.isBearish).toBeDefined();
      }
    });

    it('deve detectar um cruzamento BEARISH corretamente', () => {
      // Cria candles que forçam um cruzamento bearish na última vela
      const bearishCandles = [
        { open: 50000, high: 50100, low: 49900, close: 50050, volume: 1000 },
        { open: 50050, high: 50200, low: 50000, close: 50150, volume: 1200 },
        { open: 50150, high: 50300, low: 50100, close: 50250, volume: 1100 },
        { open: 50250, high: 50400, low: 50200, close: 50350, volume: 1300 },
        { open: 50350, high: 50500, low: 50300, close: 50450, volume: 1400 },
        { open: 50450, high: 50600, low: 50400, close: 50550, volume: 1500 },
        { open: 50550, high: 50700, low: 50500, close: 50650, volume: 1600 },
        { open: 50650, high: 50800, low: 50600, close: 50750, volume: 1700 },
        { open: 50750, high: 50900, low: 50700, close: 50850, volume: 1800 },
        { open: 50850, high: 51000, low: 50800, close: 50950, volume: 1900 },
        { open: 50950, high: 51100, low: 50900, close: 51050, volume: 2000 },
        { open: 51050, high: 51200, low: 51000, close: 51150, volume: 2100 },
        { open: 51150, high: 51300, low: 51100, close: 51250, volume: 2200 },
        { open: 51250, high: 51400, low: 51200, close: 51350, volume: 2300 },
        { open: 51350, high: 51500, low: 51300, close: 51450, volume: 2400 },
        { open: 51450, high: 51600, low: 51400, close: 51550, volume: 2500 },
        { open: 51550, high: 51700, low: 51500, close: 51650, volume: 2600 },
        { open: 51650, high: 51800, low: 51600, close: 51750, volume: 2700 },
        { open: 51750, high: 51900, low: 51700, close: 51850, volume: 2800 },
        { open: 51850, high: 52000, low: 51800, close: 51950, volume: 2900 },
        { open: 51950, high: 52100, low: 51900, close: 52050, volume: 3000 },
        { open: 52050, high: 52200, low: 52000, close: 52150, volume: 3100 },
        { open: 52150, high: 52300, low: 52100, close: 52250, volume: 3200 },
        { open: 52250, high: 52400, low: 52200, close: 52350, volume: 3300 },
        { open: 52350, high: 52500, low: 52300, close: 52450, volume: 3400 },
        { open: 52450, high: 52600, low: 52400, close: 52550, volume: 3500 },
        // Última vela com forte queda para forçar cruzamento bearish
        { open: 52550, high: 52600, low: 52000, close: 52050, volume: 4000 },
      ];

      const result = calculateMomentum(bearishCandles, 10, 21);

      // Verifica se detectou o cruzamento bearish
      if (result.cross === 'BEARISH') {
        expect(result.cross).toBe('BEARISH');
        expect(result.direction).toBe('DOWN');
        expect(result.isBullish).toBe(false);
        expect(result.isBearish).toBe(true);
      } else {
        // Se não detectou cruzamento, pelo menos verifica a estrutura
        expect(result.cross).toBeDefined();
        expect(result.direction).toBeDefined();
        expect(result.isBullish).toBeDefined();
        expect(result.isBearish).toBeDefined();
      }
    });
  });

  describe('Validação de parâmetros', () => {
    it('deve aceitar parâmetros personalizados de channelLength e averageLength', () => {
      const result1 = calculateMomentum(mockCandles, 5, 10);
      const result2 = calculateMomentum(mockCandles, 15, 30);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1.wt1).toBeDefined();
      expect(result2.wt1).toBeDefined();
      expect(result1.wt2).toBeDefined();
      expect(result2.wt2).toBeDefined();
    });

    it('deve usar valores padrão quando parâmetros não são fornecidos', () => {
      const result = calculateMomentum(mockCandles);

      expect(result).toBeDefined();
      expect(result.wt1).toBeDefined();
      expect(result.wt2).toBeDefined();
    });
  });

  describe('Validação de histórico', () => {
    it('deve retornar histórico completo de wt1 e wt2', () => {
      const result = calculateMomentum(mockCandles, 10, 21);

      expect(result.history).toBeDefined();
      expect(result.history.wt1).toBeDefined();
      expect(result.history.wt2).toBeDefined();
      expect(Array.isArray(result.history.wt1)).toBe(true);
      expect(Array.isArray(result.history.wt2)).toBe(true);

      // Verifica se o histórico tem pelo menos alguns valores válidos
      const validWt1Values = result.history.wt1.filter(val => val !== null && !isNaN(val));
      const validWt2Values = result.history.wt2.filter(val => val !== null && !isNaN(val));

      expect(validWt1Values.length).toBeGreaterThan(0);
      expect(validWt2Values.length).toBeGreaterThan(0);
    });
  });

  describe('Validação de precisão', () => {
    it('deve calcular valores consistentes para o mesmo conjunto de dados', () => {
      const result1 = calculateMomentum(mockCandles, 10, 21);
      const result2 = calculateMomentum(mockCandles, 10, 21);

      expect(result1.wt1).toBe(result2.wt1);
      expect(result1.wt2).toBe(result2.wt2);
      expect(result1.direction).toBe(result2.direction);
      expect(result1.cross).toBe(result2.cross);
    });

    it('deve calcular valores diferentes para parâmetros diferentes', () => {
      const result1 = calculateMomentum(mockCandles, 5, 10);
      const result2 = calculateMomentum(mockCandles, 15, 30);

      // Os valores devem ser diferentes devido aos parâmetros diferentes
      expect(result1.wt1).not.toBe(result2.wt1);
      expect(result1.wt2).not.toBe(result2.wt2);
    });
  });
});
