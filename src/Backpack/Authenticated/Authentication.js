import nacl from 'tweetnacl';
import Logger from '../../Utils/Logger.js';

export function auth({ instruction, params = {}, timestamp, window = 30000, apiKey, apiSecret }) {
  try {
    // Verifica se as credenciais foram fornecidas
    if (!apiSecret || !apiKey) {
      throw new Error(`API_SECRET e API_KEY são obrigatórios`);
    }

    // Decodifica a chave privada
    let privateKeySeed;
    try {
      privateKeySeed = Buffer.from(apiSecret, 'base64');
    } catch (error) {
      throw new Error(`API_SECRET inválido: deve ser um base64 válido. Erro: ${error.message}`);
    }

    if (privateKeySeed.length !== 32) {
      throw new Error(
        `API_SECRET deve ter 32 bytes quando decodificado. Tamanho atual: ${privateKeySeed.length} bytes`
      );
    }

    const keyPair = nacl.sign.keyPair.fromSeed(privateKeySeed);

    // Ordena e constrói os parâmetros
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const baseString = sortedParams ? `${sortedParams}&` : '';
    const payload = `instruction=${instruction}&${baseString}timestamp=${timestamp}&window=${window}`;

    // Log apenas para ordens (não para todas as requisições)
    if (instruction === 'orderExecute' && params.triggerPrice) {
      Logger.info(`🔐 [AUTH_DEBUG] Trigger order - Payload: ${payload.substring(0, 200)}...`);
      Logger.info(`🔐 [AUTH_DEBUG] Params keys: ${Object.keys(params).sort().join(', ')}`);
    }

    // Gera a assinatura
    const signature = nacl.sign.detached(Buffer.from(payload), keyPair.secretKey);

    // A API Key deve ser a chave pública (verifying key) em base64
    const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString('base64');

    return {
      'X-API-Key': publicKeyBase64,
      'X-Signature': Buffer.from(signature).toString('base64'),
      'X-Timestamp': timestamp.toString(),
      'X-Window': window.toString(),
      'Content-Type': 'application/json; charset=utf-8',
    };
  } catch (error) {
    Logger.debug(error.stack);

    Logger.error('❌ Erro na autenticação:', error.message);
    throw error;
  }
}
