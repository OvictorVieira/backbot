# BackBot - Bot de Trading Inteligente para Backpack Exchange

Bem-vindo ao BackBot, um bot de trading automatizado de nível profissional, projetado para operar futuros perpétuos na Backpack Exchange.

O foco principal do bot é o **farming de volume** com uma ênfase rigorosa na **preservação de capital**. A arquitetura foi construída para ser robusta, resiliente e, acima de tudo, segura.

## 🚀 Funcionalidades Principais

* **Estratégia `DEFAULT` Inteligente**: Um sistema robusto com 8 camadas de validação para encontrar sinais de alta confluência, garantindo que apenas as melhores oportunidades sejam consideradas.
* **Execução Híbrida de Ordens**: O bot otimiza os custos de transação ao tentar sempre executar ordens `LIMIT (post-only)`. Se a ordem não for executada rapidamente, um fallback inteligente para uma ordem a `MERCADO` garante que a oportunidade não seja perdida.
* **Gestão de Risco Híbrida e Adaptativa**: O coração do bot. Em vez de usar um Stop Loss fixo, o sistema utiliza uma estratégia de múltiplas fases baseada na volatilidade real do mercado (ATR) para gerir cada operação.
* **Trailing Stop Dinâmico**: Permite maximizar os lucros ao fazer com que operações vencedoras "corram", movendo o stop loss automaticamente para proteger os ganhos.
* **Sistema de "Failsafe" na Corretora**: Para cada posição aberta, o bot cria uma ordem de Stop Loss de segurança máxima (`STOP_MARKET`) diretamente na exchange, protegendo o seu capital mesmo que o bot pare de funcionar.
* **Persistência de Estado**: Salva o estado crítico do Trailing Stop num arquivo (`trailing_state.json`), garantindo que o bot sobreviva a reinicializações sem perder a gestão das suas posições ativas.
* **Monitor de Ordens Órfãs**: Um serviço de limpeza que periodicamente verifica e cancela ordens de stop que possam ter ficado "órfãs" na corretora após o fecho manual de uma posição.

---

## ⚙️ Como o Bot Funciona: A Estratégia Híbrida de Gestão de Risco

A funcionalidade mais importante do BackBot é a sua forma inteligente de gerir o risco. A vida de cada trade segue um ciclo de 3 fases, garantindo que o risco seja minimizado e os lucros maximizados.

### A Jornada de um Trade

| Fase | Nome | Descrição |
| :--- | :--- | :--- |
| **1** | **Risco Inicial (Stop Adaptativo)** | Ao abrir uma posição, o Stop Loss não é uma percentagem fixa. Ele é calculado dinamicamente com base na **volatilidade atual do mercado (ATR)**. Em dias voláteis, o stop fica mais largo para evitar "violinadas". Em dias calmos, fica mais justo para proteger o capital. |
| **2** | **Trava de Segurança (Realização Parcial)** | Quando a operação atinge um primeiro alvo de lucro modesto (também baseado em ATR), o bot **vende uma parte da posição** (ex: 50%). Este lucro inicial serve para "pagar o trade", cobrindo as taxas e garantindo um pequeno ganho. O Stop Loss do restante da posição é então movido para o **ponto de entrada (breakeven)**. |
| **3** | **Maximização do Lucro (Trailing Stop)** | Com uma **"operação sem risco"** em mãos, o Trailing Stop é ativado para o restante da posição. Ele "persegue" o preço, movendo a rede de segurança para cima (ou para baixo) e travando lucros cada vez maiores, fechando a operação apenas quando a tendência reverte. |

Esta abordagem garante que o bot se adapte a diferentes moedas e condições de mercado, protegendo o seu capital enquanto procura maximizar os ganhos das operações vencedoras.

---

## 🚀 Executando o Bot

Para iniciar o bot com a sua configuração, use o comando:

```bash
npm start
```

O bot começará a analisar o mercado e a operar de acordo com as suas configurações.

## ⚠️ Disclaimer

Este software é fornecido para fins educacionais e de pesquisa. O trading de criptomoedas envolve riscos significativos. Os autores não se responsabilizam por quaisquer perdas financeiras. **Use por sua conta e risco.**