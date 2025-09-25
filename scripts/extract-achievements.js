import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

// Resolve __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nome do arquivo HTML e do arquivo JSON de saída
const HTML_FILE = 'achievements.html';
const JSON_FILE = '../src/persistence/tokens.json';

/**
 * Regex estrito para capturar apenas tokens que terminam com '-PERP'.
 * O grupo de captura 1 é o token completo (ex: 0G-PERP).
 */
const PERP_TOKEN_REGEX = /([A-Z0-9]+-[A-Z0-9]*PERP)\b/g;

/**
 * Converte o formato do token de '-PERP' para o formato da API da corretora,
 * assumindo '_USDC_PERP'.
 * Ex: '0G-PERP' -> '0G_USDC_PERP'
 * @param {string} rawToken O token no formato de conquista (ex: 'PENDLE-PERP').
 * @returns {string} O token no formato de corretora (ex: 'PENDLE_USDC_PERP').
 */
function formatTokenForExchange(rawToken) {
  // 1. Encontra a parte que precede '-PERP' (ex: '0G' de '0G-PERP')
  const base = rawToken.replace(/-PERP$/, '');

  // 2. Converte e retorna o novo formato
  return `${base}_USDC_PERP`;
}

/**
 * Lê o arquivo HTML, extrai e formata os tokens e salva em um JSON.
 */
function extractAndFormatPerpTokens() {
  console.log(`Lendo o arquivo HTML: ${HTML_FILE}...`);

  try {
    const htmlPath = path.join(__dirname, HTML_FILE);
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const $ = cheerio.load(htmlContent);
    const uniqueFormattedTokens = new Set();
    const rawTokensList = new Set(); // Para referência/log

    // Seletor unificado para cards
    const allCardsSelector = 'button.bg-base-background-l1v2, div.bg-base-background-l1v2';

    $(allCardsSelector).each((i, element) => {
      const card = $(element);

      // Tenta encontrar o nome/título do card
      let cardName = card.find('p.text-sm.font-normal.text-med-emphasis').text().trim();
      if (!cardName) {
        cardName = card.find('p.text-med-emphasis.text-sm.font-normal').text().trim();
      }

      if (cardName && cardName !== 'Coming Soon') {
        const cleanName = cardName.toUpperCase().replace(/[^\w\s-]/g, ' ');

        // Encontra todas as correspondências do regex estrito para -PERP
        const matches = Array.from(cleanName.matchAll(PERP_TOKEN_REGEX), m => m[1]);

        if (matches) {
          matches.forEach(rawToken => {
            rawTokensList.add(rawToken);

            // Formatação final
            const formattedToken = formatTokenForExchange(rawToken);
            uniqueFormattedTokens.add(formattedToken);
          });
        }
      }
    });

    // 2. Cria o objeto JSON final com a lista única e ordenada de tokens formatados
    const jsonOutput = {
      perp_tokens_formatted: Array.from(uniqueFormattedTokens).sort()
    };

    const jsonString = JSON.stringify(jsonOutput, null, 2);
    const jsonPath = path.join(__dirname, JSON_FILE);
    fs.writeFileSync(jsonPath, jsonString, 'utf-8');

    console.log(`\n✅ Sucesso! ${uniqueFormattedTokens.size} tokens futuros (em formato de corretora) extraídos e salvos em: ${JSON_FILE}`);
    console.log(`Tokens Originais Encontrados: ${Array.from(rawTokensList).sort().join(', ')}`);
    console.log(`Tokens Formatados Salvos: ${Array.from(uniqueFormattedTokens).sort().join(', ')}`);

  } catch (error) {
    console.error(`\n❌ Erro ao processar o arquivo: ${error.message}`);
    if (error.code === 'ENOENT') {
      console.error(`Certifique-se de que o arquivo '${HTML_FILE}' está no mesmo diretório do script.`);
    }
  }
}

extractAndFormatPerpTokens();