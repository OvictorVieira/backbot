import { auth } from '../Backpack/Authenticated/Authentication.js';
import Logger from './Logger.js';

/**
 * BackpackAuth - Wrapper para autenticação que gera timestamp na hora da execução
 * Resolve problema de "Request has expired" causado por delays na fila do RequestManager
 */
class BackpackAuth {
  /**
   * Gera headers de autenticação com timestamp fresco
   * @param {Object} options - Opções de autenticação
   * @param {string} options.instruction - Instrução da API
   * @param {Object} options.params - Parâmetros da request
   * @param {string} options.apiKey - Chave da API
   * @param {string} options.apiSecret - Segredo da API
   * @param {number} options.window - Janela de tempo (padrão: 60000ms = 1 minuto)
   * @returns {Object} Headers de autenticação
   */
  static generateAuthHeaders({ instruction, params = {}, apiKey, apiSecret, window = 60000 }) {
    try {
      // Gera timestamp SEMPRE no momento da chamada
      const timestamp = Date.now();

      Logger.debug(
        `🔐 [BACKPACK_AUTH] Gerando headers para ${instruction} - Timestamp: ${timestamp}`
      );

      return auth({
        instruction,
        params,
        timestamp,
        window,
        apiKey,
        apiSecret,
      });
    } catch (error) {
      Logger.error(`❌ [BACKPACK_AUTH] Erro ao gerar headers para ${instruction}:`, error.message);
      throw error;
    }
  }

  /**
   * Cria uma função que gera headers de autenticação dinamicamente
   * Útil para requests que serão enfileiradas e executadas depois
   * @param {Object} options - Opções base de autenticação
   * @returns {Function} Função que gera headers frescos quando chamada
   */
  static createAuthHeaderGenerator(options) {
    return () => {
      return this.generateAuthHeaders(options);
    };
  }

  /**
   * Valida se o timestamp ainda está dentro da janela válida
   * @param {number} timestamp - Timestamp para validar
   * @param {number} window - Janela de tempo em ms
   * @returns {boolean} True se ainda é válido
   */
  static isTimestampValid(timestamp, window = 60000) {
    const now = Date.now();
    const age = now - timestamp;
    const isValid = age <= window;

    if (!isValid) {
      Logger.warn(`⚠️ [BACKPACK_AUTH] Timestamp expirado - Idade: ${age}ms, Limite: ${window}ms`);
    }

    return isValid;
  }

  /**
   * Verifica e regenera headers se necessário
   * @param {Object} existingHeaders - Headers existentes
   * @param {Object} authOptions - Opções para regenerar
   * @returns {Object} Headers válidos (existentes ou novos)
   */
  static ensureFreshHeaders(existingHeaders, authOptions) {
    if (!existingHeaders || !existingHeaders['X-Timestamp']) {
      Logger.debug(`🔄 [BACKPACK_AUTH] Headers não existem, gerando novos`);
      return this.generateAuthHeaders(authOptions);
    }

    const timestamp = parseInt(existingHeaders['X-Timestamp']);
    const window = parseInt(existingHeaders['X-Window'] || 60000);

    if (!this.isTimestampValid(timestamp, window)) {
      Logger.debug(`🔄 [BACKPACK_AUTH] Headers expirados, regenerando`);
      return this.generateAuthHeaders(authOptions);
    }

    Logger.debug(`✅ [BACKPACK_AUTH] Headers ainda válidos`);
    return existingHeaders;
  }
}

export default BackpackAuth;
