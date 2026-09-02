# Mercado Livre Offer Collector

[![CI](https://github.com/ArthurBogiano/dropshipping/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurBogiano/dropshipping/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Coletor e automatizador em Node.js para descobrir ofertas do Mercado Livre, extrair dados estruturados de produtos, gerar links de afiliado e entregar os resultados a um webhook.

O projeto não possui dependências de produção: usa APIs nativas do Node.js, incluindo `fetch`, `worker_threads` e `node:sqlite`.

> Este é um projeto independente e não oficial. Ele não é afiliado, patrocinado ou mantido pelo Mercado Livre. Use-o de forma responsável e respeite os termos, limites e políticas da plataforma.

## Recursos

- Coleta URLs de produto, páginas de busca, categorias e ofertas.
- Processa grupos de categorias em workers separados.
- Serializa as requisições de rede entre workers e aplica intervalos configuráveis.
- Lê dados de produto em JSON-LD e complementa com informações da página.
- Tenta gerar links curtos pelo programa de afiliados quando há credenciais válidas.
- Evita reenvios com deduplicação persistida em SQLite.
- Suporta execução única ou serviço contínuo com horário de silêncio.
- Envia um payload JSON a qualquer webhook ou imprime o resultado localmente.
- Mantém cookies, destinos, banco e variáveis locais fora do Git.

## Requisitos

- Node.js 22.5 ou mais recente.
- Uma conta e cookies válidos do Mercado Livre apenas para os recursos que exigirem autenticação.
- Acesso à internet.

## Início rápido

```bash
git clone https://github.com/ArthurBogiano/dropshipping.git
cd dropshipping
npm install
```

Crie as configurações locais a partir dos exemplos:

```bash
cp .env.example .env
cp cookies.example.json cookies.json
cp targets.example.json targets.json
```

No PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item cookies.example.json cookies.json
Copy-Item targets.example.json targets.json
```

Edite os três arquivos copiados. Os arquivos reais `.env`, `cookies.json` e `targets.json` são ignorados pelo Git.

Para executar uma única coleta sem enviar dados a terceiros:

```bash
node fetch-mercadolivre-products.js --targets-file targets.json --no-webhook --no-loop
```

## Configuração

A aplicação carrega `.env` automaticamente. Variáveis já definidas no ambiente têm prioridade. Consulte [`.env.example`](.env.example) para ver todos os valores disponíveis.

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `WEBHOOK_URL` | desabilitado | Destino HTTP do payload final |
| `COOKIES_FILE` | `cookies.json` | Arquivo local de cookies |
| `TARGETS_FILE` | não definido | Arquivo local de categorias e URLs |
| `DB_FILE` | `mercadolivre-products.sqlite` | Banco local de deduplicação |
| `AFFILIATE_TAG` | cookie `orgnickp` | Tag usada na geração de link afiliado |
| `PRODUCT_LIMIT` | `5` | Produtos novos por busca |
| `MAX_PAGES` | `5` | Páginas examinadas por listagem |
| `REQUEST_TIMEOUT_MS` | `30000` | Timeout de cada requisição HTTP |
| `RESEND_AFTER_HOURS` | `48` | Janela mínima antes de reenviar um item |
| `LOOP_ENABLED` | `true` | Ativa o serviço contínuo |
| `LOOP_DELAY_MS` | `60000` | Intervalo entre ciclos |
| `QUIET_HOURS_ENABLED` | `true` | Ativa a pausa por horário |
| `QUIET_HOURS_START` / `END` | `22` / `7` | Início e fim do horário de silêncio |
| `QUIET_HOURS_TIMEZONE` | `America/Sao_Paulo` | Fuso IANA usado no agendamento |

Os delays de listagem/produto e as tentativas HTTP também podem ser alterados no `.env.example`.

### Cookies

Exporte os cookies do navegador como um array JSON e salve em `cookies.json`. A estrutura esperada está em [`cookies.example.json`](cookies.example.json).

```json
[
  {
    "domain": ".mercadolivre.com.br",
    "name": "replace-with-cookie-name",
    "path": "/",
    "secure": true,
    "session": true,
    "value": "replace-with-cookie-value"
  }
]
```

Cookies expirados ou incompatíveis com o domínio, caminho e protocolo da URL não são enviados. Trate esse arquivo como uma credencial: não compartilhe nem faça commit.

### Targets

Cada grupo de `targets.json` define uma categoria, uma lista opcional de destinos e uma lista de URLs:

```json
{
  "tecnologia": {
    "chatid": ["replace-with-destination-id"],
    "targets": ["https://lista.mercadolivre.com.br/notebook"]
  }
}
```

Veja [`targets.example.json`](targets.example.json) para um exemplo completo. Também são aceitas as chaves `urls`, `links` ou `lista` no lugar de `targets`.

## Uso

```bash
# Uma URL de produto
node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --no-loop

# Uma listagem, limitada a três produtos
node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/notebook" --limit 3 --no-loop

# Grupos definidos em arquivo
node fetch-mercadolivre-products.js --targets-file targets.json --limit 5

# Ofertas do dia e relâmpago
node fetch-mercadolivre-products.js --targets-file targets.json --deal-of-day --lightning

# Saída local compacta, sem webhook ou link afiliado
node fetch-mercadolivre-products.js --targets-file targets.json --no-webhook --no-affiliate --compact --no-loop
```

Use `node fetch-mercadolivre-products.js --help` para consultar todas as opções. Argumentos de linha de comando substituem os padrões do ambiente.

## Payload

O webhook recebe um objeto por target. Caminhos locais e cookies nunca são incluídos:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "categoria": "tecnologia",
  "chatid": ["replace-with-destination-id"],
  "requestedTarget": "https://lista.mercadolivre.com.br/notebook",
  "totalProducts": 1,
  "products": [],
  "results": []
}
```

Os produtos podem conter identificação, título, descrição, preço, imagens, especificações, vendedor, estoque, avaliação, frete e dados do link afiliado.

## Arquitetura

```text
CLI / .env / JSON
        |
        v
orquestrador principal
        |
        +-- worker por categoria
              |
              +-- fila global de rede
              +-- parser de listagem e produto
              +-- gerador de link afiliado
              +-- deduplicação SQLite
              +-- webhook ou saída padrão
```

O banco cria as tabelas `sent_products` e `webhook_deliveries`. Arquivos `*.sqlite`, `*.db` e seus auxiliares são sempre ignorados pelo Git.

## Desenvolvimento

```bash
npm run check
npm test
npm run audit:public
npm run ci
```

Os testes usam apenas o runner nativo `node:test`. O workflow de CI executa a suíte nas versões 22 e 24 do Node.js.

Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar alterações e [SECURITY.md](SECURITY.md) para relatar vulnerabilidades ou exposição de credenciais.

## Licença

Distribuído sob a licença [MIT](LICENSE).
