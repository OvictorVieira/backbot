import Order from '../Backpack/Authenticated/Order.js';
import DatabaseService from './DatabaseService.js';
import Logger from '../Utils/Logger.js';

/**
 * OrdersService - Centralizador de toda lógica de criação de ordens
 * 
 * Este serviço encapsula toda a complexidade da criação de diferentes tipos de ordem,
 * sendo o único ponto no sistema responsável por interagir com a API da exchange.
 */
class OrdersService {
  /**
   * @param {Object} backpackOrderClient - Cliente da API da Backpack (Order)
   * @param {DatabaseService} dbService - Instância do DatabaseService
   */
  constructor(backpackOrderClient = null, dbService = null) {
    this.orderClient = backpackOrderClient || Order;
    this.dbService = dbService;
  }

  /**
   * Cria uma ordem de mercado
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado (ex: 'SOL_USDC')
   * @param {string} params.side - Lado da ordem ('Bid' ou 'Ask')
   * @param {string} params.quantity - Quantidade da ordem
   * @param {number} params.clientId - ID único da ordem
   * @param {string} params.apiKey - API Key da conta
   * @param {string} params.apiSecret - API Secret da conta
   * @param {Object} params.additionalParams - Parâmetros adicionais opcionais
   * @returns {Promise<Object>} Resultado da criação da ordem
   */
  async createMarketOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        clientId,
        apiKey,
        apiSecret,
        additionalParams = {}
      } = params;

      if (!symbol || !side || !quantity || !clientId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, side, quantity, clientId');
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        orderType: 'Market',
        clientId,
        timeInForce: 'IOC', // Immediate or Cancel para market orders
        selfTradePrevention: 'RejectTaker',
        ...additionalParams
      };

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem MARKET: ${symbol} ${side} ${quantity}`);
      
      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);
      
      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem MARKET criada com sucesso: ${result.id || result.orderId}`);
        
        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          orderType: 'MARKET',
          status: 'EXECUTED',
          clientId
        });
      } else {
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao criar ordem MARKET: ${result?.error}`);
      }

      return result;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao criar ordem MARKET:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Cria uma ordem limite
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado
   * @param {string} params.side - Lado da ordem
   * @param {string} params.quantity - Quantidade da ordem
   * @param {string} params.price - Preço limite da ordem
   * @param {number} params.clientId - ID único da ordem
   * @param {string} params.apiKey - API Key da conta
   * @param {string} params.apiSecret - API Secret da conta
   * @param {Object} params.additionalParams - Parâmetros adicionais opcionais
   * @returns {Promise<Object>} Resultado da criação da ordem
   */
  async createLimitOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        price,
        clientId,
        apiKey,
        apiSecret,
        additionalParams = {}
      } = params;

      if (!symbol || !side || !quantity || !price || !clientId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, side, quantity, price, clientId');
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        price: price.toString(),
        orderType: 'Limit',
        clientId,
        timeInForce: 'GTC',
        postOnly: true, // Para minimizar taxas
        selfTradePrevention: 'RejectTaker',
        ...additionalParams
      };

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem LIMIT: ${symbol} ${side} ${quantity} @ ${price}`);
      
      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);
      
      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem LIMIT criada com sucesso: ${result.id || result.orderId}`);
        
        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price,
          orderType: 'LIMIT',
          status: 'PENDING',
          clientId
        });
      } else {
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao criar ordem LIMIT: ${result?.error}`);
      }

      return result;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao criar ordem LIMIT:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Cria uma ordem de Take Profit
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado
   * @param {string} params.side - Lado da ordem (oposto à posição)
   * @param {string} params.quantity - Quantidade da ordem
   * @param {string} params.takeProfitTriggerPrice - Preço de trigger do take profit
   * @param {string} params.takeProfitLimitPrice - Preço limite do take profit
   * @param {number} params.clientId - ID único da ordem
   * @param {string} params.apiKey - API Key da conta
   * @param {string} params.apiSecret - API Secret da conta
   * @param {Object} params.additionalParams - Parâmetros adicionais opcionais
   * @returns {Promise<Object>} Resultado da criação da ordem
   */
  async createTakeProfitOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        takeProfitTriggerPrice,
        takeProfitLimitPrice,
        clientId,
        apiKey,
        apiSecret,
        additionalParams = {}
      } = params;

      if (!symbol || !side || !quantity || !takeProfitTriggerPrice || !takeProfitLimitPrice || !clientId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, side, quantity, takeProfitTriggerPrice, takeProfitLimitPrice, clientId');
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        orderType: 'Limit',
        clientId,
        timeInForce: 'GTC',
        reduceOnly: true,
        selfTradePrevention: 'RejectTaker',
        takeProfitTriggerPrice: takeProfitTriggerPrice.toString(),
        takeProfitLimitPrice: takeProfitLimitPrice.toString(),
        takeProfitTriggerBy: 'MarkPrice',
        ...additionalParams
      };

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem TAKE PROFIT: ${symbol} ${side} ${quantity} @ trigger: ${takeProfitTriggerPrice}, limit: ${takeProfitLimitPrice}`);
      
      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);
      
      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem TAKE PROFIT criada com sucesso: ${result.id || result.orderId}`);
        
        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: takeProfitLimitPrice,
          orderType: 'TAKE_PROFIT',
          status: 'PENDING',
          clientId
        });
      } else {
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao criar ordem TAKE PROFIT: ${result?.error}`);
      }

      return result;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao criar ordem TAKE PROFIT:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Cria uma ordem de Stop Loss
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado
   * @param {string} params.side - Lado da ordem (oposto à posição)
   * @param {string} params.quantity - Quantidade da ordem
   * @param {string} params.stopLossTriggerPrice - Preço de trigger do stop loss
   * @param {string} params.stopLossLimitPrice - Preço limite do stop loss (opcional, usa Market se não fornecido)
   * @param {number} params.clientId - ID único da ordem
   * @param {string} params.apiKey - API Key da conta
   * @param {string} params.apiSecret - API Secret da conta
   * @param {Object} params.additionalParams - Parâmetros adicionais opcionais
   * @returns {Promise<Object>} Resultado da criação da ordem
   */
  async createStopLossOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        stopLossTriggerPrice,
        stopLossLimitPrice = null,
        clientId,
        apiKey,
        apiSecret,
        additionalParams = {}
      } = params;

      if (!symbol || !side || !quantity || !stopLossTriggerPrice || !clientId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, side, quantity, stopLossTriggerPrice, clientId');
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        orderType: stopLossLimitPrice ? 'Limit' : 'Market',
        clientId,
        timeInForce: 'GTC',
        reduceOnly: true,
        selfTradePrevention: 'RejectTaker',
        stopLossTriggerPrice: stopLossTriggerPrice.toString(),
        stopLossTriggerBy: 'MarkPrice',
        ...additionalParams
      };

      // Adiciona limite apenas se fornecido
      if (stopLossLimitPrice) {
        orderBody.stopLossLimitPrice = stopLossLimitPrice.toString();
      }

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem STOP LOSS: ${symbol} ${side} ${quantity} @ trigger: ${stopLossTriggerPrice}${stopLossLimitPrice ? `, limit: ${stopLossLimitPrice}` : ' (MARKET)'}`);
      
      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);
      
      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem STOP LOSS criada com sucesso: ${result.id || result.orderId}`);
        
        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: stopLossLimitPrice || stopLossTriggerPrice,
          orderType: 'STOP_LOSS',
          status: 'PENDING',
          clientId
        });
      } else {
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao criar ordem STOP LOSS: ${result?.error}`);
      }

      return result;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao criar ordem STOP LOSS:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Cria uma ordem de fechamento parcial de posição
   * @param {Object} params - Parâmetros da ordem
   * @param {string} params.symbol - Símbolo do mercado
   * @param {string} params.side - Lado da ordem (oposto à posição)
   * @param {string} params.quantity - Quantidade da ordem
   * @param {string} params.price - Preço da ordem (opcional, usa Market se não fornecido)
   * @param {number} params.clientId - ID único da ordem
   * @param {string} params.apiKey - API Key da conta
   * @param {string} params.apiSecret - API Secret da conta
   * @param {Object} params.additionalParams - Parâmetros adicionais opcionais
   * @returns {Promise<Object>} Resultado da criação da ordem
   */
  async createPartialCloseOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        price = null,
        clientId,
        apiKey,
        apiSecret,
        additionalParams = {}
      } = params;

      if (!symbol || !side || !quantity || !clientId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, side, quantity, clientId');
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        orderType: price ? 'Limit' : 'Market',
        clientId,
        timeInForce: price ? 'GTC' : 'IOC',
        reduceOnly: true,
        selfTradePrevention: 'RejectTaker',
        ...additionalParams
      };

      // Adiciona preço apenas se fornecido
      if (price) {
        orderBody.price = price.toString();
        orderBody.postOnly = true; // Para minimizar taxas em ordens limit
      }

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem FECHAMENTO PARCIAL: ${symbol} ${side} ${quantity}${price ? ` @ ${price}` : ' (MARKET)'}`);
      
      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);
      
      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem FECHAMENTO PARCIAL criada com sucesso: ${result.id || result.orderId}`);
        
        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: price,
          orderType: 'PARTIAL_CLOSE',
          status: price ? 'PENDING' : 'EXECUTED',
          clientId
        });
      } else {
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao criar ordem FECHAMENTO PARCIAL: ${result?.error}`);
      }

      return result;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao criar ordem FECHAMENTO PARCIAL:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Método privado para persistir ordem no banco de dados
   * @param {Object} orderData - Dados da ordem para persistir
   * @private
   */
  async _persistOrder(orderData) {
    if (!this.dbService) {
      Logger.debug('💾 [ORDERS_SERVICE] DatabaseService não disponível, ordem não persistida');
      return;
    }

    try {
      const orderToSave = {
        externalOrderId: orderData.externalOrderId,
        symbol: orderData.symbol,
        side: orderData.side,
        quantity: orderData.quantity,
        price: orderData.price,
        orderType: orderData.orderType,
        status: orderData.status,
        clientId: orderData.clientId,
        timestamp: new Date().toISOString(),
        exchangeCreatedAt: new Date().toISOString()
      };

      await this.addOrder(orderToSave);
      Logger.debug(`💾 [ORDERS_SERVICE] Ordem persistida no banco: ${orderData.externalOrderId}`);
    } catch (error) {
      Logger.warn(`⚠️ [ORDERS_SERVICE] Falha ao persistir ordem no banco: ${error.message}`);
    }
  }

  // ============================================================================
  // MÉTODOS DE PERSISTÊNCIA (compatibilidade com o OrdersService original)
  // ============================================================================

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
        `INSERT INTO bot_orders (botId, externalOrderId, symbol, side, quantity, price, orderType, timestamp, status, clientId, exchangeCreatedAt, closePrice, closeTime, closeQuantity, closeType, pnl, pnlPct) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.botId,
          order.externalOrderId,
          order.symbol,
          order.side,
          order.quantity,
          order.price,
          order.orderType,
          order.timestamp || new Date().toISOString(),
          order.status || 'PENDING',
          order.clientId || null,
          order.exchangeCreatedAt || null,
          order.closePrice || null,
          order.closeTime || null,
          order.closeQuantity || null,
          order.closeType || null,
          order.pnl || null,
          order.pnlPct || null
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
   * Método de instância para adicionar ordem (compatibilidade)
   */
  async addOrder(order) {
    return OrdersService.addOrder(order);
  }

  // ============================================================================
  // OUTROS MÉTODOS ESTÁTICOS (mantidos para compatibilidade)
  // ============================================================================

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
   * Obtém uma ordem pelo externalOrderId
   * @param {string} externalOrderId - ID externo da ordem
   * @returns {Object|null} Ordem encontrada ou null
   */
  static async getOrderByExternalId(externalOrderId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const order = await OrdersService.dbService.get(
        'SELECT * FROM bot_orders WHERE externalOrderId = ?',
        [externalOrderId]
      );

      return order || null;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter ordem por externalOrderId ${externalOrderId}:`, error.message);
      return null;
    }
  }

  /**
   * Atualiza uma ordem pelo externalOrderId
   * @param {string} externalOrderId - ID externo da ordem
   * @param {Object} updates - Campos a serem atualizados
   * @returns {number} Número de ordens atualizadas
   */
  static async updateOrderByExternalId(externalOrderId, updates) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      // Constrói a query dinamicamente baseada nos campos fornecidos
      const updateFields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id' && key !== 'externalOrderId') { // Protege campos que não devem ser atualizados
          updateFields.push(`${key} = ?`);
          values.push(value);
        }
      }

      if (updateFields.length === 0) {
        console.warn(`⚠️ [ORDERS_SERVICE] Nenhum campo válido para atualizar`);
        return 0;
      }

      values.push(externalOrderId);
      const query = `UPDATE bot_orders SET ${updateFields.join(', ')} WHERE externalOrderId = ?`;

      const result = await OrdersService.dbService.run(query, values);

      if (result.changes > 0) {
        console.log(`✏️ [ORDERS_SERVICE] Ordem ${externalOrderId} atualizada`);
      }

      return result.changes;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao atualizar ordem ${externalOrderId}:`, error.message);
      return 0;
    }
  }

  // Outros métodos estáticos mantidos para compatibilidade...
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

  static async getAllOrders() {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const orders = await OrdersService.dbService.getAll(
        'SELECT * FROM bot_orders ORDER BY timestamp DESC'
      );

      return orders || [];
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao obter todas as ordens:`, error.message);
      return [];
    }
  }

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
   * Atualiza o status de uma ordem
   * @param {string} externalOrderId - ID externo da ordem
   * @param {string} newStatus - Novo status da ordem
   * @param {string} cancelReason - Razão do cancelamento (opcional)
   * @returns {Promise<boolean>} - True se atualizado com sucesso
   */
  static async updateOrderStatus(externalOrderId, newStatus, cancelReason = null) {
    try {
      if (!OrdersService.dbService) {
        console.warn(`⚠️ [ORDERS_SERVICE] Database não inicializado para updateOrderStatus`);
        return false;
      }

      const updateFields = ['status = ?'];
      const updateValues = [newStatus];

      // Se for cancelamento, adiciona a razão
      if (newStatus === 'CANCELLED' && cancelReason) {
        updateFields.push('closeType = ?');
        updateValues.push(cancelReason);
      }

      // Adiciona timestamp de atualização
      updateFields.push('closeTime = ?');
      updateValues.push(new Date().toISOString());

      const result = await OrdersService.dbService.run(
        `UPDATE bot_orders SET ${updateFields.join(', ')} WHERE externalOrderId = ?`,
        [...updateValues, externalOrderId]
      );

      if (result.changes > 0) {
        Logger.debug(`✅ [ORDERS_SERVICE] Status da ordem ${externalOrderId} atualizado para ${newStatus}`);
        return true;
      } else {
        Logger.warn(`⚠️ [ORDERS_SERVICE] Ordem ${externalOrderId} não encontrada para atualização`);
        return false;
      }
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao atualizar status da ordem ${externalOrderId}:`, error.message);
      return false;
    }
  }

  /**
   * Sincroniza status de ordens pendentes com a corretora
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot com API keys
   * @returns {Promise<number>} - Número de ordens sincronizadas
   */
  static async syncOrdersWithExchange(botId, config) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        Logger.warn(`⚠️ [ORDERS_SYNC] Credenciais não disponíveis para bot ${botId}`);
        return 0;
      }

      // Busca ordens pendentes no banco
      const pendingOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status IN ('PENDING', 'FILLED') 
         AND externalOrderId IS NOT NULL 
         ORDER BY timestamp DESC LIMIT 50`,
        [botId]
      );

      if (!pendingOrders || pendingOrders.length === 0) {
        Logger.debug(`📊 [ORDERS_SYNC] Nenhuma ordem pendente para bot ${botId}`);
        return 0;
      }

      Logger.debug(`🔄 [ORDERS_SYNC] Sincronizando ${pendingOrders.length} ordens para bot ${botId}`);

      const { default: Order } = await import('../Backpack/Authenticated/Order.js');
      let syncedCount = 0;

      for (const order of pendingOrders) {
        try {
          // Consulta status real na corretora
          const exchangeOrder = await Order.getOpenOrder(
            order.symbol, 
            order.externalOrderId, 
            order.clientId
          );

          if (!exchangeOrder) {
            // Ordem não encontrada na corretora - pode ter sido executada ou cancelada
            Logger.debug(`🔍 [ORDERS_SYNC] Ordem ${order.externalOrderId} não encontrada na corretora`);
            
            // Verifica no histórico de fills se foi executada
            const { default: History } = await import('../Backpack/Authenticated/History.js');
            const fills = await History.getFillHistory(
              order.symbol,
              order.externalOrderId,
              Date.now() - (24 * 60 * 60 * 1000), // últimas 24h
              Date.now(),
              10,
              0,
              null,
              'PERP',
              'desc',
              config.apiKey,
              config.apiSecret
            );

            if (fills && fills.length > 0) {
              // Ordem foi executada
              await OrdersService.updateOrderStatus(order.externalOrderId, 'FILLED', 'EXCHANGE_EXECUTED');
              Logger.info(`✅ [ORDERS_SYNC] Ordem ${order.externalOrderId} marcada como FILLED`);
              syncedCount++;
            } else {
              // Ordem foi cancelada
              await OrdersService.updateOrderStatus(order.externalOrderId, 'CANCELLED', 'EXCHANGE_CANCELLED');
              Logger.info(`❌ [ORDERS_SYNC] Ordem ${order.externalOrderId} marcada como CANCELLED`);
              syncedCount++;
            }
          } else {
            // Ordem ainda está ativa na corretora
            const exchangeStatus = exchangeOrder.status;
            
            if (exchangeStatus === 'Filled' && order.status !== 'FILLED') {
              await OrdersService.updateOrderStatus(order.externalOrderId, 'FILLED', 'EXCHANGE_EXECUTED');
              Logger.info(`✅ [ORDERS_SYNC] Ordem ${order.externalOrderId} atualizada para FILLED`);
              syncedCount++;
            } else if (['Cancelled', 'Rejected'].includes(exchangeStatus) && order.status !== 'CANCELLED') {
              await OrdersService.updateOrderStatus(order.externalOrderId, 'CANCELLED', 'EXCHANGE_CANCELLED');
              Logger.info(`❌ [ORDERS_SYNC] Ordem ${order.externalOrderId} atualizada para CANCELLED`);
              syncedCount++;
            }
          }

          // Delay para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (orderError) {
          Logger.warn(`⚠️ [ORDERS_SYNC] Erro ao sincronizar ordem ${order.externalOrderId}: ${orderError.message}`);
        }
      }

      Logger.info(`📊 [ORDERS_SYNC] Bot ${botId}: ${syncedCount} ordens sincronizadas`);
      return syncedCount;

    } catch (error) {
      Logger.error(`❌ [ORDERS_SYNC] Erro na sincronização do bot ${botId}:`, error.message);
      return 0;
    }
  }

  /**
   * Calcula P&L para ordens FILLED que ainda não têm P&L calculado
   * @param {number} botId - ID do bot
   * @param {object} config - Configuração do bot
   * @returns {Promise<number>} - Número de ordens processadas
   */
  static async calculatePnLForFilledOrders(botId, config) {
    try {
      if (!config?.apiKey || !config?.apiSecret) {
        Logger.warn(`⚠️ [PNL_CALC] Credenciais não disponíveis para bot ${botId}`);
        return 0;
      }

      // Busca ordens FILLED sem P&L calculado
      const filledOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status = 'FILLED' 
         AND (pnl IS NULL OR closePrice IS NULL)
         ORDER BY timestamp ASC`,
        [botId]
      );

      if (!filledOrders || filledOrders.length === 0) {
        Logger.debug(`📊 [PNL_CALC] Nenhuma ordem FILLED sem P&L para bot ${botId}`);
        return 0;
      }

      Logger.debug(`🧮 [PNL_CALC] Calculando P&L para ${filledOrders.length} ordens do bot ${botId}`);

      const { default: History } = await import('../Backpack/Authenticated/History.js');
      let processedCount = 0;

      for (const order of filledOrders) {
        try {
          // Busca fills desta ordem específica
          const fills = await History.getFillHistory(
            order.symbol,
            order.externalOrderId,
            Date.now() - (7 * 24 * 60 * 60 * 1000), // últimos 7 dias
            Date.now(),
            100,
            0,
            null,
            'PERP',
            'desc',
            config.apiKey,
            config.apiSecret
          );

          if (fills && fills.length > 0) {
            // Calcula P&L baseado nos fills
            let totalPnl = 0;
            let totalQuantity = 0;
            let weightedPrice = 0;
            let lastFillPrice = 0;

            for (const fill of fills) {
              if (fill.orderId === order.externalOrderId) {
                const fillQuantity = Math.abs(parseFloat(fill.quantity));
                const fillPrice = parseFloat(fill.price);
                
                totalQuantity += fillQuantity;
                weightedPrice += fillPrice * fillQuantity;
                lastFillPrice = fillPrice;
              }
            }

            if (totalQuantity > 0) {
              const avgExecutionPrice = weightedPrice / totalQuantity;
              
              // Para cálculo simplificado, usa-se a diferença entre preço de entrada e atual
              // Em um sistema mais sofisticado, seria necessário rastrear pares de entrada/saída
              const entryPrice = parseFloat(order.price);
              const executionPrice = avgExecutionPrice;
              
              // Calcula P&L básico (será refinado quando implementarmos tracking completo)
              const pnlEstimate = (executionPrice - entryPrice) * totalQuantity;
              
              // Atualiza a ordem com os dados calculados
              await OrdersService.dbService.run(
                `UPDATE bot_orders SET 
                 closePrice = ?, 
                 closeTime = ?, 
                 closeQuantity = ?,
                 pnl = ?,
                 pnlPct = ?,
                 status = 'CLOSED'
                 WHERE id = ?`,
                [
                  avgExecutionPrice,
                  new Date().toISOString(),
                  totalQuantity,
                  pnlEstimate,
                  entryPrice > 0 ? (pnlEstimate / (entryPrice * totalQuantity)) * 100 : 0,
                  order.id
                ]
              );

              Logger.info(`✅ [PNL_CALC] Ordem ${order.externalOrderId} atualizada com P&L: ${pnlEstimate.toFixed(4)}`);
              processedCount++;
            }
          }

          // Delay para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (orderError) {
          Logger.warn(`⚠️ [PNL_CALC] Erro ao processar ordem ${order.externalOrderId}: ${orderError.message}`);
        }
      }

      Logger.info(`📊 [PNL_CALC] Bot ${botId}: ${processedCount} ordens processadas com P&L`);
      return processedCount;

    } catch (error) {
      Logger.error(`❌ [PNL_CALC] Erro no cálculo de P&L do bot ${botId}:`, error.message);
      return 0;
    }
  }
}

export default OrdersService;