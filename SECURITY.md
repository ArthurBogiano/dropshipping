# Segurança

## Versões suportadas

Correções de segurança são aplicadas ao branch `main`.

## Relato responsável

Não publique vulnerabilidades, cookies ou outros segredos em uma issue. Use a opção **Report a vulnerability** na aba **Security** do repositório para enviar um relato privado aos mantenedores.

Inclua uma descrição do impacto, passos mínimos para reprodução e uma sugestão de correção, se houver. Não inclua credenciais reais: use valores revogados ou exemplos.

## Credenciais expostas

Se um cookie, token ou endpoint privado entrar no Git:

1. Revogue ou renove a credencial imediatamente.
2. Remova o dado do branch e do histórico publicado.
3. Verifique logs, forks, caches e artefatos de CI.
4. Execute `npm run audit:public` antes de publicar novamente.
