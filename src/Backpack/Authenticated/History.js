import axios from 'axios';
import { auth } from './Authentication.js';
import BotOrdersManager from '../../Config/BotOrdersManager.js';
import ConfigManager from '../../Config/ConfigManager.js';
import Futures from './Futures.js';

class History {

  async getBorrowHistory(symbol, type, limit, offset, sortDirection, positionId, sources, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

     const params = {};
      if (symbol) params.symbol = symbol;
      if (type) params.type = type;
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      if (sortDirection) params.sortDirection = sortDirection;
      if (positionId) params.positionId = positionId;
      if (sources) params.sources = sources;

    const headers = auth({
      instruction: 'borrowHistoryQueryAll',
      timestamp,
      params: params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/borrowLend`, {
        headers,
        params
      });

      return response.data
    } catch (error) {
      console.error('getBorrowHistory - ERROR!', error.response?.data || error.message);
      return null
    }
  }

  async getInterestHistory(symbol, type, limit, offset, sortDirection, positionId, sources, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

     const params = {};
      if (symbol) params.symbol = symbol;
      if (type) params.type = type;
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      if (sortDirection) params.sortDirection = sortDirection;
      if (positionId) params.positionId = positionId;
      if (sources) params.sources = sources;

    const headers = auth({
      instruction: 'interestHistoryQueryAll',
      timestamp,
      params: params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/interest`, {
        headers,
        params
      });

      return response.data
    } catch (error) {
      console.error('getInterestHistory - ERROR!', error.response?.data || error.message);
      return null
    }
  }

  async getBorrowPositionHistory(symbol, side, state, limit, offset, sortDirection, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    const params = {};
    if (symbol) params.symbol = symbol;
    if (side) params.type = type;
    if (state) params.state = state;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    if (sortDirection) params.sortDirection = sortDirection;

    const headers = auth({
      instruction: 'borrowPositionHistoryQueryAll',
      timestamp,
      params: params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/borrowLend/positions`, {
        headers,
        params
      });

      return response.data
    } catch (error) {
      console.error('getBorrowPositionHistory - ERROR!', error.response?.data || error.message);
      return null
    }
  }

  async getFillHistory(symbol, orderId, from, to, limit, offset, fillType, marketType, sortDirection, apiKey = null, apiSecret = null) {
  const timestamp = Date.now();

  const params = {};
  if (orderId) params.orderId = orderId;
  if (from) params.from = from;
  if (to) params.to = to;
  if (symbol) params.symbol = symbol;
  if (limit) params.limit = limit;
  if (offset) params.offset = offset;
  if (fillType) params.fillType = fillType;
  if (marketType) params.marketType = marketType; // array if multi values
  if (sortDirection) params.sortDirection = sortDirection;

  const headers = auth({
    instruction: 'fillHistoryQueryAll',
    timestamp,
    params,
    apiKey,
    apiSecret
  });

  try {
    const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/fills`, {
      headers,
      params,
    });

    return response.data;
  } catch (error) {
    console.error('getFillHistory - ERROR!', error.response?.data || error.message);
    return null;
  }
  }

  async getFundingPayments(symbol, limit, offset, sortDirection, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    const params = {};
    if (symbol) params.symbol = symbol;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    if (sortDirection) params.sortDirection = sortDirection;

    const headers = auth({
      instruction: 'fundingHistoryQueryAll',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/funding`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('getFundingPayments - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getOrderHistory(orderId, symbol, limit, offset, marketType, sortDirection, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    const params = {};
    if (orderId) params.orderId = orderId;
    if (symbol) params.symbol = symbol;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    if (marketType) params.marketType = marketType;
    if (sortDirection) params.sortDirection = sortDirection;

    const headers = auth({
      instruction: 'orderHistoryQueryAll',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/orders`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('getOrderHistory - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getProfitAndLossHistory(botName, symbol, limit, offset, sortDirection, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    const params = {};
    if (botName) params.subaccountId = botName;
    if (symbol) params.symbol = symbol;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    if (sortDirection) params.sortDirection = sortDirection;

    const headers = auth({
      instruction: 'pnlHistoryQueryAll',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/pnl`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('getProfitAndLossHistory - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  //source: "BackstopLiquidation" "CulledBorrowInterest" "CulledRealizePnl" "CulledRealizePnlBookUtilization" "FundingPayment" "RealizePnl" "TradingFees" "TradingFeesSystem"
  async getSettlementHistory(limit, offset, source, sortDirection, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    const params = {};
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    if (source) params.source = source;
    if (sortDirection) params.sortDirection = sortDirection;

    const headers = auth({
      instruction: 'settlementHistoryQueryAll',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/history/settlement`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('getSettlementHistory - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Analisa performance de um bot específico baseado apenas na Backpack
   * @param {string} botClientOrderId - ID único do bot para filtrar ordens
   * @param {Object} options - Opções de análise
   * @param {string} apiKey - Chave da API
   * @param {string} apiSecret - Secret da API
   * @returns {Object} Métricas de performance calculadas
   */
  async analyzeBotPerformance(botClientOrderId, options = {}, apiKey = null, apiSecret = null) {
    try {
      const { days = 90, limit = 1000 } = options;
      
      // Buscar fills da Backpack (fonte única de dados)
      let fills = [];
      if (apiKey && apiSecret) {
        try {
          const fillsData = await this.getFillHistory(null, null, null, null, limit, null, null, null, null, apiKey, apiSecret);
          
          if (fillsData && Array.isArray(fillsData)) {
            // Filtrar fills que pertencem ao bot usando clientId
            fills = this.filterBotFillsByClientId(fillsData, botClientOrderId);
          }
        } catch (error) {
          console.log(`⚠️ [ANALYZE] Erro ao buscar fills da Backpack: ${error.message}`);
          fills = [];
        }
      } else {
        console.log(`ℹ️ [ANALYZE] Sem credenciais da API, não é possível buscar dados da Backpack`);
        fills = [];
      }
      
      // Reconstruir posições a partir dos fills
      const positions = this.reconstructPositions(fills);
      
      // Buscar posições ativas da Backpack
      let activePositions = [];
      if (apiKey && apiSecret) {
        try {
          const positionsData = await Futures.getOpenPositions(apiKey, apiSecret);
          activePositions = positionsData || [];
          console.log(`📊 [ANALYZE] Posições ativas da Backpack: ${activePositions.length}`);
        } catch (error) {
          console.log(`⚠️ [ANALYZE] Erro ao buscar posições ativas: ${error.message}`);
        }
      }
      
      // Calcular métricas de performance usando apenas posições fechadas
      const performance = this.calculatePerformanceMetrics(positions);
      
      // Separar posições fechadas e abertas
      const closedPositions = positions.filter(pos => pos.isClosed);
      const openPositions = positions.filter(pos => !pos.isClosed);
      
      console.log(`✅ Posições fechadas: ${closedPositions.length}, Abertas: ${openPositions.length}`);
      console.log(`📊 [ANALYSIS] Total de posições: ${positions.length}`);
      console.log(`📊 [ANALYSIS] Posições fechadas: ${closedPositions.length}`);
      console.log(`📊 [ANALYSIS] Posições abertas: ${openPositions.length}`);
      
      return {
        botClientOrderId,
        performance: {
          totalTrades: positions.length,
          winningTrades: performance.winningTrades,
          losingTrades: performance.losingTrades,
          winRate: performance.winRate,
          profitFactor: performance.profitFactor,
          totalPnl: performance.totalPnl,
          averagePnl: performance.averagePnl,
          maxDrawdown: performance.maxDrawdown,
          openTrades: activePositions.length, // Usa posições reais da Backpack
          totalVolume: performance.totalVolume
        },
        positions: {
          closed: closedPositions.length,
          open: activePositions.length, // Usa posições reais da Backpack
          total: closedPositions.length + activePositions.length
        },
        lastAnalyzed: new Date().toISOString(),
        analysisPeriod: {
          startDate: fills.length > 0 ? this.getEarliestFillDate(fills) : null,
          endDate: fills.length > 0 ? this.getLatestFillDate(fills) : null
        }
      };
      
    } catch (error) {
      console.error(`❌ Erro na análise de performance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Filtra fills que pertencem ao bot específico usando apenas clientId da Backpack
   */
  filterBotFillsByClientId(fills, botClientOrderId) {
    const filteredFills = [];
    const botClientOrderIdStr = botClientOrderId ? botClientOrderId.toString() : '';
    
    console.log(`🔍 [FILTER] Filtrando fills para botClientOrderId: ${botClientOrderId}`);
    
    for (const fill of fills) {
      // Verifica clientId (método principal)
      const clientId = fill.clientId || fill.clientOrderId || fill.client_order_id;
      
      if (!clientId) {
        continue; // Pula fills sem clientId
      }
      
      const clientIdStr = clientId.toString();
      
      // Verifica se o clientId começa com o botClientOrderId
      const matches = clientIdStr.startsWith(botClientOrderIdStr);
      
      if (matches) {
        filteredFills.push(fill);
      }
    }
    
    return filteredFills;
  }

  /**
   * Filtra fills que pertencem ao bot específico (método legado)
   */
  filterBotFills(fills, botClientOrderId) {
    return this.filterBotFillsByClientId(fills, botClientOrderId);
  }

  /**
   * Cria posições abertas baseadas nas ordens importadas
   */
  createOpenPositionsFromImportedOrders(botId) {
    console.log(`🔍 [CREATE_POSITIONS] INICIANDO - Bot ${botId}`);
    const orders = BotOrdersManager.getBotOrders(botId);
    console.log(`🔍 [CREATE_POSITIONS] Encontradas ${orders.length} ordens para Bot ${botId}`);
    console.log(`🔍 [CREATE_POSITIONS] Primeira ordem:`, orders[0]);
    
    const openPositions = [];
    
    // Cria uma posição separada para cada ordem POSITION_IMPORT
    let positionImportCount = 0;
    
    // Primeiro, vamos listar todas as ordens POSITION_IMPORT
    const positionImportOrders = orders.filter(order => order.orderType === 'POSITION_IMPORT' && order.quantity > 0);
    console.log(`📊 [CREATE_POSITIONS] Ordens POSITION_IMPORT encontradas:`, positionImportOrders.map(o => ({ symbol: o.symbol, quantity: o.quantity, side: o.side })));
    console.log(`📊 [CREATE_POSITIONS] Todas as ordens:`, orders.map(o => ({ orderType: o.orderType, symbol: o.symbol, quantity: o.quantity, side: o.side })));
    
    for (const order of orders) {
      console.log(`🔍 [CREATE_POSITIONS] Processando ordem:`, {
        orderType: order.orderType,
        symbol: order.symbol,
        quantity: order.quantity,
        side: order.side
      });
      
      if (order.orderType === 'POSITION_IMPORT' && order.quantity > 0) {
        positionImportCount++;
        console.log(`✅ [CREATE_POSITIONS] Encontrada ordem POSITION_IMPORT #${positionImportCount}: ${order.symbol}`);
        
        // Cria uma posição separada para cada ordem
        const position = {
          symbol: order.symbol,
          side: order.side,
          totalQuantity: order.quantity,
          totalValue: order.quantity * order.price,
          averagePrice: order.price,
          fills: [{
            side: order.side,
            quantity: order.quantity,
            price: order.price,
            timestamp: new Date(order.timestamp),
            value: order.quantity * order.price
          }],
          startTime: new Date(order.timestamp),
          lastUpdateTime: new Date(order.timestamp),
          isClosed: false
        };
        
        openPositions.push(position);
        console.log(`✅ [CREATE_POSITIONS] Posição criada: ${order.symbol} - ${order.quantity} @ ${order.price}`);
      }
    }
    
    console.log(`📊 [CREATE_POSITIONS] Total de ordens POSITION_IMPORT processadas: ${positionImportCount}`);
    
    console.log(`📊 [CREATE_POSITIONS] Total de posições criadas: ${openPositions.length}`);
    console.log(`📊 [CREATE_POSITIONS] Símbolos das posições:`, openPositions.map(p => p.symbol));
    
    return openPositions;
  }

  /**
   * Reconstrói posições a partir dos fills
   */
  reconstructPositions(fills) {
    if (fills.length === 0) return [];
    
    // Ordena fills por timestamp
    const sortedFills = fills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const positions = [];
    const openPositions = new Map(); // symbol -> position
    
    for (const fill of sortedFills) {
      const symbol = fill.symbol;
      // Converte Ask/Bid para BUY/SELL
      const side = fill.side === 'Bid' ? 'BUY' : (fill.side === 'Ask' ? 'SELL' : fill.side);
      const quantity = parseFloat(fill.quantity);
      const price = parseFloat(fill.price);
      const timestamp = new Date(fill.timestamp);
      
      // Se não há posição aberta para este símbolo, cria uma nova
      if (!openPositions.has(symbol)) {
        openPositions.set(symbol, {
          symbol,
          side: side,
          totalQuantity: 0,
          totalValue: 0,
          averagePrice: 0,
          fills: [],
          startTime: timestamp,
          lastUpdateTime: timestamp,
          isClosed: false
        });
      }
      
      const position = openPositions.get(symbol);
      position.fills.push({
        side,
        quantity,
        price,
        timestamp,
        value: quantity * price
      });
      
      // Se é a mesma direção, soma à posição
      if (position.side === side) {
        position.totalQuantity += quantity;
        position.totalValue += (quantity * price);
        position.averagePrice = position.totalValue / position.totalQuantity;
      } else {
        // Direção oposta - fecha ou reduz a posição
        if (quantity >= position.totalQuantity) {
          // Fecha completamente a posição
          const closeQuantity = position.totalQuantity;
          const closeValue = closeQuantity * price;
          const pnl = (side === 'SELL' ? closeValue - (closeQuantity * position.averagePrice) : 
                                      (closeQuantity * position.averagePrice) - closeValue);
          
          position.pnl = pnl;
          position.closePrice = price;
          position.closeTime = timestamp;
          position.closeQuantity = closeQuantity;
          position.isClosed = true;
          
          // Adiciona à lista de posições fechadas
          positions.push({
            ...position,
            closeType: 'FULL'
          });
          
          // Remove da lista de posições abertas
          openPositions.delete(symbol);
          
          // Se sobrou quantidade, cria nova posição na direção oposta
          const remainingQuantity = quantity - closeQuantity;
          if (remainingQuantity > 0) {
            openPositions.set(symbol, {
              symbol,
              side: side,
              totalQuantity: remainingQuantity,
              totalValue: remainingQuantity * price,
              averagePrice: price,
              fills: [{
                side,
                quantity: remainingQuantity,
                price,
                timestamp,
                value: remainingQuantity * price
              }],
              startTime: timestamp,
              lastUpdateTime: timestamp,
              isClosed: false
            });
          }
        } else {
          // Reduz parcialmente a posição
          const closeValue = quantity * price;
          const pnl = (side === 'SELL' ? closeValue - (quantity * position.averagePrice) : 
                                      (quantity * position.averagePrice) - closeValue);
          
          position.totalQuantity -= quantity;
          position.totalValue -= (quantity * position.averagePrice);
          
          // Atualiza preço médio se ainda há quantidade
          if (position.totalQuantity > 0) {
            position.averagePrice = position.totalValue / position.totalQuantity;
          }
          
          position.lastUpdateTime = timestamp;
        }
      }
    }
    
    // Adiciona posições ainda abertas
    for (const [symbol, position] of openPositions) {
      positions.push(position);
    }
    
    return positions;
  }

  /**
   * Calcula métricas de performance das posições
   */
  calculatePerformanceMetrics(positions) {
    const closedPositions = positions.filter(pos => pos.isClosed);
    
    if (closedPositions.length === 0) {
      return {
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        totalPnl: 0,
        averagePnl: 0,
        maxDrawdown: 0,
        totalVolume: 0
      };
    }
    
    const winningTrades = closedPositions.filter(pos => pos.pnl > 0);
    const losingTrades = closedPositions.filter(pos => pos.pnl < 0);
    
    const totalPnl = closedPositions.reduce((sum, pos) => sum + pos.pnl, 0);
    const totalWinningPnl = winningTrades.reduce((sum, pos) => sum + pos.pnl, 0);
    const totalLosingPnl = Math.abs(losingTrades.reduce((sum, pos) => sum + pos.pnl, 0));
    
    const winRate = (winningTrades.length / closedPositions.length) * 100;
    const profitFactor = totalLosingPnl > 0 ? totalWinningPnl / totalLosingPnl : 0;
    const averagePnl = totalPnl / closedPositions.length;
    
    // Calcula drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let runningPnl = 0;
    
    for (const pos of closedPositions) {
      runningPnl += pos.pnl;
      if (runningPnl > peak) {
        peak = runningPnl;
      }
      const drawdown = peak - runningPnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Calcula volume total
    const totalVolume = closedPositions.reduce((sum, pos) => {
      return sum + pos.fills.reduce((fillSum, fill) => fillSum + fill.value, 0);
    }, 0);
    
    return {
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: Math.round(winRate * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      averagePnl: Math.round(averagePnl * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      totalVolume: Math.round(totalVolume * 100) / 100
    };
  }

  /**
   * Cria resultado vazio quando não há dados
   */
  createEmptyPerformanceResult(botClientOrderId) {
    return {
      botClientOrderId,
      performance: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        totalPnl: 0,
        averagePnl: 0,
        maxDrawdown: 0,
        openTrades: 0,
        totalVolume: 0
      },
      positions: {
        closed: 0,
        open: 0,
        total: 0
      },
      lastAnalyzed: new Date().toISOString(),
      analysisPeriod: {
        startDate: null,
        endDate: null
      }
    };
  }

  /**
   * Obtém a data do fill mais antigo
   */
  getEarliestFillDate(fills) {
    if (fills.length === 0) return null;
    const timestamps = fills.map(fill => new Date(fill.timestamp));
    return new Date(Math.min(...timestamps)).toISOString();
  }

  /**
   * Obtém a data do fill mais recente
   */
  getLatestFillDate(fills) {
    if (fills.length === 0) return null;
    const timestamps = fills.map(fill => new Date(fill.timestamp));
    return new Date(Math.max(...timestamps)).toISOString();
  }

  /**
   * Retorna detalhes das posições individuais
   */
  async getBotPerformanceDetails(botClientOrderId, options = {}, apiKey = null, apiSecret = null) {
    try {
      const { includeOpen = false } = options;
      
      // Buscar fills
      const fillsData = await this.getFillHistory(null, null, null, null, 1000, null, null, null, null, apiKey, apiSecret);
      
      // A API retorna diretamente um array de fills, não um objeto com propriedade fills
      if (!fillsData || !Array.isArray(fillsData)) {
        return {
          botClientOrderId,
          totalPositions: 0,
          closedPositions: 0,
          openPositions: 0,
          positions: [],
          analysisPeriod: {
            startDate: null,
            endDate: null
          },
          lastAnalyzed: new Date().toISOString()
        };
      }
      
      const fills = fillsData;
      const botFills = this.filterBotFills(fills, botClientOrderId);
      const positions = this.reconstructPositions(botFills);
      
      // Filtrar posições baseado no parâmetro includeOpen
      const filteredPositions = includeOpen 
        ? positions 
        : positions.filter(pos => pos.isClosed);
      
      // Formatar posições para resposta
      const formattedPositions = filteredPositions.map(pos => ({
        symbol: pos.symbol,
        side: pos.side,
        totalQuantity: pos.totalQuantity,
        averagePrice: pos.averagePrice,
        startTime: pos.startTime,
        lastUpdateTime: pos.lastUpdateTime,
        isClosed: pos.isClosed,
        pnl: pos.pnl || 0,
        closePrice: pos.closePrice,
        closeTime: pos.closeTime,
        closeQuantity: pos.closeQuantity,
        closeType: pos.closeType,
        fills: pos.fills.map(fill => ({
          side: fill.side,
          quantity: fill.quantity,
          price: fill.price,
          value: fill.value,
          timestamp: fill.timestamp
        }))
      }));
      
      return {
        botClientOrderId,
        totalPositions: filteredPositions.length,
        closedPositions: filteredPositions.filter(pos => pos.isClosed).length,
        openPositions: filteredPositions.filter(pos => !pos.isClosed).length,
        positions: formattedPositions,
        analysisPeriod: {
          startDate: this.getEarliestFillDate(botFills),
          endDate: this.getLatestFillDate(botFills)
        },
        lastAnalyzed: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Erro ao buscar detalhes de performance: ${error.message}`);
      throw error;
    }
  }

}

export default new History();
