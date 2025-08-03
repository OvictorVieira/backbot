import { jest } from '@jest/globals';
import { BaseStrategy } from './BaseStrategy.js';
import AccountController from '../../Controllers/AccountController.js';

// Mock o módulo ANTES de todos os testes
jest.mock('../../Controllers/AccountController.js');

describe('BaseStrategy', () => {
  let baseStrategy;

  beforeEach(() => {
    baseStrategy = new BaseStrategy();
  });

  describe('validateData', () => {
    test('should return true for valid data with VWAP', () => {
      const data = {
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        }
      };

      const result = baseStrategy.validateData(data);
      expect(result).toBe(true);
    });

    test('should return false for null data', () => {
      const data = null;

      const result = baseStrategy.validateData(data);
      expect(result).toBe(false);
    });

    test('should return false for data without vwap', () => {
      const data = {
        rsi: { value: 50 }
      };

      const result = baseStrategy.validateData(data);
      expect(result).toBe(false);
    });

    test('should return false for vwap without lowerBands', () => {
      const data = {
        vwap: {
          vwap: 50000,
          upperBands: [51000, 52000, 53000]
        }
      };

      const result = baseStrategy.validateData(data);
      expect(result).toBe(false);
    });

    test('should return false for vwap without upperBands', () => {
      const data = {
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000]
        }
      };

      const result = baseStrategy.validateData(data);
      expect(result).toBe(false);
    });

    test('should return false for vwap with null vwap value', () => {
      const data = {
        vwap: {
          vwap: null,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        }
      };

      const result = baseStrategy.validateData(data);
      expect(result).toBe(false);
    });
  });

  describe('validateTakeProfit', () => {
    test('should validate take profit correctly for long position', () => {
      const action = 'long';
      const entry = 50000;
      const stop = 49000;
      const target = 52000;
      const investmentUSD = 100;
      const fee = 0.0004;

      const result = baseStrategy.validateTakeProfit(action, entry, stop, target, investmentUSD, fee);

      expect(result.isValid).toBe(true);
      expect(result.pnl).toBeGreaterThan(0);
      expect(result.risk).toBeGreaterThan(0);
      expect(result.riskRewardRatio).toBeGreaterThan(0);
      expect(result.takeProfitPct).toBe(4); // (52000 - 50000) / 50000 * 100
    });

    test('should validate take profit correctly for short position', () => {
      const action = 'short';
      const entry = 50000;
      const stop = 51000;
      const target = 48000;
      const investmentUSD = 100;
      const fee = 0.0004;

      const result = baseStrategy.validateTakeProfit(action, entry, stop, target, investmentUSD, fee);

      expect(result.isValid).toBe(true);
      expect(result.pnl).toBeGreaterThan(0);
      expect(result.risk).toBeGreaterThan(0);
      expect(result.riskRewardRatio).toBeGreaterThan(0);
      expect(result.takeProfitPct).toBe(4); // (50000 - 48000) / 50000 * 100
    });

    test('should reject take profit below minimum percentage', () => {
      // Mock process.env
      const originalMinTp = process.env.MIN_TAKE_PROFIT_PCT;
      process.env.MIN_TAKE_PROFIT_PCT = '1.0';

      const action = 'long';
      const entry = 50000;
      const stop = 49000;
      const target = 50250; // 0.5% profit (below 1.0% minimum)
      const investmentUSD = 100;
      const fee = 0.0004;

      const result = baseStrategy.validateTakeProfit(action, entry, stop, target, investmentUSD, fee);

      expect(result.isValid).toBe(false);
      expect(result.reasons.pct).toContain('TP 0.50% < mínimo 1.0%');

      // Restore original env
      process.env.MIN_TAKE_PROFIT_PCT = originalMinTp;
    });
  });

  describe('calculatePnLAndRisk', () => {
    test('should calculate PnL and risk correctly for long position', () => {
      const action = 'long';
      const entry = 50000;
      const stop = 49000;
      const target = 52000;
      const investmentUSD = 100;
      const fee = 0.0004;

      const result = baseStrategy.calculatePnLAndRisk(action, entry, stop, target, investmentUSD, fee);

      expect(result.pnl).toBeGreaterThan(0);
      expect(result.risk).toBeGreaterThan(0);
      expect(typeof result.pnl).toBe('number');
      expect(typeof result.risk).toBe('number');
    });

    test('should calculate PnL and risk correctly for short position', () => {
      const action = 'short';
      const entry = 50000;
      const stop = 51000;
      const target = 48000;
      const investmentUSD = 100;
      const fee = 0.0004;

      const result = baseStrategy.calculatePnLAndRisk(action, entry, stop, target, investmentUSD, fee);

      expect(result.pnl).toBeGreaterThan(0);
      expect(result.risk).toBeGreaterThan(0);
      expect(typeof result.pnl).toBe('number');
      expect(typeof result.risk).toBe('number');
    });

    test('should handle zero fee', () => {
      const action = 'long';
      const entry = 50000;
      const stop = 49000;
      const target = 52000;
      const investmentUSD = 100;
      const fee = 0;

      const result = baseStrategy.calculatePnLAndRisk(action, entry, stop, target, investmentUSD, fee);

      expect(result.pnl).toBeGreaterThan(0);
      expect(result.risk).toBeGreaterThan(0);
    });
  });

  describe('calculateStopAndTarget', () => {
    test('should calculate stop and target correctly for long position', async () => {
      // Simula o retorno de AccountController.get()
      AccountController.get.mockResolvedValue({
        leverage: 10,
        markets: [{ symbol: 'BTC_USDC_PERP', decimal_quantity: 4 }]
      });

      const data = {
        market: {
          symbol: 'BTC_USDC_PERP'
        }
      };
      const price = 50000;
      const isLong = true;
      const stopLossPct = 4.0;
      const takeProfitPct = 0.5;

      const result = await baseStrategy.calculateStopAndTarget(data, price, isLong, stopLossPct, takeProfitPct);

      expect(result).not.toBeNull();
      expect(result.stop).toBeLessThan(price);
      expect(result.target).toBeGreaterThan(price);
      expect(typeof result.stop).toBe('number');
      expect(typeof result.target).toBe('number');
    });

    test('should calculate stop and target correctly for short position', async () => {
      // Simula o retorno de AccountController.get()
      AccountController.get.mockResolvedValue({
        leverage: 10,
        markets: [{ symbol: 'BTC_USDC_PERP', decimal_quantity: 4 }]
      });

      const data = {
        market: {
          symbol: 'BTC_USDC_PERP'
        }
      };
      const price = 50000;
      const isLong = false;
      const stopLossPct = 4.0;
      const takeProfitPct = 0.5;

      const result = await baseStrategy.calculateStopAndTarget(data, price, isLong, stopLossPct, takeProfitPct);

      expect(result).not.toBeNull();
      expect(result.stop).toBeGreaterThan(price);
      expect(result.target).toBeLessThan(price);
      expect(typeof result.stop).toBe('number');
      expect(typeof result.target).toBe('number');
    });

    test('should return null for invalid stopLossPct', async () => {
      const data = {
        market: {
          symbol: 'BTC_USDC_PERP'
        }
      };
      const price = 50000;
      const isLong = true;
      const stopLossPct = 0; // Invalid
      const takeProfitPct = 0.5;

      const result = await baseStrategy.calculateStopAndTarget(data, price, isLong, stopLossPct, takeProfitPct);

      expect(result).toBeNull();
    });

    test('should return null for invalid takeProfitPct', async () => {
      const data = {
        market: {
          symbol: 'BTC_USDC_PERP'
        }
      };
      const price = 50000;
      const isLong = true;
      const stopLossPct = 4.0;
      const takeProfitPct = 0; // Invalid

      const result = await baseStrategy.calculateStopAndTarget(data, price, isLong, stopLossPct, takeProfitPct);

      expect(result).toBeNull();
    });
  });

  describe('analyzeTrade', () => {
    test('should throw error when called directly on base class', () => {
      const fee = 0.0004;
      const data = {
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        }
      };
      const investmentUSD = 100;
      const media_rsi = 50;

      expect(() => {
        baseStrategy.analyzeTrade(fee, data, investmentUSD, media_rsi);
      }).toThrow('analyzeTrade must be implemented by subclass');
    });
  });
}); 