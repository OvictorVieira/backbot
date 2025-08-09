import { BaseStrategy } from './BaseStrategy.js';
import Logger from '../../Utils/Logger.js';

export class ProMaxStrategy extends BaseStrategy {
  
  /**
   * Analisa sinais para compatibilidade com Decision.js
   * @param {object} data - Dados de mercado
   * @param {boolean} isBTCAnalysis - Se é análise do BTC
   * @param {object} config - Configurações específicas da conta (opcional)
   * @returns {object} - Objeto com sinais
   */
  analyzeSignals(data, isBTCAnalysis = false, config = null) {
    try {
      // Para estratégia PRO_MAX, usa análise ADX (prioriza config passado)
      const ADX_LENGTH = config?.adxLength || Number(14);
      const ADX_THRESHOLD = config?.adxThreshold || Number(20);
      const ADX_AVERAGE_LENGTH = config?.adxAverageLength || Number(21);
      
      const adxAnalysis = this.analyzeADX(data, ADX_LENGTH, ADX_THRESHOLD, ADX_AVERAGE_LENGTH);
      
      if (!adxAnalysis.isValid) {
        return {
          hasSignal: false,
          analysisDetails: ['ADX inválido']
        };
      }
      
      // Análise de validação de indicadores (prioriza config passado)
      const validationAnalysis = this.analyzeValidations(data, {
        useRSI: config?.useRsiValidation === 'true',
        useStoch: config?.useStochValidation === 'true',
        useMACD: config?.useMacdValidation === 'true',
        rsiLength: config?.rsiLength || Number(14),
        rsiAverageLength: config?.rsiAverageLength || Number(14),
        rsiBullThreshold: config?.rsiBullThreshold || Number(45),
        rsiBearThreshold: config?.rsiBearThreshold || Number(55),
        stochKLength: config?.stochKLength || Number(14),
        stochDLength: config?.stochDLength || Number(3),
        stochSmooth: config?.stochSmooth || Number(3),
        stochBullThreshold: config?.stochBullThreshold || Number(45),
        stochBearThreshold: config?.stochBearThreshold || Number(55),
        macdFastLength: config?.macdFastLength || Number(12),
        macdSlowLength: config?.macdSlowLength || Number(26),
        macdSignalLength: config?.macdSignalLength || Number(9)
      });
      
      // Calcula confluências
      const bullConfluences = this.calculateBullConfluences(adxAnalysis, validationAnalysis);
      const bearConfluences = this.calculateBearConfluences(adxAnalysis, validationAnalysis);
      
      // Determina nível do sinal
      const bullSignalLevel = this.getSignalLevel(bullConfluences);
      const bearSignalLevel = this.getSignalLevel(bearConfluences);
      
      // Verifica se deve ignorar sinais BRONZE
      const IGNORE_BRONZE = config?.ignoreBronzeSignals === 'true';
      const isValidBullSignal = !IGNORE_BRONZE || bullSignalLevel !== 'BRONZE';
      const isValidBearSignal = !IGNORE_BRONZE || bearSignalLevel !== 'BRONZE';
      
      // Determina ação baseada nas confluências
      let action = null;
      let signalLevel = null;
      let analysisDetails = [];
      
      if (adxAnalysis.bullishCondition && isValidBullSignal && bullConfluences > 0) {
        action = 'long';
        signalLevel = bullSignalLevel;
        analysisDetails.push(`LONG (${signalLevel}) - Confluências: ${bullConfluences}/4`);
        analysisDetails.push(`ADX: ${adxAnalysis.adx.toFixed(2)} < ${ADX_THRESHOLD}`);
        analysisDetails.push(`DI+: ${adxAnalysis.diPlus.toFixed(2)} > DI-: ${adxAnalysis.diMinus.toFixed(2)}`);
        
        // Detalha quais indicadores contribuíram para o sinal
        const validationAnalysis = this.analyzeValidations(data, {
          useRSI: config?.useRsiValidation === 'true',
          useStoch: config?.useStochValidation === 'true',
          useMACD: config?.useMacdValidation === 'true',
          rsiLength: Number(14),
          rsiAverageLength: Number(14),
          rsiBullThreshold: Number(45),
          rsiBearThreshold: Number(55),
          stochKLength: Number(14),
          stochDLength: Number(3),
          stochSmooth: Number(3),
          stochBullThreshold: Number(45),
          stochBearThreshold: Number(55),
          macdFastLength: Number(12),
          macdSlowLength: Number(26),
          macdSignalLength: Number(9)
        });
        
        if (validationAnalysis.rsi.bullish) analysisDetails.push(`✓ RSI: BULLISH`);
        if (validationAnalysis.stoch.bullish) analysisDetails.push(`✓ Stoch: BULLISH`);
        if (validationAnalysis.macd.bullish) analysisDetails.push(`✓ MACD: BULLISH`);
        
      } else if (adxAnalysis.bearishCondition && isValidBearSignal && bearConfluences > 0) {
        action = 'short';
        signalLevel = bearSignalLevel;
        analysisDetails.push(`SHORT (${signalLevel}) - Confluências: ${bearConfluences}/4`);
        analysisDetails.push(`ADX: ${adxAnalysis.adx.toFixed(2)} < ${ADX_THRESHOLD}`);
        analysisDetails.push(`DI-: ${adxAnalysis.diMinus.toFixed(2)} > DI+: ${adxAnalysis.diPlus.toFixed(2)}`);
        
        // Detalha quais indicadores contribuíram para o sinal
        const validationAnalysis = this.analyzeValidations(data, {
          useRSI: config?.useRsiValidation === 'true',
          useStoch: config?.useStochValidation === 'true',
          useMACD: config?.useMacdValidation === 'true',
          rsiLength: Number(14),
          rsiAverageLength: Number(14),
          rsiBullThreshold: Number(45),
          rsiBearThreshold: Number(55),
          stochKLength: Number(14),
          stochDLength: Number(3),
          stochSmooth: Number(3),
          stochBullThreshold: Number(45),
          stochBearThreshold: Number(55),
          macdFastLength: Number(12),
          macdSlowLength: Number(26),
          macdSignalLength: Number(9)
        });
        
        if (validationAnalysis.rsi.bearish) analysisDetails.push(`✓ RSI: BEARISH`);
        if (validationAnalysis.stoch.bearish) analysisDetails.push(`✓ Stoch: BEARISH`);
        if (validationAnalysis.macd.bearish) analysisDetails.push(`✓ MACD: BEARISH`);
      } else {
        analysisDetails.push('Sem sinais válidos');
        if (adxAnalysis.adx >= ADX_THRESHOLD) {
          analysisDetails.push(`ADX alto: ${adxAnalysis.adx.toFixed(2)} >= ${ADX_THRESHOLD}`);
        }
        
        // Detalha cada indicador individualmente
        const validationAnalysis = this.analyzeValidations(data, {
          useRSI: config?.useRsiValidation === 'true',
          useStoch: config?.useStochValidation === 'true',
          useMACD: config?.useMacdValidation === 'true',
          rsiLength: Number(14),
          rsiAverageLength: Number(14),
          rsiBullThreshold: Number(45),
          rsiBearThreshold: Number(55),
          stochKLength: Number(14),
          stochDLength: Number(3),
          stochSmooth: Number(3),
          stochBullThreshold: Number(45),
          stochBearThreshold: Number(55),
          macdFastLength: Number(12),
          macdSlowLength: Number(26),
          macdSignalLength: Number(9)
        });
        
        // Log detalhado dos indicadores
        const useRsiValidation = config?.useRsiValidation === 'true';
        const useStochValidation = config?.useStochValidation === 'true';
        const useMacdValidation = config?.useMacdValidation === 'true';
        
        if (useRsiValidation && data.rsi) {
          const rsi = data.rsi.value;
          const rsiAvg = data.rsi.avg || rsi;
          const rsiPrev = data.rsi.prev || rsi;
          const rsiAvgPrev = data.rsi.avgPrev || rsiAvg;
          const rsiBullThreshold = config?.rsiBullThreshold || Number(45);
          const rsiBearThreshold = config?.rsiBearThreshold || Number(55);
          const rsiBullish = rsi > rsiAvg && rsi < rsiBullThreshold && rsiPrev <= rsiAvgPrev;
          const rsiBearish = rsi < rsiAvg && rsi > rsiBearThreshold && rsiPrev >= rsiAvgPrev;
          analysisDetails.push(`RSI: ${rsi?.toFixed(1) || 'N/A'} (${rsiBullish ? 'BULLISH' : rsiBearish ? 'BEARISH' : 'NEUTRO'})`);
        } else if (data.rsi) {
          // Log RSI mesmo se validação estiver desabilitada
          const rsi = data.rsi.value;
          analysisDetails.push(`RSI: ${rsi?.toFixed(1) || 'N/A'} (validação desabilitada)`);
        } else {
          analysisDetails.push(`RSI: Não disponível`);
        }
        
        if (useStochValidation && data.stoch) {
          const stochK = data.stoch.k;
          const stochD = data.stoch.d;
          const stochKPrev = data.stoch.kPrev || stochK;
          const stochDPrev = data.stoch.dPrev || stochD;
          const stochBullThreshold = config?.stochBullThreshold || Number(45);
          const stochBearThreshold = config?.stochBearThreshold || Number(55);
          const stochBullish = stochK > stochD && stochK < stochBullThreshold && stochKPrev <= stochDPrev;
          const stochBearish = stochK < stochD && stochK > stochBearThreshold && stochKPrev >= stochDPrev;
          analysisDetails.push(`Stoch: K=${stochK?.toFixed(1) || 'N/A'}, D=${stochD?.toFixed(1) || 'N/A'} (${stochBullish ? 'BULLISH' : stochBearish ? 'BEARISH' : 'NEUTRO'})`);
        } else if (data.stoch) {
          // Log Stochastic mesmo se validação estiver desabilitada
          const stochK = data.stoch.k;
          const stochD = data.stoch.d;
          analysisDetails.push(`Stoch: K=${stochK?.toFixed(1) || 'N/A'}, D=${stochD?.toFixed(1) || 'N/A'} (validação desabilitada)`);
        } else {
          analysisDetails.push(`Stoch: Não disponível`);
        }
        
        if (useMacdValidation && data.macd) {
          const histogram = data.macd.histogram;
          const histogramPrev = data.macd.histogramPrev || histogram;
          const macdBullish = histogram < 0 && histogram > histogramPrev;
          const macdBearish = histogram >= 0 && histogram < histogramPrev;
          analysisDetails.push(`MACD: Hist=${histogram?.toFixed(3) || 'N/A'} (${macdBullish ? 'BULLISH' : macdBearish ? 'BEARISH' : 'NEUTRO'})`);
        } else if (data.macd) {
          // Log MACD mesmo se validação estiver desabilitada
          const histogram = data.macd.histogram;
          analysisDetails.push(`MACD: Hist=${histogram?.toFixed(3) || 'N/A'} (validação desabilitada)`);
        } else {
          analysisDetails.push(`MACD: Não disponível`);
        }
        
        if (bullConfluences === 0 && bearConfluences === 0) {
          analysisDetails.push(`Confluências: BULL=${bullConfluences}, BEAR=${bearConfluences}`);
        }
      }
      
      return {
        hasSignal: !!action,
        isLong: action === 'long',
        signalType: action ? `${action.toUpperCase()} (${signalLevel})` : 'NEUTRO',
        analysisDetails: analysisDetails
      };
      
    } catch (error) {
      console.error('ProMaxStrategy.analyzeSignals - Error:', error);
      return {
        hasSignal: false,
        analysisDetails: [`Erro: ${error.message}`]
      };
    }
  }
      /**
     * Implementação da estratégia PRO_MAX baseada no script PineScript ADX
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @param {object} config - Configurações específicas da conta (opcional)
   * @returns {object|null} - Objeto com decisão de trading ou null se não houver sinal
   */
  analyzeTrade(fee, data, investmentUSD, media_rsi, config = null) {
    try {
      // Validação inicial dos dados
      if (!this.validateData(data)) {
        return null;
      }

      // Configurações da estratégia PRO_MAX (prioriza config passado, depois variáveis de ambiente)
      const IGNORE_BRONZE = config?.ignoreBronzeSignals === 'true';
      const ADX_LENGTH = config?.adxLength || Number(14);
      const ADX_THRESHOLD = config?.adxThreshold || Number(20);
      const ADX_AVERAGE_LENGTH = config?.adxAverageLength || Number(21);
      
      // Configurações de validação (prioriza config passado)
      const USE_RSI = config?.useRsiValidation === 'true';
      const USE_STOCH = config?.useStochValidation === 'true';
      const USE_MACD = config?.useMacdValidation === 'true';
      
      // Configurações RSI (prioriza config passado)
      const RSI_LENGTH = config?.rsiLength || Number(14);
      const RSI_AVERAGE_LENGTH = config?.rsiAverageLength || Number(14);
      const RSI_BULL_THRESHOLD = config?.rsiBullThreshold || Number(45);
      const RSI_BEAR_THRESHOLD = config?.rsiBearThreshold || Number(55);
      
      // Configurações Stochastic (prioriza config passado)
      const STOCH_K_LENGTH = config?.stochKLength || Number(14);
      const STOCH_D_LENGTH = config?.stochDLength || Number(3);
      const STOCH_SMOOTH = config?.stochSmooth || Number(3);
      const STOCH_BULL_THRESHOLD = config?.stochBullThreshold || Number(45);
      const STOCH_BEAR_THRESHOLD = config?.stochBearThreshold || Number(55);
      
      // Configurações MACD (prioriza config passado)
      const MACD_FAST_LENGTH = config?.macdFastLength || Number(12);
      const MACD_SLOW_LENGTH = config?.macdSlowLength || Number(26);
      const MACD_SIGNAL_LENGTH = config?.macdSignalLength || Number(9);

      // Análise ADX
      const adxAnalysis = this.analyzeADX(data, ADX_LENGTH, ADX_THRESHOLD, ADX_AVERAGE_LENGTH);
      if (!adxAnalysis.isValid) {
        return null;
      }

      // Análise de validação de indicadores
      const validationAnalysis = this.analyzeValidations(data, {
        useRSI: USE_RSI,
        useStoch: USE_STOCH,
        useMACD: USE_MACD,
        rsiLength: RSI_LENGTH,
        rsiAverageLength: RSI_AVERAGE_LENGTH,
        rsiBullThreshold: RSI_BULL_THRESHOLD,
        rsiBearThreshold: RSI_BEAR_THRESHOLD,
        stochKLength: STOCH_K_LENGTH,
        stochDLength: STOCH_D_LENGTH,
        stochSmooth: STOCH_SMOOTH,
        stochBullThreshold: STOCH_BULL_THRESHOLD,
        stochBearThreshold: STOCH_BEAR_THRESHOLD,
        macdFastLength: MACD_FAST_LENGTH,
        macdSlowLength: MACD_SLOW_LENGTH,
        macdSignalLength: MACD_SIGNAL_LENGTH
      });

      // Calcula confluências
      const bullConfluences = this.calculateBullConfluences(adxAnalysis, validationAnalysis);
      const bearConfluences = this.calculateBearConfluences(adxAnalysis, validationAnalysis);

      // Determina nível do sinal
      const bullSignalLevel = this.getSignalLevel(bullConfluences);
      const bearSignalLevel = this.getSignalLevel(bearConfluences);

      // Verifica se deve ignorar sinais BRONZE
      const isValidBullSignal = !IGNORE_BRONZE || bullSignalLevel !== 'BRONZE';
      const isValidBearSignal = !IGNORE_BRONZE || bearSignalLevel !== 'BRONZE';

      // Log de sinais ignorados (BRONZE)
      if (IGNORE_BRONZE && adxAnalysis.bullishCondition && bullConfluences === 1) {
        Logger.debug(`⚠️ [PRO_MAX] ${data.market.symbol} (BRONZE): Sinal LONG ignorado - IGNORE_BRONZE_SIGNALS=true`);
      }
      if (IGNORE_BRONZE && adxAnalysis.bearishCondition && bearConfluences === 1) {
        Logger.debug(`⚠️ [PRO_MAX] ${data.market.symbol} (BRONZE): Sinal SHORT ignorado - IGNORE_BRONZE_SIGNALS=true`);
      }

      // Determina ação baseada nas confluências
      let action = null;
      let signalLevel = null;

      if (adxAnalysis.bullishCondition && isValidBullSignal && bullConfluences > 0) {
        action = 'long';
        signalLevel = bullSignalLevel;
      } else if (adxAnalysis.bearishCondition && isValidBearSignal && bearConfluences > 0) {
        action = 'short';
        signalLevel = bearSignalLevel;
      }

      if (!action) {
        return null;
      }

      const price = parseFloat(data.marketPrice);
      
      // Calcula stop e múltiplos targets usando ATR (como no PineScript)
      const stopAndTargets = this.calculateStopAndMultipleTargets(data, price, action, config);
      if (!stopAndTargets) {
        return null;
      }

      const { stop, targets } = stopAndTargets;
      const entry = price;



      // Calcula PnL usando o primeiro target para validação
      const firstTarget = targets.length > 0 ? targets[0] : entry;
      const { pnl, risk } = this.calculatePnLAndRisk(action, entry, stop, firstTarget, investmentUSD, fee);

      // Log apenas quando há operação para ser aberta
      Logger.info(`✅ [PRO_MAX] ${data.market.symbol} (${signalLevel}): ${action.toUpperCase()} - Confluências: ${action === 'long' ? bullConfluences : bearConfluences}/4 - Targets: ${targets.length} - PnL $${pnl.toFixed(2)}`);

      return {
        market: data.market.symbol,
        entry: Number(entry.toFixed(data.market.decimal_price)),
        stop: Number(stop.toFixed(data.market.decimal_price)),
        target: Number(firstTarget.toFixed(data.market.decimal_price)), // Primeiro target para compatibilidade
        targets: targets.map(t => Number(t.toFixed(data.market.decimal_price))), // Todos os targets
        action,
        pnl,
        risk,
        signalLevel,
        confluences: action === 'long' ? bullConfluences : bearConfluences
      };

    } catch (error) {
      Logger.error('ProMaxStrategy.analyzeTrade - Error:', error.message);
      return null;
    }
  }

  /**
   * Analisa ADX e determina condições de entrada
   * @param {object} data - Dados de mercado
   * @param {number} length - Período ADX
   * @param {number} threshold - Limite ADX
   * @param {number} avgLength - Período da média ADX
   * @returns {object} - Análise ADX
   */
  analyzeADX(data, length, threshold, avgLength) {
    try {
      const adx = data.adx?.adx || 0;
      const diPlus = data.adx?.diPlus || 0;
      const diMinus = data.adx?.diMinus || 0;
      const adxAvg = data.adx?.adxEma || 0;

      // Condição de confirmação de volume (ADX < threshold)
      const confirmationVolume = adx < threshold;

      // Condições de reversão
      const bullishCondition = diPlus > diMinus && confirmationVolume && 
                              (data.adx?.diPlusPrev || 0) <= (data.adx?.diMinusPrev || 0);
      
      const bearishCondition = diMinus > diPlus && confirmationVolume && 
                              (data.adx?.diMinusPrev || 0) <= (data.adx?.diPlusPrev || 0);

      return {
        isValid: true,
        adx,
        diPlus,
        diMinus,
        adxAvg,
        confirmationVolume,
        bullishCondition,
        bearishCondition
      };
    } catch (error) {
      Logger.error('ProMaxStrategy.analyzeADX - Error:', error.message);
      return { isValid: false };
    }
  }

  /**
   * Verifica se deve fechar posição baseada no cruzamento do ADX
   * Similar à lógica do PineScript: diCrossover e diCrossunder
   * @param {object} position - Dados da posição
   * @param {object} data - Dados de mercado com indicadores ADX
   * @returns {object|null} - Objeto com decisão de fechamento ou null se não deve fechar
   */
  shouldClosePositionByADX(position, data) {
    try {
      // Validação inicial dos dados
      if (!position || !data || !data.adx) {
        return null;
      }

      const diPlus = data.adx?.diPlus || 0;
      const diMinus = data.adx?.diMinus || 0;
      const diPlusPrev = data.adx?.diPlusPrev || 0;
      const diMinusPrev = data.adx?.diMinusPrev || 0;
      const isLong = parseFloat(position.netQuantity) > 0;

      // Verifica cruzamento do ADX (apenas com candle fechado)
      let shouldClose = false;
      let reason = '';

      if (isLong) {
        // Para posição LONG: se DI+ < DI- (cruzamento para baixo), fechar
        const diCrossover = diPlus < diMinus && diPlusPrev >= diMinusPrev;
        if (diCrossover) {
          shouldClose = true;
          reason = `ADX CROSSOVER: DI+ (${diPlus.toFixed(2)}) < DI- (${diMinus.toFixed(2)}) - Fechando posição LONG`;
        }
      } else {
        // Para posição SHORT: se DI- < DI+ (cruzamento para cima), fechar
        const diCrossunder = diMinus < diPlus && diMinusPrev >= diPlusPrev;
        if (diCrossunder) {
          shouldClose = true;
          reason = `ADX CROSSUNDER: DI- (${diMinus.toFixed(2)}) < DI+ (${diPlus.toFixed(2)}) - Fechando posição SHORT`;
        }
      }

      if (shouldClose) {
        return {
          shouldClose: true,
          reason: reason,
          type: 'ADX_CROSSOVER',
          diPlus,
          diMinus,
          diPlusPrev,
          diMinusPrev,
          positionType: isLong ? 'LONG' : 'SHORT'
        };
      }

      return null;

    } catch (error) {
      console.error('ProMaxStrategy.shouldClosePositionByADX - Error:', error);
      return null;
    }
  }

  /**
   * Analisa validações de indicadores (RSI, Stochastic, MACD)
   * @param {object} data - Dados de mercado
   * @param {object} config - Configurações dos indicadores
   * @returns {object} - Análise de validações
   */
  analyzeValidations(data, config) {
    try {
      const result = {
        rsi: { bullish: false, bearish: false },
        stoch: { bullish: false, bearish: false },
        macd: { bullish: false, bearish: false }
      };

      // Validação RSI
      if (config.useRSI && data.rsi) {
        const rsi = data.rsi.value;
        const rsiAvg = data.rsi.avg || rsi;
        const rsiPrev = data.rsi.prev || rsi;
        const rsiAvgPrev = data.rsi.avgPrev || rsiAvg;

        result.rsi.bullish = rsi > rsiAvg && rsi < config.rsiBullThreshold && rsiPrev <= rsiAvgPrev;
        result.rsi.bearish = rsi < rsiAvg && rsi > config.rsiBearThreshold && rsiPrev >= rsiAvgPrev;
      }

      // Validação Stochastic
      if (config.useStoch && data.stoch) {
        const stochK = data.stoch.k;
        const stochD = data.stoch.d;
        const stochKPrev = data.stoch.kPrev || stochK;
        const stochDPrev = data.stoch.dPrev || stochD;

        result.stoch.bullish = stochK > stochD && stochK < config.stochBullThreshold && stochKPrev <= stochDPrev;
        result.stoch.bearish = stochK < stochD && stochK > config.stochBearThreshold && stochKPrev >= stochDPrev;
      }

      // Validação MACD
      if (config.useMACD && data.macd) {
        const histogram = data.macd.histogram;
        const histogramPrev = data.macd.histogramPrev || histogram;

        result.macd.bullish = histogram < 0 && histogram > histogramPrev;
        result.macd.bearish = histogram >= 0 && histogram < histogramPrev;
      }

      return result;
    } catch (error) {
      console.error('ProMaxStrategy.analyzeValidations - Error:', error);
      return { rsi: { bullish: false, bearish: false }, stoch: { bullish: false, bearish: false }, macd: { bullish: false, bearish: false } };
    }
  }

  /**
   * Calcula confluências para sinais de alta
   * @param {object} adxAnalysis - Análise ADX
   * @param {object} validationAnalysis - Análise de validações
   * @returns {number} - Número de confluências
   */
  calculateBullConfluences(adxAnalysis, validationAnalysis) {
    let confluences = 0;

    // ADX é sempre contado se houver condição bullish
    if (adxAnalysis.bullishCondition) {
      confluences += 1;
    }

    // Adiciona confluências dos indicadores de validação
    if (validationAnalysis.rsi.bullish) {
      confluences += 1;
    }

    if (validationAnalysis.stoch.bullish) {
      confluences += 1;
    }

    if (validationAnalysis.macd.bullish) {
      confluences += 1;
    }

    return confluences;
  }

  /**
   * Calcula confluências para sinais de baixa
   * @param {object} adxAnalysis - Análise ADX
   * @param {object} validationAnalysis - Análise de validações
   * @returns {number} - Número de confluências
   */
  calculateBearConfluences(adxAnalysis, validationAnalysis) {
    let confluences = 0;

    // ADX é sempre contado se houver condição bearish
    if (adxAnalysis.bearishCondition) {
      confluences += 1;
    }

    // Adiciona confluências dos indicadores de validação
    if (validationAnalysis.rsi.bearish) {
      confluences += 1;
    }

    if (validationAnalysis.stoch.bearish) {
      confluences += 1;
    }

    if (validationAnalysis.macd.bearish) {
      confluences += 1;
    }

    return confluences;
  }

  /**
   * Determina o nível do sinal baseado no número de confluências
   * @param {number} confluences - Número de confluências
   * @returns {string} - Nível do sinal (BRONZE, SILVER, GOLD, DIAMOND)
   */
  getSignalLevel(confluences) {
    if (confluences === 1) return '🥉 BRONZE';
    if (confluences === 2) return '🥈 SILVER';
    if (confluences === 3) return '🥇 GOLD';
    if (confluences === 4) return '💎 DIAMOND';
    return '❓ UNKNOWN';
  }

  /**
   * Calcula stop e múltiplos targets usando ATR (como no PineScript)
   * @param {object} data - Dados de mercado
   * @param {number} price - Preço atual
   * @param {string} action - Ação (long/short)
   * @param {object} config - Configurações (opcional)
   * @returns {object|null} - Stop e array de targets
   */
  calculateStopAndMultipleTargets(data, price, action, config = null) {
    try {
      // Configurações das zonas de objetivo - Configuráveis via .env
      const ATR_ZONE_MULTIPLIER = Number(config?.atrZoneMultiplier || 1.5);
      const SL_ATR_MULTIPLIER = Number(config?.slAtrMultiplier || 6.5);
      
      // Usa configuração passada ou do .env
      const MAX_TARGETS_PER_ORDER = config?.maxTargetsPerOrder || Number(20);
      
      const adjustedATRMultiplier = ATR_ZONE_MULTIPLIER;
      
      // Usa ATR dos dados ou calcula
      const atr = data.atr?.atr || 0;
      if (!atr || atr <= 0) {
        Logger.debug(`⚠️ ATR não disponível para ${data.market.symbol}`);
        return null;
      }

      // Calcula distância baseada no ATR
      const distance = atr * adjustedATRMultiplier;
      
      let stop;
      const targets = [];
      
      if (action === 'long') {
        // Stop Loss para LONG - mais distante para evitar execução imediata
        stop = price - (atr * SL_ATR_MULTIPLIER);
        
        // Garante distância mínima de 2% do preço atual
        const minDistance = price * 0.02;
        const calculatedDistance = price - stop;
        if (calculatedDistance < minDistance) {
          stop = price - minDistance;
          Logger.debug(`⚠️ [PRO_MAX] ${data.market.symbol}: Stop loss ajustado para distância mínima de 2% (${minDistance.toFixed(6)})`);
        }
        
        // Múltiplos targets para LONG (como no PineScript)
        for (let i = 0; i < MAX_TARGETS_PER_ORDER; i++) {
          const targetLevel = price + distance * (i + 1);
          
          if (targetLevel > 0) {
            targets.push(targetLevel);
          }
        }
      } else {
        // Stop Loss para SHORT - mais distante para evitar execução imediata
        stop = price + (atr * SL_ATR_MULTIPLIER);
        
        // Garante distância mínima de 2% do preço atual
        const minDistance = price * 0.02;
        const calculatedDistance = stop - price;
        if (calculatedDistance < minDistance) {
          stop = price + minDistance;
          Logger.debug(`⚠️ [PRO_MAX] ${data.market.symbol}: Stop loss ajustado para distância mínima de 2% (${minDistance.toFixed(6)})`);
        }
        
        // Múltiplos targets para SHORT (como no PineScript)
        for (let i = 0; i < MAX_TARGETS_PER_ORDER; i++) {
          const targetLevel = price - distance * (i + 1);
          
          if (targetLevel > 0) {
            targets.push(targetLevel);
          }
        }
      }

      // Validações de segurança
      if (stop <= 0 || targets.length === 0) {
        Logger.debug(`⚠️ Stop ou targets inválidos para ${data.market.symbol}`);
        return null;
      }

      Logger.info(`🎯 ${data.market.symbol}: ${action.toUpperCase()} - Stop: ${stop.toFixed(6)} - Targets: ${targets.length} (${targets.slice(0, 3).map(t => t.toFixed(6)).join(', ')}${targets.length > 3 ? '...' : ''})`);

      return { stop, targets };

    } catch (error) {
      Logger.error('ProMaxStrategy.calculateStopAndMultipleTargets - Error:', error.message);
      return null;
    }
  }
} 