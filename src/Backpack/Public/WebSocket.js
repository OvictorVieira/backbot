import WebSocket from 'ws';
import Logger from '../../Utils/Logger.js';

class BackpackWebSocket {
  constructor() {
    this.ws = null;
    this.subscribedSymbols = new Set();
    this.priceCallbacks = new Map(); // symbol -> callback function
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1 segundo inicial
    this.isConnected = false;
    this.heartbeatInterval = null;

    // Throttling para evitar spam de atualizações
    this.lastUpdate = new Map(); // symbol -> timestamp
    this.updateThrottle = 10000; // 10 segundos mínimo entre atualizações (reduz spam de logs)
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
      const message = JSON.parse(data.toString());

      if (message.error) {
        Logger.error(`❌ [BACKPACK_WS] Erro do servidor:`, message.error);
        return;
      }

      if (message.result !== undefined || message.id !== undefined) {
        Logger.debug(`✅ [BACKPACK_WS] Mensagem de controle recebida:`, message);
        return;
      }

      const messageData = message.data;

      if (messageData.e === 'bookTicker') {
        // Reduz spam de logs - só loga se for processar a atualização
        this.handlePriceUpdate(messageData);
      }
    } catch (error) {
      Logger.error('❌ [BACKPACK_WS] Erro ao processar mensagem:', error.message);
      Logger.error('❌ [BACKPACK_WS] Dados raw:', data.toString());
    }
  }

  /**
   * Processa atualizações de preço com throttling
   */
  handlePriceUpdate(data) {
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

      if (this.priceCallbacks.has(symbol)) {
        // Throttling para logs (evita spam)
        const now = Date.now();
        const lastLog = this.lastUpdate.get(symbol) || 0;

        if (now - lastLog > this.updateThrottle) {
          Logger.info(`📊 [BACKPACK_WS] ${symbol}: Preço atualizado para ${currentPrice}`);
          this.lastUpdate.set(symbol, now);
        }

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
   * Configura throttle de atualizações
   */
  setUpdateThrottle(milliseconds) {
    this.updateThrottle = milliseconds;
    Logger.info(`⚡ [BACKPACK_WS] Update throttle configurado para ${milliseconds}ms`);
  }
}

export default BackpackWebSocket;
