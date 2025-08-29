import dotenv from 'dotenv';

// Carrega as variáveis de ambiente do .env
dotenv.config();

class Logger {
  static logCache = new Map(); // Cache para evitar logs repetitivos

  static log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}]`, message, ...args);
  }

  static info(message, ...args) {
    Logger.log('info', message, ...args);
  }

  static warn(message, ...args) {
    Logger.log('warn', message, ...args);
  }

  static error(message, ...args) {
    Logger.log('error', message, ...args);
  }

  static debug(message, ...args) {
    if (process.env.LOG_LEVEL === 'DEBUG' || process.env.LOG_TYPE === 'debug') {
      Logger.log('debug', message, ...args);
    }
  }

  // Log apenas uma vez por minuto para evitar spam
  static infoOnce(key, message, ...args) {
    const now = Date.now();
    const lastLog = Logger.logCache.get(key);

    if (!lastLog || now - lastLog > 60000) {
      // 1 minuto
      Logger.logCache.set(key, now);
      Logger.info(message, ...args);
    }
  }

  // Log somente no modo verbose
  static verbose(message, ...args) {
    if (
      process.env.LOG_LEVEL === 'DEBUG' ||
      process.env.LOG_TYPE === 'verbose' ||
      process.env.LOG_TYPE === 'debug'
    ) {
      Logger.log('verbose', message, ...args);
    }
  }

  // Log crítico - sempre mostrado
  static critical(message, ...args) {
    Logger.log('CRITICAL', message, ...args);
  }

  // Método para verificar configuração do logger (apenas para debug)
  static checkConfig() {
    console.log(`🔧 [LOGGER] LOG_LEVEL: ${process.env.LOG_LEVEL || 'undefined'}`);
    console.log(`🔧 [LOGGER] LOG_TYPE: ${process.env.LOG_TYPE || 'undefined'}`);
    console.log(
      `🔧 [LOGGER] Debug enabled: ${process.env.LOG_LEVEL === 'DEBUG' || process.env.LOG_TYPE === 'debug'}`
    );
  }
}

export default Logger;
