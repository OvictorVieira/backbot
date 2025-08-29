import Logger from '../Utils/Logger.js';
import QuantityCalculator from '../Utils/QuantityCalculator.js';

/**
 * Classe centralizada para gerenciamento de risco e cálculo de tamanho de posições
 * Responsável por garantir que todas as posições respeitem o capitalPercentage definido pelo usuário
 */
export class RiskManager {
  constructor() {
    this.name = 'RiskManager';
  }

  /**
   * Calcula o investimento total baseado no capital disponível e capitalPercentage
   * @param {number} capitalAvailable - Capital disponível na conta
   * @param {object} config - Configuração do bot com capitalPercentage
   * @returns {number} - Valor em USD para investimento
   */
  static calculateInvestmentAmount(capitalAvailable, config = {}) {
    try {
      let capitalPercentage =
        config?.capitalPercentage !== null && config?.capitalPercentage !== undefined
          ? config.capitalPercentage
          : 1;

      if (capitalPercentage <= 0) {
        Logger.warn('⚠️ [RISK] capitalPercentage inválido, usando fallback de 1%');
        capitalPercentage = 1;
      }

      const investmentUSD = (capitalAvailable * capitalPercentage) / 100;

      // 🔍 LOG CRÍTICO DO CÁLCULO DE INVESTMENT
      Logger.error(`🚨 [RISK_CALC] CÁLCULO DO INVESTMENT:`);
      Logger.error(`   • capitalAvailable (recebido): $${capitalAvailable.toFixed(2)}`);
      Logger.error(`   • capitalPercentage (config): ${capitalPercentage}%`);
      Logger.error(
        `   • investmentUSD = $${capitalAvailable.toFixed(2)} × ${capitalPercentage}% / 100 = $${investmentUSD.toFixed(2)}`
      );

      return investmentUSD;
    } catch (error) {
      Logger.error('❌ [RISK] Erro ao calcular investimento:', error.message);
      return 1;
    }
  }

  /**
   * Distribui capital entre múltiplas ordens escalonadas com validação de risco
   * @param {number} totalInvestmentUSD - Investment total em USD
   * @param {Array} weights - Pesos percentuais [50, 30, 20]
   * @param {Array} entryPrices - Preços de entrada para cada ordem
   * @param {string} market - Nome do mercado
   * @param {string} symbol - Símbolo do ativo
   * @param {object} marketInfo - Informações do mercado (decimal_quantity, etc)
   * @returns {Array} Array com ordens validadas pelo RiskManager
   * @deprecated Usar QuantityCalculator.calculateScaledPositions() diretamente
   */
  static distributeCapitalAcrossOrders(
    totalInvestmentUSD,
    weights,
    entryPrices,
    market = 'UNKNOWN',
    symbol = 'UNKNOWN',
    marketInfo = {}
  ) {
    Logger.warn(
      `⚠️ [RISK] ${symbol}: Método distributeCapitalAcrossOrders DEPRECADO. Use QuantityCalculator.calculateScaledPositions()`
    );

    try {
      Logger.debug(
        `💰 [RISK] Distribuindo $${totalInvestmentUSD.toFixed(2)} entre ${weights.length} ordens para ${symbol}`
      );

      if (!entryPrices || entryPrices.length !== weights.length) {
        Logger.error(
          `❌ [RISK] ${symbol}: Número de pesos (${weights.length}) difere de preços (${entryPrices?.length || 0})`
        );
        return [];
      }

      // Usa o método deprecado para compatibilidade temporária
      const decimalQuantity = marketInfo?.decimal_quantity || 8;
      const scaledOrders = QuantityCalculator.calculateScaledOrders(
        totalInvestmentUSD,
        entryPrices[0], // Usa primeiro preço como referência (será recalculado por ordem)
        decimalQuantity,
        weights,
        symbol
      );

      // Recalcula cada ordem com seu preço específico
      const validatedOrders = [];

      for (let i = 0; i < scaledOrders.length; i++) {
        const scaledOrder = scaledOrders[i];
        const specificEntryPrice = entryPrices[i];

        // Recalcula com preço específico desta ordem
        const orderResult = QuantityCalculator.calculateAndValidateQuantity(
          scaledOrder.targetVolume,
          specificEntryPrice,
          marketInfo,
          `${symbol}_${i + 1}`
        );

        if (orderResult.isValid) {
          validatedOrders.push({
            orderNumber: i + 1,
            weight: scaledOrder.weight,
            price: specificEntryPrice,
            quantity: orderResult.quantity,
            value: orderResult.orderValue,
            targetVolume: scaledOrder.targetVolume,
          });
        } else {
          Logger.warn(`⚠️ [RISK] ${symbol}: Ordem ${i + 1} rejeitada: ${orderResult.error}`);
        }
      }

      const totalValidatedValue = validatedOrders.reduce((sum, order) => sum + order.value, 0);
      Logger.info(
        `✅ [RISK] ${symbol}: ${validatedOrders.length}/${weights.length} ordens validadas - Total: $${totalValidatedValue.toFixed(2)}`
      );

      return validatedOrders;
    } catch (error) {
      Logger.error(`❌ [RISK] Erro ao distribuir capital para ${symbol}:`, error.message);
      return [];
    }
  }
}

export default RiskManager;
