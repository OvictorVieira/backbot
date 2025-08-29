import Order from '../Backpack/Authenticated/Order.js';
import Futures from '../Backpack/Authenticated/Futures.js';
import History from '../Backpack/Authenticated/History.js';
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
   * Aguarda um tempo determinado para evitar rate limiting
   * @param {number} ms - Tempo em milissegundos para aguardar
   */
  static async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getOpenOrder(symbol, externalOrderId, apiKey, apiSecret) {
    if (!symbol || !apiKey || !apiSecret) {
      throw new Error('Parâmetros obrigatórios faltando: symbol, apiKey, apiSecret');
    }
    try {
      const openOrder = await this.orderClient.getOpenOrder(
        symbol,
        externalOrderId,
        null,
        apiKey,
        apiSecret
      );
      if (!openOrder) {
        throw new Error('Ordem não encontrada');
      }

      return openOrder;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SERVICE] Erro ao buscar ordem: ${error.message}`);
      return null;
    }
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
      const { symbol, side, quantity, clientId, apiKey, apiSecret, additionalParams = {} } = params;

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
        ...additionalParams,
      };

      Logger.info(`📦 [ORDERS_SERVICE] Criando ordem MARKET: ${symbol} ${side} ${quantity}`);

      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      if (result && !result.error) {
        Logger.info(
          `✅ [ORDERS_SERVICE] Ordem MARKET criada com sucesso: ${result.id || result.orderId}`
        );

        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          orderType: 'MARKET',
          status: 'EXECUTED',
          clientId,
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
        additionalParams = {},
      } = params;

      if (!symbol || !side || !quantity || !price || !clientId) {
        throw new Error(
          'Parâmetros obrigatórios faltando: symbol, side, quantity, price, clientId'
        );
      }

      const orderBody = {
        symbol,
        side,
        quantity: quantity.toString(),
        price: price.toString(),
        orderType: 'Limit',
        clientId,
        timeInForce: 'GTC',
        postOnly: true,
        selfTradePrevention: 'RejectTaker',
        ...additionalParams,
      };

      Logger.info(
        `📦 [ORDERS_SERVICE] Criando ordem LIMIT: ${symbol} ${side} ${quantity} @ ${price}`
      );

      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      if (result && !result.error) {
        Logger.info(
          `✅ [ORDERS_SERVICE] Ordem LIMIT criada com sucesso: ${result.id || result.orderId}`
        );

        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price,
          orderType: 'LIMIT',
          status: 'PENDING',
          clientId,
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
        additionalParams = {},
      } = params;

      if (
        !symbol ||
        !side ||
        !quantity ||
        !takeProfitTriggerPrice ||
        !takeProfitLimitPrice ||
        !clientId
      ) {
        throw new Error(
          'Parâmetros obrigatórios faltando: symbol, side, quantity, takeProfitTriggerPrice, takeProfitLimitPrice, clientId'
        );
      }

      // 🔍 PRIMEIRA VERIFICAÇÃO: Consulta a exchange para verificar se já existe ordem de take profit
      Logger.debug(
        `🔍 [ORDERS_SERVICE] Verificando ordens existentes na exchange para ${symbol}...`
      );

      try {
        const existingOrders = await this.orderClient.getOpenOrders(
          symbol,
          null,
          apiKey,
          apiSecret
        );

        if (existingOrders && Array.isArray(existingOrders)) {
          // Filtra ordens de take profit existentes
          const existingTakeProfit = existingOrders.filter(
            order =>
              order.takeProfitTriggerPrice &&
              order.status === 'Pending' &&
              order.reduceOnly === true
          );

          if (existingTakeProfit.length > 0) {
            Logger.info(
              `⚠️ [ORDERS_SERVICE] ${symbol}: Já existe(m) ${existingTakeProfit.length} ordem(ns) de take profit na exchange. Cancelando criação.`
            );
            Logger.debug(
              `📋 [ORDERS_SERVICE] Ordens existentes:`,
              existingTakeProfit.map(o => ({
                id: o.id,
                triggerPrice: o.takeProfitTriggerPrice,
                limitPrice: o.takeProfitLimitPrice,
                quantity: o.quantity,
              }))
            );

            return {
              success: false,
              message: 'Take profit já existe na exchange',
              existingOrders: existingTakeProfit.length,
            };
          }
        }
      } catch (exchangeError) {
        Logger.warn(
          `⚠️ [ORDERS_SERVICE] Erro ao verificar ordens existentes na exchange: ${exchangeError.message}. Continuando com criação...`
        );
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
        ...additionalParams,
      };

      Logger.info(
        `📦 [ORDERS_SERVICE] Criando ordem TAKE PROFIT: ${symbol} ${side} ${quantity} @ trigger: ${takeProfitTriggerPrice}, limit: ${takeProfitLimitPrice}`
      );

      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      if (result && !result.error) {
        Logger.info(
          `✅ [ORDERS_SERVICE] Ordem TAKE PROFIT criada com sucesso: ${result.id || result.orderId}`
        );

        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: takeProfitLimitPrice,
          orderType: 'TAKE_PROFIT',
          status: 'PENDING',
          clientId,
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

  async createStopLossOrder(params) {
    try {
      const {
        symbol,
        side,
        quantity,
        stopLossTriggerPrice,
        stopLossLimitPrice = null,
        _orderType,
        clientId,
        apiKey,
        apiSecret,
      } = params;

      if (!symbol || !side || !quantity || !stopLossTriggerPrice || !clientId) {
        throw new Error(
          'Parâmetros obrigatórios faltando: symbol, side, quantity, stopLossTriggerPrice, clientId'
        );
      }

      const orderBody = {
        symbol,
        side,
        orderType: 'Market',
        reduceOnly: true,
        quantity: quantity.toString(),
        triggerPrice: stopLossTriggerPrice.toString(),
        triggerQuantity: quantity.toString(),
        timeInForce: 'GTC',
        clientId,
      };

      Logger.info(
        `📦 [ORDERS_SERVICE] Criando ordem STOP LOSS: ${symbol} ${side} ${quantity} @ trigger: ${stopLossTriggerPrice}${stopLossLimitPrice ? `, limit: ${stopLossLimitPrice}` : ' (MARKET)'}`
      );

      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      if (result && !result.error) {
        Logger.info(
          `✅ [ORDERS_SERVICE] Ordem STOP LOSS criada com sucesso: ${result.id || result.orderId}`
        );

        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: stopLossLimitPrice || stopLossTriggerPrice,
          orderType: 'STOP_LOSS',
          status: 'PENDING',
          clientId,
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

  async cancelOrder(params) {
    try {
      const {
        symbol,
        orderId,
        cancelReason = 'Trailing Stop Atualizado',
        apiKey,
        apiSecret,
      } = params;

      // 1. Validação dos parâmetros essenciais
      if (!symbol || !orderId) {
        throw new Error('Parâmetros obrigatórios faltando: symbol, orderId');
      }

      Logger.info(
        `📦 [ORDERS_SERVICE] Solicitando cancelamento da ordem: ${orderId} para o símbolo ${symbol}`
      );

      // 2. Chama o método do cliente de baixo nível para interagir com a API
      const result = await this.orderClient.cancelOpenOrder(
        symbol,
        orderId,
        null,
        apiKey,
        apiSecret
      );

      if (result && !result.error) {
        Logger.info(`✅ [ORDERS_SERVICE] Ordem ${orderId} cancelada com sucesso na corretora.`);

        // 3. Persiste a mudança de status no seu banco de dados usando o método estático
        await OrdersService.updateOrderStatus(orderId, 'CANCELLED', cancelReason);
      } else {
        const errorMessage = result?.error || 'Erro desconhecido da API';
        Logger.error(`❌ [ORDERS_SERVICE] Falha ao cancelar ordem ${orderId}:`, errorMessage);
      }

      return result;
    } catch (error) {
      Logger.error(
        `❌ [ORDERS_SERVICE] Erro crítico ao cancelar ordem ${params.orderId}:`,
        error.message
      );
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
        additionalParams = {},
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
        ...additionalParams,
      };

      // Adiciona preço apenas se fornecido
      if (price) {
        orderBody.price = price.toString();
        orderBody.postOnly = true; // Para minimizar taxas em ordens limit
      }

      Logger.info(
        `📦 [ORDERS_SERVICE] Criando ordem FECHAMENTO PARCIAL: ${symbol} ${side} ${quantity}${price ? ` @ ${price}` : ' (MARKET)'}`
      );

      const result = await this.orderClient.executeOrder(orderBody, apiKey, apiSecret);

      if (result && !result.error) {
        Logger.info(
          `✅ [ORDERS_SERVICE] Ordem FECHAMENTO PARCIAL criada com sucesso: ${result.id || result.orderId}`
        );

        // Persiste a ordem no banco se dbService estiver disponível
        await this._persistOrder({
          externalOrderId: result.id || result.orderId,
          symbol,
          side,
          quantity,
          price: price,
          orderType: 'PARTIAL_CLOSE',
          status: price ? 'PENDING' : 'EXECUTED',
          clientId,
        });
      } else {
        Logger.error(
          `❌ [ORDERS_SERVICE] Falha ao criar ordem FECHAMENTO PARCIAL: ${result?.error}`
        );
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
        exchangeCreatedAt: new Date().toISOString(),
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
          order.pnlPct || null,
        ]
      );

      console.log(
        `✅ [ORDERS_SERVICE] Ordem adicionada: ${order.symbol} ${order.side} ${order.quantity}`
      );
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
      console.error(
        `❌ [ORDERS_SERVICE] Erro ao obter ordem por externalOrderId ${externalOrderId}:`,
        error.message
      );
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
        if (key !== 'id' && key !== 'externalOrderId') {
          // Protege campos que não devem ser atualizados
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
      console.error(
        `❌ [ORDERS_SERVICE] Erro ao atualizar ordem ${externalOrderId}:`,
        error.message
      );
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
      console.error(
        `❌ [ORDERS_SERVICE] Erro ao obter ordens do símbolo ${symbol}:`,
        error.message
      );
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
   * Remove todas as ordens de um bot específico
   * @param {number} botId - ID do bot
   * @returns {Promise<number>} Número de ordens removidas
   */
  static async removeOrdersByBotId(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.isInitialized()) {
        throw new Error('Database service not initialized');
      }

      const result = await OrdersService.dbService.run('DELETE FROM bot_orders WHERE botId = ?', [
        botId,
      ]);

      console.log(`🧹 [ORDERS_SERVICE] ${result.changes} ordens do bot ${botId} removidas`);
      return result.changes;
    } catch (error) {
      console.error(`❌ [ORDERS_SERVICE] Erro ao remover ordens do bot ${botId}:`, error.message);
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
        Logger.debug(
          `✅ [ORDERS_SERVICE] Status da ordem ${externalOrderId} atualizado para ${newStatus}`
        );
        return true;
      } else {
        Logger.warn(`⚠️ [ORDERS_SERVICE] Ordem ${externalOrderId} não encontrada para atualização`);
        return false;
      }
    } catch (error) {
      Logger.error(
        `❌ [ORDERS_SERVICE] Erro ao atualizar status da ordem ${externalOrderId}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Sincroniza todas as ordens do bot com a corretora (fonte da verdade)
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

      Logger.info(
        `🔄 [ORDERS_SYNC] Iniciando sincronização completa com corretora para bot ${botId}`
      );

      // ETAPA 1: Buscar TODAS as ordens ativas na corretora (fonte da verdade)
      const { default: Order } = await import('../Backpack/Authenticated/Order.js');
      const exchangeOrders = await Order.getOpenOrders(
        null,
        'PERP',
        config.apiKey,
        config.apiSecret
      );

      if (!exchangeOrders) {
        Logger.warn(
          `⚠️ [ORDERS_SYNC] Não foi possível buscar ordens da corretora para bot ${botId}`
        );
        return 0;
      }

      // Filtra apenas ordens do bot usando clientId
      const botClientOrderId = config.botClientOrderId?.toString() || '';
      const botExchangeOrders = exchangeOrders.filter(order => {
        const clientId = order.clientId?.toString() || '';
        return clientId.startsWith(botClientOrderId);
      });

      Logger.debug(
        `📊 [ORDERS_SYNC] Encontradas ${botExchangeOrders.length} ordens ativas na corretora para bot ${botId}`
      );

      // Log das ordens encontradas na corretora para debug
      botExchangeOrders.forEach(order => {
        Logger.debug(
          `🔍 [EXCHANGE] Ordem: ${order.id}, ClientId: ${order.clientId}, Symbol: ${order.symbol}, Status: ${order.status}`
        );
      });

      // ETAPA 2: Buscar todas as ordens do bot no nosso banco que não estão CLOSED
      const ourOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status != 'CLOSED' 
         AND externalOrderId IS NOT NULL`,
        [botId]
      );

      Logger.debug(
        `📊 [ORDERS_SYNC] Encontradas ${ourOrders.length} ordens não-CLOSED no nosso banco para bot ${botId}`
      );

      // Log das ordens do nosso banco para debug
      ourOrders.forEach(order => {
        Logger.debug(
          `🔍 [OUR_DB] Ordem: ${order.externalOrderId}, ClientId: ${order.clientId}, Symbol: ${order.symbol}, Status: ${order.status}`
        );
      });

      let syncedCount = 0;

      // ETAPA 3: Criar mapa das ordens da corretora por ID e clientId
      const exchangeOrdersMapById = new Map();
      const exchangeOrdersMapByClientId = new Map();

      botExchangeOrders.forEach(order => {
        if (order.id) {
          exchangeOrdersMapById.set(order.id, order);
        }
        if (order.clientId) {
          exchangeOrdersMapByClientId.set(order.clientId.toString(), order);
        }
      });

      Logger.debug(
        `🔍 [ORDERS_SYNC] Mapeadas ${exchangeOrdersMapById.size} ordens por ID e ${exchangeOrdersMapByClientId.size} por clientId`
      );

      // ETAPA 4: Sincronizar ordens do nosso banco com a corretora
      Logger.info(
        `🔄 [ORDERS_SYNC] Iniciando sincronização de ${ourOrders.length} ordens com delays para evitar rate limiting`
      );

      const closedPositionsCount = await OrdersService.syncPositionsFromExchangeFills(
        botId,
        config
      );

      Logger.info(
        `📊 [ORDERS_SYNC] Bot ${botId}: ${syncedCount} ordens sincronizadas, ${closedPositionsCount} posições fechadas`
      );

      for (let i = 0; i < ourOrders.length; i++) {
        const ourOrder = ourOrders[i];
        try {
          // Tentar encontrar a ordem na corretora por externalOrderId primeiro, depois por clientId
          let exchangeOrder = exchangeOrdersMapById.get(ourOrder.externalOrderId);

          if (!exchangeOrder && ourOrder.clientId) {
            exchangeOrder = exchangeOrdersMapByClientId.get(ourOrder.clientId.toString());
          }

          Logger.debug(
            `🔍 [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId} (clientId: ${ourOrder.clientId}): ${exchangeOrder ? 'Encontrada' : 'Não encontrada'} na corretora`
          );

          if (exchangeOrder) {
            // Ordem existe na corretora - sincronizar status
            const exchangeStatus = exchangeOrder.status;
            let ourStatus = 'PENDING'; // Default

            // Mapear status da corretora para nosso formato
            switch (exchangeStatus) {
              case 'Open':
              case 'New':
                ourStatus = 'PENDING';
                break;
              case 'Filled':
                ourStatus = 'FILLED';
                break;
              case 'Cancelled':
              case 'Rejected':
                ourStatus = 'CANCELLED';
                break;
              case 'PartiallyFilled':
                ourStatus = 'FILLED'; // Consideramos como preenchida
                break;
            }

            // Atualizar se houver diferença
            if (ourOrder.status !== ourStatus) {
              await OrdersService.updateOrderStatus(
                ourOrder.externalOrderId,
                ourStatus,
                'EXCHANGE_SYNC'
              );
              Logger.info(
                `🔄 [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId}: ${ourOrder.status} → ${ourStatus}`
              );
              syncedCount++;
            }
          } else {
            // Ordem NÃO existe na corretora - pode ter sido executada ou cancelada
            Logger.debug(
              `❌ [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId} não encontrada nas ordens abertas da corretora`
            );

            // NOVA LÓGICA: Se a ordem já está FILLED, não alterar (posição já aberta)
            if (ourOrder.status === 'FILLED') {
              Logger.debug(
                `ℹ️ [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId} já está FILLED - mantendo status (posição aberta)`
              );
              continue;
            }

            // Fila global agora coordena os delays - não precisa de delay manual aqui

            // Buscar status real da ordem na corretora (sabemos que está PENDING no nosso lado)
            const { default: History } = await import('../Backpack/Authenticated/History.js');
            // Buscar histórico da ordem (fila global coordena rate limiting)
            const orderHistory = await History.getOrderHistory(
              ourOrder.externalOrderId, // orderId - ID da ordem específica
              ourOrder.symbol, // symbol - símbolo do par
              10, // limit
              0, // offset
              'PERP', // marketType
              null, // sortDirection
              config.apiKey,
              config.apiSecret
            );

            // Se retornou null, a fila global já lidou com rate limiting
            if (orderHistory === null) {
              Logger.warn(
                `⚠️ [ORDERS_SYNC] Histórico não disponível para ordem ${ourOrder.externalOrderId} - mantendo PENDING`
              );
              continue;
            }

            if (orderHistory && Array.isArray(orderHistory) && orderHistory.length > 0) {
              const orderRecord = orderHistory.find(order => order.id === ourOrder.externalOrderId);

              if (orderRecord) {
                Logger.debug(
                  `🔍 [ORDERS_SYNC] Status real da ordem ${ourOrder.externalOrderId} na corretora: ${orderRecord.status}`
                );

                // Sincronizar nosso status com o da corretora
                if (orderRecord.status === 'Filled' || orderRecord.status === 'PartiallyFilled') {
                  await OrdersService.updateOrderStatus(
                    ourOrder.externalOrderId,
                    'FILLED',
                    'EXCHANGE_EXECUTED'
                  );
                  Logger.info(
                    `✅ [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId}: PENDING → FILLED`
                  );
                  syncedCount++;
                } else if (
                  orderRecord.status === 'Cancelled' ||
                  orderRecord.status === 'Rejected'
                ) {
                  await OrdersService.updateOrderStatus(
                    ourOrder.externalOrderId,
                    'CANCELLED',
                    'EXCHANGE_CANCELLED'
                  );
                  Logger.info(
                    `❌ [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId}: PENDING → CANCELLED`
                  );
                  syncedCount++;
                }
                // Se for 'Open' ou 'New', mantém PENDING (está correto)
              } else {
                Logger.warn(
                  `⚠️ [ORDERS_SYNC] Ordem ${ourOrder.externalOrderId} não encontrada no histórico da corretora`
                );
              }
            } else if (orderHistory === null) {
              Logger.warn(
                `⚠️ [ORDERS_SYNC] Erro ao buscar histórico da ordem ${ourOrder.externalOrderId} - mantendo PENDING`
              );
            } else {
              Logger.warn(
                `⚠️ [ORDERS_SYNC] Histórico vazio para ordem ${ourOrder.externalOrderId}`
              );
            }
          }
        } catch (orderError) {
          Logger.warn(
            `⚠️ [ORDERS_SYNC] Erro ao sincronizar ordem ${ourOrder.externalOrderId}: ${orderError.message}`
          );
        }

        // Fila global agora coordena os delays - removemos delays manuais
        Logger.debug(`🔄 [ORDERS_SYNC] Ordem processada (${i + 1}/${ourOrders.length})`);
      }

      return syncedCount + closedPositionsCount;
    } catch (error) {
      Logger.error(`❌ [ORDERS_SYNC] Erro na sincronização do bot ${botId}:`, error.message);
      return 0;
    }
  }

  /**
   * FUNÇÃO REMOVIDA - estava marcando incorretamente ordens FILLED como CLOSED
   * P&L será calculado apenas quando a posição for realmente fechada na corretora
   * @deprecated
   */
  static async detectAndCloseCompletedPositions(botId, config) {
    try {
      Logger.debug(`🔍 [POSITION_CLOSE] Iniciando detecção de posições fechadas para bot ${botId}`);

      const openPositionsFromExchange = await Futures.getOpenPositions(
        config.apiKey,
        config.apiSecret
      );
      if (!openPositionsFromExchange) {
        Logger.warn(
          `⚠️ [POSITION_CLOSE] Não foi possível buscar posições abertas da corretora para bot ${botId}`
        );
        return 0;
      }

      Logger.debug(
        `📊 [POSITION_CLOSE] Posições abertas na corretora: ${openPositionsFromExchange.length}`
      );
      openPositionsFromExchange.forEach(pos => {
        Logger.debug(`🔍 [EXCHANGE_POS] ${pos.symbol}: ${pos.size} @ ${pos.averageEntryPrice}`);
      });

      const exchangeSymbolsWithPositions = new Set(
        openPositionsFromExchange.map(pos => pos.symbol)
      );

      const filledOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status = 'FILLED' 
         ORDER BY symbol, timestamp`,
        [botId]
      );

      Logger.debug(`📊 [POSITION_CLOSE] Ordens FILLED no banco: ${filledOrders.length}`);

      const positionGroups = new Map();
      filledOrders.forEach(order => {
        if (!positionGroups.has(order.symbol)) {
          positionGroups.set(order.symbol, []);
        }
        positionGroups.get(order.symbol).push(order);
      });

      Logger.debug(
        `📊 [POSITION_CLOSE] Símbolos com ordens FILLED: ${Array.from(positionGroups.keys()).join(', ')}`
      );
      Logger.debug(
        `📊 [POSITION_CLOSE] Símbolos com posições abertas: ${Array.from(exchangeSymbolsWithPositions).join(', ')}`
      );

      let closedCount = 0;

      for (const [symbol, orders] of positionGroups.entries()) {
        Logger.debug(`🔍 [POSITION_CLOSE] Analisando ${symbol}: ${orders.length} ordens`);

        if (exchangeSymbolsWithPositions.has(symbol)) {
          Logger.debug(`ℹ️ [POSITION_CLOSE] ${symbol} tem posição aberta na corretora - pulando`);
          continue;
        }

        Logger.debug(
          `🔍 [POSITION_CLOSE] ${symbol} NÃO tem posição aberta - verificando se pode fechar`
        );

        const position = OrdersService.calculatePositionPnL(orders);
        Logger.debug(
          `📊 [POSITION_CLOSE] ${symbol} - Quantidade: ${position.totalQuantity}, P&L: ${position.totalPnL}, Fechada: ${position.isClosed}`
        );

        if (position.isClosed) {
          Logger.info(
            `✅ [POSITION_CLOSE] Fechando posição ${symbol} - P&L: ${position.totalPnL.toFixed(4)} USDC`
          );

          for (const order of orders) {
            const pnlForOrder =
              orders.length > 1
                ? (position.totalPnL * parseFloat(order.quantity)) /
                  Math.abs(position.totalQuantity)
                : position.totalPnL;

            await OrdersService.dbService.run(
              `UPDATE bot_orders 
               SET status = 'CLOSED', pnl = ?, closeTime = ?, closeType = 'POSITION_CLOSED'
               WHERE externalOrderId = ?`,
              [pnlForOrder, new Date().toISOString(), order.externalOrderId]
            );

            Logger.debug(
              `📊 [POSITION_CLOSE] Ordem ${order.externalOrderId} marcada como CLOSED com P&L: ${pnlForOrder}`
            );
          }

          closedCount++;
        } else {
          Logger.debug(
            `ℹ️ [POSITION_CLOSE] ${symbol} não está fechada (quantidade: ${position.totalQuantity})`
          );
        }
      }

      Logger.info(`📊 [POSITION_CLOSE] Bot ${botId}: ${closedCount} posições fechadas`);
      return closedCount;
    } catch (error) {
      Logger.error(`❌ [POSITION_CLOSE] Erro ao detectar posições fechadas:`, error.message);
      return 0;
    }
  }

  static calculatePositionPnL(orders) {
    let netQuantity = 0;
    let totalCost = 0;
    let totalPnL = 0;

    orders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    Logger.debug(`🔢 [PNL_CALC] Calculando P&L para ${orders.length} ordens:`);
    orders.forEach(order => {
      Logger.debug(`  ${order.side} ${order.quantity} @ ${order.price} (${order.timestamp})`);
    });

    for (const order of orders) {
      const quantity = parseFloat(order.quantity);
      const price = parseFloat(order.price);
      const orderValue = quantity * price;

      if (order.side === 'BUY') {
        netQuantity += quantity;
        totalCost += orderValue;
        Logger.debug(`  BUY: +${quantity}, netQty: ${netQuantity}, totalCost: ${totalCost}`);
      } else {
        const avgCostPrice = netQuantity > 0 ? totalCost / netQuantity : 0;
        const pnlFromSell = (price - avgCostPrice) * quantity;
        totalPnL += pnlFromSell;

        netQuantity -= quantity;
        if (netQuantity > 0) {
          totalCost = (totalCost / (netQuantity + quantity)) * netQuantity;
        } else {
          totalCost = 0;
        }
        Logger.debug(
          `  SELL: -${quantity}, avgCost: ${avgCostPrice}, sellPrice: ${price}, pnl: ${pnlFromSell}, netQty: ${netQuantity}`
        );
      }
    }

    const result = {
      totalQuantity: netQuantity,
      totalPnL,
      isClosed: Math.abs(netQuantity) < 0.01,
    };

    Logger.debug(
      `🔢 [PNL_CALC] Resultado: netQty: ${result.totalQuantity}, P&L: ${result.totalPnL}, fechada: ${result.isClosed}`
    );
    return result;
  }

  static async syncPositionsFromExchangeFills(botId, config) {
    try {
      Logger.debug(
        `📊 [FILLS_SYNC] Iniciando sincronização baseada em fills da corretora para bot ${botId}`
      );

      const botClientOrderId = config.botClientOrderId?.toString() || '';
      const botCreationDate = config.createdAt || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const fromTimestamp = new Date(botCreationDate).getTime();

      const allFills = await History.getFillHistory(
        null,
        null,
        fromTimestamp,
        Date.now(),
        1000,
        0,
        null,
        'PERP',
        null,
        config.apiKey,
        config.apiSecret
      );

      if (!allFills || !Array.isArray(allFills)) {
        Logger.warn(`⚠️ [FILLS_SYNC] Não foi possível buscar fills da corretora para bot ${botId}`);
        return 0;
      }

      // NOVA ABORDAGEM: Busca fills com clientId E fills de fechamento sem clientId
      const botFillsWithClientId = allFills.filter(fill => {
        const fillClientId = fill.clientId?.toString() || '';
        return fillClientId.startsWith(botClientOrderId);
      });

      // Identifica fills de fechamento potenciais (sem clientId) para posições abertas
      const orphanFills = await OrdersService.identifyOrphanFills(
        botId,
        allFills,
        botFillsWithClientId
      );

      const botFills = [...botFillsWithClientId, ...orphanFills];

      Logger.debug(
        `📊 [FILLS_SYNC] Encontrados ${botFillsWithClientId.length} fills com clientId + ${orphanFills.length} fills órfãos = ${botFills.length} fills totais do bot`
      );

      const symbolPositions = new Map();

      botFills.forEach(fill => {
        const symbol = fill.symbol;
        if (!symbolPositions.has(symbol)) {
          symbolPositions.set(symbol, []);
        }
        symbolPositions.get(symbol).push({
          side: fill.side === 'Bid' ? 'BUY' : 'SELL',
          quantity: parseFloat(fill.quantity),
          price: parseFloat(fill.price),
          timestamp: fill.timestamp,
          orderId: fill.orderId,
        });
      });

      let closedCount = 0;

      for (const [symbol, fills] of symbolPositions.entries()) {
        Logger.debug(`🔍 [FILLS_SYNC] Analisando ${symbol} com ${fills.length} fills`);

        const position = OrdersService.calculatePositionFromFills(fills);

        if (position.isClosed) {
          Logger.debug(
            `✅ [FILLS_SYNC] Posição ${symbol} fechada baseada em fills - P&L: ${position.totalPnL.toFixed(4)} USDC`
          );

          const ourOrders = await OrdersService.dbService.getAll(
            `SELECT * FROM bot_orders WHERE botId = ? AND symbol = ? AND status = 'FILLED'`,
            [botId, symbol]
          );

          for (const order of ourOrders) {
            const pnlForOrder =
              ourOrders.length > 1
                ? (position.totalPnL * parseFloat(order.quantity)) /
                  Math.abs(position.totalQuantityProcessed)
                : position.totalPnL;

            await OrdersService.dbService.run(
              `UPDATE bot_orders 
               SET status = 'CLOSED', pnl = ?, closeTime = ?, closeType = 'FILLS_BASED_CLOSE'
               WHERE externalOrderId = ?`,
              [pnlForOrder, new Date().toISOString(), order.externalOrderId]
            );

            Logger.debug(
              `📊 [FILLS_SYNC] Ordem ${order.externalOrderId} marcada como CLOSED com P&L: ${pnlForOrder}`
            );
          }

          closedCount++;
        } else {
          Logger.debug(
            `ℹ️ [FILLS_SYNC] ${symbol} ainda tem posição aberta (quantidade: ${position.totalQuantity})`
          );
        }
      }

      Logger.debug(
        `📊 [FILLS_SYNC] Bot ${botId}: ${closedCount} posições fechadas baseado em fills`
      );
      return closedCount;
    } catch (error) {
      Logger.error(`❌ [FILLS_SYNC] Erro na sincronização baseada em fills:`, error.message);
      return 0;
    }
  }

  /**
   * Identifica fills órfãos (sem clientId) que podem pertencer às posições do bot
   * Isso acontece quando o usuário move take profit na corretora, cancelando nossa ordem e criando uma nova
   * @param {number} botId - ID do bot
   * @param {Array} allFills - Todos os fills da corretora
   * @param {Array} botFillsWithClientId - Fills já identificados do bot (com clientId)
   * @returns {Array} Fills órfãos que podem pertencer ao bot
   */
  static async identifyOrphanFills(botId, allFills, botFillsWithClientId) {
    try {
      // 1. Busca posições FILLED do bot que ainda não foram fechadas
      // INCLUINDO ordens com closeTime que não foram marcadas como CLOSED (o problema identificado)
      const openFilledOrders = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status = 'FILLED'
         ORDER BY timestamp`,
        [botId]
      );

      if (openFilledOrders.length === 0) {
        Logger.debug(`🔍 [ORPHAN_FILLS] Nenhuma ordem FILLED em aberto para bot ${botId}`);
        return [];
      }

      Logger.debug(
        `🔍 [ORPHAN_FILLS] Bot ${botId} tem ${openFilledOrders.length} ordens FILLED em aberto`
      );

      // 2. Para cada posição aberta, busca fills de fechamento potenciais
      const orphanFills = [];
      const botFillsMap = new Map();

      // Mapeia fills do bot por símbolo
      botFillsWithClientId.forEach(fill => {
        const symbol = fill.symbol;
        if (!botFillsMap.has(symbol)) {
          botFillsMap.set(symbol, []);
        }
        botFillsMap.get(symbol).push(fill);
      });

      for (const order of openFilledOrders) {
        const { symbol, side, quantity } = order;

        // Busca fills sem clientId no mesmo símbolo, direção oposta
        const oppositeSide = side === 'BUY' ? 'Ask' : 'Bid'; // Formato da corretora

        const potentialCloseFills = allFills.filter(fill => {
          return (
            fill.symbol === symbol &&
            fill.side === oppositeSide &&
            (!fill.clientId || fill.clientId === '') && // Sem clientId
            new Date(fill.timestamp) > new Date(order.timestamp) && // Após a abertura
            !botFillsWithClientId.includes(fill) // Não é um fill já identificado do bot
          );
        });

        // Se encontrou fills de fechamento potenciais
        if (potentialCloseFills.length > 0) {
          Logger.info(
            `🔍 [ORPHAN_FILLS] Encontrados ${potentialCloseFills.length} fills órfãos potenciais para ${symbol} ${side} ${quantity}`
          );

          // Calcula se esses fills podem fechar nossa posição
          const validCloseFills = OrdersService.validateOrphanFills(
            order,
            potentialCloseFills,
            botFillsMap.get(symbol) || []
          );

          if (validCloseFills.length > 0) {
            Logger.info(
              `✅ [ORPHAN_FILLS] ${validCloseFills.length} fills órfãos validados para ${symbol}`
            );
            orphanFills.push(...validCloseFills);
          }
        }
      }

      Logger.info(
        `📊 [ORPHAN_FILLS] Total de ${orphanFills.length} fills órfãos identificados para bot ${botId}`
      );
      return orphanFills;
    } catch (error) {
      Logger.error(`❌ [ORPHAN_FILLS] Erro ao identificar fills órfãos:`, error.message);
      return [];
    }
  }

  /**
   * Valida se fills órfãos realmente pertencem à posição do bot
   * @param {Object} order - Ordem aberta do bot
   * @param {Array} potentialFills - Fills potenciais de fechamento
   * @param {Array} existingFills - Fills já identificados do bot para o símbolo
   * @returns {Array} Fills validados
   */
  static validateOrphanFills(order, potentialFills, existingFills) {
    const validFills = [];
    const orderQuantity = parseFloat(order.quantity);

    Logger.debug(
      `🔍 [ORPHAN_VALIDATE] Validando fills órfãos para ordem ${order.symbol} ${order.side} ${orderQuantity}`
    );

    // Para ordens FILLED simples, assume que a quantidade da ordem precisa ser fechada
    // Se não há fills existentes do bot, toda a quantidade precisa ser fechada
    let quantityToClose = orderQuantity;

    if (existingFills.length > 0) {
      Logger.debug(
        `🔍 [ORPHAN_VALIDATE] Existem ${existingFills.length} fills existentes para análise`
      );
      // Calcula quantidade já processada nos fills existentes
      let processedQuantity = 0;
      existingFills.forEach(fill => {
        const fillSide = fill.side === 'Bid' ? 'BUY' : 'SELL';
        const quantity = parseFloat(fill.quantity);

        if (fillSide === order.side) {
          processedQuantity += quantity;
        } else {
          processedQuantity -= quantity; // Já foi fechado parcialmente
        }
      });

      quantityToClose = Math.max(0, processedQuantity);
    }

    Logger.debug(`🔍 [ORPHAN_VALIDATE] Quantidade a fechar: ${quantityToClose}`);

    // Se não há quantidade para fechar, não há fills órfãos válidos
    if (quantityToClose <= 0.01) {
      Logger.debug(`🔍 [ORPHAN_VALIDATE] Posição ${order.symbol} já totalmente fechada`);
      return [];
    }

    // Ordena fills por timestamp
    const sortedFills = potentialFills.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    let remainingToClose = quantityToClose;

    for (const fill of sortedFills) {
      const fillQuantity = parseFloat(fill.quantity);

      Logger.debug(
        `🔍 [ORPHAN_VALIDATE] Testando fill: ${fill.side} ${fillQuantity} @ ${fill.price}`
      );
      Logger.debug(
        `🔍 [ORPHAN_VALIDATE] Remaining to close: ${remainingToClose}, Fill quantity: ${fillQuantity}`
      );

      // Aceita o fill se pode fechar total ou parcialmente a posição
      if (remainingToClose > 0.01 && fillQuantity <= remainingToClose + 0.1) {
        // Tolerância aumentada
        validFills.push({
          ...fill,
          side: fill.side === 'Bid' ? 'BUY' : 'SELL', // Normaliza formato
          quantity: fillQuantity,
          price: parseFloat(fill.price),
          isOrphan: true, // Marca como órfão para logging
        });

        remainingToClose -= fillQuantity;
        Logger.info(
          `✅ [ORPHAN_VALIDATE] Fill órfão validado: ${fill.symbol} ${fill.side} ${fillQuantity} @ ${fill.price}`
        );

        // Se fechou completamente, para de buscar
        if (remainingToClose <= 0.01) {
          Logger.info(
            `✅ [ORPHAN_VALIDATE] Posição ${order.symbol} totalmente fechada por fills órfãos`
          );
          break;
        }
      } else {
        Logger.debug(
          `🔍 [ORPHAN_VALIDATE] Fill rejeitado: quantidade ${fillQuantity} > remaining ${remainingToClose}`
        );
      }
    }

    Logger.info(
      `📊 [ORPHAN_VALIDATE] ${validFills.length} fills órfãos validados para ${order.symbol}`
    );
    return validFills;
  }

  static calculatePositionFromFills(fills) {
    let netQuantity = 0;
    let totalCost = 0;
    let totalPnL = 0;
    let totalQuantityProcessed = 0;

    fills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    Logger.debug(`🔢 [FILLS_CALC] Calculando posição para ${fills.length} fills:`);
    fills.forEach(fill => {
      const orphanLabel = fill.isOrphan ? ' [ÓRFÃO]' : '';
      Logger.debug(
        `  ${fill.side} ${fill.quantity} @ ${fill.price} (${fill.timestamp})${orphanLabel}`
      );
    });

    for (const fill of fills) {
      const quantity = fill.quantity;
      const price = fill.price;
      totalQuantityProcessed += quantity;

      if (fill.side === 'BUY') {
        netQuantity += quantity;
        totalCost += quantity * price;
        Logger.debug(`  BUY: +${quantity}, netQty: ${netQuantity}, totalCost: ${totalCost}`);
      } else {
        const avgCostPrice = netQuantity > 0 ? totalCost / netQuantity : 0;
        const pnlFromSell = (price - avgCostPrice) * quantity;
        totalPnL += pnlFromSell;

        netQuantity -= quantity;
        if (netQuantity > 0) {
          totalCost = (totalCost / (netQuantity + quantity)) * netQuantity;
        } else {
          totalCost = 0;
        }
        Logger.debug(
          `  SELL: -${quantity}, avgCost: ${avgCostPrice}, sellPrice: ${price}, pnl: ${pnlFromSell}, netQty: ${netQuantity}`
        );
      }
    }

    // VALIDAÇÃO MELHORADA: Só marca como fechada se tiver quantidade zero
    const isQuantityClosed = Math.abs(netQuantity) < 0.01;

    // VALIDAÇÃO APRIMORADA: Aceita fechamentos com PnL pequeno (incluindo loss pequeno)
    // Só rejeita se for realmente suspeito (PnL zero E preços idênticos)
    const isPnLExactlyZero = Math.abs(totalPnL) < 0.0001;
    const hasMultipleFills = fills.length > 1;

    // Verifica se os preços são todos idênticos (indicando possível erro)
    const prices = fills.map(f => f.price);
    const hasIdenticalPrices =
      prices.length > 1 && Math.max(...prices) - Math.min(...prices) < 0.0001;

    const isReallySuspicious = isPnLExactlyZero && hasMultipleFills && hasIdenticalPrices;

    let isClosed = isQuantityClosed;
    if (isQuantityClosed && isReallySuspicious) {
      Logger.warn(
        `⚠️ [FILLS_CALC] Fill suspeito detectado: PnL=$${totalPnL.toFixed(4)}, preços idênticos=${hasIdenticalPrices}`
      );
      Logger.warn(
        `⚠️ [FILLS_CALC] Fills: ${fills.map(f => `${f.side} ${f.quantity}@${f.price}`).join(', ')}`
      );
      Logger.warn(`🚫 [FILLS_CALC] Não marcando como fechada - possível erro de cálculo`);
      isClosed = false;
    } else if (isQuantityClosed) {
      // Log detalhado para fechamentos válidos (incluindo loss pequeno)
      if (Math.abs(totalPnL) < 1) {
        Logger.debug(
          `💸 [FILLS_CALC] Posição fechada com PnL pequeno: $${totalPnL.toFixed(4)} (${totalPnL > 0 ? 'gain' : 'loss'})`
        );
      } else {
        Logger.debug(
          `💰 [FILLS_CALC] Posição fechada com PnL: $${totalPnL.toFixed(2)} (${totalPnL > 0 ? 'gain' : 'loss'})`
        );
      }
    }

    const result = {
      totalQuantity: netQuantity,
      totalPnL,
      totalQuantityProcessed,
      isClosed: isClosed,
    };

    Logger.debug(
      `🔢 [FILLS_CALC] Resultado: netQty: ${result.totalQuantity}, P&L: ${result.totalPnL}, fechada: ${result.isClosed}, suspeito: ${isReallySuspicious}`
    );
    return result;
  }

  /**
   * Identifica se uma ordem é condicional baseada em suas propriedades
   * @param {Object} order - Ordem a ser verificada
   * @returns {boolean} True se for ordem condicional
   */
  static isConditionalOrder(order) {
    return (
      order.triggerPrice ||
      order.stopLossTriggerPrice ||
      order.takeProfitTriggerPrice ||
      order.orderType === 'STOP_MARKET' ||
      order.orderType === 'TAKE_PROFIT_MARKET' ||
      order.orderType?.includes('TRIGGER')
    );
  }

  /**
   * MÉTODO CRÍTICO: Detecta e limpa ordens fantasma - ordens que existem no banco mas não na corretora
   * @param {number} botId - ID do bot
   * @param {Object} config - Configuração do bot com credenciais
   * @returns {Promise<number>} Número de ordens fantasma limpas
   */
  static async cleanGhostOrders(botId, config) {
    try {
      Logger.info(`👻 [GHOST_ORDERS] Iniciando limpeza de ordens fantasma para bot ${botId}`);

      if (!config?.apiKey || !config?.apiSecret) {
        Logger.warn(`⚠️ [GHOST_ORDERS] Credenciais não disponíveis para bot ${botId}`);
        return 0;
      }

      // 1. Busca ordens PENDING no nosso banco
      const pendingOrdersInDB = await OrdersService.dbService.getAll(
        `SELECT * FROM bot_orders 
         WHERE botId = ? AND status IN ('PENDING', 'OPEN') 
         AND externalOrderId IS NOT NULL
         ORDER BY timestamp DESC`,
        [botId]
      );

      if (pendingOrdersInDB.length === 0) {
        Logger.info(`✅ [GHOST_ORDERS] Nenhuma ordem PENDING no banco para bot ${botId}`);
        return 0;
      }

      Logger.info(
        `📊 [GHOST_ORDERS] Encontradas ${pendingOrdersInDB.length} ordens PENDING no banco para bot ${botId}`
      );

      // 2. Busca ordens abertas REAIS na corretora (incluindo ordens condicionais)
      const { default: Order } = await import('../Backpack/Authenticated/Order.js');

      // Busca ordens regulares
      const regularOrders = await Order.getOpenOrders(
        null,
        'PERP',
        config.apiKey,
        config.apiSecret
      );

      // Busca ordens condicionais (trigger orders)
      const triggerOrders = await Order.getOpenTriggerOrders(
        null,
        'PERP',
        config.apiKey,
        config.apiSecret
      );

      if (!regularOrders && !triggerOrders) {
        Logger.warn(
          `⚠️ [GHOST_ORDERS] Não foi possível buscar ordens da corretora para bot ${botId}`
        );
        return 0;
      }

      // Unifica todas as ordens da exchange
      const allOpenOrdersOnExchange = [...(regularOrders || []), ...(triggerOrders || [])];

      // Filtra ordens do bot específico
      const botClientOrderId = config.botClientOrderId?.toString() || '';
      const botExchangeOrders = allOpenOrdersOnExchange.filter(order => {
        const clientId = order.clientId?.toString() || '';
        return clientId.startsWith(botClientOrderId);
      });

      Logger.info(
        `📊 [GHOST_ORDERS] Encontradas ${botExchangeOrders.length} ordens REAIS na corretora para bot ${botId} (regulares: ${regularOrders?.length || 0}, condicionais: ${triggerOrders?.length || 0})`
      );

      // 3. Cria mapa de ordens que existem na corretora
      const exchangeOrderIds = new Set();
      botExchangeOrders.forEach(order => {
        if (order.id) {
          exchangeOrderIds.add(order.id);
        }
      });

      // 4. Identifica ordens fantasma
      const ghostOrders = [];
      for (const dbOrder of pendingOrdersInDB) {
        if (!exchangeOrderIds.has(dbOrder.externalOrderId)) {
          ghostOrders.push(dbOrder);
        }
      }

      Logger.info(
        `👻 [GHOST_ORDERS] Detectadas ${ghostOrders.length} ordens fantasma para bot ${botId}`
      );

      if (ghostOrders.length === 0) {
        return 0;
      }

      // 5. Log das ordens fantasma para debug (com identificação de tipo)
      ghostOrders.forEach(order => {
        const orderType = OrdersService.isConditionalOrder(order) ? 'condicional' : 'padrão';
        Logger.warn(
          `👻 [GHOST] Bot ${botId}: ${order.symbol} ${order.side} ${order.quantity} (${order.externalOrderId}) - Tipo: ${orderType} (${order.orderType})`
        );
      });

      // 6. Para cada ordem fantasma, verifica o status real na corretora via histórico
      let cleanedCount = 0;
      const { default: History } = await import('../Backpack/Authenticated/History.js');

      for (const ghostOrder of ghostOrders) {
        try {
          Logger.debug(
            `🔍 [GHOST_ORDERS] Verificando ordem fantasma ${ghostOrder.externalOrderId} via histórico`
          );

          // Busca histórico da ordem específica
          const orderHistory = await History.getOrderHistory(
            ghostOrder.externalOrderId,
            ghostOrder.symbol,
            10,
            0,
            'PERP',
            null,
            config.apiKey,
            config.apiSecret
          );

          if (orderHistory && Array.isArray(orderHistory) && orderHistory.length > 0) {
            const orderRecord = orderHistory.find(order => order.id === ghostOrder.externalOrderId);

            if (orderRecord) {
              Logger.info(
                `🔍 [GHOST_ORDERS] Status real da ordem fantasma ${ghostOrder.externalOrderId}: ${orderRecord.status}`
              );

              // Atualiza status baseado no histórico real
              let newStatus = 'PENDING';
              let closeType = 'GHOST_ORDER_SYNC';

              switch (orderRecord.status) {
                case 'Filled':
                case 'PartiallyFilled':
                  newStatus = 'FILLED';
                  closeType = 'GHOST_ORDER_FILLED';
                  break;
                case 'Cancelled':
                case 'Rejected':
                case 'Expired':
                  newStatus = 'CANCELLED';
                  closeType = 'GHOST_ORDER_CANCELLED';
                  break;
                default:
                  // Se ainda está Open/New no histórico, mas não nas ordens abertas,
                  // provavelmente foi cancelada ou expirou muito recentemente
                  newStatus = 'CANCELLED';
                  closeType = 'GHOST_ORDER_MISSING';
                  break;
              }

              if (newStatus !== ghostOrder.status) {
                await OrdersService.updateOrderStatus(
                  ghostOrder.externalOrderId,
                  newStatus,
                  closeType
                );

                // Log aprimorado identificando tipo da ordem
                const orderType = OrdersService.isConditionalOrder(ghostOrder)
                  ? 'condicional'
                  : 'padrão';
                Logger.info(
                  `✅ [GHOST_ORDERS] Ordem ${orderType} fantasma processada para ${ghostOrder.symbol}: ID ${ghostOrder.externalOrderId} (${ghostOrder.status} → ${newStatus})`
                );
                cleanedCount++;
              }
            } else {
              // Ordem não encontrada nem no histórico - marca como CANCELLED
              await OrdersService.updateOrderStatus(
                ghostOrder.externalOrderId,
                'CANCELLED',
                'GHOST_ORDER_NOT_FOUND'
              );

              // Log aprimorado para ordem não encontrada
              const orderType = OrdersService.isConditionalOrder(ghostOrder)
                ? 'condicional'
                : 'padrão';
              Logger.info(
                `❌ [GHOST_ORDERS] Ordem ${orderType} fantasma ${ghostOrder.symbol} não encontrada: ID ${ghostOrder.externalOrderId} - marcada como CANCELLED`
              );
              cleanedCount++;
            }
          } else {
            // Erro ao buscar histórico ou histórico vazio - marca como CANCELLED
            await OrdersService.updateOrderStatus(
              ghostOrder.externalOrderId,
              'CANCELLED',
              'GHOST_ORDER_NO_HISTORY'
            );
            Logger.warn(
              `⚠️ [GHOST_ORDERS] Não foi possível obter histórico da ordem fantasma ${ghostOrder.externalOrderId} - marcando como CANCELLED`
            );
            cleanedCount++;
          }
        } catch (orderError) {
          Logger.error(
            `❌ [GHOST_ORDERS] Erro ao processar ordem fantasma ${ghostOrder.externalOrderId}: ${orderError.message}`
          );
        }
      }

      Logger.info(
        `🎉 [GHOST_ORDERS] Limpeza concluída para bot ${botId}: ${cleanedCount}/${ghostOrders.length} ordens fantasma processadas`
      );
      return cleanedCount;
    } catch (error) {
      Logger.error(`❌ [GHOST_ORDERS] Erro na limpeza de ordens fantasma: ${error.message}`);
      return 0;
    }
  }

  /**
   * MÉTODO DE CORREÇÃO: Corrige ordens que têm closeTime mas não foram marcadas como CLOSED
   * Isso pode acontecer se o sistema foi interrompido durante uma atualização
   * @param {number} botId - ID do bot (opcional, se não fornecido corrige todos)
   * @returns {Promise<number>} Número de ordens corrigidas
   */
  static async fixOrdersWithCloseTimeButNotClosed(botId = null) {
    try {
      Logger.debug(
        `🔧 [ORDERS_FIX] Iniciando correção de ordens com closeTime não marcadas como CLOSED${botId ? ` para bot ${botId}` : ''}`
      );

      // Busca ordens com closeTime mas status != CLOSED
      const query = botId
        ? `SELECT * FROM bot_orders WHERE botId = ? AND closeTime IS NOT NULL AND closeTime != '' AND status != 'CLOSED' ORDER BY timestamp`
        : `SELECT * FROM bot_orders WHERE closeTime IS NOT NULL AND closeTime != '' AND status != 'CLOSED' ORDER BY timestamp`;

      const params = botId ? [botId] : [];
      const problematicOrders = await OrdersService.dbService.getAll(query, params);

      if (problematicOrders.length === 0) {
        Logger.debug(`✅ [ORDERS_FIX] Nenhuma ordem problemática encontrada`);
        return 0;
      }

      Logger.debug(
        `🔍 [ORDERS_FIX] Encontradas ${problematicOrders.length} ordens com closeTime que não estão CLOSED:`
      );
      problematicOrders.forEach(order => {
        Logger.debug(
          `  Bot ${order.botId}: ${order.symbol} ${order.side} ${order.quantity} (${order.externalOrderId}) - Status: ${order.status}`
        );
      });

      let fixedCount = 0;

      // Para cada ordem problemática, verifica se realmente deveria estar fechada
      for (const order of problematicOrders) {
        try {
          Logger.debug(
            `🔧 [ORDERS_FIX] Analisando ordem ${order.externalOrderId} - ${order.symbol}`
          );

          // Se tem closeTime e não é PENDING nem CANCELLED, provavelmente deveria estar CLOSED
          if (order.status === 'FILLED') {
            Logger.info(
              `🔧 [ORDERS_FIX] Corrigindo ordem FILLED com closeTime: ${order.externalOrderId}`
            );

            // Atualiza para CLOSED mantendo os dados existentes
            await OrdersService.dbService.run(
              `UPDATE bot_orders 
               SET status = 'CLOSED', 
                   closeType = COALESCE(closeType, 'SYSTEM_CORRECTION')
               WHERE externalOrderId = ?`,
              [order.externalOrderId]
            );

            Logger.info(`✅ [ORDERS_FIX] Ordem ${order.externalOrderId} marcada como CLOSED`);
            fixedCount++;
          } else {
            Logger.debug(
              `ℹ️ [ORDERS_FIX] Ordem ${order.externalOrderId} tem status ${order.status} - não corrigindo automaticamente`
            );
          }
        } catch (orderError) {
          Logger.error(
            `❌ [ORDERS_FIX] Erro ao corrigir ordem ${order.externalOrderId}: ${orderError.message}`
          );
        }
      }

      Logger.debug(
        `🎉 [ORDERS_FIX] Correção concluída: ${fixedCount}/${problematicOrders.length} ordens corrigidas`
      );
      return fixedCount;
    } catch (error) {
      Logger.error(`❌ [ORDERS_FIX] Erro na correção de ordens: ${error.message}`);
      return 0;
    }
  }

  /**
   * MÉTODO PRINCIPAL: Executa sincronização completa incluindo limpeza de ordens fantasma
   * @param {number} botId - ID do bot
   * @param {Object} config - Configuração do bot
   * @returns {Promise<Object>} Resultado da sincronização completa
   */
  static async performCompleteFillsSync(botId, config) {
    try {
      Logger.info(`🚀 [COMPLETE_SYNC] Iniciando sincronização completa para bot ${botId}`);

      const results = {
        orphanFillsDetected: 0,
        positionsClosed: 0,
        ordersFixed: 0,
        ghostOrdersCleaned: 0,
        orphanTrailingStatesCleaned: 0,
        total: 0,
      };

      // 1. CRÍTICO: Limpa ordens fantasma primeiro (prioridade)
      results.ghostOrdersCleaned = await OrdersService.cleanGhostOrders(botId, config);

      // 3. Executa sincronização baseada em fills (incluindo órfãos)
      results.positionsClosed = await OrdersService.syncPositionsFromExchangeFills(botId, config);

      // 4. Limpa dados órfãos da tabela trailing_state
      results.orphanTrailingStatesCleaned = await OrdersService.cleanOrphanTrailingStates(botId);

      results.total =
        results.ghostOrdersCleaned +
        results.ordersFixed +
        results.positionsClosed +
        results.orphanTrailingStatesCleaned;

      Logger.debug(`🎉 [COMPLETE_SYNC] Sincronização completa concluída para bot ${botId}:`);
      Logger.debug(`   • Ordens fantasma limpas: ${results.ghostOrdersCleaned}`);
      Logger.debug(`   • Ordens corrigidas: ${results.ordersFixed}`);
      Logger.debug(`   • Posições fechadas: ${results.positionsClosed}`);
      Logger.debug(`   • Trailing states órfãos limpos: ${results.orphanTrailingStatesCleaned}`);
      Logger.debug(`   • Total de ações: ${results.total}`);

      return results;
    } catch (error) {
      Logger.error(`❌ [COMPLETE_SYNC] Erro na sincronização completa: ${error.message}`);
      return {
        orphanFillsDetected: 0,
        positionsClosed: 0,
        ordersFixed: 0,
        ghostOrdersCleaned: 0,
        orphanTrailingStatesCleaned: 0,
        total: 0,
      };
    }
  }

  /**
   * MÉTODO ESPECIFICO: Apenas limpeza de ordens fantasma (uso direto)
   * @param {number} botId - ID do bot
   * @param {Object} config - Configuração do bot
   * @returns {Promise<Object>} Resultado da limpeza
   */
  static async performGhostOrdersCleanup(botId, config) {
    try {
      Logger.info(
        `👻 [GHOST_CLEANUP] Executando apenas limpeza de ordens fantasma para bot ${botId}`
      );

      const ghostOrdersCleaned = await OrdersService.cleanGhostOrders(botId, config);

      Logger.info(
        `🎉 [GHOST_CLEANUP] Limpeza concluída para bot ${botId}: ${ghostOrdersCleaned} ordens fantasma processadas`
      );

      return {
        ghostOrdersCleaned,
        success: true,
      };
    } catch (error) {
      Logger.error(`❌ [GHOST_CLEANUP] Erro na limpeza de ordens fantasma: ${error.message}`);
      return { ghostOrdersCleaned: 0, success: false, error: error.message };
    }
  }

  /**
   * Limpa dados órfãos da tabela trailing_state que não têm ordens correspondentes
   * @param {number} botId - ID do bot
   * @returns {Promise<number>} Número de registros limpos
   */
  static async cleanOrphanTrailingStates(botId) {
    try {
      if (!OrdersService.dbService || !OrdersService.dbService.db) {
        Logger.warn(`⚠️ [TRAILING_CLEANUP] Database não disponível`);
        return 0;
      }

      Logger.debug(
        `🧹 [TRAILING_CLEANUP] Iniciando limpeza de trailing states órfãos para bot ${botId}`
      );

      // Busca todos os trailing states do bot
      const trailingStates = await OrdersService.dbService.getAll(
        `SELECT id, botId, symbol FROM trailing_state WHERE botId = ?`,
        [botId]
      );

      if (trailingStates.length === 0) {
        Logger.debug(`ℹ️ [TRAILING_CLEANUP] Nenhum trailing state encontrado para bot ${botId}`);
        return 0;
      }

      Logger.debug(
        `🔍 [TRAILING_CLEANUP] Encontrados ${trailingStates.length} trailing states para bot ${botId}`
      );

      let cleanedCount = 0;

      for (const trailingState of trailingStates) {
        try {
          // Verifica se existem ordens ativas (FILLED sem closeTime) para este símbolo
          const activeOrders = await OrdersService.dbService.getAll(
            `SELECT id FROM bot_orders 
             WHERE botId = ? AND symbol = ? AND status = 'FILLED' 
             AND (closeTime IS NULL OR closeTime = '')`,
            [botId, trailingState.symbol]
          );

          // Se não há ordens ativas para este símbolo, remove o trailing state
          if (activeOrders.length === 0) {
            await OrdersService.dbService.run(`DELETE FROM trailing_state WHERE id = ?`, [
              trailingState.id,
            ]);

            Logger.info(
              `🗑️ [TRAILING_CLEANUP] Trailing state órfão removido: ${trailingState.symbol} (ID: ${trailingState.id})`
            );
            cleanedCount++;
          } else {
            Logger.debug(
              `✅ [TRAILING_CLEANUP] Trailing state válido mantido: ${trailingState.symbol} (${activeOrders.length} ordens ativas)`
            );
          }
        } catch (error) {
          Logger.error(
            `❌ [TRAILING_CLEANUP] Erro ao processar trailing state ${trailingState.id}: ${error.message}`
          );
        }
      }

      Logger.debug(
        `🎉 [TRAILING_CLEANUP] Limpeza concluída para bot ${botId}: ${cleanedCount} trailing states órfãos removidos`
      );
      return cleanedCount;
    } catch (error) {
      Logger.error(
        `❌ [TRAILING_CLEANUP] Erro na limpeza de trailing states órfãos: ${error.message}`
      );
      return 0;
    }
  }
}

export default OrdersService;
