# BackBot Dashboard

Dashboard web para controle e monitoramento dos bots de trading BackBot.

## 🚀 Funcionalidades

- **Controle de Bots**: Iniciar, parar e configurar bots por estratégia
- **Configuração Persistente**: Salvar configurações de API keys e parâmetros de trading
- **Status em Tempo Real**: Monitoramento do status dos bots
- **Interface Moderna**: Design responsivo com shadcn/ui
- **Validação de Dados**: Validação de formulários e configurações

## 🛠️ Tecnologias

- **React 18** com TypeScript
- **Vite** para build e desenvolvimento
- **Tailwind CSS** para estilização
- **shadcn/ui** para componentes
- **Axios** para requisições HTTP
- **Lucide React** para ícones

## 📦 Instalação

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev
```

## 🔧 Configuração

### Pré-requisitos

1. **Backend API**: O servidor BackBot API deve estar rodando (porta configurável via .env)
2. **Node.js**: Versão 16 ou superior

### Variáveis de Ambiente

As portas são configuradas via arquivos `.env`:

**Arquivo principal `.env` (raiz do projeto):**
```env
# Porta para API do backend
API_PORT=3001

# Porta para o dashboard/frontend  
FRONTEND_PORT=5173
```

**Arquivo `dashboard-ui/.env` (gerado automaticamente):**
```env
# URL da API (configurada automaticamente pelos scripts)
VITE_API_BASE_URL=http://localhost:3001
```

## 🎯 Uso

### 1. Configurar um Bot

1. Acesse a dashboard em `http://localhost:5173`
2. Clique em "Adicionar Bot" ou "Configurar Primeiro Bot"
3. Preencha as informações:
   - **API Key e Secret**: Suas credenciais da Backpack
   - **Volume da Ordem**: Valor em dólares para cada ordem
   - **Percentual do Capital**: Porcentagem do capital a ser usado
   - **Timeframe**: Intervalo de análise (1m, 5m, 15m, 1h, 4h, 1d)
   - **Stop Loss**: Percentual máximo de perda
   - **Configurações Avançadas**: Multiplicadores ATR e funcionalidades

### 2. Controlar Bots

- **Iniciar Bot**: Clique no botão "Iniciar" no card do bot
- **Parar Bot**: Clique no botão "Parar" no card do bot
- **Editar Configuração**: Clique no botão "Editar" para modificar configurações

### 3. Monitorar Status

- **Cards de Status**: Visualize o status de todos os bots
- **Estatísticas**: Veja quantos bots estão rodando/parados
- **Atualização Automática**: Os dados são atualizados a cada 5 segundos

## 🏗️ Estrutura do Projeto

```
src/
├── components/
│   ├── ui/           # Componentes shadcn/ui
│   ├── BotCard.tsx   # Card de exibição do bot
│   └── ConfigForm.tsx # Formulário de configuração
├── pages/
│   └── Dashboard.tsx # Página principal
├── hooks/            # Custom hooks
├── lib/
│   └── utils.ts      # Utilitários
└── App.tsx           # Componente principal
```

## 🔌 API Endpoints

A dashboard se conecta aos seguintes endpoints do backend:

- `GET /api/configs` - Listar configurações
- `POST /api/configs` - Salvar configuração
- `GET /api/bot/status` - Status dos bots
- `POST /api/bot/start` - Iniciar bot
- `POST /api/bot/stop` - Parar bot

## 🎨 Componentes

### BotCard
Exibe informações de um bot específico:
- Nome da estratégia
- Status (Rodando/Parado/Desabilitado)
- Configurações principais
- Botões de controle

### ConfigForm
Formulário completo para configuração:
- Campos de API Key/Secret com toggle de visibilidade
- Configurações de trading
- Configurações avançadas
- Toggles de funcionalidades
- Validação de dados

## 🚨 Validações

O sistema valida automaticamente:

- **API Keys**: Comprimento mínimo de 10 caracteres
- **Volume**: Deve ser maior que zero
- **Capital**: Deve estar entre 0 e 100%
- **Stop Loss**: Deve ser maior que zero
- **Campos Obrigatórios**: API Key, API Secret, Volume, Capital

## 🔄 Atualizações em Tempo Real

- **Status dos Bots**: Atualizado a cada 5 segundos
- **Configurações**: Salvas imediatamente via API
- **Feedback Visual**: Indicadores de loading e erro

## 🎯 Próximos Passos

1. **Gráficos em Tempo Real**: Integração com TradingView
2. **Histórico de Operações**: Tabela de trades realizados
3. **Relatórios**: Métricas de performance
4. **Notificações**: Alertas por email/telegram
5. **Backtesting**: Interface para backtesting

## 🐛 Troubleshooting

### Erro de Conexão com API
- Verifique se o backend está rodando na porta configurada (padrão: 3001)
- Confirme se não há firewall bloqueando as portas configuradas
- Verifique se as variáveis de ambiente API_PORT e FRONTEND_PORT estão corretas

### Erro de Validação
- Verifique se todos os campos obrigatórios estão preenchidos
- Confirme se os valores numéricos estão dentro dos limites

### Problemas de Build
- Execute `npm install` para reinstalar dependências
- Verifique se o Node.js está na versão correta

## 📝 Licença

Este projeto faz parte do BackBot e segue a mesma licença.
