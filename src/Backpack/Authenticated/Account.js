import Logger from '../../Utils/Logger.js';
import requestManager from '../../Utils/RequestManager.js';
import { auth } from './Authentication.js';

class Account {
  async getAccount(strategy = null, apiKey = null, apiSecret = null) {
    try {
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
}

export default new Account();
