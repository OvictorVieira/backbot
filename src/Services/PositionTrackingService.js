import OrdersService from './OrdersService.js';
import History from '../Backpack/Authenticated/History.js';
import Logger from '../Utils/Logger.js';
import OrderController from '../Controllers/OrderController.js';

/**
 * PositionTrackingService - Novo sistema de rastreamento de posições
 * 
 * Este serviço implementa a nova lógica de identificação de posições:
 * 1. Identifica posições abertas baseado nas ordens salvas no nosso banco
 * 2. Calcula mudanças de posição baseado nos fills da corretora (sem depender do clientId)
 * 3. Reconstrói o histórico completo de posições para cálculo correto de performance
 */
class PositionTrackingService {
  static dbService = null;

  /**
   * Inicializa o serviço com o DatabaseService
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  static init(dbService) {
    PositionTrackingService.dbService = dbService;
    Logger.info('🔧 [POSITION_TRACKING] PositionTrackingService inicializado');
  }

  /**
   * Rastreia posições de um bot específico
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @returns {Promise<object>} Dados das posições rastreadas
   */
  static async trackBotPositions(botId, config) {
    try {
      Logger.info(`🔍 [POSITION_TRACKING] Iniciando rastreamento para bot ${botId}`);

      // 1. Busca ordens abertas do nosso banco
      const ourOpenOrders = await this.getOurOpenOrders(botId);
      Logger.info(`📊 [POSITION_TRACKING] Encontradas ${ourOpenOrders.length} ordens abertas no banco`);

      // 2. Busca fills recentes da corretora
      const recentFills = await this.getRecentFills(config);
      Logger.info(`📊 [POSITION_TRACKING] Encontrados ${recentFills.length} fills recentes da corretora`);

      // 3. Reconstrói posições baseado nos fills
      const reconstructedPositions = await this.reconstructPositionsFromFills(recentFills, ourOpenOrders, config);
      Logger.info(`📊 [POSITION_TRACKING] Reconstruídas ${reconstructedPositions.length} posições`);

      // 4. Calcula métricas de performance
      const performanceMetrics = this.calculatePerformanceMetrics(reconstructedPositions);

      // 5. Atualiza estatísticas no banco
      await this.updatePositionStatistics(botId, reconstructedPositions);

      return {
        botId,
        openPositions: ourOpenOrders,
        reconstructedPositions,
        performanceMetrics,
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao rastrear posições do bot ${botId}:`, error.message);
      throw error;
    }
  }

  /**
   * Busca ordens abertas do nosso banco
   * @param {number} botId - ID do bot
   * @returns {Promise<Array>} Array de ordens abertas
   */
  static async getOurOpenOrders(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('OrdersService não está inicializado');
      }

      const orders = await OrdersService.getOrdersByBotId(botId);
      
      // CORREÇÃO: Busca TODAS as ordens do bot (não apenas "abertas")
      // porque precisamos do histórico completo para identificar trades
      const allOrders = orders.filter(order => 
        // Filtra apenas ordens de abertura (não stop loss, take profit, etc.)
        ['BUY', 'SELL'].includes(order.side) && 
        ['MARKET', 'LIMIT'].includes(order.orderType) &&
        !order.orderType.includes('PROFIT') &&
        !order.orderType.includes('LOSS')
      );

      console.log(`📊 [POSITION_TRACKING] Total de ordens do bot: ${orders.length}`);
      console.log(`📊 [POSITION_TRACKING] Ordens de abertura filtradas: ${allOrders.length}`);
      return allOrders;

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao buscar ordens abertas:`, error.message);
      return [];
    }
  }

  /**
   * Busca fills recentes da corretora
   * @param {object} config - Configuração do bot
   * @returns {Promise<Array>} Array de fills
   */
  static async getRecentFills(config) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        throw new Error('API_KEY e API_SECRET são obrigatórios');
      }

      // Busca fills das últimas 7 dias para ter histórico suficiente
      const now = Date.now();
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

      const fills = await History.getFillHistory(
        null, // symbol - todos os símbolos
        null, // orderId
        sevenDaysAgo,
        now,
        1000, // limit
        0, // offset
        null, // fillType
        'PERP', // marketType
        null, // sortDirection
        config.apiKey,
        config.apiSecret
      );

      if (!fills || !Array.isArray(fills)) {
        Logger.warn(`⚠️ [POSITION_TRACKING] Nenhum fill encontrado ou formato inválido`);
        return [];
      }

      Logger.debug(`📊 [POSITION_TRACKING] Fills recebidos da corretora: ${fills.length}`);
      
      // VALIDAÇÃO CRÍTICA: Filtra fills que pertencem ao bot e foram criados após a criação do bot
      const validFills = fills.filter(fill => {
        // Cria um objeto "order" com os dados do fill para usar na validação
        const orderForValidation = {
          symbol: fill.symbol,
          clientId: fill.clientId,
          createdAt: fill.createdAt || fill.timestamp
        };
        
        // Usa a validação centralizada do OrderController
        const isValid = OrderController.validateOrderForImport(orderForValidation, config);
        
        if (!isValid) {
          Logger.debug(`   ⚠️ [POSITION_TRACKING] Fill ignorado: ${fill.symbol} (clientId: ${fill.clientId}) - não pertence ao bot ou é muito antigo`);
        }
        
        return isValid;
      });
      
      Logger.info(`📊 [POSITION_TRACKING] Fills válidos após validação: ${validFills.length}/${fills.length}`);
      
      // DEBUG: Log dos primeiros fills para verificar formato
      if (validFills.length > 0) {
        Logger.debug(`🔍 [POSITION_TRACKING] Primeiro fill válido:`, JSON.stringify(validFills[0], null, 2));
      } else {
        Logger.warn(`⚠️ [POSITION_TRACKING] NENHUM FILL VÁLIDO ENCONTRADO!`);
      }
      
      return validFills;

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao buscar fills:`, error.message);
      return [];
    }
  }

  /**
   * Reconstrói posições baseado nos fills da corretora
   * @param {Array} fills - Fills da corretora
   * @param {Array} ourOpenOrders - Nossas ordens abertas
   * @param {Object} config - Configuração do bot (para validação de tempo)
   * @returns {Promise<Array>} Array de posições reconstruídas
   */
  static async reconstructPositionsFromFills(fills, ourOpenOrders, config) {
    try {
      if (fills.length === 0) {
        Logger.info(`ℹ️ [POSITION_TRACKING] Nenhum fill para reconstruir posições`);
        return [];
      }

      // VALIDAÇÃO CRÍTICA: Filtra ordens locais que foram criadas após a criação do bot
      let validOrders = ourOpenOrders;
      if (config?.createdAt) {
        const botCreatedAt = new Date(config.createdAt).getTime();
        validOrders = ourOpenOrders.filter(order => {
          const orderTime = new Date(order.timestamp).getTime();
          const isValid = orderTime >= botCreatedAt;
          
          if (!isValid) {
            Logger.debug(`   ⏰ [POSITION_TRACKING] Ordem antiga ignorada: ${order.symbol} (ID: ${order.id}) - Ordem: ${new Date(orderTime).toISOString()}, Bot criado: ${new Date(botCreatedAt).toISOString()}`);
          }
          
          return isValid;
        });
        
        Logger.info(`📊 [POSITION_TRACKING] Ordens válidas após validação de tempo: ${validOrders.length}/${ourOpenOrders.length}`);
      } else {
        Logger.warn(`⚠️ [POSITION_TRACKING] Configuração do bot não possui createdAt - todas as ordens serão consideradas válidas`);
      }

      // Agrupa fills por símbolo
      const fillsBySymbol = this.groupFillsBySymbol(fills);
      
      const ordersBySymbol = this.groupOrdersBySymbol(validOrders);
      
      const reconstructedPositions = [];

      // Para cada símbolo, reconstrói a posição consolidada
      for (const [symbol, symbolOrders] of Object.entries(ordersBySymbol)) {
        const symbolFills = fillsBySymbol[symbol] || [];
        
        console.log(`🔍 [DEBUG] Processando símbolo ${symbol}: ${symbolOrders.length} ordens, ${symbolFills.length} fills`);
        
        if (symbolFills.length === 0) {
          // Sem fills para este símbolo - posição ainda não foi executada
          const consolidatedOrder = this.consolidateOrdersBySymbol(symbolOrders);
          reconstructedPositions.push({
            symbol,
            side: consolidatedOrder.side,
            originalOrder: consolidatedOrder,
            status: 'PENDING',
            currentQuantity: 0,
            averageEntryPrice: 0,
            totalFills: [],
            isClosed: false,
            pnl: 0,
            pnlPct: 0,
            trades: [] // Adiciona um array vazio para trades
          });
          continue;
        }

        // Reconstrói a posição consolidada para este símbolo
        const position = this.reconstructPositionFromFills(symbolOrders, symbolFills);
        if (position) { // Adiciona apenas posições válidas
          reconstructedPositions.push(position);
        }
      }

      Logger.info(`✅ [POSITION_TRACKING] Reconstruídas ${reconstructedPositions.length} posições`);
      return reconstructedPositions;

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao reconstruir posições:`, error.message);
      return [];
    }
  }

  /**
   * Reconstrói uma posição específica baseado nos fills
   * @param {Array} symbolOrders - Array de ordens do mesmo símbolo
   * @param {Array} symbolFills - Fills do símbolo
   * @returns {object} Posição reconstruída
   */
  static reconstructPositionFromFills(symbolOrders, symbolFills) {
    try {
      // Consolida as ordens do símbolo
      const consolidatedOrder = this.consolidateOrdersBySymbol(symbolOrders);
      const side = consolidatedOrder.side; // BUY ou SELL
      const totalOrderQuantity = parseFloat(consolidatedOrder.quantity);
      const averageOrderPrice = parseFloat(consolidatedOrder.price);
      
      // Ordena fills por timestamp (mais antigo primeiro)
      const sortedFills = symbolFills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Identifica trades individuais baseado no padrão de fills
      const trades = [];
      let currentTrade = null;
      let remainingQuantity = totalOrderQuantity;
      let totalPnl = 0;
      let isPositionClosed = false;

      for (const fill of sortedFills) {
        const fillSide = this.normalizeFillSide(fill.side);
        const fillQuantity = parseFloat(fill.quantity);
        const fillPrice = parseFloat(fill.price);
        const fillTimestamp = new Date(fill.timestamp);

        if (fillSide === side) {
          // Entrada - inicia ou continua um trade
          if (!currentTrade) {
            // Inicia um novo trade
            currentTrade = {
              entryQuantity: fillQuantity,
              entryPrice: fillPrice,
              entryTime: fillTimestamp,
              side: side
            };
          } else {
            // Continua o trade atual
            currentTrade.entryQuantity += fillQuantity;
            // Atualiza preço médio
            const totalValue = (currentTrade.entryQuantity - fillQuantity) * currentTrade.entryPrice + (fillQuantity * fillPrice);
            currentTrade.entryPrice = totalValue / currentTrade.entryQuantity;
          }
        } else {
          // Saída - fecha um trade
          if (currentTrade) {
            const quantityToClose = Math.min(fillQuantity, currentTrade.entryQuantity);
            
            if (quantityToClose > 0) {
              // Fecha o trade atual
              const tradePnl = side === 'BUY' 
                ? (fillPrice - currentTrade.entryPrice) * quantityToClose
                : (currentTrade.entryPrice - fillPrice) * quantityToClose;
              
              trades.push({
                symbol: symbolOrders[0].symbol,
                side: currentTrade.side,
                entryQuantity: quantityToClose,
                entryPrice: currentTrade.entryPrice,
                entryTime: currentTrade.entryTime,
                exitQuantity: quantityToClose,
                exitPrice: fillPrice,
                exitTime: fillTimestamp,
                pnl: tradePnl,
                isClosed: true
              });
              
              totalPnl += tradePnl;
              
              // Atualiza quantidade restante
              currentTrade.entryQuantity -= quantityToClose;
              remainingQuantity -= quantityToClose;
              
              // Se o trade foi completamente fechado, inicia um novo
              if (currentTrade.entryQuantity <= 0) {
                currentTrade = null;
              }
            }
            
            // Se ainda há quantidade no fill, processa como fechamento de outro trade
            if (fillQuantity > quantityToClose) {
              const remainingFillQuantity = fillQuantity - quantityToClose;
              if (remainingFillQuantity > 0 && remainingQuantity > 0) {
                // Fecha parte da posição restante
                const closeQuantity = Math.min(remainingFillQuantity, remainingQuantity);
                const tradePnl = side === 'BUY' 
                  ? (fillPrice - averageOrderPrice) * closeQuantity
                  : (averageOrderPrice - fillPrice) * closeQuantity;
                
                trades.push({
                  symbol: symbolOrders[0].symbol,
                  side: side,
                  entryQuantity: closeQuantity,
                  entryPrice: averageOrderPrice,
                  entryTime: new Date(consolidatedOrder.timestamp),
                  exitQuantity: closeQuantity,
                  exitPrice: fillPrice,
                  exitTime: fillTimestamp,
                  pnl: tradePnl,
                  isClosed: true
                });
                
                totalPnl += tradePnl;
                remainingQuantity -= closeQuantity;
              }
            }
          } else {
            // Sem trade ativo, fecha parte da posição original
            const closeQuantity = Math.min(fillQuantity, remainingQuantity);
            if (closeQuantity > 0) {
              const tradePnl = side === 'BUY' 
                ? (fillPrice - averageOrderPrice) * closeQuantity
                : (averageOrderPrice - fillPrice) * closeQuantity;
              
              trades.push({
                symbol: symbolOrders[0].symbol,
                side: side,
                entryQuantity: closeQuantity,
                entryPrice: averageOrderPrice,
                entryTime: new Date(consolidatedOrder.timestamp),
                exitQuantity: closeQuantity,
                exitPrice: fillPrice,
                exitTime: fillTimestamp,
                pnl: tradePnl,
                isClosed: true
              });
              
              totalPnl += tradePnl;
              remainingQuantity -= closeQuantity;
            }
          }
        }
      }

      // Se ainda há um trade ativo, marca como aberto
      if (currentTrade && currentTrade.entryQuantity > 0) {
        trades.push({
          symbol: symbolOrders[0].symbol,
          side: currentTrade.side,
          entryQuantity: currentTrade.entryQuantity,
          entryPrice: currentTrade.entryPrice,
          entryTime: currentTrade.entryTime,
          exitQuantity: 0,
          exitPrice: 0,
          exitTime: null,
          pnl: 0,
          isClosed: false
        });
      }

      // Se ainda há quantidade restante da posição original, marca como aberta
      if (remainingQuantity > 0) {
        trades.push({
          symbol: symbolOrders[0].symbol,
          side: side,
          entryQuantity: remainingQuantity,
          entryPrice: averageOrderPrice,
          entryTime: new Date(consolidatedOrder.timestamp),
          exitQuantity: 0,
          exitPrice: 0,
          exitTime: null,
          pnl: 0,
          isClosed: false
        });
      }

      // Determina se a posição geral está fechada
      isPositionClosed = remainingQuantity <= 0;

      console.log(`   - RESULTADO FINAL:`);
      console.log(`     - Total de trades: ${trades.length}`);
      console.log(`     - Trades fechados: ${trades.filter(t => t.isClosed).length}`);
      console.log(`     - Trades abertos: ${trades.filter(t => !t.isClosed).length}`);
      console.log(`     - PnL total: ${totalPnl}`);
      console.log(`     - Posição fechada: ${isPositionClosed}`);

      return {
        symbol: consolidatedOrder.symbol,
        side,
        originalOrder: consolidatedOrder,
        status: isPositionClosed ? 'CLOSED' : 'OPEN',
        currentQuantity: remainingQuantity,
        averageEntryPrice: averageOrderPrice,
        totalFills: sortedFills.map(fill => ({
          side: this.normalizeFillSide(fill.side),
          quantity: parseFloat(fill.quantity),
          price: parseFloat(fill.price),
          timestamp: new Date(fill.timestamp),
          value: parseFloat(fill.quantity) * parseFloat(fill.price)
        })),
        isClosed: isPositionClosed,
        closePrice: isPositionClosed ? trades[trades.length - 1]?.exitPrice : null,
        closeTime: isPositionClosed ? trades[trades.length - 1]?.exitTime : null,
        closeQuantity: isPositionClosed ? totalOrderQuantity : 0,
        closeType: isPositionClosed ? 'AUTO' : null,
        pnl: totalPnl,
        pnlPct: totalPnl > 0 && (averageOrderPrice * totalOrderQuantity) > 0 ? (totalPnl / (averageOrderPrice * totalOrderQuantity)) * 100 : 0,
        // Adiciona trades individuais para análise
        trades: trades
      };

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao reconstruir posição:`, error.message);
      return null;
    }
  }

  /**
   * Normaliza o lado do fill (Bid/Ask -> BUY/SELL)
   * @param {string} fillSide - Lado do fill da corretora
   * @returns {string} Lado normalizado
   */
  static normalizeFillSide(fillSide) {
    if (fillSide === 'Bid') return 'BUY';
    if (fillSide === 'Ask') return 'SELL';
    return fillSide; // Mantém como está se já for BUY/SELL
  }

  /**
   * Agrupa fills por símbolo
   * @param {Array} fills - Fills da corretora
   * @returns {object} Fills agrupados por símbolo
   */
  static groupFillsBySymbol(fills) {
    const grouped = {};
    
    for (const fill of fills) {
      const symbol = fill.symbol;
      if (!grouped[symbol]) {
        grouped[symbol] = [];
      }
      grouped[symbol].push(fill);
    }

    return grouped;
  }

  /**
   * Agrupa ordens por símbolo
   * @param {Array} orders - Array de ordens
   * @returns {Object} Ordens agrupadas por símbolo
   */
  static groupOrdersBySymbol(orders) {
    const grouped = {};
    
    for (const order of orders) {
      const symbol = order.symbol;
      if (!grouped[symbol]) {
        grouped[symbol] = [];
      }
      grouped[symbol].push(order);
    }
    
    return grouped;
  }

  /**
   * Consolida múltiplas ordens do mesmo símbolo em uma única ordem
   * @param {Array} symbolOrders - Ordens do mesmo símbolo
   * @returns {Object} Ordem consolidada
   */
  static consolidateOrdersBySymbol(symbolOrders) {
    if (symbolOrders.length === 1) {
      return symbolOrders[0];
    }

    // Se múltiplas ordens, consolida em uma
    const firstOrder = symbolOrders[0];
    const totalQuantity = symbolOrders.reduce((sum, order) => sum + parseFloat(order.quantity), 0);
    const totalValue = symbolOrders.reduce((sum, order) => sum + (parseFloat(order.quantity) * parseFloat(order.price)), 0);
    const averagePrice = totalValue / totalQuantity;

    return {
      ...firstOrder,
      quantity: totalQuantity,
      price: averagePrice
    };
  }

  /**
   * Calcula métricas de performance das posições
   * @param {Array} positions - Array de posições
   * @returns {object} Métricas de performance
   */
  static calculatePerformanceMetrics(positions) {
    try {
      // Extrai todos os trades individuais de todas as posições
      const allTrades = [];
      
      for (const position of positions) {
        if (position.trades && Array.isArray(position.trades)) {
          allTrades.push(...position.trades);
        }
      }
      
      console.log(`🔍 [DEBUG] calculatePerformanceMetrics:`);
      console.log(`   - Total de posições: ${positions.length}`);
      console.log(`   - Total de trades extraídos: ${allTrades.length}`);
      
      // Filtra apenas trades válidos
      const validTrades = allTrades.filter(trade => 
        trade && 
        trade.symbol && 
        trade.entryQuantity > 0
      );
      
      const closedTrades = validTrades.filter(trade => trade.isClosed);
      const openTrades = validTrades.filter(trade => !trade.isClosed);
      
      console.log(`   - Trades válidos: ${validTrades.length}`);
      console.log(`   - Trades fechados: ${closedTrades.length}`);
      console.log(`   - Trades abertos: ${openTrades.length}`);
      
      if (validTrades.length === 0) {
        return {
          totalTrades: 0,
          totalPositions: positions.length,
          closedTrades: 0,
          closedPositions: 0,
          openTrades: 0,
          openPositions: openTrades.length,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
          totalPnl: 0,
          averagePnl: 0,
          maxDrawdown: 0,
          totalVolume: 0,
          averageHoldingTime: 0
        };
      }

      const winningTrades = closedTrades.filter(trade => trade.pnl > 0);
      const losingTrades = closedTrades.filter(trade => trade.pnl < 0);
      
      const totalPnl = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
      const totalWinningPnl = winningTrades.reduce((sum, trade) => sum + trade.pnl, 0);
      const totalLosingPnl = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.pnl, 0));
      
      const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
      const profitFactor = totalLosingPnl > 0 ? totalWinningPnl / totalLosingPnl : 0;
      const averagePnl = closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;
      
      // Calcula drawdown
      let maxDrawdown = 0;
      let peak = 0;
      let runningPnl = 0;
      
      for (const trade of closedTrades) {
        runningPnl += trade.pnl;
        if (runningPnl > peak) {
          peak = runningPnl;
        }
        const drawdown = peak - runningPnl;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
      
      // Calcula volume total
      const totalVolume = closedTrades.reduce((sum, trade) => {
        return sum + (trade.entryQuantity * trade.entryPrice);
      }, 0);

      // Calcula tempo médio de holding
      let totalHoldingTime = 0;
      let validHoldingTimes = 0;
      
      for (const trade of closedTrades) {
        if (trade.exitTime && trade.entryTime) {
          const entryTime = new Date(trade.entryTime);
          const exitTime = new Date(trade.exitTime);
          const holdingTime = exitTime - entryTime;
          
          if (holdingTime > 0) {
            totalHoldingTime += holdingTime;
            validHoldingTimes++;
          }
        }
      }
      
      const averageHoldingTime = validHoldingTimes > 0 ? totalHoldingTime / validHoldingTimes : 0;

      const result = {
        totalTrades: validTrades.length,
        totalPositions: positions.length,
        closedTrades: closedTrades.length,
        closedPositions: closedTrades.length,
        openTrades: openTrades.length,
        openPositions: openTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        profitFactor,
        totalPnl,
        averagePnl,
        maxDrawdown,
        totalVolume,
        averageHoldingTime,
        totalWinningPnl,
        totalLosingPnl
      };
      
      console.log(`   - RESULTADO FINAL:`);
      console.log(`     - totalTrades: ${result.totalTrades}`);
      console.log(`     - closedTrades: ${result.closedTrades}`);
      console.log(`     - openTrades: ${result.openTrades}`);
      console.log(`     - totalPnl: ${result.totalPnl}`);
      
      return result;

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao calcular métricas de performance:`, error.message);
      return {
        totalTrades: 0,
        totalPositions: 0,
        closedTrades: 0,
        closedPositions: 0,
        openTrades: 0,
        openPositions: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        totalPnl: 0,
        averagePnl: 0,
        maxDrawdown: 0,
        totalVolume: 0,
        averageHoldingTime: 0,
        error: error.message
      };
    }
  }

  /**
   * Atualiza estatísticas de posição no banco
   * @param {number} botId - ID do bot
   * @param {Array} positions - Array de posições
   */
  static async updatePositionStatistics(botId, positions) {
    try {
      // TODO: Implementar tabela de estatísticas de posição no banco
      // Por enquanto, apenas loga as estatísticas
      Logger.info(`📊 [POSITION_TRACKING] Estatísticas atualizadas para bot ${botId}:`);
      Logger.info(`   • Total de posições: ${positions.length}`);
      Logger.info(`   • Posições fechadas: ${positions.filter(p => p.isClosed).length}`);
      Logger.info(`   • Posições abertas: ${positions.filter(p => !p.isClosed).length}`);

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao atualizar estatísticas:`, error.message);
    }
  }

  /**
   * Busca histórico de posições de um bot
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @param {object} options - Opções de busca
   * @returns {Promise<object>} Histórico de posições
   */
  static async getBotPositionHistory(botId, config, options = {}) {
    try {
      const { days = 30, includeOpen = true } = options;
      
      Logger.info(`🔍 [POSITION_TRACKING] Buscando histórico de posições para bot ${botId} (últimos ${days} dias)`);

      // Busca fills do período
      const now = Date.now();
      const startTime = now - (days * 24 * 60 * 60 * 1000);

      const fills = await History.getFillHistory(
        null, // symbol
        null, // orderId
        startTime,
        now,
        1000, // limit
        0, // offset
        null, // fillType
        'PERP', // marketType
        null, // sortDirection
        config.apiKey,
        config.apiSecret
      );

      if (!fills || !Array.isArray(fills)) {
        return {
          botId,
          period: { start: new Date(startTime), end: new Date(now) },
          positions: [],
          summary: {
            totalPositions: 0,
            closedPositions: 0,
            openPositions: 0
          }
        };
      }

      // Busca nossas ordens do período
      const ourOrders = await this.getOurOrdersInPeriod(botId, startTime, now);
      
      // Reconstrói posições
      const positions = await this.reconstructPositionsFromFills(fills, ourOrders, config);
      
      // Filtra posições baseado nas opções
      const filteredPositions = includeOpen 
        ? positions 
        : positions.filter(pos => pos.isClosed);

      // Calcula métricas
      const performanceMetrics = this.calculatePerformanceMetrics(filteredPositions);

      return {
        botId,
        period: { start: new Date(startTime), end: new Date(now) },
        positions: filteredPositions,
        summary: {
          totalPositions: filteredPositions.length,
          closedPositions: filteredPositions.filter(p => p.isClosed).length,
          openPositions: filteredPositions.filter(p => !p.isClosed).length,
          performance: performanceMetrics
        }
      };

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao buscar histórico de posições:`, error.message);
      throw error;
    }
  }

  /**
   * Busca ordens do nosso banco em um período específico
   * @param {number} botId - ID do bot
   * @param {number} startTime - Timestamp de início
   * @param {number} endTime - Timestamp de fim
   * @returns {Promise<Array>} Array de ordens
   */
  static async getOurOrdersInPeriod(botId, startTime, endTime) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        return [];
      }

      const orders = await OrdersService.getOrdersByBotId(botId);
      
      // Filtra ordens do período
      const periodOrders = orders.filter(order => {
        const orderTime = new Date(order.timestamp).getTime();
        return orderTime >= startTime && orderTime <= endTime;
      });

      return periodOrders;

    } catch (error) {
      Logger.error(`❌ [POSITION_TRACKING] Erro ao buscar ordens do período:`, error.message);
      return [];
    }
  }
}

export default PositionTrackingService;
