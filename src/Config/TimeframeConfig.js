/**
 * Configuração de Timeframes para o BackBot
 * Gerencia validação de momentos de análise baseado no EXECUTION_MODE
 */

export class TimeframeConfig {
  constructor() {
    this.timeframe = process.env.ACCOUNT1_TIME || process.env.TIME || '5m';
    this.executionMode = process.env.EXECUTION_MODE || 'REALTIME';
  }

  /**
   * Converte timeframe para milissegundos
   * @param {string} timeframe - Timeframe (ex: '5m', '1h', '1d')
   * @returns {number} - Milissegundos
   */
  static parseTimeframeToMs(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 5 * 60 * 1000; // padrão 5m
    }
  }

  /**
   * Calcula tempo até próximo fechamento de vela
   * @returns {number} - Milissegundos até próximo fechamento
   */
  getTimeUntilNextCandleClose() {
    const timeframeMs = TimeframeConfig.parseTimeframeToMs(this.timeframe);
    const now = Date.now();
    const nextCandleClose = Math.ceil(now / timeframeMs) * timeframeMs;
    const timeUntilClose = nextCandleClose - now;
    
    return timeUntilClose;
  }

  /**
   * Verifica se estamos no momento correto para análise
   * @returns {boolean} - True se deve analisar agora
   */
  shouldAnalyzeNow() {
    // Verifica o EXECUTION_MODE atual em tempo real (pode ter sido alterado)
    const currentExecutionMode = process.env.EXECUTION_MODE || 'REALTIME';
    
    if (currentExecutionMode !== 'ON_CANDLE_CLOSE') {
      return true; // Modo REALTIME sempre analisa
    }

    const timeframeMs = TimeframeConfig.parseTimeframeToMs(this.timeframe);
    const now = Date.now();
    const currentCandleStart = Math.floor(now / timeframeMs) * timeframeMs;
    const currentCandleEnd = currentCandleStart + timeframeMs;
    const timeUntilCandleEnd = currentCandleEnd - now;
    
    // Se faltam menos de 10 segundos para o fechamento, considera que estamos no momento correto
    return timeUntilCandleEnd <= 10000; // 10 segundos
  }

  /**
   * Obtém o próximo momento de análise
   * @returns {Date} - Data do próximo momento de análise
   */
  getNextAnalysisTime() {
    const timeframeMs = TimeframeConfig.parseTimeframeToMs(this.timeframe);
    const now = Date.now();
    const nextCandleClose = Math.ceil(now / timeframeMs) * timeframeMs;
    
    return new Date(nextCandleClose);
  }

  /**
   * Verifica se o bot deve aguardar antes de iniciar análise
   * @returns {object} - { shouldWait: boolean, waitTime: number, reason: string }
   */
  shouldWaitBeforeAnalysis() {
    // Verifica o EXECUTION_MODE atual em tempo real (pode ter sido alterado)
    const currentExecutionMode = process.env.EXECUTION_MODE || 'REALTIME';
    
    if (currentExecutionMode !== 'ON_CANDLE_CLOSE') {
      return { shouldWait: false, waitTime: 0, reason: 'REALTIME mode' };
    }

    const timeUntilNextCandle = this.getTimeUntilNextCandleClose();
    const timeUntilNextCandleSeconds = Math.floor(timeUntilNextCandle / 1000);
    
    // Calcula horários para exibição
    const now = Date.now();
    const timeframeMs = TimeframeConfig.parseTimeframeToMs(this.timeframe);
    const nextCandleClose = Math.ceil(now / timeframeMs) * timeframeMs;
    const nowDate = new Date(now);
    const nextCandleDate = new Date(nextCandleClose);
    
    if (this.shouldAnalyzeNow()) {
      return { shouldWait: false, waitTime: 0, reason: 'Correct timing' };
    } else {
      console.log(`⏰ [TIMEFRAME] ${this.timeframe} - Próximo fechamento: ${nextCandleDate.toLocaleTimeString('pt-BR', { hour12: false })}`);
      console.log(`   • Agora: ${nowDate.toLocaleTimeString('pt-BR', { hour12: false })}`);
      console.log(`   • Aguardando: ${timeUntilNextCandleSeconds}s`);
      
      return { 
        shouldWait: true, 
        waitTime: timeUntilNextCandle, 
        reason: `Waiting ${timeUntilNextCandleSeconds}s for next candle close` 
      };
    }
  }

  /**
   * Obtém informações do timeframe atual
   * @returns {object} - Informações do timeframe
   */
  getTimeframeInfo() {
    const timeframeMs = TimeframeConfig.parseTimeframeToMs(this.timeframe);
    const now = Date.now();
    const currentCandleStart = Math.floor(now / timeframeMs) * timeframeMs;
    const currentCandleEnd = currentCandleStart + timeframeMs;
    const timeUntilCandleEnd = currentCandleEnd - now;
    
    return {
      timeframe: this.timeframe,
      executionMode: this.executionMode,
      currentCandleStart: new Date(currentCandleStart),
      currentCandleEnd: new Date(currentCandleEnd),
      timeUntilCandleEnd,
      shouldAnalyzeNow: this.shouldAnalyzeNow()
    };
  }
}

export default TimeframeConfig; 