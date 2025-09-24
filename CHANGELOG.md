# 📋 Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.8.5] - 2025-09-24

### 🎯 **MAJOR ENHANCEMENT: OrderBook Integration & Safety Improvements**

#### 📊 **Advanced OrderBook Price Calculation**
- ✅ **Percentage-Based Targeting:** OrderBook now calculates prices based on user-defined percentage targets instead of closest price matching
- ✅ **Precise Price Selection:** Finds exact prices in order book that match configured Stop Loss (-3%) and Take Profit (+3%) percentages
- ✅ **Smart Price Discovery:** Searches through entire order book to find optimal prices within configured distance
- ✅ **Market Maker Orders:** Ensures orders are placed as makers, not takers, for better execution

#### 🛡️ **Enhanced Safety Order Management**
- ✅ **API Processing Delay:** Added 10-second delay for safety order creation to allow exchange API to process position updates
- ✅ **Reduced Duplicates:** Prevents duplicate Stop Loss orders caused by timing issues
- ✅ **Order Validation:** All safety orders confirmed to use `reduceOnly: true` flag for security
- ✅ **Position Synchronization:** Improved timing between order execution and safety order creation

#### 🔧 **Bot Configuration Improvements**
- ✅ **Status Preservation:** Fixed bot status changing to 'running' when updating configuration - now preserves current status
- ✅ **Configuration Safety:** Bot updates no longer accidentally change paused bots to running state
- ✅ **Update API Enhancement:** Improved configuration update endpoints to maintain bot state integrity

#### ⚡ **Performance & Execution Optimizations**
- ✅ **Extended Timeout:** Increased order execution timeout from 12 seconds to 50 seconds for better fill rates
- ✅ **Take Profit Logic Fix:** Corrected Take Profit side selection for SHORT positions (now uses BUY orders correctly)
- ✅ **Order Execution Flow:** Improved hybrid execution strategy with better market order fallbacks

#### 🔍 **Logging & Debug Improvements**
- ✅ **Clean Log Output:** Converted debug logs from ERROR to DEBUG level to reduce log pollution
- ✅ **OrderBook Transparency:** Added comprehensive logging for order book price selection process
- ✅ **Debug Information:** Enhanced visibility into percentage calculations and target price discovery
- ✅ **Error Tracking:** Better error messages for troubleshooting order execution issues

#### 🚨 **Financial Safety Enhancements**
- ✅ **No Fallback Policy:** Removed dangerous fallbacks in financial operations - operations cancel if order book fails
- ✅ **Secure Order Placement:** All Stop Loss and Take Profit orders confirmed to be reduce-only
- ✅ **Risk Management:** Enhanced validation to prevent accidental position increases
- ✅ **Market Safety:** Orders only execute with verified prices from actual order book data

## [1.8.4] - 2025-09-17

### 🔧 **CRITICAL FIX: Import System**

#### 🚨 **RequestManager Import Fix**
- ✅ **Professional Import Structure:** Moved RequestManager import to top of app-api.js file
- ✅ **Error Resolution:** Fixed "RequestManager.forceReset is not a function" error
- ✅ **Dynamic Import Removal:** Eliminated problematic dynamic import pattern
- ✅ **Static Import Enforcement:** All imports now follow professional static import pattern

#### 📋 **Code Standards Documentation**
- ✅ **CLAUDE.md Guidelines:** Created permanent import guidelines documentation
- ✅ **Import Rules:** Established inviolable rules for import placement and structure
- ✅ **Error Prevention:** Documentation prevents future import-related errors
- ✅ **Best Practices:** Enforces professional JavaScript import patterns

## [1.8.3] - 2025-09-17

### 🚀 **NEW FEATURE: HFT (High-Frequency Trading) Mode**

#### 🏎️ **HFT Trading System**
- ✅ **Grid Trading Strategy:** Implemented pure execution-based HFT strategy for airdrop volume
- ✅ **WebSocket OrderBook Cache:** Real-time orderbook caching for minimal latency
- ✅ **HFT Controller:** Complete bot lifecycle management for HFT strategies
- ✅ **Maker Order Focus:** Optimized for maker orders with small spreads (0.1% default)

#### 📊 **HFT Infrastructure**
- ✅ **OrderBookCache.js:** WebSocket-based real-time orderbook synchronization
- ✅ **HFTStrategy.js:** Grid trading abandoning traditional indicators
- ✅ **HFTController.js:** Singleton controller for HFT bot management
- ✅ **StrategyFactory Integration:** Seamless HFT strategy integration

#### 🎛️ **Frontend HFT Configuration**
- ✅ **HFT Mode Button:** Orange-themed HFT mode selection in ConfigForm
- ✅ **HFT Fields:** Dedicated configuration fields (spread, daily volume goal, etc.)
- ✅ **TypeScript Support:** Extended BotConfig interface for HFT parameters
- ✅ **Conditional UI:** Dynamic HFT configuration display

#### 🔌 **API & Integration**
- ✅ **7 REST Endpoints:** Complete HFT control API (/api/hft/*)
- ✅ **Graceful Shutdown:** HFT integration with system shutdown procedures
- ✅ **Performance Metrics:** Real-time HFT performance tracking and reporting

## [1.8.2] - 2025-09-16

### 🔧 **IMPROVEMENTS: Market Data & Money Flow**

#### 📊 **Enhanced Market Data Retrieval**
- ✅ **Candle Data Fix:** Resolved issue where API was returning only 1 candle instead of 1000
- ✅ **Time-based Approach:** Switched from limit-based to time-based API calls using `directGet`
- ✅ **Reliable Data Source:** Ensures consistent 1000 candles for Heikin Ashi Money Flow indicator
- ✅ **Professional Logging:** Replaced console.log with proper Logger.debug/error for better debugging
- ✅ **Code Cleanup:** Removed fallback methods and Utils dependency for cleaner architecture

#### 💰 **Improved Money Flow Validation**
- ✅ **Trend-Based Analysis:** Money Flow now validates based on trend direction instead of MFI thresholds
- ✅ **LONG Signals:** Requires positive Money Flow that is increasing (current > previous)
- ✅ **SHORT Signals:** Requires negative Money Flow that is decreasing (current < previous)
- ✅ **Better Logic:** More accurate detection of money inflow/outflow trends
- ✅ **Enhanced Logging:** Detailed Money Flow trend information in logs

#### 🏗️ **Architecture Improvements**
- ✅ **Professional Request Manager:** Integrated TokenBucketRateLimiter, SmartCircuitBreaker, and PriorityRequestQueue
- ✅ **Request Health Monitoring:** Advanced monitoring with anomaly detection and auto-healing suggestions
- ✅ **Rate Limiting:** Intelligent rate limiting with adaptive behavior based on API responses
- ✅ **Circuit Breaker:** Smart failure detection and recovery mechanisms

#### 📈 **Trading Logic Enhancements**
- ✅ **Money Flow Direction:** Validates if money is moving in the right direction for the signal type
- ✅ **Trend Confirmation:** Ensures Money Flow trend aligns with trading signal direction
- ✅ **Improved Accuracy:** More precise entry signals based on actual money flow patterns

## [1.8.1] - 2025-09-10

### 🛠️ **HOTFIX: Authentication Import**

#### 🔐 **Critical Bug Fix**
- ✅ **Auth Import Fix:** Fixed missing import of `auth` function in Order.js
- ✅ **Order Execution:** Resolved "auth is not defined" error during order placement
- ✅ **Trading Functionality:** Bot now properly executes buy/sell orders
- ✅ **API Authentication:** All authenticated API calls now work correctly

## [1.8.0] - 2025-09-10

### 📊 **NEW FEATURES: Token Volume & Change Data**

#### 💹 **Enhanced Token Selection**
- ✅ **Volume Integration:** Endpoint `/api/tokens/available` now includes 24h volume data
- ✅ **Price Change Display:** Added 24h price change percentage with color indicators
- ✅ **Smart Sorting:** Tokens automatically sorted by volume (highest to lowest)
- ✅ **Parallel Data Fetching:** Markets and tickers data fetched simultaneously for better performance
- ✅ **Visual Improvements:** Enhanced token selection UI with volume and change info
- ✅ **Real-time Data:** Live volume and price change from Backpack Exchange API

#### 🎨 **UI/UX Enhancements**
- ✅ **Color-coded Changes:** Green for positive, red for negative price changes
- ✅ **Volume Formatting:** Human-readable volume display (K/M notation)
- ✅ **Better Hierarchy:** Improved visual layout for token information
- ✅ **Selection Indicators:** Enhanced selected state with checkmarks

## [1.7.2] - 2025-09-10

### 🛠️ **HOTFIXES: ETIMEDOUT e Auth Import**

#### ⏱️ **Timeout Improvements**
- ✅ **ETIMEDOUT Retry:** Adicionado ETIMEDOUT à lista de erros que fazem retry
- ✅ **Extended Timeouts:** Socket timeout aumentado para 45s, Axios para 40s
- ✅ **Timeout Logging:** Log específico para identificar retries de ETIMEDOUT
- ✅ **Connection Stability:** Prevenção de conflitos entre socket e axios timeouts

#### 🔐 **Authentication Fixes**
- ✅ **Static Import:** Corrigido import dinâmico `await import()` para import estático
- ✅ **Auth Debugging:** Adicionado verificação e logs para disponibilidade da função auth
- ✅ **Import Reliability:** Eliminado problema de escopo com importação dinâmica

## [1.7.1] - 2025-09-10

### 🔧 **CORREÇÕES CRÍTICAS: Conectividade e Validação de Posições**

#### 🌐 **Correções de Conectividade**
- ✅ **HTTP Keep-Alive:** Implementado connection pooling no RequestManager
- ✅ **ECONNREFUSED Fix:** Corrigido erro de instância axios não criada  
- ✅ **Dashboard API:** Método direto para requisições imediatas (bypass da fila)
- ✅ **WebSocket Resiliente:** Reconexão automática melhorada

#### 🛡️ **Validação de Posições Aprimorada**
- ✅ **Force Refresh:** Mecanismo para detectar posições órfãs
- ✅ **Multi-bot Safe:** Cada bot valida independentemente seus limites
- ✅ **Position Tracking:** Sincronização robusta entre cache e exchange
- ✅ **Security Fix:** Prevenção de abertura de posições além dos limites

#### 🔄 **Melhorias no Sistema**
- ✅ **ACCOUNT_DEBOUNCE:** Corrigido loop infinito com validação de strategy
- ✅ **Log Throttling:** Redução de spam nos logs de debounce
- ✅ **Connection Pool:** Estatísticas de conexão e monitoramento
- ✅ **Rate Limiting:** Sistema inteligente com recovery automático

#### 📊 **Dashboard Fixes**
- ✅ **Token Loading:** Carregamento instantâneo de tokens disponíveis
- ✅ **API Response:** Requisições diretas para dados da dashboard
- ✅ **Modal Performance:** Eliminado "Carregando tokens..." infinito

## [1.7.0] - 2025-09-09

### 🎯 **NOVA FUNCIONALIDADE: Sistema de Confluência e Modos de Trading Otimizados**

#### 🚀 **Sistema de Confluência de Indicadores**
**Nova funcionalidade:** Sistema que exige confirmação de múltiplos indicadores antes de executar trades.

**Features implementadas:**
- ✅ **Análise individual de indicadores** → Momentum, RSI, Stochastic, MACD, ADX isolados
- ✅ **Confluência configurável** → Mínimo de 2-5 indicadores concordando
- ✅ **Interface proeminente** → Seção destacada no modal com fundo amarelo
- ✅ **Compatibilidade total** → Mantém modo tradicional (prioridade) disponível
- ✅ **Validação robusta** → Só executa trades com confluência suficiente

#### 🔥 **Modo VOLUME - Farming Otimizado**
**Otimizado para:** Volume farming, rebates, atividade constante

**Configurações aplicadas:**
- 💰 **Stop Loss/Profit:** -3%/+3% (otimizado para trades frequentes)
- 📊 **Indicadores:** Todos habilitados para máxima cobertura
- 📈 **Filtros:** Money Flow, VWAP, BTC Trend ativos
- ❌ **Heikin Ashi:** Desabilitado (menos filtros = mais trades)
- ❌ **Confluência:** Desabilitada (sinais individuais = mais oportunidades)
- 🎯 **Resultado:** +200% a +500% mais volume de trading

#### 💎 **Modo LUCRO - Configuração Profissional**
**Otimizado para:** Crescimento de capital, trading profissional

**Configurações aplicadas:**
- 🛡️ **Stop Loss/Profit:** -10%/+10% (proteção ampla + lucros altos)
- 📊 **Timeframe:** 30m (análise mais robusta)
- ✅ **Heikin Ashi:** Habilitado (filtra tendências fracas)
- 🎯 **Confluência:** Habilitada com 2 indicadores mínimos
- 📈 **Trailing Stop:** 1% de distância para proteção de lucros
- 💰 **Fechamento Parcial:** 30% para realizações estratégicas
- 🎯 **Resultado:** Trades mais lucrativos e seguros

#### 🎨 **Melhorias de Interface**
- **Seção Confluência:** Destaque visual com gradiente amarelo
- **Controles intuitivos:** Toggle e slider para configuração
- **Status nos cards:** Indicação visual do modo ativo
- **Tooltips informativos:** Explicações claras para usuários

#### 📚 **Documentação e Testes**
- **SQL Examples:** Configurações de banco de dados prontas
- **Mode Comparison:** Documentação completa dos modos
- **Testes demonstrativos:** Cenários de confluência LONG/SHORT/insuficiente
- **Exemplos práticos:** Casos de uso para cada modo

#### 🔧 **Arquitetura Técnica**
- **Funções individuais:** `analyzeMomentumSignal()`, `analyzeRsiSignal()`, etc.
- **Sistema de roteamento:** Modo confluência vs tradicional
- **Contagem inteligente:** Validação de indicadores concordantes
- **Backward compatibility:** Zero breaking changes

#### 📈 **Benefícios**
- **Trades mais seguros:** Confluência elimina sinais falsos
- **Volume otimizado:** Modo farming para rebates
- **Lucros maximizados:** Modo profissional para crescimento
- **Flexibilidade total:** Usuário escolhe a estratégia ideal

---

## [1.6.11] - 2025-09-02

### 🔧 **MELHORIA: Cache de Verificação e Logs Limpos**

#### 💡 **Problema Corrigido: Spam Excessivo de Logs de Proteção**
**Problema:** Sistema estava gerando logs excessivos mesmo com proteção funcionando.

**Sintomas identificados:**
- ✅ **Proteção funcionando** → Mas gerando muito log INFO repetitivo
- ❌ **Verificações desnecessárias** → Mesmo símbolo verificado múltiplas vezes por minuto
- ❌ **Console poluído** → Dificultava monitoramento de problemas reais
- ❌ **Performance impactada** → Muitas chamadas desnecessárias à API

**Solução implementada:**
- ✅ **Cache `stopLossVerified`** → Evita reverificação por 5 minutos
- ✅ **Logs DEBUG** → INFO → DEBUG para reduzir verbosidade
- ✅ **Limpeza automática** → Cache expira automaticamente
- ✅ **Performance otimizada** → Menos chamadas desnecessárias à API
- ✅ **Console limpo** → Apenas logs importantes visíveis

#### 📈 **Melhorias de Performance:**
- **Redução de logs** → Console 90% mais limpo
- **Cache inteligente** → Evita verificações repetitivas
- **Menos API calls** → Melhor uso dos rate limits
- **Debugging melhorado** → Logs importantes destacados

---

## [1.6.10] - 2025-09-02

### 🛡️ **CORREÇÃO: Proteção Anti-Loop Stop Loss**

#### 🚨 **Problema Corrigido: Múltiplas Criações Simultâneas de Stop Loss**
**Problema:** Sistema criava múltiplas ordens de stop loss simultaneamente causando rate limit na API.

**Sintomas identificados:**
- ❌ **Múltiplas tentativas simultâneas** → Sistema tentava criar vários stop loss para o mesmo símbolo
- ❌ **Rate limit atingido** → "You have exceeded the rate limit" 
- ❌ **Ordens rejeitadas** → "Order with client ID already exists"
- ❌ **Sistema travado** → Não conseguia criar stop loss de proteção

**Solução implementada:**
- ✅ **Cache de proteção `stopLossInProgress`** → Previne múltiplas operações por símbolo
- ✅ **Método `protectedStopLossOperation()`** → Wrapper com semáforo para operações
- ✅ **Limpeza automática** → Cache expira em 2 minutos automaticamente
- ✅ **Logs detalhados** → Monitoramento completo das operações protegidas
- ✅ **Integração TrailingStop** → Substitui chamadas diretas por métodos protegidos

#### 📈 **Melhorias de Performance:**
- **Redução de rate limit** → Evita chamadas desnecessárias para API
- **Prevenção de duplicações** → Um stop loss por símbolo por vez
- **Logs informativos** → Melhor debugging e monitoramento

---

## [1.6.9] - 2025-09-01

### 🐛 **CORREÇÃO CRÍTICA: Loop de Take Profit Parcial**

#### 🚨 **Problema Corrigido: Reenvio Infinito de Ordens TP Parciais**
**Problema:** Sistema de take profit parcial criava novas ordens continuamente após a primeira execução.

**Sintomas identificados:**
- ✅ **Ordem TP parcial criada** → Sistema cria TP 50% da posição
- ✅ **TP executado** → Ordem desaparece (filled), posição reduzida para 50%
- ❌ **Sistema verifica novamente** → Não encontra ordem TP → Cria nova ordem (50% do restante)
- 🔄 **Loop infinito** → Continua até fechar posição completamente
- ⚠️ **Quebra funcionalidade híbrida** → Trailing stop não funciona corretamente

#### 🔧 **Solução Implementada**

**1. Novo Método `OrdersService.getOriginalOpeningOrder()`:**
```javascript
// Busca ordem de abertura específica no banco
SELECT * FROM bot_orders 
WHERE botId = ? AND symbol = ? AND side = ?
  AND orderType IN ('MARKET', 'LIMIT')
  AND status = 'FILLED'
ORDER BY timestamp DESC LIMIT 1
```

**2. Verificação Inteligente em `createTakeProfitForPosition()`:**
- 🔍 **Determina lado da posição** (LONG/SHORT) baseado no netQuantity
- 📊 **Compara quantidades:** Original (banco) vs Atual (API)
- ❌ **Se atual < original** → Posição reduzida → NÃO criar TP parcial
- ✅ **Se atual >= original** → Posição intacta/aumentada → PODE criar TP parcial

#### ✅ **Benefícios Alcançados**
- 🚫 **Elimina reenvio** de ordens de TP parcial após execução
- 🎯 **Preserva funcionalidade híbrida** - trailing stop funciona corretamente
- 👤 **Suporta intervenção manual** - detecta fechamentos manuais
- 📈 **Permite aumento de posição** - usuário pode aumentar sem quebrar lógica
- ⚡ **Query otimizada** - busca rápida e específica no banco
- 📊 **Logs informativos** - debugging aprimorado

#### 🧪 **Cenários Testados**
| Situação | Quantidade Original | Quantidade Atual | Resultado |
|----------|---------------------|------------------|-----------|
| TP Parcial executado | 1.0 | 0.5 | ❌ NÃO criar TP |
| Fechamento manual | 1.0 | 0.3 | ❌ NÃO criar TP |
| Posição intacta | 1.0 | 1.0 | ✅ CRIAR TP |
| Usuário aumentou | 1.0 | 1.5 | ✅ CRIAR TP |

**Arquivos modificados:**
- `src/Services/OrdersService.js` - Novo método de busca de ordem original
- `src/Controllers/OrderController.js` - Integração da verificação inteligente

## [1.6.8] - 2025-09-01

### 🛡️ **CORREÇÃO CRÍTICA: Sistema Anti-Loop para Trailing Stop**

#### 🚨 **Problema Resolvido: Rate Limit e Loops Infinitos**
**Problema:** Sistema de trailing stop executava simultaneamente, causando loops infinitos e atingindo rate limit da API Backpack.

**Sintomas identificados:**
- ⚠️ **Múltiplas execuções simultâneas** da função `stopLoss()`
- 🔄 **Loop infinito** tentando fechar posições inexistentes (ex: BTC_USDC_PERP)
- 💥 **Milhares de erros** "Reduce only order not reduced"
- 🚫 **Rate limit (429)** por excesso de requisições à API

#### 🔧 **Soluções Implementadas**

**1. Proteção no Sistema Principal (app.js):**
- 🔒 **Semáforo `trailingStopInProgress`** - Evita execuções simultâneas
- ⏳ **Logs informativos** quando execução anterior está em andamento  
- 🛡️ **Liberação automática** via `finally` block

**2. Proteção no Sistema de Fechamento (TrailingStop.js):**
- 📋 **Cache `closingInProgress`** - Timeout de 5 minutos
- 🛡️ **Função `protectedForceClose()`** - Fechamentos seguros
- 🧹 **Auto-limpeza de cache** e logs detalhados
- 🔄 **Substituição completa** de `OrderController.forceClose`

#### ✅ **Benefícios Alcançados**
- 🚫 **Elimina loops infinitos** de fechamento
- ⚡ **Reduz drasticamente chamadas à API** (previne rate limit)
- 🚀 **Melhora performance** e confiabilidade do sistema
- 📊 **Logs mais informativos** para debugging

**Arquivos modificados:**
- `app.js` - Sistema de semáforo para trailing stop
- `src/TrailingStop/TrailingStop.js` - Proteção contra fechamentos simultâneos

## [1.6.7] - 2025-08-29

### 🎨 **UX: Campo Lucro Mínimo Inteligente no Modal**

#### 🎯 **Desabilitação Contextual do Lucro Mínimo**
**Alterações:** Melhoria na interface para deixar claro quando o Trailing Stop controla o lucro automaticamente.

**Melhorias implementadas:**
- 🎨 **Indicação visual clara** - Campo fica opaco quando Trailing Stop está ativo
- 🏷️ **Label dinâmico** - Mostra "(Desabilitado - Trailing Stop Ativo)" no título
- 🔒 **Input desabilitado** - Campo não pode ser editado mas mantém valor visível
- 💬 **Tooltip inteligente** - Explica dinamicamente por que está desabilitado
- 📋 **Mensagem informativa** - Box laranja explicando o comportamento

**Recursos adicionados:**
- ✨ **UX intuitivo** - Usuário entende visualmente quando campo não é usado
- 🔄 **Valor preservado** - Input mantém valor para referência/histórico
- 📚 **Feedback educativo** - Interface ensina sobre funcionalidade do Trailing Stop
- 🎭 **Estados visuais** - Consistência com outros campos condicionais

**Arquivos modificados:**
- `dashboard-ui/src/components/ConfigForm.tsx` - Lógica de desabilitação contextual

**Impacto:** Interface mais intuitiva e educativa, usuários entendem melhor o comportamento das configurações.

## [1.6.6] - 2025-08-29

### 🚀 **Cache Avançado para Posições e Terminal Cleaner**

#### 🎯 **Sistema de Cache para getOpenPositions**
**Alterações:** Implementação de cache inteligente com duração de 10 segundos para evitar rate limiting no endpoint de posições.

**Problemas corrigidos:**
- ✅ **Rate limiting em posições** - TrailingStop causava muitas chamadas à API
- ✅ **Cache por bot** - Sistema independente usando apiKey como identificador
- ✅ **Fallback robusto** - Usa cache antigo em caso de rate limit ou timeout
- ✅ **Logging detalhado** - Informações claras sobre uso/expiração do cache
- ✅ **Métodos utilitários** - clearPositionsCache, getOpenPositionsForceRefresh, getPositionsCacheInfo

**Recursos adicionados:**
- 💾 **Cache de 10s** - Posições são cached por 10 segundos por bot
- 🔄 **Retry automático** - Timeout de 15s → retry com 20s timeout
- 🛡️ **Proteção rate limit** - Fallback para cache antigo quando necessário
- 📊 **Monitoramento** - Informações detalhadas sobre estado do cache

#### 🧹 **Terminal Auto Cleaner Cross-Platform**
**Alterações:** Sistema automático de limpeza do terminal compatível com Unix e Windows.

**Recursos implementados:**
- 🖥️ **Cross-platform** - Funciona em Unix (clear) e Windows (cls)
- ⏰ **Auto-clear configurável** - Padrão 10 minutos via .env
- 🔧 **Controles manuais** - startAutoClear, stopAutoClear, isActive
- 📋 **Códigos ANSI fallback** - Garante funcionamento em qualquer terminal

**Arquivos modificados:**
- `src/Backpack/Authenticated/Futures.js` - Sistema completo de cache
- `src/Utils/TerminalCleaner.js` - **NOVO**: Limpeza automática de terminal
- `app.js` - Integração do TerminalCleaner
- `.env` - Configurações TERMINAL_AUTO_CLEAR e TERMINAL_CLEAR_INTERVAL

**Impacto:** Redução drástica de calls à API de posições e terminal sempre limpo automaticamente.

## [1.6.5] - 2025-08-29

### 🛠️ **FIX: Correção Crítica de Alavancagem e Symbol Undefined**

#### 🎯 **Alavancagem Específica por Token**
**Alterações:** Implementada lógica de alavancagem diferenciada baseada no tipo de token.

**Problemas corrigidos:**
- ✅ **Alavancagem universal incorreta** - Sistema usava 25x para todos os tokens
- ✅ **Position sizing incorreto** - Posições eram calculadas com alavancagem errada
- ✅ **Symbol undefined** - Calls do AccountController sem contexto do token
- ✅ **Logs confusos** - Informações imprecisas sobre alavancagem aplicada
- ✅ **Capital oscilante** - Instabilidade devido a cálculos inconsistentes

**Nova lógica de alavancagem:**
- 🟢 **BTC, SOL, ETH**: Usa alavancagem da corretora (25x)  
- 🔵 **Outros tokens**: Limitado a máximo 10x
- 📊 **Logs informativos**: Mostra alavancagem da corretora vs aplicada

**Arquivos modificados:**
- `src/Controllers/AccountController.js` - Implementa alavancagem específica por token
- `src/Decision/Decision.js` - Adiciona symbol ao config
- `src/Controllers/OrderController.js` - Corrige calls para AccountController  
- `src/TrailingStop/TrailingStop.js` - Adiciona symbol nos métodos de posição
- `src/Utils/QuantityCalculator.js` - **NOVO**: Centralizador de cálculos de quantidade

**Impacto:** Com $18.45 na conta e 20% capitalPercentage:
- **DOGE/LINK/ENA** (10x): Capital disponível = $184.50 → Investment = $36.90
- **BTC/SOL/ETH** (25x): Capital disponível = $461.25 → Investment = $92.25

**Fluxo corrigido:** Token → Alavancagem específica → Capital correto → Position size preciso

## [1.6.3] - 2025-08-23

### 🛡️ **FIX: Implementação de RiskManager Centralizado**

#### 🎯 **Controle Rigoroso de Capital por Operação**
**Alterações:** Nova classe RiskManager para garantir que todas as ordens respeitem o `capitalPercentage` configurado.

**Problemas corrigidos:**
- ✅ **Ordens sem controle de risco** - Todas as ordens agora passam pelo RiskManager obrigatoriamente
- ✅ **Limite de capital ignorado** - `capitalPercentage` é respeitado em 100% das operações
- ✅ **Validação complexa desnecessária** - Removidos métodos redundantes e confusos
- ✅ **Imports incorretos** - Corrigidas chamadas dinâmicas e variáveis duplicadas
- ✅ **Formatação redundante** - Simplificado para usar apenas `toFixed()` direto

**Arquivos modificados:**
- `src/Risk/RiskManager.js` - Nova classe centralizada para cálculo de investimento
- `src/Controllers/OrderController.js` - Integração obrigatória do RiskManager
- `src/Decision/Decision.js` - Usa RiskManager no ponto de entrada

**Fluxo garantido:** 
Decision.js → `calculateInvestmentAmount()` → Strategy → OrderController → Exchange

**Impacto:** Com $35.25 na conta e 20% de `capitalPercentage`, ordens nunca excedem $7.05, garantindo controle rigoroso de risco por operação.

## [1.6.2] - 2025-08-21

### 🚨 **CRITICAL FIX: Correção de Duplicação de Take Profit**

#### 🎯 **Eliminação de Monitores Duplicados**
**Alterações:** Centralização completa da lógica de take profit para eliminar ordens duplicadas no modo default.

**Problemas corrigidos:**
- ✅ **Múltiplos monitores** - Removidos 4+ pontos de criação duplicada de TP
- ✅ **Validação de preço** - Filtro correto por direção (LONG: preço > entrada, SHORT: preço < entrada)  
- ✅ **Threshold dinâmico** - Usa `config.partialTakeProfitPercentage` em vez de 30% hardcoded
- ✅ **Coverage ratio** - Detecta TP duplicado quando ≥ 200% da posição
- ✅ **Side validation** - Fallback para ordens market sem trigger price

**Monitores removidos:**
- `validateAndCreateTakeProfit` em `monitorPendingEntryOrders` (2x)
- `validateAndCreateTakeProfit` em `checkForUnmonitoredPositions` (1x)
- `monitorTakeProfitMinimum` em estratégias Default/ProMax
- `createPartialTakeProfitOrder` em TrailingStop híbrido

**Monitor mantido:** 
- `startTakeProfitMonitor` (30s) - Único responsável por TP

**Impacto:** Elimina completamente ordens duplicadas de take profit no modo default, mantendo funcionalidade híbrida intacta.

## [1.6.1] - 2025-08-20

### 🔧 **FIX: Correções no Sistema de Limpeza de Ordens Órfãs**

#### 🧹 **Limpeza Unificada de Ordens Órfãs**
**Alterações:** Sistema de limpeza expandido para incluir take profit órfãos e correção de exports.

**Melhorias implementadas:**
- ✅ **Método renomeado** - `monitorAndCleanupOrphanedStopLoss` → `monitorAndCleanupOrphanedOrders`
- ✅ **Take profit órfãos** - Agora incluídos na limpeza regular (60s) 
- ✅ **Filtro simplificado** - Usa `reduceOnly` para capturar todos os tipos
- ✅ **Categorização mantida** - Logs separados para stop loss vs take profit
- ✅ **Export corrigido** - Removido export redundante de `cleanOrphanedTrailingStates`

**Impacto:** Take profit órfãos não ficam mais acumulados aguardando o ciclo de 5 minutos, melhorando a eficiência da limpeza de ordens.

## [1.6.0] - 2025-08-20

### 🚀 **FEATURE: Sistema de Trailing Stop Inteligente e Atualizações em Tempo Real**

#### 🎯 **Trailing Stop com Validações Avançadas**
**Alterações:** Sistema completo de trailing stop com validações inteligentes e suporte a múltiplos tipos de ordem.

**TrailingStop.js - Validações:**
- ✅ **Validação de posições** - Verifica se posição existe na exchange antes de processar
- ✅ **Sistema de skip** - Cache inteligente para symbols sem posição aberta
- ✅ **Limpeza automática** - Cache limpo automaticamente após 24h
- ✅ **Suporte completo** - triggerPrice, takeProfitTriggerPrice e price

**Monitor de Sincronização:**
- ✅ **Detecção correta** - Distingue trailing stops reais de ordens parciais
- ✅ **Criação automática** - Cria trailing stop quando não existe
- ✅ **Validação por preço** - Baseada na posição (long: abaixo, short: acima)
- ✅ **Variáveis corrigidas** - currentPrice, apiKey, apiSecret definidos

#### ⚡ **Sistema de Atualização em Tempo Real**
**Alterações:** Configurações de bot são aplicadas sem necessidade de restart.

**Atualizações dinâmicas:**
- ✅ **updateConfig** - Método para atualizar instâncias ativas
- ✅ **Sem restart** - Mudanças aplicadas imediatamente
- ✅ **Cache invalidation** - Limpeza automática de cache
- ✅ **Logs detalhados** - Rastreamento das mudanças aplicadas

#### 🛠️ **Correções Técnicas**
**Alterações:** Melhorias na robustez e confiabilidade do sistema.

**Correções implementadas:**
- ✅ **getCurrentPrice()** - Uso correto do método existente
- ✅ **getOpenPositions()** - Validação adequada de posições
- ✅ **Rate limiting** - Tratamento robusto de erros de API
- ✅ **Logs informativos** - Feedback claro em todas as operações

## [1.5.60] - 2025-08-16

### 🔧 **FIX: Sistema de logging otimizado e corrigido**

#### 📍 **Logs mais limpos e organizados**
**Alterações:** Otimização completa do sistema de logging para reduzir verbosidade e corrigir problemas de formatação.

**Mudanças implementadas:**
- ✅ **Order constructor fix** - Corrigido erro "Order is not a constructor" no cleanGhostOrders
- ✅ **Logs para DEBUG** - Movidos logs verbosos (FILLS_SYNC, ORDERS_FIX, TRAILING_CLEANUP, etc.) para nível DEBUG
- ✅ **Logs duplicados** - Removidos logs duplicados de CONFIG_SQLITE que apareciam múltiplas vezes
- ✅ **Formatação corrigida** - Corrigidos logs quebrados do TRAILING-STOP que misturavam cores ANSI com Logger
- ✅ **ES modules** - Substituído require() por import nos ColorLogger para compatibilidade ES6
- ✅ **Performance** - Sistema de logging mais eficiente com menos ruído nos logs de produção

**Logs afetados:**
- 🔧 DATABASE initialization logs → INFO
- 🔧 BOT_ORDERS, PERSISTENCE logs → INFO  
- 🔧 FILLS_SYNC, ORDERS_FIX, COMPLETE_SYNC → DEBUG
- 🔧 CONFIG_SQLITE repetitive logs → DEBUG
- 🔧 TRAILING-STOP formatting → Fixed
- 🔧 PROFIT_MONITOR, PROFIT_MODE → DEBUG

## [1.5.58] - 2025-08-15

### 🎨 **FIX: Reposicionar seção Tokens Ativos no BotCard**

#### 📍 **Melhoria na organização das informações**
**Alterações:** Movida a seção "Tokens Ativos" para uma posição mais lógica no layout.

**Mudanças implementadas:**
- ✅ **Nova posição** - Tokens Ativos agora aparecem logo após "Modo Execução"
- ✅ **Melhor fluxo** - Informações organizadas de forma mais lógica
- ✅ **Acima do tempo** - Tokens ficam acima do contador de próxima execução
- ✅ **Layout limpo** - Seção bem posicionada entre configurações e status

## [1.5.57] - 2025-08-15

### 🎨 **FIX: Corrigir responsividade do BotCard em telas pequenas**

#### 📱 **Ajustes de layout para mobile**
**Alterações:** Melhorada a responsividade do card para evitar quebra de layout em telas pequenas.

**Mudanças implementadas:**
- ✅ **Largura mínima do card** - Definida largura mínima de 280px para comportar todos os botões
- ✅ **Botões responsivos** - Adicionado flex-shrink-0 para evitar compressão dos botões
- ✅ **Texto Sync removido** - Removido texto "Sync" do botão para economizar espaço em telas pequenas
- ✅ **Layout otimizado** - Botões sempre ficam dentro do card em qualquer tamanho de tela

## [1.5.56] - 2025-08-15

### 🎨 **FIX: Otimização exibição de tokens ativos**

#### 🔄 **Melhorias na seção Tokens Ativos**
**Alterações:** Otimizada a exibição de tokens para melhor usabilidade.

**Mudanças implementadas:**
- ✅ **Limitação de 4 tokens** - Máximo 4 tokens exibidos por vez
- ✅ **Truncamento inteligente** - Remove sufixos após underscore (BTC_USDT → BTC)
- ✅ **Indicador "+X"** - Mostra quantos tokens adicionais existem quando há mais de 4
- ✅ **Nomes limpos** - Exibe apenas a parte principal do nome do token

## [1.5.55] - 2025-08-15

### 🎨 **FIX: Ajustes BotCard - Layout Original + Tokens Ativos**

#### 🔄 **Ajustes solicitados pelo usuário**
**Alterações:** Revertidas algumas mudanças do BotCard e adicionadas melhorias específicas.

**Mudanças implementadas:**

**Layout de Botões:**
- ✅ **Voltou para uma linha só** - Todos os botões (Pausar, Editar, Sync, Delete) na mesma linha
- ✅ **Botão Delete só ícone** - Removido texto, apenas ícone da lixeira
- ✅ **Layout responsivo mantido** - Texto aparece em telas maiores, ícones em telas pequenas

**Funcionalidades Ativas:**
- ✅ **Revertido para 4 opções originais** - Grid 2x2 como era antes
  - Trailing Stop
  - Post Only Limit Orders  
  - Stop Loss Híbrido
  - Market Orders Fallback
- ❌ **Removidas opções extras** - Monitor Ordens Órfãs e Monitor Ordens Pendentes

**Nova Seção - Tokens Ativos:**
- ✅ **Seção de tokens** adicionada abaixo de Funcionalidades Ativas
- ✅ **Tags coloridas** com nomes dos tokens (BTC, ETH, AAVE, etc.)
- ✅ **Layout flex-wrap** para múltiplos tokens
- ✅ **Cores temáticas** - azul, verde, roxo para diferentes tokens
- 📝 **TODO**: Integrar com API para buscar tokens reais do bot

**Resultado:**
- ✅ Layout de botões otimizado para telas pequenas (uma linha)
- ✅ Funcionalidades Ativas no formato original
- ✅ Nova seção visual para tokens ativos
- ✅ Botão delete mais limpo (só ícone)

**Arquivos modificados:**
- **dashboard-ui/src/components/BotCard.tsx**: Ajustes de layout e nova seção

----

## [1.5.54] - 2025-08-15

### 🎨 **REFACTOR: BotCard - Foco em Configurações ao Invés de Performance**

#### 📊 **Mudança: Remover estatísticas e expandir configurações**
**Alteração:** Removida seção de performance/estatísticas de trading do BotCard e expandida exibição de todas as configurações do bot.

**Motivação:** Permitir que usuários vejam TODAS as configurações e opções selecionadas do bot de forma clara e organizada, ao invés de estatísticas que podem ser consultadas em seção dedicada.

**Mudanças implementadas:**

**Removido:**
- ❌ Seção "Estatísticas de Trading" completa
- ❌ TradingStatsSkeleton component
- ❌ Funções formatProfitRatio, formatWinRate, getWinRateColor, getProfitFactorColor
- ❌ Interface TradingStats e estados relacionados
- ❌ Requisições axios para buscar estatísticas
- ❌ Imports não utilizados (axios, Badge, ícones não usados)
- ❌ Parâmetro onConfigure não usado

**Adicionado:**
- ✅ **Max Slippage** nas configurações básicas
- ✅ **Seção ATR** condicional (só aparece se Stop Loss Híbrido ativo)
  - Stop ATR Multiplier
  - Trailing ATR Multiplier  
  - Take Profit ATR Multiplier
  - Take Profit Parcial %
- ✅ **Seção Trailing Stop** condicional (só aparece se ativo e não híbrido)
  - Distância do Trailing Stop
- ✅ **Funcionalidades expandidas** com status Ativo/Inativo:
  - Trailing Stop
  - Stop Loss Híbrido (ATR)
  - Post Only Limit Orders
  - Market Orders Fallback
  - Monitor Ordens Órfãs
  - Monitor Ordens Pendentes
- ✅ **Layout organizado** com divisores e seções coloridas
- ✅ **Status de próxima atualização** simplificado

**Resultado:**
- ✅ Usuário vê TODAS as configurações do bot
- ✅ Interface mais limpa e focada
- ✅ Melhor organização visual com seções
- ✅ Configurações condicionais aparecem apenas quando relevantes

**Arquivos modificados:**
- **dashboard-ui/src/components/BotCard.tsx**: Refatoração completa do conteúdo
- **dashboard-ui/src/pages/DashboardPage.tsx**: Remoção prop onConfigure

----

## [1.5.53] - 2025-08-15

### 🎨 **FIX: Layout Responsivo Dashboard - Botões em Telas Pequenas**

#### 📱 **Problema: Botão Delete cortado em telas pequenas**
**Problema:** Em telas muito pequenas, o botão de delete (lixeira) ficava parcialmente ou totalmente fora do card do bot, prejudicando a usabilidade em dispositivos móveis.

**Causa:** Todos os 4 botões (Pausar/Iniciar, Editar, Sync, Delete) estavam na mesma linha horizontal sem quebra responsiva.

**Solução implementada:**
- **Layout em duas linhas**: Botão principal (Pausar/Iniciar) em linha separada
- **Distribuição equilibrada**: Botões secundários (Editar, Sync, Delete) em linha própria com `justify-between`
- **Flex responsivo**: Cada botão com `flex-1` para ocupar espaço igual
- **Texto sempre visível**: Removido `hidden sm:inline`, agora mostra texto em todas as telas
- **Prevenção overflow**: Classes `min-w-0` e `truncate` para evitar estouro
- **Ícones fixos**: `flex-shrink-0` para manter ícones sempre visíveis

**Resultado:**
- ✅ Todos os botões sempre visíveis e acessíveis
- ✅ Layout otimizado para dispositivos móveis
- ✅ Melhor experiência de usuário em telas pequenas
- ✅ Texto legível em todos os botões

**Arquivos modificados:**
- **dashboard-ui/src/components/BotCard.tsx**: Layout do CardFooter reorganizado

----

## [1.5.52] - 2025-08-15

### ✅ **VERIFIED: Logger.js - Erro Reportado por Usuário Não Reproduzível**

#### 🔍 **Investigação: Cannot find module Logger.js**
**Erro reportado:** Usuário enfrentou erro `Cannot find module 'src\Utils\Logger.js'` no Windows.

**Verificação realizada:**
- **✅ Arquivo existe**: `src/Utils/Logger.js` presente e funcional
- **✅ Import correto**: `import Logger from './src/Utils/Logger.js'` válido
- **✅ Export válido**: `export default Logger` funcionando
- **✅ Teste passou**: Import/export funcionando perfeitamente
- **✅ Múltiplos arquivos**: Todos os 30+ imports de Logger funcionando

**Possíveis causas do erro anterior:**
- **Versão desatualizada**: Usuário em versão onde Logger não existia
- **Cache corrompido**: Cache Node.js requerendo limpeza
- **Atualização em progresso**: Erro temporário durante sincronização
- **Arquivos não sincronizados**: Git pull incompleto

**Solução para usuários que encontrarem este erro:**
```bash
git pull                                    # Atualizar para versão mais recente
npm cache clean --force                     # Limpar cache Node.js
rm -rf node_modules package-lock.json       # Remover dependências
npm install                                 # Reinstalar dependências
```

**Status**: ✅ **NÃO É UM BUG ATIVO** - Logger.js funciona normalmente na versão atual.

----

## [1.5.51] - 2025-08-15

### 🔧 **FIX: Correção CRÍTICA - Preservar Database Durante Atualizações**

#### 💾 **Problema: Database sendo removida durante atualizações**
**Problema:** O arquivo `src/persistence/bot.db` (database principal) poderia ser removido durante atualizações automáticas, causando perda de dados de configurações, ordens e histórico.

**Solução:**
- **Preservação garantida**: Adicionado `src/persistence/` na lista `PRESERVE_ITEMS` do `update.js`
- **Múltiplos caminhos**: Protege tanto `src/persistence/` quanto `persistence/` (fallback JSON)
- **Dados seguros**: Database SQLite e arquivos JSON de backup são preservados
- **Retrocompatibilidade**: Mantém `src/Persistence/` para casos antigos

**Lista completa de itens preservados:**
- `.env` - Configurações de API
- `src/persistence/` - Database SQLite principal
- `src/Persistence/` - Compatibilidade com versões antigas
- `persistence/` - Arquivos JSON de fallback
- `node_modules/` - Dependências instaladas
- `.update_flag` - Flag de controle de atualizações

**Arquivos modificados:**
- **update.js**: Lista PRESERVE_ITEMS atualizada
- **README.md**: Documentação corrigida sobre dados preservados

**⚠️ IMPORTANTE**: Esta correção garante que nenhum dado seja perdido durante atualizações futuras.

----

## [1.5.50] - 2025-08-15

### ✨ **FEATURE: Sistema de Verificação Automática de Atualizações**

#### 🔄 **Nova funcionalidade: Verificação interativa de atualizações**
**Funcionalidade:** Sistema inteligente que verifica automaticamente se há novas versões disponíveis ao executar `npm start`.

**Como funciona:**
1. **Verificação automática**: Consulta GitHub para versão mais recente
2. **Prompt interativo**: Pergunta ao usuário "NOVA VERSÃO DISPONÍVEL: vx.y.z, deseja atualizar? Y/n"
3. **Atualização automática**: Se o usuário escolher "Y", executa `update.js` automaticamente
4. **Continuação normal**: Se escolher "n", continua com a versão atual
5. **Preservação de dados**: Configurações e dados são preservados durante atualização

**Comandos disponíveis:**
- **`npm start`**: Inicia com verificação de atualizações
- **`npm run start:no-update`**: Inicia SEM verificar atualizações  
- **`npm run test:update`**: Testa sistema de verificação
- **`npm run update`**: Força atualização imediata

**Tipos de atualização detectados:**
- 🚀 **MAJOR**: Mudanças significativas na arquitetura
- ✨ **MINOR**: Novas funcionalidades e melhorias  
- 🔧 **PATCH**: Correções de bugs e pequenas melhorias

**Arquivos criados:**
- **src/Utils/UpdatePrompt.js**: Classe principal para prompts interativos
- **check-updates.js**: Script de verificação executado antes do `npm start`
- **test-update-check.js**: Script de teste do sistema

**Arquivos modificados:**
- **package.json**: Novos scripts de comando
- **README.md**: Documentação completa do sistema de atualizações

**Opções de controle:**
- **`DISABLE_AUTO_UPDATE=true`**: Desabilita verificação automática
- **`npm run start:no-update`**: Inicia sem verificar atualizações

----

## [1.5.49] - 2025-08-15

### 🔧 **FIX: Correção Database Schema + BotOrdersManager**

#### 💾 **Problema: Erro ao criar ordens por falta da coluna clientId**
**Problema:** Novos usuários enfrentavam erro ao inicializar database:
```
SQLITE_ERROR: table bot_orders has no column named clientId
```

**Solução:**
- **Migração automática**: Adicionada coluna `clientId` na migração existente do DatabaseService
- **Schema atualizado**: Sistema agora adiciona automaticamente colunas faltantes
- **Retrocompatibilidade**: Usuários existentes não são afetados

#### 🔧 **Problema: Path undefined no BotOrdersManager**
**Problema:** Erro "path undefined" ao tentar salvar ordens em JSON como fallback:
```
The "path" argument must be of type string. Received undefined
```

**Solução:**
- **Constructor adicionado**: Definido `this.ordersFile` no constructor da classe
- **Método implementado**: `loadOrdersFromJson()` estava vazio e foi implementado
- **Fallback robusto**: JSON backup agora funciona corretamente quando SQLite não está disponível

**Arquivos afetados:**
- **src/Services/DatabaseService.js**: Adicionada coluna `clientId` na migração
- **src/Config/BotOrdersManager.js**: Adicionado constructor e implementado `loadOrdersFromJson()`

----

## [1.5.48] - 2025-08-15

### 🔧 **FIX: Compatibilidade Windows - Caracteres Especiais em Paths**

#### 🪟 **Problema: Dashboard não inicia no Windows com caracteres especiais**
**Problema:** Usuários Windows com paths contendo `$`, `#` ou espaços enfrentavam erro do esbuild:
```
No loader is configured for ".html" files: index.html
Failed to scan for dependencies from entries
```

**Solução:**
- **Configuração esbuild**: Adicionadas configurações específicas para Windows no `vite.config.ts`
- **Loader personalizado**: Configurado loader para arquivos `.tsx`, `.ts`, `.js` e `.jsx`
- **OptimizeDeps**: Adicionadas opções do esbuild para melhor compatibilidade
- **Compatibilidade**: Mantém funcionamento normal em Mac/Linux

**Arquivos afetados:**
- **dashboard-ui/vite.config.ts**: Adicionadas configurações de compatibilidade Windows

**Alternativa:** Usuários podem mover projeto para path simples como `C:\backbot\`

----

## [1.5.47] - 2025-08-14

### 🎯 **CORREÇÃO CRÍTICA: Take Profit com Alavancagem + Limpeza de Trailing States Órfãos**

#### 🔧 **Problema: Take Profit Incorreto com Alavancagem**
**Problema:** Ordens limit criavam take profit muito distante sem considerar alavancagem
**Exemplo:** Com leverage 50x e TP 10%, o preço precisava se mover 10% (deveria ser apenas 0.2%)
**Solução:**
- **Ajuste por alavancagem**: `actualTakeProfitPct = baseTakeProfitPct / leverage`
- **Lógica conservadora**: Usa sempre o TP mais próximo do preço de entrada
- **Logs informativos**: Mostra valores originais vs ajustados
- **Paridade com Stop Loss**: Ambos agora consideram alavancagem corretamente

**Resultado:** Take profit agora é atingido na distância correta com alavancagem alta

#### 🧹 **Melhoria: Limpeza de Trailing States Órfãos**
**Problema:** Dados órfãos na tabela `trailing_state` sem ordens correspondentes
**Solução:**
- **`cleanOrphanTrailingStates()`**: Remove trailing states sem posições ativas
- **Verificação inteligente**: Busca ordens FILLED sem closeTime para cada símbolo
- **Integração automática**: Executa via `performCompleteFillsSync()` a cada minuto
- **Logs detalhados**: Relatório de trailing states limpos vs mantidos

#### 🔍 **Correção: Contagem de Ordens Abertas**
**Problema:** Sistema contava ordens PENDING como abertas incorretamente
**Solução:**
- **BotOrdersManager**: Corrigido para contar apenas ordens FILLED sem closeTime
- **PositionSyncService**: Aplicada mesma lógica de contagem
- **Consistência**: Sistema agora conta corretamente apenas posições realmente abertas

**Arquivos afetados:**
- **OrderController.js**: Ajuste de take profit por alavancagem em ordens limit
- **OrdersService.js**: Novo método `cleanOrphanTrailingStates()` 
- **BotOrdersManager.js**: Correção na contagem de ordens abertas
- **PositionSyncService.js**: Correção na contagem de ordens abertas

----

## [1.5.46] - 2025-08-14

### 🔧 **BUGFIXES CRÍTICOS: Ordens Fantasma + AccountController + Fills Órfãos**

#### 🚨 **Problema 1: Ordens Fantasma**
**Problema:** Bot mantinha ordens como PENDING no banco, mas não existiam mais na corretora
**Solução:**
- **`cleanGhostOrders()`**: Detecta e limpa ordens fantasma comparando banco vs corretora
- **Verificação via histórico**: Consulta status real de ordens não encontradas
- **Integração automática**: Executa limpeza a cada 1 minuto via PositionSyncService

#### 🔧 **Problema 2: AccountController is not a constructor**  
**Problema:** Erro fatal impedia execução de bots e TrailingStop
**Solução:**
- Convertido AccountController para classe com métodos estáticos
- Corrigidas chamadas `new AccountController()` em OrderController.js
- Mantida compatibilidade com código existente

#### 🔍 **Problema 3: Fills Órfãos sem ClientId**
**Problema:** Fills de fechamento sem clientId não fechavam posições (usuário movendo take profit na corretora)
**Solução:**
- **`identifyOrphanFills()`**: Identifica fills órfãos baseado na direção oposta das posições
- **`validateOrphanFills()`**: Valida se fills órfãos realmente fecham posições do bot
- **Detecção inteligente**: Sistema detecta fills inversos que pertencem às posições abertas

#### ⚡ **Melhorias na Limpeza de Ordens Limit**
- **Retry robusto**: 3 tentativas de cancelamento com backoff exponencial
- **Força atualização**: Marca como CANCELLED no banco se falhar em cancelar na corretora
- **Prevenção de fantasma**: Evita criação de ordens fantasma futuras

#### 🚀 **Nova Funcionalidade: Sincronização Completa**
- **`performCompleteFillsSync()`**: Executa limpeza fantasma + correções + fills órfãos
- **Execução automática**: Integrado ao PositionSyncService (1 min)
- **Logs detalhados**: Estatísticas completas de ações executadas

**Resultado:** Sistema agora detecta e resolve automaticamente ordens fantasma, fills órfãos e problemas de sincronização, garantindo integridade total dos dados.

---

## [1.5.45] - 2025-08-14

### 🔧 **BUGFIX CRÍTICO: Correção de Posições com Loss Não Contabilizadas**

**Problema Identificado:**
- Operações com loss pequeno (ex: -$0.16) não estavam sendo marcadas como CLOSED
- Validações muito restritivas impediam fechamento de posições com PnL válido
- Rate limiting severo causava "TOO MANY REQUESTS" com delays de até 5 minutos

**Soluções Implementadas:**

#### 🚀 **Global Request Queue para Rate Limiting**
- **Novo arquivo:** `src/Utils/GlobalRequestQueue.js`
- **Funcionalidade:** Serializa TODAS as requests da aplicação para evitar rate limiting
- **Benefícios:**
  - Elimina competição entre serviços fazendo requests simultâneas  
  - Sistema adaptativo de delays (2s mínimo, até 60s máximo)
  - Retry automático com backoff exponencial
  - Logging detalhado para monitoramento

#### 🎯 **Correção da Lógica de Fechamento de Posições**

**1. History.js - Reconstrução de Posições:**
- **Antes:** `Math.abs(pnl) < 0.01` bloqueava PnLs pequenos válidos
- **Agora:** Só bloqueia se PnL exatamente zero E preços idênticos
- **Resultado:** Posições com loss como -$0.16 são corretamente fechadas

**2. OrdersService.js - Cálculo de Posições via Fills:**
- **Antes:** `Math.abs(totalPnL) < 0.01` marcava PnLs pequenos como "suspeitos"
- **Agora:** Só bloqueia PnL exatamente zero COM múltiplos fills (erro real de cálculo)
- **Resultado:** Validação inteligente que preserva trades válidos

#### 📊 **Integração com Global Request Queue**
Arquivos modificados para usar a fila global:
- `src/Backpack/Authenticated/History.js` - getFillHistory e getOrderHistory
- `src/Backpack/Authenticated/Order.js` - getOpenOrders
- `src/Services/OrdersService.js` - Removidos delays manuais redundantes

### ✅ **Validação de Funcionamento**
**Teste realizado:** Bot ID 2 com trade CRV_USDC_PERP
- **Resultado:** Sistema detectou e fechou posição ONDO_USDC_PERP com loss de -$0.0152
- **Comprovação:** Operações com loss agora são corretamente contabilizadas

### 🔄 **Compatibilidade**
- Mantida proteção contra fills realmente suspeitos
- Logs detalhados para acompanhamento de fechamentos
- Sistema robusto de rate limiting global
- Funcionalidade de Force Sync preservada

## [1.5.44] - 2024-12-19

### 🎯 Suporte Ilimitado de Ordens por Bot
- **Problema:** Limite de 999 ordens por bot era muito restritivo
- **Solução:** Removido padding fixo para suporte ilimitado

- **Mudanças Implementadas:**
  - **ConfigManager.generateOrderId()**: Removido `.padStart(3, '0')`
  - **Formato do clientId**: `botClientOrderId + orderCounter` (sem padding)
  - **Capacidade**: Suporte a **9 quintilhões** de ordens por bot

- **Exemplos da Nova Lógica:**
  ```javascript
  // Antes: botClientOrderId=1548, orderCounter=1 → 1548001 (padding)
  // Agora: botClientOrderId=1548, orderCounter=1 → 15481 (sem padding)
  
  // Exemplos sem limite:
  botClientOrderId: 1548, orderCounter: 1 → 15481
  botClientOrderId: 1548, orderCounter: 12 → 154812
  botClientOrderId: 1548, orderCounter: 1234 → 15481234
  botClientOrderId: 1548, orderCounter: 999999 → 1548999999
  botClientOrderId: 1548, orderCounter: 1000000 → 15481000000
  ```

- **Capacidade Máxima:**
  - ✅ **Number.MAX_SAFE_INTEGER**: 9,007,199,254,740,991
  - ✅ **Bot Client Order ID máximo**: 9999 (4 dígitos)
  - ✅ **Order Counter máximo**: 9,007,199,254,730,992
  - ✅ **Total de ordens possíveis**: 9 quintilhões por bot

- **Benefícios:**
  - ✅ **Escalabilidade**: Suporte a milhões de ordens por bot
  - ✅ **Flexibilidade**: Sem limitações artificiais
  - ✅ **Compatibilidade**: Mantém compatibilidade com Backpack API
  - ✅ **Performance**: IDs menores para ordens iniciais

- **Arquivos Modificados:**
  - **ConfigManager.js**: `generateOrderId()` (removido padding)
  - **Testes**: Confirmada funcionalidade com testes reais

## [1.5.43] - 2024-12-19

### 🎯 Correção do clientId para Backpack API
- **Problema:** Backpack API espera `clientId` como **Int**, não string
- **Solução:** Implementada nova lógica de geração e validação de clientId

- **Mudanças Implementadas:**
  - **ConfigManager.generateOrderId()**: Agora retorna **Int** (ex: 1548001)
  - **Validação de ordens**: Usa `startsWith()` ao invés de `split('-')`
  - **Formato do clientId**: `botClientOrderId + orderCounter` (3 dígitos)

- **Exemplos da Nova Lógica:**
  ```javascript
  // Antes: "1548-1" (string)
  // Agora: 1548001 (number)
  
  // Exemplos:
  botClientOrderId: 1548, orderCounter: 1 → 1548001
  botClientOrderId: 1548, orderCounter: 12 → 1548012
  botClientOrderId: 1548, orderCounter: 123 → 1548123
  ```

- **Validação Atualizada:**
  - ✅ **Geração**: clientId é gerado como Int
  - ✅ **Identificação**: Verifica se clientId começa com botClientOrderId
  - ✅ **Filtragem**: Ordens são filtradas corretamente
  - ✅ **Compatibilidade**: Funciona com Backpack API

- **Arquivos Modificados:**
  - **ConfigManager.js**: `generateOrderId()` e `getBotOrders()`
  - **OrderController.js**: Todas as funções de validação de ordens
  - **Testes**: Confirmada funcionalidade com testes reais

## [1.5.43] - 2024-12-19

### 🎯 Migração de AUTHORIZED_MARKET para Configuração por Bot
- **Mudança:** Migrada variável de ambiente `AUTHORIZED_MARKET` para configuração individual por bot
- **Implementação:** Cada bot agora tem sua própria lista de tokens autorizados via `config.authorizedTokens`

- **Arquivos Modificados:**
  - **AccountController.js**: Usa `config.authorizedTokens` com fallback para `AUTHORIZED_MARKET`
  - **Decision.js**: Filtra mercados baseado em `config.authorizedTokens`
  - **Dashboard UI**: Interface completa para seleção de tokens autorizados
  - **ConfigManagerSQLite.js**: Suporte a `authorizedTokens` no banco de dados

- **Benefícios:**
  - ✅ **Flexibilidade**: Cada bot pode ter sua própria lista de tokens
  - ✅ **Interface Intuitiva**: Seleção visual de tokens com busca e ordenação
  - ✅ **Validação Obrigatória**: Usuário deve selecionar pelo menos 1 token
  - ✅ **Ordenação por Volume**: Tokens mais ativos aparecem primeiro
  - ✅ **Compatibilidade**: Mantém fallback para `AUTHORIZED_MARKET` existente

## [1.5.42] - 2024-12-19

### 🎯 Uso da Variável de Ambiente AUTHORIZED_MARKET
- **Mudança:** Substituída lista hardcoded por variável de ambiente `AUTHORIZED_MARKET`
- **Implementação:** Código agora usa configuração dinâmica de símbolos autorizados

- **Arquivos Modificados:**
  - **OrderController.js**: Substituída lista hardcoded por `AUTHORIZED_MARKET`
  - **POSITION_HISTORY_API.md**: Documentação atualizada
  - **CHANGELOG.md**: Nova entrada documentando a mudança

- **Benefícios:**
  - ✅ **Flexibilidade**: Símbolos podem ser configurados via variável de ambiente
  - ✅ **Consistência**: Mesma configuração usada em todo o sistema
  - ✅ **Manutenibilidade**: Não precisa alterar código para mudar símbolos
  - ✅ **Configurabilidade**: Suporte a array vazio (todos os símbolos) ou lista específica

## [1.5.41] - 2024-12-19

### 🎯 Position History API - Integração Backpack
- **Funcionalidade:** Sistema para buscar histórico de posições da Backpack e inferir quais foram criadas pelos bots
- **Implementação:** Novas funções e endpoints para análise de posições históricas

- **Novas Funções:**
  - **History.getPositionHistory()**: Busca histórico de posições da Backpack
  - **OrderController.getBotPositionsFromHistory()**: Infere posições criadas pelo bot
  - **OrderController.isLikelyBotPosition()**: Heurística para identificar posições do bot

- **Novos Endpoints:**
  - **GET /api/bot/:botId/positions/history**: Posições do histórico com filtros
  - **GET /api/bot/:botId/positions/history/summary**: Resumo estatístico das posições

- **Critérios de Inferência:**
  - ✅ **ClientId Match**: Ordens associadas com clientId do bot
  - ✅ **Símbolos Autorizados**: Baseado na variável de ambiente `AUTHORIZED_MARKET`
  - ✅ **Timing Correto**: Posições criadas após início do bot
  - ✅ **Quantidade Típica**: Range baseado no capital do bot
  - ✅ **Horário de Mercado**: Posições em horários ativos

- **Estatísticas Detalhadas:**
  - **Total**: Número total de posições identificadas
  - **Open/Closed**: Status das posições
  - **Profitable/Losing**: Posições lucrativas vs. perdedoras
  - **Total PnL**: Soma de todos os PnLs realizados

- **Melhorias Técnicas:**
  - ✅ **Retry Logic**: Timeout e retry para API da Backpack
  - ✅ **Filtros Avançados**: Símbolo, limite, offset, ordenação
  - ✅ **Logs Detalhados**: Rastreamento completo da inferência
  - ✅ **Tratamento de Erro**: Robustez contra falhas de API

- **Documentação:**
  - **POSITION_HISTORY_API.md**: Guia completo com exemplos
  - **Exemplos Frontend**: React hooks e componentes
  - **Heurísticas**: Critérios de inferência documentados

## [1.5.39] - 2024-12-19

### 🎯 Correção do Countdown Após Atualização do Bot
- **Problema:** Countdown ficava em "Calculando..." após atualizar configurações do bot
- **Causa:** `nextValidationAt` não era recalculado após atualização das configurações
- **Solução:** Adicionada recálculo automático do `nextValidationAt` após atualização

- **Arquivos Corrigidos:**
  - **DashboardPage.tsx**: Adicionada chamada para `/api/bot/:id/next-execution` após atualização
  - **BotCard.tsx**: Adicionados logs de debug para rastrear problemas de countdown

- **Melhorias Implementadas:**
  - ✅ **Recálculo Automático**: `nextValidationAt` é recalculado quando bot está rodando
  - ✅ **Logs de Debug**: Adicionados logs detalhados para rastrear problemas
  - ✅ **Atualização Dupla**: Status é recarregado duas vezes para garantir sincronização
  - ✅ **Tratamento de Erro**: Erros no recálculo não impedem a atualização

## [1.5.38] - 2024-12-19

### 🎯 Correção do Stop Loss Negativo
- **Problema:** Valor default do `Stop Loss (%)` estava positivo
- **Causa:** Configurações padrão definidas como `"10"` ao invés de `"-10"`
- **Solução:** Corrigidos todos os valores default para serem negativos

- **Arquivos Corrigidos:**
  - **DashboardPage.tsx**: Valores default alterados de `"10"` para `"-10"`
  - **ConfigForm.tsx**: Botões de modo agora usam `"-10"` como string
  - **Validação**: Já estava correta, forçando valores negativos

- **Configurações Corrigidas:**
  - ✅ **Stop Loss Padrão**: Agora é `-10%` (negativo)
  - ✅ **Validação**: Impede valores positivos
  - ✅ **Botões de Modo**: Ambos usam `-10%` como padrão
  - ✅ **Consistência**: Todos os valores seguem o padrão correto

## [1.5.37] - 2024-12-19

### 🎯 Botões de Configuração Rápida no Modal
- **Funcionalidade:** Adicionados botões "VOLUME", "LUCRO" e "RESET" para configuração rápida
- **Localização:** Modal de criação e edição de bots
- **Posicionamento:** Lateral direita do título "Configurações de Trading"

- **Design dos Botões:**
  - ✅ **Cor:** Branco com texto cinza (cor do background do modal)
  - ✅ **Tamanho:** Pequenos e compactos
  - ✅ **Ícones:** Elegantes do Lucide React (BarChart3, DollarSign, RotateCcw)
  - ✅ **Destaque:** Ring colorido quando selecionado
  - ✅ **Tooltips:** Explicações detalhadas de cada modo
  - ✅ **Reset:** Botão para voltar à configuração inicial

- **Configurações por Modo:**

  **📊 VOLUME (Configurações Padrão):**
  - Capital: 20%
  - Timeframe: 30m
  - Modo Execução: REALTIME
  - Stop Loss: -10%
  - Lucro Mínimo: 0.5%
  - Slippage: 0.5%
  - Estratégia Híbrida: ❌ Desabilitada
  - Trailing Stop: ❌ Desabilitado
  - Máximo Ordens: 5

  **💰 LUCRO (Configurações Avançadas):**
  - Capital: 20%
  - Timeframe: 30m
  - Modo Execução: REALTIME
  - Stop Loss: -10%
  - Lucro Mínimo: 10% ⭐
  - Slippage: 0.5%
  - Estratégia Híbrida: ✅ Habilitada
  - Trailing Stop: ✅ Habilitado
  - Máximo Ordens: 5

  **🔄 RESET:**
  - Volta à configuração inicial do modal
  - Permite partir do zero novamente

- **Benefícios:**
  - 🎯 Configuração rápida e intuitiva
  - 👁️ Experiência do usuário melhorada
  - 🚀 Menos tempo para configurar bots
  - 📊 Presets otimizados para diferentes estratégias
  - 🔄 Flexibilidade para resetar e recomeçar

## [1.5.36] - 2024-12-19

### 🎯 Countdown Funcionando Corretamente
- **Status:** ✅ **RESOLVIDO** - Countdown agora funciona perfeitamente
- **Evidência:** Backend salvando em UTC correto: `"2025-08-07T16:46:54.180Z"`
- **Verificação:** Frontend interpretando UTC corretamente

- **Correções Aplicadas:**
  - ✅ **Backend**: Todas as 6 ocorrências corrigidas para `toISOString()`
  - ✅ **Frontend**: Removida lógica complexa de timezone
  - ✅ **Servidor**: Reiniciado para aplicar correções

- **Funcionalidades Confirmadas:**
  - ✅ **Countdown Preciso**: Exibe "Próxima Atualização em: MM:SS"
  - ✅ **UTC Consistente**: Backend sempre salva em UTC
  - ✅ **Frontend Limpo**: Interpretação direta de UTC
  - ✅ **Sistema Robusto**: Comportamento padronizado

- **Benefícios:**
  - 🎯 Countdown sempre preciso e funcional
  - 👁️ Experiência do usuário melhorada
  - 🚀 Sistema mais robusto e consistente
  - 📊 Comportamento padronizado

## [1.5.35] - 2024-12-19

### 🎯 Correção Definitiva do Timezone no Backend
- **Problema:** Backend salvava horário local mas adicionava `.000Z` (indicando UTC)
- **Causa:** Inconsistência entre horário salvo e formato UTC
- **Solução:** Backend agora salva corretamente em UTC usando `toISOString()`

- **Arquivos Corrigidos:**
  - **app-api.js**: Todas as 6 ocorrências de `toLocaleString('sv-SE')` alteradas para `toISOString()`
  - **BotCard.tsx**: Removida lógica especial de timezone (não mais necessária)

- **Funcionalidades:**
  - ✅ **UTC Consistente**: Backend salva sempre em UTC
  - ✅ **Countdown Preciso**: Frontend interpreta UTC corretamente
  - ✅ **Código Limpo**: Removida lógica complexa de timezone

- **Benefícios:**
  - 🎯 Countdown sempre preciso e funcional
  - 👁️ Experiência do usuário melhorada
  - 🚀 Sistema mais robusto e consistente
  - 📊 Comportamento padronizado

## [1.5.34] - 2024-12-19

### 🎯 Correção do Timezone no Countdown
- **Problema:** Countdown não estava sendo exibido devido a problema de timezone
- **Causa:** Backend salva horário local mas adiciona `.000Z` (indicando UTC)
- **Solução:** Frontend agora trata corretamente o timezone local

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Adicionada lógica para tratar horário local corretamente
  - **Lógica**: Remove `.000Z` e interpreta como horário local

- **Funcionalidades:**
  - ✅ **Timezone Correto**: Interpreta horário local corretamente
  - ✅ **Countdown Funcional**: Agora exibe countdown quando bot está rodando
  - ✅ **Debug Melhorado**: Logs detalhados para troubleshooting

- **Benefícios:**
  - 🎯 Countdown preciso e funcional
  - 👁️ Experiência do usuário melhorada
  - 🚀 Sistema mais robusto
  - 📊 Comportamento consistente

## [1.5.33] - 2024-12-19

### 🎯 Melhoria no Countdown usando Status da API
- **Problema:** Frontend não estava usando o valor `nextValidationAt` do payload de status
- **Causa:** BotCard não recebia o status completo da API
- **Solução:** Modificado para usar `nextValidationAt` diretamente do status

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Adicionado `botStatus` prop e lógica para usar `nextValidationAt` do status
  - **DashboardPage.tsx**: Passando `botStatus` completo para o BotCard
  - **Interface**: Atualizada `BotCardProps` para incluir `botStatus`

- **Funcionalidades:**
  - ✅ **Countdown Direto**: Usa valor do status da API
  - ✅ **Sem Chamadas Extras**: Não precisa de endpoint separado
  - ✅ **Mais Eficiente**: Menos requisições ao servidor
  - ✅ **Mais Preciso**: Valor sempre atualizado

- **Benefícios:**
  - 🎯 Countdown mais preciso e eficiente
  - 👁️ Melhor performance do frontend
  - 🚀 Menos carga no servidor
  - 📊 Experiência mais fluida

## [1.5.31] - 2024-12-19

### 🎯 Correção da Atualização do NextValidationAt
- **Problema:** Campo `nextValidationAt` não era atualizado a cada execução do bot
- **Causa:** Função `executeBot` não calculava e salvava o próximo horário após cada validação
- **Solução:** Adicionada atualização do `nextValidationAt` dentro da função `executeBot`

- **Arquivos Corrigidos:**
  - **app-api.js**: Adicionada atualização do `nextValidationAt` após cada execução bem-sucedida
  - **Lógica**: Calcula próximo horário baseado no `executionInterval` atual

- **Funcionalidades:**
  - ✅ **Atualização Automática**: `nextValidationAt` atualizado a cada execução
  - ✅ **Countdown Preciso**: Horário sempre atualizado e preciso
  - ✅ **Persistência**: Valor salvo no arquivo após cada execução

- **Benefícios:**
  - 🎯 Countdown sempre preciso
  - 👁️ Experiência do usuário melhorada
  - 🚀 Sistema mais robusto
  - 📊 Comportamento consistente

## [1.5.30] - 2024-12-19

### 🎯 Correção do Countdown no Frontend
- **Problema:** Countdown não estava sendo exibido no frontend
- **Causa:** Campo `nextValidationAt` não estava incluído na interface `BotConfig` do DashboardPage
- **Solução:** Adicionado campo `nextValidationAt` à interface e removidos logs de debug

- **Arquivos Corrigidos:**
  - **DashboardPage.tsx**: Adicionado `nextValidationAt?: string` à interface `BotConfig`
  - **BotCard.tsx**: Removidos logs de debug desnecessários

- **Funcionalidades:**
  - ✅ **Countdown Funcional**: Agora exibe "Próxima Atualização em: MM:SS"
  - ✅ **Interface Completa**: Campo `nextValidationAt` disponível no frontend
  - ✅ **Código Limpo**: Removidos logs de debug

- **Benefícios:**
  - 🎯 Countdown visível no frontend
  - 👁️ Experiência do usuário melhorada
  - 🚀 Código mais limpo
  - 📊 Funcionalidade completa

## [1.5.29] - 2024-12-19

### 🎯 Limpeza de Rotas Legadas com StrategyName
- **Problema:** Existiam rotas usando `strategyName` que não eram utilizadas
- **Causa:** Rotas legadas mantidas durante migração para `botId`
- **Solução:** Removidas rotas não utilizadas para manter consistência

- **Rotas Removidas:**
  - **`DELETE /api/configs/:strategyName`**: Rota legada para remoção por strategyName
  - **`GET /api/backpack-positions/:strategyName`**: Rota legada para posições por strategyName

- **Rotas Mantidas:**
  - **`DELETE /api/configs/bot/:botName`**: Remove configuração por botName
  - **`GET /api/backpack-positions/bot/:botName`**: Busca posições por botName

- **Funcionalidades:**
  - ✅ **Consistência**: Todas as rotas agora usam identificadores específicos
  - ✅ **Limpeza**: Removidas rotas não utilizadas
  - ✅ **Manutenibilidade**: Código mais limpo e organizado

- **Benefícios:**
  - 🎯 API mais consistente
  - 👁️ Menos confusão na arquitetura
  - 🚀 Código mais limpo
  - 📊 Melhor organização

## [1.5.28] - 2024-12-19

### 🎯 Correção do Endpoint de Trading Stats
- **Problema:** Frontend chamava endpoint com `strategyName` ao invés de `botId`
- **Causa:** Endpoint `/api/trading-stats/:strategyName` não era específico por bot
- **Solução:** Criado novo endpoint `/api/trading-stats/:botId` e corrigido frontend

- **Arquivos Corrigidos:**
  - **app-api.js**: Novo endpoint `/api/trading-stats/:botId` usando `getBotConfigById`
  - **BotCard.tsx**: Frontend agora usa `config.id` ao invés de `config.strategyName`
  - **Validação**: Adicionada validação de ID do bot no endpoint

- **Funcionalidades:**
  - ✅ **Endpoint Específico**: Cada bot tem suas próprias estatísticas
  - ✅ **Validação Robusta**: Verifica se ID do bot é válido
  - ✅ **Consistência**: Alinhado com outros endpoints que usam botId

- **Benefícios:**
  - 🎯 Estatísticas específicas por bot
  - 👁️ Melhor organização dos dados
  - 🚀 Sistema mais robusto
  - 📊 Arquitetura mais consistente

## [1.5.27] - 2024-12-19

### 🎯 Correção da Validação do Stop Loss
- **Problema:** Validação do campo "Stop Loss (%)" exigia valor positivo
- **Causa:** Lógica de validação incorreta para valores de stop loss
- **Solução:** Corrigida validação para aceitar apenas valores negativos

- **Arquivos Corrigidos:**
  - **ConfigForm.tsx**: Corrigida validação de `maxNegativePnlStopPct`
  - **Lógica**: Mudou de `<= 0` para `>= 0` (aceita apenas negativos)
  - **Mensagem**: Atualizada para "Stop Loss deve ser um valor negativo"

- **Funcionalidades:**
  - ✅ **Validação Correta**: Aceita apenas valores negativos
  - ✅ **Mensagem Clara**: Explica que deve ser negativo
  - ✅ **Consistência**: Alinhado com o comportamento esperado do sistema

- **Benefícios:**
  - 🎯 Validação correta para stop loss
  - 👁️ Experiência do usuário melhorada
  - 🚀 Prevenção de erros de configuração
  - 📊 Comportamento consistente

## [1.5.26] - 2024-12-19

### 🎯 Correção do Timezone e Frontend para NextValidationAt
- **Problema:** Sistema salvava em UTC e frontend não usava `nextValidationAt` do bot
- **Causa:** `toISOString()` sempre retorna UTC e frontend dependia da API
- **Solução:** Corrigido timezone para local e frontend usa valor salvo no bot

- **Arquivos Corrigidos:**
  - **app-api.js**: Substituído `toISOString()` por timezone local
  - **BotCard.tsx**: Frontend agora usa `nextValidationAt` diretamente do bot
  - **Interface**: Adicionado campo `nextValidationAt` à interface `BotConfig`
  - **Timezone**: Usa `toLocaleString('sv-SE')` para timezone local

- **Funcionalidades:**
  - ✅ **Timezone Local**: Horários salvos no timezone do computador
  - ✅ **Frontend Independente**: Não depende mais da API para countdown
  - ✅ **Performance**: Menos chamadas à API
  - ✅ **Precisão**: Countdown baseado no valor salvo no bot

- **Benefícios:**
  - 🎯 Horários corretos no timezone local
  - 👁️ Countdown mais preciso e estável
  - 🚀 Sistema mais eficiente
  - 📊 Experiência mais consistente

## [1.5.25] - 2024-12-19

### 🎯 Implementação do Sistema de NextValidationAt
- **Problema:** Countdown recalculava a cada atualização da tela
- **Causa:** API sempre calculava novo `nextExecutionDate` baseado no momento atual
- **Solução:** Implementado campo `nextValidationAt` salvo no bot para valor fixo

- **Arquivos Corrigidos:**
  - **bot_configs.json**: Adicionado campo `nextValidationAt` ao bot
  - **app-api.js**: API agora usa valor salvo ao invés de recalcular
  - **Lógica de Inicialização**: Salva `nextValidationAt` quando bot é iniciado
  - **Recuperação**: Mantém valor salvo durante recuperação de bots

- **Funcionalidades:**
  - ✅ **Valor Fixo**: `nextValidationAt` salvo no bot não muda
  - ✅ **Recálculo Inteligente**: Só recalcula quando tempo já passou
  - ✅ **Persistência**: Valor mantido mesmo após refresh da tela
  - ✅ **Inicialização**: Salva próximo horário quando bot é iniciado

- **Benefícios:**
  - 🎯 Countdown estável mesmo após refresh
  - 👁️ Experiência visual consistente
  - 🚀 Sistema mais robusto e confiável
  - 📊 Comportamento previsível e estável

## [1.5.24] - 2024-12-19

### 🔧 Correção do Bug do Countdown
- **Problema:** Countdown reiniciava em 00:55 ao invés de chegar a 00:00
- **Causa:** API sendo chamada a cada 5 segundos retornando novos `nextExecutionDate`
- **Solução:** Implementado controle de atualização e redução da frequência de chamadas

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Adicionado controle para evitar atualizações desnecessárias
  - **Lógica de Atualização**: Só atualiza se diferença > 10 segundos
  - **Frequência Reduzida**: API chamada a cada 30s ao invés de 5s
  - **Proteção Countdown**: Aguarda nova atualização quando diff < 5s

- **Funcionalidades:**
  - ✅ **Countdown Estável**: Não reinicia mais em 00:55
  - ✅ **Atualizações Inteligentes**: Só atualiza quando necessário
  - ✅ **Proteção contra Reinício**: Aguarda nova atualização quando próximo do fim
  - ✅ **Performance Melhorada**: Menos chamadas à API

- **Benefícios:**
  - 🎯 Countdown funciona corretamente até 00:00
  - 👁️ Experiência visual mais estável
  - 🚀 Menos carga na API
  - 📊 Comportamento mais previsível

## [1.5.23] - 2024-12-19

### 📊 Correção da Formatação do Profit Ratio
- **Problema:** Profit Ratio mostrava formatação `$0.00` que não era adequada
- **Causa:** Formatação com símbolo de dólar e 2 casas decimais
- **Solução:** Alterado para formato `0.000` sem símbolo de moeda

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Removido `$` e alterado de `.toFixed(2)` para `.toFixed(3)`
  - **Formatação**: Agora mostra `0.000` ao invés de `$0.00`
  - **Consistência**: Formato mais adequado para ratio/proporção

- **Funcionalidades:**
  - ✅ **Formato Correto**: Profit Ratio agora mostra `0.000`
  - ✅ **Sem Símbolo**: Removido `$` para melhor clareza
  - ✅ **3 Casas Decimais**: Precisão adequada para ratio
  - ✅ **Cores Mantidas**: Verde para positivo, vermelho para negativo

- **Benefícios:**
  - 🎯 Formatação mais adequada para ratio/proporção
  - 👁️ Interface mais limpa sem símbolos desnecessários
  - 🚀 Consistência visual melhorada
  - 📊 Precisão adequada para métricas de trading

## [1.5.22] - 2024-12-19

### 🔧 Correção dos Tooltips - Implementação Funcional
- **Problema:** Tooltips não apareciam após a correção anterior
- **Causa:** Uso incorreto de `hidden hover:block` que não funciona com elementos filhos
- **Solução:** Implementado sistema com `opacity` e `group-hover` para funcionamento correto

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Substituído `hidden hover:block` por `opacity-0 group-hover:opacity-100`
  - **Transição Suave**: Adicionado `transition-opacity` para animação
  - **Pointer Events**: Adicionado `pointer-events-none` para evitar interferência

- **Funcionalidades:**
  - ✅ **Tooltips Funcionais**: Aparecem corretamente no hover do ícone `?`
  - ✅ **Transição Suave**: Animação de fade in/out
  - ✅ **Precisão**: Só aparecem no hover do ícone, não do card todo
  - ✅ **Estabilidade**: Sistema robusto e confiável

- **Benefícios:**
  - 🎯 Tooltips funcionando corretamente
  - 👁️ Experiência visual suave e profissional
  - 🚀 Comportamento preciso e intuitivo
  - 📊 Interface estável e responsiva

## [1.5.21] - 2024-12-19

### 🎯 Correção do Comportamento dos Tooltips
- **Problema:** Tooltips apareciam quando o mouse passava sobre todo o card
- **Causa:** Uso de `group-hover` em vez de `hover` específico no ícone
- **Solução:** Tooltips agora aparecem apenas no hover do ícone `?`

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Removido `group` e `group-hover`, implementado `hover` específico
  - **Precisão**: Tooltips aparecem apenas quando mouse está sobre o ícone `?`
  - **UX Melhorada**: Comportamento mais intuitivo e preciso

- **Funcionalidades:**
  - ✅ **Hover Preciso**: Tooltips só aparecem no hover do ícone `?`
  - ✅ **Cores Dinâmicas**: Ícone muda de cor no hover (azul, vermelho, roxo, laranja)
  - ✅ **Posicionamento Correto**: Tooltip aparece acima do ícone
  - ✅ **Comportamento Consistente**: Mesmo comportamento para todas as métricas

- **Benefícios:**
  - 🎯 Comportamento mais intuitivo e preciso
  - 👁️ Tooltips não interferem na navegação
  - 🚀 Experiência mais limpa e profissional
  - 📊 Interface mais responsiva e controlada

## [1.5.20] - 2024-12-19

### 🎨 Melhorias na Interface das Estatísticas de Trading
- **Problema:** Terminologia confusa e falta de explicações sobre as métricas
- **Causa:** "P&L Total" não era claro e usuários não entendiam as métricas
- **Solução:** Renomeado para "Profit Ratio" e adicionado tooltips explicativos

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Alterado "P&L Total" para "Profit Ratio"
  - **Tooltips Informativos**: Adicionado ícone `?` com explicações user-friendly
  - **UX Melhorada**: Tooltips aparecem no hover com explicações claras

- **Funcionalidades:**
  - ✅ **Profit Ratio**: Nome mais claro para lucro/prejuízo total
  - ✅ **Tooltips Explicativos**: Explicações para cada métrica
  - ✅ **User-Friendly**: Linguagem simples e fácil de entender
  - ✅ **Hover Interativo**: Tooltips aparecem no hover do ícone `?`

- **Explicações Adicionadas:**
  - 📈 **Trades Ganhos**: "Número total de operações que resultaram em lucro"
  - 📉 **Trades Perdidos**: "Número total de operações que resultaram em prejuízo"
  - 🎯 **Win Rate**: "Percentual de trades lucrativos em relação ao total"
  - 💰 **Profit Ratio**: "Lucro ou prejuízo total acumulado de todas as operações"
  - 📊 **Total Trades**: "Número total de operações realizadas pelo bot"
  - 🔄 **Posições Abertas**: "Número de posições atualmente abertas no mercado"

- **Benefícios:**
  - 🎯 Interface mais intuitiva e educativa
  - 👁️ Usuários entendem melhor as métricas
  - 🚀 Experiência mais profissional
  - 📊 Terminologia mais clara e consistente

## [1.5.19] - 2024-12-19

### 🎨 Melhoria no Sistema de Loading das Estatísticas
- **Problema:** Loading de estatísticas mostrava spinner que prejudicava o layout
- **Causa:** Sistema de loading antigo com spinner centralizado
- **Solução:** Implementado skeleton loading com efeito blur/animação

- **Arquivos Corrigidos:**
  - **BotCard.tsx**: Criado componente `TradingStatsSkeleton` com animação pulse
  - **Lógica de Loading**: Implementado `hasLoadedOnce` para controlar primeira carga
  - **UX Melhorada**: Skeleton mostra estrutura dos dados durante carregamento

- **Funcionalidades:**
  - ✅ **Skeleton Loading**: Efeito blur/animação nos campos durante carregamento
  - ✅ **Primeira Carga**: Skeleton só aparece na primeira vez que carrega
  - ✅ **Atualizações Silenciosas**: Dados atualizam sem mostrar loading
  - ✅ **Layout Preservado**: Estrutura mantida durante carregamento

- **Benefícios:**
  - 🎯 Experiência visual mais profissional
  - 👁️ Layout não quebra durante carregamento
  - 🚀 Atualizações mais suaves
  - 📊 Interface mais moderna e responsiva

## [1.5.18] - 2024-12-19

### 🔧 Correção do Erro "require is not defined" na API
- **Problema:** API `/api/bot/:botId/next-execution` retornava erro "require is not defined"
- **Causa:** Uso incorreto de `require()` em contexto ES6 module
- **Solução:** Removido `require()` e usado import ES6 já existente

- **Arquivos Corrigidos:**
  - **app-api.js**: Removido `const TimeframeConfig = require('./src/Config/TimeframeConfig.js').default;`
  - **Import Correto**: Usado `import TimeframeConfig from './src/Config/TimeframeConfig.js';` já existente
  - **API Funcional**: `/api/bot/:botId/next-execution` agora retorna dados corretos

- **Funcionalidades:**
  - ✅ **API Funcional**: Retorna `nextExecutionDate` e `nextExecutionMs` corretamente
  - ✅ **Countdown Ativo**: Frontend agora recebe dados para calcular countdown
  - ✅ **Módulo ES6**: Compatibilidade total com sistema de módulos ES6
  - ✅ **Sem Erros**: API não retorna mais erros de "require is not defined"

- **Benefícios:**
  - 🎯 Countdown funcionando corretamente
  - 🚀 API estável e sem erros
  - 📊 Sistema de módulos consistente
  - 🔧 Código mais limpo e moderno

## [1.5.17] - 2024-12-19

### 🔧 Correção Final do Sistema de Status dos Bots
- **Problema:** Countdown não funcionava porque `isRunning` não estava sendo determinado corretamente
- **Causa:** API de status não verificava se o bot estava realmente ativo no `activeBotInstances`
- **Solução:** Melhorada lógica de determinação do status real dos bots

- **Arquivos Corrigidos:**
  - **app-api.js**: API `/api/bot/status` agora verifica `activeBotInstances.has(config.id)`
  - **Lógica de Status**: `isRunning = config.status === 'running' && activeBotInstances.has(config.id)`
  - **Verificação Real**: Status baseado na instância ativa, não apenas no arquivo de configuração

- **Funcionalidades:**
  - ✅ **Status Real**: `isRunning` agora reflete se o bot está realmente rodando
  - ✅ **Countdown Funcional**: Exibe "Próxima Atualização em: MM:SS" quando bot ativo
  - ✅ **API Corrigida**: `/api/bot/:botId/next-execution` funciona corretamente
  - ✅ **Interface Limpa**: Removidos todos os logs de debug

- **Benefícios:**
  - 🎯 Countdown funcionando corretamente
  - 👁️ Status real dos bots no frontend
  - 🚀 Sistema confiável e preciso
  - 📊 Melhor experiência do usuário

## [1.5.16] - 2024-12-19

### 🔧 Correção do Countdown no BotCard
- **Problema:** Countdown não estava sendo exibido corretamente, mostrando apenas "Última atualização"
- **Causa:** Falta do campo `id` na interface `BotConfig` do DashboardPage
- **Solução:** Adicionado campo `id` à interface e corrigida lógica de exibição

- **Arquivos Corrigidos:**
  - **DashboardPage.tsx**: Adicionado `id?: number` à interface `BotConfig`
  - **BotCard.tsx**: Melhorada lógica de condição para exibição do countdown
  - **Lógica de Debug**: Removidos logs de debug desnecessários

- **Funcionalidades:**
  - ✅ **Countdown Funcional**: Agora exibe "Próxima Atualização em: MM:SS"
  - ✅ **Condição Corrigida**: Verifica `isRunning && countdown && countdown !== ''`
  - ✅ **Fallback Inteligente**: Mostra "Última atualização" quando bot parado
  - ✅ **Interface Limpa**: Removidos logs de debug da interface

- **Benefícios:**
  - 🎯 Countdown funcionando corretamente
  - 👁️ Visibilidade em tempo real da próxima execução
  - 🚀 Interface limpa e profissional
  - 📊 Melhor experiência do usuário

## [1.5.15] - 2024-12-19

### 🔧 Melhoria na Interface do BotCard
- **Problema:** Interface mostrava "Última atualização" em vez de informação útil sobre próxima execução
- **Causa:** Falta de informação em tempo real sobre quando o bot fará a próxima análise
- **Solução:** Substituído por "Próxima Atualização" com countdown em tempo real

- **Arquivos Atualizados:**
  - **BotCard.tsx**: Substituído "Última atualização" por countdown de próxima execução
  - **Interface Integrada**: Countdown integrado na seção de estatísticas
  - **Remoção de Duplicação**: Removido countdown separado para melhor UX

- **Funcionalidades:**
  - ✅ **Countdown em Tempo Real**: Mostra tempo restante até próxima execução
  - ✅ **Integração Inteligente**: Aparece apenas quando bot está rodando
  - ✅ **Fallback**: Mostra "Última atualização" quando bot está parado
  - ✅ **Design Consistente**: Mantém estilo visual do card
  - ✅ **Atualização Automática**: Countdown atualiza a cada segundo

- **Benefícios:**
  - 👁️ Visibilidade clara de quando o bot fará próxima análise
  - 🎯 Melhor experiência do usuário com informação útil
  - 📊 Interface mais limpa e informativa
  - 🚀 Feedback visual em tempo real

## [1.5.14] - 2024-12-19

### 🔧 Correção do Sistema de Análise por ExecutionMode
- **Problema:** Sistema de análise estava usando timeframe em vez do `bot.executionMode`
- **Causa:** Lógica incorreta que não respeitava o modo de execução configurado no bot
- **Solução:** Implementado sistema correto baseado no `executionMode` do bot

- **Arquivos Corrigidos:**
  - **app-api.js**: Funções `recoverBot` e `startBot` agora usam `executionMode`
  - **TimeframeConfig.js**: Já estava correto, usado como referência
  - **Lógica de Intervalo**: Baseada no modo de execução, não no timeframe

- **Funcionalidades:**
  - ✅ **REALTIME**: Análise a cada 60 segundos (fixo)
  - ✅ **ON_CANDLE_CLOSE**: Análise baseada no timeframe usando `TimeframeConfig`
  - ✅ **Cálculo Inteligente**: Usa `getTimeUntilNextCandleClose()` para ON_CANDLE_CLOSE
  - ✅ **Logs Detalhados**: Mostra modo de execução e próximo intervalo
  - ✅ **Consistência**: Mesma lógica do `app.js` aplicada ao `app-api.js`

- **Benefícios:**
  - 🎯 Análise no momento correto baseada na configuração do bot
  - 📊 Separação clara entre REALTIME e ON_CANDLE_CLOSE
  - 🚀 Sistema consistente entre `app.js` e `app-api.js`
  - 📈 Melhor performance e precisão nas análises

## [1.5.13] - 2024-12-19

### 🔧 Sistema de Rate Limit para Monitores
- **Problema:** Monitores não tinham proteção contra rate limits da exchange, causando timeouts e falhas
- **Causa:** Falta de sistema de backoff exponencial similar ao TrailingStop
- **Solução:** Implementado sistema inteligente de rate limit para todos os monitores

- **Arquivos Atualizados:**
  - **app.js**: Sistema de rate limit para PENDING_ORDERS e ORPHAN_MONITOR
  - **app-api.js**: Sistema de rate limit por bot para monitores independentes
  - **Variáveis de Controle:** Intervalos dinâmicos com backoff exponencial

- **Funcionalidades:**
  - ✅ **PENDING_ORDERS**: 15s → 2min (backoff exponencial)
  - ✅ **ORPHAN_MONITOR**: 20s → 3min (backoff exponencial)
  - ✅ **Detecção Automática**: HTTP 429, "rate limit", "429"
  - ✅ **Recuperação Inteligente**: Reduz intervalo gradualmente após sucesso
  - ✅ **Independente por Bot**: Cada bot tem seu próprio controle de rate limit

- **Benefícios:**
  - 🛡️ Proteção contra timeouts da exchange
  - 📈 Recuperação automática após rate limits
  - 🎯 Intervalos otimizados por bot
  - 🚀 Sistema resiliente e inteligente

## [1.5.12] - 2024-12-19

### 🔧 Correção de Intervalos de Monitores
- **Problema:** Monitores `startPendingOrdersMonitor` e `startOrphanOrderMonitor` estavam usando timeframe em vez de intervalos fixos
- **Causa:** Configuração incorreta que fazia monitores rodarem no mesmo tempo da análise de oportunidades
- **Solução:** Configurados para usar intervalos fixos (15s para PENDING_ORDERS, 20s para ORPHAN_MONITOR)

- **Arquivos Corrigidos:**
  - **app.js**: Monitores agora usam intervalos fixos em vez de timeframe
  - **app-api.js**: Monitores independentes com intervalos fixos, separados do `executeBot`
  - **BotCard.tsx**: Adicionado countdown em tempo real para próxima execução

- **Funcionalidades:**
  - ✅ PENDING_ORDERS: 15 segundos (intervalo fixo)
  - ✅ ORPHAN_MONITOR: 20 segundos (intervalo fixo)
  - ✅ Análise de oportunidades: baseada no timeframe (REALTIME/ON_CANDLE_CLOSE)
  - ✅ Countdown em tempo real no frontend
  - ✅ API para próximo tempo de execução

- **Benefícios:**
  - 🎯 Monitores mais responsivos com intervalos apropriados
  - 📊 Separação clara entre monitoramento e análise
  - 👁️ Visibilidade em tempo real da próxima execução
  - 🚀 Melhor experiência do usuário com countdown

### 🔧 Implementação de Countdown no Frontend
- **Nova API:** `/api/bot/:botId/next-execution` para obter próximo tempo de execução
- **Componente:** Countdown em tempo real no BotCard mostrando tempo restante
- **Atualizações:** Countdown atualiza a cada segundo, próxima execução a cada 5 segundos
- **Display:** Mostra modo de execução (REALTIME/ON_CANDLE_CLOSE) e timeframe

## [1.5.10] - 2024-12-31

### 🔧 Debug Detalhado de Stop Loss Duplicado
- **Problema:** Bot criando múltiplas ordens de stop loss duplicadas para a mesma posição
- **Causa:** Possível falha na validação de ordens existentes ou cache sendo limpo incorretamente
- **Solução:** Adicionados logs extensivos para diagnosticar o processo de criação de stop loss

- **Arquivos Atualizados:**
  - **OrderController.js**: Adicionados logs detalhados em `validateAndCreateStopLoss` e `hasExistingStopLoss`
  - Logs incluem: verificação de lock, cache, ordens existentes, criação de novas ordens
  - Melhorada visibilidade do processo de validação de stop loss existente

- **Funcionalidades:**
  - ✅ Logs detalhados para diagnóstico de criação de stop loss duplicado
  - ✅ Verificação de lock para evitar criações simultâneas
  - ✅ Logs de cache de stop loss (limpeza e atualização)
  - ✅ Rastreamento completo de ordens existentes vs novas

- **Benefícios:**
  - 🔍 Diagnóstico preciso de por que stop loss duplicados são criados
  - 📊 Visibilidade completa do processo de validação
  - 🛠️ Base para correção do problema de duplicação
  - 📈 Melhor compreensão do comportamento do sistema

## [1.5.9] - 2024-12-31

### 🔧 Correção de API Keys no TrailingStop
- **Problema:** `OrderController.validateAndCreateStopLoss` não recebia `apiKey` e `apiSecret` quando chamado de `TrailingStop.js`
- **Causa:** `TrailingStop.js` estava passando `this.config.strategyName` (string) em vez do objeto `config` completo
- **Solução:** Corrigida passagem de parâmetros para incluir o objeto `config` completo com credenciais

- **Arquivos Corrigidos:**
  - **TrailingStop.js**: Corrigidas duas chamadas para `OrderController.validateAndCreateStopLoss`
  - Linha 883: Adicionado `this.config` como terceiro parâmetro
  - Linha 1640: Corrigido para usar `this.config.id` como botName e `this.config` como config

- **Benefícios:**
  - 🛡️ Criação de stop loss funcionando corretamente
  - 🔐 Autenticação adequada com a exchange
  - 🎯 Identificação correta do bot nas operações
  - 📊 Logs mais precisos com nome correto do bot

### 🔧 Melhorias na Validação de Slippage
- **Debug Detalhado da Revalidação de Sinais**
  - **Problema:** Sinais sendo invalidados mesmo com slippage dentro do limite (0.5%)
  - **Causa:** Revalidação de sinal estava falhando devido a mudanças nas condições de mercado
  - **Solução:** Adicionados logs extensivos para diagnosticar o processo de revalidação

- **Arquivos Atualizados:**
  - **OrderController.js**: Adicionados logs detalhados em `revalidateSignal`
  - Logs incluem: dados originais do sinal, estratégia usada, preços atuais, ações normalizadas
  - Melhorada lógica de comparação de ações com normalização (lowercase, trim)

- **Funcionalidades:**
  - ✅ Logs detalhados para diagnóstico de revalidação de sinais
  - ✅ Normalização de ações para comparação mais robusta
  - ✅ Verificação separada para decisão null e ação ausente
  - ✅ Rastreamento completo do processo de revalidação

- **Benefícios:**
  - 🔍 Diagnóstico preciso de por que sinais são invalidados
  - 📊 Visibilidade completa do processo de revalidação
  - 🛠️ Base para ajustes futuros na lógica de validação
  - 📈 Melhor compreensão do comportamento do mercado

## [1.5.8] - 2024-12-31

### 🔧 Melhorias de Debug para MFI
- **Problema:** MFI retornando apenas 8 valores válidos em vez de 22
- **Causa:** Possível problema na conversão de dados ou filtros muito restritivos
- **Solução:** Adicionados logs detalhados para identificar o problema

- **Logs Adicionados:**
  - **Indicators.js**: 
    - ✅ Logs detalhados do histórico MFI original vs filtrado
    - ✅ Logs de dados inválidos nos candles
    - ✅ Logs de fluxo negativo zero
    - ✅ Logs de conversão de símbolos para Binance
    - ✅ Logs de candles obtidos e convertidos

- **Debug Points:**
  ```javascript
  // Logs para identificar onde os dados se perdem
  console.log(`🔍 [MACRO] ${symbol}: Histórico MFI original: ${mfiResult.history.length} valores`);
  console.log(`🔍 [MACRO] ${symbol}: Histórico MFI filtrado: ${mfiValues.length} valores válidos`);
  console.log(`🔍 [BINANCE] ${binanceSymbol}: ${candles.length} candles convertidos`);
  ```

- **Benefícios:**
  - 🔍 Identificação precisa de onde os dados se perdem
  - 📊 Debug de conversão de símbolos para Binance
  - 🛠️ Melhor diagnóstico de problemas de dados
  - 📈 Preparação para correção do problema do MFI

## [1.5.7] - 2024-12-31

### 🔧 Correção de Tipos de Dados e Valores Negativos
- **Problema:** `maxNegativePnlStopPct` estava sendo salvo como positivo (10) mas código esperava negativo (-10)
- **Causa:** Inconsistência entre frontend (positivo) e backend (negativo)
- **Solução:** Migração para strings no frontend com conversão automática para negativo

- **Arquivos Corrigidos:**
  - **persistence/bot_configs.json**: Corrigido `maxNegativePnlStopPct` de 10 para -10
  - **ConfigForm.tsx**: 
    - ✅ Interface atualizada para `string | number`
    - ✅ Inputs agora usam strings
    - ✅ Conversão automática para negativo no `handleSave`
    - ✅ Validações atualizadas para trabalhar com strings
  - **DashboardPage.tsx**: 
    - ✅ Interface atualizada para `string | number`
    - ✅ Valores padrão como strings
  - **BotCard.tsx**: 
    - ✅ Interface atualizada para `string | number`

- **Lógica de Conversão:**
  ```javascript
  // Frontend: usuário digita "10"
  // Backend: converte para -10 automaticamente
  maxNegativePnlStopPct: -Math.abs(parseFloat("10")) // = -10
  ```

- **Benefícios:**
  - 🎯 Compatibilidade correta entre frontend e backend
  - 🛡️ Stop loss funcionando corretamente (valores negativos)
  - 📊 Interface mais intuitiva (usuário digita positivo)
  - 🔄 Conversão automática transparente

## [1.5.6] - 2024-12-31

### 🔧 Correção de IDs Aleatórios
- **Problema:** Bot estava usando IDs aleatórios em vez do sistema de IDs únicos
- **Causa:** Fallback para IDs aleatórios quando não conseguia obter configuração do bot
- **Solução:** Migração para usar `generateUniqueOrderId()` em todas as ordens

- **Arquivos Corrigidos:**
  - **OrderController.js**: 
    - ✅ `executeMarketFallback`: Agora usa `generateUniqueOrderId(botName, config)`
    - ✅ `createLimitOrderWithTriggers`: Agora usa `generateUniqueOrderId(botName, config)`
    - ✅ Removido fallback para IDs aleatórios

- **Benefícios:**
  - 🎯 Rastreamento correto de ordens por bot
  - 📊 Monitoramento preciso de ordens
  - 🛡️ Cancelamento correto de ordens órfãs
  - 🔍 Logs mais informativos com IDs únicos

- **Impacto:**
  - ✅ Resolve erro "Order would immediately match and take"
  - ✅ Melhora compatibilidade com API da Backpack
  - ✅ Evita conflitos de IDs entre bots

## [1.5.5] - 2024-12-31

### 🔧 Adição de Configuração de Slippage
- **Nova Configuração: `maxSlippagePct`**
  - **Problema:** O bot estava usando valor padrão de 0.2% para slippage máximo, mas não estava configurável
  - **Causa:** Falta de configuração personalizável para slippage máximo permitido
  - **Solução:** Adicionada configuração `maxSlippagePct` ao bot com valor padrão de 0.5%

- **Arquivos Atualizados:**
  - **ConfigManager.js**: Adicionado `maxSlippagePct: 0.5` às configurações padrão
  - **persistence/bot_configs.json**: Atualizado bot existente com nova configuração
  - **ConfigForm.tsx**: Adicionado campo de input para "Slippage Máximo (%)" com tooltip explicativo
  - **DashboardPage.tsx**: Atualizada interface e configurações padrão
  - **BotCard.tsx**: Atualizada interface para incluir nova configuração

- **Funcionalidades:**
  - ✅ Configuração personalizável de slippage máximo (0.5% padrão)
  - ✅ Validação no frontend (deve ser >= 0)
  - ✅ Tooltip explicativo sobre o uso da configuração
  - ✅ Compatibilidade com bots existentes

- **Benefícios:**
  - 🎯 Controle preciso sobre slippage máximo permitido
  - 🛡️ Proteção contra execução em preços desfavoráveis
  - ⚙️ Configuração flexível por bot
  - 📊 Melhor controle de qualidade de execução

## [1.5.4] - 2024-12-31

### 🔧 Correções de ID de Ordem
- **Uso Correto de `order.id`**
  - **Problema:** Código estava usando `order.orderId` em vez de `order.id` em várias partes
  - **Causa:** Inconsistência na API da Backpack Exchange (usa `id` como campo principal)
  - **Solução:** Migração completa para usar `order.id` em todas as referências

- **Arquivos Corrigidos:**
  - **OrderController.js**: Todas as referências a `order.orderId` corrigidas para `order.id`
  - **Logs de Debug**: Agora mostram o ID correto da ordem
  - **Cancelamento de Ordens**: Usa o ID correto para cancelar ordens
  - **Monitoramento**: Verifica ordens usando o ID correto

- **Benefícios:**
  - ✅ Compatibilidade correta com a API da Backpack
  - ✅ Logs mais precisos e informativos
  - ✅ Cancelamento de ordens funcionando corretamente
  - ✅ Monitoramento de ordens mais confiável

## [1.5.3] - 2024-12-31

### ✨ Nova Funcionalidade
- **Modo de Execução Configurável**
  - **Problema:** O modo de execução (REALTIME/ON_CANDLE_CLOSE) não era configurável no frontend
  - **Solução:** Adicionado campo "Modo de Execução" no formulário de criação/edição de bots
  - **Opções Disponíveis:**
    - **REALTIME:** Bot analisa a cada 60 segundos (ideal para estratégias que precisam de resposta rápida)
    - **ON_CANDLE_CLOSE:** Bot analisa apenas no fechamento de cada vela (ideal para estratégias que precisam de confirmação completa)

- **Arquivos Atualizados:**
  - **ConfigForm.tsx**: Campo de seleção com tooltip explicativo
  - **DashboardPage.tsx**: Interface atualizada com executionMode
  - **BotCard.tsx**: Exibição do modo de execução no card do bot
  - **ConfigManager.js**: Configuração padrão com executionMode
  - **persistence/bot_configs.json**: Bot existente atualizado com executionMode

- **Benefícios:**
  - ✅ Configuração flexível por bot
  - ✅ Interface intuitiva com explicações
  - ✅ Compatibilidade com estratégias existentes
  - ✅ ALPHA_FLOW usa ON_CANDLE_CLOSE automaticamente

## [1.5.2] - 2024-12-31

### 🔧 Correções de Configuração
- **Migração de Variáveis de Ambiente para Configurações do Bot**
  - **Problema:** Estratégias estavam usando `process.env.MAX_NEGATIVE_PNL_STOP_PCT` e `process.env.MIN_PROFIT_PERCENTAGE`
  - **Causa:** Configurações não estavam sendo passadas corretamente do frontend para as estratégias
  - **Solução:** Migração completa para usar configurações do bot (`config.maxNegativePnlStopPct`, `config.minProfitPercentage`)

- **Arquivos Corrigidos:**
  - **DefaultStrategy.js**: Agora usa `config.maxNegativePnlStopPct` e `config.minProfitPercentage`
  - **DefaultStopLoss.js**: Recebe configurações do bot no construtor
  - **StopLossFactory.js**: Passa configurações do bot para instâncias de stop loss
  - **TrailingStop.js**: Passa configurações do bot para o StopLossFactory
  - **AlphaFlowStrategy.js**: Usa configurações do bot para multiplicadores ATR e capital

- **Benefícios:**
  - ✅ Configurações personalizadas por bot
  - ✅ Interface do frontend funcional
  - ✅ Valores padrão consistentes
  - ✅ Fallback para variáveis de ambiente (compatibilidade)

## [1.5.1] - 2024-12-31

### 🐛 Correções Críticas
- **Correção Crítica na Detecção de Stop Loss**
  - **Problema:** Sistema detectava incorretamente ordens `reduceOnly` como stop loss
  - **Causa:** Lógica considerava qualquer ordem `reduceOnly` com lado correto como stop loss
  - **Exemplo do problema:** Take profit em $95 para posição SHORT em $100 era detectado como stop loss
  - **Solução:** Implementação de validação de posicionamento baseada no preço de entrada

- **Nova Lógica de Validação de Stop Loss**
  - **Para Posições LONG:** Stop loss deve estar **ABAIXO** do preço de entrada
  - **Para Posições SHORT:** Stop loss deve estar **ACIMA** do preço de entrada
  - **Validação de Triggers:** Ordens com `stopLossTriggerPrice` ou `stopLossLimitPrice` são sempre stop loss
  - **Validação de Posicionamento:** Ordens sem trigger são validadas pela posição relativa ao preço de entrada

- **Função Auxiliar Implementada**
  - `isOrderCorrectlyPositionedAsStopLoss(order, position)`: Valida posicionamento correto
  - Suporte a diferentes formatos de preço de entrada (`entryPrice` ou `avgEntryPrice`)
  - Tratamento robusto de casos edge (ordens sem `limitPrice`)

- **Correção em Funções Principais**
  - **`hasExistingStopLoss()`:** Implementada nova lógica de validação
  - **`monitorAndCleanupOrphanedStopLoss()`:** Corrigida detecção de ordens órfãs
  - **Logs Detalhados:** Adicionados logs para debug com informações de posicionamento

- **Testes Unitários**
  - **5 novos testes** para validar a lógica corrigida
  - Cobertura completa de cenários: LONG, SHORT, triggers, casos edge
  - Validação de diferentes formatos de preço de entrada
  - Todos os testes passando ✅

### 🔧 Melhorado
- **Sistema de Logs Detalhados**
  - Logs informativos para debug de detecção de stop loss
  - Informações de posicionamento relativo ao preço de entrada
  - Identificação clara de tipo de posição (LONG/SHORT)

### 🛡️ Segurança
- **Prevenção de Stop Loss Duplicados:** Evita criação desnecessária de stop loss
- **Detecção Correta de Take Profit:** Não confunde mais take profit com stop loss
- **Validação Robusta:** Tratamento de todos os casos edge e formatos de dados

### 📚 Documentação
- **tasks.md:** Documentação completa do problema e solução
- **Testes:** Cobertura completa da nova lógica
- **Comentários:** Documentação inline da nova lógica de validação

---

## [1.5.0] - 2024-12-31

### 🎯 Adicionado
- **Sistema Completo de Testes de Integração e Regressão**
  - **125 testes passando** de 125 total
  - **8 test suites** cobrindo todos os cenários críticos
  - **0 falhas** - sistema 100% funcional
  - Cobertura excelente nos módulos principais (>80%)

- **Nova Suíte de Testes: AlphaFlowStrategy - Modo de Alvos Fixos**
  - Validação de 3 ordens escalonadas quando `ENABLE_TRAILING_STOP=false`
  - Cálculo correto dos pesos da pirâmide invertida (50/30/20)
  - Preços de entrada escalonados baseados no ATR
  - SL e TP individuais para cada ordem (90%/150% do preço de entrada)
  - Dimensionamento de capital baseado na convicção (GOLD/SILVER/BRONZE)
  - Comportamento com `ENABLE_CONFLUENCE_SIZING=false`

- **Testes de Lógica Condicional de Ordens**
  - Teste para `ENABLE_TRAILING_STOP=true` (ordem única)
  - Teste para `ENABLE_TRAILING_STOP=false` (3 ordens escalonadas)
  - Teste para `ENABLE_TRAILING_STOP=undefined` (modo escalonado)

- **Testes de Dimensionamento de Posição Dinâmico**
  - Teste para GOLD (100% do capital)
  - Teste para SILVER (66% do capital)
  - Teste para BRONZE (33% do capital)
  - Teste para `ENABLE_CONFLUENCE_SIZING=false`

- **Testes de Validação de Dados de Mercado**
  - Formatação de quantidade e preço baseada em `decimal_quantity` e `decimal_price`
  - Validação de quantidade mínima
  - Validação de valor mínimo da ordem

### 🔧 Melhorado
- **Sistema de Testes Robusto**
  - Tratamento de erros validado e testado
  - Isolamento de dependências externas
  - Mocks eficientes para APIs externas
  - Testes determinísticos e rápidos

- **Cobertura de Código Excelente**
  - **AlphaFlowStrategy.js**: 91.66% de cobertura
  - **Indicators.js**: 81.7% de cobertura
  - **BaseStopLoss.js**: 85% de cobertura
  - **BaseStrategy.js**: 89.13% de cobertura
  - **DefaultStopLoss.js**: 97.5% de cobertura

### 📚 Documentação
- **README.md**: Adicionada seção completa de testes e qualidade
- **Guia de Execução de Testes**: Instruções detalhadas para execução
- **Métricas de Cobertura**: Documentação da cobertura por módulo
- **Suítes de Teste**: Descrição detalhada de cada suíte implementada

### 🛡️ Segurança e Qualidade
- **Prevenção de Regressões**: Mudanças futuras são validadas automaticamente
- **Confiança no Código**: 125 testes garantem robustez do sistema
- **Facilidade de Manutenção**: Refatorações podem ser feitas com segurança
- **Documentação Viva**: Testes servem como documentação da lógica de negócio

### ⚙️ Configurações de Teste
- **Jest**: Framework de testes principal
- **Cobertura Automática**: Relatórios de cobertura integrados
- **Mocks Inteligentes**: Isolamento de dependências externas
- **Testes de Performance**: Validação de timeouts e performance

---

## [1.4.0] - 2024-12-31

### 🎯 Adicionado
- **Estratégia Híbrida de Stop Loss Adaptativo**
  - Dupla camada de segurança: failsafe + monitoramento tático
  - Stop loss baseado em ATR (Average True Range) para adaptação à volatilidade
  - Take profit parcial com ordens LIMIT na corretora
  - Monitoramento e recriação automática de ordens perdidas
  - Atualização de stop loss para breakeven quando TP parcial é executado

- **Sistema de Proteção Inteligente**
  - Failsafe sempre ativo na corretora (STOP_MARKET)
  - Monitoramento tático paralelo baseado em ATR
  - Decisão inteligente: sempre escolhe o stop mais seguro
  - Cancelamento e criação automática de ordens de stop loss

- **Gestão Dinâmica de Risco**
  - Fase 1: Risco inicial com stop ATR + failsafe
  - Fase 2: Monitoramento de take profit parcial
  - Fase 3: Trailing stop após execução do TP parcial
  - Transição automática entre fases baseada em eventos

### 🔧 Melhorado
- **OrderController.js**
  - Implementação de `createPartialTakeProfitOrder()` para ordens LIMIT
  - Implementação de `hasPartialTakeProfitOrder()` para monitoramento
  - Melhoria no `validateAndCreateStopLoss()` com dupla camada
  - Logs detalhados de cálculos e decisões de stop loss

- **TrailingStop.js**
  - Refatoração completa para estratégia híbrida
  - Implementação de `updateTrailingStopHybrid()` com fases
  - Detecção automática de execução de take profit parcial
  - Atualização de stop loss para breakeven com ordens na corretora

- **Indicators.js**
  - Integração completa do cálculo ATR
  - Método `getAtrValue()` para busca de dados históricos
  - Cálculo dinâmico de stop loss baseado em volatilidade

### 🐛 Correções
- **Sincronização Bot-Corretora**
  - Correção de problema onde stop loss interno não sincronizava com corretora
  - Implementação de cancelamento e criação de novas ordens
  - Garantia de que ordens na corretora sempre refletem estado interno

- **Detecção de Take Profit Parcial**
  - Correção de lógica para detectar execução de ordens LIMIT
  - Implementação de verificação por redução de posição
  - Tolerância de 1% para variações de quantidade

- **Cálculo de Stop Loss com ATR**
  - Correção para considerar alavancagem no cálculo ATR
  - Implementação de multiplicadores configuráveis
  - Cálculo correto para posições LONG e SHORT

### ⚙️ Configurações
- `ENABLE_HYBRID_STOP_STRATEGY`: Ativa estratégia híbrida (true/false)
- `INITIAL_STOP_ATR_MULTIPLIER`: Multiplicador ATR para stop inicial (padrão: 2.0)
- `TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER`: Multiplicador ATR para TP parcial (padrão: 1.5)
- `PARTIAL_PROFIT_PERCENTAGE`: Porcentagem da posição para TP parcial (padrão: 50%)

### 🎯 Funcionalidades
- **Stop Loss Adaptativo**: Ajuste automático baseado na volatilidade do mercado
- **Take Profit Parcial**: Execução automática pela corretora
- **Breakeven Management**: Proteção de lucros após TP parcial
- **Monitoramento Inteligente**: Verificação contínua de ordens
- **Logs User-Friendly**: Mensagens claras em português

### 📚 Documentação
- **context.md**: Overview completo do projeto BackBot
- **tasks-stop-loss-adaptativo.md**: Especificações detalhadas da implementação
- **tasks.md**: Tasks gerais do projeto
- **jest.setup.js**: Configuração de testes para nova funcionalidade

### 🛡️ Segurança
- **Dupla Proteção**: Failsafe + monitoramento tático
- **Execução na Corretora**: Ordens sempre enviadas para proteção
- **Limpeza Automática**: Sistema de limpeza de ordens órfãs
- **Tratamento de Erros**: Robustez em todas as operações

## [1.3.0] - 2024-12-31

### 🎯 Adicionado
- **Sistema de Trailing Stop Avançado**
  - Implementação completa de trailing stop dinâmico
  - Ativação automática quando posição fica lucrativa
  - Ajuste contínuo do stop loss baseado no preço mais favorável
  - Configuração via `TRAILING_STOP_DISTANCE` (padrão: 1.5%)
  - Suporte para posições LONG e SHORT com lógica específica

- **Monitor de Ordens Órfãs**
  - Sistema automático de limpeza de ordens condicionais órfãs
  - Verificação periódica a cada 60 segundos
  - Identificação inteligente de ordens sem posições correspondentes
  - Cancelamento automático de stop loss órfãos
  - Logs detalhados de todas as operações de limpeza

- **Sistema de Auditoria para Backtest**
  - Modo de auditoria ativado via `BACKTEST_AUDIT_MODE=true`
  - 8 camadas de validação para diagnóstico completo
  - Análise detalhada de cada etapa do processo de decisão
  - Identificação de pontos de falha em backtests
  - Compatibilidade com modo normal (alta performance)

### 🔧 Melhorado
- **Sistema de Logs Condicional**
  - Logs verbosos controlados por `LOG_TYPE=debug`
  - Redução de poluição visual em modo normal
  - Logs essenciais sempre visíveis (ações importantes)
  - Sistema consistente entre TrailingStop e OrderController

- **Sistema de Cores para Logs**
  - Implementação de ColorLogger para Trailing Stop
  - Cores diferenciadas para identificação visual rápida:
    - 🟣 Fúcsia: Aguardando posição ficar lucrativa
    - 🟠 Laranja: Aguardando ativação
    - 🟢 Verde: Trailing ativo e em lucro
    - 🟢 Brilhante: Verificando gatilho
    - 🔴 Vermelho: Trailing em hold/proteção
    - 🔴 Brilhante: Gatilho ativado
    - 🔵 Azul: Trailing atualizado
    - 🟡 Amarelo: Trailing ativando
    - ⚪ Cinza: Cleanup
    - 🔵 Ciano: Configuração

- **Cálculo de Stop Loss**
  - Correção para considerar alavancagem no cálculo
  - Uso de `validateLeverageForSymbol()` para alavancagem correta
  - Cálculo `actualStopLossPct = baseStopLossPct / leverage`
  - Resolução de problema onde stop loss era criado na distância bruta

- **Sistema de Cache Inteligente**
  - Cache para logs de ajuste de alavancagem
  - Evita logs repetitivos por símbolo
  - Limpeza automática quando posição é fechada
  - Cache de verificação de stop loss com timeout

### 🐛 Correções
- **Correção Crítica no Cálculo de PnL para Posições SHORT**
  - Problema: Bot usava apenas `pnlUnrealized` da API, ignorando `pnlRealized`
  - Solução: Usar `pnlRealized + pnlUnrealized` para PnL total correto
  - Impacto: Trailing stop agora detecta corretamente lucro em posições SHORT
  - Exemplo: BTC SHORT com pnlRealized=2.12 e pnlUnrealized=-1.13 agora mostra lucro total de 0.99
  - Resolução: Posições SHORT com lucro parcial realizado agora ativam trailing stop corretamente

- **Correção Crítica no Trailing Stop**
  - Refatoração do método `stopLoss()` para garantir execução
  - Uso de `trailingState` diretamente em vez de `trailingInfo`
  - Garantia de chamada de `OrderController.forceClose()` quando decisão é positiva
  - Resolução de falha na 'última milha' que impedia fechamento

- **Correção de Cálculo de PnL**
  - Validação de alavancagem nos métodos `calculatePnL`
  - Correção para tokens como ENA_USDC_PERP (10x ao invés de 15x)
  - Cálculo correto de PnL: -7.13% ao invés de -10.13%
  - Evita fechamento prematuro por stop loss incorreto

- **Correção de Importações**
  - Adição de importações corretas no BaseStrategy.js
  - Conversão de `calculateStopAndTarget()` para assíncrono
  - Atualização de chamadas em DefaultStrategy.js para usar `await`
  - Resolução de erro de sintaxe 'Unexpected reserved word'

- **Correção de Método de Cancelamento**
  - Alteração de `cancelOrder` para `cancelOpenOrder`
  - Uso correto de `order.id` em vez de `order.orderId`
  - Melhoria na identificação de ordens órfãs

### ⚙️ Configurações
- `TRAILING_STOP_DISTANCE`: Distância do trailing stop (padrão: 1.5%)
- `BACKTEST_AUDIT_MODE`: Ativa modo de auditoria para diagnóstico
- `LOG_TYPE`: Controla verbosidade dos logs (debug/normal)
- `TRAILING_STOP_ENABLED`: Habilita/desabilita trailing stop

### 🎯 Funcionalidades
- **Trailing Stop Inteligente**:
  - Ativação automática quando posição fica lucrativa
  - Ajuste contínuo baseado no preço mais favorável
  - Proteção contra reversões de tendência
  - Suporte completo para LONG e SHORT

- **Monitor de Segurança**:
  - Limpeza automática de ordens órfãs
  - Prevenção de execuções acidentais
  - Monitoramento contínuo 24/7
  - Logs detalhados de todas as operações

- **Sistema de Diagnóstico**:
  - Auditoria completa de backtests
  - Identificação de pontos de falha
  - Análise detalhada de cada etapa
  - Compatibilidade com modo de alta performance

### 📚 Documentação
- **README Atualizado**: Documentação do sistema de trailing stop
- **Configurações de Trailing Stop**: Explicação detalhada dos parâmetros
- **Sistema de Logs**: Guia para uso do sistema de logs condicional
- **Monitor de Ordens Órfãs**: Documentação da funcionalidade de limpeza

---

## [1.2.1] - 2024-12-19

### 🐛 Correções
- **TrailingStop Error**: Corrigido erro `this.cancelPendingOrders is not a function`
  - Solução: Alterado `cancelPendingOrders` de método de instância para método estático
  - Permite chamada correta a partir do método estático `forceClose` no OrderController

## [1.2.0] - 2024-12-19

### 🎯 Adicionado
- **Sistema de Modos de Simulação do Backtest**
  - Modo `HIGH_FIDELITY`: Simulação intra-vela para timeframes baixos (≤ 30m)
  - Modo `STANDARD`: Simulação em velas fechadas para timeframes altos (≥ 1h)
  - Modo `AUTO`: Seleção automática baseada no timeframe (padrão)
  - Configuração via variável de ambiente `BACKTEST_SIMULATION_MODE`

### 🔧 Melhorado
- **BacktestEngine.js**
  - Refatoração completa para suportar dois modos de simulação
  - Implementação de simulação intra-vela com dados de 1m
  - Construção dinâmica de velas AMBIENT baseada em dados de 1m
  - Métodos para agrupar candles de 1m em timeframes AMBIENT
  - Seleção automática de modo baseado no timeframe

- **DataProvider.js**
  - Suporte a busca de dados de 1m para modo High-Fidelity
  - Agrupamento automático de dados de 1m para timeframes AMBIENT
  - Determinação automática do timeframe de dados baseado no modo
  - Métodos para conversão de timeframes e agrupamento de candles

- **BacktestRunner.js**
  - Integração com sistema de modos de simulação
  - Determinação automática de timeframes AMBIENT e ACTION
  - Validação de configurações de simulação
  - Exibição de informações detalhadas sobre modo de simulação

- **backtest.js**
  - Interface atualizada para mostrar informações de simulação
  - Seleção automática de modo baseado no timeframe escolhido
  - Opção para alterar modo de simulação manualmente
  - Exibição de descrições detalhadas de cada modo

### 📚 Documentação
- **SIMULATION_MODES.md**: Documentação completa do sistema de modos de simulação
- **env.example**: Adicionada configuração `BACKTEST_SIMULATION_MODE`
- Atualização de documentação existente para refletir novos recursos

### ⚙️ Configuração
- Nova variável de ambiente `BACKTEST_SIMULATION_MODE` com valores:
  - `AUTO`: Seleção automática (recomendado)
  - `HIGH_FIDELITY`: Força simulação intra-vela
  - `STANDARD`: Força simulação em velas fechadas

### 🎯 Funcionalidades
- **Seleção Automática Inteligente**:
  - Timeframes ≤ 30m → HIGH_FIDELITY
  - Timeframes ≥ 1h → STANDARD
- **Simulação Intra-Vela**: Análise contínua a cada minuto para timeframes baixos
- **Performance Otimizada**: Modo rápido para timeframes altos
- **Compatibilidade**: Mantém compatibilidade com configurações existentes

## [1.1.0] - 2024-12-18

### 🎯 Adicionado
- **Sistema de Modos de Execução do Bot**
  - Modo `ON_CANDLE_CLOSE`: Análise sincronizada ao fechamento de velas
  - Modo `REALTIME`: Análise a cada 60 segundos (modo anterior)
  - Configuração via variável de ambiente `EXECUTION_MODE`

### 🔧 Melhorado
- **app.js**
  - Refatoração do loop principal de execução
  - Implementação de dois modos de operação distintos
  - Função `getTimeUntilNextCandleClose()` para cálculo de tempo até próximo fechamento
  - Função `parseTimeframeToMs()` para conversão de timeframes
  - Barra de progresso dinâmica baseada no tempo de espera
  - Logs informativos para cada modo de execução

- **src/Decision/Decision.js**
  - Função `showLoadingProgress()` adaptada para receber duração dinâmica
  - Cálculo automático do horário de término da espera
  - Suporte a diferentes durações de espera por modo

### 📚 Documentação
- **EXECUTION_MODES.md**: Documentação completa dos modos de execução
- **ENV_EXAMPLE.md**: Exemplo de configuração para `.env.example`
- **CORRECOES_IMPLEMENTADAS.md**: Documentação de problemas identificados e soluções

### ⚙️ Configuração
- Nova variável de ambiente `EXECUTION_MODE` com valores:
  - `ON_CANDLE_CLOSE`: Modo recomendado para máxima fidelidade
  - `REALTIME`: Modo de alta frequência (com avisos)

### 🛠️ Correções
- **TypeError**: Corrigido erro `OrderController.monitorPendingOrders is not a function`
  - Solução: Alterado para `OrderController.monitorPendingEntryOrders('DEFAULT')`
- **AccountConfig Warning**: Identificado e documentado para monitoramento futuro

### 🎯 Funcionalidades
- **Sincronização com Velas**: Análise no exato momento do fechamento
- **Fidelidade com Backtests**: Garantia de 100% de fidelidade
- **Flexibilidade**: Escolha entre precisão e frequência
- **Interface Melhorada**: Logs claros e barra de progresso informativa

## [1.0.0] - 2024-12-17

### 🎯 Adicionado
- **Sistema de Backtesting Completo**
  - Motor de simulação com suporte a múltiplas estratégias
  - Provedor de dados históricos (Backpack + Binance)
  - Interface CLI interativa para configuração
  - Relatórios detalhados de performance

### 🔧 Melhorado
- **Estratégias de Trading**
  - DEFAULT: Farm de volume com stop loss básico
  - PRO_MAX: Estratégia avançada com múltiplos targets
  

### 📚 Documentação
- **README.md**: Documentação principal do projeto
- **CHANGELOG.md**: Histórico de mudanças
- **env.example**: Exemplo de configuração

### ⚙️ Configuração
- Sistema de variáveis de ambiente para configuração
- Suporte a múltiplas contas de trading
- Configurações de risco e performance

### 🎯 Funcionalidades
- **Backtesting**: Simulação de estratégias com dados históricos
- **Análise de Performance**: Métricas detalhadas (win rate, profit factor, etc.)
- **Comparação de Estratégias**: Teste múltiplas estratégias simultaneamente
- **Geração de Relatórios**: Salvamento de resultados em JSON

---

## 📝 Notas de Versão

### Versão 1.2.0
Esta versão introduz um sistema revolucionário de modos de simulação que resolve o problema fundamental de precisão vs. performance em backtests. Agora o sistema automaticamente escolhe o modo mais apropriado baseado no timeframe, garantindo máxima fidelidade para scalping e máxima eficiência para swing trading.

### Versão 1.1.0
Esta versão resolve o problema de divergência entre backtests e bot real através da implementação de modos de execução flexíveis. O modo `ON_CANDLE_CLOSE` garante 100% de fidelidade com os backtests, enquanto o modo `REALTIME` mantém a funcionalidade anterior para casos específicos.

### Versão 1.5.0
Esta versão representa um marco na qualidade do código com a implementação de um sistema completo de testes de integração e regressão. Com 125 testes passando e cobertura excelente nos módulos principais, o sistema agora oferece máxima confiança para desenvolvimento e manutenção. A nova suíte de testes para o modo de alvos fixos da Alpha Flow Strategy garante que todas as funcionalidades críticas sejam validadas automaticamente.

### Versão 1.0.0
Versão inicial do sistema de backtesting, fornecendo uma base sólida para teste e otimização de estratégias de trading algorítmico. 
