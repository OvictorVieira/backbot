# BackBot - Bot de Trading Automatizado

## 🎯 Visão Geral

O BackBot é um bot de trading automatizado para a corretora Backpack, focado em futuros perpétuos com foco em **farming de volume** para airdrops.

## ⚙️ Modos de Execução

O bot suporta dois modos de execução configuráveis:

### 🔄 Modo REALTIME (Padrão)
- **Análise:** A cada 60 segundos
- **Configuração:** `EXECUTION_MODE=REALTIME` ou omitir
- **Ideal para:** Estratégias que precisam de alta frequência

### ⏰ Modo ON_CANDLE_CLOSE
- **Análise:** Apenas no fechamento das velas
- **Configuração:** `EXECUTION_MODE=ON_CANDLE_CLOSE`
- **Ideal para:** Máxima fidelidade com indicadores técnicos

### 🧠 Alpha Flow Strategy
- **Comportamento:** **SEMPRE** usa `ON_CANDLE_CLOSE` (forçado automaticamente)
- **Motivo:** Estratégia baseada em indicadores que precisam de dados de vela completa

## 📋 Configuração

### Variáveis de Ambiente Principais

```bash
# Modo de Execução
EXECUTION_MODE=ON_CANDLE_CLOSE  # ON_CANDLE_CLOSE ou REALTIME

# Estratégia
TRADING_STRATEGY=ALPHA_FLOW     # ALPHA_FLOW, DEFAULT, PRO_MAX

# Timeframe
TIME=5m                          # 5m, 15m, 30m, 1h, 4h, 1d

# Credenciais
ACCOUNT1_API_KEY=sua_api_key
ACCOUNT1_API_SECRET=sua_api_secret
```

### Exemplos de Configuração

#### Alpha Flow (Recomendado)
```bash
TRADING_STRATEGY=ALPHA_FLOW
TIME=5m
# EXECUTION_MODE é forçado automaticamente para ON_CANDLE_CLOSE
```

#### Estratégia Padrão com ON_CANDLE_CLOSE
```bash
TRADING_STRATEGY=DEFAULT
EXECUTION_MODE=ON_CANDLE_CLOSE
TIME=15m
```

#### Estratégia Padrão com REALTIME
```bash
TRADING_STRATEGY=DEFAULT
EXECUTION_MODE=REALTIME
TIME=5m
```

## 🚀 Instalação e Uso

1. **Clone o repositório:**
   ```bash
   git clone <repository-url>
   cd backbot
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Configure o arquivo .env:**
   ```bash
   cp .env.example .env
   # Edite o arquivo .env com suas credenciais
   ```

4. **Execute os testes (recomendado):**
   ```bash
   npm test
   ```

5. **Execute o bot:**
   ```bash
   npm start
   ```

## 📊 Estratégias Disponíveis

### 🧠 Alpha Flow Strategy
- **Descrição:** Estratégia avançada com níveis de convicção (Bronze, Prata, Ouro)
- **Execução:** 3 ordens escalonadas com pesos diferentes
- **Modo:** Sempre `ON_CANDLE_CLOSE`
- **Ideal para:** Máxima precisão com indicadores técnicos

### 🔄 Default Strategy
- **Descrição:** Estratégia original com 8 camadas de validação
- **Execução:** Ordem única
- **Modo:** Configurável (`REALTIME` ou `ON_CANDLE_CLOSE`)

### ⚡ PRO MAX Strategy
- **Descrição:** Estratégia avançada com múltiplas validações
- **Execução:** Ordem única com filtros rigorosos
- **Modo:** Configurável (`REALTIME` ou `ON_CANDLE_CLOSE`)

## 🔧 Funcionalidades

- **Execução Híbrida:** LIMIT (post-only) com fallback para MARKET
- **Stop Loss Adaptativo:** Baseado em ATR com 4 fases de gestão
- **Trailing Stop:** Monitoramento ativo de posições
- **Persistência de Estado:** Sobrevive a reinicializações
- **Monitor de Ordens:** Limpeza automática de ordens órfãs
- **Sistema de Testes Robusto:** 125 testes de integração e regressão
- **Cobertura de Código Excelente:** >80% nos módulos principais

## 📈 Logs e Monitoramento

O bot exibe logs detalhados incluindo:
- Modo de execução ativo
- Tempo até próximo fechamento de vela
- Status das ordens e posições
- Métricas de performance

## 🧪 Testes e Qualidade

### **Cobertura de Testes**
- **125 testes passando** de 125 total
- **8 test suites** cobrindo todos os cenários críticos
- **0 falhas** - sistema 100% funcional

### **Módulos com Excelente Cobertura**
- **AlphaFlowStrategy.js**: 91.66% de cobertura
- **Indicators.js**: 81.7% de cobertura
- **BaseStopLoss.js**: 85% de cobertura
- **BaseStrategy.js**: 89.13% de cobertura
- **DefaultStopLoss.js**: 97.5% de cobertura

### **Suítes de Teste Implementadas**
- **Testes de Integração**: Validação completa de fluxos de trading
- **Testes de Regressão**: Prevenção de breaking changes
- **Testes de Edge Cases**: Cenários extremos e de falha
- **Testes de Performance**: Validação de performance e timeouts
- **Testes de Validação de Dados**: Verificação de dados de mercado
- **Testes de Comportamento Condicional**: Lógica de configuração
- **Testes de Dimensionamento**: Cálculos de capital e posição
- **Testes de Modo de Alvos Fixos**: 3 ordens escalonadas

### **Execução de Testes**
```bash
# Executar todos os testes
npm test

# Executar testes específicos
npm test -- src/Decision/Strategies/AlphaFlowStrategy.integration.test.js

# Executar com cobertura
npm test -- --coverage
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.