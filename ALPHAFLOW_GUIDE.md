# 🧠 Guia AlphaFlow Strategy

## Como Iniciar a Estratégia AlphaFlow

### 🚀 Método 1: Via Menu Interativo

1. **Execute o bot:**
   ```bash
   npm start
   ```

2. **Selecione a opção 2** no menu:
   ```
   2️⃣  Estratégia ALPHA FLOW [NOVA]
   ```

### 🚀 Método 2: Via Variável de Ambiente

1. **Configure a variável de ambiente:**
   ```bash
   export TRADING_STRATEGY=ALPHA_FLOW
   ```

2. **Execute o bot:**
   ```bash
   npm start
   ```

### ⚙️ Variáveis de Ambiente Necessárias

Adicione estas variáveis ao seu arquivo `.env`:

```env
# Estratégia
TRADING_STRATEGY=ALPHA_FLOW

# Configurações de Capital por Nível de Convicção
CAPITAL_PERCENTAGE_BRONZE=50    # 50% do capital para sinais BRONZE
CAPITAL_PERCENTAGE_SILVER=75    # 75% do capital para sinais PRATA  
CAPITAL_PERCENTAGE_GOLD=100     # 100% do capital para sinais OURO

# Configurações de Peso das Ordens (Pirâmide Invertida)
ORDER_1_WEIGHT_PCT=50           # 50% na primeira ordem
ORDER_2_WEIGHT_PCT=30           # 30% na segunda ordem
ORDER_3_WEIGHT_PCT=20           # 20% na terceira ordem

# Configurações de Stop Loss e Take Profit
MAX_NEGATIVE_PNL_STOP_PCT=4.0   # Stop loss em 4%
MIN_TAKE_PROFIT_PCT=0.5         # Take profit mínimo em 0.5%
TP_PARTIAL_PERCENTAGE=50        # 50% da posição no TP parcial

# Configurações de Validação
ENABLE_TP_VALIDATION=true       # Ativa validação de take profit
ENABLE_TRAILING_STOP=false      # Desativa trailing stop (usa TP fixo)
```

### 🎯 Como Funciona a AlphaFlow

#### **Análise de Sinais:**
- **BRONZE**: Momentum + Money Flow alinhados
- **PRATA**: BRONZE + Macro Bias confirmado
- **OURO**: PRATA + Divergência CVD detectada

#### **Execução de Ordens:**
- **3 ordens escalonadas** com spreads baseados no ATR
- **Pirâmide invertida**: 50% → 30% → 20%
- **Stop Loss**: 4% do preço de entrada
- **Take Profit**: 50% do preço de entrada

#### **Gestão de Risco:**
- **Capital escalonado** por nível de convicção
- **Stop loss fixo** para proteção
- **Take profit parcial** para garantir lucros

### 📊 Exemplo de Execução

```
🧠 [ALPHA_FLOW] Analisando BTC_USDC_PERP...
✅ Sinal OURO detectado!
   • Momentum: Bullish ✅
   • Money Flow: Bullish ✅  
   • Macro Bias: Bullish ✅
   • CVD Divergence: Bullish ✅

📋 Calculando ordens escalonadas...
   • Ordem 1: 50% do capital @ $49,500
   • Ordem 2: 30% do capital @ $48,000  
   • Ordem 3: 20% do capital @ $45,500

🎯 Stop Loss: $47,520 (-4%)
🎯 Take Profit: $74,250 (+50%)
```

### 🔧 Configurações Avançadas

#### **Ajuste de Sensibilidade:**
```env
# Para sinais mais frequentes (menos rigoroso)
CAPITAL_PERCENTAGE_BRONZE=30
CAPITAL_PERCENTAGE_SILVER=60
CAPITAL_PERCENTAGE_GOLD=90

# Para sinais mais seletivos (mais rigoroso)  
CAPITAL_PERCENTAGE_BRONZE=70
CAPITAL_PERCENTAGE_SILVER=85
CAPITAL_PERCENTAGE_GOLD=100
```

#### **Ajuste de Risco:**
```env
# Mais conservador
MAX_NEGATIVE_PNL_STOP_PCT=2.0
MIN_TAKE_PROFIT_PCT=1.0

# Mais agressivo
MAX_NEGATIVE_PNL_STOP_PCT=6.0
MIN_TAKE_PROFIT_PCT=0.3
```

### 🚨 Importante

- **Teste primeiro** em modo simulação
- **Monitore** as primeiras execuções
- **Ajuste** os parâmetros conforme necessário
- **Mantenha** logs ativos para análise

### 📈 Vantagens da AlphaFlow

✅ **Análise técnica avançada** com múltiplos indicadores
✅ **Gestão de risco escalonada** por convicção
✅ **Execução inteligente** com ordens distribuídas
✅ **Proteção automática** com stop loss e take profit
✅ **Flexibilidade** para ajustes de parâmetros 