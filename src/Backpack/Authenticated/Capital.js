import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';

class Capital {
  async getBalances() {
    const timestamp = Date.now();

    const headers = auth({
      instruction: 'balanceQuery',
      timestamp,
    });

    try {
      const response = await axios.get(`${process.env.API_URL}/api/v1/capital`, {
        headers,
      });

      return response.data;
    } catch (error) {
      Logger.error('getBalances - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getCollateral(strategy = null, apiKey = null, apiSecret = null) {
    try {
      // ✅ FIX: Using authenticated request with fresh timestamp generated in RequestManager
      const response = await requestManager.authenticatedGet(
        `${process.env.API_URL}/api/v1/capital/collateral`,
        {},
        {
          instruction: 'collateralQuery',
          params: {}, // Sem parâmetros nesse caso
          apiKey,
          apiSecret,
        },
        'Get Collateral',
        2
      );

      return response.data;
    } catch (error) {
      Logger.error('getCollateral - ERROR!', error.response?.data || error.message);
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
