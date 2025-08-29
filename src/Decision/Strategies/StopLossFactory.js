import Logger from '../../Utils/Logger.js';

export class StopLossFactory {
  /**
   * Cria uma instância do stop loss baseada na estratégia
   * @param {string} strategyType - Tipo da estratégia ('DEFAULT', 'PRO_MAX')
   * @param {object} config - Configurações do bot (opcional)
   * @returns {BaseStopLoss} - Instância do stop loss
   */
  static async createStopLoss(strategyType, config = null) {
    const strategy = strategyType?.toUpperCase() || 'DEFAULT';

    switch (strategy) {
      case 'DEFAULT':
        const { DefaultStopLoss } = await import('./DefaultStopLoss.js');
        return new DefaultStopLoss(config);
      case 'PRO_MAX':
        const { ProMaxStopLoss } = await import('./ProMaxStopLoss.js');
        return new ProMaxStopLoss(config);
      default:
        if (strategy === 'ALPHA_FLOW') {
          Logger.debug(`🧠 ALPHAFLOW: Stop loss calculado internamente (-10% do preço de entrada)`);
        } else {
          Logger.warn(`⚠️ Stop loss para estratégia "${strategy}" não encontrado, usando DEFAULT`);
        }
        const { DefaultStopLoss: DefaultStopLossDefault } = await import('./DefaultStopLoss.js');
        return new DefaultStopLossDefault(config);
    }
  }

  /**
   * Lista todos os stop losses disponíveis
   * @returns {string[]} - Array com nomes dos stop losses
   */
  static getAvailableStopLosses() {
    return ['DEFAULT', 'PRO_MAX'];
  }

  /**
   * Valida se um stop loss é suportado
   * @param {string} strategyType - Tipo da estratégia
   * @returns {boolean} - True se o stop loss é válido
   */
  static isValidStopLoss(strategyType) {
    return this.getAvailableStopLosses().includes(strategyType?.toUpperCase());
  }
}
