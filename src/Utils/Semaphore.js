import Logger from './Logger.js';

/**
 * Implementação de semáforo para controlar acesso concorrente a recursos críticos
 * Garante que validações e operações críticas sejam executadas sequencialmente
 */
class Semaphore {
  constructor(permits = 1) {
    this.permits = permits;
    this.waitQueue = [];
    this.currentPermits = permits;
  }

  /**
   * Adquire uma permissão do semáforo
   * @param {string} identifier - Identificador da operação (para debug)
   * @returns {Promise<Function>} - Release function para liberar a permissão
   */
  async acquire(identifier = 'unknown') {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (this.currentPermits > 0) {
          this.currentPermits--;
          Logger.debug(
            `🔒 [SEMAPHORE] ${identifier}: Permissão adquirida (${this.currentPermits}/${this.permits} disponíveis)`
          );

          // Retorna função de release
          const release = () => {
            this.currentPermits++;
            Logger.debug(
              `🔓 [SEMAPHORE] ${identifier}: Permissão liberada (${this.currentPermits}/${this.permits} disponíveis)`
            );

            // Processa próximo na fila se houver
            if (this.waitQueue.length > 0) {
              const nextResolve = this.waitQueue.shift();
              setImmediate(() => nextResolve());
            }
          };

          resolve(release);
        } else {
          // Adiciona na fila de espera
          Logger.debug(
            `⏳ [SEMAPHORE] ${identifier}: Aguardando permissão (${this.waitQueue.length + 1} na fila)`
          );
          this.waitQueue.push(tryAcquire);
        }
      };

      tryAcquire();
    });
  }

  /**
   * Executa uma função com controle de semáforo
   * @param {Function} fn - Função a ser executada
   * @param {string} identifier - Identificador da operação
   * @returns {Promise<any>} - Resultado da função executada
   */
  async execute(fn, identifier = 'unknown') {
    const release = await this.acquire(identifier);
    try {
      const result = await fn();
      return result;
    } finally {
      release();
    }
  }

  /**
   * Retorna informações sobre o estado atual do semáforo
   * @returns {object} - Estado do semáforo
   */
  getStatus() {
    return {
      totalPermits: this.permits,
      availablePermits: this.currentPermits,
      queueLength: this.waitQueue.length,
      isAvailable: this.currentPermits > 0,
    };
  }
}

export default Semaphore;
