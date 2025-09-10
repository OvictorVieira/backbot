import Logger from '../../Utils/Logger.js';
import GlobalRequestQueue from '../../Utils/GlobalRequestQueue.js';
import OrdersCache from '../../Utils/OrdersCache.js';
import CacheInvalidator from '../../Utils/CacheInvalidator.js';
import requestManager from '../../Utils/RequestManager.js';
import { auth } from './Authentication.js';

class Order {
  async getOpenOrder(symbol, orderId, clientId = null, apiKey, apiSecret) {
    const timestamp = Date.now();

    if (!apiKey || !apiSecret) {
      throw new Error('Parâmetros obrigatórios faltando: apiKey, apiSecret');
    }

    if (!symbol) {
      throw new Error('Parâmetros obrigatórios faltando: symbol');
    }

    if (!orderId && !clientId) {
      throw new Error('Parâmetros obrigatórios faltando: clientId ou orderId');
    }

    const params = {};
    params.symbol = symbol;
    params.orderId = orderId;

    if (clientId) params.clientId = clientId;

    const headers = auth({
      instruction: 'orderQuery',
      timestamp,
      params,
      apiKey,
      apiSecret,
    });

    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/order`,
        {
          headers,
          params,
        },
        'Get Open Order',
        1
      );
      return response.data;
    } catch (error) {
      Logger.error('getOpenOrder - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  //marketType: "SPOT" "PERP" "IPERP" "DATED" "PREDICTION" "RFQ"
  async getOpenOrders(symbol, marketType = 'PERP', apiKey, apiSecret, bypassCache = false) {
    if (!apiKey || !apiSecret) {
      throw new Error('Parâmetros obrigatórios faltando: apiKey, apiSecret');
    }

    const cacheKey = OrdersCache.getCacheKey(apiKey, apiSecret);

    // Tenta buscar do cache primeiro (exceto se bypassCache = true)
    const cachedOrders = OrdersCache.getCache(cacheKey, symbol, bypassCache);

    if (cachedOrders !== null && cachedOrders.length !== 0) {
      // Cache hit - retorna dados cached
      Logger.debug(
        `🎯 [ORDERS_CACHE] Cache hit para getOpenOrders(${symbol || 'ALL'}): ${cachedOrders.length} ordens`
      );
      return cachedOrders;
    }

    // Cache miss - busca da API
    Logger.debug(
      `🔍 [ORDERS_CACHE] Cache miss para getOpenOrders(${symbol || 'ALL'}), buscando da API...`
    );

    const params = {};
    // OTIMIZAÇÃO: Se não tem símbolo específico, busca TODAS as ordens (mais eficiente)
    if (symbol) params.symbol = symbol;
    if (marketType) params.marketType = marketType;

    // ✅ FIX: Using authenticated request with fresh timestamp generated in RequestManager
    const response = await requestManager.authenticatedGet(
      `${process.env.API_URL}/api/v1/orders`,
      { params, timeout: 15000 },
      {
        instruction: 'orderQueryAll',
        params,
        apiKey,
        apiSecret,
      },
      'Get Open Orders',
      1
    );

    const orders = response.data || [];

    // Armazena no cache
    if (symbol) {
      // Cache para símbolo específico
      OrdersCache.setCache(cacheKey, orders, symbol);
    } else {
      // Cache para todas as ordens (mais eficiente)
      OrdersCache.setCache(cacheKey, orders);
    }

    Logger.debug(
      `💾 [ORDERS_CACHE] Dados salvos no cache para ${symbol || 'ALL'}: ${orders.length} ordens`
    );

    return orders;
  }

  /**
   * Busca especificamente por ordens condicionais (trigger orders)
   * Inclui STOP_MARKET, TAKE_PROFIT_MARKET e outras ordens com triggerPrice
   */
  async getOpenTriggerOrders(symbol, marketType = 'PERP', apiKey = null, apiSecret = null) {
    try {
      // Primeiro tenta o endpoint principal para ver se inclui trigger orders
      const allOrders = await this.getOpenOrders(symbol, marketType, apiKey, apiSecret);

      if (!allOrders || !Array.isArray(allOrders)) {
        Logger.debug(`[TRIGGER_ORDERS] Nenhuma ordem retornada para ${symbol}`);
        return [];
      }

      // Filtra apenas ordens que têm características de trigger orders
      const triggerOrders = allOrders.filter(order => {
        return (
          order.triggerPrice ||
          order.stopLossTriggerPrice ||
          order.takeProfitTriggerPrice ||
          order.orderType === 'STOP_MARKET' ||
          order.orderType === 'TAKE_PROFIT_MARKET' ||
          order.status === 'TriggerPending'
        );
      });

      Logger.debug(
        `[TRIGGER_ORDERS] Encontradas ${triggerOrders.length} ordens condicionais para ${symbol}`
      );
      return triggerOrders;
    } catch (error) {
      Logger.error(
        `[TRIGGER_ORDERS] Erro ao buscar ordens condicionais para ${symbol}:`,
        error.message
      );

      // Fallback: tenta endpoint específico de trigger orders se existir
      try {
        return await this.getTriggerOrdersFromSpecificEndpoint(
          symbol,
          marketType,
          apiKey,
          apiSecret
        );
      } catch (fallbackError) {
        Logger.debug(
          `[TRIGGER_ORDERS] Endpoint específico não disponível: ${fallbackError.message}`
        );
        return [];
      }
    }
  }

  /**
   * Tenta buscar ordens condicionais de um endpoint específico
   * Este método pode falhar se o endpoint não existir
   */
  async getTriggerOrdersFromSpecificEndpoint(
    symbol,
    marketType = 'PERP',
    apiKey = null,
    apiSecret = null
  ) {
    return await GlobalRequestQueue.enqueue(async () => {
      const timestamp = Date.now();

      const params = {};
      if (symbol) params.symbol = symbol;
      if (marketType) params.marketType = marketType;

      const headers = auth({
        instruction: 'orderQueryAll',
        timestamp,
        params,
        apiKey,
        apiSecret,
      });

      // Tenta diferentes possíveis endpoints para trigger orders
      const possibleEndpoints = [
        '/api/v1/trigger_orders',
        '/api/v1/triggerOrders',
        '/api/v1/orders/trigger',
        '/api/v1/conditional_orders',
      ];

      for (const endpoint of possibleEndpoints) {
        try {
          const response = await requestManager.get(
            `${process.env.API_URL}${endpoint}`,
            {
              headers,
              params,
              timeout: 15000,
            },
            `Get Trigger Orders ${endpoint}`,
            2
          );

          Logger.debug(`[TRIGGER_ORDERS] Sucesso com endpoint: ${endpoint}`);
          return response.data;
        } catch (error) {
          // Continua tentando outros endpoints
          continue;
        }
      }

      // Se nenhum endpoint funcionar, retorna array vazio
      throw new Error('Nenhum endpoint específico para trigger orders encontrado');
    }, `getTriggerOrdersFromSpecificEndpoint(symbol=${symbol})`);
  }

  async executeOrder(body, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();
    const headers = auth({
      instruction: 'orderExecute',
      timestamp,
      params: body,
      apiKey,
      apiSecret,
    });

    try {
      const { data } = await requestManager.post(
        `${process.env.API_URL}/api/v1/order`,
        body,
        {
          headers,
        },
        'Execute Order',
        0
      );

      return data;
    } catch (err) {
      Logger.error(`❌ [Order.executeOrder] Erro ao enviar ordem:`, {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message,
      });

      // Captura o motivo do erro para retornar
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.msg ||
        err.message ||
        'Erro desconhecido';
      return { error: errorMessage };
    }
  }

  async cancelOpenOrder(symbol, orderId, clientId, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const params = {};
    if (symbol) params.symbol = symbol;
    if (orderId) params.orderId = orderId;
    if (clientId) params.clientId = clientId;

    const headers = auth({
      instruction: 'orderCancel',
      timestamp,
      params: params,
      apiKey,
      apiSecret,
    });

    try {
      const response = await requestManager.delete(
        `${process.env.API_URL}/api/v1/order`,
        {
          headers,
          data: params,
        },
        'Cancel Order',
        1
      );

      // Invalida cache após cancelar ordem com sucesso
      if (response.data && symbol) {
        CacheInvalidator.onOrderCancelled(apiKey, apiSecret, symbol);
      }

      return response.data;
    } catch (error) {
      Logger.error('cancelOpenOrder - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async cancelOpenOrders(symbol, orderType, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const params = {};
    if (symbol) params.symbol = symbol;
    if (orderType) params.orderType = orderType;

    const headers = auth({
      instruction: 'orderCancelAll',
      timestamp,
      params: params, // isso é fundamental para assinatura correta
      apiKey,
      apiSecret,
    });

    try {
      const response = await requestManager.delete(
        `${process.env.API_URL}/api/v1/orders`,
        {
          headers,
          data: params,
        },
        'Cancel All Orders',
        1
      );
      return response.data;
    } catch (error) {
      Logger.error('cancelOpenOrders - ERROR!', error.response?.data || error.message);
      return null;
    }
  }
}

export default new Order();
