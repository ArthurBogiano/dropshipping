# Dropshipping Mercado Livre

Script em Node.js para coletar produtos do Mercado Livre a partir de URLs de produto, listagens, páginas de ofertas e categorias, gerar links de afiliado `meli.la`, evitar reenvios duplicados com SQLite e enviar o resultado para um webhook.

## O que este projeto faz

- Extrai dados completos de produtos do Mercado Livre.
- Aceita uma URL única ou várias URLs por linha de comando.
- Lê grupos de categorias a partir de um arquivo `JSON`.
- Suporta buscas promocionais com:
  - `Oferta do dia`
  - `Oferta relâmpago`
- Gera links de afiliado via API do Mercado Livre.
- Deduplica produtos já enviados usando SQLite, com janela mínima para reenvio.
- Envia o payload final para um webhook.
- Respeita delays aleatórios entre requisições para reduzir bloqueios.

## Estrutura do projeto

```text
.
├─ fetch-mercadolivre-products.js   # Script principal
├─ targets.json                     # Exemplo/configuração de categorias e URLs
├─ cookies.json                     # Cookies exportados do navegador
├─ mercadolivre-products.sqlite     # Banco local para deduplicação
└─ .gitignore
```

## Requisitos

- Node.js `22+`
  - O projeto usa `node:sqlite`, disponível nas versões recentes do Node.
- Acesso à internet
- Um arquivo `cookies.json` válido exportado do navegador

## Instalação

Como o projeto usa apenas módulos nativos do Node, não há `package.json` nem dependências externas para instalar.

1. Clone ou copie este repositório.
2. Instale o Node.js `22` ou superior.
3. Coloque seu arquivo de cookies em `cookies.json` na raiz do projeto.
4. Ajuste o `targets.json` se quiser trabalhar com múltiplas categorias.

Para validar se o Node está disponível:

```bash
node --version
```

## Como funciona

O script recebe targets por linha de comando ou por `--targets-file`.

Para cada target, ele:

1. Identifica se a URL é de produto ou de listagem/categoria/ofertas.
2. Busca a página HTML usando os cookies informados.
3. Descobre os produtos da listagem, quando aplicável.
4. Extrai os dados estruturados do produto.
5. Tenta gerar o link de afiliado.
6. Ignora itens enviados dentro da janela mínima de reenvio com base em uma chave de deduplicação.
7. Monta um payload JSON.
8. Envia o resultado para um webhook.
9. Marca os produtos enviados no banco SQLite.

## Uso básico

### 1. Processar uma página de produto

```bash
node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678"
```

### 2. Processar uma listagem

```bash
node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/notebook" --limit 3
```

### 3. Processar múltiplas categorias via arquivo

```bash
node fetch-mercadolivre-products.js --targets-file targets.json --limit 5
```

### 4. Buscar promoções

```bash
node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --deal-of-day --limit 10
```

```bash
node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --lightning --limit 10
```

### 5. Desabilitar webhook

```bash
node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/notebook" --no-webhook
```

### 6. Desabilitar link de afiliado

```bash
node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --no-affiliate
```

## Opções disponíveis

| Opção | Descrição |
| --- | --- |
| `-h`, `--help` | Exibe a ajuda do script |
| `--cookies <arquivo>` | Caminho do arquivo de cookies JSON |
| `--db <arquivo>` | Caminho do banco SQLite |
| `--targets-file <arquivo>` | Arquivo JSON com categorias, chatid e URLs |
| `--limit <n>` | Limite de produtos extraídos por listagem |
| `--max-pages <n>` | Máximo de páginas extras buscadas em listagens/ofertas |
| `--resend-after-hours <n>` | Horas mínimas para a mesma oferta poder ser enviada de novo |
| `--compact` | Desliga a identação do JSON |
| `--affiliate-tag <tag>` | Força a tag de afiliado usada na API |
| `--deal-of-day` | Ativa busca por Oferta do dia |
| `--lightning` | Ativa busca por Oferta relâmpago |
| `--webhook <url>` | Define um webhook customizado |
| `--no-webhook` | Não envia o JSON para webhook |
| `--no-affiliate` | Não gera link `meli.la` |

## Arquivo de cookies

O script espera que `cookies.json` seja um array JSON, normalmente exportado por alguma extensão de navegador.

Exemplo simplificado:

```json
[
  {
    "domain": ".mercadolivre.com.br",
    "hostOnly": false,
    "httpOnly": false,
    "name": "orgnickp",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "value": "sua_tag"
  }
]
```

Observações:

- Cookies expirados são ignorados.
- Apenas cookies compatíveis com domínio/path da URL são enviados.
- Se o cookie `orgnickp` existir, ele pode ser usado como tag de afiliado padrão.

## Arquivo `targets.json`

O projeto aceita diferentes formatos, mas o formato atual usado no repositório é este:

```json
{
  "fitness": {
    "chatid": "replace-with-destination-id",
    "targets": [
      "https://lista.mercadolivre.com.br/saude/suplementos-alimentares/"
    ]
  },
  "pets": {
    "chatid": "replace-with-destination-id",
    "targets": [
      "https://www.mercadolivre.com.br/c/animais"
    ]
  }
}
```

Cada grupo contém:

- `chatid`: identificador que segue junto no payload.
- `targets`: lista de URLs que serão processadas.

Também são aceitas chaves alternativas como `urls`, `links` e `lista`.

## Banco SQLite

O arquivo padrão é `mercadolivre-products.sqlite`.

Ele é usado para registrar produtos já enviados e evitar duplicação entre execuções.

Tabela criada automaticamente:

- `sent_products`

Campos principais:

- `dedupe_key`
- `item_id`
- `canonical_url`
- `title`
- `source_target`
- `webhook_url`
- `first_sent_at`
- `last_sent_at`
- `last_seen_at`

Regra de deduplicação:

- O script usa, nesta ordem:
  - `itemId`
  - `canonicalUrl`
  - `requestedUrl`
- O reenvio só é liberado depois da janela configurada em `--resend-after-hours`.
- O valor padrão atual é `48` horas.

## Payload enviado ao webhook

O payload base enviado para cada target contém:

```json
{
  "ok": true,
  "cookiesFile": "caminho/do/cookies.json",
  "dbFile": "caminho/do/sqlite",
  "generatedAt": "2026-04-02T00:00:00.000Z",
  "categoria": "fitness",
  "chatid": "replace-with-destination-id",
  "requestedTarget": "https://lista.mercadolivre.com.br/...",
  "totalProducts": 3,
  "products": [],
  "results": []
}
```

Cada produto pode incluir informações como:

- `itemId`
- `title`
- `description`
- `canonicalUrl`
- `price.amount`
- `price.originalAmount`
- `price.currency`
- `price.installments`
- `price.shipping`
- `images`
- `highlightedFeatures`
- `specifications`
- `seller`
- `affiliate`
- `stock`
- `rating`
- `reviewsPreview`
- `breadcrumbs`

## Webhook

Por padrão, o script envia para:

```text
https://example.com/webhook
```

Você pode trocar isso com:

```bash
node fetch-mercadolivre-products.js --targets-file targets.json --webhook "https://seu-endpoint.com/webhook"
```

Se quiser apenas testar a coleta sem envio:

```bash
node fetch-mercadolivre-products.js --targets-file targets.json --no-webhook
```

## Comportamento de rede

O script aplica atrasos aleatórios entre requisições:

- Listagens: entre `3` e `5` minutos
- Produtos: entre `5` e `10` segundos

Também há retry automático para erros temporários, como:

- `403`
- `408`
- `429`
- `5xx`

Isso ajuda a reduzir bloqueios e falhas intermitentes.

## Logs

Durante a execução, o script escreve logs no terminal com os prefixos:

- `[info]`
- `[warn]`
- `[error]`

Os logs mostram, por exemplo:

- arquivo de cookies carregado
- caminho do SQLite
- categoria atual
- target processado
- quantidade de produtos novos
- duplicados ignorados
- status do webhook

## Limitações e cuidados

- O projeto depende da estrutura HTML atual do Mercado Livre; mudanças no site podem quebrar a extração.
- Cookies inválidos ou expirados podem causar páginas incompletas, bloqueios ou falhas na geração de afiliado.
- O arquivo `cookies.json` pode conter dados sensíveis e não deve ser versionado publicamente.
- O webhook é obrigatório no fluxo padrão; com `--no-webhook`, o script encerra sem marcar itens como enviados.
- Como há delays intencionais, execuções grandes podem demorar bastante.

## Exemplos úteis

```bash
node fetch-mercadolivre-products.js --targets-file targets.json --deal-of-day --lightning --limit 5
```

```bash
node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/ofertas?category=MLB264586" --limit 10 --max-pages 4
```

```bash
node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --affiliate-tag sua_tag --compact
```

## Troubleshooting

### O script diz que não encontrou produto

Possíveis causas:

- URL inválida
- página protegida/bloqueada
- HTML mudou
- cookies desatualizados

### O webhook falha

Verifique:

- se a URL está correta
- se o endpoint aceita `POST` com `application/json`
- se houve resposta HTTP `4xx` ou `5xx`

### Nenhum produto novo aparece

Pode ser que:

- os produtos já estejam registrados no SQLite
- a listagem não tenha itens extraíveis
- o limite esteja muito baixo

## Segurança

Recomendações:

- Adicione `cookies.json` ao `.gitignore` se ele for pessoal.
- Não compartilhe o banco SQLite se ele contiver histórico operacional sensível.
- Revise o webhook padrão antes de usar em produção.

## Melhorias futuras sugeridas

- Criar `package.json` com scripts de execução.
- Adicionar suporte a variáveis de ambiente.
- Salvar payloads localmente para debug.
- Criar testes para os extratores HTML.
- Exportar resultados também para arquivo `.json`.

## Arquivo principal

Se quiser começar pelo código, o ponto de entrada é [fetch-mercadolivre-products.js](/c:/Users/Pichau/Desktop/dropshipping/fetch-mercadolivre-products.js).
## Estrutura atual

- `fetch-mercadolivre-products.js` ficou apenas como bootstrap da CLI.
- `lib/run.js` concentra a orquestracao principal.
- `lib/collector.js` cuida do fluxo de coleta por target.
- `lib/product-parser.js` concentra a extracao de dados do HTML.
- `lib/network.js`, `lib/storage.js`, `lib/cookies.js`, `lib/cli.js` e `lib/constants.js` separam infraestrutura e utilitarios.
## Modo servico

O script agora roda em loop continuo por padrao, pensado para uso com `pm2`. Ao concluir um ciclo completo da lista de targets, ele espera `60000ms` e reinicia automaticamente.

No modo servico, o loop tambem entra em pausa automaticamente entre `22:00` e `07:00`, usando o horario local da maquina onde o processo estiver rodando. Se o processo iniciar dentro dessa janela, ele aguarda ate `07:00` antes de comecar um novo ciclo.

Use `--no-loop` quando quiser executar apenas uma vez e encerrar.

Tambem foi adicionada a opcao `--loop-delay-ms <n>` para controlar o intervalo entre ciclos.

### Exemplos com PM2

```bash
pm2 start fetch-mercadolivre-products.js --name mercadolivre-dropshipping -- --targets-file targets.json
```

```bash
pm2 start fetch-mercadolivre-products.js --name mercadolivre-dropshipping -- --targets-file targets.json --loop-delay-ms 120000
```

```bash
pm2 start fetch-mercadolivre-products.js --name mercadolivre-dropshipping -- --targets-file targets.json --no-loop
```
