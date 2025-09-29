import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';
import { auth } from './Authentication.js';
import axios from 'axios';

class Capital {
  async getBalances() {
    // 🚨 CRÍTICO: Request direto sem fila para dados de balances
    // Motivo: Balance da conta é crítico e não pode falhar por fila sobrecarregada
    Logger.debug(`🔍 [BALANCE_DIRECT] Making direct API call for balance data`);

    const timestamp = Date.now();
    const instruction = 'balanceQuery';

    // Cria headers de autenticação diretamente
    const headers = auth({
      instruction,
      timestamp,
    });

    try {
      // Request direto com axios, bypassing RequestManager
      const response = await axios.get(`${process.env.API_URL}/api/v1/capital`, {
        headers,
        timeout: 10000, // 10s timeout
      });

      Logger.debug(`🔍 [BALANCE_DIRECT] Direct API response received successfully`);
      return response.data;
    } catch (error) {
      Logger.error(
        `❌ [BALANCE_DIRECT] Direct API call failed:`,
        error.response?.data || error.message
      );
      return null;
    }
  }

  async getCollateral(strategy = null, apiKey = null, apiSecret = null) {
    try {
      // 🚨 CRÍTICO: Request direto sem fila para dados de capital
      // Motivo: Capital da conta é crítico e não pode falhar por fila sobrecarregada
      Logger.debug(
        `🔍 [CAPITAL_DIRECT] Making direct API call for collateral data - strategy: ${strategy}`
      );
      Logger.debug(`🔍 [CAPITAL_DIRECT] API URL: ${process.env.API_URL}/api/v1/capital/collateral`);

      const timestamp = Date.now();
      const instruction = 'collateralQuery';
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
      const response = await axios.get(`${process.env.API_URL}/api/v1/capital/collateral`, {
        headers,
        timeout: 10000, // 10s timeout
      });

      Logger.debug(`🔍 [CAPITAL_DIRECT] Direct API response received successfully`);
      Logger.debug(
        `🔍 [CAPITAL_DIRECT] Response type: ${typeof response.data}, Array: ${Array.isArray(response.data)}`
      );

      return response.data;
    } catch (error) {
      Logger.error(
        `❌ [CAPITAL_DIRECT] Direct API call failed for strategy ${strategy}:`,
        error.response?.data || error.message
      );
      return null;
    }
  }

  async getDeposits(
    from = Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days
    to = Date.now(), // now
    limit = 100,
    offset = 0
  ) {
    const timestamp = Date.now();

    const params = { from, to, limit, offset };

    const headers = auth({
      instruction: 'depositQueryAll',
      timestamp,
      params,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/capital/deposits`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      Logger.error('getDeposits - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  // blockchain: "Arbitrum" "Base" "Berachain" "Bitcoin" "BitcoinCash" "Bsc" "Cardano" "Dogecoin" "EqualsMoney" "Ethereum" "Hyperliquid" "Litecoin" "Polygon" "Sui" "Solana" "Story" "XRP"
  async getDepositAddress(blockchain) {
    const timestamp = Date.now();

    if (!blockchain) {
      Logger.error('blockchain required');
      return null;
    }

    const params = { blockchain };

    const headers = auth({
      instruction: 'depositAddressQuery',
      timestamp,
      params,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/capital/deposit/address`, {
        headers,
        params: params,
      });

      return response.data;
    } catch (error) {
      console.error('getDepositAddress - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getWithdrawals(
    from = Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days
    to = Date.now(), // agora
    limit = 100,
    offset = 0
  ) {
    const timestamp = Date.now();

    const params = { from, to, limit, offset };

    const headers = auth({
      instruction: 'withdrawalQueryAll',
      timestamp,
      params,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/wapi/v1/capital/withdrawals`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('getWithdrawals - ERROR!', error.response?.data || error.message);
      return null;
    }
  }
}

export default new Capital();
