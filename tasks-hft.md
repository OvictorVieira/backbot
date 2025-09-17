# Plano de Implementação: Modo HFT para Airdrop

Este documento descreve as tarefas para adicionar um novo modo de operação ao bot, focado em **High-Frequency Trading (HFT)** para maximizar o volume de negociação e os pontos de airdrop.  
As tarefas estão divididas para o **back-end** e **front-end**, com detalhes para auxiliar o desenvolvimento passo a passo.

---

## 1. Back-end: Lógica do Modo HFT

### Tarefa 1.1: Criar a Estratégia de Grid Trading para Airdrop

**Objetivo:**  
Desenvolver a lógica central do modo HFT, baseada em ordens *Maker* de pequena margem, e integrar o posicionamento inteligente de ordens em todas as estratégias.

#### Diferença na Lógica de Decisão (HFT vs. Estratégia Default)
- Diferente da estratégia padrão que utiliza `Decision.js` e `Indicators.js` (com indicadores como **RSI** e **VWAP**), o modo HFT abandona completamente essa abordagem.
- O HFT não se baseia em previsões de mercado. Sua decisão é puramente quantitativa e contínua, focada em um loop simples:
    - “A ordem foi preenchida?”
    - “O preço de mercado se moveu?”
- A lógica de decisão é implementada diretamente no loop de execução da estratégia (*Grid Trading*), sem necessidade de análise complexa de indicadores.

#### Detalhes de Implementação
**Comportamento Esperado:** Criação Inteligente dos Grids  
O bot não apenas coloca ordens de compra e venda. Ele deve monitorar o *orderbook* e o último preço de mercado para posicionar suas ordens de forma estratégica, agindo como *liquidity provider*.

**Passos:**
1. **Obter o Ticker:**
    - A estratégia começa obtendo o preço de mercado atual (último preço negociado).
2. **Definir o Grid:**
    - Com base no preço atual e no *spread* configurado (ex.: `0.01%`), calcular:
        - **Preço de Compra:** Último Preço - (spread × Último Preço)
        - **Preço de Venda:** Último Preço + (spread × Último Preço)
3. **Posicionar as Ordens:**
    - Criar ordens *limit* de compra e venda nesses preços.
4. **Monitoramento e Replicação (Loop):**
    - Se a ordem de compra for preenchida, criar nova ordem de venda no novo preço de mercado + *spread*.
    - Se o preço se afastar, cancelar ambas as ordens e reposicioná-las com o novo preço.

**Função Principal:**  
`executeHFTStrategy(symbol, amount, config)` — ponto de entrada do modo.

**Ordens Iniciais:**
- Colocar duas ordens *limit* próximas ao preço de mercado:
    - Compra: preço de mercado - 0.01%
    - Venda: preço de mercado + 0.01%

**Execução:**
- Ao executar uma ordem, criar a oposta imediatamente.

**Cancelamento e Replicação:**
- Cancelar ordens se o preço de mercado se mover significativamente e recriá-las com novo nível.

**Outros Pontos:**
- **Taxas:** Preferir pares com taxas *Maker* baixas ou nulas.
- **Gerenciamento de Saldo:** Garantir fundos suficientes para ambas as ordens.

---

### Tarefa 1.2: Gerenciar o Livro de Ordens (Orderbook) com WebSocket

**Objetivo:**  
Manter um cache local do *orderbook* usando WebSocket para decisões instantâneas.

#### Detalhes de Implementação
- **Cache em Memória:**
    - Usar `Map` ou `Object` em RAM para latência mínima.
    - Não utilizar banco de dados (ex.: SQLite) devido à lentidão de I/O em disco.
- **Inicialização (Fallback):**
    - No início, fazer uma requisição REST (`GET /api/v1/depth`) para obter um *snapshot* inicial do livro de ordens.
- **Conexão WebSocket:**
    - Conectar ao endpoint WebSocket da Backpack e assinar o canal do livro de ordens.
- **Atualizações:**
    - Processar mensagens de delta e atualizar o cache local em tempo real.
- **Persistência:**
    - Nada é salvo em disco. O cache é recriado a cada inicialização.
- **Consistência:**
    - A Tarefa 1.1 usa apenas o cache local. REST é usado apenas no *fallback*.

---

### Tarefa 1.3: Adicionar a Lógica de Parada

**Objetivo:**  
Implementar um mecanismo para pausar e encerrar o modo HFT de forma segura.

#### Detalhes de Implementação
- **Função de Parada:** `stopHFTMode()`
- **Ações:**
    - Cancelar todas as ordens ativas do HFT.
    - Parar o loop de negociação.
    - Liberar saldo da conta.

---

## 2. Front-end: Interface do Usuário

### Tarefa 2.1: Adicionar um Novo Modo na Tela de Criação de Bot

**Objetivo:**  
Criar nova opção na tela de *Create Bot* para o “Modo HFT para Airdrop”.

#### Detalhes de Implementação
- Adicionar seletor/checkbox para escolha entre modo atual e Modo HFT.
- Quando HFT estiver ativo:
    - Campos de TP e SL desabilitados ou ocultos.
    - Campos específicos:
        - **Spread:** porcentagem de diferença entre ordens de compra e venda.
        - **Daily Volume Goal:** volume diário desejado.

---

### Tarefa 2.2: Criar um Painel de Status para o Modo HFT

**Objetivo:**  
Exibir métricas de airdrop em tempo real na dashboard.

#### Detalhes de Implementação
- Criar card específico mostrando:
    - Volume Negociado (modo HFT)
    - Número de Negociações
    - Lucro/Prejuízo Realizado (P&L)

---

### Tarefa 2.3: Implementar Notificações e Feedback Visual

**Objetivo:**  
Fornecer feedback claro sobre as ações do bot no modo HFT.

#### Detalhes de Implementação
- **Notificação de Ordem:**
    - Pop-up para alertar criação ou cancelamento de ordens.
- **Status Visual:**
    - Ícones/cores na dashboard para indicar:
        - Ativo
        - Pausado
        - Rate-limit
- **Log de Atividades:**
    - Exibir histórico simples (ex.: “Ordem de compra criada”, “Ordem cancelada por mudança de preço”).

---
