import nacl from 'tweetnacl';

export function auth({ instruction, params = {}, timestamp, window = 30000, apiKey, apiSecret }) {
  try {
    // Verifica se as credenciais foram fornecidas
    if (!apiSecret || !apiKey) {
      throw new Error(`API_SECRET e API_KEY são obrigatórios`);
    }

    // Decodifica a chave privada
    const privateKeySeed = Buffer.from(apiSecret, 'base64'); 
    const keyPair = nacl.sign.keyPair.fromSeed(privateKeySeed);

    // Ordena e constrói os parâmetros
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const baseString = sortedParams ? `${sortedParams}&` : '';
    const payload = `instruction=${instruction}&${baseString}timestamp=${timestamp}&window=${window}`;

    // Gera a assinatura
    const signature = nacl.sign.detached(Buffer.from(payload), keyPair.secretKey);

    return {
      'X-API-Key': apiKey,
      'X-Signature': Buffer.from(signature).toString('base64'),
      'X-Timestamp': timestamp.toString(),
      'X-Window': window.toString(),
      'Content-Type': 'application/json; charset=utf-8'
    };
  } catch (error) {
    console.log(error.stack);

    console.error('❌ Erro na autenticação:', error.message);
    throw error;
  }
}
