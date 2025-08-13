# Guia de Início Rápido: Configurando o Seu BackBot

Bem-vindo ao BackBot! Este guia irá acompanhá-lo passo a passo, desde a instalação até colocar o seu primeiro bot de trading para operar. Siga cada etapa com atenção.

---

### **Passo 1: Baixar o Visual Studio Code (VS Code)**

O VS Code é o programa que usaremos para abrir a pasta do projeto do bot.

* **Ação:** Clique no link abaixo para ir para a página de download oficial.
* **Link:** [https://code.visualstudio.com/download](https://code.visualstudio.com/download)

`[INSERIR PRINT AQUI DA PÁGINA DE DOWNLOAD DO VS CODE]`

---

### **Passo 2: Baixar o Node.js**

O Node.js é o "motor" que faz o seu bot funcionar.

* **Ação:** Clique no link abaixo e baixe a versão **LTS**, que é a mais estável e recomendada.
* **Link:** [https://nodejs.org/en/download](https://nodejs.org/en/download)

`[INSERIR PRINT AQUI DA PÁGINA DE DOWNLOAD DO NODE.JS, DESTACANDO A VERSÃO LTS]`

* **Instalação:** Após baixar os dois arquivos (`.exe` para Windows ou `.dmg` para Mac), instale-os seguindo o assistente de instalação padrão. Pode clicar em "Next" em todas as etapas.

---

### **Passo 3: Fazer o Download do Projeto do Bot**

Agora, vamos baixar o código do BackBot.

* **Ação:** Clique no link abaixo para baixar o projeto como um arquivo `.zip`.
* **Link:** `[INSERIR LINK DIRETO PARA O DOWNLOAD DO ZIP DO SEU GITHUB AQUI]`

`[INSERIR PRINT AQUI MOSTRANDO O BOTÃO "CODE" E "DOWNLOAD ZIP" NO GITHUB]`

---

### **Passo 4: Extrair o Arquivo .zip**

Você precisa descompactar a pasta do projeto que acabou de baixar.

* **Ação:** Encontre o arquivo `.zip` na sua pasta de "Downloads", clique com o botão direito sobre ele e selecione **"Extrair Tudo..."** (ou "Extract All...").
* **Dica:** Escolha um local de fácil acesso para a pasta, como a sua "Área de Trabalho" (Desktop).

`[INSERIR PRINT AQUI MOSTRANDO O PROCESSO DE EXTRAIR O ARQUIVO ZIP]`

---

### **Passo 5: Abrir o Projeto no VS Code**

* **Ação:**
    1.  Abra o **Visual Studio Code**.
    2.  Vá em `File` (Arquivo) no menu superior e clique em **`Open Folder...`** (Abrir Pasta...).
    3.  Navegue até a pasta do bot que você extraiu (ex: `backbot-main`) e clique em "Selecionar Pasta".

`[INSERIR PRINT AQUI MOSTRANDO O MENU "FILE -> OPEN FOLDER" NO VS CODE]`

---

### **Passo 6: Abrir o Terminal no VS Code**

O terminal é a "janela de comandos" onde daremos as instruções para o bot.

* **Ação:** Com o projeto aberto, vá em `Terminal` no menu superior do VS Code e clique em **`New Terminal`** (Novo Terminal).
* Uma nova janela aparecerá na parte de baixo do VS Code.

`[INSERIR PRINT AQUI MOSTRANDO O MENU "TERMINAL -> NEW TERMINAL" E O TERMINAL ABERTO NA PARTE DE BAIXO]`

---

### **Passo 7: Instalar as Dependências**

Este comando irá instalar todas as "peças" que o bot precisa para funcionar.

* **Ação:** Clique no ícone de copiar ao lado do comando abaixo, cole-o no terminal que você abriu e pressione **Enter**.

```bash
npm install
```

* Aguarde a instalação terminar. Pode levar alguns minutos.

`[INSERIR PRINT AQUI DO TERMINAL MOSTRANDO O COMANDO "NPM INSTALL" A SER EXECUTADO]`

---

### **Passo 8: Rodar o Bot**

Agora vamos iniciar a aplicação!

* **Ação:** Copie e cole o seguinte comando no terminal e pressione **Enter**.

```bash
npm start
```
* O bot irá iniciar e, após alguns segundos, ele abrirá automaticamente uma nova aba no seu navegador de internet.

`[INSERIR PRINT AQUI DO TERMINAL MOSTRANDO O "NPM START" E OS LOGS DE INICIALIZAÇÃO]`

---

### **Passo 9: Navegador Aberto - A Dashboard**

Você agora está na Dashboard de Controle do BackBot. É aqui que toda a mágica acontece!

`[INSERIR PRINT AQUI DA TELA INICIAL DA DASHBOARD, MOSTRANDO AS ESTRATÉGIAS DISPONÍVEIS]`

---

### **Passo 10: Criar uma Chave de API na Backpack**

Para que o bot possa operar na sua conta, ele precisa de uma "chave de acesso" segura.

* **Ação:** Faça login na sua conta da Backpack e acesse a página de gerenciamento de API.
* **Link:** `[INSERIR LINK DIRETO PARA A PÁGINA DE API KEYS DA BACKPACK AQUI]`
* Crie uma nova chave de API, garantindo que ela tenha permissões para **ler informações** e **negociar (trade)**.

`[INSERIR PRINT AQUI DA TELA DA BACKPACK ONDE O USUÁRIO CRIA A API KEY]`

---

### **Passo 11: Copiar as Chaves**

Após criar a chave, a Backpack irá mostrar a você a **API Key** e a **Secret Key**.

* **Ação:** Copie as duas chaves e guarde-as em um local seguro temporariamente.
* **IMPORTANTE:** A `Secret Key` só é mostrada uma vez. Guarde-a com segurança!

---

### **Passo 12: Configurar o Bot na Dashboard**

Volte para a dashboard no seu navegador.

* **Ação:** Clique em **"Criar Bot"** e selecione a estratégia desejada (ex: DEFAULT).
* Um modal de configuração aparecerá. Cole a sua `API Key` e `Secret Key` nos campos correspondentes.
* **Dica:**
    * Cada campo de configuração tem um ícone de interrogação (`?`). Passe o mouse sobre ele para ler uma explicação detalhada sobre o que aquela opção faz.
    * Para uma configuração rápida, use os botões **`LUCRO`** ou **`VOLUME`**. Eles preenchem o formulário com configurações pré-ajustadas e otimizadas para cada objetivo. Passe o mouse sobre os botões para entender a diferença entre eles.

`[INSERIR PRINT AQUI DO MODAL DE CONFIGURAÇÃO, DESTACANDO OS CAMPOS DE API KEY, O ÍCONE DE AJUDA E OS BOTÕES DE PRESET]`

---

### **Passo 13: Criar o Bot**

* **Ação:** Após preencher todas as configurações, clique no botão **"Salvar e Criar Bot"**.

---

### **Passo 14: Colocar o Bot para Rodar**

Você voltará para a tela principal e agora verá um card com o seu bot recém-criado.

* **Ação:** Clique no botão **"Iniciar"** (ícone de play ▶️) no card do seu bot.

`[INSERIR PRINT AQUI DO CARD DO BOT NA DASHBOARD COM O BOTÃO "INICIAR" DESTACADO]`

**Pronto!** O status do seu bot mudará para "Rodando" e ele começará a analisar o mercado e a procurar por operações. Você pode acompanhar as posições abertas na tabela e ver as ordens no gráfico em tempo real.

Parabéns, você configurou com sucesso o seu BackBot!