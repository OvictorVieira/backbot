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
      console.log(`   🟢 ${symbol}: Sinal LONG encontrado (${longSignal.conviction})`);
      console.log(`      • Razão: ${longSignal.reason}`);
      
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(longSignal, currentPrice, atr, investmentUSD, symbol, data.market);
      
      console.log(`      • Preço atual: $${currentPrice?.toFixed(4) || 'N/A'}`);
      console.log(`      • ATR: ${atr?.toFixed(4) || 'N/A'}`);
      console.log(`      • Ordens calculadas: ${orders.length}`);
      
      // Retorna null se não há ordens válidas
      if (!orders || orders.length === 0) {
        console.log(`      ❌ ${symbol}: Nenhuma ordem válida calculada para LONG`);
        return null;
      }
      
      return {
        ...longSignal,
        orders: orders
      };
    } else {
      console.log(`   ⚪ ${symbol}: Nenhum sinal LONG encontrado`);
    }

    // Análise de confluência para sinais SHORT
    console.log(`   🔍 ${symbol}: Verificando sinais SHORT...`);
    const shortSignal = this.analyzeShortSignal(data);
    if (shortSignal) {
      console.log(`   🔴 ${symbol}: Sinal SHORT encontrado (${shortSignal.conviction})`);
      console.log(`      • Razão: ${shortSignal.reason}`);
      
      // Calcula as 3 ordens escalonadas
      const currentPrice = data.vwap?.vwap; // Preço atual (VWAP como referência)
      const atr = data.atr?.atr; // ATR para cálculo de spread
      const orders = this.calculateOrders(shortSignal, currentPrice, atr, investmentUSD, symbol, data.market);
      
      console.log(`      • Preço atual: $${currentPrice?.toFixed(4) || 'N/A'}`);
      console.log(`      • ATR: ${atr?.toFixed(4) || 'N/A'}`);
      console.log(`      • Ordens calculadas: ${orders.length}`);
      
      // Retorna null se não há ordens válidas
      if (!orders || orders.length === 0) {
        console.log(`      ❌ ${symbol}: Nenhuma ordem válida calculada para SHORT`);
        return null;
      }
      
      return {
        ...shortSignal,
        orders: orders
      };
    } else {
      console.log(`   ⚪ ${symbol}: Nenhum sinal SHORT encontrado`);
    }

    console.log(`   ❌ ${symbol}: Nenhum sinal encontrado`);
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
          vwap: data.vwap?.vwap > data.vwap?.lowerBands[0],
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
   * Verifica sinal BRONZE (3 indicadores principais)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal BRONZE é válido
   */
  checkBronzeSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    
    if (action === 'long') {
      const momentum = data.momentum?.isBullish;
      const vwap = data.vwap?.vwap > data.vwap?.lowerBands[0];
      const moneyFlow = data.moneyFlow?.isBullish;
      
      console.log(`         🔍 ${symbol} BRONZE (LONG):`);
      console.log(`            • Momentum: ${momentum ? '✅' : '❌'}`);
      console.log(`            • VWAP: ${vwap ? '✅' : '❌'}`);
      console.log(`            • Money Flow: ${moneyFlow ? '✅' : '❌'}`);
      
      const result = momentum && vwap && moneyFlow;
      console.log(`            • Resultado: ${result ? '✅ BRONZE PASS' : '❌ BRONZE FAIL'}`);
      return result;
    } else {
      const momentum = data.momentum?.isBearish;
      const vwap = data.vwap?.vwap < data.vwap?.upperBands[0];
      const moneyFlow = data.moneyFlow?.isBearish;
      
      console.log(`         🔍 ${symbol} BRONZE (SHORT):`);
      console.log(`            • Momentum: ${momentum ? '✅' : '❌'}`);
      console.log(`            • VWAP: ${vwap ? '✅' : '❌'}`);
      console.log(`            • Money Flow: ${moneyFlow ? '✅' : '❌'}`);
      
      const result = momentum && vwap && moneyFlow;
      console.log(`            • Resultado: ${result ? '✅ BRONZE PASS' : '❌ BRONZE FAIL'}`);
      return result;
    }
  }

  /**
   * Verifica sinal PRATA (Bronze + Macro Bias)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal PRATA é válido
   */
  checkSilverSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    const bronzeSignal = this.checkBronzeSignal(data, action);
    
    if (!bronzeSignal) {
      console.log(`         ❌ ${symbol} SILVER: BRONZE falhou - pulando`);
      return false;
    }

    if (action === 'long') {
      const macroBias = data.macroMoneyFlow?.macroBias === 1;
      console.log(`         🔍 ${symbol} SILVER (LONG):`);
      console.log(`            • Macro Bias: ${macroBias ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${macroBias ? '✅ SILVER PASS' : '❌ SILVER FAIL'}`);
      return macroBias;
    } else {
      const macroBias = data.macroMoneyFlow?.macroBias === -1;
      console.log(`         🔍 ${symbol} SILVER (SHORT):`);
      console.log(`            • Macro Bias: ${macroBias ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${macroBias ? '✅ SILVER PASS' : '❌ SILVER FAIL'}`);
      return macroBias;
    }
  }

  /**
   * Verifica sinal OURO (Prata + Divergência CVD)
   * @param {object} data - Dados de mercado
   * @param {string} action - 'long' ou 'short'
   * @returns {boolean} - True se sinal OURO é válido
   */
  checkGoldSignal(data, action) {
    const symbol = data.symbol || 'UNKNOWN';
    const silverSignal = this.checkSilverSignal(data, action);
    
    if (!silverSignal) {
      console.log(`         ❌ ${symbol} GOLD: SILVER falhou - pulando`);
      return false;
    }

    if (action === 'long') {
      const cvdDivergence = data.cvdDivergence?.bullish === true;
      console.log(`         🔍 ${symbol} GOLD (LONG):`);
      console.log(`            • CVD Divergence: ${cvdDivergence ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${cvdDivergence ? '✅ GOLD PASS' : '❌ GOLD FAIL'}`);
      return cvdDivergence;
    } else {
      const cvdDivergence = data.cvdDivergence?.bearish === true;
      console.log(`         🔍 ${symbol} GOLD (SHORT):`);
      console.log(`            • CVD Divergence: ${cvdDivergence ? '✅' : '❌'}`);
      console.log(`            • Resultado: ${cvdDivergence ? '✅ GOLD PASS' : '❌ GOLD FAIL'}`);
      return cvdDivergence;
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
  calculateOrders(signal, currentPrice, atr, investmentUSD, symbol, market) {
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
    

    console.log(`      • Investment USD: ${investmentUSD}`);
    console.log(`      • Adjusted Capital: ${adjustedCapital}`);
    console.log(`      • Conviction Level: ${conviction}`);
    console.log(`      • Market decimals: quantity=${market.decimal_quantity}, price=${market.decimal_price}`);
    
    const weights = [
      Number(process.env.ORDER_1_WEIGHT_PCT) || 50,
      Number(process.env.ORDER_2_WEIGHT_PCT) || 30,
      Number(process.env.ORDER_3_WEIGHT_PCT) || 20
    ];
    const spreads = [0.5, 1.0, 1.5]; // Multiplicadores do ATR para spread
    

    
    for (let i = 0; i < 3; i++) {

      const weight = weights[i];
      const spreadMultiplier = spreads[i];
      
      // Calcula preço de entrada com spread baseado no ATR
      const spread = atr * spreadMultiplier;
      let entryPrice = action === 'long' 
        ? currentPrice - (spread * (i + 1))
        : currentPrice + (spread * (i + 1));
      

      console.log(`            • Current Price: ${currentPrice}`);
      console.log(`            • ATR: ${atr}`);
      console.log(`            • Spread Multiplier: ${spreadMultiplier}`);
      console.log(`            • Spread: ${spread}`);
      console.log(`            • Entry Price (antes do min): ${entryPrice}`);
      
      // Garante um spread mínimo de 0.1% para evitar "Order would immediately match"
      const minSpreadPercent = 0.001; // 0.1%
      const minSpread = currentPrice * minSpreadPercent;
      
      if (action === 'long') {
        const currentSpread = currentPrice - entryPrice;
        if (currentSpread < minSpread) {
          console.log(`            • Spread mínimo aplicado: ${currentSpread} < ${minSpread}`);
          entryPrice = currentPrice - minSpread;
        }
      } else {
        const currentSpread = entryPrice - currentPrice;
        if (currentSpread < minSpread) {
          console.log(`            • Spread mínimo aplicado: ${currentSpread} < ${minSpread}`);
          entryPrice = currentPrice + minSpread;
        }
      }
      
      console.log(`            • Entry Price (final): ${entryPrice}`);
      console.log(`            • Current Spread: ${action === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice}`);
      console.log(`            • Min Spread: ${minSpread}`);
      
      // Calcula quantidade baseada no peso (dos 2% do capital)
      const orderCapital = (adjustedCapital * weight) / 100; // weight já é em porcentagem
      const rawQuantity = orderCapital / entryPrice;
      

      
      // Formata a quantidade usando os dados de mercado
      const formattedQuantity = formatQuantity(rawQuantity);
      const finalQuantity = parseFloat(formattedQuantity);
      
      console.log(`      📋 [DEBUG] Ordem ${i + 1}:`);
      console.log(`         • Weight: ${weight}%`);
      console.log(`         • Entry Price: $${formatPrice(entryPrice)}`);
      console.log(`         • Capital for this order: $${orderCapital.toFixed(2)}`);
      console.log(`         • Raw Quantity: ${rawQuantity}`);
      console.log(`         • Formatted Quantity: ${formattedQuantity}`);
      console.log(`         • Final Quantity: ${finalQuantity}`);
      console.log(`         • Min Quantity: ${market.min_quantity}`);
      console.log(`         • Is Valid Quantity: ${finalQuantity > 0 ? '✅' : '❌'}`);
      console.log(`         • Above Min: ${market.min_quantity ? (finalQuantity >= market.min_quantity ? '✅' : '❌') : 'N/A'}`);
      
      // Valida se a quantidade é válida
      if (finalQuantity <= 0) {
        console.log(`         ⚠️  Quantidade inválida (${finalQuantity}), pulando ordem ${i + 1}`);
        continue;
      }
      
      // Calcula o valor da ordem para log
      const orderValue = finalQuantity * entryPrice;
      console.log(`            • Order Value: $${orderValue.toFixed(4)}`);
      
      // Calcula stop loss e take profit baseados em multiplicadores de ATR
      const initialStopAtrMultiplier = Number(process.env.INITIAL_STOP_ATR_MULTIPLIER || 2.0);
      const takeProfitAtrMultiplier = Number(process.env.TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER || 3.0);
              const maxStopLossPct = Number(process.env.MAX_NEGATIVE_PNL_STOP_PCT || -10);
      
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
      

      console.log(`            • ATR: ${atr ? atr.toFixed(4) : 'undefined'}`);
      console.log(`            • Stop ATR Distance: ${atrStopDistance ? atrStopDistance.toFixed(4) : 'undefined'}`);
      console.log(`            • Take Profit ATR Distance: ${atrTakeProfitDistance ? atrTakeProfitDistance.toFixed(4) : 'undefined'}`);
      console.log(`            • Stop Loss Final: ${stopLoss ? stopLoss.toFixed(4) : 'undefined'}`);
      console.log(`            • Take Profit Final: ${takeProfit ? takeProfit.toFixed(4) : 'undefined'}`);
      console.log(`            • Max Stop Loss Price: ${maxStopLossPrice ? maxStopLossPrice.toFixed(4) : 'undefined'}`);
      
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
    return super.validateData(data) && 
           data.momentum !== null && 
           data.moneyFlow !== null &&
           data.macroMoneyFlow !== null &&
           data.cvdDivergence !== null;
  }
}