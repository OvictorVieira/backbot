import { BaseStopLoss } from './BaseStopLoss.js';
import TrailingStop from '../../TrailingStop/TrailingStop.js';

export class ProMaxStopLoss extends BaseStopLoss {
  /**
   * Implementação do stop loss para estratégia PRO_MAX
   * @param {object} position - Dados da posição
   * @param {object} account - Dados da conta
   * @param {object} marketData - Dados de mercado atuais
   * @param {object} config - Configuração do bot
   * @returns {object|null} - Objeto com decisão de fechamento ou null se não deve fechar
   */
  shouldClosePosition(position, account, marketData, config = null) {
    try {
      // Validação inicial dos dados
      if (!this.validateData(position, account)) {
        return null;
      }

      // Usa config.enableTpValidation se disponível, senão assume false
      const ENABLE_TP_VALIDATION = config?.enableTpValidation === true;

      // Usa a função calculatePnL do TrailingStop
      const { pnl } = TrailingStop.calculatePnL(position, account);

      // ✅ REMOVIDO: Take profit agora é gerenciado APENAS pelo monitor dedicado (startTakeProfitMonitor)
      // Evita duplicação de lógica de take profit

      return null;
    } catch (error) {
      console.error('ProMaxStopLoss.shouldClosePosition - Error:', error);
      return null;
    }
  }
}
