import axios from 'axios';
import { auth } from './Authentication.js';
import Logger from '../../Utils/Logger.js';
import GlobalRequestQueue from '../../Utils/GlobalRequestQueue.js';

class Order {

  async getOpenOrder(symbol, orderId, clientId, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

     if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    if (!orderId && !clientId) {
      Logger.error('clientId or orderId is required');
      return null;
    }


    const params = {}
    if (symbol) params.symbol = symbol;
    if (orderId) params.orderId = orderId;
    if (clientId) params.clientId = clientId;

    const headers = auth({
      instruction: 'orderQuery',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/api/v1/order`, {
        headers,
        params
      });
      return response.data
    } catch (error) {
      Logger.error('getOpenOrder - ERROR!', error.response?.data || error.message);
      return null
    }
  }

  //marketType: "SPOT" "PERP" "IPERP" "DATED" "PREDICTION" "RFQ"
  async getOpenOrders(symbol, marketType = "PERP", apiKey = null, apiSecret = null) {
    // Usa fila global para coordenar todas as requests
    return await GlobalRequestQueue.enqueue(async () => {
      const timestamp = Date.now();

      const params = {}
      if (symbol) params.symbol = symbol;
      if (marketType) params.marketType = marketType;

      const headers = auth({
        instruction: 'orderQueryAll',
        timestamp,
        params,
        apiKey,
        apiSecret
      });

      const response = await axios.get(`${process.env.API_URL}/api/v1/orders`, {
        headers,
        params,
        timeout: 15000 // 15 segundos de timeout
      });
      
      return response.data;
    }, `getOpenOrders(symbol=${symbol}, marketType=${marketType})`);
  }

  /**
   * Busca especificamente por ordens condicionais (trigger orders)
   * Inclui STOP_MARKET, TAKE_PROFIT_MARKET e outras ordens com triggerPrice
   */
  async getOpenTriggerOrders(symbol, marketType = "PERP", apiKey = null, apiSecret = null) {
    try {
      // Primeiro tenta o endpoint principal para ver se inclui trigger orders
      const allOrders = await this.getOpenOrders(symbol, marketType, apiKey, apiSecret);
      
      if (!allOrders || !Array.isArray(allOrders)) {
        Logger.debug(`[TRIGGER_ORDERS] Nenhuma ordem retornada para ${symbol}`);
        return [];
      }

      // Filtra apenas ordens que têm características de trigger orders
      const triggerOrders = allOrders.filter(order => {
        return order.triggerPrice || 
               order.stopLossTriggerPrice || 
               order.takeProfitTriggerPrice ||
               order.orderType === 'STOP_MARKET' ||
               order.orderType === 'TAKE_PROFIT_MARKET' ||
               order.status === 'TriggerPending';
      });

      Logger.debug(`[TRIGGER_ORDERS] Encontradas ${triggerOrders.length} ordens condicionais para ${symbol}`);
      return triggerOrders;

    } catch (error) {
      Logger.error(`[TRIGGER_ORDERS] Erro ao buscar ordens condicionais para ${symbol}:`, error.message);
      
      // Fallback: tenta endpoint específico de trigger orders se existir
      try {
        return await this.getTriggerOrdersFromSpecificEndpoint(symbol, marketType, apiKey, apiSecret);
      } catch (fallbackError) {
        Logger.debug(`[TRIGGER_ORDERS] Endpoint específico não disponível: ${fallbackError.message}`);
        return [];
      }
    }
  }

  /**
   * Tenta buscar ordens condicionais de um endpoint específico
   * Este método pode falhar se o endpoint não existir
   */
  async getTriggerOrdersFromSpecificEndpoint(symbol, marketType = "PERP", apiKey = null, apiSecret = null) {
    return await GlobalRequestQueue.enqueue(async () => {
      const timestamp = Date.now();

      const params = {}
      if (symbol) params.symbol = symbol;
      if (marketType) params.marketType = marketType;

      const headers = auth({
        instruction: 'orderQueryAll',
        timestamp,
        params,
        apiKey,
        apiSecret
      });

      // Tenta diferentes possíveis endpoints para trigger orders
      const possibleEndpoints = [
        '/api/v1/trigger_orders',
        '/api/v1/triggerOrders', 
        '/api/v1/orders/trigger',
        '/api/v1/conditional_orders'
      ];

      for (const endpoint of possibleEndpoints) {
        try {
          const response = await axios.get(`${process.env.API_URL}${endpoint}`, {
            headers,
            params,
            timeout: 15000
          });
          
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

  /*
    {
      "autoLend": true,
      "autoLendRedeem": true,
      "autoBorrow": true,
      "autoBorrowRepay": true,
      "clientId": 0,
      "orderType": "Market",
      "postOnly": true,
      "price": "string",
      "quantity": "string",
      "quoteQuantity": "string",
      "reduceOnly": true,
      "selfTradePrevention": "RejectTaker",
      "side": "Bid",
      "stopLossLimitPrice": "string",
      "stopLossTriggerBy": "string",
      "stopLossTriggerPrice": "string",
      "symbol": "string",
      "takeProfitLimitPrice": "string",
      "takeProfitTriggerBy": "string",
      "takeProfitTriggerPrice": "string",
      "timeInForce": "GTC",
      "triggerBy": "string",
      "triggerPrice": "string",
      "triggerQuantity": "string"
    }
  */

  async executeOrder(body, apiKey = null, apiSecret = null) {

    const timestamp = Date.now();
    const headers = auth({
      instruction: 'orderExecute',
      timestamp,
      params: body,
      apiKey,
      apiSecret
    });

    try {
      const { data } = await axios.post(`${process.env.API_URL}/api/v1/order`, body, {
        headers
      });
      
      return data;
    } catch (err) {
      Logger.error(`❌ [Order.executeOrder] Erro ao enviar ordem:`, {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message
      });
      
      // Captura o motivo do erro para retornar
      const errorMessage = err.response?.data?.message || err.response?.data?.msg || err.message || 'Erro desconhecido';
      return { error: errorMessage };
    }
  }

  
  async cancelOpenOrder(symbol, orderId, clientId, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const params = {}
    if (symbol) params.symbol = symbol;
    if (orderId) params.orderId = orderId;
    if (clientId) params.clientId = clientId;

    const headers = auth({
      instruction: 'orderCancel',
      timestamp,
      params: params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.delete(`${process.env.API_URL}/api/v1/order`, {
        headers,
        data:params
      });
      return response.data
    } catch (error) {
    Logger.error('cancelOpenOrder - ERROR!', error.response?.data || error.message);
    return null
    }

  }

  async cancelOpenOrders(symbol, orderType, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

     if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const params = {}
    if (symbol) params.symbol = symbol;
    if (orderType) params.orderType = orderType;

    const headers = auth({
      instruction: 'orderCancelAll',
      timestamp,
      params: params, // isso é fundamental para assinatura correta
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.delete(`${process.env.API_URL}/api/v1/orders`, {
        headers,
        data:params
      });
      return response.data
    } catch (error) {
      Logger.error('cancelOpenOrders - ERROR!', error.response?.data || error.message);
      return null
    }
  }

}

export default new Order();
