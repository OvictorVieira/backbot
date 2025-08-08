import ColorLogger from '../Utils/ColorLogger.js';
import AccountConfig from '../Config/AccountConfig.js';
import BotInstance from './BotInstance.js';

/**
 * Gerenciador principal para múltiplas instâncias do bot
 * Controla a execução paralela de diferentes contas/estratégias
 */
class MultiBotManager {
  constructor() {
    this.bots = new Map(); // Map<botName, BotInstance>
    this.logger = new ColorLogger('MANAGER', 'MULTI');
    this.isRunning = false;
    this.selectedBots = [];
  }

  /**
   * Inicializa o gerenciador
   */
  async initialize() {
    this.logger.info('Inicializando MultiBot Manager...');
    
    // Carrega e valida configurações
    this.accountConfig = new AccountConfig();
    await this.accountConfig.initialize();
    
    // Valida configurações
    const validation = this.accountConfig.validateConfigurations();
    if (!validation.isValid) {
      this.logger.error('Configurações inválidas:');
      validation.errors.forEach(error => this.logger.error(`  • ${error}`));
      return false;
    }
    
    // Verifica se há contas configuradas
    if (!this.accountConfig.hasAnyAccount()) {
      this.logger.error('Nenhuma conta com credenciais válidas encontrada');
      return false;
    }
    
    this.logger.success('MultiBot Manager inicializado com sucesso');
    return true;
  }

  /**
   * Mostra menu de seleção de modo
   */
  async showModeSelection() {
    console.log('\n🤖 BACKBOT - Seleção de Modo');
    console.log('=====================================');
    console.log('\n📋 Modos Disponíveis:\n');
    
    console.log('1️⃣  CONTA ÚNICA');
    console.log('   • Uma conta, uma estratégia');
    console.log('   • Modo atual do bot\n');
    
    console.log('2️⃣  MÚLTIPLAS CONTAS');
    console.log('   • Duas contas, estratégias diferentes');
    console.log('   • Logs separados por conta');
    console.log('   • Execução em paralelo\n');
    
    console.log('3️⃣  Sair\n');
    
    // Verifica se há contas configuradas
    const enabledAccounts = AccountConfig.getEnabledAccounts();
    if (enabledAccounts.length === 0) {
      console.log('⚠️  Nenhuma conta habilitada encontrada');
      console.log('   Configure as contas no arquivo .env\n');
      return 'SINGLE';
    }
    
    console.log('📊 Contas Configuradas:');
    enabledAccounts.forEach(account => {
      console.log(`   • ${account.id}: ${account.name} (${account.strategy})`);
    });
    console.log('');
    
    return 'MULTI';
  }

  /**
   * Mostra menu de seleção de contas
   */
  async showAccountSelection() {
    const enabledAccounts = this.accountConfig.getEnabledAccounts();
    
    console.log('\n🤖 Seleção de Contas');
    console.log('=====================================\n');
    
    console.log('📋 Contas Disponíveis:\n');
    
    enabledAccounts.forEach((account, index) => {
      const status = account.enabled ? '✅ Ativo' : '❌ Inativo';
      console.log(`${index + 1}️⃣  ${account.id}: ${account.name}`);
      console.log(`   • Estratégia: ${account.strategy}`);
      console.log(`   • Status: ${status}`);

      console.log(`   • Capital: ${account.capitalPercentage}%`);
      console.log(`   • Timeframe: ${account.time}\n`);
    });
    
    console.log(`${enabledAccounts.length + 1}️⃣  TODAS AS CONTAS`);
    console.log('   • Executa todas as contas habilitadas\n');
    
    console.log(`${enabledAccounts.length + 2}️⃣  Voltar\n`);
    
    // Simula seleção (em implementação real, seria input do usuário)
    return enabledAccounts.map(account => account.id);
  }

  /**
   * Inicia os bots selecionados
   */
  async startBots(botNames) {
    try {
      this.logger.info(`Iniciando ${botNames.length} bot(s)...`);
      
      for (const botName of botNames) {
        const account = this.accountConfig.getAccount(botName);
        if (!account) {
          this.logger.error(`Bot ${botName} não encontrado`);
          continue;
        }
        
        if (!account.enabled) {
          this.logger.warn(`Bot ${botName} está desabilitado`);
          continue;
        }
        
        const botInstance = new BotInstance(botName, account);
        this.bots.set(botName, botInstance);
      }
      
      // Inicia todos os bots em paralelo
      const startPromises = Array.from(this.bots.values()).map(bot => bot.start());
      const results = await Promise.all(startPromises);
      
      // Verifica resultados
      const successful = results.filter(result => result === true).length;
      const failed = results.filter(result => result === false).length;
      
      this.logger.success(`${successful} bot(s) iniciado(s) com sucesso`);
      if (failed > 0) {
        this.logger.error(`${failed} bot(s) falharam ao iniciar`);
      }
      
      this.isRunning = successful > 0;
      this.selectedBots = botNames;
      
      if (this.isRunning) {
        this.logger.success('MultiBot iniciado com sucesso!');
        this.showStatus();
      }
      
      return this.isRunning;
      
    } catch (error) {
      this.logger.error(`Erro ao iniciar bots: ${error.message}`);
      return false;
    }
  }

  /**
   * Para todos os bots
   */
  stopBots() {
    try {
      this.logger.info('Parando todos os bots...');
      
      for (const [botName, bot] of this.bots) {
        bot.stop();
      }
      
      this.bots.clear();
      this.isRunning = false;
      this.selectedBots = [];
      
      this.logger.success('Todos os bots parados com sucesso');
      
    } catch (error) {
      this.logger.error(`Erro ao parar bots: ${error.message}`);
    }
  }

  /**
   * Mostra status dos bots
   */
  showStatus() {
    console.log('\n📊 Status dos Bots');
    console.log('=====================================');
    
    if (this.bots.size === 0) {
      console.log('❌ Nenhum bot em execução');
      return;
    }
    
    for (const [botName, bot] of this.bots) {
      const status = bot.getStatus();
      const runningStatus = status.isRunning ? '🟢 Executando' : '🔴 Parado';
      
      console.log(`\n${botName}: ${status.name}`);
      console.log(`   • Estratégia: ${status.strategy}`);
      console.log(`   • Status: ${runningStatus}`);

      console.log(`   • Capital: ${status.capitalPercentage}%`);
      console.log(`   • Timeframe: ${status.time}`);
    }
    
    console.log('\n💡 Use Ctrl+C para parar todos os bots');
  }

  /**
   * Obtém status de todos os bots
   */
  getAllStatus() {
    const status = [];
    
    for (const [botName, bot] of this.bots) {
      status.push(bot.getStatus());
    }
    
    return status;
  }

  /**
   * Verifica se há bots em execução
   */
  hasRunningBots() {
    return this.isRunning && this.bots.size > 0;
  }

  /**
   * Obtém número de bots em execução
   */
  getRunningBotsCount() {
    return Array.from(this.bots.values()).filter(bot => bot.isRunning).length;
  }

  /**
   * Executa em modo conta única (compatibilidade)
   */
  async runSingleMode() {
    this.logger.info('Executando em modo conta única...');
    
    // Usa configurações padrão
    const accountConfig = new AccountConfig();
    const defaultAccount = accountConfig.getEnabledAccounts()[0];
    if (!defaultAccount) {
      this.logger.error('Nenhuma conta configurada para modo único');
      return false;
    }
    
    return await this.startBots([defaultAccount.id]);
  }

  /**
   * Executa em modo múltiplas contas
   */
  async runMultiMode() {
    this.logger.info('Executando em modo PRO MAX...');
    
    // Garante que o AccountConfig foi inicializado
    if (!this.accountConfig) {
      await this.initialize();
    }
    
    // Filtra apenas contas com estratégia PRO_MAX
    const allAccounts = this.accountConfig.getAllAccounts();
    const proMaxAccounts = allAccounts.filter(account => account.strategy === 'PRO_MAX' && account.enabled);
    
    if (proMaxAccounts.length === 0) {
      this.logger.error('Nenhuma conta PRO_MAX habilitada encontrada');
      this.logger.info('Configure uma conta com ACCOUNT2_STRATEGY=PRO_MAX no .env');
      return false;
    }
    
    const botNames = proMaxAccounts.map(account => account.botName);
    this.logger.info(`Iniciando ${botNames.length} bot(s) PRO_MAX: ${botNames.join(', ')}`);
    
    const success = await this.startBots(botNames);
    
    if (success) {
      // Inicia o timer geral para modo multi-bot
      this.startGlobalTimer();
      
      // Configura o timer para se repetir a cada 60 segundos
      setInterval(() => {
        this.startGlobalTimer();
      }, 60000);
    }
    
    return success;
  }

  /**
   * Inicia o timer geral para modo multi-bot
   */
  startGlobalTimer() {
    const durationMs = 60000; // 60 segundos
    const startTime = Date.now();
    const nextAnalysis = new Date(startTime + durationMs);
    const timeString = nextAnalysis.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    });

    // Intercepta console.log para manter o progresso no rodapé
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    // Função para limpar a linha do progresso
    const clearProgressLine = () => {
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    };
    
    // Função para mostrar o progresso no rodapé
    const showProgress = (progress, progressBar, percentage) => {
      // Move o cursor para o final da tela
      process.stdout.write('\x1b[9999;0H');
      // Limpa a linha atual
      clearProgressLine();
      // Mostra o progresso
      process.stdout.write('⏳ Aguardando próxima análise... ');
      process.stdout.write(`[${progressBar}] ${percentage}% | Próxima: ${timeString}`);
    };

      // Intercepta console.log para manter o progresso no rodapé
  console.log = (...args) => {
    // Filtra logs que podem quebrar a barra de progresso
    const message = args.join(' ');
    const isSpamLog = message.includes('Stop loss já existe') || 
                     message.includes('ℹ️ [CONTA') ||
                     message.includes('⚠️ [CONTA');
    
    // Se for log de spam, não mostra para não quebrar a barra
    if (isSpamLog) {
      return;
    }
    
    // Limpa a linha do progresso antes de mostrar o log
    clearProgressLine();
    // Mostra o log
    originalLog.apply(console, args);
    // Restaura o progresso no rodapé
    const elapsed = Date.now() - startTime;
    const progress = Math.min((elapsed / durationMs) * 100, 100);
    const bars = Math.floor(progress / 5);
    const emptyBars = 20 - bars;
    const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
    const percentage = Math.floor(progress);
    showProgress(progress, progressBar, percentage);
  };

    // Intercepta console.error
    console.error = (...args) => {
      clearProgressLine();
      originalError.apply(console, args);
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / durationMs) * 100, 100);
      const bars = Math.floor(progress / 5);
      const emptyBars = 20 - bars;
      const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
      const percentage = Math.floor(progress);
      showProgress(progress, progressBar, percentage);
    };

    // Intercepta console.warn
    console.warn = (...args) => {
      clearProgressLine();
      originalWarn.apply(console, args);
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / durationMs) * 100, 100);
      const bars = Math.floor(progress / 5);
      const emptyBars = 20 - bars;
      const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
      const percentage = Math.floor(progress);
      showProgress(progress, progressBar, percentage);
    };

    const timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / durationMs) * 100, 100);
      const bars = Math.floor(progress / 5);
      const emptyBars = 20 - bars;
      
      const progressBar = '█'.repeat(bars) + '░'.repeat(emptyBars);
      const percentage = Math.floor(progress);
      
      // Mostra o progresso no rodapé
      showProgress(progress, progressBar, percentage);
      
      if (progress >= 100) {
        clearInterval(timerInterval);
        // Restaura console.log original
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
        // Limpa a linha do progresso
        clearProgressLine();
        console.log('🔄 Iniciando nova análise...\n');
      }
    }, 1000);

    // Retorna o intervalo para poder parar se necessário
    return timerInterval;
  }

  /**
   * Coordena os logs dos bots para evitar conflitos
   */
  coordinateLogs() {
    // Pausa temporariamente os logs dos bots durante o timer
    for (const [botName, bot] of this.bots) {
      if (bot.logger) {
        bot.logger.pauseLogs = true;
      }
    }
  }

  /**
   * Resume os logs dos bots
   */
  resumeLogs() {
    for (const [botName, bot] of this.bots) {
      if (bot.logger) {
        bot.logger.pauseLogs = false;
      }
    }
  }
}

export default MultiBotManager; 