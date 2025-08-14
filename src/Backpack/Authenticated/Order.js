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
