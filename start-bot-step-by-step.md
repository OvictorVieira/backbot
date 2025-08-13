# Guia de Início Rápido: Configurando o Seu BackBot

Bem-vindo ao BackBot! Este guia irá acompanhá-lo passo a passo, desde a instalação até colocar o seu primeiro bot de trading para operar. Siga cada etapa com atenção.

---

### **Passo 1: Baixar o Visual Studio Code (VS Code)**

O VS Code é o programa que usaremos para abrir a pasta do projeto do bot.

* **Ação:** Clique no link abaixo para ir para a página de download oficial.
* **Link:** [https://code.visualstudio.com/download](https://code.visualstudio.com/download)

---

### **Passo 2: Baixar o Node.js**

O Node.js é o "motor" que faz o seu bot funcionar.

* **Ação:** Clique no link abaixo e baixe a versão **LTS**, que é a mais estável e recomendada.
* **Link:** [https://nodejs.org/en/download](https://nodejs.org/en/download)

* **Instalação:** Após baixar os dois arquivos (`.exe` para Windows ou `.dmg` para Mac), instale-os seguindo o assistente de instalação padrão. Pode clicar em "Next" em todas as etapas.

---

### **Passo 3: Fazer o Download do Projeto do Bot**

Agora, vamos baixar o código do BackBot.

* **Ação:** Clique no link abaixo para baixar o projeto como um arquivo `.zip`.
* **Link:** [clique aqui para o download](https://github.com/OvictorVieira/backbot/archive/refs/heads/main.zip)

---

### **Passo 4: Extrair o Arquivo .zip**

Você precisa descompactar a pasta do projeto que acabou de baixar.

* **Ação:** Encontre o arquivo `.zip` na sua pasta de "Downloads", clique com o botão direito sobre ele e selecione **"Extrair Tudo..."** (ou "Extract All...").
* **Dica:** Escolha um local de fácil acesso para a pasta, como a sua "Área de Trabalho" (Desktop).

**⚠️ Atenção, Usuários do Windows: Verifique a Pasta Correta!**

Às vezes, ao extrair um arquivo .zip no Windows, ele cria uma pasta extra, resultando numa estrutura como esta: backbot-main -> backbot-main -> (arquivos do bot).

Para garantir que o bot funcione, a pasta que você abre no VS Code deve ser a que contém diretamente os arquivos do projeto (como app.js, package.json, etc.).

## Como Verificar:

 - Errado: Se, ao abrir a pasta, você vir apenas uma outra pasta dentro dela.

 - Correto: Se, ao abrir a pasta, você vir vários arquivos e pastas, como na imagem abaixo.

<img width="1177" height="1224" alt="Captura de Tela 2025-08-13 às 19 29 29" src="https://github.com/user-attachments/assets/c7fbaedf-7205-48a7-8219-a36e30b6f13d" />

---

### **Passo 5: Abrir o Projeto no VS Code**

* **Ação:**
    1.  Abra o **Visual Studio Code**.
    2.  Vá em `File` (Arquivo) no menu superior e clique em **`Open Folder...`** (Abrir Pasta...).
    3.  Navegue até a pasta do bot que você extraiu (ex: `backbot-main`) e clique em "Selecionar Pasta".

<img width="905" height="756" alt="Captura de Tela 2025-08-13 às 19 35 12" src="https://github.com/user-attachments/assets/68b5527c-bdb1-4ba8-af57-b5ca76cf8d73" />

<img width="776" height="964" alt="Captura de Tela 2025-08-13 às 19 36 37" src="https://github.com/user-attachments/assets/50107109-1fc1-46c1-83fa-eb99909a38e9" />

---

### **Passo 6: Abrir o Terminal no VS Code**

O terminal é a "janela de comandos" onde daremos as instruções para o bot.

* **Ação:** Com o projeto aberto, vá em `Terminal` no menu superior do VS Code e clique em **`New Terminal`** (Novo Terminal).
* Uma nova janela aparecerá na parte de baixo do VS Code.

<img width="469" height="343" alt="Captura de Tela 2025-08-13 às 19 38 08" src="https://github.com/user-attachments/assets/0b515cd8-3ac6-4a80-b3ce-376ab7c5b530" />

<img width="2798" height="1828" alt="Captura de Tela 2025-08-13 às 19 38 37" src="https://github.com/user-attachments/assets/c9835bc6-f348-4375-9121-dd605142f332" />

---

### **Passo 7: Instalar as Dependências**

Este comando irá instalar todas as "peças" que o bot precisa para funcionar.

* **Ação:** Clique no ícone de copiar ao lado do comando abaixo, cole-o no terminal que você abriu e pressione **Enter**.

```bash
npm install
```

* Aguarde a instalação terminar. Pode levar alguns minutos.

<img width="1740" height="873" alt="Captura de Tela 2025-08-13 às 19 39 38" src="https://github.com/user-attachments/assets/8709aacb-2f17-49ce-8e28-59adab0e9ee7" />

---

### **Passo 8: Rodar o Bot**

Agora vamos iniciar a aplicação!

* **Ação:** Copie e cole o seguinte comando no terminal e pressione **Enter**.

```bash
npm start
```
* O bot irá iniciar e, após alguns segundos, ele abrirá automaticamente uma nova aba no seu navegador de internet.

<img width="1322" height="1242" alt="Captura de Tela 2025-08-13 às 19 40 23" src="https://github.com/user-attachments/assets/e7bcee5f-0104-4a54-abed-3d235983e8ed" />

---

### **Passo 9: Navegador Aberto - A Dashboard**

Você agora está na Dashboard de Controle do BackBot. É aqui que toda a mágica acontece!

---

### **Passo 10: Criar uma Chave de API na Backpack**

Para que o bot possa operar na sua conta, ele precisa de uma "chave de acesso" segura.

* **Ação:** Faça login na sua conta da Backpack e acesse a página de gerenciamento de API.
* **Link:** [Clique Aqui](https://backpack.exchange/portfolio/settings/api-keys)
* Crie uma nova chave de API, garantindo que ela tenha permissões para **ler informações** e **negociar (trade)**.

<img width="822" height="783" alt="Captura de Tela 2025-08-13 às 19 47 19" src="https://github.com/user-attachments/assets/7938421d-1dce-43f7-af29-4ed48c6aa5ca" />

<img width="707" height="815" alt="Captura de Tela 2025-08-13 às 19 47 40" src="https://github.com/user-attachments/assets/70c4d4bf-68b8-4c88-befa-e70ee3ef1b25" />

---

### **Passo 11: Copiar as Chaves**

Após criar a chave, a Backpack irá mostrar a você a **API Key** e a **Secret Key**.

* **Ação:** Copie as duas chaves e guarde-as em um local seguro temporariamente.
* **⚠️ IMPORTANTE:** A `Secret Key` só é mostrada uma vez. Guarde-a com segurança!!!!

---

### **Passo 12: Configurar o Bot na Dashboard**

Volte para a dashboard no seu navegador.

* **Ação:** Clique em **"Criar Bot"** e selecione a estratégia desejada (ex: DEFAULT).
* Um modal de configuração aparecerá. Cole a sua `API Key` e `Secret Key` nos campos correspondentes.
* **Dica:**
    * Cada campo de configuração tem um ícone de interrogação (`?`). Passe o mouse sobre ele para ler uma explicação detalhada sobre o que aquela opção faz.
    * Para uma configuração rápida, use os botões **`LUCRO`** ou **`VOLUME`**. Eles preenchem o formulário com configurações pré-ajustadas e otimizadas para cada objetivo. Passe o mouse sobre os botões para entender a diferença entre eles.

<img width="986" height="1844" alt="Captura de Tela 2025-08-13 às 19 49 19" src="https://github.com/user-attachments/assets/ac1d2da1-85a4-4d72-982a-07cdabbba14d" />

<img width="931" height="1811" alt="Captura de Tela 2025-08-13 às 19 49 42" src="https://github.com/user-attachments/assets/55760270-7a71-4459-aa1c-9471a5536520" />

<img width="956" height="1844" alt="Captura de Tela 2025-08-13 às 19 50 23" src="https://github.com/user-attachments/assets/119ea974-bff4-42b7-8aa3-8ad85df83cc5" />

---

### **Passo 13: Criar o Bot**

* **Ação:** Após preencher todas as configurações, clique no botão **"Salvar e Criar Bot"**.

---

### **Passo 14: Colocar o Bot para Rodar**

Você voltará para a tela principal e agora verá um card com o seu bot recém-criado.

* **Ação:** Clique no botão **"Iniciar"** (ícone de play ▶️) no card do seu bot.

<img width="489" height="835" alt="Captura de Tela 2025-08-13 às 19 51 31" src="https://github.com/user-attachments/assets/499b8b81-d9af-4a14-b91d-396b788ffea6" />

<img width="3814" height="1671" alt="Captura de Tela 2025-08-13 às 19 51 11" src="https://github.com/user-attachments/assets/3bcb64bb-eacf-4374-bbd8-93b89ea707ae" />

**Pronto!** O status do seu bot mudará para "Rodando" e ele começará a analisar o mercado e a procurar por operações. Você pode acompanhar as posições abertas na tabela e ver as ordens no gráfico em tempo real.

Parabéns, você configurou com sucesso o seu BackBot!
