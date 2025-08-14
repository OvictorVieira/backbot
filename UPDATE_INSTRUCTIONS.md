# 📋 Instruções de Atualização - BackBot

## 🚀 Como Atualizar o BackBot

### **Comando Principal:**
```bash
npm run update
```

### **O que o script faz:**
1. ✅ **Backup automático** de dados importantes (`.env`, `src/Persistence/`, `node_modules/`)
2. ✅ **Download** da versão mais recente do GitHub
3. ✅ **Substituição** segura dos arquivos
4. ✅ **Restauração** dos seus dados preservados
5. ✅ **Instalação** das dependências atualizadas
6. ✅ **Limpeza** de arquivos temporários

## 🛡️ Proteções Implementadas

### **Anti-Loop Infinito:**
- ❌ **NÃO reinicia automaticamente** após atualização
- ✅ **Para após completar** a atualização
- ✅ **Mostra instruções** para iniciar manualmente

### **Controle de Execução:**
- ✅ **Só executa** quando chamado via `npm run update`
- ✅ **Bloqueia execução repetida** (24 horas)
- ✅ **Arquivo de flag** (`.update_flag`) previne loops

### **Dados Preservados:**
- 🔒 **`.env`** - Suas configurações
- 🔒 **`src/Persistence/`** - Banco de dados e configurações dos bots
- 🔒 **`node_modules/`** - Dependências (reinstaladas após)

## 🔧 Comandos Úteis

### **Atualização Normal:**
```bash
npm run update
```

### **Forçar Atualização (ignora flag de 24h):**
```bash
rm .update_flag && npm run update
```

### **Desabilitar Atualizações:**
```bash
export DISABLE_AUTO_UPDATE=true
npm run update  # Não executa
```

### **Após Atualização, Iniciar o Bot:**
```bash
# Dashboard + API
npm start

# Ou bot individual
npm run start:bot
```

## ⚠️ Resolução de Problemas

### **Se o Script Entrar em Loop:**
1. **Pare o processo:** `Ctrl+C`
2. **Delete o arquivo de flag:** `rm .update_flag`
3. **Defina variável de ambiente:** `export DISABLE_AUTO_UPDATE=true`
4. **Execute novamente:** `npm run update`

### **Se a Atualização Falhar:**
1. **Backup automático** é restaurado automaticamente
2. **Verifique pasta de backup:** `backup_temp/` (se existir)
3. **Restaure manualmente** se necessário

### **Se Perder Dados:**
- **Backup automático** em `backup_temp/` (temporário)
- **Dados críticos** preservados em `src/Persistence/`
- **Arquivo .env** sempre preservado

## 📋 Log de Execução

O script mostra mensagens detalhadas:
- 🚀 Inicio da atualização
- 📋 Backup de dados
- ⬇️ Download da versão mais recente
- 🔄 Substituição de arquivos
- ✅ Restauração de dados
- 🧹 Limpeza e instalação
- 🎉 Conclusão com instruções

## 🆘 Suporte

Se encontrar problemas:
1. **Verifique os logs** da execução
2. **Mantenha backup** dos seus dados importantes
3. **Consulte o CHANGELOG.md** para mudanças recentes
4. **Reporte issues** no repositório GitHub