import DatabaseService from './DatabaseService.js';

class OrdersService {
  static dbService = null;

  /**
   * Inicializa o serviço com o DatabaseService
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  static init(dbService) {
    OrdersService.dbService = dbService;
  }

  /**
   * Adiciona uma nova ordem
   * @param {Object} order - Dados da ordem
   * @returns {Object} Ordem salva
   */
  static async addOrder(order) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const result = await OrdersService.dbService.run(
        `INSERT INTO bot_orders (botId, externalOrderId, symbol, side, quantity, price, orderType, timestamp, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.botId,
          order.externalOrderId,
          order.symbol,
          order.side,
          order.quantity,
          order.price,
          order.orderType,
          order.timestamp || new Date().toISOString(),
          order.status || 'PENDING'
        ]
      );

      console.log(`✅ [ORDERS_SERVICE] Ordem adicionada: ${order.symbol} ${order.side} ${order.quantity}`);
      return { ...order, id: result.lastID };
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao adicionar ordem:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém ordens de um bot específico
   * @param {number} botId - ID do bot
   * @returns {Array} Array de ordens do bot
   */
  static async getOrdersByBotId(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders WHERE botId = ? ORDER BY timestamp DESC',
        [botId]
      );

      return orders;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordens do bot ${botId}:`, error.message);
      return [];
    }
  }

  /**
   * Obtém ordens de um símbolo específico
   * @param {string} symbol - Símbolo do mercado
   * @returns {Array} Array de ordens do símbolo
   */
  static async getOrdersBySymbol(symbol) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders WHERE symbol = ? ORDER BY timestamp DESC',
        [symbol]
      );

      return orders;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordens do símbolo ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Obtém ordens por período
   * @param {Date} startDate - Data de início
   * @param {Date} endDate - Data de fim
   * @returns {Array} Array de ordens no período
   */
  static async getOrdersByPeriod(startDate, endDate) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC',
        [startDate.toISOString(), endDate.toISOString()]
      );

      return orders;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordens por período:`, error.message);
      return [];
    }
  }

  /**
   * Obtém estatísticas das ordens
   * @returns {Object} Estatísticas das ordens
   */
  static async getStats() {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll('SELECT * FROM bot_orders');
      
      if (orders.length === 0) {
        return {
          total: 0,
          byBot: {},
          bySymbol: {},
          byType: {},
          bySide: {}
        };
      }

      // Estatísticas por bot
      const byBot = {};
      const bySymbol = {};
      const byType = {};
      const bySide = {};
      
      orders.forEach(order => {
        // Por bot
        byBot[order.botId] = (byBot[order.botId] || 0) + 1;
        
        // Por símbolo
        bySymbol[order.symbol] = (bySymbol[order.symbol] || 0) + 1;
        
        // Por tipo
        byType[order.orderType] = (byType[order.orderType] || 0) + 1;
        
        // Por lado
        bySide[order.side] = (bySide[order.side] || 0) + 1;
      });
      
      return {
        total: orders.length,
        byBot,
        bySymbol,
        byType,
        bySide,
        oldestOrder: orders.reduce((oldest, order) => 
          new Date(order.timestamp) < new Date(oldest.timestamp) ? order : oldest
        ),
        newestOrder: orders.reduce((newest, order) => 
          new Date(order.timestamp) > new Date(newest.timestamp) ? order : newest
        )
      };
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter estatísticas:`, error.message);
      return {
        total: 0,
        byBot: {},
        bySymbol: {},
        byType: {},
        bySide: {}
      };
    }
  }

  /**
   * Remove ordens antigas (mais de X dias)
   * @param {number} daysToKeep - Número de dias para manter
   * @returns {number} Número de ordens removidas
   */
  static async cleanupOldOrders(daysToKeep = 30) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await OrdersService.dbService.run(
        'DELETE FROM bot_orders WHERE timestamp < ?',
        [cutoffDate.toISOString()]
      );

      if (result.changes > 0) {
        console.log(`🧹 [ORDERS_SERVICE] ${result.changes} ordens antigas removidas`);
      }

      return result.changes;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao limpar ordens antigas:`, error.message);
      return 0;
    }
  }

  /**
   * Remove todas as ordens
   * @returns {number} Número de ordens removidas
   */
  static async clearAllOrders() {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const result = await OrdersService.dbService.run('DELETE FROM bot_orders');
      
      console.log(`🧹 [ORDERS_SERVICE] Todas as ${result.changes} ordens removidas`);
      return result.changes;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao limpar todas as ordens:`, error.message);
      return 0;
    }
  }

  /**
   * Remove ordens de um bot específico
   * @param {number} botId - ID do bot
   * @returns {number} Número de ordens removidas
   */
  static async clearOrdersByBotId(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const result = await OrdersService.dbService.run(
        'DELETE FROM bot_orders WHERE botId = ?',
        [botId]
      );

      if (result.changes > 0) {
        console.log(`🧹 [ORDERS_SERVICE] ${result.changes} ordens do bot ${botId} removidas`);
      }

      return result.changes;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao limpar ordens do bot ${botId}:`, error.message);
      return 0;
    }
  }

  /**
   * Obtém a última ordem de um bot
   * @param {number} botId - ID do bot
   * @returns {Object|null} Última ordem ou null
   */
  static async getLastOrderByBotId(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const order = await OrdersService.dbService.get(
        'SELECT * FROM bot_orders WHERE botId = ? ORDER BY timestamp DESC LIMIT 1',
        [botId]
      );

      return order || null;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter última ordem do bot ${botId}:`, error.message);
      return null;
    }
  }

  /**
   * Obtém ordens por tipo
   * @param {string} orderType - Tipo da ordem (LIMIT, MARKET, etc.)
   * @returns {Array} Array de ordens do tipo
   */
  static async getOrdersByType(orderType) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders WHERE orderType = ? ORDER BY timestamp DESC',
        [orderType]
      );

      return orders;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordens por tipo ${orderType}:`, error.message);
      return [];
    }
  }

  /**
   * Obtém ordens por lado
   * @param {string} side - Lado da ordem (BUY, SELL)
   * @returns {Array} Array de ordens do lado
   */
  static async getOrdersBySide(side) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders WHERE side = ? ORDER BY timestamp DESC',
        [side]
      );

      return orders;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordens por lado ${side}:`, error.message);
      return [];
    }
  }
}

export default OrdersService;
