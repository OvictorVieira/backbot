import 'dotenv/config';
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import VersionChecker from './src/Services/VersionChecker.js';

async function checkForUpdates() {
  try {
    console.log('🔍 Verificando atualizações disponíveis...');
    
    const versionChecker = new VersionChecker();
    const hasUpdate = await versionChecker.isUpdateAvailable();
    
    if (hasUpdate) {
      console.log('🎉 Nova versão disponível!');
      
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Deseja atualizar agora?',
          default: true
        }
      ]);
      
      if (proceed) {
        console.log('🚀 Iniciando atualização automática...');
        
        // Executa o script de atualização
        const updateProcess = spawn('npm', ['run', 'update'], {
          stdio: 'inherit',
          shell: true
        });
        
        updateProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Atualização concluída com sucesso!');
            console.log('🔄 Reiniciando aplicação...');
            process.exit(0);
          } else {
            console.log('❌ Atualização falhou. Continuando com a versão atual.');
            startApplication();
          }
        });
        
        updateProcess.on('error', (error) => {
          console.error('❌ Erro ao executar atualização:', error.message);
          console.log('⚠️ Continuando com a versão atual.');
          startApplication();
        });
        
        return; // Não inicia a aplicação se está atualizando
      } else {
        console.log('⚠️ OK. A continuar com a versão atual. Lembre-se de atualizar mais tarde!');
      }
    } else {
      console.log('✅ Você está na versão mais recente.');
    }
  } catch (error) {
    console.error('❌ Erro ao verificar atualizações:', error.message);
    console.log('⚠️ Continuando com a versão atual.');
  }
  
  // Inicia a aplicação normalmente
  startApplication();
}

function startApplication() {
  console.log('🚀 Iniciando BackBot...');
  import('./app.js');
}

// Verifica atualizações antes de iniciar a aplicação
checkForUpdates(); 