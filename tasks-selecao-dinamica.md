# Plano de Implementação: Seleção Dinâmica de Multiplicadores ATR

Este documento detalha as tarefas para implementar um sistema que ajusta dinamicamente os multiplicadores de ATR com base na volatilidade do mercado. Cada tarefa é um prompt autocontido e inclui a criação de testes.

## Fase 1: Configuração e Lógica de Base

### Tarefa 1.1: Adicionar Novas Configurações Dinâmicas ao `.env`

- [ ] **Tarefa Principal:** Expandir o `.env` para suportar os novos multiplicadores para cada estado de mercado.
- [ ] **Testes:** Não aplicável (tarefa de configuração).

**Prompt para o Cursor:**

**Função:** Você é um especialista em configuração de sistemas de trading.

**Objetivo:** Adicionar as novas variáveis de ambiente necessárias para a "Seleção Dinâmica de Multiplicadores" ao arquivo `.env.example`.

**Tarefa Detalhada:**
Adicione o seguinte bloco de configurações ao arquivo `.env.example`, com comentários claros.

```ini
# --- CONFIGURAÇÕES DE SELEÇÃO DINÂMICA DE MULTIPLICADORES (ATR) ---
# Ativa a seleção automática de multiplicadores de ATR com base na volatilidade (true/false).
# Se false, usará os multiplicadores fixos definidos anteriormente.
ENABLE_DYNAMIC_MULTIPLIERS=true

# --- Limiares de Volatilidade (baseado no ATR Percentual) ---
# Abaixo deste valor, o mercado é considerado "Calmo".
VOLATILITY_LOW_THRESHOLD=0.5
# Acima deste valor, o mercado é considerado "Volátil".
VOLATILITY_HIGH_THRESHOLD=1.5

# --- Multiplicadores para Mercado CALMO ---
CALM_MARKET_INITIAL_STOP_ATR_MULTIPLIER=2.5
CALM_MARKET_TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER=2.0

# --- Multiplicadores para Mercado NORMAL ---
NORMAL_MARKET_INITIAL_STOP_ATR_MULTIPLIER=2.0
NORMAL_MARKET_TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER=1.5

# --- Multiplicadores para Mercado VOLÁTIL ---
VOLATILE_MARKET_INITIAL_STOP_ATR_MULTIPLIER=1.5
VOLATILE_MARKET_TAKE_PROFIT_PARTIAL_ATR_MULTIPLIER=1.0
```

**Formato da Resposta Esperada:** O bloco de texto formatado para ser adicionado ao arquivo `.env.example`.

---

### Tarefa 1.2: Implementar a Lógica de Seleção Dinâmica de Multiplicadores

- [ ] **Tarefa Principal:** Criar a função que classifica a volatilidade e seleciona os multiplicadores corretos.
- [ ] **Testes:** Criar testes unitários para validar a lógica de seleção.

**Prompt para o Cursor:**

**Função:** Você é um arquiteto de software sênior e especialista em TDD, encarregado de implementar lógicas de gestão de risco adaptativas.

**Objetivo:** Refatorar a classe de estratégia (ex: `AlphaFlowStrategy.js` ou `BaseStrategy.js`) para implementar a seleção dinâmica de multiplicadores de ATR.

**Contexto:**
* **Arquivo a ser Modificado:** A classe de estratégia que contém o método `calculateStopAndTarget` ou `calculateScaledOrders`.

**Tarefa de Implementação:**

1.  **Criar um Novo Método `getATRMultipliers(data)`:**
    * **Lógica:**
        a.  Verifique se `ENABLE_DYNAMIC_MULTIPLIERS` está `true`. Se não, retorne os multiplicadores fixos (`INITIAL_STOP_ATR_MULTIPLIER`, etc.).
        b.  Calcule o `atrPercentage = (data.atr.atr / data.marketPrice) * 100`.
        c.  Leia os limiares `VOLATILITY_LOW_THRESHOLD` e `VOLATILITY_HIGH_THRESHOLD` do `.env`.
        d.  Use uma estrutura `if/else if/else` para comparar o `atrPercentage` com os limiares.
        e.  Com base na condição de mercado (Calmo, Normal, Volátil), retorne um objeto com os multiplicadores corretos (ex: `{ stopMultiplier: 2.5, takeProfitMultiplier: 2.0 }`).
        f.  Adicione um log claro que informa qual perfil de volatilidade foi detectado (ex: `📊 [VOLATILITY] Mercado detectado como NORMAL para o par XYZ`).

2.  **Integrar a Nova Lógica:**
    * No seu método `calculateStopAndTarget` (ou `calculateScaledOrders`), em vez de ler os multiplicadores fixos do `.env`, chame o novo método `this.getATRMultipliers(data)` para obter os multiplicadores dinâmicos.
    * Use os multiplicadores retornados para calcular os preços de Stop Loss e Take Profit.

**Tarefa de Teste:**

1.  **Criar/Atualizar Arquivo de Teste:** Crie `src/Decision/Strategies/DynamicMultiplier.test.js` ou adicione ao teste da estratégia existente.
2.  **Cenários de Teste para `getATRMultipliers`:**
    * `it('deve retornar os multiplicadores de MERCADO CALMO quando o ATR% está abaixo do limiar inferior');`
    * `it('deve retornar os multiplicadores de MERCADO NORMAL quando o ATR% está entre os limiares');`
    * `it('deve retornar os multiplicadores de MERCADO VOLÁTIL quando o ATR% está acima do limiar superior');`
    * `it('deve retornar os multiplicadores fixos quando a seleção dinâmica está desativada');`

**Formato da Resposta Esperada:** O código refatorado da sua classe de Estratégia, com o novo método e a integração, e o código completo do novo arquivo de teste.