# BackBot - Referência do Projeto para Claude Code

## 🎯 Visão Geral
BackBot é um sistema de trading automatizado para a exchange Backpack, com suporte a estratégias tradicionais e HFT (High-Frequency Trading) para farming de airdrops.

## 📁 Estrutura Principal do Projeto

### Backend (Node.js)
```
src/
├── Decision/
│   ├── Strategies/
│   │   ├── BaseStrategy.js          # Classe base para estratégias
│   │   ├── DefaultStrategy.js       # Estratégia tradicional com indicadores
│   │   ├── HFTStrategy.js          # Estratégia HFT para volume/airdrops
│   │   └── StrategyFactory.js      # Factory para criar estratégias
│   └── Decision.js                 # Motor principal de decisão
├── Controllers/
│   ├── AccountController.js        # Gestão de contas e APIs
│   ├── OrderController.js          # Gestão de ordens tradicionais
│   └── HFTController.js           # Gestão específica de bots HFT
├── Utils/
│   ├── OrderBookCache.js          # Cache WebSocket para HFT
│   └── RequestManager.js          # Gestão de requisições API
└── MultiBot/
    └── BotInstance.js             # Instância individual de bot
```

### Frontend (React + TypeScript)
```
dashboard-ui/src/
├── components/
│   ├── ConfigForm.tsx             # Form tradicional de configuração
│   ├── HFTConfigForm.tsx         # Form específico para HFT
│   ├── BotTypeSelection.tsx      # Seleção de tipo de bot
│   └── BotCard.tsx               # Card de exibição de bot
└── pages/
    └── DashboardPage.tsx         # Página principal do dashboard
```

## 🔑 Configurações Críticas

### Bots Tradicionais
- **Indicadores**: RSI, MACD, Stochastic, ADX, VWAP, Money Flow
- **Estratégias**: DEFAULT, PRO_MAX, ALPHA_FLOW
- **Monitoramento**: Orphan Orders, Pending Orders ativos

### Bots HFT (Otimizado para Airdrops)
- **Foco**: Volume máximo com risco mínimo
- **Estratégia**: Grid trading com spreads pequenos
- **Configurações dinâmicas**:
  - `hftSpread`: 0.01% - 1% (spread entre ordens)
  - `hftRebalanceFrequency`: 30-300s (frequência de reajuste)
  - `hftOrderSize`: 0.5-5% (tamanho por ordem)
  - `hftDailyHours`: 8-24h (horas ativas por dia)
- **Monitoramento**: Desabilitado (usa HFTController próprio)

## 🎨 Padrões de UI/UX

### Cores e Temas
- **Tradicional**: Azul (`bg-blue-600`)
- **HFT**: Laranja (`bg-orange-600`)
- **Estados**: Verde (sucesso), Vermelho (erro), Amarelo (warning)

### Componentes Reutilizáveis
- **Slider com botões +/-**: Usado para percentual de capital
- **Select com z-50**: Para dropdowns em modais
- **Cards informativos**: Para dicas e avisos
- **Tooltips explicativos**: Para todos os campos técnicos

## ⚡ APIs e Endpoints

### Endpoints Tradicionais
- `POST /api/bot/start` - Iniciar bot tradicional
- `POST /api/bot/stop` - Parar bot tradicional
- `GET /api/bot/status` - Status de todos os bots

### Endpoints HFT
- `POST /api/hft/start` - Iniciar bot HFT
- `POST /api/hft/stop` - Parar bot HFT
- `GET /api/hft/performance` - Métricas de performance

### Configurações
- `GET /api/configs` - Listar configurações
- `POST /api/configs` - Salvar configuração
- `DELETE /api/configs/:id` - Deletar bot

## 🔧 Regras de Código

### Imports (CRÍTICO)
```javascript
// ✅ SEMPRE no topo do arquivo
import RequestManager from './src/Utils/RequestManager.js';
import SomeClass from './SomeClass.js';

// ❌ NUNCA no meio do código
const RequestManager = (await import('./RequestManager.js')).default;
```

### Estrutura de Configuração
```javascript
interface BotConfig {
  // Comum a todos
  strategyName: string;        // 'DEFAULT' | 'HFT' | 'PRO_MAX'
  botName: string;
  apiKey: string;
  apiSecret: string;
  capitalPercentage: number;
  authorizedTokens: string[];

  // Específico HFT
  hftSpread?: number;
  hftRebalanceFrequency?: number;
  hftOrderSize?: number;
  hftDailyHours?: number;

  // Monitoramento (false para HFT)
  enableOrphanOrderMonitor: boolean;
  enablePendingOrdersMonitor: boolean;
}
```

## 🚨 Problemas Conhecidos e Soluções

### Select boxes não abrem
- **Causa**: z-index baixo
- **Solução**: Adicionar `className="z-50"` no `<SelectContent>`

### Estrutura JSX quebrada
- **Causa**: Tags não balanceadas após edições
- **Solução**: Verificar hierarquia `<Card>` → `<CardContent>` → divs

### Import errors
- **Causa**: Imports dinâmicos no meio do código
- **Solução**: Mover todos imports para o topo do arquivo

## 📊 Fluxo de Dados

### Bot Tradicional
1. User configura via `ConfigForm`
2. `DashboardPage.handleCreateBotSaved()` salva config
3. `BotInstance` executa com `Decision.js`
4. Monitora com `OrderController`

### Bot HFT
1. User configura via `HFTConfigForm`
2. `DashboardPage.handleCreateHFTBotSaved()` adiciona configs HFT
3. `HFTController` executa estratégia própria
4. Sem monitoramento tradicional

## 🔄 Estados e Lifecycle

### Estados de Bot
- `stopped`: Parado
- `running`: Executando
- `restarting`: Reiniciando após config

### Lifecycle HFT
1. Validação de config dinâmica
2. Cálculo de volume esperado
3. Verificação de horário ativo
4. Grid trading contínuo
5. Rebalanceamento automático

## 💡 Dicas para Futuras Conversações

### Ao trabalhar com HFT:
- Foco em volume, não lucro
- Configurações dinâmicas baseadas no capital
- Simulação de comportamento humano (horários)

### Ao trabalhar com UI:
- Manter consistência entre ConfigForm e HFTConfigForm
- Usar slider + input para percentuais
- Z-index 50 para elementos flutuantes

### Ao trabalhar com Backend:
- HFT usa endpoints próprios (/api/hft/*)
- Validação diferente para cada tipo de bot
- Imports sempre no topo

## 📝 Comandos Úteis

```bash
# Frontend
npm run dev          # Desenvolver UI
npm run build        # Build para produção

# Backend
node app.js          # Iniciar servidor principal

# Testes
npm test             # Rodar testes
```

---
*Esta referência deve ser atualizada sempre que houver mudanças significativas na arquitetura ou funcionalidades.*