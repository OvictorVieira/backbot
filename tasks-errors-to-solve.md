# Plano de Correção: Estratégia Alpha Flow

Este documento detalha as tarefas sequenciais para depurar e corrigir a "Alpha Flow Strategy" no BackBot. Cada tarefa é um prompt autocontido para ser executado. Marque cada caixa de seleção ao concluir a tarefa correspondente.

## Fase 1: A Fundação - Garantir a Validade dos Dados de Mercado

**Intenção:** A causa de muitos erros (`Quantity decimal too long`, `Quantity is below minimum`) é a falta de conhecimento sobre as regras do mercado (ex: quantas casas decimais uma ordem pode ter). Esta tarefa irá garantir que o bot sempre tenha acesso a essas regras antes de tentar criar uma ordem.

### Tarefa 1.1: Centralizar e Passar os Dados de Mercado

- [✓] **Tarefa Principal:** Garantir que as informações de mercado (limites, precisão) estejam sempre disponíveis para a estratégia e o controlador de ordens.
- [✓] **Testes:** Criar testes para validar a nova passagem de dados.

**Prompt para o Cursor:**

**Função:** Você é um arquiteto de software sénior, especialista em refatorar sistemas de trading para garantir a integridade dos dados e a robustez.

**Objetivo:** Refatorar a pipeline de dados para que a informação completa do mercado (`market details`), incluindo `min_quantity`, `decimal_quantity`, etc., seja obtida no `Decision.js` e passada para a estratégia (`AlphaFlowStrategy.js`) e para o `OrderController.js`.

**Tarefa Detalhada:**

1.  **Modificar `Decision.js`:**
    * No método `analyze()`, antes de chamar a estratégia, use o `AccountController.get()` para obter os dados da conta, que incluem o array `markets`.
    * Encontre o objeto de mercado correspondente ao símbolo que está a ser analisado.

2.  **Modificar `AlphaFlowStrategy.js`:**
    * Altere a assinatura do método `analyzeTrade` para receber o objeto `market` como um novo parâmetro: `analyzeTrade(fee, data, investmentUSD, market)`.
    * Dentro do `calculateScaledOrders`, use `market.decimal_quantity` e `market.min_quantity` para formatar e validar a quantidade de cada ordem. A função deve agora retornar `null` se a quantidade calculada for menor que a mínima permitida.

3.  **Modificar `OrderController.js`:**
    * Altere a assinatura dos métodos de criação de ordem (ex: `createLimitOrderWithTriggers`) para também receber o objeto `market`.
    * Use os dados do `market` para formatar a quantidade final antes de a enviar para a API, garantindo que nunca ocorram os erros "Quantity decimal too long" ou "Quantity is below the minimum".

**Formato da Resposta Esperada:** O código refatorado dos arquivos `Decision.js`, `AlphaFlowStrategy.js` e `OrderController.js`.

---

## Fase 2: Correção da Lógica de Execução da Estratégia

**Intenção:** O bug principal é que o bot não está a criar as 3 ordens escalonadas. Esta tarefa foca-se em corrigir o fluxo de orquestração para garantir que o `Decision.js` interprete corretamente a resposta da `AlphaFlowStrategy` e chame o `OrderController` o número correto de vezes.

### Tarefa 2.1: Corrigir o Fluxo de Múltiplas Ordens

- [✓] **Tarefa Principal:** Garantir que o `Decision.js` execute o loop para criar as 3 ordens.
- [✓] **Testes:** Criar testes de regressão para validar este fluxo.

**Prompt para o Cursor:**

**Função:** Você é um especialista em depurar fluxos de lógica assíncrona em Node.js.

**Objetivo:** Corrigir a lógica no `Decision.js` que processa o resultado da `AlphaFlowStrategy.js`.

**Tarefa Detalhada:**

1.  **Revisar `Decision.js` - Método `analyze()`:**
    * Após a chamada a `strategy.analyzeTrade()`, verifique se a `tradeDecision` contém a propriedade `orders` e se é um array com itens.
    * **Se for**, o código deve entrar num loop `for...of` para iterar sobre cada uma das 3 ordens no array.
    * Dentro do loop, para cada ordem, ele deve chamar o `OrderController` para a criar.
    * **Se não for** (o caso da estratégia `DEFAULT`), ele deve seguir o fluxo de ordem única que já existe.

2.  **Garantir a Passagem de Dados Corretos:**
    * Dentro do novo loop, certifique-se de que todos os dados necessários (o objeto da ordem, o `market` da Tarefa 1.1, etc.) são passados para o `OrderController`.

3.  **Criar Testes de Regressão em `Decision.test.js`:**
    * `it('deve chamar o OrderController 3 vezes quando a AlphaFlowStrategy retorna 3 ordens');`
        * **Setup:** Mock `AlphaFlowStrategy.analyzeTrade` para retornar um objeto com `orders: [{}, {}, {}]`. Use `jest.spyOn` para espiar o `OrderController.createLimitOrderWithTriggers`.
        * **Ação:** Chame `decision.analyze()`.
        * **Verificação:** `expect(OrderController.createLimitOrderWithTriggers).toHaveBeenCalledTimes(3)`.

**Formato da Resposta Esperada:** O código refatorado do `Decision.js` e o código atualizado do `Decision.test.js`.

---

## Fase 3: Robustez e Tratamento de Erros

**Intenção:** Os logs mostram muitos erros de "margem insuficiente" e "mercado não encontrado". Esta tarefa visa tornar o bot mais robusto, adicionando verificações prévias e melhorando os logs de erro para facilitar a depuração no futuro.

### Tarefa 3.1: Adicionar Verificações Prévias e Melhorar Logs

- [✓] **Tarefa Principal:** Adicionar validações de margem e de mercado antes de tentar criar ordens.

**Prompt para o Cursor:**

**Função:** Você é um especialista em criar sistemas de trading robustos e à prova de falhas.

**Objetivo:** Adicionar camadas de validação e melhorar o tratamento de erros no `Decision.js` e `OrderController.js`.

**Tarefa Detalhada:**

1.  **Verificação de Margem em `Decision.js`:**
    * Antes de calcular o `investmentUSD`, verifique se `Account.capitalAvailable` é suficiente. Se não for, logue um aviso claro (`⚠️ [CAPITAL] Margem insuficiente para iniciar nova análise.`) e pare o ciclo de análise.

2.  **Validação de Símbolo em `Decision.js`:**
    * O erro `Market não encontrado para undefined` indica que a estratégia está a devolver uma decisão sem um símbolo. Antes de entrar no loop de execução de ordens, adicione uma verificação: `if (!tradeDecision || !tradeDecision.symbol)`. Se for verdade, logue um erro e aborte.

3.  **Melhorar Logs de Erro no `OrderController.js`:**
    * No bloco `catch` dos métodos de criação de ordem, enriqueça o log de erro para incluir todos os parâmetros da ordem que falhou (símbolo, quantidade, preço, etc.). Isso facilitará a depuração de erros como "Insufficient margin".
    * **Exemplo de Log:** `❌ [ORDER_FAIL] Falha ao criar ordem para ${symbol}. Detalhes: ${JSON.stringify(params)}. Erro: ${error.message}`.

**Formato da Resposta Esperada:** O código refatorado dos arquivos `Decision.js` e `OrderController.js` com as novas validações e logs.

---

## Fase 4: Correção da Estrutura de Dados da Alpha Flow Strategy

**Intenção:** O erro "Decisão sem símbolo válido" indica que o `Decision.js` não está conseguindo extrair corretamente o símbolo do mercado a partir da estrutura de dados retornada pela `AlphaFlowStrategy.js`.

### Tarefa 4.1: Corrigir a Extração de Símbolo para Alpha Flow Strategy

- [✓] **Tarefa Principal:** Corrigir a lógica de extração de símbolo no `Decision.js` para lidar com a estrutura de dados específica da Alpha Flow Strategy.

**Detalhes da Correção:**

A `AlphaFlowStrategy.js` retorna dados nesta estrutura:
```javascript
{
  action: 'long',
  conviction: 'BRONZE',
  reason: '...',
  signals: {...},
  orders: [
    {
      market: 'SYMBOL',
      symbol: 'SYMBOL',
      // ... other order data
    }
  ]
}
```

O problema estava no `Decision.js` onde o código tentava acessar `row.symbol` diretamente, mas para a Alpha Flow Strategy, o símbolo está dentro de `row.orders[0].market`.

**Correção Implementada:**
- Modificada a lógica de extração de símbolo para primeiro determinar a estrutura do objeto
- Para Alpha Flow Strategy: extrai o símbolo de `row.orders[0].market`
- Para estratégias tradicionais: extrai de `row.market` ou `row.symbol`
- Movida a validação de símbolo para depois da determinação da estrutura

**Formato da Resposta Esperada:** Código corrigido no `Decision.js` que lida corretamente com ambas as estruturas de dados.

---

## Fase 5: Correção da Validação do Money Flow

**Intenção:** A validação do Money Flow estava muito permissiva, aceitando sinais com valores próximos de zero. Para obter sinais realmente válidos, precisamos usar níveis mais rigorosos de +20 para LONG e -20 para SHORT.

### Tarefa 5.1: Implementar Validação Rigorosa do Money Flow

- [✓] **Tarefa Principal:** Corrigir a validação do Money Flow para usar os níveis corretos de +20/-20.

**Detalhes da Correção:**

**Problema Identificado:**
O Money Flow estava sendo validado apenas como positivo (> 0) ou negativo (< 0), o que é muito permissivo e pode gerar sinais falsos.

**Correção Implementada:**
- **Para LONG:** Money Flow deve ser > +20 (não apenas > 0)
- **Para SHORT:** Money Flow deve ser < -20 (não apenas < 0)
- **Direção:** Atualizada para refletir os novos níveis rigorosos

**Código Corrigido em `Indicators.js`:**
```javascript
return {
  value: mfiValue,
  mfi: currentMfi,
  mfiAvg: currentMfiAvg,
  isBullish: mfiValue > 20,        // ✅ CORRIGIDO: Validação rigorosa para LONG
  isBearish: mfiValue < -20,       // ✅ CORRIGIDO: Validação rigorosa para SHORT
  isStrong: Math.abs(mfiValue) > 10,
  direction: mfiValue > 20 ? 'UP' : (mfiValue < -20 ? 'DOWN' : 'NEUTRAL'),
  history: mfiHistory
};
```

**Impacto:**
- Sinais mais precisos e confiáveis
- Redução de falsos positivos
- Melhor qualidade dos sinais de entrada
- Maior taxa de acerto nas operações

**Formato da Resposta Esperada:** Código corrigido no `Indicators.js` com validação rigorosa do Money Flow.

---