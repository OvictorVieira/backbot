import axios from 'axios';
import { auth } from './Authentication.js';
import Logger from '../../Utils/Logger.js';

class Futures {
  async getOpenPositions(apiKey = null, apiSecret = null) {
    const timestamp = Date.now();

    // OBRIGATÓRIO: Usa credenciais fornecidas
    if (!apiKey || !apiSecret) {
      throw new Error('API_KEY e API_SECRET são obrigatórios - deve ser passado da config do bot');
    }

    try {
      const headers = auth({
        instruction: 'positionQuery',
        timestamp,
        apiKey: apiKey,
        apiSecret: apiSecret,
      });

      const response = await axios.get(`${process.env.API_URL}/api/v1/position`, {
        headers,
        timeout: 15000,
      });

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        Logger.warn('⚠️ getOpenPositions - Timeout, tentando novamente em 2s...');
        // Retry após 2 segundos
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const retryHeaders = auth({
            instruction: 'positionQuery',
            timestamp: Date.now(),
            apiKey: apiKey,
            apiSecret: apiSecret,
          });

          const retryResponse = await axios.get(`${process.env.API_URL}/api/v1/position`, {
            headers: retryHeaders,
            timeout: 20000, // Timeout maior na segunda tentativa
          });

          Logger.info('✅ getOpenPositions - Retry bem-sucedido');
          return retryResponse.data;
        } catch (retryError) {
          Logger.error(
            '❌ getOpenPositions - Retry falhou:',
            retryError.response?.data || retryError.message
          );
          return null;
        }
      } else {
        Logger.error('❌ getOpenPositions - ERROR!', error.response?.data || error.message);
        return null;
      }
    }
  }
}

export default new Futures();
