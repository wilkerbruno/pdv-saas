# PDV SaaS

PDV (ponto de venda) multi-loja em modelo SaaS, para lojas de rua (roupas, decoração, brinquedos, acessórios…).
O lojista paga mensalidade; cada loja é um *tenant* isolado por `tenantId`.

```
apps/
  api/     NestJS + Prisma + MySQL 8   (regras de negócio, pagamentos, assinatura)
  web/     React + Vite (PWA)          (painel/PDV de balcão; instalável no celular)
  mobile/  Expo (React Native)         (PDV no celular com leitor de código de barras)
```

## Rodando

```bash
cp .env.example .env            # preencha JWT_SECRET e ENCRYPTION_KEY (openssl rand -hex 32)
docker compose up --build       # MySQL + API (:3000) + Web (:8080)
```
Com `SEED_DEMO=1` é criada a loja demo: **demo@pdv.local / demo12345** (3 variações de camiseta com código de barras).

Sem Docker: suba um MySQL, copie `apps/api/.env.example` para `.env` e rode em `apps/api`:
`npm install && npx prisma migrate dev --name init && npm run seed && npm run start:dev`; depois `npm install && npm run dev` em `apps/web`.

> **Faça uma vez:** `npx prisma migrate dev --name init` em `apps/api` gera a migration inicial. Faça commit da pasta
> `prisma/migrations`. Enquanto ela não existir, o container usa `prisma db push` (serve para testar, não para produção).

## O que já existe (marco 1)

- **SaaS:** cadastro da loja com 14 dias de teste, planos (`basic`, `pro`, `multi`), bloqueio por inadimplência
  (tolerância de 5 dias → 10 dias somente leitura → bloqueio total; configurável em `common/access.ts`).
- **Catálogo:** produtos com variações (tamanho/cor), código de barras/SKU, categorias, dados fiscais (NCM/CFOP/CSOSN).
- **Estoque:** movimentações com baixa atômica (duas vendas simultâneas não vendem o mesmo item), alerta de estoque baixo.
- **Caixa:** abertura, sangria, suprimento, fechamento com diferença.
- **Venda:** vários pagamentos por venda (dinheiro + PIX + cartão…), desconto, vale-troca, cancelamento com devolução ao estoque, recibo não fiscal.
- **Parcelamento com juros:** política por loja (parcelas sem juros, juros ao mês, parcela mínima, quem absorve). O PDV
  mostra a parcela e o total com juros, e a **maquininha recebe o valor já com juros**. Tabela Price em centavos.
- **Pagamentos** (`PaymentProvider`, um driver por adquirente):

  | Driver | Estado |
  |---|---|
  | `MANUAL` (dinheiro, "cliente pagou na maquininha") | pronto |
  | `MERCADOPAGO_PIX` (QR Code dinâmico, reconhecimento por webhook/polling) | escrito, **não testado contra o Mercado Pago** |
  | `MERCADOPAGO_POINT` (API de Orders) | escrito, **não testado numa maquininha real** |
  | `PAGARME_STONE` (Connect Stone) | reservado, **não implementado** (ver comentários no arquivo) |

## Antes de ir para produção

1. **Homologar o Mercado Pago** (Point e PIX): os corpos de requisição seguem a documentação da API de Orders, mas
   precisam ser validados com transações reais de teste (`payments/providers/mercadopago-*.ts`). Conectar a loja hoje
   é por *Access Token* colado em `PUT /integrations/mercadopago`; o fluxo **OAuth** (loja autoriza e o dinheiro cai na
   conta dela) é o próximo passo. Configure o webhook do app para `POST {PUBLIC_API_URL}/payments/webhook/mercadopago`
   e preencha `MP_WEBHOOK_SECRET`.
2. **Pagar.me/Stone:** exige ativação do Connect Stone, terminais Stone e **não tem ambiente de testes**. Estorno não
   tem rota de API (feito no POS/portal). Implementar após a ativação.
3. **Estorno de pagamento aprovado em maquininha/PIX** é manual no adquirente; o cancelamento da venda devolve estoque
   e avisa (`manualRefundNeeded`) quais pagamentos precisam ser estornados.
4. **Cobrança da mensalidade:** o webhook `/billing/webhook/:gateway` ainda só confirma o recebimento. Falta ligar o
   gateway de assinaturas e chamar `BillingService.markPaid()`.
5. **Fiscal (NFC-e/NF-e):** ainda não implementado. Plano: adaptador de provedor (Focus NFe, NFe.io ou Tecnospeed),
   ligado/desligado por loja (`Tenant.fiscalEnabled`), certificado A1 enviado pela loja. Hoje só há recibo **sem valor fiscal**.
6. **Tap to Pay no celular:** no Mercado Pago funciona dentro do app do próprio Mercado Pago (o operador cobra lá e o
   PDV recebe o webhook). Não há SDK para embutir o toque neste app.
7. Limitar tentativas (rate limit/CAPTCHA) em `/auth/login` e `/auth/register`, que são públicos.
8. Modo offline, etiquetas, impressão térmica (ESC/POS), relatórios e painel super-admin ainda não foram feitos.

## Verificação feita nesta etapa

- `apps/api`: 37 testes (juros, acesso por assinatura, plano de pagamentos, criptografia, assinatura de webhook e
  a fiação completa do app com guards/perfis/validação usando um banco falso). `tsc` limpo.
- `apps/web`: compila, build de produção ok e teste em navegador contra uma API simulada.
- `apps/mobile`: `tsc` limpo; **não executado** em aparelho/emulador.
- **Não verificado:** nada que dependa do MySQL real (queries Prisma, migrations, seed) — o ambiente onde isto foi
  escrito bloqueia o download dos binários do Prisma. O primeiro `docker compose up` / `prisma migrate dev` é o teste real.


## Marco 2 — Mercado Pago OAuth e nota fiscal (NFC-e)

### Conectar o Mercado Pago por autorização (OAuth)
1. Crie um app em mercadopago.com.br/developers e cadastre a Redirect URI `<PUBLIC_API_URL>/integrations/mercadopago/oauth/callback`.
2. Preencha `MP_CLIENT_ID`, `MP_CLIENT_SECRET` (e `WEB_URL`) no `.env`.
3. No PDV: Configurações → Conectar com Mercado Pago. O token é renovado sozinho (vence em ~180 dias). Sem `MP_CLIENT_ID`, a tela cai para colar o Access Token manualmente.
Usa PKCE; `MP_OAUTH_PKCE=false` desliga caso o app não aceite.

### NFC-e (via Focus NFe)
- Cadastre a empresa no Focus NFe com certificado A1 e CSC, gere o token da empresa e informe em Configurações → Nota fiscal.
- Comece em **Homologação**; só depois mude para Produção. Disponível em planos com fiscal.
- Só Simples Nacional (CSOSN 102, 103, 300, 400). Cada produto precisa de NCM.
- Emissão automática ao pagar; CPF/CNPJ na nota opcional; cancelamento em até ~30 min.
- A confirmar: código de pagamento do PIX (17) na homologação; tratamento de juros de parcelamento nas notas (a nota usa o valor principal) — consulte seu contador. Contingência offline não implementada.

### Ainda não verificado contra sistemas reais
Mercado Pago Point/PIX/OAuth, Focus NFe, Prisma/MySQL e o app Expo foram escritos conforme a documentação, mas não executados. Pagar.me/Stone ainda não implementado.

### Mensalidade (cobrança do SaaS)
PIX gerado na conta Mercado Pago **da plataforma** (`PLATFORM_MP_ACCESS_TOKEN`). O dono paga em Configurações → Assinatura (ou na tela de conta bloqueada). O webhook `/billing/webhook/mercadopago` confere o pagamento na API, valida valor e referência e estende o período em 30 dias, uma única vez por cobrança. Cobrança é manual por ciclo (sem débito automático); o PIX vale 1 h. Configure o webhook de "Pagamentos" no painel do app da plataforma. Não testado com o Mercado Pago real.

## Painel de administração da plataforma

Tela exclusiva do dono do SaaS para controlar planos e assinaturas (menu **Administração**).

1. Defina `PLATFORM_ADMIN_EMAILS=seu@email.com` (vários separados por vírgula) na API e reinicie.
2. Crie/entre com uma conta com esse e-mail (ex.: cadastre-se normalmente pela tela de login). Só esses e-mails veem o menu e acessam `/admin/*` (a API reconfere a cada chamada).
3. Abas: **Resumo** (MRR, recebido em 30 dias, lojas por status, testes acabando), **Assinaturas** (buscar/filtrar lojas; mudar status, plano, fim do teste, pago até, NFC-e; suspender/reativar/cancelar; liberar N dias por pagamento manual ou cortesia), **Planos** (criar/editar preço, limites, recursos e disponibilidade; planos não são apagados, apenas desativados), **Cobranças** (faturas PIX).
4. Toda ação é registrada na tabela `AdminAction` (auditoria) e mostrada no histórico da loja. Mudanças valem na hora (o cache de acesso é invalidado).

Após atualizar, aplique o schema (nova tabela `AdminAction`): `npx prisma db push` (o entrypoint do Docker já faz isso se estiver configurado assim).
