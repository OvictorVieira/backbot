import { BaseStrategy } from './BaseStrategy.js';
import Markets from '../../Backpack/Public/Markets.js';
import { calculateIndicators } from '../Indicators.js';
import Logger from '../../Utils/Logger.js';

export class DefaultStrategy extends BaseStrategy {
  /**
   * Implementação da estratégia DEFAULT com novas regras
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @param {object} config - Configuração adicional
   * @param {string} btcTrend - Tendência do BTC (BULLISH/BEARISH/NEUTRAL)
   * @returns {object|null} - Objeto com decisão de trading ou null se não houver sinal
   */

  /**
   * NOVO: Método de auditoria que executa todas as validações e retorna pacote completo
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @param {object} config - Configuração adicional
   * @param {string} btcTrend - Tendência do BTC (BULLISH/BEARISH/NEUTRAL)
   * @returns {object} - Pacote de auditoria com todas as validações
   */
  async analyzeTradeWithAudit(fee, data, investmentUSD, media_rsi, config, btcTrend) {
    const auditInfo = {
      source: 'BACKTEST',
      timestamp: new Date().toISOString(),
      symbol: data.market.symbol,
    };

    const inputData = {
      currentPrice: data.marketPrice,
      indicators: {
        rsi: data.rsi,
        mfi: data.mfi,
        vwap: data.vwap,
        momentum: data.momentum,
        macd: data.macd,
        stoch: data.stoch,
      },
    };

    const validationTrace = [];
    let finalDecision = { decision: 'REJECTED', rejectionLayer: null };

    // 1. VALIDAÇÃO INICIAL DOS DADOS
    const dataValidation = this.validateData(data);
    validationTrace.push({
      layer: '1. Validação Inicial dos Dados',
      status: dataValidation ? 'PASS' : 'FAIL',
      evaluation: dataValidation ? 'Dados válidos' : 'Dados inválidos ou incompletos',
    });

    if (!dataValidation) {
      finalDecision.rejectionLayer = 'Validação Inicial dos Dados';
      return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
    }

    // 2. ANÁLISE DE SINAIS
    const signals = this.analyzeSignals(data, { isBTCAnalysis: false, config });
    validationTrace.push({
      layer: '2. Análise de Sinais',
      status: signals.hasSignal ? 'PASS' : 'FAIL',
      evaluation: signals.hasSignal
        ? `Sinal ${signals.signalType} detectado (${signals.isLong ? 'LONG' : 'SHORT'})`
        : 'Nenhum sinal de entrada detectado',
    });

    if (!signals.hasSignal) {
      finalDecision.rejectionLayer = 'Análise de Sinais';
      return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
    }

    // 3. FILTRO DE CONFIRMAÇÃO MONEY FLOW
    const moneyFlowValidation = this.validateMoneyFlowConfirmation(data, signals.isLong, {
      isBTCAnalysis: data.market.symbol === 'BTC_USDC_PERP',
      config,
    });
    validationTrace.push({
      layer: '3. Money Flow Filter',
      status: moneyFlowValidation.isValid ? 'PASS' : 'FAIL',
      evaluation: moneyFlowValidation.details,
    });

    if (!moneyFlowValidation.isValid) {
      finalDecision.rejectionLayer = 'Money Flow Filter';
      return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
    }

    // 4. FILTRO DE TENDÊNCIA VWAP
    const vwapValidation = this.validateVWAPTrend(data, signals.isLong, {
      isBTCAnalysis: data.market.symbol === 'BTC_USDC_PERP',
      config,
    });
    validationTrace.push({
      layer: '4. VWAP Filter',
      status: vwapValidation.isValid ? 'PASS' : 'FAIL',
      evaluation: vwapValidation.details,
    });

    if (!vwapValidation.isValid) {
      finalDecision.rejectionLayer = 'VWAP Filter';
      return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
    }

    // 5. FILTRO DE TENDÊNCIA DO BTC
    if (data.market.symbol !== 'BTC_USDC_PERP') {
      let btcValidation = { isValid: true, details: 'BTC não é o ativo analisado' };

      // Se BTC Trend Filter está desabilitado, pula validação
      if (config.enableBtcTrendFilter === false) {
        btcValidation = {
          isValid: true,
          details: 'BTC Trend Filter desabilitado pela configuração',
        };
      } else if (btcTrend === 'NEUTRAL') {
        btcValidation = {
          isValid: false,
          details: 'BTC em tendência NEUTRAL (não permite operações em altcoins)',
        };
      } else if (signals.isLong && btcTrend === 'BEARISH') {
        btcValidation = {
          isValid: false,
          details: 'BTC em tendência BEARISH (não permite LONG em altcoins)',
        };
      } else if (!signals.isLong && btcTrend === 'BULLISH') {
        btcValidation = {
          isValid: false,
          details: 'BTC em tendência BULLISH (não permite SHORT em altcoins)',
        };
      } else {
        btcValidation = {
          isValid: true,
          details: `BTC em tendência ${btcTrend} (favorável para ${signals.isLong ? 'LONG' : 'SHORT'})`,
        };
      }

      validationTrace.push({
        layer: '5. BTC Trend Filter',
        status: btcValidation.isValid ? 'PASS' : 'FAIL',
        evaluation: btcValidation.details,
      });

      if (!btcValidation.isValid) {
        finalDecision.rejectionLayer = 'BTC Trend Filter';
        return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
      }
    } else {
      validationTrace.push({
        layer: '5. BTC Trend Filter',
        status: 'PASS',
        evaluation: 'BTC é o ativo analisado (não aplicável)',
      });
    }

    // 6. CÁLCULO DE STOP E TARGET
    const action = signals.isLong ? 'long' : 'short';
    const price = parseFloat(data.marketPrice);

    // Carrega configurações do bot
    const stopLossPct = Number(config?.maxNegativePnlStopPct || -10);
    const takeProfitPct = Number(config?.minProfitPercentage || 0.5);

    // Valida se as configurações do bot existem
    if (!config?.maxNegativePnlStopPct) {
      console.error('❌ [DEFAULT_STRATEGY] maxNegativePnlStopPct não definida na config do bot');
      return null;
    }
    if (!config?.minProfitPercentage) {
      console.error('❌ [DEFAULT_STRATEGY] minProfitPercentage não definida na config do bot');
      return null;
    }

    const stopTarget = await this.calculateStopAndTarget(
      data,
      price,
      signals.isLong,
      stopLossPct,
      takeProfitPct,
      config
    );

    validationTrace.push({
      layer: '6. Cálculo de Stop e Target',
      status: stopTarget ? 'PASS' : 'FAIL',
      evaluation: stopTarget
        ? `Stop: $${stopTarget.stop.toFixed(6)}, Target: $${stopTarget.target.toFixed(6)}`
        : 'Falha no cálculo de stop/target',
    });

    if (!stopTarget) {
      finalDecision.rejectionLayer = 'Cálculo de Stop e Target';
      return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
    }

    // 7. CÁLCULO DE PNL E RISCO
    const { pnl, risk } = this.calculatePnLAndRisk(
      action,
      price,
      stopTarget.stop,
      stopTarget.target,
      investmentUSD,
      fee
    );

    validationTrace.push({
      layer: '7. Cálculo de PnL e Risco',
      status: 'PASS',
      evaluation: `PnL esperado: $${pnl.toFixed(2)}, Risco: $${risk.toFixed(2)}`,
    });

    // 8. VALIDAÇÃO FINAL
    validationTrace.push({
      layer: '8. Validação Final',
      status: 'PASS',
      evaluation: 'Todas as validações passaram - SINAL APROVADO',
    });

    // Se chegou até aqui, todas as validações passaram
    finalDecision = {
      decision: 'APPROVED',
      rejectionLayer: null,
    };

    // Retorna o pacote de auditoria com a decisão aprovada
    return this.buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace);
  }

  /**
   * Constrói o pacote de auditoria
   */
  buildAuditPackage(auditInfo, finalDecision, inputData, validationTrace) {
    return {
      auditInfo,
      finalDecision,
      inputData,
      validationTrace,
    };
  }
  async analyzeTrade(fee, data, investmentUSD, media_rsi, config = null, btcTrend = 'NEUTRAL') {
    try {
      // Validação inicial dos dados
      if (!this.validateData(data)) {
        return null;
      }

      // NOVO: Modo de Auditoria - executa todas as validações mesmo se falhar
      const isAuditing = config && config.isAuditing === true;

      if (isAuditing) {
        return this.analyzeTradeWithAudit(fee, data, investmentUSD, media_rsi, config, btcTrend);
      }

      // COMPORTAMENTO NORMAL (alta performance) - retorna null no primeiro filtro que falhar
      const signals = this.analyzeSignals(data, { isBTCAnalysis: false, config });

      if (!signals.hasSignal) {
        return null;
      }

      // FILTRO DE CONFIRMAÇÃO MONEY FLOW
      const moneyFlowValidation = this.validateMoneyFlowConfirmation(data, signals.isLong, {
        isBTCAnalysis: data.market.symbol === 'BTC_USDC_PERP',
        config,
      });

      if (!moneyFlowValidation.isValid) {
        Logger.info(
          `❌ ${data.market.symbol}: Sinal ${signals.signalType} rejeitado - ${moneyFlowValidation.reason}`
        );
        Logger.info(`   💰 Money Flow: ${moneyFlowValidation.details}`);
        return null;
      }

      Logger.info(
        `✅ ${data.market.symbol}: Money Flow confirma ${signals.isLong ? 'LONG' : 'SHORT'} - ${moneyFlowValidation.details}`
      );

      // FILTRO DE TENDÊNCIA VWAP (sentimento intradiário)
      const vwapValidation = this.validateVWAPTrend(data, signals.isLong, {
        isBTCAnalysis: data.market.symbol === 'BTC_USDC_PERP',
        config,
      });

      if (!vwapValidation.isValid) {
        Logger.info(
          `❌ ${data.market.symbol}: Sinal ${signals.signalType} rejeitado - ${vwapValidation.reason}`
        );
        Logger.info(`   📊 VWAP: ${vwapValidation.details}`);
        return null;
      }

      Logger.debug(
        `✅ ${data.market.symbol}: VWAP confirma ${signals.isLong ? 'LONG' : 'SHORT'} - ${vwapValidation.details}`
      );

      // FILTRO DE TENDÊNCIA DO BTC (usando tendência já calculada)
      if (data.market.symbol !== 'BTC_USDC_PERP' && config.enableBtcTrendFilter !== false) {
        // Só permite operações quando BTC tem tendência clara (BULLISH ou BEARISH)
        if (btcTrend === 'NEUTRAL') {
          return null; // BTC neutro - não operar em altcoins
        }

        // Validação restritiva: só permite operações alinhadas com a tendência do BTC
        if (signals.isLong && btcTrend === 'BEARISH') {
          Logger.info(
            `❌ ${data.market.symbol}: Sinal ${signals.signalType} rejeitado - BTC em tendência BEARISH (não permite LONG em altcoins)`
          );
          return null; // BTC em baixa - não entrar LONG em altcoins
        }

        if (!signals.isLong && btcTrend === 'BULLISH') {
          Logger.info(
            `❌ ${data.market.symbol}: Sinal ${signals.signalType} rejeitado - BTC em tendência BULLISH (não permite SHORT em altcoins)`
          );
          return null; // BTC em alta - não entrar SHORT em altcoins
        }
      }

      const action = signals.isLong ? 'long' : 'short';
      const price = parseFloat(data.marketPrice);

      // Carrega configurações do bot
      const stopLossPct = Number(config?.maxNegativePnlStopPct || -10);
      const takeProfitPct = Number(config?.minProfitPercentage || 0.5);

      // Valida se as configurações do bot existem
      if (!config?.maxNegativePnlStopPct) {
        console.error('❌ [DEFAULT_STRATEGY] maxNegativePnlStopPct não definida na config do bot');
        return null;
      }
      if (!config?.minProfitPercentage) {
        console.error('❌ [DEFAULT_STRATEGY] minProfitPercentage não definida na config do bot');
        return null;
      }

      // Cálculo de stop e target usando configurações do .env
      const stopTarget = await this.calculateStopAndTarget(
        data,
        price,
        signals.isLong,
        stopLossPct,
        takeProfitPct,
        config
      );
      if (!stopTarget) {
        return null;
      }

      const { stop, target } = stopTarget;
      const entry = price;

      // Log detalhado dos valores calculados
      Logger.info(
        `\n📊 [DEFAULT] ${data.market.symbol}: Entry: ${entry.toFixed(6)}, Stop: ${stop.toFixed(6)} (${((Math.abs(entry - stop) / entry) * 100).toFixed(2)}%), Target: ${target.toFixed(6)} (${((Math.abs(target - entry) / entry) * 100).toFixed(2)}%)`
      );

      // Cálculo de PnL e risco
      const { pnl, risk } = this.calculatePnLAndRisk(
        action,
        entry,
        stop,
        target,
        investmentUSD,
        fee
      );

      // Log mais claro sobre a tendência do BTC
      let btcTrendMsg;
      if (data.market.symbol === 'BTC_USDC_PERP') {
        btcTrendMsg = 'TENDÊNCIA ATUAL DO BTC';
      } else if (btcTrend === 'BULLISH') {
        btcTrendMsg = 'BTC em alta (favorável)';
      } else if (btcTrend === 'BEARISH') {
        btcTrendMsg = 'BTC em baixa (favorável)';
      } else if (btcTrend === 'NEUTRAL') {
        btcTrendMsg = 'BTC neutro (não permitido)';
      } else {
        btcTrendMsg = `BTC: ${btcTrend}`;
      }

      Logger.info(
        `✅ ${data.market.symbol}: ${action.toUpperCase()} - Tendência: ${btcTrendMsg} - Sinal: ${signals.signalType} - Money Flow: ${moneyFlowValidation.reason} - VWAP: ${vwapValidation.reason}`
      );

      // Retorna decisão de trading (a execução será feita pelo Decision.js)
      return {
        market: data.market.symbol,
        entry: Number(entry.toFixed(data.market.decimal_price)),
        stop: Number(stop.toFixed(data.market.decimal_price)),
        target: Number(target.toFixed(data.market.decimal_price)),
        action,
        pnl,
        risk,
        // Dados adicionais para execução
        volume: investmentUSD,
        decimal_quantity: data.market.decimal_quantity,
        decimal_price: data.market.decimal_price,
        stepSize_quantity: data.market.stepSize_quantity,
        minQuantity: data.market.minQuantity, // ✅ CORREÇÃO: Inclui minQuantity na resposta
        botName: data.botName || 'DEFAULT',
        originalSignalData: { signals, moneyFlowValidation, vwapValidation, btcTrend, data },
      };
    } catch (error) {
      Logger.error('DefaultStrategy.analyzeTrade - Error:', error.message);
      return null;
    }
  }

  /**
   * 🎯 ANÁLISE POR CONFLUÊNCIA - Combina múltiplos indicadores para sinais mais seguros
   * Ao invés de usar o primeiro indicador que der sinal, exige que vários concordem
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis, config }
   * @returns {object} - Resultado da análise combinada
   */
  analyzeSignalsByConfluence(data, options = {}) {
    const { isBTCAnalysis = false, config = {} } = options;
    const minConfluences = config.minConfluences || 2;

    // Coleta sinais individuais de cada indicador
    const signals = {
      momentum: this.analyzeMomentumSignal(data, { isBTCAnalysis }),
      rsi: this.analyzeRsiSignal(data, { isBTCAnalysis }),
      stochastic: this.analyzeStochasticSignal(data, { isBTCAnalysis }),
      macd: this.analyzeMacdSignal(data, { isBTCAnalysis }),
      adx: this.analyzeAdxSignal(data, { isBTCAnalysis }),
    };

    // Filtra apenas sinais habilitados na configuração
    const enabledSignals = {};
    if (config.enableMomentumSignals !== false) enabledSignals.momentum = signals.momentum;
    if (config.enableRsiSignals !== false) enabledSignals.rsi = signals.rsi;
    if (config.enableStochasticSignals !== false) enabledSignals.stochastic = signals.stochastic;
    if (config.enableMacdSignals !== false) enabledSignals.macd = signals.macd;
    if (config.enableAdxSignals !== false) enabledSignals.adx = signals.adx;

    // Conta quantos indicadores concordam em cada direção
    let longSignals = [];
    let shortSignals = [];
    let analysisDetails = [];

    for (const [indicatorName, signal] of Object.entries(enabledSignals)) {
      if (signal && signal.hasSignal) {
        if (signal.isLong) {
          longSignals.push({ indicator: indicatorName, signal });
        } else if (signal.isShort) {
          shortSignals.push({ indicator: indicatorName, signal });
        }

        // Adiciona detalhes do indicador individual
        analysisDetails.push(`${indicatorName}: ${signal.signalType}`);
      } else {
        analysisDetails.push(`${indicatorName}: Sem sinal`);
      }
    }

    // Log de debug para confluência
    if (isBTCAnalysis) {
      console.log(
        `   🎯 [CONFLUÊNCIA] LONG: ${longSignals.length}, SHORT: ${shortSignals.length}, Mín: ${minConfluences}`
      );
      longSignals.forEach(s =>
        console.log(`      ✅ LONG: ${s.indicator} - ${s.signal.signalType}`)
      );
      shortSignals.forEach(s =>
        console.log(`      ✅ SHORT: ${s.indicator} - ${s.signal.signalType}`)
      );
    }

    // Verifica se há confluência suficiente
    if (longSignals.length >= minConfluences) {
      const signalNames = longSignals.map(s => s.indicator).join('+');
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: `Confluência LONG (${longSignals.length}/${Object.keys(enabledSignals).length}): ${signalNames}`,
        analysisDetails,
        confluenceData: {
          direction: 'LONG',
          count: longSignals.length,
          total: Object.keys(enabledSignals).length,
          indicators: longSignals.map(s => s.indicator),
        },
      };
    }

    if (shortSignals.length >= minConfluences) {
      const signalNames = shortSignals.map(s => s.indicator).join('+');
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: `Confluência SHORT (${shortSignals.length}/${Object.keys(enabledSignals).length}): ${signalNames}`,
        analysisDetails,
        confluenceData: {
          direction: 'SHORT',
          count: shortSignals.length,
          total: Object.keys(enabledSignals).length,
          indicators: shortSignals.map(s => s.indicator),
        },
      };
    }

    // Não há confluência suficiente
    return {
      hasSignal: false,
      signalType: `Confluência insuficiente (LONG: ${longSignals.length}, SHORT: ${shortSignals.length}, Mín: ${minConfluences})`,
      analysisDetails,
      confluenceData: {
        direction: null,
        longCount: longSignals.length,
        shortCount: shortSignals.length,
        minRequired: minConfluences,
        total: Object.keys(enabledSignals).length,
      },
    };
  }

  /**
   * Analisa os sinais baseados nas novas regras com validação de cruzamentos
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis, config }
   * @returns {object} - Resultado da análise de sinais
   */
  analyzeSignals(data, options = {}) {
    const { isBTCAnalysis = false, config = {} } = options;

    // 🎯 CONFLUÊNCIA: Se habilitada, usa análise combinada ao invés de prioridade
    if (config.enableConfluenceMode === true) {
      return this.analyzeSignalsByConfluence(data, options);
    }

    // 🔧 HEIKIN ASHI FILTER - Valida reversão de 3 velas ANTES de outros indicadores
    // Se habilitado, SÓ permite sinais quando houver reversão confirmada
    let heikinAshiValidation = null;
    if (config.enableHeikinAshi === true || config.enableHeikinAshi === 'true') {
      heikinAshiValidation = this.validateHeikinAshiReversal(data, { isBTCAnalysis, config });

      // Se Heikin Ashi está configurado E não há reversão confirmada, rejeita sinal
      if (!heikinAshiValidation.hasReversal) {
        if (isBTCAnalysis) {
          Logger.debug(
            `   ❌ BTC: Sem reversão Heikin Ashi confirmada - ${heikinAshiValidation.reason}`
          );
        }
        return {
          hasSignal: false,
          signalType: 'Rejeitado - Sem reversão Heikin Ashi',
          analysisDetails: [heikinAshiValidation.reason],
        };
      }

      // Se há reversão, continua com os outros indicadores
      if (isBTCAnalysis) {
        Logger.debug(`   ✅ BTC: Reversão Heikin Ashi confirmada - ${heikinAshiValidation.reason}`);
      }
    }

    // COMPORTAMENTO ORIGINAL: Sistema de prioridade (primeiro que der sinal ganha)
    const rsi = data.rsi;
    const stoch = data.stoch;
    const macd = data.macd;
    const adx = data.adx;

    // Validação dos indicadores essenciais (mais flexível para indicadores opcionais)
    const hasEssentialIndicators = rsi?.value !== null && rsi?.value !== undefined;
    const hasMomentum =
      data.momentum?.current?.wt1 !== null && data.momentum?.current?.wt2 !== null;
    const hasStoch =
      stoch?.k !== null && stoch?.k !== undefined && stoch?.d !== null && stoch?.d !== undefined;
    const hasMacd = macd?.MACD !== null && macd?.MACD !== undefined;
    const hasAdx =
      adx?.adx !== null &&
      adx?.adx !== undefined &&
      adx?.diPlus !== null &&
      adx?.diPlus !== undefined &&
      adx?.diMinus !== null &&
      adx?.diMinus !== undefined;

    if (!hasEssentialIndicators) {
      if (isBTCAnalysis) {
        Logger.debug(`   ⚠️ BTC: Indicadores essenciais incompletos - RSI: ${rsi?.value}`);
      }
      return { hasSignal: false, analysisDetails: ['Indicadores essenciais incompletos'] };
    }

    // Log de indicadores opcionais faltando
    if (isBTCAnalysis) {
      const missingIndicators = [];
      if (!hasMomentum) missingIndicators.push('Momentum');
      if (!hasStoch) missingIndicators.push('StochK/StochD');
      if (!hasMacd) missingIndicators.push('MACD');
      if (!hasAdx) missingIndicators.push('ADX/D+/D-');

      if (missingIndicators.length > 0) {
        Logger.debug(
          `   ℹ️ BTC: Indicadores opcionais faltando: ${missingIndicators.join(', ')} - continuando análise`
        );
      }
    }

    let isLong = false;
    let isShort = false;
    let signalType = '';
    let analysisDetails = [];

    // 1. ANÁLISE DE MOMENTUM (WaveTrend) - NOVA ESTRUTURA
    const momentum = data.momentum;

    if (
      config.enableMomentumSignals !== false && // Default: true
      momentum &&
      momentum.current &&
      momentum.current.wt1 !== null &&
      momentum.current.wt2 !== null
    ) {
      const currentMomentum = momentum.current;
      const previousMomentum = momentum.previous;

      // Log detalhado do Momentum para debug
      if (isBTCAnalysis) {
        console.log(
          `      • Momentum Debug: WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}, Cross=${currentMomentum.cross || 'NONE'}, Direction=${currentMomentum.direction}, Bullish=${currentMomentum.isBullish}, Bearish=${currentMomentum.isBearish}`
        );
      }

      // SINAL DE LONG (Compra) - NOVA LÓGICA WAVETREND
      // Condição A (Cruzamento BULLISH): momentum.current.cross === 'BULLISH'
      // Condição B (Direção UP): momentum.current.direction === 'UP'
      if (currentMomentum.cross === 'BULLISH') {
        isLong = true;
        signalType = 'Momentum Cruzamento BULLISH';
        analysisDetails.push(
          `Momentum: Cruzamento BULLISH (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) - Sinal Forte`
        );
      } else if (currentMomentum.direction === 'UP' && currentMomentum.isBullish) {
        isLong = true;
        signalType = 'Momentum Direção UP + Confirmação';
        analysisDetails.push(
          `Momentum: Direção UP (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) + Bullish=${currentMomentum.isBullish} (tendência de alta com confirmação)`
        );
      } else if (currentMomentum.direction === 'UP') {
        analysisDetails.push(
          `Momentum: Direção UP (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) (tendência de alta, mas sem confirmação bullish)`
        );
      }

      // SINAL DE SHORT (Venda) - NOVA LÓGICA WAVETREND
      // Condição A (Cruzamento BEARISH): momentum.current.cross === 'BEARISH'
      // Condição B (Direção DOWN): momentum.current.direction === 'DOWN'
      else if (currentMomentum.cross === 'BEARISH') {
        isShort = true;
        signalType = 'Momentum Cruzamento BEARISH';
        analysisDetails.push(
          `Momentum: Cruzamento BEARISH (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) - Sinal Forte`
        );
      } else if (currentMomentum.direction === 'DOWN' && currentMomentum.isBearish) {
        isShort = true;
        signalType = 'Momentum Direção DOWN + Confirmação';
        analysisDetails.push(
          `Momentum: Direção DOWN (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) + Bearish=${currentMomentum.isBearish} (tendência de baixa com confirmação)`
        );
      } else if (currentMomentum.direction === 'DOWN') {
        analysisDetails.push(
          `Momentum: Direção DOWN (WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)}) (tendência de baixa, mas sem confirmação bearish)`
        );
      }

      // CASO NEUTRO
      else {
        analysisDetails.push(
          `Momentum: WT1=${(currentMomentum.wt1 || 0).toFixed(3)}, WT2=${(currentMomentum.wt2 || 0).toFixed(3)} (neutro)`
        );
      }
    } else if (config.enableMomentumSignals === false) {
      analysisDetails.push(`Momentum: Desabilitado pela configuração`);
    } else {
      analysisDetails.push(`Momentum: Não disponível`);
    }

    // 2. RSI com validação de cruzamento da média em sobrecompra/sobrevenda
    if (!isLong && !isShort && config.enableRsiSignals !== false && hasEssentialIndicators) {
      const rsiValue = rsi.value;
      const rsiPrev = rsi.prev;
      const rsiAvg = rsi.avg;
      const rsiAvgPrev = rsi.avgPrev;

      // Log detalhado do RSI para debug
      if (isBTCAnalysis) {
        console.log(
          `      • RSI Debug: Value=${(rsiValue || 0).toFixed(1)}, Prev=${(rsiPrev || 0).toFixed(1)}, Avg=${(rsiAvg || 0).toFixed(1)}, AvgPrev=${(rsiAvgPrev || 0).toFixed(1)}`
        );
      }

      // RSI Sobrevendido para LONG (RSI < 30 + cruzamento RSI acima da média)
      if (rsiValue <= 30 && rsiAvg !== null && rsiAvgPrev !== null) {
        // Verifica se RSI está cruzando acima da sua média (saindo da sobrevendido)
        if (rsiPrev <= rsiAvgPrev && rsiValue > rsiAvg) {
          isLong = true;
          signalType = 'RSI Sobrevendido + Cruzamento Acima da Média';
          analysisDetails.push(
            `RSI: ${(rsiValue || 0).toFixed(1)} > Média(${(rsiAvg || 0).toFixed(1)}) | Cruzou acima em região sobrevendida (<30)`
          );
        } else {
          analysisDetails.push(
            `RSI: ${(rsiValue || 0).toFixed(1)} (sobrevendido, mas sem cruzamento acima da média)`
          );
        }
      }
      // RSI Sobrecomprado para SHORT (RSI > 70 + cruzamento RSI abaixo da média)
      else if (rsiValue >= 70 && rsiAvg !== null && rsiAvgPrev !== null) {
        // Verifica se RSI está cruzando abaixo da sua média (saindo da sobrecomprado)
        if (rsiPrev >= rsiAvgPrev && rsiValue < rsiAvg) {
          isShort = true;
          signalType = 'RSI Sobrecomprado + Cruzamento Abaixo da Média';
          analysisDetails.push(
            `RSI: ${(rsiValue || 0).toFixed(1)} < Média(${(rsiAvg || 0).toFixed(1)}) | Cruzou abaixo em região sobrecomprada (>70)`
          );
        } else {
          analysisDetails.push(
            `RSI: ${(rsiValue || 0).toFixed(1)} (sobrecomprado, mas sem cruzamento abaixo da média)`
          );
        }
      } else {
        analysisDetails.push(
          `RSI: ${(rsiValue || 0).toFixed(1)} | Média: ${(rsiAvg || 0).toFixed(1)} (neutro - fora das regiões de sobrecompra/sobrevenda)`
        );
      }
    } else if (config.enableRsiSignals === false) {
      analysisDetails.push(`RSI: Desabilitado pela configuração`);
    } else {
      analysisDetails.push(`RSI: Não disponível`);
    }

    // 3. Slow Stochastic com validação de cruzamentos CORRIGIDA (se disponível)
    if (!isLong && !isShort && config.enableStochasticSignals !== false && hasStoch) {
      const stochK = stoch.k;
      const stochD = stoch.d;
      const stochKPrev = stoch.kPrev;
      const stochDPrev = stoch.dPrev;

      // Log detalhado do Stochastic para debug
      if (isBTCAnalysis) {
        console.log(
          `      • Stoch Debug: K=${(stochK || 0).toFixed(1)}, D=${(stochD || 0).toFixed(1)}, KPrev=${(stochKPrev || 0).toFixed(1)}, DPrev=${(stochDPrev || 0).toFixed(1)}`
        );
      }

      // Slow Stochastic Sobrevendido para LONG (ambos K e D <= 20 + cruzamento bullish)
      if (stochK <= 20 && stochD <= 20) {
        // Verifica se K está cruzando acima do D (reversão de sobrevendido)
        if (
          stochKPrev !== null &&
          stochKPrev !== undefined &&
          stochDPrev !== null &&
          stochDPrev !== undefined &&
          stochKPrev <= stochDPrev && // K estava abaixo do D
          stochK > stochD // K agora está acima do D
        ) {
          isLong = true;
          signalType = 'Stochastic Sobrevendido + Cruzamento K>D';
          analysisDetails.push(
            `Stoch: K(${(stochK || 0).toFixed(1)}) > D(${(stochD || 0).toFixed(1)}) | K cruzou acima em sobrevendido`
          );
        } else {
          analysisDetails.push(
            `Stoch: K=${(stochK || 0).toFixed(1)}, D=${(stochD || 0).toFixed(1)} (sobrevendido, mas sem cruzamento K>D)`
          );
        }
      }
      // Slow Stochastic Sobrecomprado para SHORT (ambos K e D >= 80 + cruzamento bearish)
      else if (stochK >= 80 && stochD >= 80) {
        // Verifica se K está cruzando abaixo do D (reversão de sobrecomprado)
        if (
          stochKPrev !== null &&
          stochKPrev !== undefined &&
          stochDPrev !== null &&
          stochDPrev !== undefined &&
          stochKPrev >= stochDPrev && // K estava acima do D
          stochK < stochD // K agora está abaixo do D
        ) {
          isShort = true;
          signalType = 'Stochastic Sobrecomprado + Cruzamento K<D';
          analysisDetails.push(
            `Stoch: K(${(stochK || 0).toFixed(1)}) < D(${(stochD || 0).toFixed(1)}) | K cruzou abaixo em sobrecomprado`
          );
        } else {
          analysisDetails.push(
            `Stoch: K=${(stochK || 0).toFixed(1)}, D=${(stochD || 0).toFixed(1)} (sobrecomprado, mas sem cruzamento K<D)`
          );
        }
      } else {
        analysisDetails.push(
          `Stoch: K=${(stochK || 0).toFixed(1)}, D=${(stochD || 0).toFixed(1)} (neutro)`
        );
      }
    } else if (config.enableStochasticSignals === false) {
      analysisDetails.push(`Stoch: Desabilitado pela configuração`);
    } else if (hasStoch) {
      analysisDetails.push(
        `Stoch: K=${(stoch.k || 0).toFixed(1)}, D=${(stoch.d || 0).toFixed(1)} (já definido por Momentum)`
      );
    } else {
      analysisDetails.push(`Stoch: Não disponível`);
    }

    // 4. MACD com validação de momentum e tendência (CORRIGIDO)
    if (!isLong && !isShort && config.enableMacdSignals !== false && hasMacd) {
      const macdValue = macd.MACD;
      const macdSignal = macd.MACD_signal;
      const macdHistogram = macd.MACD_histogram;
      const macdHistogramPrev = macd.histogramPrev;

      // Log detalhado do MACD para debug
      if (isBTCAnalysis) {
        console.log(
          `      • MACD Debug: Value=${(macdValue || 0).toFixed(3)}, Signal=${(macdSignal || 0).toFixed(3)}, Hist=${(macdHistogram || 0).toFixed(3)}, HistPrev=${(macdHistogramPrev || 0).toFixed(3)}`
        );
      }

      // NOVA LÓGICA: MACD como indicador de momentum e tendência (NÃO sobrecompra/sobrevenda)
      if (macdSignal !== null && macdSignal !== undefined) {
        // MACD BULLISH: Histograma positivo (momentum de alta) + cruzamento de baixo para cima
        if (
          macdHistogram > 0 &&
          macdValue > macdSignal &&
          macdHistogramPrev !== null &&
          macdHistogramPrev !== undefined &&
          macdHistogramPrev < macdHistogram
        ) {
          isLong = true;
          signalType = 'MACD Bullish + Cruzamento';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} > HistPrev=${(macdHistogramPrev || 0).toFixed(3)} (bullish + momentum crescente)`
          );
        }
        // MACD BEARISH: Histograma negativo (momentum de baixa) + cruzamento de cima para baixo
        else if (
          macdHistogram < 0 &&
          macdValue < macdSignal &&
          macdHistogramPrev !== null &&
          macdHistogramPrev !== undefined &&
          macdHistogramPrev > macdHistogram
        ) {
          isShort = true;
          signalType = 'MACD Bearish + Cruzamento';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} < HistPrev=${(macdHistogramPrev || 0).toFixed(3)} (bearish + momentum decrescente)`
          );
        }
        // MACD BULLISH forte (histograma muito positivo) - sem cruzamento
        else if (macdHistogram > 0.5 && macdValue > macdSignal) {
          isLong = true;
          signalType = 'MACD Bullish Forte';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} > Signal (bullish forte)`
          );
        }
        // MACD BEARISH forte (histograma muito negativo) - sem cruzamento
        else if (macdHistogram < -0.5 && macdValue < macdSignal) {
          isShort = true;
          signalType = 'MACD Bearish Forte';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} < Signal (bearish forte)`
          );
        } else {
          analysisDetails.push(`MACD: Hist=${(macdHistogram || 0).toFixed(3)} (neutro)`);
        }
      } else {
        // Usa apenas o histograma sem signal (com cruzamento)
        if (
          macdHistogram > 0.3 &&
          macdHistogramPrev !== null &&
          macdHistogramPrev !== undefined &&
          macdHistogramPrev < macdHistogram
        ) {
          isLong = true;
          signalType = 'MACD Bullish + Cruzamento';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} > HistPrev=${(macdHistogramPrev || 0).toFixed(3)} (bullish + momentum crescente - sem signal)`
          );
        }
        // MACD BEARISH (histograma negativo) - sem cruzamento
        else if (
          macdHistogram < -0.3 &&
          macdHistogramPrev !== null &&
          macdHistogramPrev !== undefined &&
          macdHistogramPrev > macdHistogram
        ) {
          isShort = true;
          signalType = 'MACD Bearish + Cruzamento';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} < HistPrev=${(macdHistogramPrev || 0).toFixed(3)} (bearish + momentum decrescente - sem signal)`
          );
        }
        // MACD BULLISH forte (histograma muito positivo) - sem cruzamento
        else if (macdHistogram > 0.5) {
          isLong = true;
          signalType = 'MACD Bullish Forte';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} (bullish forte - sem signal)`
          );
        }
        // MACD BEARISH forte (histograma muito negativo) - sem cruzamento
        else if (macdHistogram < -0.5) {
          isShort = true;
          signalType = 'MACD Bearish Forte';
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} (bearish forte - sem signal)`
          );
        } else {
          analysisDetails.push(
            `MACD: Hist=${(macdHistogram || 0).toFixed(3)} (neutro - sem signal)`
          );
        }
      }
    } else if (config.enableMacdSignals === false) {
      analysisDetails.push(`MACD: Desabilitado pela configuração`);
    } else if (hasMacd) {
      analysisDetails.push(
        `MACD: Hist=${(macd.MACD_histogram || 0).toFixed(3)} (já definido anteriormente)`
      );
    } else {
      analysisDetails.push(`MACD: Não disponível`);
    }

    // 5. ADX com validação da EMA (ou sem EMA se não disponível)
    if (!isLong && !isShort && config.enableAdxSignals !== false && hasAdx) {
      const adxValue = adx.adx;
      const diPlus = adx.diPlus;
      const diMinus = adx.diMinus;
      const adxEma = adx.adxEma;

      // Se EMA do ADX estiver disponível, usa ela. Senão, usa threshold fixo
      const adxThreshold = adxEma !== null && adxEma !== undefined ? adxEma : 25;
      const useEma = adxEma !== null && adxEma !== undefined;

      // Valida se ADX está acima do threshold
      if (adxValue > adxThreshold) {
        // D+ acima do D- para LONG
        if (diPlus > diMinus) {
          isLong = true;
          signalType = 'ADX Bullish';
          if (useEma) {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > EMA(${(adxEma || 0).toFixed(1)}) | D+(${(diPlus || 0).toFixed(1)}) > D-(${(diMinus || 0).toFixed(1)})`
            );
          } else {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > 25 | D+(${(diPlus || 0).toFixed(1)}) > D-(${(diMinus || 0).toFixed(1)})`
            );
          }
        }
        // D- acima do D+ para SHORT
        else if (diMinus > diPlus) {
          isShort = true;
          signalType = 'ADX Bearish';
          if (useEma) {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > EMA(${(adxEma || 0).toFixed(1)}) | D-(${(diMinus || 0).toFixed(1)}) > D+(${(diPlus || 0).toFixed(1)})`
            );
          } else {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > 25 | D-(${(diMinus || 0).toFixed(1)}) > D+(${(diPlus || 0).toFixed(1)})`
            );
          }
        } else {
          if (useEma) {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > EMA(${(adxEma || 0).toFixed(1)}) | D+(${(diPlus || 0).toFixed(1)}) ≈ D-(${(diMinus || 0).toFixed(1)}) (neutro)`
            );
          } else {
            analysisDetails.push(
              `ADX: ${(adxValue || 0).toFixed(1)} > 25 | D+(${(diPlus || 0).toFixed(1)}) ≈ D-(${(diMinus || 0).toFixed(1)}) (neutro)`
            );
          }
        }
      } else {
        if (useEma) {
          analysisDetails.push(
            `ADX: ${(adxValue || 0).toFixed(1)} < EMA(${(adxEma || 0).toFixed(1)}) (tendência fraca)`
          );
        } else {
          analysisDetails.push(`ADX: ${(adxValue || 0).toFixed(1)} < 25 (tendência fraca)`);
        }
      }
    } else if (config.enableAdxSignals === false) {
      analysisDetails.push(`ADX: Desabilitado pela configuração`);
    } else if (hasAdx) {
      analysisDetails.push(`ADX: ${(adx.adx || 0).toFixed(1)} (já definido anteriormente)`);
    } else {
      analysisDetails.push(`ADX: Não disponível`);
    }

    // 🔧 VALIDAÇÃO FINAL: Se Heikin Ashi está habilitado E um sinal foi detectado,
    // valida que a direção do Heikin Ashi está alinhada com o sinal
    if (heikinAshiValidation && heikinAshiValidation.hasReversal && (isLong || isShort)) {
      const heikinDirection = heikinAshiValidation.direction; // 'LONG' ou 'SHORT'
      const signalDirection = isLong ? 'LONG' : 'SHORT';

      // Se as direções NÃO estão alinhadas, rejeita o sinal
      if (heikinDirection !== signalDirection) {
        if (isBTCAnalysis) {
          Logger.debug(
            `   ❌ BTC: Heikin Ashi (${heikinDirection}) NÃO está alinhado com sinal (${signalDirection})`
          );
        }
        return {
          hasSignal: false,
          signalType: `Rejeitado - Heikin Ashi ${heikinDirection} vs Sinal ${signalDirection}`,
          analysisDetails: [
            ...analysisDetails,
            `Heikin Ashi indica ${heikinDirection}, mas sinal é ${signalDirection}`,
          ],
        };
      }

      // Se estão alinhados, adiciona aos detalhes
      analysisDetails.push(
        `Heikin Ashi: ${heikinAshiValidation.reason} (alinhado com ${signalDirection})`
      );
    }

    return {
      hasSignal: isLong || isShort,
      isLong,
      isShort,
      signalType,
      analysisDetails: analysisDetails || [],
    };
  }

  /**
   * 🎯 CONFLUÊNCIA: Análise isolada do Momentum (WaveTrend)
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis }
   * @returns {object|null} - Resultado do sinal do Momentum ou null
   */
  analyzeMomentumSignal(data, options = {}) {
    const { isBTCAnalysis = false } = options;
    const momentum = data.momentum;

    if (
      !momentum ||
      !momentum.current ||
      momentum.current.wt1 === null ||
      momentum.current.wt2 === null
    ) {
      return null;
    }

    const currentMomentum = momentum.current;

    // SINAL DE LONG (Compra) - LÓGICA WAVETREND
    if (currentMomentum.cross === 'BULLISH') {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'Momentum Cruzamento BULLISH',
        strength: 'forte',
      };
    } else if (currentMomentum.direction === 'UP' && currentMomentum.isBullish) {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'Momentum Direção UP + Confirmação',
        strength: 'médio',
      };
    }

    // SINAL DE SHORT (Venda) - LÓGICA WAVETREND
    else if (currentMomentum.cross === 'BEARISH') {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'Momentum Cruzamento BEARISH',
        strength: 'forte',
      };
    } else if (currentMomentum.direction === 'DOWN' && currentMomentum.isBearish) {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'Momentum Direção DOWN + Confirmação',
        strength: 'médio',
      };
    }

    return null;
  }

  /**
   * 🎯 CONFLUÊNCIA: Análise isolada do RSI
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis }
   * @returns {object|null} - Resultado do sinal do RSI ou null
   */
  analyzeRsiSignal(data, options = {}) {
    const { isBTCAnalysis = false } = options;
    const rsi = data.rsi;

    if (
      !rsi ||
      rsi.value === null ||
      rsi.prev === null ||
      rsi.avg === null ||
      rsi.avgPrev === null
    ) {
      return null;
    }

    // SINAL LONG: RSI saindo de sobrevendido com cruzamento da média
    if (rsi.value < 30 && rsi.prev <= rsi.avgPrev && rsi.value > rsi.avg) {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'RSI Sobrevendido + Cruzamento Média',
        strength: 'forte',
      };
    }

    // SINAL SHORT: RSI saindo de sobrecomprado com cruzamento da média
    if (rsi.value > 70 && rsi.prev >= rsi.avgPrev && rsi.value < rsi.avg) {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'RSI Sobrecomprado + Cruzamento Média',
        strength: 'forte',
      };
    }

    return null;
  }

  /**
   * 🎯 CONFLUÊNCIA: Análise isolada do Stochastic
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis }
   * @returns {object|null} - Resultado do sinal do Stochastic ou null
   */
  analyzeStochasticSignal(data, options = {}) {
    const { isBTCAnalysis = false } = options;
    const stoch = data.stoch;

    if (
      !stoch ||
      stoch.k === null ||
      stoch.d === null ||
      stoch.kPrev === null ||
      stoch.dPrev === null
    ) {
      return null;
    }

    // SINAL LONG: K > D em região sobrevendida com cruzamento
    if (stoch.k < 20 && stoch.d < 20 && stoch.kPrev <= stoch.dPrev && stoch.k > stoch.d) {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'Stochastic K>D Sobrevendido',
        strength: 'médio',
      };
    }

    // SINAL SHORT: K < D em região sobrecomprada com cruzamento
    if (stoch.k > 80 && stoch.d > 80 && stoch.kPrev >= stoch.dPrev && stoch.k < stoch.d) {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'Stochastic K<D Sobrecomprado',
        strength: 'médio',
      };
    }

    return null;
  }

  /**
   * 🎯 CONFLUÊNCIA: Análise isolada do MACD
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis }
   * @returns {object|null} - Resultado do sinal do MACD ou null
   */
  analyzeMacdSignal(data, options = {}) {
    const { isBTCAnalysis = false } = options;
    const macd = data.macd;

    if (!macd || macd.MACD_histogram === null || macd.histogramPrev === null) {
      return null;
    }

    const histogram = macd.MACD_histogram;
    const histogramPrev = macd.histogramPrev;

    // SINAL LONG: Histograma positivo e crescendo
    if (histogram > 0 && histogramPrev !== null && histogramPrev < histogram) {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'MACD Histograma Bullish + Crescendo',
        strength: 'médio',
      };
    }

    // SINAL SHORT: Histograma negativo e decrescendo
    if (histogram < 0 && histogramPrev !== null && histogramPrev > histogram) {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'MACD Histograma Bearish + Decrescendo',
        strength: 'médio',
      };
    }

    return null;
  }

  /**
   * 🎯 CONFLUÊNCIA: Análise isolada do ADX
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções de análise: { isBTCAnalysis }
   * @returns {object|null} - Resultado do sinal do ADX ou null
   */
  analyzeAdxSignal(data, options = {}) {
    const { isBTCAnalysis = false } = options;
    const adx = data.adx;

    if (!adx || adx.adx === null || adx.diPlus === null || adx.diMinus === null) {
      return null;
    }

    const adxValue = adx.adx;
    const diPlus = adx.diPlus;
    const diMinus = adx.diMinus;

    // Só considera sinais quando ADX > 25 (tendência forte)
    if (adxValue < 25) {
      return null;
    }

    // SINAL LONG: DI+ > DI- com ADX forte
    if (diPlus > diMinus && diPlus - diMinus > 5) {
      return {
        hasSignal: true,
        isLong: true,
        isShort: false,
        signalType: 'ADX Tendência Alta Forte',
        strength: 'médio',
      };
    }

    // SINAL SHORT: DI- > DI+ com ADX forte
    if (diMinus > diPlus && diMinus - diPlus > 5) {
      return {
        hasSignal: true,
        isLong: false,
        isShort: true,
        signalType: 'ADX Tendência Baixa Forte',
        strength: 'médio',
      };
    }

    return null;
  }

  /**
   * Valida se o VWAP confirma a tendência intradiária
   * @param {object} data - Dados de mercado com indicadores
   * @param {boolean} isLong - Se é sinal de compra
   * @param {object} options - Opções: { isBTCAnalysis, config }
   * @returns {object} - Resultado da validação
   */
  validateVWAPTrend(data, isLong, options = {}) {
    const { isBTCAnalysis = false, config = {} } = options;

    // Se VWAP está desabilitado, pula validação
    if (config.enableVwapFilter === false) {
      return {
        isValid: true,
        reason: 'VWAP Filter desabilitado',
        details: 'Validação pulada pela configuração do bot',
      };
    }

    const vwap = data.vwap;
    const currentPrice = parseFloat(data.marketPrice);

    // Verifica se o VWAP está disponível
    if (!vwap || vwap.vwap === null || vwap.vwap === undefined) {
      if (isBTCAnalysis) {
        console.log(`   ⚠️ BTC: VWAP não disponível`);
      }
      return {
        isValid: false,
        reason: 'VWAP não disponível',
        details: 'Indicador VWAP não encontrado nos dados',
      };
    }

    const vwapValue = vwap.vwap;
    const stdDev = vwap.stdDev;
    const upperBand = vwap.upperBands;
    const lowerBand = vwap.lowerBands;

    let isValid = false;
    let reason = '';
    let details = '';

    if (isLong) {
      // Para sinal LONG: Preço atual deve estar acima do VWAP
      if (currentPrice > vwapValue) {
        isValid = true;
        reason = 'VWAP confirma LONG';
        details = `Preço: ${currentPrice.toFixed(6)} > VWAP: ${vwapValue.toFixed(6)} (sentimento intradiário bullish)`;
      } else {
        isValid = false;
        reason = 'VWAP não confirma LONG';
        details = `Preço: ${currentPrice.toFixed(6)} <= VWAP: ${vwapValue.toFixed(6)} (sentimento intradiário bearish)`;
      }
    } else {
      // Para sinal SHORT: Preço atual deve estar abaixo do VWAP
      if (currentPrice < vwapValue) {
        isValid = true;
        reason = 'VWAP confirma SHORT';
        details = `Preço: ${currentPrice.toFixed(6)} < VWAP: ${vwapValue.toFixed(6)} (sentimento intradiário bearish)`;
      } else {
        isValid = false;
        reason = 'VWAP não confirma SHORT';
        details = `Preço: ${currentPrice.toFixed(6)} >= VWAP: ${vwapValue.toFixed(6)} (sentimento intradiário bullish)`;
      }
    }

    // Log detalhado do VWAP
    if (isBTCAnalysis) {
      console.log(
        `   📊 BTC VWAP: Preço=${currentPrice.toFixed(6)}, VWAP=${vwapValue.toFixed(6)}, StdDev=${(stdDev || 0).toFixed(6)}`
      );
      console.log(`   ${isValid ? '✅' : '❌'} BTC: ${reason} - ${details}`);
    }

    return {
      isValid,
      reason,
      details,
      currentPrice,
      vwapValue,
      stdDev,
      upperBand,
      lowerBand,
    };
  }

  /**
   * Valida se o Money Flow confirma a convicção do sinal
   * @param {object} data - Dados de mercado com indicadores
   * @param {boolean} isLong - Se é sinal de compra
   * @param {object} options - Opções: { isBTCAnalysis, config }
   * @returns {object} - Resultado da validação
   */
  validateMoneyFlowConfirmation(data, isLong, options = {}) {
    const { isBTCAnalysis = false, config = {} } = options;

    // 🔍 DEBUG: Log do valor da configuração
    Logger.debug(
      `🔍 [MF_DEBUG] ${data.market.symbol}: enableMoneyFlowFilter = ${config.enableMoneyFlowFilter} (type: ${typeof config.enableMoneyFlowFilter})`
    );

    // Se Money Flow está desabilitado, pula validação
    // CORREÇÃO: Verifica explicitamente se está desabilitado (false, 0, "false", null, undefined)
    const isMoneyFlowDisabled =
      config.enableMoneyFlowFilter === false ||
      config.enableMoneyFlowFilter === 0 ||
      config.enableMoneyFlowFilter === 'false' ||
      config.enableMoneyFlowFilter === null ||
      config.enableMoneyFlowFilter === undefined;

    Logger.debug(
      `🔍 [MF_DEBUG] ${data.market.symbol}: isMoneyFlowDisabled = ${isMoneyFlowDisabled}`
    );

    if (isMoneyFlowDisabled) {
      Logger.debug(
        `🔍 [MF_DEBUG] ${data.market.symbol}: Money Flow DESABILITADO - pulando validação`
      );
      return {
        isValid: true,
        reason: 'Money Flow Filter desabilitado',
        details: 'Validação pulada pela configuração do bot',
      };
    }

    Logger.debug(
      `🔍 [MF_DEBUG] ${data.market.symbol}: Money Flow HABILITADO - continuando com validação`
    );

    const moneyFlow = data.moneyFlow;

    // Verifica se o Money Flow está disponível
    if (
      !moneyFlow ||
      moneyFlow.mf === null ||
      moneyFlow.mf === undefined ||
      moneyFlow.mfPrev === null ||
      moneyFlow.mfPrev === undefined
    ) {
      if (isBTCAnalysis) {
        console.log(`   ⚠️ BTC: Money Flow não disponível`);
      }
      return {
        isValid: false,
        reason: 'Money Flow não disponível',
        details: 'Indicador Money Flow ou valores anteriores não encontrados nos dados',
      };
    }

    const mf = moneyFlow.mf; // Valor atual
    const mfPrev = moneyFlow.mfPrev; // Valor anterior
    const direction = moneyFlow.direction; // Direção já calculada (UP/DOWN)
    const isStrong = moneyFlow.isStrong;

    let isValid = false;
    let reason = '';
    let details = '';

    if (isLong) {
      // Para sinal LONG: mfValue > 0 E direção UP (dinheiro entrando e aumentando)
      if (mf > 0 && mf > mfPrev) {
        isValid = true;
        reason = 'Money Flow confirma LONG';
        details = `Money Flow positivo (${mf.toFixed(1)}) e crescendo (anterior: ${mfPrev.toFixed(1)}) - Direção: ${direction}`;
      } else {
        isValid = false;
        reason = 'Money Flow não confirma LONG';
        if (mf <= 0) {
          details = `Money Flow negativo (${mf.toFixed(1)}) - Saída de dinheiro`;
        } else {
          details = `Money Flow positivo (${mf.toFixed(1)}) mas decrescendo (anterior: ${mfPrev.toFixed(1)}) - Direção: ${direction}`;
        }
      }
    } else {
      // Para sinal SHORT: mfValue < 0 E direção DOWN (dinheiro saindo e diminuindo)
      if (mf < 0 && mf < mfPrev) {
        isValid = true;
        reason = 'Money Flow confirma SHORT';
        details = `Money Flow negativo (${mf.toFixed(1)}) e decrescendo (anterior: ${mfPrev.toFixed(1)}) - Direção: ${direction}`;
      } else {
        isValid = false;
        reason = 'Money Flow não confirma SHORT';
        if (mf >= 0) {
          details = `Money Flow positivo (${mf.toFixed(1)}) - Entrada de dinheiro`;
        } else {
          details = `Money Flow negativo (${mf.toFixed(1)}) mas crescendo (anterior: ${mfPrev.toFixed(1)}) - Direção: ${direction}`;
        }
      }
    }

    // Log detalhado do Money Flow
    if (isBTCAnalysis) {
      console.log(
        `   💰 BTC Money Flow: Atual=${(mf || 0).toFixed(1)}, Anterior=${(mfPrev || 0).toFixed(1)}, Direction=${direction}, Strong=${isStrong}`
      );
      console.log(`   ${isValid ? '✅' : '❌'} BTC: ${reason} - ${details}`);
    }

    return {
      isValid,
      reason,
      details,
      mf,
      mfPrev,
      direction,
      isStrong,
    };
  }

  /**
   * Valida se há reversão confirmada no Heikin Ashi (3 velas)
   * @param {object} data - Dados de mercado com indicadores
   * @param {object} options - Opções: { isBTCAnalysis, config }
   * @returns {object} - Resultado da validação
   */
  validateHeikinAshiReversal(data, options = {}) {
    const { isBTCAnalysis = false, config = {} } = options;

    const heikinAshi = data.heikinAshi;
    const symbol = data.market?.symbol || data.symbol || 'UNKNOWN';

    // Verifica se o Heikin Ashi está disponível
    if (!heikinAshi || !heikinAshi.trendChange) {
      return {
        hasReversal: false,
        reason: 'Heikin Ashi não disponível nos dados',
        details: 'Indicador Heikin Ashi não encontrado',
      };
    }

    // Extrai dados da reversão
    const hasChanged = heikinAshi.trendChange.hasChanged;
    const changeType = heikinAshi.trendChange.changeType; // 'BULLISH' ou 'BEARISH'
    const confirmedTrend = heikinAshi.trendChange.confirmedTrend; // 'UP', 'DOWN', 'NEUTRAL'

    // Extrai direções das 3 velas
    const currentDirection = heikinAshi.current?.direction || 'NEUTRAL';
    const previousDirection = heikinAshi.previous?.direction || 'NEUTRAL';
    const beforePreviousDirection = heikinAshi.beforePrevious?.direction || 'NEUTRAL';

    // Log do padrão das 3 velas
    const velaPattern = `[${beforePreviousDirection}] → [${previousDirection}] → [${currentDirection}]`;

    // Log para TODOS os símbolos (não só BTC)
    Logger.info(
      `📊 [HEIKIN_ASHI] ${symbol}: Velas: ${velaPattern} | ` +
        `Reversão: ${hasChanged ? changeType : 'NENHUMA'} | Tendência: ${confirmedTrend}`
    );

    // Se NÃO há reversão confirmada, rejeita
    if (!hasChanged) {
      return {
        hasReversal: false,
        reason: `Sem reversão confirmada - Velas: ${velaPattern}`,
        details: `Padrão atual não representa reversão de 3 velas`,
        velaPattern,
        confirmedTrend,
      };
    }

    // Se há reversão, valida que está na direção correta
    // BULLISH: [DOWN] → [UP] → [UP] = Permite LONG
    // BEARISH: [UP] → [DOWN] → [DOWN] = Permite SHORT
    return {
      hasReversal: true,
      direction: changeType === 'BULLISH' ? 'LONG' : 'SHORT',
      reason: `Reversão ${changeType} confirmada - Velas: ${velaPattern}`,
      details: `Padrão de reversão de 3 velas detectado`,
      velaPattern,
      confirmedTrend,
      changeType,
    };
  }

  /**
   * Valida se o sinal está alinhado com a tendência do BTC
   * @param {string} marketSymbol - Símbolo do mercado
   * @param {boolean} isLong - Se é sinal de compra
   * @param {object} config - Configuração do bot
   * @returns {object} - Resultado da validação
   */
  async validateBTCTrend(marketSymbol, isLong, config = null) {
    try {
      // Se for BTC, não precisa validar
      if (marketSymbol === 'BTC_USDC_PERP') {
        return { isValid: true, btcTrend: 'BTC_ITSELF', reason: null };
      }

      // Obtém dados do BTC
      const markets = new Markets();
      const timeframe = config?.time || '5m';
      const btcCandles = await markets.getKLines('BTC_USDC_PERP', timeframe, 30);
      if (!btcCandles || btcCandles.length === 0) {
        return { isValid: true, btcTrend: 'NO_DATA', reason: 'Dados do BTC não disponíveis' };
      }

      // Calcula indicadores do BTC
      const btcIndicators = await calculateIndicators(
        btcCandles,
        config?.time || '5m',
        'BTC_USDC_PERP'
      );

      // Análise de tendência do BTC usando a mesma lógica da estratégia
      const btcSignals = this.analyzeSignals(btcIndicators, { isBTCAnalysis: true, config });

      // Determina tendência do BTC
      let btcTrend = 'NEUTRAL';
      if (btcSignals.isLong) {
        btcTrend = 'BULLISH';
      } else if (btcSignals.isShort) {
        btcTrend = 'BEARISH';
      }

      // Validação mais restritiva: só permite operações alinhadas com a tendência do BTC
      if (isLong && btcTrend === 'BEARISH') {
        return {
          isValid: false,
          btcTrend,
          reason: 'BTC em tendência de baixa - não entrar LONG em altcoins',
        };
      }

      if (!isLong && btcTrend === 'BULLISH') {
        return {
          isValid: false,
          btcTrend,
          reason: 'BTC em tendência de alta - não entrar SHORT em altcoins',
        };
      }

      // Se BTC está neutro, permite ambas as operações
      // Se BTC está bullish, só permite LONG
      // Se BTC está bearish, só permite SHORT
      if (btcTrend === 'BULLISH' && !isLong) {
        return {
          isValid: false,
          btcTrend,
          reason: 'BTC em tendência de alta - só permitir LONG em altcoins',
        };
      }

      if (btcTrend === 'BEARISH' && isLong) {
        return {
          isValid: false,
          btcTrend,
          reason: 'BTC em tendência de baixa - só permitir SHORT em altcoins',
        };
      }

      return { isValid: true, btcTrend, reason: null };
    } catch (error) {
      console.error('DefaultStrategy.validateBTCTrend - Error:', error);
      // Em caso de erro, permite a operação (fail-safe)
      return { isValid: true, btcTrend: 'ERROR', reason: 'Erro na análise do BTC' };
    }
  }
}
