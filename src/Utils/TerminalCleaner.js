import { spawn } from 'child_process';
import Logger from './Logger.js';

/**
 * Utilitário para limpeza automática do terminal
 * Funciona em Unix (Linux/macOS) e Windows
 */
class TerminalCleaner {
  constructor() {
    this.intervalId = null;
    this.isEnabled = false;
  }

  /**
   * Limpa o terminal baseado no sistema operacional
   */
  static clearTerminal() {
    try {
      const platform = process.platform;
      
      if (platform === 'win32') {
        // Windows
        spawn('cmd', ['/c', 'cls'], { stdio: 'inherit' });
      } else {
        // Unix-like (Linux, macOS)
        spawn('clear', { stdio: 'inherit' });
      }
      
      // Alternativa usando códigos ANSI que funciona em ambos
      process.stdout.write('\x1Bc');
      
      Logger.info('🧹 [TERMINAL_CLEANER] Terminal limpo automaticamente');
    } catch (error) {
      Logger.warn(`⚠️ [TERMINAL_CLEANER] Erro ao limpar terminal: ${error.message}`);
      // Fallback: usar códigos ANSI
      process.stdout.write('\x1Bc');
    }
  }

  /**
   * Inicia a limpeza automática do terminal
   * @param {number} intervalMinutes - Intervalo em minutos (padrão: 10)
   */
  startAutoClear(intervalMinutes = 10) {
    if (this.isEnabled) {
      Logger.warn('⚠️ [TERMINAL_CLEANER] Auto-limpeza já está ativa');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    
    Logger.info(`🧹 [TERMINAL_CLEANER] Auto-limpeza iniciada: ${intervalMinutes} minutos`);
    
    this.intervalId = setInterval(() => {
      TerminalCleaner.clearTerminal();
    }, intervalMs);
    
    this.isEnabled = true;
  }

  /**
   * Para a limpeza automática do terminal
   */
  stopAutoClear() {
    if (!this.isEnabled) {
      Logger.warn('⚠️ [TERMINAL_CLEANER] Auto-limpeza não está ativa');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isEnabled = false;
    Logger.info('🧹 [TERMINAL_CLEANER] Auto-limpeza parada');
  }

  /**
   * Verifica o status da auto-limpeza
   * @returns {boolean} - Status ativo/inativo
   */
  isActive() {
    return this.isEnabled;
  }
}

export default TerminalCleaner;