import fs from 'fs';
import path from 'path';

class BotOrdersManager {
  constructor() {
    this.ordersFile = path.join(process.cwd(), 'persistence', 'bot_orders.json');
    console.log(`🔍 [BOT_ORDERS] Inicializando com arquivo: ${this.ordersFile}`);
    this.orders = this.loadOrders();
    console.log(`🔍 [BOT_ORDERS] Ordens carregadas: ${this.orders.orders.length}`);
  }

  /**
   * Carrega as ordens do arquivo JSON
   */
  loadOrders() {
    try {
      console.log(`🔍 [LOAD_ORDERS] Verificando arquivo: ${this.ordersFile}`);
      if (fs.existsSync(this.ordersFile)) {
        console.log(`✅ [LOAD_ORDERS] Arquivo existe`);
        const data = fs.readFileSync(this.ordersFile, 'utf8');
        console.log(`📄 [LOAD_ORDERS] Dados lidos: ${data.length} caracteres`);
        const parsed = JSON.parse(data);
        console.log(`📊 [LOAD_ORDERS] Ordens parseadas: ${parsed.orders?.length || 0}`);
        return parsed;
      }
      console.log(`⚠️ [LOAD_ORDERS] Arquivo não existe, criando estrutura vazia`);
      return { orders: [] };
    } catch (error) {
      console.error('❌ Erro ao carregar ordens dos bots:', error.message);
      return { orders: [] };
    }
  }

  /**
   * Salva as ordens no arquivo JSON
   */
  saveOrders() {
    try {
      const dir = path.dirname(this.ordersFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.ordersFile, JSON.stringify(this.orders, null, 2));
      console.log(`💾 Ordens salvas em: ${this.ordersFile}`);
    } catch (error) {
      console.error('❌ Erro ao salvar ordens dos bots:', error.message);
    }
  }

  /**
   * Adiciona uma nova ordem do bot
   * @param {number} botId - ID do bot
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {string} symbol - Símbolo da ordem
   * @param {string} side - Lado da ordem (BUY/SELL)
   * @param {number} quantity - Quantidade
   * @param {number} price - Preço
   * @param {string} orderType - Tipo da ordem (MARKET/LIMIT)
   */
  addOrder(botId, externalOrderId, symbol, side, quantity, price, orderType) {
    const order = {
      botId,
      externalOrderId,
      symbol,
      side,
      quantity,
      price,
      orderType,
      timestamp: new Date().toISOString()
    };

    this.orders.orders.push(order);
    this.saveOrders();
    
    console.log(`📝 [BOT_ORDERS] Ordem registrada: Bot ${botId} -> Order ${externalOrderId} (${symbol} ${side} ${quantity})`);
  }

  /**
   * Busca todas as ordens de um bot específico
   * @param {number} botId - ID do bot
   * @returns {Array} Lista de ordens do bot
   */
  getBotOrders(botId) {
    console.log(`🔍 [BOT_ORDERS] Buscando ordens para Bot ${botId}`);
    console.log(`🔍 [BOT_ORDERS] Total de ordens no sistema: ${this.orders.orders.length}`);
    const botOrders = this.orders.orders.filter(order => order.botId === botId);
    console.log(`🔍 [BOT_ORDERS] Ordens encontradas para Bot ${botId}: ${botOrders.length}`);
    return botOrders;
  }

  /**
   * Busca uma ordem específica pelo externalOrderId
   * @param {string} externalOrderId - ID da ordem na exchange
   * @returns {Object|null} Ordem encontrada ou null
   */
  getOrderByExternalId(externalOrderId) {
    return this.orders.orders.find(order => order.externalOrderId === externalOrderId) || null;
  }

  /**
   * Verifica se uma ordem pertence a um bot
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {number} botId - ID do bot
   * @returns {boolean} True se a ordem pertence ao bot
   */
  isOrderFromBot(externalOrderId, botId) {
    const order = this.getOrderByExternalId(externalOrderId);
    return order && order.botId === botId;
  }

  /**
   * Remove uma ordem (quando cancelada ou expirada)
   * @param {string} externalOrderId - ID da ordem na exchange
   */
  removeOrder(externalOrderId) {
    const index = this.orders.orders.findIndex(order => order.externalOrderId === externalOrderId);
    if (index !== -1) {
      const removedOrder = this.orders.orders.splice(index, 1)[0];
      this.saveOrders();
      console.log(`🗑️ [BOT_ORDERS] Ordem removida: ${externalOrderId} (Bot ${removedOrder.botId})`);
    }
  }

  /**
   * Atualiza uma ordem existente
   * @param {string} externalOrderId - ID da ordem na exchange
   * @param {Object} updates - Campos a serem atualizados
   */
  updateOrder(externalOrderId, updates) {
    const order = this.getOrderByExternalId(externalOrderId);
    if (order) {
      Object.assign(order, updates);
      order.lastUpdated = new Date().toISOString();
      this.saveOrders();
      console.log(`✏️ [BOT_ORDERS] Ordem atualizada: ${externalOrderId}`);
    }
  }

  /**
   * Obtém estatísticas das ordens de um bot
   * @param {number} botId - ID do bot
   * @returns {Object} Estatísticas das ordens
   */
  getBotOrderStats(botId) {
    const botOrders = this.getBotOrders(botId);
    
    return {
      totalOrders: botOrders.length,
      buyOrders: botOrders.filter(order => order.side === 'BUY').length,
      sellOrders: botOrders.filter(order => order.side === 'SELL').length,
      symbols: [...new Set(botOrders.map(order => order.symbol))],
      firstOrder: botOrders.length > 0 ? botOrders[0].timestamp : null,
      lastOrder: botOrders.length > 0 ? botOrders[botOrders.length - 1].timestamp : null
    };
  }

  /**
   * Limpa ordens antigas (opcional - para manutenção)
   * @param {number} daysOld - Número de dias para considerar como "antiga"
   */
  cleanOldOrders(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const initialCount = this.orders.orders.length;
    this.orders.orders = this.orders.orders.filter(order => {
      return new Date(order.timestamp) > cutoffDate;
    });
    
    const removedCount = initialCount - this.orders.orders.length;
    if (removedCount > 0) {
      this.saveOrders();
      console.log(`🧹 [BOT_ORDERS] ${removedCount} ordens antigas removidas`);
    }
  }
}

export default new BotOrdersManager();
