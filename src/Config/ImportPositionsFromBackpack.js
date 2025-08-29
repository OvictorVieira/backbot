import Futures from '../Backpack/Authenticated/Futures.js';
import BotOrdersManager, { initializeBotOrdersManager } from './BotOrdersManager.js';

class ImportPositionsFromBackpack {
  /**
   * Importa posições ativas de um bot específico
   */
  static async importActivePositions(botId) {
    try {
      console.log(`🔍 [IMPORT_POSITIONS] Importando posições ativas para Bot ${botId}`);

      // Buscar posições ativas da Backpack
      const positions = await Futures.getOpenPositions();

      if (!positions || !Array.isArray(positions)) {
        console.log(`⚠️ [IMPORT_POSITIONS] Nenhuma posição encontrada ou formato inválido`);
        return {
          success: false,
          message: 'Nenhuma posição encontrada',
          imported: 0,
        };
      }

      console.log(`📊 [IMPORT_POSITIONS] Encontradas ${positions.length} posições ativas`);

      let importedCount = 0;

      for (const position of positions) {
        try {
          const symbol = position.symbol;
          const quantity = position.netQuantity || position.quantity;
          const price = position.avgPrice || position.entryPrice;

          // Só importa se tem quantidade
          if (quantity && quantity > 0) {
            console.log(
              `📝 [IMPORT_POSITIONS] Importando posição: ${symbol} - ${quantity} @ ${price}`
            );

            // Determina o lado baseado na quantidade
            const side = quantity > 0 ? 'BUY' : 'SELL';
            const absQuantity = Math.abs(quantity);

            // Adiciona à persistência
            await BotOrdersManager.addOrder(
              botId,
              `POSITION_${Date.now()}_${importedCount}`, // ID único para posição
              symbol,
              side,
              absQuantity,
              price,
              'POSITION_IMPORT'
            );

            importedCount++;
          }
        } catch (error) {
          console.error(`❌ [IMPORT_POSITIONS] Erro ao importar posição:`, error.message);
        }
      }

      console.log(`✅ [IMPORT_POSITIONS] Importadas ${importedCount} posições para Bot ${botId}`);

      return {
        success: true,
        message: `Importadas ${importedCount} posições`,
        imported: importedCount,
        totalPositions: positions.length,
      };
    } catch (error) {
      console.error(`❌ [IMPORT_POSITIONS] Erro ao importar posições:`, error.message);
      return {
        success: false,
        message: error.message,
        imported: 0,
      };
    }
  }

  /**
   * Importa posições ativas de todos os bots habilitados
   */
  static async importAllBotsPositions() {
    try {
      console.log(`🔍 [IMPORT_POSITIONS] Importando posições para todos os bots`);

      // Buscar posições ativas da Backpack
      const positions = await Futures.getOpenPositions();

      if (!positions || !Array.isArray(positions)) {
        console.log(`⚠️ [IMPORT_POSITIONS] Nenhuma posição encontrada`);
        return {
          success: false,
          message: 'Nenhuma posição encontrada',
          imported: 0,
        };
      }

      console.log(`📊 [IMPORT_POSITIONS] Encontradas ${positions.length} posições ativas`);

      // Para cada posição, tenta associar a um bot
      let importedCount = 0;

      for (const position of positions) {
        try {
          const symbol = position.symbol;
          const quantity = position.netQuantity || position.quantity;
          const price = position.avgPrice || position.entryPrice;

          if (quantity && quantity > 0) {
            // Tenta associar a um bot baseado no símbolo ou outras características
            // Por enquanto, vamos importar para o bot 1 (bot principal)
            const botId = 1;

            console.log(
              `📝 [IMPORT_POSITIONS] Importando posição: ${symbol} - ${quantity} @ ${price} para Bot ${botId}`
            );

            const side = quantity > 0 ? 'BUY' : 'SELL';
            const absQuantity = Math.abs(quantity);

            await BotOrdersManager.addOrder(
              botId,
              `POSITION_${Date.now()}_${importedCount}`,
              symbol,
              side,
              absQuantity,
              price,
              'POSITION_IMPORT'
            );

            importedCount++;
          }
        } catch (error) {
          console.error(`❌ [IMPORT_POSITIONS] Erro ao importar posição:`, error.message);
        }
      }

      console.log(`✅ [IMPORT_POSITIONS] Importadas ${importedCount} posições para todos os bots`);

      return {
        success: true,
        message: `Importadas ${importedCount} posições`,
        imported: importedCount,
        totalPositions: positions.length,
      };
    } catch (error) {
      console.error(`❌ [IMPORT_POSITIONS] Erro ao importar posições:`, error.message);
      return {
        success: false,
        message: error.message,
        imported: 0,
      };
    }
  }
}

export default ImportPositionsFromBackpack;
