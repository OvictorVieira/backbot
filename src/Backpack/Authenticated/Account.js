import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';
import { auth } from './Authentication.js';
import axios from 'axios';

class Account {
  async getAccount(strategy = null, apiKey = null, apiSecret = null) {
    try {
      // 🚨 CRÍTICO: Request direto sem fila para dados de conta
      // Motivo: Capital da conta é crítico e não pode falhar por fila sobrecarregada
      Logger.debug(
        `🔍 [ACCOUNT_DIRECT] Making direct API call for account data - strategy: ${strategy}`
      );

      const timestamp = Date.now();
      const instruction = 'accountQuery';
      const params = {};

      // Cria headers de autenticação diretamente
      const headers = auth({
        instruction,
        timestamp,
        params,
        apiKey,
        apiSecret,
      });

      // Request direto com axios, bypassing RequestManager
      const response = await axios.get(`${process.env.API_URL}/api/v1/account`, {
        headers,
        timeout: 10000, // 10s timeout
      });

      Logger.debug(`🔍 [ACCOUNT_DIRECT] Direct API response received successfully`);
      return response.data;
    } catch (error) {
      Logger.error(
        `❌ [ACCOUNT_DIRECT] Direct API call failed for strategy ${strategy}:`,
        error.response?.data || error.message
      );
      return null;
    }
  }
}

export default new Account();
