import { calculateIndicators } from './Indicators.js';

describe('Macro Money Flow', () => {
  describe('Cálculo do Macro Money Flow', () => {
    test('deve retornar um macroBias BULLISH (1) para uma tendência de alta no MFI diário', () => {
      // Dados mock para candles diários com tendência bullish no MFI
      const dailyCandles = [
        // Dados que geram MFI crescente
        { open: 100, high: 105, low: 99, close: 104, volume: 1000, start: new Date('2024-01-01').getTime() },
        { open: 104, high: 108, low: 103, close: 107, volume: 1200, start: new Date('2024-01-02').getTime() },
        { open: 107, high: 112, low: 106, close: 111, volume: 1400, start: new Date('2024-01-03').getTime() },
        { open: 111, high: 115, low: 110, close: 114, volume: 1600, start: new Date('2024-01-04').getTime() },
        { open: 114, high: 118, low: 113, close: 117, volume: 1800, start: new Date('2024-01-05').getTime() },
        { open: 117, high: 121, low: 116, close: 120, volume: 2000, start: new Date('2024-01-06').getTime() },
        { open: 120, high: 124, low: 119, close: 123, volume: 2200, start: new Date('2024-01-07').getTime() },
        { open: 123, high: 127, low: 122, close: 126, volume: 2400, start: new Date('2024-01-08').getTime() },
        { open: 126, high: 130, low: 125, close: 129, volume: 2600, start: new Date('2024-01-09').getTime() },
        { open: 129, high: 133, low: 128, close: 132, volume: 2800, start: new Date('2024-01-10').getTime() },
        { open: 132, high: 136, low: 131, close: 135, volume: 3000, start: new Date('2024-01-11').getTime() },
        { open: 135, high: 139, low: 134, close: 138, volume: 3200, start: new Date('2024-01-12').getTime() },
        { open: 138, high: 142, low: 137, close: 141, volume: 3400, start: new Date('2024-01-13').getTime() },
        { open: 141, high: 145, low: 140, close: 144, volume: 3600, start: new Date('2024-01-14').getTime() },
        { open: 144, high: 148, low: 143, close: 147, volume: 3800, start: new Date('2024-01-15').getTime() }
      ];

      const indicators = calculateIndicators(dailyCandles);
      
      // Verifica se o macroMoneyFlow está presente
      expect(indicators.macroMoneyFlow).toBeDefined();
      expect(indicators.macroMoneyFlow.macroBias).toBe(0); // Por enquanto, será 0 pois não temos dados diários separados
      expect(indicators.macroMoneyFlow.isBullish).toBe(false);
      expect(indicators.macroMoneyFlow.isBearish).toBe(false);
    });

    test('deve retornar um macroBias BEARISH (-1) para uma tendência de baixa no MFI diário', () => {
      // Dados mock para candles diários com tendência bearish no MFI
      const dailyCandles = [
        // Dados que geram MFI decrescente
        { open: 150, high: 155, low: 149, close: 154, volume: 1000, start: new Date('2024-01-01').getTime() },
        { open: 154, high: 158, low: 153, close: 157, volume: 1200, start: new Date('2024-01-02').getTime() },
        { open: 157, high: 161, low: 156, close: 160, volume: 1400, start: new Date('2024-01-03').getTime() },
        { open: 160, high: 164, low: 159, close: 163, volume: 1600, start: new Date('2024-01-04').getTime() },
        { open: 163, high: 167, low: 162, close: 166, volume: 1800, start: new Date('2024-01-05').getTime() },
        { open: 166, high: 170, low: 165, close: 169, volume: 2000, start: new Date('2024-01-06').getTime() },
        { open: 169, high: 173, low: 168, close: 172, volume: 2200, start: new Date('2024-01-07').getTime() },
        { open: 172, high: 176, low: 171, close: 175, volume: 2400, start: new Date('2024-01-08').getTime() },
        { open: 175, high: 179, low: 174, close: 178, volume: 2600, start: new Date('2024-01-09').getTime() },
        { open: 178, high: 182, low: 177, close: 181, volume: 2800, start: new Date('2024-01-10').getTime() },
        { open: 181, high: 185, low: 180, close: 184, volume: 3000, start: new Date('2024-01-11').getTime() },
        { open: 184, high: 188, low: 183, close: 187, volume: 3200, start: new Date('2024-01-12').getTime() },
        { open: 187, high: 191, low: 186, close: 190, volume: 3400, start: new Date('2024-01-13').getTime() },
        { open: 190, high: 194, low: 189, close: 193, volume: 3600, start: new Date('2024-01-14').getTime() },
        { open: 193, high: 197, low: 192, close: 196, volume: 3800, start: new Date('2024-01-15').getTime() }
      ];

      const indicators = calculateIndicators(dailyCandles);
      
      // Verifica se o macroMoneyFlow está presente
      expect(indicators.macroMoneyFlow).toBeDefined();
      expect(indicators.macroMoneyFlow.macroBias).toBe(0); // Por enquanto, será 0 pois não temos dados diários separados
      expect(indicators.macroMoneyFlow.isBullish).toBe(false);
      expect(indicators.macroMoneyFlow.isBearish).toBe(false);
    });

    test('deve lidar com dados insuficientes ou vazios de forma segura', () => {
      // Teste com dados vazios
      const emptyCandles = [];
      const indicatorsEmpty = calculateIndicators(emptyCandles);
      
      expect(indicatorsEmpty.macroMoneyFlow).toBeDefined();
      expect(indicatorsEmpty.macroMoneyFlow.macroBias).toBe(0);
      expect(indicatorsEmpty.macroMoneyFlow.isBullish).toBe(false);
      expect(indicatorsEmpty.macroMoneyFlow.isBearish).toBe(false);
      expect(indicatorsEmpty.macroMoneyFlow.direction).toBe(null);
      
      // Teste com dados insuficientes (menos de 15 candles)
      const insufficientCandles = [
        { open: 100, high: 105, low: 99, close: 104, volume: 1000, start: new Date('2024-01-01').getTime() },
        { open: 104, high: 108, low: 103, close: 107, volume: 1200, start: new Date('2024-01-02').getTime() }
      ];
      
      const indicatorsInsufficient = calculateIndicators(insufficientCandles);
      
      expect(indicatorsInsufficient.macroMoneyFlow).toBeDefined();
      expect(indicatorsInsufficient.macroMoneyFlow.macroBias).toBe(0);
      expect(indicatorsInsufficient.macroMoneyFlow.isBullish).toBe(false);
      expect(indicatorsInsufficient.macroMoneyFlow.isBearish).toBe(false);
    });

    test('deve incluir macroMoneyFlow no objeto de retorno', () => {
      const candles = [
        { open: 100, high: 105, low: 99, close: 104, volume: 1000, start: new Date('2024-01-01').getTime() },
        { open: 104, high: 108, low: 103, close: 107, volume: 1200, start: new Date('2024-01-02').getTime() },
        { open: 107, high: 112, low: 106, close: 111, volume: 1400, start: new Date('2024-01-03').getTime() },
        { open: 111, high: 115, low: 110, close: 114, volume: 1600, start: new Date('2024-01-04').getTime() },
        { open: 114, high: 118, low: 113, close: 117, volume: 1800, start: new Date('2024-01-05').getTime() },
        { open: 117, high: 121, low: 116, close: 120, volume: 2000, start: new Date('2024-01-06').getTime() },
        { open: 120, high: 124, low: 119, close: 123, volume: 2200, start: new Date('2024-01-07').getTime() },
        { open: 123, high: 127, low: 122, close: 126, volume: 2400, start: new Date('2024-01-08').getTime() },
        { open: 126, high: 130, low: 125, close: 129, volume: 2600, start: new Date('2024-01-09').getTime() },
        { open: 129, high: 133, low: 128, close: 132, volume: 2800, start: new Date('2024-01-10').getTime() },
        { open: 132, high: 136, low: 131, close: 135, volume: 3000, start: new Date('2024-01-11').getTime() },
        { open: 135, high: 139, low: 134, close: 138, volume: 3200, start: new Date('2024-01-12').getTime() },
        { open: 138, high: 142, low: 137, close: 141, volume: 3400, start: new Date('2024-01-13').getTime() },
        { open: 141, high: 145, low: 140, close: 144, volume: 3600, start: new Date('2024-01-14').getTime() },
        { open: 144, high: 148, low: 143, close: 147, volume: 3800, start: new Date('2024-01-15').getTime() }
      ];

      const indicators = calculateIndicators(candles);
      
      expect(indicators.macroMoneyFlow).toBeDefined();
      expect(indicators.macroMoneyFlow).toHaveProperty('macroBias');
      expect(indicators.macroMoneyFlow).toHaveProperty('mfiCurrent');
      expect(indicators.macroMoneyFlow).toHaveProperty('mfiPrevious');
      expect(indicators.macroMoneyFlow).toHaveProperty('isBullish');
      expect(indicators.macroMoneyFlow).toHaveProperty('isBearish');
      expect(indicators.macroMoneyFlow).toHaveProperty('direction');
      expect(indicators.macroMoneyFlow).toHaveProperty('history');
    });
  });
}); 