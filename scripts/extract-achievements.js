const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');

// Nome do arquivo HTML e do arquivo JSON de saída
const HTML_FILE = 'data.html';
const JSON_FILE = 'achievements.json';

/**
 * Lê o arquivo HTML, extrai os dados dos cards e salva em um arquivo JSON.
 */
function extractDataFromHtml() {
  console.log(`Lendo o arquivo HTML: ${HTML_FILE}...`);

  try {
    // 1. LER O CONTEÚDO DO ARQUIVO
    const htmlContent = fs.readFileSync(path.join(__dirname, HTML_FILE), 'utf-8');

    // 2. CARREGAR O CONTEÚDO NO CHEERIO
    const $ = cheerio.load(htmlContent);
    const achievements = [];

    // 3. SELECIONAR E ITERAR SOBRE TODOS OS CARDS
    // Os cards de conquista (habilitados) são botões.
    const cardSelector = 'button.bg-base-background-l1v2';

    // Se houver cards de "Coming Soon" que são divs (como no snippet original),
    // adicione o seletor correspondente:
    // const allCardsSelector = 'button.bg-base-background-l1v2, div.bg-base-background-l1v2';
    // Ou, se todos os seus dados estiverem na estrutura do botão (como no conteúdo completo),
    // mantenha apenas o botão. Vamos manter o seletor mais específico dos dados fornecidos:

    $(cardSelector).each((i, element) => {
      const card = $(element);

      // Extrai o nome (título)
      const name = card.find('p.text-sm.font-normal.text-med-emphasis').text().trim();

      // Extrai a descrição (subtexto)
      const description = card.find('p.text-med-emphasis.z-10.line-clamp-2.text-xs.font-normal.text-ellipsis').text().trim();

      // Extrai a URL do ícone/imagem
      const iconUrl = card.find('img[alt="Achievement"]').attr('src') || 'N/A';

      // Assume um status. O status real dependeria de outras classes, mas
      // podemos inferir 'Disponível' para botões.
      let status = 'Disponível';

      // Se você tivesse cards "Coming Soon" (que são divs):
      // if (element.tagName === 'div') {
      //     status = 'Em Breve (Coming Soon)';
      // }

      achievements.push({
        id: i + 1,
        nome: name,
        descricao: description,
        icon_url: iconUrl,
        status: status
      });
    });

    // 4. SALVAR OS DADOS EM UM ARQUIVO JSON
    const jsonOutput = JSON.stringify(achievements, null, 2);
    fs.writeFileSync(path.join(__dirname, JSON_FILE), jsonOutput, 'utf-8');

    console.log(`\n✅ Sucesso! Dados extraídos e salvos em: ${JSON_FILE}`);
    console.log(`Total de ${achievements.length} conquistas encontradas.`);

  } catch (error) {
    console.error(`\n❌ Erro ao processar o arquivo: ${error.message}`);
  }
}

extractDataFromHtml();