'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_AFFILIATE_TAG,
  DEFAULT_COOKIES_PATH,
  DEFAULT_DB_PATH,
  DEFAULT_LOOP_ENABLED,
  DEFAULT_LOOP_DELAY_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_PRODUCT_LIMIT,
  DEFAULT_RESEND_AFTER_HOURS,
  DEFAULT_TARGETS_PATH,
  DEFAULT_WEBHOOK_URL,
  PROMOTION_FILTERS,
} = require('./constants');

function parseArgs(argv) {
  const args = {
    cookies: DEFAULT_COOKIES_PATH,
    db: DEFAULT_DB_PATH,
    limit: DEFAULT_PRODUCT_LIMIT,
    loop: DEFAULT_LOOP_ENABLED,
    loopDelayMs: DEFAULT_LOOP_DELAY_MS,
    maxPages: DEFAULT_MAX_PAGES,
    resendAfterHours: DEFAULT_RESEND_AFTER_HOURS,
    pretty: true,
    affiliate: true,
    affiliateTag: DEFAULT_AFFILIATE_TAG,
    promotionTypes: [],
    targetsFile: DEFAULT_TARGETS_PATH ? path.resolve(process.cwd(), DEFAULT_TARGETS_PATH) : null,
    help: false,
    webhook: DEFAULT_WEBHOOK_URL,
    targets: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--cookies') {
      args.cookies = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--limit') {
      args.limit = Number.parseInt(argv[++i], 10) || args.limit;
      continue;
    }

    if (arg === '--db') {
      args.db = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--targets-file') {
      args.targetsFile = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--max-pages') {
      args.maxPages = Number.parseInt(argv[++i], 10) || args.maxPages;
      continue;
    }

    if (arg === '--loop-delay-ms') {
      args.loopDelayMs = Number.parseInt(argv[++i], 10) || args.loopDelayMs;
      continue;
    }

    if (arg === '--resend-after-hours') {
      const value = Number.parseFloat(argv[++i]);
      if (Number.isFinite(value) && value >= 0) {
        args.resendAfterHours = value;
      }
      continue;
    }

    if (arg === '--compact') {
      args.pretty = false;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '--affiliate-tag') {
      args.affiliateTag = argv[++i] || null;
      continue;
    }

    if (arg === '--deal-of-day') {
      args.promotionTypes.push('deal_of_the_day');
      continue;
    }

    if (arg === '--lightning') {
      args.promotionTypes.push('lightning');
      continue;
    }

    if (arg === '--webhook') {
      args.webhook = argv[++i] || DEFAULT_WEBHOOK_URL;
      continue;
    }

    if (arg === '--no-webhook') {
      args.webhook = null;
      continue;
    }

    if (arg === '--no-affiliate') {
      args.affiliate = false;
      continue;
    }

    if (arg === '--no-loop') {
      args.loop = false;
      continue;
    }

    args.targets.push(arg);
  }

  return args;
}

function getHelpText() {
  return [
    'Uso:',
    '  node fetch-mercadolivre-products.js <url-do-produto-ou-listagem> [outras-urls] [opcoes]',
    '',
    'Opcoes:',
    '  -h, --help                 Exibe esta ajuda',
    '  --cookies <arquivo>       Caminho do arquivo de cookies JSON',
    '  --db <arquivo>            Caminho do banco SQLite local',
    '  --targets-file <arquivo>  Arquivo JSON com categorias, chatid[] e lista de URLs',
    '  --limit <n>               Limite de produtos extraidos de uma listagem',
    '  --max-pages <n>           Maximo de paginas extras buscadas em listagens/ofertas',
    '  --resend-after-hours <n>  Tempo minimo em horas para reenviar a mesma oferta',
    '  --loop-delay-ms <n>       Intervalo entre ciclos do servico em milissegundos',
    '  --compact                 Exibe o JSON sem identacao',
    '  --affiliate-tag <tag>     Forca a tag de afiliado usada na API',
    '  --deal-of-day             Inclui buscas com filtro de Oferta do dia',
    '  --lightning               Inclui buscas com filtro de Oferta relampago',
    '  --webhook <url>           Envia o JSON final para um webhook (desabilitado por padrao)',
    '  --no-webhook              Nao envia o JSON para webhook',
    '  --no-affiliate            Nao gera link meli.la',
    '  --no-loop                 Executa apenas um ciclo e encerra',
    '',
    'Comportamento:',
    '  - URL de produto: extrai os dados do produto e tenta gerar o link afiliado meli.la',
    '  - URL de listagem: descobre produtos da pagina e processa cada um ate o limite definido',
    '  - repeticao de ofertas: um item so pode ser reenviado apos a janela minima configurada (padrao: 48h)',
    '  - modo servico: pausa automaticamente entre 22:00 e 07:00 no horario local da maquina',
    '',
    'Exemplos:',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678"',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/notebook" --limit 3',
    '  node fetch-mercadolivre-products.js --targets-file targets.json --limit 5',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --deal-of-day --limit 10',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --lightning --limit 10',
    '  node fetch-mercadolivre-products.js --targets-file targets.json --deal-of-day --lightning --limit 5',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/ofertas?category=MLB264586" --limit 10 --max-pages 4',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --affiliate-tag sua_tag',
    '  node fetch-mercadolivre-products.js --targets-file targets.json --resend-after-hours 48',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --no-affiliate --compact',
    '  node fetch-mercadolivre-products.js --targets-file targets.json --no-loop',
    `  webhook padrao: ${DEFAULT_WEBHOOK_URL || 'desabilitado'}`,
    `  intervalo padrao entre ciclos: ${DEFAULT_LOOP_DELAY_MS}ms`,
    '',
    'Formato JSON aceito no --targets-file:',
    '  {',
    '    "suplementos": {',
    '      "chatid": ["replace-with-destination-id"],',
    '      "targets": ["https://lista.mercadolivre.com.br/saude/suplementos-alimentares/"]',
    '    }',
    '  }',
  ].join('\n');
}

function readCookies(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`O arquivo de cookies precisa ser um array JSON: ${filePath}`);
  }

  return parsed;
}

function normalizeTargetList(value, category) {
  if (!Array.isArray(value)) {
    throw new Error(`A categoria "${category}" precisa ter uma lista de URLs.`);
  }

  const unique = new Set();
  for (const item of value) {
    const target = typeof item === 'string' ? item.trim() : '';
    if (!target) {
      continue;
    }
    unique.add(target);
  }

  return [...unique];
}

function normalizeChatIds(value, category) {
  if (value == null) {
    return [];
  }

  const rawChatIds = Array.isArray(value) ? value : [value];
  const unique = new Set();

  for (const item of rawChatIds) {
    const chatId = typeof item === 'string' ? item.trim() : '';
    if (!chatId) {
      continue;
    }
    unique.add(chatId);
  }

  if (Array.isArray(value) && rawChatIds.length > 0 && unique.size === 0) {
    throw new Error(`A categoria "${category}" precisa ter um chatid valido em string ou array de strings.`);
  }

  return [...unique];
}

function normalizeTargetGroup(category, config) {
  if (!category) {
    throw new Error('Cada grupo do arquivo JSON precisa ter uma categoria.');
  }

  if (Array.isArray(config)) {
    return {
      category,
      chatIds: [],
      targets: normalizeTargetList(config, category),
    };
  }

  if (!config || typeof config !== 'object') {
    throw new Error(`Configuracao invalida para a categoria "${category}".`);
  }

  const targets = normalizeTargetList(
    config.targets || config.urls || config.links || config.lista,
    category
  );

  return {
    category,
    chatIds: normalizeChatIds(config.chatid, category),
    targets,
  };
}

function readTargetsFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Entrada invalida na posicao ${index} do arquivo ${filePath}.`);
      }

      return normalizeTargetGroup(
        entry.categoria || entry.category,
        {
          chatid: entry.chatid,
          targets: entry.targets || entry.urls || entry.links || entry.lista,
        }
      );
    });
  }

  if (parsed && typeof parsed === 'object') {
    const groupedEntries = parsed.categorias || parsed.categories;
    if (Array.isArray(groupedEntries)) {
      return groupedEntries.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          throw new Error(`Entrada invalida na posicao ${index} do arquivo ${filePath}.`);
        }

        return normalizeTargetGroup(
          entry.categoria || entry.category,
          {
            chatid: entry.chatid,
            targets: entry.targets || entry.urls || entry.links || entry.lista,
          }
        );
      });
    }

    return Object.entries(parsed).map(([category, config]) => normalizeTargetGroup(category, config));
  }

  throw new Error(`O arquivo de targets precisa ser um JSON valido: ${filePath}`);
}

function getSearchVariants(args) {
  const variants = [];
  const orderedPromotionTypes = ['lightning', 'deal_of_the_day'];

  for (const promotionType of orderedPromotionTypes) {
    if (!args.promotionTypes.includes(promotionType)) {
      continue;
    }

    if (PROMOTION_FILTERS[promotionType]) {
      variants.push({ label: promotionType, promotionType });
    }
  }

  variants.push({ label: 'padrao', promotionType: null });
  return variants;
}

module.exports = {
  getHelpText,
  getSearchVariants,
  parseArgs,
  readCookies,
  readTargetsFile,
};
