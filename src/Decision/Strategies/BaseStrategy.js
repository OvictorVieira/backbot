import { validateLeverageForSymbol } from '../../Utils/Utils.js';
import AccountController from '../../Controllers/AccountController.js';

export class BaseStrategy {
  /**
   * Analisa dados de mercado e retorna decisão de trading
   * @param {number} fee - Taxa da exchange
   * @param {object} data - Dados de mercado com indicadores
   * @param {number} investmentUSD - Valor a investir
   * @param {number} media_rsi - Média do RSI de todos os mercados
   * @returns {object|null} - Objeto com decisão de trading ou null se não houver sinal
   */
  analyzeTrade(fee, data, investmentUSD, media_rsi) {
    throw new Error('analyzeTrade must be implemented by subclass');
  }

  /**
   * Valida se os dados necessários estão disponíveis
   * @param {object} data - Dados de mercado
   * @returns {boolean} - True se dados são válidos
   */
  validateData(data) {
    // Verifica se data existe
    if (!data) {
      return false;
    }
    
    // Verifica se vwap existe
    if (!data.vwap) {
      return false;
    }
    
    // Verifica estrutura do VWAP (pode ser direto ou com current/previous)
    const vwapData = data.vwap.current || data.vwap;
    
    if (!vwapData) {
      return false;
    }
    
    // Verifica se tem os campos necessários
    const hasVwap = vwapData.vwap != null;
    const hasLowerBands = vwapData.lowerBands && vwapData.lowerBands.length > 0;
    const hasUpperBands = vwapData.upperBands && vwapData.upperBands.length > 0;
    
    return hasVwap && hasLowerBands && hasUpperBands;
  }

  /**
   * Valida se o take profit atende aos critérios mínimos
   * @param {string} action - 'long' ou 'short'
   * @param {number} entry - Preço de entrada
   * @param {number} stop - Preço de stop
   * @param {number} target - Preço alvo
   * @param {number} investmentUSD - Valor investido
   * @param {number} fee - Taxa da exchange
   * @returns {object} - Objeto com validação e métricas
   */
  validateTakeProfit(action, entry, stop, target, investmentUSD, fee) {
    // Configurações do take profit mínimo (apenas porcentagem e R/R)
    const MIN_TAKE_PROFIT_PCT = Number(this.config?.minTakeProfitPct || 0.5);

    const { pnl, risk } = this.calculatePnLAndRisk(action, entry, stop, target, investmentUSD, fee);
    
    // Calcula métricas
    const riskRewardRatio = pnl / risk;
    const takeProfitPct = ((action === 'long') ? target - entry : entry - target) / entry * 100;
    
    // Validações (apenas porcentagem e R/R)
    const isValidPct = takeProfitPct >= MIN_TAKE_PROFIT_PCT;
    
    const isValid = isValidPct;
    
    return {
      isValid,
      pnl,
      risk,
      riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
      takeProfitPct: Number(takeProfitPct.toFixed(2)),
      reasons: {
        pct: isValidPct ? null : `TP ${takeProfitPct.toFixed(2)}% < mínimo ${MIN_TAKE_PROFIT_PCT.toFixed(1)}%`
      }
    };
  }

  /**
   * Calcula PnL e risco de uma operação
   * @param {string} action - 'long' ou 'short'
   * @param {number} entry - Preço de entrada
   * @param {number} stop - Preço de stop
   * @param {number} target - Preço alvo
   * @param {number} investmentUSD - Valor investido
   * @param {number} fee - Taxa da exchange
   * @returns {object} - Objeto com pnl e risk
   */
  calculatePnLAndRisk(action, entry, stop, target, investmentUSD, fee) {
    const units = investmentUSD / entry;
    
    const grossLoss = ((action === 'long') ? entry - stop : stop - entry) * units;
    const grossTarget = ((action === 'long') ? target - entry : entry - target) * units;
    
    const entryFee = investmentUSD * fee;
    const exitFeeTarget = grossTarget * fee;
    const exitFeeLoss = grossLoss * fee;
    
    const pnl = grossTarget - (entryFee + exitFeeTarget);
    const risk = grossLoss + (entryFee + exitFeeLoss);
    
    return { pnl: Number(pnl), risk: Number(risk) };
  }

  /**
   * Calcula preços de stop e target baseados em configurações do .env
   * @param {object} data - Dados de mercado
   * @param {number} price - Preço atual
   * @param {boolean} isLong - Se é posição long
   * @param {number} stopLossPct - Percentual de stop loss (do .env)
   * @param {number} takeProfitPct - Percentual de take profit (do .env)
   * @returns {Promise<object|null>} - Objeto com stop e target ou null se inválido
   */
  async calculateStopAndTarget(data, price, isLong, stopLossPct, takeProfitPct, config = null) {
    // Validação dos parâmetros
    if (!stopLossPct || !takeProfitPct) {
      console.error('❌ [BASE_STRATEGY] Parâmetros de stop/target inválidos:', { stopLossPct, takeProfitPct });
      return null;
    }

    // CORREÇÃO CRÍTICA: Obtém a alavancagem da conta para calcular o stop loss correto
    let leverage = 1; // Default
    try {
      // SEMPRE usa credenciais do config - lança exceção se não disponível
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
      }
      
      const Account = await AccountController.get({ 
        apiKey: config.apiKey, 
        apiSecret: config.apiSecret,
        strategy: config?.strategyName || 'DEFAULT' 
      });
      if (Account && Account.leverage) {
        const rawLeverage = Account.leverage;
        leverage = validateLeverageForSymbol(data.market.symbol, rawLeverage);
        console.log(`🔧 [BASE_STRATEGY] ${data.market.symbol}: Alavancagem ${rawLeverage}x -> ${leverage}x (validada)`);
      }
    } catch (error) {
      console.warn(`⚠️ [BASE_STRATEGY] ${data.market.symbol}: Erro ao obter alavancagem, usando 1x: ${error.message}`);
    }

    // CORREÇÃO CRÍTICA: Calcula o stop loss real considerando a alavancagem
    const baseStopLossPct = Math.abs(stopLossPct);
    const actualStopLossPct = baseStopLossPct / leverage;
    
    console.log(`🔧 [BASE_STRATEGY] ${data.market.symbol}: Stop Loss - Bruto: ${baseStopLossPct}%, Real: ${actualStopLossPct.toFixed(2)}% (leverage ${leverage}x)`);

    // Converte percentuais para decimais (usando o valor corrigido pela alavancagem)
    const stopLossDecimal = actualStopLossPct / 100;
    const takeProfitDecimal = Math.abs(takeProfitPct) / 100;

    let stop, target;

    if (isLong) {
      // Stop: abaixo do preço atual
      stop = price * (1 - stopLossDecimal);
      
      // Target: acima do preço atual
      target = price * (1 + takeProfitDecimal);
    } else {
      // Stop: acima do preço atual
      stop = price * (1 + stopLossDecimal);
      
      // Target: abaixo do preço atual
      target = price * (1 - takeProfitDecimal);
    }

    // Valida se os valores fazem sentido
    if (isLong && (stop >= price || target <= price)) {
      console.error('❌ [BASE_STRATEGY] Valores inválidos para LONG:', { price, stop, target });
      return null;
    }
    if (!isLong && (stop <= price || target >= price)) {
      console.error('❌ [BASE_STRATEGY] Valores inválidos para SHORT:', { price, stop, target });
      return null;
    }

    return { stop, target };
  }
} 