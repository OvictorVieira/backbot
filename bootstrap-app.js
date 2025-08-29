import 'dotenv/config';
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import VersionChecker from './src/Services/VersionChecker.js';
import Logger from './src/Utils/Logger.js';

async function checkForUpdates() {
  try {
    Logger.info('🔍 Verificando atualizações disponíveis...');

    const versionChecker = new VersionChecker();
    const hasUpdate = await versionChecker.isUpdateAvailable();

    if (hasUpdate) {
      Logger.info('🎉 Nova versão disponível!');

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Deseja atualizar agora?',
          default: true,
        },
      ]);

      if (proceed) {
        Logger.info('🚀 Iniciando atualização automática...');

        // Executa o script de atualização
        const updateProcess = spawn('npm', ['run', 'update'], {
          stdio: 'inherit',
          shell: true,
        });

        updateProcess.on('close', code => {
          if (code === 0) {
            Logger.info('✅ Atualização concluída com sucesso!');
            Logger.info('🔄 Reiniciando aplicação...');
            process.exit(0);
          } else {
            Logger.warn('❌ Atualização falhou. Continuando com a versão atual.');
            startApplication();
          }
        });

        updateProcess.on('error', error => {
          Logger.error('❌ Erro ao executar atualização:', error.message);
          Logger.warn('⚠️ Continuando com a versão atual.');
          startApplication();
        });

        return; // Não inicia a aplicação se está atualizando
      } else {
        Logger.warn('⚠️ OK. A continuar com a versão atual. Lembre-se de atualizar mais tarde!');
      }
    } else {
      Logger.info('✅ Você está na versão mais recente.');
    }
  } catch (error) {
    Logger.error('❌ Erro ao verificar atualizações:', error.message);
    Logger.warn('⚠️ Continuando com a versão atual.');
  }

  // Inicia a aplicação normalmente
  startApplication();
}

function startApplication() {
  Logger.info('🚀 Iniciando BackBot...');
  import('./app.js');
}

// Verifica atualizações antes de iniciar a aplicação
checkForUpdates();
