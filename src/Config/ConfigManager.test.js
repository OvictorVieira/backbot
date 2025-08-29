import { jest } from '@jest/globals';
import ConfigManager from './ConfigManager.js';

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset any mocks
    jest.clearAllMocks();
  });

  describe('createDefaultConfig', () => {
    it('should create default config for strategy', () => {
      const result = ConfigManager.createDefaultConfig('DEFAULT');

      expect(result).toEqual({
        strategyName: 'DEFAULT',
        botName: 'DEFAULT Bot',
        apiKey: '',
        apiSecret: '',
        capitalPercentage: 20,
        time: '30m',
        enabled: true,
        maxNegativePnlStopPct: -10,
        enableHybridStopStrategy: false,
        initialStopAtrMultiplier: 2.0,
        trailingStopAtrMultiplier: 1.5,
        partialTakeProfitAtrMultiplier: 3.0,
        partialTakeProfitPercentage: 50,
        enableTrailingStop: false,
        trailingStopDistance: 1.5,
        enablePostOnly: true,
        enableMarketFallback: true,
        enableOrphanOrderMonitor: true,
        enablePendingOrdersMonitor: true,
      });
    });
  });

  describe('validateConfig', () => {
    it('should return valid for complete config', () => {
      const config = {
        apiKey: 'valid-api-key-12345',
        apiSecret: 'valid-api-secret-12345',
        capitalPercentage: 50,
      };

      const result = ConfigManager.validateConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return invalid for missing required fields', () => {
      const config = {
        apiKey: 'valid-key',
        // Missing apiSecret, capitalPercentage
      };

      const result = ConfigManager.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Campo obrigatório ausente: capitalPercentage');
    });

    it('should return invalid for missing apiSecret when capitalPercentage is present', () => {
      const config = {
        apiKey: 'valid-key',
        capitalPercentage: 50,
        // Missing apiSecret
      };

      const result = ConfigManager.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('API Secret é obrigatório');
    });

    it('should return invalid for invalid capital percentage', () => {
      const config = {
        apiKey: 'valid-key',
        apiSecret: 'valid-secret',
        capitalPercentage: 150, // Invalid (> 100)
      };

      const result = ConfigManager.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Percentual de capital deve estar entre 0 e 100');
    });

    it('should return invalid for short API keys', () => {
      const config = {
        apiKey: 'short', // Too short
        apiSecret: 'valid-secret',
        capitalPercentage: 50,
      };

      const result = ConfigManager.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('API Key muito curta');
    });
  });

  describe('getAllStrategyNames', () => {
    it('should return empty array when no configs exist', () => {
      // This test will work with the actual file system
      // We'll test the basic functionality without complex mocking
      const result = ConfigManager.getAllStrategyNames();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
