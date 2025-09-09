-- 🎯 CONFIGURAÇÕES DE CONFLUÊNCIA - EXEMPLOS SQL

-- ====================================================================
-- HABILITAR CONFLUÊNCIA SIMPLES (2 indicadores mínimos)
-- ====================================================================

-- Bot ID 1: Habilitar confluência com 2 indicadores
UPDATE bot_configs 
SET config = json_set(config, '$.enableConfluenceMode', true) 
WHERE botId = 1;

UPDATE bot_configs 
SET config = json_set(config, '$.minConfluences', 2) 
WHERE botId = 1;

-- ====================================================================
-- HABILITAR CONFLUÊNCIA CONSERVADORA (3 indicadores mínimos)
-- ====================================================================

-- Bot ID 2: Habilitar confluência com 3 indicadores
UPDATE bot_configs 
SET config = json_set(config, '$.enableConfluenceMode', true) 
WHERE botId = 2;

UPDATE bot_configs 
SET config = json_set(config, '$.minConfluences', 3) 
WHERE botId = 2;

-- ====================================================================
-- DESABILITAR CONFLUÊNCIA (volta ao modo tradicional)
-- ====================================================================

-- Desabilitar confluência para todos os bots
UPDATE bot_configs 
SET config = json_set(config, '$.enableConfluenceMode', false);

-- ====================================================================
-- VERIFICAR CONFIGURAÇÕES ATUAIS
-- ====================================================================

-- Ver configurações de confluência de todos os bots
SELECT 
  botId,
  json_extract(config, '$.botName') as botName,
  json_extract(config, '$.enableConfluenceMode') as confluenceEnabled,
  json_extract(config, '$.minConfluences') as minConfluences,
  json_extract(config, '$.enableMomentumSignals') as momentum,
  json_extract(config, '$.enableRsiSignals') as rsi,
  json_extract(config, '$.enableStochasticSignals') as stochastic,
  json_extract(config, '$.enableMacdSignals') as macd,
  json_extract(config, '$.enableAdxSignals') as adx
FROM bot_configs;

-- ====================================================================
-- CONFIGURAÇÃO COMPLETA EM UMA QUERY
-- ====================================================================

-- Habilitar confluência com configuração completa para bot específico
UPDATE bot_configs 
SET config = json_set(
  json_set(config, '$.enableConfluenceMode', true),
  '$.minConfluences', 2
)
WHERE botId = 1;

-- ====================================================================
-- EXAMPLES DE DIFERENTES NÍVEIS DE CONFLUÊNCIA
-- ====================================================================

-- NÍVEL BALANCEADO (2 indicadores) - Mais sinais, boa segurança
UPDATE bot_configs 
SET config = json_set(
  json_set(config, '$.enableConfluenceMode', true),
  '$.minConfluences', 2
)
WHERE botId = 1;

-- NÍVEL CONSERVADOR (3 indicadores) - Menos sinais, alta segurança
UPDATE bot_configs 
SET config = json_set(
  json_set(config, '$.enableConfluenceMode', true),
  '$.minConfluences', 3
)
WHERE botId = 2;

-- NÍVEL ULTRA SEGURO (4+ indicadores) - Poucos sinais, máxima precisão
UPDATE bot_configs 
SET config = json_set(
  json_set(config, '$.enableConfluenceMode', true),
  '$.minConfluences', 4
)
WHERE botId = 1;