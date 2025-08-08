import { BaseStrategy } from './BaseStrategy.js';

export class AlphaFlowStrategy extends BaseStrategy {
  /**
   * Analisa dados de mercado e retorna decisão de trading com níveis de convicção
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @param {object} config - Configuração da conta
   * @param {string} btcTrend - Tendência do BTC
   * @returns {object|null} - Objeto com decisão de trading ou null se não houver sinal
   */
  analyzeTrade(_fee, data, investmentUSD, _media_rsi, config = null, btcTrend = 'NEUTRAL') {
    const symbol = data.symbol || 'UNKNOWN_SYMBOL';
    
    // Validação básica dos dados
    if (!this.validateData(data)) {
      return null;
    }
    console.log(`   ✅ ${symbol}: Dados válidos - iniciando análise`);

    // Debug dos indicadores disponíveis
    console.log(`   📊 ${symbol} - Indicadores:`);
    console.log(`      • Momentum: ${data.momentum?.isBullish ? 'BULLISH' : data.momentum?.isBearish ? 'BEARISH' : 'NEUTRAL'}`);
    console.log(`      • Money Flow: ${data.moneyFlow?.isBullish ? 'BULLISH' : data.moneyFlow?.isBearish ? 'BEARISH' : 'NEUTRAL'}`);
    console.log(`      • Macro Bias: ${data.macroMoneyFlow?.macroBias === 1 ? 'BULLISH' : data.macroMoneyFlow?.macroBias === -1 ? 'BEARISH' : 'NEUTRAL'}`);
    console.log(`      • CVD Divergence: ${data.cvdDivergence?.bullish ? 'BULLISH' : data.cvdDivergence?.bearish ? 'BEARISH' : 'NEUTRAL'}`);
    console.log(`      • VWAP: ${data.vwap?.vwap ? 'OK' : 'MISSING'}`);
    console.log(`      • ATR: ${data.atr?.atr ? 'OK' : 'MISSING'}`);

    // Análise de confluência para sinais LONG
    console.log(`   🔍 ${symbol}: Verificando sinais LONG...`);
    const longSignal = this.analyzeLongSignal(data);
    if (longSignal) {
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(longSignal, currentPrice, atr, investmentUSD, symbol, data.market, config);
      
      // Retorna null se não há ordens válidas
      if (!orders || orders.length === 0) {
        return null;
      }
      
      return {
        ...longSignal,
        orders: orders
      };
    }

    const shortSignal = this.analyzeShortSignal(data);
    if (shortSignal) {
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(shortSignal, currentPrice, atr, investmentUSD, symbol, data.market, config);
      
      // Retorna null se não há ordens válidas
      if (!orders || orders.length === 0) {
        return null;
      }
      
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
    // Verifica sinais BRONZE (3 indicadores principais) - SINAL DE ENTRADA
    const sinalBronze = this.checkBronzeSignal(data, 'long');
    if (!sinalBronze) return null;

    // Verifica sinal OURO (Bronze + Silver + CVD Divergence)
    const sinalOuro = this.checkGoldSignal(data, 'long');
    if (sinalOuro) {
      return {
        action: 'long',
        conviction: 'GOLD',
        reason: 'Confluência Máxima: VWAP + Momentum + Money Flow + Macro Bias + CVD Divergence',
        signals: {
          momentum: data.momentum?.isBullish,
          vwap: (data.vwap?.current?.vwap || data.vwap?.vwap) > (data.vwap?.current?.lowerBands?.[0] || data.vwap?.lowerBands?.[0]),
          moneyFlow: data.moneyFlow?.isBullish,
          macroBias: data.macroMoneyFlow?.macroBias === 1,
          cvdDivergence: data.cvdDivergence?.bullish
        }
      };
    }

    // Verifica sinal PRATA (Bronze + Macro Bias)
    const sinalPrata = this.checkSilverSignal(data, 'long');
    if (sinalPrata) {
      return {
        action: 'long',
        conviction: 'SILVER',
        reason: 'Confluência Alta: VWAP + Momentum + Money Flow + Macro Bias',
        signals: {
          momentum: data.momentum?.isBullish,
          vwap: data.vwap?.vwap > data.vwap?.lowerBands[0],
          moneyFlow: data.moneyFlow?.isBullish,
          macroBias: data.macroMoneyFlow?.macroBias === 1,
          cvdDivergence: false
        }
      };
    }

    // BRONZE é o sinal de entrada - retorna imediatamente (não requer macro bias)
    return {
      action: 'long',
      conviction: 'BRONZE',
      reason: 'Sinal de Entrada: VWAP + Momentum + Money Flow (CypherPunk 1-2-3)',
      signals: {
        momentum: data.momentum?.isBullish,
        vwap: data.vwap?.vwap > data.vwap?.lowerBands[0],
        moneyFlow: data.moneyFlow?.isBullish,
        macroBias: false,
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
    // Verifica sinais BRONZE (3 indicadores principais) - SINAL DE ENTRADA
    const sinalBronze = this.checkBronzeSignal(data, 'short');
    if (!sinalBronze) return null;

    // Verifica sinal OURO (Bronze + Silver + CVD Divergence)
    const sinalOuro = this.checkGoldSignal(data, 'short');
    if (sinalOuro) {
      return {
        action: 'short',
        conviction: 'GOLD',
        reason: 'Confluência Máxima: VWAP + Momentum + Money Flow + Macro Bias + CVD Divergence',
        signals: {
          momentum: data.momentum?.isBearish,
          vwap: data.vwap?.vwap < data.vwap?.upperBands[0],
          moneyFlow: data.moneyFlow?.isBearish,
          macroBias: data.macroMoneyFlow?.macroBias === -1,
          cvdDivergence: data.cvdDivergence?.bearish
        }
      };
    }

    // Verifica sinal PRATA (Bronze + Macro Bias)
    const sinalPrata = this.checkSilverSignal(data, 'short');
    if (sinalPrata) {
      return {
        action: 'short',
        conviction: 'SILVER',
        reason: 'Confluência Alta: VWAP + Momentum + Money Flow + Macro Bias',
        signals: {
          momentum: data.momentum?.isBearish,
          vwap: data.vwap?.vwap < data.vwap?.upperBands[0],
          moneyFlow: data.moneyFlow?.isBearish,
          macroBias: data.macroMoneyFlow?.macroBias === -1,
          cvdDivergence: false
        }
      };
    }

    // BRONZE é o sinal de entrada - retorna imediatamente (não requer macro bias)
    return {
      action: 'short',
      conviction: 'BRONZE',
      reason: 'Sinal de Entrada: VWAP + Momentum + Money Flow (CypherPunk 1-2-3)',
      signals: {
        momentum: data.momentum?.isBearish,
        vwap: data.vwap?.vwap < data.vwap?.upperBands[0],
        moneyFlow: data.moneyFlow?.isBearish,
        macroBias: false,
        cvdDivergence: false
      }
    };
  }

  /**
   * Verifica sinal BRONZE com detecção de mudança de estado
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal BRONZE é válido E houve mudança de estado
   */
  checkBronzeSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    
    if (action === 'long') {
      // Verifica condições atuais
      const currentMomentum = data.momentum?.current?.isBullish;
      const currentVwap = data.vwap?.current?.vwap > data.vwap?.current?.lowerBands[0];
      const currentMoneyFlow = data.moneyFlow?.current?.isBullish;
      
      // Verifica condições anteriores
      const previousMomentum = data.momentum?.previous?.isBullish;
      const previousVwap = data.vwap?.previous?.vwap > data.vwap?.previous?.lowerBands[0];
      const previousMoneyFlow = data.moneyFlow?.previous?.isBullish;
      
      // Verifica se todas as condições atuais são verdadeiras
      const currentConditions = currentMomentum && currentVwap && currentMoneyFlow;
      
      // Verifica se todas as condições anteriores eram falsas (mudança de estado)
      const previousConditions = previousMomentum && previousVwap && previousMoneyFlow;
      
      // Sinal só é válido se as condições atuais são verdadeiras E as anteriores eram falsas
      const stateChange = currentConditions && !previousConditions;
      
      console.log(`         🔍 ${symbol} BRONZE (LONG) - State Change Detection:`);
      console.log(`            • Current Momentum: ${currentMomentum ? '✅' : '❌'}`);
      console.log(`            • Current VWAP: ${currentVwap ? '✅' : '❌'}`);
      console.log(`            • Current Money Flow: ${currentMoneyFlow ? '✅' : '❌'}`);
      console.log(`            • Previous Conditions: ${previousConditions ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ BRONZE PASS' : '❌ BRONZE FAIL'}`);
      
      return stateChange;
    } else {
      // Verifica condições atuais
      const currentMomentum = data.momentum?.current?.isBearish;
      const currentVwap = data.vwap?.current?.vwap < data.vwap?.current?.upperBands[0];
      const currentMoneyFlow = data.moneyFlow?.current?.isBearish;
      
      // Verifica condições anteriores
      const previousMomentum = data.momentum?.previous?.isBearish;
      const previousVwap = data.vwap?.previous?.vwap < data.vwap?.previous?.upperBands[0];
      const previousMoneyFlow = data.moneyFlow?.previous?.isBearish;
      
      // Verifica se todas as condições atuais são verdadeiras
      const currentConditions = currentMomentum && currentVwap && currentMoneyFlow;
      
      // Verifica se todas as condições anteriores eram falsas (mudança de estado)
      const previousConditions = previousMomentum && previousVwap && previousMoneyFlow;
      
      // Sinal só é válido se as condições atuais são verdadeiras E as anteriores eram falsas
      const stateChange = currentConditions && !previousConditions;
      
      console.log(`         🔍 ${symbol} BRONZE (SHORT) - State Change Detection:`);
      console.log(`            • Current Momentum: ${currentMomentum ? '✅' : '❌'}`);
      console.log(`            • Current VWAP: ${currentVwap ? '✅' : '❌'}`);
      console.log(`            • Current Money Flow: ${currentMoneyFlow ? '✅' : '❌'}`);
      console.log(`            • Previous Conditions: ${previousConditions ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ BRONZE PASS' : '❌ BRONZE FAIL'}`);
      
      return stateChange;
    }
  }

  /**
   * Verifica sinal PRATA (Bronze + Macro Bias) com detecção de mudança de estado
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal PRATA é válido E houve mudança de estado
   */
  checkSilverSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    const bronzeSignal = this.checkBronzeSignal(data, action);
    
    if (!bronzeSignal) {
      console.log(`         ❌ ${symbol} SILVER: BRONZE falhou - pulando`);
      return false;
    }

    if (action === 'long') {
      const currentMacroBias = data.macroMoneyFlow?.macroBias === 1;
      const previousMacroBias = data.macroMoneyFlow?.macroBias === 1; // Assumindo que macro bias não muda rapidamente
      
      // Para SILVER, precisamos que o macro bias seja bullish E que o BRONZE tenha mudado de estado
      const stateChange = currentMacroBias && bronzeSignal;
      
      console.log(`         🔍 ${symbol} SILVER (LONG) - State Change Detection:`);
      console.log(`            • Current Macro Bias: ${currentMacroBias ? '✅' : '❌'}`);
      console.log(`            • Bronze State Change: ${bronzeSignal ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ SILVER PASS' : '❌ SILVER FAIL'}`);
      
      return stateChange;
    } else {
      const currentMacroBias = data.macroMoneyFlow?.macroBias === -1;
      const previousMacroBias = data.macroMoneyFlow?.macroBias === -1; // Assumindo que macro bias não muda rapidamente
      
      // Para SILVER, precisamos que o macro bias seja bearish E que o BRONZE tenha mudado de estado
      const stateChange = currentMacroBias && bronzeSignal;
      
      console.log(`         🔍 ${symbol} SILVER (SHORT) - State Change Detection:`);
      console.log(`            • Current Macro Bias: ${currentMacroBias ? '✅' : '❌'}`);
      console.log(`            • Bronze State Change: ${bronzeSignal ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ SILVER PASS' : '❌ SILVER FAIL'}`);
      
      return stateChange;
    }
  }

  /**
   * Verifica sinal OURO (Prata + Divergência CVD) com detecção de mudança de estado
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal OURO é válido E houve mudança de estado
   */
  checkGoldSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    const silverSignal = this.checkSilverSignal(data, action);
    
    if (!silverSignal) {
      console.log(`         ❌ ${symbol} GOLD: SILVER falhou - pulando`);
      return false;
    }

    if (action === 'long') {
      const currentCvdDivergence = data.cvdDivergence?.bullish === true;
      const previousCvdDivergence = data.cvdDivergence?.bullish === true; // Assumindo que CVD divergence não muda rapidamente
      
      // Para GOLD, precisamos que a CVD divergence seja bullish E que o SILVER tenha mudado de estado
      const stateChange = currentCvdDivergence && silverSignal;
      
      console.log(`         🔍 ${symbol} GOLD (LONG) - State Change Detection:`);
      console.log(`            • Current CVD Divergence: ${currentCvdDivergence ? '✅' : '❌'}`);
      console.log(`            • Silver State Change: ${silverSignal ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ GOLD PASS' : '❌ GOLD FAIL'}`);
      
      return stateChange;
    } else {
      const currentCvdDivergence = data.cvdDivergence?.bearish === true;
      const previousCvdDivergence = data.cvdDivergence?.bearish === true; // Assumindo que CVD divergence não muda rapidamente
      
      // Para GOLD, precisamos que a CVD divergence seja bearish E que o SILVER tenha mudado de estado
      const stateChange = currentCvdDivergence && silverSignal;
      
      console.log(`         🔍 ${symbol} GOLD (SHORT) - State Change Detection:`);
      console.log(`            • Current CVD Divergence: ${currentCvdDivergence ? '✅' : '❌'}`);
      console.log(`            • Silver State Change: ${silverSignal ? '✅' : '❌'}`);
      console.log(`            • State Change: ${stateChange ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${stateChange ? '✅ GOLD PASS' : '❌ GOLD FAIL'}`);
      
      return stateChange;
    }
  }

  /**
   * Calcula as 3 ordens escalonadas com base no sinal e dados de mercado
   * @param {object} signal - Sinal de trading
   * @param {number} currentPrice - Preço atual
   * @param {number} atr - ATR para cálculo de spread
   * @param {number} investmentUSD - Capital base
   * @param {string} symbol - Símbolo do ativo
   * @param {object} market - Dados de mercado
   * @returns {Array} - Array com 3 ordens
   */
  calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market, config = null) {
    const orders = [];
    const conviction = signal.conviction;
    const action = signal.action;
    
    // Valida se os dados de mercado estão disponíveis
    if (!market || !market.decimal_quantity || !market.decimal_price || !market.stepSize_quantity) {
      console.error(`❌ [calculateOrders] Dados de mercado ausentes para ${symbol}`);
      console.error(`   • Market: ${market ? 'present' : 'null/undefined'}`);
      console.error(`   • decimal_quantity: ${market?.decimal_quantity}`);
      console.error(`   • decimal_price: ${market?.decimal_price}`);
      console.error(`   • stepSize_quantity: ${market?.stepSize_quantity}`);
      return [];
    }

    // Função para formatar quantidade baseada nos dados de mercado
    const formatQuantity = (value) => {
      const decimals = Math.max(market.decimal_quantity, 1);
      
      // Para valores muito pequenos, usa mais casas decimais
      if (value > 0 && value < 0.001) {
        const extendedDecimals = Math.max(decimals, 6);
        return parseFloat(value).toFixed(extendedDecimals);
      }
      
      let formatted = parseFloat(value).toFixed(decimals);
      
      // Se ainda resultar em 0.0, tenta com mais casas decimais
      if (parseFloat(formatted) === 0 && value > 0) {
        formatted = parseFloat(value).toFixed(Math.max(decimals, 6));
      }
      
      // Limita o número de casas decimais para evitar "decimal too long"
      const maxDecimals = Math.min(decimals, 6);
      return parseFloat(formatted).toFixed(maxDecimals);
    };

    // Função para formatar preço baseada nos dados de mercado
    const formatPrice = (value) => {
      return parseFloat(value).toFixed(market.decimal_price).toString();
    };
    
    // Calcula o capital baseado na convicção
    // CORREÇÃO: Usa o investmentUSD diretamente, pois ele já representa o capital disponível para este token
    const adjustedCapital = investmentUSD; // Usa o investmentUSD total, sem aplicar porcentagem novamente
    
    const weights = [
      Number(config?.order1WeightPct) || 50,
      Number(config?.order2WeightPct) || 30,
      Number(config?.order3WeightPct) || 20
    ];
    for (let i = 0; i < 3; i++) {

      const weight = weights[i];
      let entryPrice;
      let spreadMultiplier;
      
      if (i === 0) {
        // PRIMEIRA ORDEM: SEMPRE A MERCADO (preço atual)
        entryPrice = currentPrice; // Ordem a mercado = preço atual
        spreadMultiplier = 0; // Não usa ATR para primeira ordem
      } else {
        // SEGUNDA E TERCEIRA ORDEM: Usam ATR com escalonamento
        const atrMultipliers = [1.0, 1.5]; // Para ordem 2 e 3
        const atrMultiplier = atrMultipliers[i - 1];
        const spread = atr * atrMultiplier * (i + 1); // Mantém escalonamento
        
        entryPrice = action === 'long' 
          ? currentPrice - spread
          : currentPrice + spread;
        spreadMultiplier = atrMultiplier;
      }

      // Calcula quantidade baseada no peso (dos 2% do capital)
      const orderCapital = (adjustedCapital * weight) / 100; // weight já é em porcentagem
      const rawQuantity = orderCapital / entryPrice;
      
      // Formata a quantidade usando os dados de mercado
      const formattedQuantity = formatQuantity(rawQuantity);
      const finalQuantity = parseFloat(formattedQuantity);
      
      // Valida se a quantidade é válida
      if (finalQuantity <= 0) {
        console.log(`         ⚠️  Quantidade inválida (${finalQuantity}), pulando ordem ${i + 1}`);
        continue;
      }
      
      // Calcula o valor da ordem para log
      const orderValue = finalQuantity * entryPrice;
      console.log(`            • Order Value: $${orderValue.toFixed(4)}`);
      
      // Calcula stop loss e take profit baseados em multiplicadores de ATR
      const initialStopAtrMultiplier = Number(config?.initialStopAtrMultiplier || 2.0);
      const takeProfitAtrMultiplier = Number(config?.partialTakeProfitAtrMultiplier || 3.0);
      const maxStopLossPct = Number(config?.maxNegativePnlStopPct || -10);
      
      // Cálculo do stop loss baseado em ATR
      const atrStopDistance = atr * initialStopAtrMultiplier;
      let stopLoss = action === 'long'
        ? entryPrice - atrStopDistance
        : entryPrice + atrStopDistance;
      
      // Cálculo do take profit baseado em ATR
      const atrTakeProfitDistance = atr * takeProfitAtrMultiplier;
      let takeProfit = action === 'long'
        ? entryPrice + atrTakeProfitDistance
        : entryPrice - atrTakeProfitDistance;
      
      // Rede de segurança: verifica se o stop loss baseado em ATR não é excessivamente largo
      const maxStopLossPrice = action === 'long'
        ? entryPrice * (1 + maxStopLossPct / 100)
        : entryPrice * (1 - maxStopLossPct / 100);
      
      // Usa o stop loss mais apertado (mais seguro) entre ATR e percentual máximo
      if (action === 'long') {
        stopLoss = Math.min(stopLoss, maxStopLossPrice);
      } else {
        stopLoss = Math.max(stopLoss, maxStopLossPrice);
      }
      
      const order = {
        market: symbol, // Adiciona o market à ordem (compatibilidade com o sistema)
        symbol: symbol, // Mantém symbol para compatibilidade
        orderNumber: i + 1,
        action: action,
        entryPrice: entryPrice,
        quantity: finalQuantity,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        weight: weight / 100, // Converte de porcentagem para decimal
        spreadMultiplier: spreadMultiplier,
        // Adiciona dados de mercado para o OrderController
        decimal_quantity: market.decimal_quantity,
        decimal_price: market.decimal_price,
        stepSize_quantity: market.stepSize_quantity,
        min_quantity: market.min_quantity
      };
      
      // Validação adicional para garantir que o market está presente
      if (!order.market) {
        console.log(`         ❌ Ordem ${i + 1}: Market não definido, pulando...`);
        continue;
      }
      
      console.log(`         📋 Ordem ${i + 1} para ${symbol}: ${action.toUpperCase()} @ $${formatPrice(entryPrice)}`);
      console.log(`         ✅ Adicionando ordem ${i + 1} ao array (total: ${orders.length + 1})`);
      orders.push(order);
    }
    

    return orders;
  }

  /**
   * Obtém o multiplicador de capital baseado no nível de convicção
   * @param {string} conviction - Nível de convicção (BRONZE, SILVER, GOLD)
   * @param {object} config - Configurações do bot (opcional)
   * @returns {number} - Multiplicador de capital
   */
  getCapitalMultiplier(conviction, config = null) {
    // Usa configurações do bot se disponível, senão usa variáveis de ambiente
    const capitalPercentage = config?.capitalPercentage || Number(process.env.ACCOUNT1_CAPITAL_PERCENTAGE || 10);
    
    switch (conviction) {
      case 'BRONZE':
        return capitalPercentage * 0.5; // 50% do capital configurado
      case 'SILVER':
        return capitalPercentage * 0.75; // 75% do capital configurado
      case 'GOLD':
        return capitalPercentage; // 100% do capital configurado
      default:
        return capitalPercentage * 0.5; // Padrão BRONZE
    }
  }

  /**
   * Analisa sinais para compatibilidade com o sistema (usado para análise do BTC)
   * @param {object} data - Dados de mercado
   * @param {boolean} isBTCAnalysis - Se é análise do BTC
   * @returns {object} - Resultado da análise (sempre neutro para AlphaFlow)
   */
  analyzeSignals(data, isBTCAnalysis = false) {
    // AlphaFlow não usa análise do BTC, sempre retorna neutro
    return {
      hasSignal: false,
      signalType: 'NEUTRAL',
      isLong: false,
      isShort: false,
      analysisDetails: ['AlphaFlow: Análise BTC não aplicável']
    };
  }

  /**
   * Valida se os dados necessários estão disponíveis para Alpha Flow
   * @param {object} data - Dados de mercado
   * @returns {boolean} - True se dados são válidos
   */
  validateData(data) {
    // Validação básica da classe pai
    if (!super.validateData(data)) {
      return false;
    }
    
    // Validação dos indicadores específicos do AlphaFlow
    // Verifica se os indicadores existem e não são null/undefined
    const hasMomentum = data.momentum && (data.momentum.isBullish !== undefined || data.momentum.current?.isBullish !== undefined);
    const hasMoneyFlow = data.moneyFlow && (data.moneyFlow.isBullish !== undefined || data.moneyFlow.current?.isBullish !== undefined);
    const hasMacroMoneyFlow = data.macroMoneyFlow && data.macroMoneyFlow.macroBias !== undefined;
    const hasCvdDivergence = data.cvdDivergence && (data.cvdDivergence.bullish !== undefined || data.cvdDivergence.bearish !== undefined);
    
    return hasMomentum && hasMoneyFlow && hasMacroMoneyFlow && hasCvdDivergence;
  }
}