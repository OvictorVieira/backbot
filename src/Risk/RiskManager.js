import Logger from '../Utils/Logger.js';

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

      Logger.debug(`💰 [RISK] Capital disponível: $${capitalAvailable.toFixed(2)}`);
      Logger.debug(`💰 [RISK] Porcentagem configurada: ${capitalPercentage}%`);
      Logger.debug(`💰 [RISK] Investimento calculado: $${investmentUSD.toFixed(2)}`);

      return investmentUSD;
    } catch (error) {
      Logger.error('❌ [RISK] Erro ao calcular investimento:', error.message);
      return 1;
    }
  }
}

export default RiskManager;
