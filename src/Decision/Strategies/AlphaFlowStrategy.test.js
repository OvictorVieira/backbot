import { AlphaFlowStrategy } from './AlphaFlowStrategy.js';

describe('AlphaFlowStrategy', () => {
  let strategy;

  beforeEach(() => {
    // Define variáveis de ambiente necessárias para os testes
    process.env.ORDER_1_WEIGHT_PCT = '50';
    process.env.ORDER_2_WEIGHT_PCT = '30';
    process.env.ORDER_3_WEIGHT_PCT = '20';
    process.env.CAPITAL_PERCENTAGE_BRONZE = '50';
    process.env.CAPITAL_PERCENTAGE_SILVER = '75';
    process.env.CAPITAL_PERCENTAGE_GOLD = '100';
    process.env.ACCOUNT1_CAPITAL_PERCENTAGE = '10';
    
    strategy = new AlphaFlowStrategy();
  });

  describe('Níveis de Convicção', () => {
    test('deve retornar um sinal BRONZE quando apenas os 3 indicadores principais se alinham', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        market: {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.0001
        },
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 0 // Neutro
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: false,
          bearish: false
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('BRONZE');
      expect(result.reason).toContain('Sinal de Entrada');
      expect(result.signals.momentum).toBe(true);
      expect(result.signals.vwap).toBe(true);
      expect(result.signals.moneyFlow).toBe(true);
      expect(result.signals.macroBias).toBe(false); // BRONZE não requer macro bias
      expect(result.signals.cvdDivergence).toBe(false);
    });

    test('deve retornar um sinal SILVER quando os 3 indicadores + o Macro se alinham', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        market: {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.0001
        },
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 1 // Bullish
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: false,
          bearish: false
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('SILVER');
      expect(result.reason).toContain('Confluência Alta');
      expect(result.signals.momentum).toBe(true);
      expect(result.signals.vwap).toBe(true);
      expect(result.signals.moneyFlow).toBe(true);
      expect(result.signals.macroBias).toBe(true);
      expect(result.signals.cvdDivergence).toBe(false);
    });

    test('deve retornar um sinal GOLD quando os 3 indicadores + o Macro + a divergência de CVD se alinham', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        market: {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.0001
        },
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 1 // Bullish
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: true,
          bearish: false
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).not.toBeNull();
      expect(result.action).toBe('long');
      expect(result.conviction).toBe('GOLD');
      expect(result.reason).toContain('Confluência Máxima');
      expect(result.signals.momentum).toBe(true);
      expect(result.signals.vwap).toBe(true);
      expect(result.signals.moneyFlow).toBe(true);
      expect(result.signals.macroBias).toBe(true);
      expect(result.signals.cvdDivergence).toBe(true);
    });

    test('deve retornar null quando não há confluência suficiente', () => {
      const mockData = {
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: false,
          isBearish: true
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 1
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: false,
          bearish: false
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).toBeNull();
    });

    test('deve retornar sinal SHORT GOLD para dados bearish', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        market: {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.0001
        },
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: false,
          isBearish: true
        },
        moneyFlow: {
          isBullish: false,
          isBearish: true
        },
        macroMoneyFlow: {
          macroBias: -1 // Bearish
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: false,
          bearish: true
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).not.toBeNull();
      expect(result.action).toBe('short');
      expect(result.conviction).toBe('GOLD');
      expect(result.reason).toContain('Confluência Máxima');
      expect(result.signals.momentum).toBe(true);
      expect(result.signals.vwap).toBe(true);
      expect(result.signals.moneyFlow).toBe(true);
      expect(result.signals.macroBias).toBe(true);
      expect(result.signals.cvdDivergence).toBe(true);
    });

    test('deve retornar sinal SHORT SILVER para dados bearish sem divergência', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        market: {
          symbol: 'BTC_USDC_PERP',
          decimal_quantity: 4,
          decimal_price: 2,
          stepSize_quantity: 0.0001,
          min_quantity: 0.0001
        },
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: false,
          isBearish: true
        },
        moneyFlow: {
          isBullish: false,
          isBearish: true
        },
        macroMoneyFlow: {
          macroBias: -1 // Bearish
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: false,
          bearish: false
        }
      };

      const result = strategy.analyzeTrade(0.001, mockData, 1000, 50);
      
      expect(result).not.toBeNull();
      expect(result.action).toBe('short');
      expect(result.conviction).toBe('SILVER');
      expect(result.reason).toContain('Confluência Alta');
      expect(result.signals.momentum).toBe(true);
      expect(result.signals.vwap).toBe(true);
      expect(result.signals.moneyFlow).toBe(true);
      expect(result.signals.macroBias).toBe(true);
      expect(result.signals.cvdDivergence).toBe(false);
    });
  });

  describe('Validação de Dados', () => {
    test('deve retornar null quando dados são inválidos', () => {
      const invalidData = {
        vwap: {
          vwap: null,
          lowerBands: [],
          upperBands: []
        }
      };

      const result = strategy.analyzeTrade(0.001, invalidData, 1000, 50);
      
      expect(result).toBeNull();
    });

    test('deve retornar null quando dados estão incompletos', () => {
      const incompleteData = {
        vwap: {
          vwap: 50000,
          lowerBands: [49000],
          upperBands: [51000]
        },
        momentum: null,
        moneyFlow: null
      };

      const result = strategy.analyzeTrade(0.001, incompleteData, 1000, 50);
      
      expect(result).toBeNull();
    });
  });

  describe('Métodos Auxiliares', () => {
    test('checkBronzeSignal deve retornar true para sinais bullish válidos', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        }
      };

      const result = strategy.checkBronzeSignal(mockData, 'long');
      expect(result).toBe(true);
    });

    test('checkSilverSignal deve retornar true para sinais com macro bias', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 1
        }
      };

      const result = strategy.checkSilverSignal(mockData, 'long');
      expect(result).toBe(true);
    });

    test('checkGoldSignal deve retornar true para sinais com divergência', () => {
      const mockData = {
        symbol: 'BTC_USDC_PERP',
        vwap: {
          vwap: 50000,
          lowerBands: [49000, 48000, 47000],
          upperBands: [51000, 52000, 53000]
        },
        momentum: {
          isBullish: true,
          isBearish: false
        },
        moneyFlow: {
          isBullish: true,
          isBearish: false
        },
        macroMoneyFlow: {
          macroBias: 1
        },
        cvdDivergence: {
        atr: {
          atr: 1000
        },
          bullish: true,
          bearish: false
        }
      };

      const result = strategy.checkGoldSignal(mockData, 'long');
      expect(result).toBe(true);
    });
  });
}); 