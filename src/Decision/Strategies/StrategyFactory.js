import { DefaultStrategy } from './DefaultStrategy.js';
import { ProMaxStrategy } from './ProMaxStrategy.js';
import { AlphaFlowStrategy } from './AlphaFlowStrategy.js';
import HFTStrategy from './HFTStrategy.js';
import Logger from '../../Utils/Logger.js';

export class StrategyFactory {
  /**
   * Cria uma instância da estratégia baseada no tipo especificado
   * @param {string} strategyType - Tipo da estratégia ('DEFAULT', 'PRO_MAX')
   * @returns {BaseStrategy} - Instância da estratégia
   */
  static createStrategy(strategyType) {
    Logger.debug(`🔍 StrategyFactory: Tipo recebido: "${strategyType}"`);

    const strategy = strategyType?.toUpperCase() || 'DEFAULT';
    Logger.debug(`🔍 StrategyFactory: Tipo processado: "${strategy}"`);

    switch (strategy) {
      case 'DEFAULT':
        Logger.debug(`✅ StrategyFactory: Criando estratégia DEFAULT`);
        return new DefaultStrategy();
      case 'PRO_MAX':
        Logger.debug(`✅ StrategyFactory: Criando estratégia PRO_MAX`);
        return new ProMaxStrategy();
      case 'ALPHA_FLOW':
        Logger.debug(`✅ StrategyFactory: Criando estratégia ALPHA_FLOW`);
        return new AlphaFlowStrategy();
      case 'HFT':
        Logger.debug(`✅ StrategyFactory: Criando estratégia HFT`);
        return new HFTStrategy();
      default:
        Logger.warn(`⚠️ Estratégia "${strategy}" não encontrada, usando DEFAULT`);
        return new DefaultStrategy();
    }
  }

  /**
   * Lista todas as estratégias disponíveis
   * @returns {string[]} - Array com nomes das estratégias
   */
  static getAvailableStrategies() {
    return ['DEFAULT', 'PRO_MAX', 'ALPHA_FLOW', 'HFT'];
  }

  /**
   * Valida se uma estratégia é suportada
   * @param {string} strategyType - Tipo da estratégia
   * @returns {boolean} - True se a estratégia é válida
   */
  static isValidStrategy(strategyType) {
    return this.getAvailableStrategies().includes(strategyType?.toUpperCase());
  }
}
