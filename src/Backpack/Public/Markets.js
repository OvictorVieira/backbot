import requestManager from '../../Utils/RequestManager.js';
import Logger from '../../Utils/Logger.js';

class Markets {
  async getMarkets() {
    try {
      const response = await requestManager.directGet(`${process.env.API_URL}/api/v1/markets`);
      return response.data;
    } catch (error) {
      console.error('getMarkets - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getMarket(symbol) {
    if (!symbol) {
      console.error('symbol required');
      return null;
    }

    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/market`,
        {
          params: { symbol },
        },
        'Get Market',
        'LOW'
      );
      return response.data;
    } catch (error) {
      console.error('getMarket - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getTickers(interval = '1d') {
    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/tickers`,
        {
          params: { interval },
        },
        'Get Tickers',
        'LOW'
      );

      return response.data;
    } catch (error) {
      console.error('getTickers - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getTicker(symbol, interval = '1d') {
    if (!symbol) {
      console.error('symbol required');
      return null;
    }

    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/ticker`,
        {
          params: { symbol, interval },
        },
        'Get Ticker',
        'LOW'
      );

      return response.data;
    } catch (error) {
      console.error('getTicker - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getDepth(symbol) {
    if (!symbol) {
      console.error('symbol required');
      return null;
    }

    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/depth`,
        {
          params: { symbol },
        },
        'Get Depth',
        'LOW'
      );
      return response.data;
    } catch (error) {
      console.error('getDepth - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getKLines(symbol, interval, limit) {
    if (!symbol) {
      console.error('symbol required');
      return null;
    }

    if (!interval) {
      console.error('interval required');
      return null;
    }

    if (!limit) {
      console.error('limit required');
      return null;
    }

    try {
      // Use time-based approach directly since limit parameter doesn't work reliably
      Logger.debug(`[KLINES] ${symbol}: Using time-based approach for ${limit} candles`);

      // Calculate time range for the requested number of candles
      const intervalSeconds = this.getIntervalInSeconds(interval);
      const duration = intervalSeconds * limit;
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - duration;

      // Convert to strings as the API expects string format
      const url = `${process.env.API_URL}/api/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${now}`;
      const response = await requestManager.directGet(url);

      const data = response.data;
      Logger.debug(
        `[KLINES] ${symbol}: Requested ${limit} candles, received ${data?.length || 0} candles`
      );

      return data;
    } catch (error) {
      Logger.error('getKLines - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Helper to convert interval string to seconds
   */
  getIntervalInSeconds(interval) {
    if (typeof interval !== 'string') return 300; // default 5m

    const match = interval.match(/^(\d+)([smhd])$/i);
    if (!match) return 300; // default 5m

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const unitToSeconds = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return (unitToSeconds[unit] || 60) * value;
  }

  async getAllMarkPrices(symbol) {
    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/markPrices`,
        {
          params: { symbol },
        },
        'Get All Mark Prices',
        'LOW'
      );
      return response.data;
    } catch (error) {
      console.error('getAllMarkPrices - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getOpenInterest(symbol) {
    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/openInterest`,
        {
          params: { symbol },
        },
        'Get Open Interest',
        'LOW'
      );
      return response.data;
    } catch (error) {
      console.error('getOpenInterest - ERROR!', error.response?.data || error.message);
      return null;
    }
  }

  async getFundingIntervalRates(symbol, limit = 100, offset = 0) {
    if (!symbol) {
      console.error('symbol required');
      return null;
    }

    try {
      const response = await requestManager.get(
        `${process.env.API_URL}/api/v1/fundingRates`,
        {
          params: { symbol, limit, offset },
        },
        'Get Funding Rates',
        'LOW'
      );
      return response.data;
    } catch (error) {
      console.error('getFundingIntervalRates - ERROR!', error.response?.data || error.message);
      return null;
    }
  }
}

export default Markets;
