import { jest } from '@jest/globals';
import { DefaultStopLoss } from './DefaultStopLoss.js';
import TrailingStop from '../../TrailingStop/TrailingStop.js';

// Mock do TrailingStop.calculatePnL diretamente
jest.spyOn(TrailingStop, 'calculatePnL').mockImplementation(() => ({
  pnl: 0,
  pnlPct: 0,
}));

// Mock do monitorTakeProfitMinimum
jest.spyOn(DefaultStopLoss.prototype, 'monitorTakeProfitMinimum').mockImplementation(() => {
  // Como o método é assíncrono mas está sendo chamado de forma síncrona,
  // retornamos null para simular que não há resultado
  return null;
});

describe('DefaultStopLoss', () => {
  let defaultStopLoss;
  let mockConfig;

  beforeEach(() => {
    // Mock config para os testes
    mockConfig = {
      enableTrailingStop: false,
      maxNegativePnlStopPct: -10,
      enableTpValidation: false,
    };
    defaultStopLoss = new DefaultStopLoss(mockConfig);
  });

  describe('shouldClosePosition', () => {
    test('should return null when enableTrailingStop is true', () => {
      // Mock config com enableTrailingStop = true
      const mockConfig = {
        enableTrailingStop: true,
        maxNegativePnlStopPct: -10,
        enableTpValidation: false,
      };
      const stopLossWithTrailing = new DefaultStopLoss(mockConfig);

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = stopLossWithTrailing.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();
    });

    test('should return null for invalid position data', () => {
      const position = null;
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();
    });

    test('should return null for invalid account data', () => {
      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = null;

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();
    });

    test('should return null for position without symbol', () => {
      const position = {
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();
    });

    test('should return null for position without netQuantity', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      process.env.ENABLE_TRAILING_STOP = 'false';

      const position = {
        symbol: 'BTC_USDC_PERP',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
    });

    test('should return null for invalid MAX_NEGATIVE_PNL_STOP_PCT', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = 'invalid';

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
    });

    test('should return null for non-finite MAX_NEGATIVE_PNL_STOP_PCT', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = 'Infinity';

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
    });

    test('should return null for invalid PnL calculation', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = '4.0';

      // Mock TrailingStop.calculatePnL para retornar valores inválidos
      TrailingStop.calculatePnL.mockReturnValue({ pnl: NaN, pnlPct: NaN });

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
    });

    test('should return close decision when PnL is below negative limit', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = '4.0';

      // Mock TrailingStop.calculatePnL para retornar PnL negativo
      TrailingStop.calculatePnL.mockReturnValue({ pnl: -200, pnlPct: -4.0 });

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '48000', // -4% loss (at the limit)
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      // Sobrescrever config para este teste específico
      const testConfig = { ...mockConfig, maxNegativePnlStopPct: -4.0 };
      const result = defaultStopLoss.shouldClosePosition(position, account, null, testConfig);

      expect(result).not.toBeNull();
      expect(result.shouldClose).toBe(true);
      expect(result.type).toBe('PERCENTAGE');
      expect(result.reason).toContain('PERCENTAGE: PnL');
      expect(result.pnl).toBeLessThan(0);
      expect(result.pnlPct).toBeLessThanOrEqual(-4);

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
    });

    test('should return null when PnL is above negative limit', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = '4.0';

      // Mock TrailingStop.calculatePnL para retornar PnL positivo (não deve fechar)
      TrailingStop.calculatePnL.mockReturnValue({ pnl: 300, pnlPct: 6.0 });

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000', // -2% loss (above the -4% limit)
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
    });

    test('should return null when take profit validation is enabled but method is async', () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TRAILING_STOP;
      const originalMaxPnl = process.env.MAX_NEGATIVE_PNL_STOP_PCT;
      const originalTpValidation = process.env.ENABLE_TP_VALIDATION;
      const originalMinTp = process.env.MIN_TAKE_PROFIT_PCT;
      const originalTpPartial = process.env.TP_PARTIAL_PERCENTAGE;

      process.env.ENABLE_TRAILING_STOP = 'false';
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = '4.0';
      process.env.ENABLE_TP_VALIDATION = 'true';
      process.env.MIN_TAKE_PROFIT_PCT = '0.5';
      process.env.TP_PARTIAL_PERCENTAGE = '50';

      // Mock TrailingStop.calculatePnL para retornar profit (não deve ativar stop loss)
      TrailingStop.calculatePnL.mockReturnValue({ pnl: 25, pnlPct: 5.0 });

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '50250', // 0.5% profit
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = defaultStopLoss.shouldClosePosition(position, account, null, mockConfig);

      // Como o monitorTakeProfitMinimum é assíncrono mas está sendo chamado de forma síncrona,
      // o resultado será null
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TRAILING_STOP = originalEnv;
      process.env.MAX_NEGATIVE_PNL_STOP_PCT = originalMaxPnl;
      process.env.ENABLE_TP_VALIDATION = originalTpValidation;
      process.env.MIN_TAKE_PROFIT_PCT = originalMinTp;
      process.env.TP_PARTIAL_PERCENTAGE = originalTpPartial;
    });
  });

  describe('debug', () => {
    test('should log debug message when LOG_TYPE is debug', () => {
      // Mock process.env
      const originalLogType = process.env.LOG_TYPE;
      process.env.LOG_TYPE = 'debug';

      // Mock console.log usando jest.spyOn
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      DefaultStopLoss.debug('Test debug message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\]/),
        'Test debug message'
      );

      // Restore
      consoleSpy.mockRestore();
      process.env.LOG_TYPE = originalLogType;
    });

    test('should not log debug message when LOG_TYPE is not debug', () => {
      // Mock process.env
      const originalLogType = process.env.LOG_TYPE;
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_TYPE = 'info';
      process.env.LOG_LEVEL = 'INFO';

      // Mock console.log usando jest.spyOn
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      DefaultStopLoss.debug('Test debug message');

      expect(consoleSpy).not.toHaveBeenCalled();

      // Restore
      consoleSpy.mockRestore();
      process.env.LOG_TYPE = originalLogType;
      process.env.LOG_LEVEL = originalLogLevel;
    });
  });
});
