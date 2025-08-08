import axios from 'axios';
import ColorLogger from '../Utils/ColorLogger.js';

export class DataProvider {
  constructor() {
    this.logger = new ColorLogger('BACKTEST', 'DATA');
    this.backpackUrl = 'https://api.backpack.exchange';
    this.binanceUrl = 'https://api.binance.com';
    this.maxCandlesPerRequest = 1000; // Limite da API
  }

  /**
   * REFATORADO: Obtém dados históricos com suporte a modo High-Fidelity
   * @param {Array} symbols - Lista de símbolos
   * @param {string} interval - Timeframe da estratégia (AMBIENT)
   * @param {number} days - Período em dias
   * @param {string} simulationMode - Modo de simulação (AUTO, HIGH_FIDELITY, STANDARD)
   * @param {Date} startTime - Data de início (opcional)
   * @param {Date} endTime - Data de fim (opcional)
   * @returns {object} - Dados históricos por símbolo (formato varia conforme modo)
   */
  async getHistoricalData(symbols, interval = '1h', days = 30, startTime = null, endTime = null, simulationMode = 'STANDARD') {
    try {
      this.logger.info(`📊 Obtendo dados históricos para ${symbols.length} símbolos`);
      this.logger.info(`⏰ Timeframe: ${interval} | Período: ${days} dias | Modo: ${simulationMode}`);
      
      // Determina o timeframe de dados baseado no modo de simulação
      const dataTimeframe = this.determineDataTimeframe(interval, simulationMode);
      this.logger.info(`🔍 Timeframe de dados: ${dataTimeframe}`);
      
      const historicalData = {};
      const promises = symbols.map(symbol => 
        this.getSymbolDataExtended(symbol, dataTimeframe, days, startTime, endTime)
      );
      
      const results = await Promise.allSettled(promises);
      
      let successCount = 0;
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const result = results[i];
        
        if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
          historicalData[symbol] = result.value;
          successCount++;
          this.logger.info(`✅ ${symbol}: ${result.value.length} candles obtidos`);
        } else {
          this.logger.error(`❌ ${symbol}: Erro ao obter dados`);
        }
      }
      
      this.logger.info(`📈 Dados obtidos com sucesso para ${successCount}/${symbols.length} símbolos`);
      
      // REFATORADO: Lógica para modo HIGH_FIDELITY
      if (dataTimeframe === '1m' && interval !== '1m') {
        this.logger.info(`🔬 Modo HIGH_FIDELITY: Preparando dados duplos (1m + ${interval})...`);
        
        // Agrupa dados de 1m para timeframe AMBIENT
        const ambientData = this.groupDataForAmbientTimeframe(historicalData, interval);
        
        // Retorna objeto com ambos os conjuntos de dados
        const highFidelityData = {};
        
        for (const symbol of symbols) {
          if (historicalData[symbol] && ambientData[symbol]) {
            highFidelityData[symbol] = {
              oneMinuteCandles: historicalData[symbol], // Dados brutos de 1m
              ambientCandles: ambientData[symbol]       // Dados agregados do timeframe AMBIENT
            };
            
            this.logger.info(`🔬 ${symbol}: ${historicalData[symbol].length} candles 1m + ${ambientData[symbol].length} candles ${interval}`);
          }
        }
        
        this.logger.info(`✅ Modo HIGH_FIDELITY: Dados duplos preparados para ${Object.keys(highFidelityData).length} símbolos`);
        return highFidelityData;
      }
      
      // Modo STANDARD: retorna dados no formato original
      this.logger.info(`✅ Modo STANDARD: Dados no timeframe ${interval} retornados`);
      return historicalData;
      
    } catch (error) {
      this.logger.error(`❌ Erro ao obter dados históricos: ${error.message}`);
      throw error;
    }
  }

  /**
   * CORRIGIDO: Obtém dados estendidos para um símbolo com paginação eficiente
   * @param {string} symbol - Símbolo do mercado
   * @param {string} interval - Intervalo dos candles
   * @param {number} days - Período em dias
   * @param {Date} startTime - Data de início (opcional)
   * @param {Date} endTime - Data de fim (opcional)
   * @returns {Array} - Array de candles
   */
  async getSymbolDataExtended(symbol, interval, days, startTime = null, endTime = null) {
    try {
      const end = endTime ? endTime.getTime() : Date.now();
      const start = startTime ? startTime.getTime() : end - (days * 24 * 60 * 60 * 1000);
      const intervalMs = this.getIntervalMs(interval);
      const candlesPerDay = this.getCandlesPerDay(interval);
      const totalCandles = days * candlesPerDay;
      this.logger.info(`📈 ${symbol}: Buscando ${totalCandles} candles (${days} dias) - ${new Date(start).toISOString()} até ${new Date(end).toISOString()}`);
      // Tenta Backpack primeiro
      let allCandles = [];
      try {
        allCandles = await this.getBackpackSymbolData(symbol, interval, totalCandles, start, end);
        if (allCandles && allCandles.length > 0) {
          this.logger.info(`✅ ${symbol}: ${allCandles.length} candles obtidos da Backpack.`);
          return allCandles;
        } else {
          this.logger.warn(`⚠️ ${symbol}: Backpack não retornou dados, tentando Binance...`);
        }
      } catch (e) {
        this.logger.warn(`⚠️ ${symbol}: Erro na Backpack: ${e.message}. Tentando Binance...`);
      }
      // Busca dados reais da Binance (sem fallback sintético)
      allCandles = await this.getBinanceSymbolData(this.convertSymbolToBinance(symbol), interval, totalCandles, start, end);
      if (!allCandles || allCandles.length === 0) {
        throw new Error(`❌ ${symbol}: Não foi possível obter dados reais da Binance para o período solicitado.`);
      }
      return allCandles;
    } catch (error) {
      this.logger.error(`❌ Erro ao obter dados para ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtém dados históricos da Backpack para um símbolo específico
   */
  async getBackpackSymbolData(symbol, interval, days, startTime = null, endTime = null) {
    try {
      const end = endTime || Date.now();
      const start = startTime || (end - (days * 24 * 60 * 60 * 1000));
      
      const allCandles = [];
      let currentStart = start;
      
      this.logger.info(`🔄 [BACKPACK] Buscando dados para ${symbol} de ${new Date(start).toLocaleDateString()} até ${new Date(end).toLocaleDateString()}`);
      
      while (currentStart < end) {
        const params = {
          symbol: symbol,
          interval: interval,
          limit: this.maxCandlesPerRequest
        };
        
        // Se não é a primeira requisição, usa o timestamp do último candle como startTime
        if (allCandles.length > 0) {
          const lastCandle = allCandles[allCandles.length - 1];
          params.startTime = Math.floor((lastCandle.timestamp + 1) / 1000); // Converte para segundos
        } else {
          params.startTime = Math.floor(currentStart / 1000); // Converte para segundos
        }
        
        params.endTime = Math.floor(end / 1000); // Converte para segundos
        
        const response = await axios.get(`${this.backpackUrl}/api/v1/klines`, { params });
        
        if (!response.data || !Array.isArray(response.data)) {
          throw new Error('Resposta inválida da API Backpack');
        }
        
        if (response.data.length === 0) {
          break; // Não há mais dados
        }
        
        // Converte e adiciona candles (formato objeto da Backpack)
        const candles = response.data.map(candle => {
          // Converte string de data para timestamp
          const startTime = new Date(candle.start).getTime();
          
          return {
            timestamp: startTime,
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume),
            quoteVolume: parseFloat(candle.quoteVolume),
            start: parseFloat(candle.open)
          };
        });
        
        allCandles.push(...candles);
        
        // Atualiza timestamp de início para próxima requisição
        currentStart = candles[candles.length - 1].timestamp + 1;
        
        // Rate limiting para não sobrecarregar a API
        if (response.data.length === this.maxCandlesPerRequest) {
          await this.delay(100); // 100ms entre requisições
        }
        
        this.logger.info(`   📊 [BACKPACK] ${symbol}: ${candles.length} candles obtidos (total: ${allCandles.length})`);
      }
      
      // Remove duplicatas e ordena por timestamp
      const uniqueCandles = this.removeDuplicates(allCandles);
      uniqueCandles.sort((a, b) => a.timestamp - b.timestamp);
      
      this.logger.info(`✅ [BACKPACK] ${symbol}: Total de ${uniqueCandles.length} candles únicos`);
      
      return uniqueCandles;
      
    } catch (error) {
      this.logger.error(`❌ [BACKPACK] Erro ao obter dados para ${symbol}: ${error.message}`);
      throw error; // Re-throw para que o método principal possa tentar Binance
    }
  }

  /**
   * Remove candles duplicados baseado no timestamp
   */
  removeDuplicates(candles) {
    const seen = new Set();
    return candles.filter(candle => {
      const duplicate = seen.has(candle.timestamp);
      seen.add(candle.timestamp);
      return !duplicate;
    });
  }

  /**
   * Formata período dos dados para exibição
   */
  formatPeriod(candles) {
    if (candles.length === 0) return 'sem dados';
    
    const first = new Date(candles[0].timestamp);
    const last = new Date(candles[candles.length - 1].timestamp);
    const days = Math.ceil((last - first) / (1000 * 60 * 60 * 24));
    
    return `${days} dias (${first.toLocaleDateString()} - ${last.toLocaleDateString()})`;
  }

  /**
   * Converte símbolos da Backpack para formato da Binance
   * Ex: BTC_USDC_PERP -> BTCUSDT
   */
  convertSymbolToBinance(symbol) {
    // Remove _PERP e substitui _ por nada
    let binanceSymbol = symbol.replace('_PERP', '').replace(/_/g, '');
    
    // Mapeamento específico para pares comuns
    const symbolMap = {
      'BTCUSDC': 'BTCUSDT',
      'ETHUSDC': 'ETHUSDT',
      'SOLUSDC': 'SOLUSDT',
      'ADAUSDC': 'ADAUSDT',
      'DOTUSDC': 'DOTUSDT',
      'LINKUSDC': 'LINKUSDT',
      'MATICUSDC': 'MATICUSDT',
      'AVAXUSDC': 'AVAXUSDT',
      'UNIUSDC': 'UNIUSDT',
      'ATOMUSDC': 'ATOMUSDT',
      'LTCUSDC': 'LTCUSDT',
      'BCHUSDC': 'BCHUSDT',
      'XRPUSDC': 'XRPUSDT',
      'DOGEUSDC': 'DOGEUSDT',
      'SHIBUSDC': 'SHIBUSDT',
      'TRXUSDC': 'TRXUSDT',
      'ETCUSDC': 'ETCUSDT',
      'FILUSDC': 'FILUSDT',
      'NEARUSDC': 'NEARUSDT',
      'ALGOUSDC': 'ALGOUSDT'
    };
    
    return symbolMap[binanceSymbol] || binanceSymbol;
  }

  /**
   * Delay para rate limiting
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtém dados históricos da Binance para um símbolo específico
   */
  async getBinanceSymbolData(symbol, interval, days, startTime = null, endTime = null) {
    try {
      const binanceSymbol = this.convertSymbolToBinance(symbol);
      const end = endTime || Date.now();
      const start = startTime || (end - (days * 24 * 60 * 60 * 1000));
      
      const allCandles = [];
      let currentStart = start;
      
      this.logger.info(`🔄 [BINANCE] Buscando dados para ${symbol} (${binanceSymbol}) de ${new Date(start).toLocaleDateString()} até ${new Date(end).toLocaleDateString()}`);
      
      while (currentStart < end) {
        const params = {
          symbol: binanceSymbol,
          interval: interval,
          limit: this.maxCandlesPerRequest
        };
        
        // Se não é a primeira requisição, usa o timestamp do último candle como startTime
        if (allCandles.length > 0) {
          const lastCandle = allCandles[allCandles.length - 1];
          params.startTime = lastCandle.timestamp + 1; // Binance usa milissegundos
        } else {
          params.startTime = currentStart;
        }
        
        params.endTime = end;
        
        const response = await axios.get(`${this.binanceUrl}/api/v3/klines`, { params });
        
        if (!response.data || !Array.isArray(response.data)) {
          throw new Error('Resposta inválida da API Binance');
        }
        
        if (response.data.length === 0) {
          break; // Não há mais dados
        }
        
        // Converte dados da Binance para formato padrão
        const candles = response.data.map(candle => ({
          timestamp: candle[0], // open time em milissegundos
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5]),
          quoteVolume: parseFloat(candle[6]), // quote asset volume
          start: parseFloat(candle[1])
        }));
        
        allCandles.push(...candles);
        
        // Atualiza timestamp de início para próxima requisição
        currentStart = candles[candles.length - 1].timestamp + 1;
        
        // Rate limiting para não sobrecarregar a API
        if (response.data.length === this.maxCandlesPerRequest) {
          await this.delay(100); // 100ms entre requisições
        }
        
        this.logger.info(`   📊 [BINANCE] ${symbol}: ${candles.length} candles obtidos (total: ${allCandles.length})`);
      }
      
      // Remove duplicatas e ordena por timestamp
      const uniqueCandles = this.removeDuplicates(allCandles);
      uniqueCandles.sort((a, b) => a.timestamp - b.timestamp);
      
      this.logger.info(`✅ [BINANCE] ${symbol}: Total de ${uniqueCandles.length} candles únicos`);
      
      return uniqueCandles;
      
    } catch (error) {
      this.logger.error(`❌ [BINANCE] Erro ao obter dados para ${symbol}: ${error.message}`);
      return [];
    }
  }

  /**
   * NOVO: Determina o timeframe de dados baseado no modo de simulação
   * @param {string} ambientTimeframe - Timeframe da estratégia
   * @param {string} simulationMode - Modo de simulação
   * @returns {string} - Timeframe de dados a ser buscado
   */
  determineDataTimeframe(ambientTimeframe, simulationMode) {
    // Se modo for AUTO, determina automaticamente
    if (simulationMode === 'AUTO') {
      const highFidelityTimeframes = ['30m', '15m', '5m', '1m'];
      simulationMode = highFidelityTimeframes.includes(ambientTimeframe) ? 'HIGH_FIDELITY' : 'STANDARD';
    }
    
    // Se for High-Fidelity, sempre busca dados de 1m
    if (simulationMode === 'HIGH_FIDELITY') {
      return '1m';
    }
    
    // Se for Standard, usa o timeframe da estratégia
    return ambientTimeframe;
  }

  /**
   * CORRIGIDO: Agrupa dados de 1m para timeframe AMBIENT com lógica robusta
   * @param {object} historicalData - Dados históricos de 1m
   * @param {string} ambientTimeframe - Timeframe AMBIENT desejado
   * @returns {object} - Dados agrupados por timeframe AMBIENT
   */
  groupDataForAmbientTimeframe(historicalData, ambientTimeframe) {
    const groupedData = {};
    const ambientMs = this.timeframeToMs(ambientTimeframe);
    let totalInput = 0;
    let totalOutput = 0;
    for (const [symbol, candles1m] of Object.entries(historicalData)) {
      if (!candles1m || candles1m.length === 0) {
        this.logger.warn(`⚠️ ${symbol}: Sem dados de 1m para agrupar`);
        continue;
      }
      this.logger.info(`🔬 ${symbol}: Iniciando agrupamento de ${candles1m.length} candles 1m para ${ambientTimeframe}`);
      totalInput += candles1m.length;
      // Ordena candles por timestamp
      candles1m.sort((a, b) => a.timestamp - b.timestamp);
      const groupedCandles = [];
      let group = [];
      let groupStart = null;
      for (const candle of candles1m) {
        // Calcula o início do grupo AMBIENT
        const thisGroupStart = Math.floor(candle.timestamp / ambientMs) * ambientMs;
        if (groupStart === null) {
          groupStart = thisGroupStart;
        }
        if (thisGroupStart !== groupStart && group.length > 0) {
          // Fecha grupo anterior e cria candle agregado
          groupedCandles.push(this.aggregateCandleGroup(group, groupStart, ambientMs));
          group = [];
          groupStart = thisGroupStart;
        }
        group.push(candle);
      }
      // Último grupo
      if (group.length > 0) {
        groupedCandles.push(this.aggregateCandleGroup(group, groupStart, ambientMs));
      }
      groupedData[symbol] = groupedCandles;
      totalOutput += groupedCandles.length;
      this.logger.info(`🔬 ${symbol}: ${candles1m.length} candles 1m → ${groupedCandles.length} candles ${ambientTimeframe}`);
      if (groupedCandles.length === 0) {
        this.logger.error(`❌ ${symbol}: Nenhum candle agrupado gerado!`);
      } else if (groupedCandles.length === 1) {
        this.logger.warn(`⚠️ ${symbol}: Apenas 1 candle agrupado gerado. Verificar dados de entrada.`);
      }
    }
    this.logger.info(`✅ SUCESSO: ${totalInput} candles de 1m foram agregados em ${totalOutput} candles de ${ambientTimeframe}.`);
    return groupedData;
  }

  /**
   * NOVO: Agrega um grupo de candles de 1m em um candle do timeframe AMBIENT
   * @param {Array} group - Array de candles de 1m
   * @param {number} groupStart - Timestamp de início do grupo
   * @param {number} ambientMs - Duração do timeframe AMBIENT em ms
   * @returns {object} - Candle agregado
   */
  aggregateCandleGroup(group, groupStart, ambientMs) {
    return {
      timestamp: groupStart,
      open: parseFloat(group[0].open),
      high: Math.max(...group.map(c => parseFloat(c.high))),
      low: Math.min(...group.map(c => parseFloat(c.low))),
      close: parseFloat(group[group.length - 1].close),
      volume: group.reduce((sum, c) => sum + parseFloat(c.volume || 0), 0),
      quoteVolume: group.reduce((sum, c) => sum + parseFloat(c.quoteVolume || 0), 0),
      trades: group.reduce((sum, c) => sum + parseInt(c.trades || 0), 0),
      start: groupStart,
      end: groupStart + ambientMs - 1
    };
  }

  /**
   * Converte timeframe para milissegundos
   * @param {string} timeframe - Timeframe (ex: "1m", "5m", "15m", "1h", "4h", "1d")
   * @returns {number} - Milissegundos
   */
  timeframeToMs(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    
    switch (unit) {
      case 'm': return value * 60 * 1000; // minutos
      case 'h': return value * 60 * 60 * 1000; // horas
      case 'd': return value * 24 * 60 * 60 * 1000; // dias
      case 'w': return value * 7 * 24 * 60 * 60 * 1000; // semanas
      default: return 60 * 1000; // fallback para 1 minuto
    }
  }

  /**
   * CORRIGIDO: Obtém dados estendidos para um símbolo com paginação eficiente
   * @param {string} symbol - Símbolo do mercado
   * @param {string} interval - Intervalo dos candles
   * @param {number} days - Período em dias
   * @param {Date} startTime - Data de início (opcional)
   * @param {Date} endTime - Data de fim (opcional)
   * @returns {Array} - Array de candles
   */
  async getSymbolDataExtended(symbol, interval, days, startTime = null, endTime = null) {
    try {
      const end = endTime ? endTime.getTime() : Date.now();
      const start = startTime ? startTime.getTime() : end - (days * 24 * 60 * 60 * 1000);
      const intervalMs = this.getIntervalMs(interval);
      const candlesPerDay = this.getCandlesPerDay(interval);
      const totalCandles = days * candlesPerDay;
      this.logger.info(`📈 ${symbol}: Buscando ${totalCandles} candles (${days} dias) - ${new Date(start).toISOString()} até ${new Date(end).toISOString()}`);
      // Tenta Backpack primeiro
      let allCandles = [];
      try {
        allCandles = await this.getBackpackSymbolData(symbol, interval, totalCandles, start, end);
        if (allCandles && allCandles.length > 0) {
          this.logger.info(`✅ ${symbol}: ${allCandles.length} candles obtidos da Backpack.`);
          return allCandles;
        } else {
          this.logger.warn(`⚠️ ${symbol}: Backpack não retornou dados, tentando Binance...`);
        }
      } catch (e) {
        this.logger.warn(`⚠️ ${symbol}: Erro na Backpack: ${e.message}. Tentando Binance...`);
      }
      // Busca dados reais da Binance (sem fallback sintético)
      allCandles = await this.getBinanceSymbolData(this.convertSymbolToBinance(symbol), interval, totalCandles, start, end);
      if (!allCandles || allCandles.length === 0) {
        throw new Error(`❌ ${symbol}: Não foi possível obter dados reais da Binance para o período solicitado.`);
      }
      return allCandles;
    } catch (error) {
      this.logger.error(`❌ Erro ao obter dados para ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * NOVO: Obtém dados históricos para um timeframe específico (para indicadores macro)
   * SEMPRE busca dados reais - primeiro Backpack, depois Binance obrigatoriamente
   * @param {string} symbol - Símbolo do mercado
   * @param {string} timeframe - Timeframe desejado (ex: '1d', '4h', '1h')
   * @param {number} days - Período em dias
   * @param {Date} startTime - Data de início (opcional)
   * @param {Date} endTime - Data de fim (opcional)
   * @returns {Array} - Array de candles do timeframe específico
   */
  async getTimeframeData(symbol, timeframe, days = 50, startTime = null, endTime = null) {
    try {
      this.logger.info(`📊 [MACRO] Obtendo dados ${timeframe} para ${symbol} (${days} dias)`);
      
      const end = endTime ? endTime.getTime() : Date.now();
      const start = startTime ? startTime.getTime() : end - (days * 24 * 60 * 60 * 1000);
      
      // Tenta Backpack primeiro
      let candles = [];
      try {
        candles = await this.getBackpackSymbolData(symbol, timeframe, days * 24, start, end);
        if (candles && candles.length > 0) {
          this.logger.info(`✅ [MACRO] ${symbol}: ${candles.length} candles ${timeframe} obtidos da Backpack`);
          return candles;
        } else {
          this.logger.warn(`⚠️ [MACRO] ${symbol}: Backpack não retornou dados para ${timeframe}, tentando Binance...`);
        }
      } catch (e) {
        this.logger.warn(`⚠️ [MACRO] ${symbol}: Erro na Backpack para ${timeframe}: ${e.message}. Tentando Binance...`);
      }
      
      // OBRIGATORIAMENTE busca dados reais da Binance
      this.logger.info(`🔄 [MACRO] ${symbol}: Buscando dados ${timeframe} na Binance...`);
      candles = await this.getBinanceSymbolData(this.convertSymbolToBinance(symbol), timeframe, days * 24, start, end);
      
      if (!candles || candles.length === 0) {
        throw new Error(`❌ [MACRO] ${symbol}: Nenhum dado real obtido da Binance para ${timeframe}`);
      }
      
      this.logger.info(`✅ [MACRO] ${symbol}: ${candles.length} candles ${timeframe} obtidos da Binance`);
      return candles;
      
    } catch (error) {
      this.logger.error(`❌ [MACRO] Erro fatal ao obter dados ${timeframe} para ${symbol}: ${error.message}`);
      throw error; // Re-throw para que o chamador saiba que não há dados
    }
  }

  /**
   * Obtém dados históricos para um símbolo específico (método original mantido para compatibilidade)
   */
  async getSymbolData(symbol, interval, limit, startTime, endTime) {
    try {
      const params = {
        symbol: symbol,
        interval: interval,
        limit: Math.min(limit, this.maxCandlesPerRequest)
      };
      
      if (startTime) params.startTime = Math.floor(startTime / 1000); // Converte para segundos
      if (endTime) params.endTime = Math.floor(endTime / 1000); // Converte para segundos
      
      const response = await axios.get(`${this.backpackUrl}/api/v1/klines`, { params });
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Resposta inválida da API');
      }
      
      // Converte dados para formato padrão (formato objeto da Backpack)
      return response.data.map(candle => {
        // Converte string de data para timestamp
        const startTime = new Date(candle.start).getTime();
        
        return {
          timestamp: startTime,
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume),
          quoteVolume: parseFloat(candle.quoteVolume),
          start: parseFloat(candle.open)
        };
      });
      
    } catch (error) {
      this.logger.error(`❌ Erro ao obter dados para ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * CORRIGIDO: Obtém dados do Backpack com validação de período
   * @param {string} symbol - Símbolo do mercado
   * @param {string} interval - Intervalo dos candles
   * @param {number} limit - Número máximo de candles
   * @param {number} startTime - Timestamp de início
   * @param {number} endTime - Timestamp de fim
   * @returns {Array} - Array de candles
   */


  /**
   * Converte símbolo para formato Backpack
   * @param {string} symbol - Símbolo original
   * @returns {string} - Símbolo no formato Backpack
   */
  convertSymbolToBackpack(symbol) {
    // Backpack usa o mesmo formato que já temos (ex: BTC_USDC_PERP)
    // Não precisa de conversão
    return symbol;
  }

  /**
   * Busca dados reais da API da Binance com paginação robusta
   * @param {string} symbol - Símbolo do mercado (ex: BTCUSDT)
   * @param {string} interval - Intervalo dos candles (ex: '1m', '15m')
   * @param {number} totalLimit - Número total de candles desejados
   * @param {number} startTime - Timestamp de início (ms)
   * @param {number} endTime - Timestamp de fim (ms)
   * @returns {Array} - Array de candles reais
   */


  /**
   * Converte símbolo para formato Binance
   * @param {string} symbol - Símbolo original
   * @returns {string} - Símbolo no formato Binance
   */


  /**
   * @param {Array} candles - Array de candles
   * @returns {Array} - Array sem duplicatas
   */


  /**
   * Formata período para exibição
   * @param {Array} candles - Array de candles
   * @returns {string} - Período formatado
   */


  /**
   * Obtém símbolos disponíveis
   * @returns {Array} - Lista de símbolos
>>>>>>> Stashed changes
   */
  async getAvailableSymbols() {
    try {
      this.logger.info('📋 Obtendo lista de símbolos disponíveis...');
      
      const response = await axios.get(`${this.baseUrl}/api/v1/markets`);
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Resposta inválida da API');
      }
      
      // Filtra apenas símbolos com volume significativo e liquidez
      const activeSymbols = response.data
        .filter(market => 
          market.status === 'TRADING' && 
          market.quoteAsset === 'USDC' &&
          parseFloat(market.volume24h) > 50000 && // Volume mínimo de $50k
          parseFloat(market.quoteVolume) > 1000000 // Volume em USDC > $1M
        )
        .map(market => market.symbol)
        .sort();
      
      this.logger.info(`✅ ${activeSymbols.length} símbolos ativos encontrados`);
      
      return activeSymbols;
      
    } catch (error) {
      this.logger.error(`❌ Erro ao obter símbolos: ${error.message}`);
      return [];
    }
  }

  /**
   * Obtém símbolos mais líquidos para backtest
   */
  async getTopLiquidSymbols(limit = 20) {
    try {
      this.logger.info(`📊 Obtendo top ${limit} símbolos mais líquidos...`);
      
      const response = await axios.get(`${this.baseUrl}/api/v1/markets`);
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Resposta inválida da API');
      }
      
      // Filtra e ordena por volume
      const liquidSymbols = response.data
        .filter(market => 
          market.status === 'TRADING' && 
          market.quoteAsset === 'USDC' &&
          parseFloat(market.volume24h) > 100000 // Volume mínimo de $100k
        )
        .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
        .slice(0, limit)
        .map(market => market.symbol);
      
      this.logger.info(`✅ Top ${liquidSymbols.length} símbolos por liquidez:`);
      liquidSymbols.forEach((symbol, index) => {
        this.logger.info(`   ${index + 1}. ${symbol}`);
      });
      
      return liquidSymbols;
      
    } catch (error) {
      this.logger.error(`❌ Erro ao obter símbolos líquidos: ${error.message}`);
      return [];
    }
  }

  /**
   * Gera dados sintéticos para teste (mantido para compatibilidade, mas não recomendado para análise real)
   */
  generateSyntheticData(symbols, days = 30, interval = '1h') {
    this.logger.warn('⚠️ ATENÇÃO: Usando dados sintéticos - NÃO recomendado para análise real!');
    this.logger.info(`🔧 Gerando dados sintéticos para ${symbols.length} símbolos...`);
    
    const historicalData = {};
    const candlesPerDay = this.getCandlesPerDay(interval);
    const totalCandles = days * candlesPerDay;
    
    for (const symbol of symbols) {
      const candles = [];
      let basePrice = 100 + Math.random() * 900; // Preço base entre $100-$1000
      
      for (let i = 0; i < totalCandles; i++) {
        const timestamp = Date.now() - (totalCandles - i) * this.getIntervalMs(interval);
        
        // Simula movimento de preço com tendência e volatilidade
        const volatility = 0.02; // 2% de volatilidade
        const trend = Math.sin(i / 100) * 0.01; // Tendência cíclica
        const random = (Math.random() - 0.5) * volatility;
        
        basePrice *= (1 + trend + random);
        
        const open = basePrice;
        const high = open * (1 + Math.random() * 0.01);
        const low = open * (1 - Math.random() * 0.01);
        const close = low + Math.random() * (high - low);
        const volume = 1000 + Math.random() * 9000;
        
        candles.push({
          timestamp,
          open,
          high,
          low,
          close,
          volume,
          quoteVolume: volume * close,
          start: open
        });
      }
      
      historicalData[symbol] = candles;
    }
    
    return historicalData;
  }

  /**
   * Calcula número de candles por dia baseado no intervalo
   */
  getCandlesPerDay(interval) {
    const intervals = {
      '1m': 1440,
      '5m': 288,
      '15m': 96,
      '30m': 48,
      '1h': 24,
      '4h': 6,
      '1d': 1
    };
    
    return intervals[interval] || 24;
  }

  /**
   * Calcula milissegundos do intervalo
   */
  getIntervalMs(interval) {
    const intervals = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };
    
    return intervals[interval] || 60 * 60 * 1000;
  }

  /**
   * Valida se os dados estão completos e consistentes
   */
  validateData(historicalData, interval = '1h') {
    const issues = [];
    
    for (const [symbol, candles] of Object.entries(historicalData)) {
      if (!Array.isArray(candles) || candles.length === 0) {
        issues.push(`${symbol}: Sem dados`);
        continue;
      }
      
      // Verifica se candles estão ordenados cronologicamente
      for (let i = 1; i < candles.length; i++) {
        if (candles[i].timestamp <= candles[i-1].timestamp) {
          issues.push(`${symbol}: Candles não ordenados na posição ${i}`);
          break;
        }
      }
      
      // Verifica se há gaps muito grandes (usando o intervalo correto)
      const expectedInterval = this.getIntervalMs(interval);
      const maxGap = expectedInterval * 3; // Permite gaps de até 3x o intervalo
      
      for (let i = 1; i < candles.length; i++) {
        const gap = candles[i].timestamp - candles[i-1].timestamp;
        if (gap > maxGap) {
          const gapHours = Math.round(gap / (60 * 60 * 1000));
          const expectedHours = Math.round(expectedInterval / (60 * 60 * 1000));
          issues.push(`${symbol}: Gap de ${gapHours}h entre candles ${i-1} e ${i} (esperado: ~${expectedHours}h)`);
        }
      }
      
      // Verifica se preços são válidos
      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        if (candle.high < candle.low || candle.open <= 0 || candle.close <= 0) {
          issues.push(`${symbol}: Preços inválidos no candle ${i}`);
        }
      }
    }
    
    if (issues.length > 0) {
      this.logger.warn(`⚠️ Problemas encontrados nos dados (intervalo: ${interval}):`);
      issues.forEach(issue => this.logger.warn(`   ${issue}`));
    }
    
    return issues.length === 0;
  }
}