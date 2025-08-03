import { BaseStrategy } from './BaseStrategy.js';

export class AlphaFlowStrategy extends BaseStrategy {
  /**
   * Analisa dados de mercado e retorna decisão de trading com níveis de convicção
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @returns {object|null} - Objeto com decisão de trading ou null se não houver sinal
   */
  analyzeTrade(_fee, data, investmentUSD, _media_rsi) {
    // Validação básica dos dados
    if (!this.validateData(data)) {
      return null;
    }

    // Análise de confluência para sinais LONG
    const longSignal = this.analyzeLongSignal(data);
    if (longSignal) {
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(longSignal, currentPrice, atr, investmentUSD);
      
      return {
        ...longSignal,
        orders: orders
      };
    }

    // Análise de confluência para sinais SHORT
    const shortSignal = this.analyzeShortSignal(data);
    if (shortSignal) {
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(shortSignal, currentPrice, atr, investmentUSD);
      
      return {
        ...shortSignal,
        orders: orders
      };
    }

    return null;
  }

  /**
   * Analisa sinais de compra (LONG) com níveis de convicção
   * @param {object} data - Dados de mercado
   * @returns {object|null} - Sinal de compra ou null
   */
  analyzeLongSignal(data) {
    // Verifica sinais BRONZE (3 indicadores principais)
    const sinalBronze = this.checkBronzeSignal(data, 'long');
    if (!sinalBronze) return null;

    // Verifica sinais PRATA (Bronze + Macro Bias)
    const sinalPrata = this.checkSilverSignal(data, 'long');
    if (!sinalPrata) return null;

    // Verifica sinais OURO (Prata + Divergência CVD)
    const sinalOuro = this.checkGoldSignal(data, 'long');
    if (sinalOuro) {
      return {
        action: 'long',
        conviction: 'GOLD',
        reason: 'Confluência Máxima: Momentum + VWAP + Money Flow + Macro Bias + Divergência CVD',
        signals: {
          momentum: data.momentum?.isBullish,
          vwap: data.vwap?.vwap > data.vwap?.lowerBands[0],
          moneyFlow: data.moneyFlow?.isBullish,
          macroBias: data.macroMoneyFlow?.macroBias === 1,
          cvdDivergence: data.cvdDivergence?.bullish
        }
      };
    }

    // Retorna sinal PRATA se não atingir OURO
    return {
      action: 'long',
      conviction: 'SILVER',
      reason: 'Confluência Alta: Momentum + VWAP + Money Flow + Macro Bias',
      signals: {
        momentum: data.momentum?.isBullish,
        vwap: data.vwap?.vwap > data.vwap?.lowerBands[0],
        moneyFlow: data.moneyFlow?.isBullish,
        macroBias: data.macroMoneyFlow?.macroBias === 1,
        cvdDivergence: false
      }
    };
  }

  /**
   * Analisa sinais de venda (SHORT) com níveis de convicção
   * @param {object} data - Dados de mercado
   * @returns {object|null} - Sinal de venda ou null
   */
  analyzeShortSignal(data) {
    // Verifica sinais BRONZE (3 indicadores principais)
    const sinalBronze = this.checkBronzeSignal(data, 'short');
    if (!sinalBronze) return null;

    // Verifica sinais PRATA (Bronze + Macro Bias)
    const sinalPrata = this.checkSilverSignal(data, 'short');
    if (!sinalPrata) return null;

    // Verifica sinais OURO (Prata + Divergência CVD)
    const sinalOuro = this.checkGoldSignal(data, 'short');
    if (sinalOuro) {
      return {
        action: 'short',
        conviction: 'GOLD',
        reason: 'Confluência Máxima: Momentum + VWAP + Money Flow + Macro Bias + Divergência CVD',
        signals: {
          momentum: data.momentum?.isBearish,
          vwap: data.vwap?.vwap < data.vwap?.upperBands[0],
          moneyFlow: data.moneyFlow?.isBearish,
          macroBias: data.macroMoneyFlow?.macroBias === -1,
          cvdDivergence: data.cvdDivergence?.bearish
        }
      };
    }

    // Retorna sinal PRATA se não atingir OURO
    return {
      action: 'short',
      conviction: 'SILVER',
      reason: 'Confluência Alta: Momentum + VWAP + Money Flow + Macro Bias',
      signals: {
        momentum: data.momentum?.isBearish,
        vwap: data.vwap?.vwap < data.vwap?.upperBands[0],
        moneyFlow: data.moneyFlow?.isBearish,
        macroBias: data.macroMoneyFlow?.macroBias === -1,
        cvdDivergence: false
      }
    };
  }

  /**
   * Verifica sinal BRONZE (3 indicadores principais)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal BRONZE é válido
   */
  checkBronzeSignal(data, action) {
    if (action === 'long') {
      return data.momentum?.isBullish && 
             data.vwap?.vwap > data.vwap?.lowerBands[0] && 
             data.moneyFlow?.isBullish;
    } else {
      return data.momentum?.isBearish && 
             data.vwap?.vwap < data.vwap?.upperBands[0] && 
             data.moneyFlow?.isBearish;
    }
  }

  /**
   * Verifica sinal PRATA (Bronze + Macro Bias)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal PRATA é válido
   */
  checkSilverSignal(data, action) {
    const bronzeSignal = this.checkBronzeSignal(data, action);
    if (!bronzeSignal) return false;

    if (action === 'long') {
      return data.macroMoneyFlow?.macroBias === 1;
    } else {
      return data.macroMoneyFlow?.macroBias === -1;
    }
  }

  /**
   * Verifica sinal OURO (Prata + Divergência CVD)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal OURO é válido
   */
  checkGoldSignal(data, action) {
    const silverSignal = this.checkSilverSignal(data, action);
    if (!silverSignal) return false;

    if (action === 'long') {
      return data.cvdDivergence?.bullish === true;
    } else {
      return data.cvdDivergence?.bearish === true;
    }
  }

  /**
   * Calcula 3 ordens escalonadas com base no nível de convicção
   * @param {object} signal - Sinal de trading com convicção
   * @param {number} currentPrice - Preço atual
   * @param {number} atr - ATR para cálculo de spread
   * @param {number} investmentUSD - Capital base
   * @returns {Array} - Array com 3 ordens
   */
  calculateOrders(signal, currentPrice, atr, investmentUSD) {
    const orders = [];
    const conviction = signal.conviction;
    const action = signal.action;
    
    // Calcula o capital baseado na convicção
    const capitalMultiplier = this.getCapitalMultiplier(conviction);
    const adjustedCapital = (investmentUSD * capitalMultiplier) / 100;
    
    const weights = [process.env.ORDER_1_WEIGHT_PCT, process.env.ORDER_2_WEIGHT_PCT, process.env.ORDER_3_WEIGHT_PCT];
    const spreads = [0.5, 1.0, 1.5]; // Multiplicadores do ATR para spread
    
    for (let i = 0; i < 3; i++) {
      const weight = weights[i];
      const spreadMultiplier = spreads[i];
      
      // Calcula preço de entrada com spread baseado no ATR
      const spread = atr * spreadMultiplier;
      const entryPrice = action === 'long' 
        ? currentPrice - (spread * (i + 1))
        : currentPrice + (spread * (i + 1));
      
      // Calcula quantidade baseada no peso
      const quantity = (adjustedCapital * weight) / entryPrice;
      
      // Calcula stop loss (-10% do preço de entrada)
      const stopLoss = action === 'long'
        ? entryPrice * 0.9
        : entryPrice * 1.1;
      
      // Calcula take profit (+50% do preço de entrada)
      const takeProfit = action === 'long'
        ? entryPrice * 1.5
        : entryPrice * 0.5;
      
      orders.push({
        orderNumber: i + 1,
        action: action,
        entryPrice: entryPrice,
        quantity: quantity,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        weight: weight / 100, // Converte de porcentagem para decimal
        spreadMultiplier: spreadMultiplier
      });
    }
    
    return orders;
  }

  /**
   * Obtém o multiplicador de capital baseado no nível de convicção
   * @param {string} conviction - Nível de convicção (BRONZE, SILVER, GOLD)
   * @returns {number} - Multiplicador de capital
   */
  getCapitalMultiplier(conviction) {
    switch (conviction) {
      case 'BRONZE':
        return Number(process.env.CAPITAL_PERCENTAGE_BRONZE);
      case 'SILVER':
        return Number(process.env.CAPITAL_PERCENTAGE_SILVER);
      case 'GOLD':
        return Number(process.env.CAPITAL_PERCENTAGE_GOLD);
      default:
        return 50; // Padrão BRONZE
    }
  }

  /**
   * Valida se os dados necessários estão disponíveis para Alpha Flow
   * @param {object} data - Dados de mercado
   * @returns {boolean} - True se dados são válidos
   */
  validateData(data) {
    return super.validateData(data) && 
           data.momentum !== null && 
           data.moneyFlow !== null &&
           data.macroMoneyFlow !== null &&
           data.cvdDivergence !== null;
  }
} 