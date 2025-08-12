import Logger from '../Utils/Logger.js';

/**
 * PositionTrackingService - Gerencia o ciclo de vida das posições de trading
 *
 * Este serviço mantém o estado das posições sincronizado com as execuções
 * reais da exchange, calculando P&L em tempo real baseado nos eventos de fill.
 */
class PositionTrackingService {
  /**
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  constructor(dbService) {
    this.dbService = dbService;

    if (!dbService) {
      throw new Error('DatabaseService é obrigatório para o PositionTrackingService');
    }
  }

  /**
   * Método central para atualizar posições baseado em eventos de fill
   * @param {Object} fillEvent - Evento de fill da exchange
   * @param {string} fillEvent.symbol - Símbolo do mercado
   * @param {string} fillEvent.side - Lado da ordem ('Bid' ou 'Ask')
   * @param {number} fillEvent.quantity - Quantidade executada
   * @param {number} fillEvent.price - Preço de execução
   * @param {string} fillEvent.orderId - ID da ordem
   * @param {string} fillEvent.clientId - Client ID da ordem
   * @param {string} fillEvent.timestamp - Timestamp da execução
   * @param {number} fillEvent.botId - ID do bot (opcional)
   * @returns {Promise<void>}
   */
  async updatePositionOnFill(fillEvent) {
    try {
      if (!fillEvent || !fillEvent.symbol || !fillEvent.side || !fillEvent.quantity || !fillEvent.price) {
        Logger.warn('📊 [POSITION_TRACKING] Fill event inválido:', fillEvent);
        return;
      }

      const { symbol, side, quantity, price, orderId, clientId, timestamp, botId } = fillEvent;
      const fillQuantity = Math.abs(parseFloat(quantity));
      const fillPrice = parseFloat(price);

      Logger.debug(`📊 [POSITION_TRACKING] Processando fill: ${symbol} ${side} ${fillQuantity} @ ${fillPrice}`);

      // Atualiza o status da ordem correspondente na tabela bot_orders
      await this.updateOrderStatusOnFill(fillEvent);

      // Busca posição aberta ou parcialmente fechada para o símbolo
      const existingPosition = await this.getOpenPosition(symbol, botId);

      if (!existingPosition) {
        // Não há posição existente - esta é uma nova posição de entrada
        await this.createNewPosition(fillEvent);
        return;
      }

      // Determina se o fill é no sentido oposto à posição (fechamento)
      const isClosingFill = this.isClosingFill(existingPosition.side, side);

      if (isClosingFill) {
        // Fill de fechamento - calcula P&L e atualiza posição
        await this.handleClosingFill(existingPosition, fillEvent);
      } else {
        // Fill no mesmo sentido - aumenta a posição (position scaling)
        await this.handlePositionIncrease(existingPosition, fillEvent);
      }

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao processar fill:', error.message);
      throw error;
    }
  }

  /**
   * Cria uma nova posição baseada no evento de fill
   * @param {Object} fillEvent - Evento de fill
   * @returns {Promise<void>}
   */
  async createNewPosition(fillEvent) {
    try {
      const { symbol, side, quantity, price, botId, timestamp } = fillEvent;
      const fillQuantity = Math.abs(parseFloat(quantity));
      const fillPrice = parseFloat(price);

      // Determina o lado da posição baseado no lado da ordem
      const positionSide = this.getPositionSide(side);

      const newPosition = {
        symbol,
        side: positionSide,
        entryPrice: fillPrice,
        initialQuantity: fillQuantity,
        currentQuantity: fillQuantity,
        pnl: 0,
        status: 'OPEN',
        createdAt: timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        botId: botId || null
      };

      const result = await this.dbService.run(
        `INSERT INTO positions (symbol, side, entryPrice, initialQuantity, currentQuantity, pnl, status, createdAt, updatedAt, botId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newPosition.symbol,
          newPosition.side,
          newPosition.entryPrice,
          newPosition.initialQuantity,
          newPosition.currentQuantity,
          newPosition.pnl,
          newPosition.status,
          newPosition.createdAt,
          newPosition.updatedAt,
          newPosition.botId
        ]
      );

      Logger.info(`✅ [POSITION_TRACKING] Nova posição criada: ${symbol} ${positionSide} ${fillQuantity} @ ${fillPrice} (ID: ${result.lastID})`);

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao criar nova posição:', error.message);
      throw error;
    }
  }

  /**
   * Processa um fill de fechamento de posição
   * @param {Object} position - Posição existente
   * @param {Object} fillEvent - Evento de fill de fechamento
   * @returns {Promise<void>}
   */
  async handleClosingFill(position, fillEvent) {
    try {
      const { quantity, price } = fillEvent;
      const closeQuantity = Math.abs(parseFloat(quantity));
      const closePrice = parseFloat(price);

      // Calcula a quantidade que será efetivamente fechada
      const quantityToClose = Math.min(closeQuantity, position.currentQuantity);

      // Calcula o P&L desta parte da posição
      const pnlFromClose = this.calculatePnL(
        position.side,
        position.entryPrice,
        closePrice,
        quantityToClose
      );

      // Atualiza a posição
      const newCurrentQuantity = position.currentQuantity - quantityToClose;
      const newTotalPnl = position.pnl + pnlFromClose;

      // Determina o novo status da posição
      let newStatus = 'OPEN';
      if (newCurrentQuantity === 0) {
        newStatus = 'CLOSED';
      } else if (newCurrentQuantity < position.initialQuantity) {
        newStatus = 'PARTIALLY_CLOSED';
      }

      // Atualiza no banco de dados
      await this.dbService.run(
        `UPDATE positions 
         SET currentQuantity = ?, pnl = ?, status = ?, updatedAt = ?
         WHERE id = ?`,
        [
          newCurrentQuantity,
          newTotalPnl,
          newStatus,
          new Date().toISOString(),
          position.id
        ]
      );

      // Se a posição foi totalmente fechada, atualiza a ordem correspondente na bot_orders
      if (newStatus === 'CLOSED') {
        await this.updateOrderOnPositionClosed(position, fillEvent, newTotalPnl, pnlFromClose);
      }

      Logger.debug(`📈 [POSITION_TRACKING] Posição atualizada: ${position.symbol} fechou ${quantityToClose} @ ${closePrice}`);
      Logger.debug(`📈 [POSITION_TRACKING] P&L: ${pnlFromClose.toFixed(6)}, Total P&L: ${newTotalPnl.toFixed(6)}, Status: ${newStatus}`);
      Logger.debug(`📈 [POSITION_TRACKING] Quantidade restante: ${newCurrentQuantity}`);

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao processar fechamento:', error.message);
      throw error;
    }
  }

  /**
   * Processa um fill que aumenta a posição existente
   * @param {Object} position - Posição existente
   * @param {Object} fillEvent - Evento de fill que aumenta a posição
   * @returns {Promise<void>}
   */
  async handlePositionIncrease(position, fillEvent) {
    try {
      const { quantity, price } = fillEvent;
      const addQuantity = Math.abs(parseFloat(quantity));
      const addPrice = parseFloat(price);

      // Calcula o novo preço médio de entrada
      const totalValue = (position.entryPrice * position.currentQuantity) + (addPrice * addQuantity);
      const totalQuantity = position.currentQuantity + addQuantity;
      const newEntryPrice = totalValue / totalQuantity;

      // Atualiza a posição
      await this.dbService.run(
        `UPDATE positions 
         SET entryPrice = ?, initialQuantity = initialQuantity + ?, currentQuantity = ?, updatedAt = ?
         WHERE id = ?`,
        [
          newEntryPrice,
          addQuantity,
          totalQuantity,
          new Date().toISOString(),
          position.id
        ]
      );

      Logger.debug(`📈 [POSITION_TRACKING] Posição aumentada: ${position.symbol} +${addQuantity} @ ${addPrice}`);
      Logger.debug(`📈 [POSITION_TRACKING] Novo preço médio: ${newEntryPrice.toFixed(6)}, Quantidade total: ${totalQuantity}`);

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao aumentar posição:', error.message);
      throw error;
    }
  }

  /**
   * Busca uma posição aberta ou parcialmente fechada para um símbolo
   * @param {string} symbol - Símbolo do mercado
   * @param {number} botId - ID do bot (opcional)
   * @returns {Promise<Object|null>} Posição encontrada ou null
   */
  async getOpenPosition(symbol, botId = null) {
    try {
      let query = `SELECT * FROM positions WHERE symbol = ? AND status IN ('OPEN', 'PARTIALLY_CLOSED')`;
      const params = [symbol];

      if (botId) {
        query += ` AND botId = ?`;
        params.push(botId);
      }

      query += ` ORDER BY createdAt DESC LIMIT 1`;

      const position = await this.dbService.get(query, params);
      return position || null;

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao buscar posição:', error.message);
      return null;
    }
  }

  /**
   * Verifica se um fill é um fechamento de posição
   * @param {string} positionSide - Lado da posição ('LONG' ou 'SHORT')
   * @param {string} fillSide - Lado do fill ('Bid' ou 'Ask')
   * @returns {boolean} True se é um fechamento
   */
  isClosingFill(positionSide, fillSide) {
    if (positionSide === 'LONG' && fillSide === 'Ask') {
      return true; // Venda fecha posição LONG
    }
    if (positionSide === 'SHORT' && fillSide === 'Bid') {
      return true; // Compra fecha posição SHORT
    }
    return false;
  }

  /**
   * Determina o lado da posição baseado no lado da ordem
   * @param {string} orderSide - Lado da ordem ('Bid' ou 'Ask')
   * @returns {string} Lado da posição ('LONG' ou 'SHORT')
   */
  getPositionSide(orderSide) {
    return orderSide === 'Bid' ? 'LONG' : 'SHORT';
  }

  /**
   * Calcula o P&L de uma quantidade fechada
   * @param {string} positionSide - Lado da posição ('LONG' ou 'SHORT')
   * @param {number} entryPrice - Preço de entrada
   * @param {number} exitPrice - Preço de saída
   * @param {number} quantity - Quantidade fechada
   * @returns {number} P&L calculado
   */
  calculatePnL(positionSide, entryPrice, exitPrice, quantity) {
    if (positionSide === 'LONG') {
      // Para LONG: lucro quando exit > entry
      return (exitPrice - entryPrice) * quantity;
    } else {
      // Para SHORT: lucro quando entry > exit
      return (entryPrice - exitPrice) * quantity;
    }
  }

  /**
   * Obtém estatísticas de P&L para um bot
   * @param {number} botId - ID do bot
   * @returns {Promise<Object>} Estatísticas de P&L
   */
  async getBotPnLStats(botId) {
    try {
      const result = await this.dbService.get(
        `SELECT 
           COUNT(*) as totalTrades,
           SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closedTrades,
           SUM(CASE WHEN status = 'CLOSED' AND pnl > 0 THEN 1 ELSE 0 END) as winTrades,
           SUM(CASE WHEN status = 'CLOSED' AND pnl < 0 THEN 1 ELSE 0 END) as lossTrades,
           SUM(CASE WHEN status = 'CLOSED' THEN pnl ELSE 0 END) as totalPnl,
           AVG(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as avgPnl,
           MAX(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as maxWin,
           MIN(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as maxLoss
         FROM positions 
         WHERE botId = ?`,
        [botId]
      );

      const stats = {
        totalTrades: result?.totalTrades || 0,
        closedTrades: result?.closedTrades || 0,
        winTrades: result?.winTrades || 0,
        lossTrades: result?.lossTrades || 0,
        totalPnl: result?.totalPnl || 0,
        avgPnl: result?.avgPnl || 0,
        maxWin: result?.maxWin || 0,
        maxLoss: result?.maxLoss || 0,
        winRate: result?.closedTrades > 0 ? (result.winTrades / result.closedTrades) * 100 : 0
      };

      return stats;

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao calcular estatísticas:', error.message);
      return {
        totalTrades: 0,
        closedTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalPnl: 0,
        avgPnl: 0,
        maxWin: 0,
        maxLoss: 0,
        winRate: 0
      };
    }
  }

  /**
   * Atualiza a ordem na bot_orders quando uma posição é totalmente fechada
   * @param {Object} position - Posição que foi fechada
   * @param {Object} fillEvent - Fill de fechamento
   * @param {number} totalPnl - PnL total da posição
   * @param {number} pnlFromClose - PnL do fechamento atual
   */
  async updateOrderOnPositionClosed(position, fillEvent, totalPnl, pnlFromClose) {
    try {
      // Busca a ordem original que abriu esta posição na bot_orders
      const originalOrder = await this.dbService.get(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND symbol = ? AND status IN ('FILLED', 'PENDING')
         ORDER BY timestamp ASC LIMIT 1`,
        [position.botId, position.symbol]
      );

      if (!originalOrder) {
        Logger.warn(`⚠️ [POSITION_TRACKING] Ordem original não encontrada para posição ${position.symbol}`);
        return;
      }

      // Calcula P&L percentual
      const pnlPct = originalOrder.price > 0 ? (totalPnl / (originalOrder.quantity * originalOrder.price)) * 100 : 0;

      // Atualiza a ordem para status CLOSED com P&L
      await this.dbService.run(
        `UPDATE bot_orders SET 
         status = 'CLOSED',
         closePrice = ?,
         closeTime = ?,
         closeQuantity = ?,
         closeType = ?,
         pnl = ?,
         pnlPct = ?
         WHERE id = ?`,
        [
          fillEvent.price,
          fillEvent.timestamp || new Date().toISOString(),
          position.initialQuantity, // Quantidade total da posição
          fillEvent.clientId ? 'MANUAL' : 'AUTO', // Se tem clientId é manual, senão automático
          totalPnl,
          pnlPct,
          originalOrder.id
        ]
      );

      Logger.info(`✅ [POSITION_TRACKING] Ordem ${originalOrder.externalOrderId} marcada como CLOSED com P&L: ${totalPnl.toFixed(6)} (${pnlPct.toFixed(2)}%)`);

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao atualizar ordem na posição fechada:', error.message);
    }
  }

  /**
   * Atualiza o status da ordem na tabela bot_orders quando um fill é processado
   * @param {Object} fillEvent - Evento de fill
   */
  async updateOrderStatusOnFill(fillEvent) {
    try {
      const { orderId, clientId, quantity, price, symbol, botId } = fillEvent;

      if (!orderId && !clientId) {
        Logger.warn('⚠️ [POSITION_TRACKING] Sem orderId ou clientId para atualizar ordem');
        return;
      }

      // Busca a ordem por externalOrderId ou clientId
      let whereClause, params;
      if (orderId) {
        whereClause = 'externalOrderId = ?';
        params = [orderId];
      } else {
        whereClause = 'clientId = ?';
        params = [clientId];
      }

      // Se tiver botId, adiciona ao filtro
      if (botId) {
        whereClause += ' AND botId = ?';
        params.push(botId);
      }

      const order = await this.dbService.get(
        `SELECT * FROM bot_orders WHERE ${whereClause}`,
        params
      );

      if (!order) {
        Logger.warn(`⚠️ [POSITION_TRACKING] Ordem não encontrada para fill: ${orderId || clientId}`);
        return;
      }

      // Atualiza o status da ordem para FILLED (se estava PENDING)
      if (order.status === 'PENDING') {
        await this.dbService.run(
          `UPDATE bot_orders SET 
           status = 'FILLED',
           exchangeCreatedAt = COALESCE(exchangeCreatedAt, ?)
           WHERE id = ?`,
          [new Date().toISOString(), order.id]
        );

        Logger.debug(`✅ [POSITION_TRACKING] Ordem ${orderId || clientId} atualizada para FILLED`);
      }

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao atualizar status da ordem:', error.message);
    }
  }

  /**
   * Busca apenas posições abertas do bot específico
   * @param {number} botId - ID do bot
   * @returns {Promise<Array>} Array de posições abertas apenas deste bot
   */
  async getBotOpenPositions(botId) {
    try {
      // Busca ordens que representam posições abertas:
      // - PENDING: Ordens ainda não executadas
      // - FILLED: Ordens executadas mas ainda não fechadas
      const query = `
        SELECT * FROM bot_orders 
        WHERE botId = ? AND (
          status = 'PENDING' OR 
          status = 'FILLED' OR
          (status != 'CLOSED' AND closePrice IS NULL)
        )
        ORDER BY timestamp DESC
      `;

      const openOrders = await this.dbService.getAll(query, [botId]);

      // Agrupa por símbolo para simular posições
      const positionsBySymbol = new Map();

      for (const order of openOrders) {
        const symbol = order.symbol;

        if (!positionsBySymbol.has(symbol)) {
          positionsBySymbol.set(symbol, {
            symbol: symbol,
            side: order.side === 'BUY' ? 'LONG' : 'SHORT',
            quantity: 0,
            entryPrice: 0,
            totalValue: 0,
            pnl: order.pnl || 0,
            status: order.status,
            orders: []
          });
        }

        const position = positionsBySymbol.get(symbol);
        position.orders.push(order);

        // Calcula quantidade e preço médio
        const orderQuantity = Math.abs(order.quantity);
        const orderValue = orderQuantity * order.price;

        position.quantity += orderQuantity;
        position.totalValue += orderValue;
        position.entryPrice = position.totalValue / position.quantity;
      }

      // Converte para formato compatível com Futures.getOpenPositions
      const positions = Array.from(positionsBySymbol.values()).map(position => ({
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        pnl: position.pnl,
        status: position.status,
        // Adiciona flag para identificar que é posição do bot
        _isBotPosition: true,
        _botId: botId,
        _orderCount: position.orders.length
      }));

      Logger.debug(`📊 [POSITION_TRACKING] Encontradas ${positions.length} posições abertas para bot ${botId} (baseado em ${openOrders.length} ordens)`);
      return positions;

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao buscar posições abertas do bot:', error.message);
      return [];
    }
  }

  /**
   * Busca todas as ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {Promise<Array>} Array com todas as ordens
   */
  async getAllBotOrders(botId) {
    try {
      const query = 'SELECT * FROM bot_orders WHERE botId = ? ORDER BY timestamp DESC';
      const orders = await this.dbService.getAll(query, [botId]);
      return orders || [];
    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao buscar ordens do bot:', error.message);
      return [];
    }
  }

  /**
   * Calcula estatísticas baseado nas ordens do bot
   * @param {number} botId - ID do bot
   * @returns {Promise<Object>} Estatísticas das ordens
   */
  async getBotOrderStats(botId) {
    try {
      const result = await this.dbService.get(
        `SELECT 
           COUNT(*) as totalTrades,
           SUM(CASE WHEN status IN ('CLOSED', 'FILLED') THEN 1 ELSE 0 END) as executedTrades,
           SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closedTrades,
           SUM(CASE WHEN status = 'CLOSED' AND pnl > 0 THEN 1 ELSE 0 END) as winTrades,
           SUM(CASE WHEN status = 'CLOSED' AND pnl < 0 THEN 1 ELSE 0 END) as lossTrades,
           SUM(CASE WHEN status = 'CLOSED' THEN pnl ELSE 0 END) as totalPnl,
           AVG(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as avgPnl,
           MAX(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as maxWin,
           MIN(CASE WHEN status = 'CLOSED' THEN pnl ELSE NULL END) as maxLoss
         FROM bot_orders 
         WHERE botId = ?`,
        [botId]
      );

      const stats = {
        totalTrades: result?.totalTrades || 0,
        closedTrades: result?.closedTrades || 0,
        winTrades: result?.winTrades || 0,
        lossTrades: result?.lossTrades || 0,
        totalPnl: result?.totalPnl || 0,
        avgPnl: result?.avgPnl || 0,
        maxWin: result?.maxWin || 0,
        maxLoss: result?.maxLoss || 0,
        winRate: result?.closedTrades > 0 ? (result.winTrades / result.closedTrades) * 100 : 0
      };

      return stats;

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao calcular estatísticas:', error.message);
      return {
        totalTrades: 0,
        closedTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalPnl: 0,
        avgPnl: 0,
        maxWin: 0,
        maxLoss: 0,
        winRate: 0
      };
    }
  }

  /**
   * Rastreia posições de um bot e retorna métricas de performance
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @returns {Promise<Object>} Resultado do rastreamento com métricas e posições
   */
  async trackBotPositions(botId, config) {
    try {
      Logger.debug(`📊 [POSITION_TRACKING] Rastreando posições do bot ${botId}`);

      // Busca estatísticas do bot usando bot_orders
      const stats = await this.getBotOrderStats(botId);

      // Busca todas as ordens do bot
      const allOrders = await this.getAllBotOrders(botId);

      // Busca apenas posições abertas
      const openPositions = await this.getBotOpenPositions(botId);

      // Calcula métricas de performance
      const performanceMetrics = {
        totalTrades: stats.totalTrades,
        totalPositions: allOrders.length,
        openPositions: openPositions.length,
        closedPositions: stats.closedTrades,
        winningTrades: stats.winTrades,
        losingTrades: stats.lossTrades,
        winRate: stats.winRate,
        totalPnl: stats.totalPnl,
        avgPnl: stats.avgPnl,
        maxWin: stats.maxWin,
        maxLoss: stats.maxLoss,
        profitFactor: stats.lossTrades > 0 && stats.maxLoss < 0 ?
          Math.abs(stats.winTrades * stats.maxWin / (stats.lossTrades * stats.maxLoss)) :
          stats.winTrades > 0 ? 999 : 0
      };

      // Reconstrói posições para o formato esperado (usando ordens)
      const reconstructedPositions = allOrders.map(order => ({
        symbol: order.symbol,
        side: order.side === 'BUY' ? 'LONG' : 'SHORT',
        entryPrice: order.price,
        quantity: Math.abs(order.quantity),
        pnl: order.pnl || 0,
        status: order.status,
        createdAt: order.timestamp,
        updatedAt: order.closeTime || order.timestamp
      }));

      Logger.debug(`✅ [POSITION_TRACKING] Rastreamento concluído para bot ${botId}: ${allOrders.length} ordens, PnL total: ${stats.totalPnl.toFixed(6)}`);

      return {
        performanceMetrics,
        reconstructedPositions,
        botId,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      Logger.error('❌ [POSITION_TRACKING] Erro ao rastrear posições do bot:', error.message);
      throw error;
    }
  }
}

export default PositionTrackingService;