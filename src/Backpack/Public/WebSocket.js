import WebSocket from 'ws';
import Logger from '../../Utils/Logger.js';
import { auth } from '../Authenticated/Authentication.js';
import PositionMonitorService from '../../Services/PositionMonitorService.js';
import LimitOrderValidator from '../../Utils/LimitOrderValidator.js';

class BackpackWebSocket {
  constructor() {
    this.ws = null;
    this.subscribedSymbols = new Set();
    this.priceCallbacks = new Map(); // symbol -> callback function
    this.userTradeCallbacks = new Map(); // userId -> callback function
    this.authenticatedChannels = new Set(); // Track authenticated subscriptions
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1 segundo inicial
    this.isConnected = false;
    this.heartbeatInterval = null;

    // Throttling para evitar spam de atualizações
    this.lastUpdate = new Map(); // symbol -> timestamp
    this.updateThrottle = 10000; // 10 segundos mínimo entre atualizações (reduz spam de logs)

    // Injeção do serviço de monitoramento de posições
    this.positionMonitor = PositionMonitorService;
  }

  /**
   * Conecta ao WebSocket da Backpack
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://ws.backpack.exchange');

        this.ws.on('open', () => {
          Logger.info('🔌 [BACKPACK_WS] WebSocket conectado com sucesso');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', data => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          Logger.warn(`🔌 [BACKPACK_WS] WebSocket fechado: ${code} - ${reason}`);
          this.isConnected = false;
          this.stopHeartbeat();
          this.handleReconnect();
        });

        this.ws.on('error', error => {
          Logger.error('❌ [BACKPACK_WS] Erro no WebSocket:', error.message);
          this.isConnected = false;
          reject(error);
        });

        // Timeout de conexão
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Timeout na conexão WebSocket'));
          }
        }, 10000);
      } catch (error) {
        Logger.error('❌ [BACKPACK_WS] Erro ao conectar WebSocket:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Processa mensagens recebidas do WebSocket
   */
  handleMessage(data) {
    try {
      // Convert Buffer to string and validate it's valid JSON
      let dataString;
      if (Buffer.isBuffer(data)) {
        dataString = data.toString('utf8');
      } else {
        dataString = data.toString();
      }

      // Log raw data for debugging
      Logger.debug(`📥 [BACKPACK_WS] Raw message received:`, dataString);

      const message = JSON.parse(dataString);

      if (message.error) {
        Logger.error(`❌ [BACKPACK_WS] Erro do servidor:`, message.error);
        return;
      }

      if (message.result !== undefined || message.id !== undefined) {
        Logger.debug(`✅ [BACKPACK_WS] Mensagem de controle recebida:`, message);
        return;
      }

      const messageData = message.data || message;

      if (messageData.e === 'bookTicker') {
        // Reduz spam de logs - só loga se for processar a atualização
        this.handlePriceUpdate(messageData);
      } else if (
        messageData.e === 'orderAccepted' ||
        messageData.e === 'orderCancelled' ||
        messageData.e === 'orderExpired' ||
        messageData.e === 'orderFill' ||
        messageData.e === 'orderModified'
      ) {
        // Handle authenticated order updates from account.orderUpdate stream
        this.handleUserTradeUpdate(messageData);
      } else if (
        messageData.e === 'positionAdjusted' ||
        messageData.e === 'positionOpened' ||
        messageData.e === 'positionClosed'
      ) {
        // Handle position updates from account.positionUpdate stream
        this.handlePositionUpdate(messageData);
      } else if (messageData.e === 'accountUpdate') {
        // Handle account balance updates
        this.handleAccountUpdate(messageData);
      } else if (messageData.stream && messageData.stream.startsWith('account.orderUpdate.')) {
        // Handle authenticated order updates from private channels for specific symbols
        const symbol = messageData.stream.split('.')[2]; // Extract symbol from stream name
        Logger.info(
          `🔔 [BACKPACK_WS] Received authenticated order update for ${symbol}:`,
          messageData
        );

        // Add symbol to the data if not present
        const tradeData = messageData.data || messageData;
        if (!tradeData.symbol && !tradeData.s) {
          tradeData.symbol = symbol;
        }

        this.handleUserTradeUpdate(tradeData);
      } else if (messageData.stream && messageData.stream.includes('account')) {
        // Handle other authenticated account updates
        Logger.debug(`📊 [BACKPACK_WS] Received authenticated account update:`, messageData);
        this.handleAccountUpdate(messageData.data || messageData);
      }
    } catch (error) {
      Logger.error('❌ [BACKPACK_WS] Erro ao processar mensagem:', error.message);

      // Log raw data for debugging
      let rawData;
      if (Buffer.isBuffer(data)) {
        rawData = data.toString('utf8');
      } else {
        rawData = data.toString();
      }

      Logger.error('❌ [BACKPACK_WS] Dados raw:', rawData);
      Logger.error('❌ [BACKPACK_WS] Data type:', typeof data);
      Logger.error('❌ [BACKPACK_WS] Is Buffer:', Buffer.isBuffer(data));
    }
  }

  /**
   * Processa atualizações de preço com throttling
   */
  async handlePriceUpdate(data) {
    const now = Date.now();
    const symbol = data.s;
    const lastUpdateTime = this.lastUpdate.get(symbol) || 0;

    // Throttling - só processa se passou tempo suficiente
    if (now - lastUpdateTime < this.updateThrottle) {
      return;
    }

    this.lastUpdate.set(symbol, now);

    // Extrai preço dependendo do tipo de stream
    if (data.e === 'bookTicker') {
      const bidPrice = parseFloat(data.b);
      const askPrice = parseFloat(data.a);
      const bidQty = parseFloat(data.B);
      const askQty = parseFloat(data.A);

      let currentPrice = (bidPrice + askPrice) / 2;

      if (bidQty && askQty) {
        currentPrice = (askPrice * bidQty + bidPrice * askQty) / (askQty + bidQty);
      }

      // 1️⃣ Valida posições abertas (SL/TP)
      if (this.positionMonitor) {
        await this.positionMonitor.checkPositionThresholds(symbol, currentPrice);
      }

      await LimitOrderValidator.updatePrice(symbol, currentPrice);

      // 3️⃣ Executa callbacks customizados
      if (this.priceCallbacks.has(symbol)) {
        const callback = this.priceCallbacks.get(symbol);
        try {
          callback(symbol, currentPrice, data);
        } catch (error) {
          Logger.error(`❌ [BACKPACK_WS] Erro no callback para ${symbol}:`, error.message);
        }
      }
    }
  }

  /**
   * Subscribe a um símbolo para receber atualizações de preço
   */
  async subscribeSymbol(symbol, callback) {
    if (!this.isConnected) {
      throw new Error('WebSocket não conectado');
    }

    // Registra callback
    this.priceCallbacks.set(symbol, callback);
    this.subscribedSymbols.add(symbol);

    // Subscribe ao bookTicker (melhor para trailing stop)
    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: [`bookTicker.${symbol}`],
    };

    Logger.info(`📡 [BACKPACK_WS] Subscribing to ${symbol}...`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Unsubscribe de um símbolo
   */
  async unsubscribeSymbol(symbol) {
    if (!this.isConnected || !this.subscribedSymbols.has(symbol)) {
      return;
    }

    const unsubscribeMessage = {
      method: 'UNSUBSCRIBE',
      params: [`bookTicker.${symbol}`],
    };

    Logger.info(`📡 [BACKPACK_WS] Unsubscribing from ${symbol}...`);
    this.ws.send(JSON.stringify(unsubscribeMessage));

    this.priceCallbacks.delete(symbol);
    this.subscribedSymbols.delete(symbol);
    this.lastUpdate.delete(symbol);
  }

  /**
   * Subscribe a múltiplos símbolos de uma vez
   */
  async subscribeMultipleSymbols(symbols, callback) {
    if (!this.isConnected) {
      throw new Error('WebSocket não conectado');
    }

    const streams = symbols.map(symbol => `bookTicker.${symbol}`);

    // Registra callbacks para todos os símbolos
    symbols.forEach(symbol => {
      this.priceCallbacks.set(symbol, callback);
      this.subscribedSymbols.add(symbol);
    });

    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: streams,
    };

    Logger.info(`📡 [BACKPACK_WS] Subscribing to ${symbols.length} symbols: ${symbols.join(', ')}`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Heartbeat para manter conexão viva
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        Logger.debug('💓 [BACKPACK_WS] Heartbeat enviado');
      }
    }, 30000); // 30 segundos
  }

  /**
   * Para heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Lógica de reconexão automática
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      Logger.error('❌ [BACKPACK_WS] Máximo de tentativas de reconexão atingido');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Backoff exponencial

    Logger.info(
      `🔄 [BACKPACK_WS] Tentativa de reconexão ${this.reconnectAttempts}/${this.maxReconnectAttempts} em ${delay}ms`
    );

    setTimeout(async () => {
      try {
        await this.connect();

        // Re-subscribe aos símbolos anteriores
        if (this.subscribedSymbols.size > 0) {
          const symbols = Array.from(this.subscribedSymbols);
          Logger.info(`🔄 [BACKPACK_WS] Re-subscribing to ${symbols.length} symbols`);

          const streams = symbols.map(symbol => `bookTicker.${symbol}`);
          const subscribeMessage = {
            method: 'SUBSCRIBE',
            params: streams,
          };

          this.ws.send(JSON.stringify(subscribeMessage));
        }
      } catch (error) {
        Logger.error('❌ [BACKPACK_WS] Falha na reconexão:', error.message);
        this.handleReconnect(); // Tenta novamente
      }
    }, delay);
  }

  /**
   * Desconecta do WebSocket
   */
  disconnect() {
    Logger.info('🔌 [BACKPACK_WS] Desconectando WebSocket...');

    this.stopHeartbeat();
    this.isConnected = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Limpa dados
    this.subscribedSymbols.clear();
    this.priceCallbacks.clear();
    this.lastUpdate.clear();
    this.reconnectAttempts = 0;
  }

  /**
   * Getter para status de conexão
   */
  get connected() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Processa atualizações de user trades/orders
   */
  handleUserTradeUpdate(data) {
    try {
      // Log the user trade event
      Logger.info(
        `💰 [BACKPACK_WS] User trade update: ${data.e} for ${data.s || 'unknown symbol'}`
      );

      // Call all registered user trade callbacks
      for (const [userId, callback] of this.userTradeCallbacks.entries()) {
        try {
          callback(data);
        } catch (error) {
          Logger.error(
            `❌ [BACKPACK_WS] Erro no callback de user trade para ${userId}:`,
            error.message
          );
        }
      }
    } catch (error) {
      Logger.error('❌ [BACKPACK_WS] Erro ao processar user trade update:', error.message);
    }
  }

  /**
   * Processa atualizações de account
   */
  handleAccountUpdate(data) {
    try {
      Logger.debug(`📊 [BACKPACK_WS] Account update received`);

      // Call all registered user trade callbacks for account updates too
      for (const [userId, callback] of this.userTradeCallbacks.entries()) {
        try {
          callback(data);
        } catch (error) {
          Logger.error(
            `❌ [BACKPACK_WS] Erro no callback de account update para ${userId}:`,
            error.message
          );
        }
      }
    } catch (error) {
      Logger.error('❌ [BACKPACK_WS] Erro ao processar account update:', error.message);
    }
  }

  /**
   * Processa atualizações de posições via account.positionUpdate
   */
  handlePositionUpdate(data) {
    try {
      Logger.info(`📊 [BACKPACK_WS] Position update: ${data.e} for ${data.s || 'unknown symbol'}`);

      // For now, we can forward position updates to the same callbacks
      // In the future, we might want separate position callbacks
      for (const [userId, callback] of this.userTradeCallbacks.entries()) {
        try {
          callback(data);
        } catch (error) {
          Logger.error(
            `❌ [BACKPACK_WS] Erro no callback de position update para ${userId}:`,
            error.message
          );
        }
      }
    } catch (error) {
      Logger.error('❌ [BACKPACK_WS] Erro ao processar position update:', error.message);
    }
  }

  /**
   * Subscribe to authenticated user trade updates
   */
  async subscribeUserTrades(apiKey, apiSecret, callback) {
    if (!this.isConnected) {
      throw new Error('WebSocket não conectado');
    }

    // Store callback with unique key
    const userId = apiKey.substring(0, 8); // Use first 8 chars of API key as identifier
    this.userTradeCallbacks.set(userId, callback);

    try {
      // Create authenticated subscription for account updates
      const timestamp = Date.now(); // Use milliseconds as per docs
      const instruction = 'subscribe';
      const window = 30000; // 30 seconds window

      // Generate signature for authenticated subscription
      const authData = auth({
        instruction,
        timestamp,
        window,
        params: {}, // Empty params object for WebSocket auth
        apiKey,
        apiSecret,
      });

      Logger.debug(`📡 [BACKPACK_WS] Auth data generated:`, {
        hasSignature: !!authData['X-Signature'],
        apiKey: apiKey?.substring(0, 8) + '...',
        timestamp,
        window,
      });

      // Use the official Backpack authenticated stream names from documentation
      const authenticatedStreams = [
        'account.orderUpdate', // Order mutations (orderAccepted, orderCancelled, orderFill, etc.)
        'account.positionUpdate', // Position updates (positionOpened, positionClosed, etc.)
      ];

      for (const stream of authenticatedStreams) {
        const subscribeMessage = {
          method: 'SUBSCRIBE',
          params: [stream],
          signature: [
            authData['X-API-Key'], // verifying key (base64)
            authData['X-Signature'], // signature (base64)
            authData['X-Timestamp'], // timestamp
            authData['X-Window'], // window
          ],
        };

        Logger.info(`📡 [BACKPACK_WS] Subscribing to official authenticated stream: ${stream}`);
        Logger.debug(`📡 [BACKPACK_WS] Subscription message:`, subscribeMessage);

        this.ws.send(JSON.stringify(subscribeMessage));

        // Store authenticated channel
        this.authenticatedChannels.add(stream);
      }

      Logger.info(
        `✅ [BACKPACK_WS] Authenticated monitoring enabled for user ${userId} with ${authenticatedStreams.length} official streams`
      );
    } catch (error) {
      Logger.error(
        `❌ [BACKPACK_WS] Failed to subscribe to authenticated channels:`,
        error.message
      );
      Logger.warn(`⚠️ [BACKPACK_WS] Falling back to polling method`);
    }
  }

  /**
   * Unsubscribe from user trade updates
   */
  async unsubscribeUserTrades(apiKey) {
    const userId = apiKey.substring(0, 8);

    if (!this.userTradeCallbacks.has(userId)) {
      return;
    }

    // Remove callback
    this.userTradeCallbacks.delete(userId);

    // If no more user callbacks, unsubscribe from authenticated channels
    if (this.userTradeCallbacks.size === 0) {
      const channels = Array.from(this.authenticatedChannels);

      for (const channel of channels) {
        const unsubscribeMessage = {
          method: 'UNSUBSCRIBE',
          params: [channel],
          id: Date.now(),
        };

        Logger.info(`📡 [BACKPACK_WS] Unsubscribing from authenticated channel: ${channel}`);
        this.ws.send(JSON.stringify(unsubscribeMessage));
        this.authenticatedChannels.delete(channel);
      }
    }

    Logger.info(`✅ [BACKPACK_WS] User trade monitoring disabled for user ${userId}`);
  }

  /**
   * Configura throttle de atualizações
   */
  setUpdateThrottle(milliseconds) {
    this.updateThrottle = milliseconds;
    Logger.info(`⚡ [BACKPACK_WS] Update throttle configurado para ${milliseconds}ms`);
  }
}

export default BackpackWebSocket;
