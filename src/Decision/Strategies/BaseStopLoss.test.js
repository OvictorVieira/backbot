import { BaseStopLoss } from './BaseStopLoss.js';

describe('BaseStopLoss', () => {
  let baseStopLoss;

  beforeEach(() => {
    baseStopLoss = new BaseStopLoss();
  });

  describe('validateData', () => {
    test('should return true for valid position and account data', () => {
      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
      };
      const account = {
        markets: [],
        leverage: 10,
      };

      const result = baseStopLoss.validateData(position, account);
      expect(result).toBe(true);
    });

    test('should return false for null position', () => {
      const position = null;
      const account = {
        markets: [],
        leverage: 10,
      };

      const result = baseStopLoss.validateData(position, account);
      expect(result).toBe(false);
    });

    test('should return false for null account', () => {
      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
      };
      const account = null;

      const result = baseStopLoss.validateData(position, account);
      expect(result).toBe(false);
    });

    test('should return false for position without symbol', () => {
      const position = {
        netQuantity: '0.1',
      };
      const account = {
        markets: [],
        leverage: 10,
      };

      const result = baseStopLoss.validateData(position, account);
      expect(result).toBe(false);
    });

    test('should return false for position without netQuantity', () => {
      const position = {
        symbol: 'BTC_USDC_PERP',
      };
      const account = {
        markets: [],
        leverage: 10,
      };

      const result = baseStopLoss.validateData(position, account);
      expect(result).toBe(false);
    });
  });

  describe('isVolumeBelowMinimum', () => {
    test('should return true when volume is below minimum', () => {
      const position = {
        netExposureNotional: '50',
      };
      const minVolume = 100;

      const result = baseStopLoss.isVolumeBelowMinimum(position, minVolume);
      expect(result).toBe(true);
    });

    test('should return false when volume is above minimum', () => {
      const position = {
        netExposureNotional: '150',
      };
      const minVolume = 100;

      const result = baseStopLoss.isVolumeBelowMinimum(position, minVolume);
      expect(result).toBe(false);
    });

    test('should return false when volume equals minimum', () => {
      const position = {
        netExposureNotional: '100',
      };
      const minVolume = 100;

      const result = baseStopLoss.isVolumeBelowMinimum(position, minVolume);
      expect(result).toBe(false);
    });

    test('should handle string volume values', () => {
      const position = {
        netExposureNotional: '75.5',
      };
      const minVolume = 100;

      const result = baseStopLoss.isVolumeBelowMinimum(position, minVolume);
      expect(result).toBe(true);
    });
  });

  describe('monitorTakeProfitMinimum', () => {
    test('should return null when ENABLE_TP_VALIDATION is false', async () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TP_VALIDATION;
      process.env.ENABLE_TP_VALIDATION = 'false';

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '51000',
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = await baseStopLoss.monitorTakeProfitMinimum(position, account);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TP_VALIDATION = originalEnv;
    });

    test('should return null when position has no profit', async () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TP_VALIDATION;
      process.env.ENABLE_TP_VALIDATION = 'true';

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '49000', // Loss
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = await baseStopLoss.monitorTakeProfitMinimum(position, account);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TP_VALIDATION = originalEnv;
    });

    test('should return take profit decision when profit meets minimum', async () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TP_VALIDATION;
      const originalMinTp = process.env.MIN_TAKE_PROFIT_PCT;
      const originalTpPartial = process.env.TP_PARTIAL_PERCENTAGE;

      process.env.ENABLE_TP_VALIDATION = 'true';
      process.env.MIN_TAKE_PROFIT_PCT = '0.5';
      process.env.TP_PARTIAL_PERCENTAGE = '50';

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '50250', // 0.5% profit
        pnlRealized: '0',
        pnlUnrealized: '25', // 0.1 * (50250 - 50000) = 25
        netCost: '5000', // 0.1 * 50000
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
        leverage: 10,
      };

      const result = await baseStopLoss.monitorTakeProfitMinimum(position, account);

      expect(result).not.toBeNull();
      expect(result.shouldTakePartialProfit).toBe(true);
      expect(result.type).toBe('TAKE_PROFIT_PARTIAL');
      expect(result.partialPercentage).toBe(50);

      // Restore original env
      process.env.ENABLE_TP_VALIDATION = originalEnv;
      process.env.MIN_TAKE_PROFIT_PCT = originalMinTp;
      process.env.TP_PARTIAL_PERCENTAGE = originalTpPartial;
    });

    test('should return null when profit is below minimum', async () => {
      // Mock process.env
      const originalEnv = process.env.ENABLE_TP_VALIDATION;
      const originalMinTp = process.env.MIN_TAKE_PROFIT_PCT;

      process.env.ENABLE_TP_VALIDATION = 'true';
      process.env.MIN_TAKE_PROFIT_PCT = '1.0'; // Higher minimum

      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
        avgEntryPrice: '50000',
        markPrice: '50250', // 0.5% profit (below 1.0% minimum)
      };
      const account = {
        markets: [
          {
            symbol: 'BTC_USDC_PERP',
            decimal_quantity: 3,
          },
        ],
      };

      const result = await baseStopLoss.monitorTakeProfitMinimum(position, account);
      expect(result).toBeNull();

      // Restore original env
      process.env.ENABLE_TP_VALIDATION = originalEnv;
      process.env.MIN_TAKE_PROFIT_PCT = originalMinTp;
    });
  });

  describe('shouldClosePosition', () => {
    test('should throw error when called directly on base class', () => {
      const position = {
        symbol: 'BTC_USDC_PERP',
        netQuantity: '0.1',
      };
      const account = {
        markets: [],
        leverage: 10,
      };
      const marketData = {};

      expect(() => {
        baseStopLoss.shouldClosePosition(position, account, marketData);
      }).toThrow('shouldClosePosition must be implemented by subclass');
    });
  });
});
