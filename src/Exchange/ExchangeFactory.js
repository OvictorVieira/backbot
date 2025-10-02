import Logger from '../Utils/Logger.js';
import { BackpackExchange } from './BackpackExchange.js';

/**
 * Factory para criar instâncias de exchanges de forma centralizada.
 * Permite a adição de novas exchanges sem modificar a lógica principal.
 */
export class ExchangeFactory {
  /**
   * Cria uma instância de uma exchange com base no nome.
   * @param {string} exchangeName - Nome da exchange (ex:
   * 'Backpack', 'Pacifica').
   * @returns {BaseExchange} - Instância da exchange.
   */
  static createExchange(exchangeName) {
    const name = exchangeName?.toUpperCase() || 'BACKPACK';

    switch (name) {
      case 'BACKPACK':
        Logger.debug(`✅ ExchangeFactory: Criando instância para Backpack`);
        return new BackpackExchange();
      case 'PACIFICA':
        // Futura implementação
        // import { PacificaExchange } from './PacificaExchange.js';
        // return new PacificaExchange();
        throw new Error('Exchange Pacifica ainda não implementada.');
      default:
        Logger.warn(`⚠️ Exchange "${name}" não encontrada, usando Backpack por padrão.`);
        return new BackpackExchange();
    }
  }
}

export default ExchangeFactory;
