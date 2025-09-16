import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';
import { auth } from './Authentication.js';

class Account {
  async getAccount(strategy = null, apiKey = null, apiSecret = null) {
    try {
      // ✅ FIX: Using authenticated request with fresh timestamp generated in RequestManager
      const response = await requestManager.authenticatedGet(
        `${process.env.API_URL}/api/v1/account`,
        {},
        {
          instruction: 'accountQuery',
          params: {},
          apiKey,
          apiSecret,
        },
        'Get Account',
        'HIGH'
      );

      return response.data;
    } catch (error) {
      Logger.error('getAccount - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  // Symbol is token symbol not market, ex: BTC, SOL, etc.
  async getMaxBorrowQuantity(symbol, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const headers = auth({
      instruction: 'maxBorrowQuantity',
      timestamp,
      params: { symbol },
      apiKey,
      apiSecret,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/api/v1/account/limits/borrow`, {
        headers,
        params: { symbol },
      });

      return response.data;
    } catch (error) {
      Logger.error('getMaxBorrowQuantity - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  //side: "Bid" "Ask"
  async getMaxOrderQuantity(symbol, side, apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    if (!side) {
      Logger.error('side required');
      return null;
    }

    const headers = auth({
      instruction: 'maxOrderQuantity',
      timestamp,
      params: { symbol, side },
      apiKey,
      apiSecret,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/api/v1/account/limits/order`, {
        headers,
        params: { symbol, side },
      });

      return response.data;
    } catch (error) {
      Logger.error('getMaxOrderQuantity - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getMaxWithdrawalQuantity(
    symbol,
    autoBorrow = true,
    autoLendRedeem = true,
    apiKey = null,
    apiSecret = null
  ) {
    const timestamp = Date.now();

    if (!symbol) {
      Logger.error('symbol required');
      return null;
    }

    const headers = auth({
      instruction: 'maxWithdrawalQuantity',
      timestamp,
      params: { symbol, autoBorrow, autoLendRedeem },
      apiKey,
      apiSecret,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/api/v1/account/limits/withdrawal`, {
        headers,
        params: { symbol, autoBorrow, autoLendRedeem },
      });
      return response.data;
    } catch (error) {
      Logger.error('getMaxWithdrawalQuantity - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  // TODO: Método updateAccount - Removido temporariamente
  /*
  async updateAccount(leverageLimit,
    autoBorrowSettlements = true,
    autoLend = true,
    autoRepayBorrows = true,
    apiKey = null,
    apiSecret = null
  ) {
    const timestamp = Date.now();

    if (!leverageLimit) {
      console.error('leverageLimit required');
      return null;
    }

    const params = {
      autoBorrowSettlements,
      autoLend,
      autoRepayBorrows,
      leverageLimit: leverageLimit.toFixed(0) // Garante que seja uma string decimal válida
    };

    const headers = auth({
      instruction: 'accountUpdate',
      timestamp,
      params,
      apiKey,
      apiSecret
    });

    try {
      const response = await axios.patch(`${process.env.API_URL}/api/v1/account`, params, {
        headers,
      });

      // Se a resposta está vazia mas o status é 200, consideramos sucesso
      if (response.status === 200) {
        return { success: true, message: 'Alavancagem atualizada com sucesso' };
      }

      // Se chegou até aqui, retorna os dados da resposta
      return response.data || { success: false, message: 'Resposta inesperada da API' };
    } catch (error) {
      console.error('❌ [Account] updateAccount - ERROR!', error.response?.data || error.message);
      return null;
    }
  }
  */
}

export default new Account();
