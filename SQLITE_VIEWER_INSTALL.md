# 🔧 Instalação do SQLite Viewer para Cursor

## 📦 **Como Instalar Manualmente:**

### 1. **Abrir Cursor**
- Abra o Cursor
- Vá para a aba de extensões (Ctrl+Shift+X ou Cmd+Shift+X)

### 2. **Pesquisar Extensão**
- Na barra de pesquisa, digite: `SQLite Viewer`
- Ou procure por: `qwtel.sqlite-viewer`

### 3. **Instalar**
- Clique em "Install" na extensão "SQLite Viewer"
- Aguarde a instalação

## 🎯 **Como Usar:**

### **Opção 1: Abrir Arquivo Direto**
1. No Cursor, abra o arquivo: `src/persistence/bot.db`
2. A extensão deve detectar automaticamente

### **Opção 2: Comando**
1. Pressione `Ctrl+Shift+P` (ou `Cmd+Shift+P` no Mac)
2. Digite: `SQLite: Open Database`
3. Selecione: `src/persistence/bot.db`

## 📊 **Tabelas Disponíveis:**

### **bot_configs**
- Configurações dos bots
- Dados JSON serializados
- Campos: botId, config, createdAt, updatedAt

### **bot_orders**
- Histórico de ordens
- Campos: id, botId, externalOrderId, symbol, side, quantity, price, orderType, timestamp, status

### **trailing_state**
- Estado do trailing stop
- Campos: symbol, state, updatedAt

## 🔍 **Funcionalidades:**
- ✅ Visualizar dados das tabelas
- ✅ Executar queries SQL
- ✅ Exportar dados
- ✅ Interface gráfica simples

## 🚀 **Pronto!**
Após instalar, você poderá visualizar todos os dados do seu bot diretamente no Cursor!
