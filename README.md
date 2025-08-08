# BackBot - Bot de Trading para Backpack

Bot de trading automatizado para a exchange Backpack, focado em volume farming e preservação de capital.

## 🚀 Início Rápido

### Opção 1: Dashboard Completo (Recomendado)
```bash
# Instalar dependências e iniciar backend + frontend
npm install
npm start
```

Isso irá:
- ✅ Iniciar a API backend na porta 3001
- ✅ Iniciar o dashboard frontend na porta 5173
- ✅ Abrir automaticamente o navegador em http://localhost:5173

**Acesse:** http://localhost:5173 (abre automaticamente)

### Opção 2: Apenas Backend (Modo Console)
```bash
# Executar bot no console (modo tradicional)
npm run start:bot
```

## 📊 Dashboard Web

O BackBot agora inclui uma dashboard web completa para:

- **Configurar Bots**: Interface visual para configurar API keys e parâmetros
- **Controlar Bots**: Iniciar/parar bots por estratégia
- **Monitorar Status**: Visualizar status em tempo real
- **Gerenciar Configurações**: Salvar e editar configurações persistentes

### Funcionalidades da Dashboard:

1. **Configuração de Bots**:
   - API Key e Secret com toggle de visibilidade
   - Volume da ordem e percentual do capital
   - Configurações de stop loss e trailing stop
   - Toggles de funcionalidades (Post Only, Market Fallback, etc.)

2. **Controle de Bots**:
   - Iniciar/parar bots individualmente
   - Status visual (Rodando/Parado/Desabilitado)
   - Atualização automática a cada 5 segundos

3. **Estratégias Suportadas**:
   - **DEFAULT**: Estratégia original do bot
   - **ALPHA_FLOW**: Estratégia Alpha Flow
   - **PRO_MAX**: Estratégia Pro Max

## 🛠️ Comandos Disponíveis

### Dashboard e API
```bash
npm start                    # Inicia backend + frontend
npm run api                  # Apenas backend API
npm run dashboard            # Apenas frontend
npm run dashboard:install    # Instalar dependências do dashboard
npm run dashboard:build      # Build do dashboard para produção
```

### Bot Tradicional (Console)
```bash
npm run start:bot           # Bot DEFAULT no console
npm run alphaflow           # Bot ALPHA_FLOW no console
```

### Testes e Desenvolvimento
```bash
npm run test:api            # Testar API
npm run backtest            # Executar backtest
npm test                    # Executar testes unitários
npm run test:watch          # Testes em modo watch
npm run test:coverage       # Testes com cobertura
```

## 🔧 Configuração

### 1. Configuração via Dashboard (Recomendado)
1. Acesse http://localhost:5173
2. Clique em "Adicionar Bot" ou "Configurar Primeiro Bot"
3. Preencha suas API keys da Backpack
4. Configure parâmetros de trading
5. Salve e inicie o bot

### 2. Configuração via Arquivo (Modo Avançado)
As configurações são salvas em `persistence/bot_configs.json`:

```json
[
  {
    "strategyName": "DEFAULT",
    "apiKey": "sua-api-key",
    "apiSecret": "seu-api-secret",
    "volumeOrder": 10,
    "capitalPercentage": 10,
    "time": "5m",
    "enabled": true,
    "enableTrailingStop": true,
    "trailingStopDistance": 1.5
  }
]
```

## 🏗️ Arquitetura

### Backend (API)
- **Express.js**: Servidor REST API
- **WebSocket**: Comunicação em tempo real
- **ConfigManager**: Gerenciamento de configurações persistentes
- **StrategyFactory**: Sistema de estratégias modulares

### Frontend (Dashboard)
- **React 18**: Interface moderna
- **TypeScript**: Tipagem estática
- **Tailwind CSS**: Estilização responsiva
- **shadcn/ui**: Componentes de UI
- **Axios**: Comunicação com API

## 📡 API Endpoints

### Configurações
- `GET /api/configs` - Listar configurações
- `POST /api/configs` - Salvar configuração
- `DELETE /api/configs/:strategyName` - Remover configuração

### Controle de Bots
- `GET /api/bot/status` - Status dos bots
- `POST /api/bot/start` - Iniciar bot
- `POST /api/bot/stop` - Parar bot

### Informações
- `GET /api/strategies` - Estratégias disponíveis
- `GET /api/klines` - Dados de mercado

## 🎯 Estratégias

### DEFAULT
Estratégia original do bot, focada em:
- Volume farming
- Preservação de capital
- Stop loss dinâmico
- Trailing stop adaptativo

### ALPHA_FLOW
Estratégia avançada com:
- Análise de fluxo de capital
- Indicadores macro
- Timing de mercado
- Gestão de risco aprimorada

### PRO_MAX
Estratégia profissional com:
- Múltiplos timeframes
- Análise técnica avançada
- Machine learning
- Otimização automática

## 🔄 WebSocket Events

O sistema emite eventos em tempo real:

- `BOT_STARTING` - Bot iniciando
- `BOT_STARTED` - Bot iniciado
- `BOT_STOPPED` - Bot parado
- `DECISION_ANALYSIS` - Análise de decisão
- `TRAILING_STOP_UPDATE` - Atualização trailing stop
- `BOT_EXECUTION_SUCCESS` - Execução bem-sucedida
- `BOT_EXECUTION_ERROR` - Erro na execução

## 🚨 Validações

O sistema valida automaticamente:

- **API Keys**: Comprimento mínimo de 10 caracteres
- **Volume**: Deve ser maior que zero
- **Capital**: Deve estar entre 0 e 100%
- **Stop Loss**: Deve ser maior que zero
- **Campos Obrigatórios**: API Key, API Secret, Volume, Capital

## 🐛 Troubleshooting

### Erro de Conexão com API
- Verifique se o backend está rodando: `npm run api`
- Confirme se a porta 3001 está livre

### Erro de Dashboard
- Verifique se o frontend está rodando: `npm run dashboard`
- Confirme se a porta 5173 está livre

### Problemas de Dependências
```bash
# Reinstalar dependências do projeto principal
npm install

# Reinstalar dependências do dashboard
npm run dashboard:install
```

### Logs e Debug
- Backend: Logs no console do terminal
- Frontend: Logs no console do navegador (F12)
- WebSocket: Eventos em tempo real

## 📈 Próximos Passos

1. **Gráficos em Tempo Real**: Integração com TradingView
2. **Histórico de Operações**: Tabela de trades realizados
3. **Relatórios**: Métricas de performance
4. **Notificações**: Alertas por email/telegram
5. **Backtesting**: Interface para backtesting
6. **Multi-Exchange**: Suporte a outras exchanges

## 📝 Licença

Este projeto é licenciado sob a MIT License.

## 🤝 Contribuição

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📞 Suporte

Para suporte e dúvidas:
- Abra uma issue no GitHub
- Consulte a documentação da API
- Verifique os logs de erro