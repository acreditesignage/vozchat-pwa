# VozChat — PWA com chat, fotos, vídeos e mensagens de voz

Aplicativo instalável para iPhone, Android e computador. Chat em tempo real via Server-Sent Events (SSE), envio de textos e áudios com `MediaRecorder`, conversas privadas por convite, conta com senha e histórico persistente.

## Executar localmente

Requisitos: Node.js 20 ou superior. Nenhuma dependência externa.

```bash
npm start
```

Acesse http://localhost:3000 em seu computador. Crie duas contas em navegadores diferentes para testar as mensagens em tempo real. O microfone funciona em `localhost` ou em um endereço com HTTPS.

## Publicar no Railway

1. Crie um repositório para estes arquivos; crie um serviço independente no Railway a partir dele (Dockerfile detectado automaticamente).
2. Defina a variável `DATA_DIR=/data`.
3. Anexe um Railway Volume no caminho `/data` para manter contas, conversas e áudios após reinícios/deploys.
4. Gere um domínio HTTPS no Railway e use-o para instalar o PWA e utilizar o microfone nos celulares.
5. Use **uma instância** do serviço. O banco JSON e os eventos SSE não são adequados para múltiplas réplicas sem banco externo e pub/sub.

## Funcionalidades

- Login/cadastro com senha protegida por `scrypt` e sessão em cookie `HttpOnly, SameSite=Strict, Secure` sobre HTTPS.
- Convites por link aleatório longo; acesso a mensagens e áudios restrito aos membros da conversa.
- Mensagens de texto e áudio entregues em tempo real, histórico salvo no diretório de dados.
- Gravação no navegador, player nativo, cancelamento de gravação, duração máxima 90 segundos, 12 MB por áudio.
- Botão **+**: abrir câmera do celular, escolher imagens, vídeos ou documentos; até cinco arquivos por envio e 25 MB por arquivo.
- Pré-visualização antes do envio, fotos e vídeos exibidos na conversa, anexos para download apenas por participantes.
- Seletor de emojis incorporado à barra de mensagem.
- Layout responsivo, instalação como PWA, shell disponível offline (envio requer rede).
- API de saúde `/api/health`.

## Limitações e cuidados

- Arquivos passam por validação de extensão e MIME, mas **não há antivírus automático**. Não abra anexos suspeitos.
- **Não possui criptografia de ponta a ponta**. O operador do servidor pode acessar conteúdo armazenado.
- Convites são portadores de acesso: qualquer pessoa com o link pode entrar, então compartilhe somente com participantes confiáveis.
- Não usar para dados clínicos sensíveis sem revisão de segurança, controle granular de acesso, auditoria, retenção, LGPD e adequação operacional.
- Banco JSON local é indicado para **piloto e equipe pequena**. Para escalar, migrar para PostgreSQL, storage de objetos, fila/pubsub e antispam.
- O app não envia notificações push em segundo plano. SSE entrega mensagens em tempo real enquanto a página está aberta.
- O armazenamento precisa de volume persistente; sem isso os dados podem sumir ao republicar.

## Testes

```bash
npm test
```

`tests/smoke.test.js` faz um fluxo real de cadastro, conversa, convite, mensagens, autorização e áudio.

### Atalho para Windows

Depois de extrair o ZIP, dê duplo clique em `iniciar-windows.bat` (com Node.js instalado). Uma janela do servidor abrirá e o navegador será iniciado em `http://localhost:3000`.

## Publicar no Render (teste)

1. Crie um repositório dedicado no GitHub e envie os arquivos desta pasta para a raiz dele.
2. No Render, use New > Blueprint e selecione esse repositório, ou New > Web Service (runtime Node, build: `npm install --omit=dev`, start: `npm start`).
3. O arquivo `render.yaml` define o serviço gratuito e `/api/health` para teste.
4. **Aviso:** no serviço Free, o banco JSON e os áudios no disco local **não são persistentes**. Contas, áudios e mensagens podem ser perdidos após reinício/redeploy. Use somente para demonstração até implementar banco e storage duráveis.
5. Não usar para mensagens médicas ou prontuários sem revisão de privacidade e segurança.