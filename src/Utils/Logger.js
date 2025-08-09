import dotenv from 'dotenv';

// Carrega as variáveis de ambiente do .env
dotenv.config();

class Logger {
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
        if (process.env.LOG_TYPE === 'debug') {
            Logger.log('debug', message, ...args);
        }
    }

    // Método para verificar configuração do logger (apenas para debug)
    static checkConfig() {
        console.log(`🔧 [LOGGER] LOG_TYPE: ${process.env.LOG_TYPE || 'undefined'}`);
        console.log(`🔧 [LOGGER] Debug enabled: ${process.env.LOG_TYPE === 'debug'}`);
    }
}

export default Logger;
