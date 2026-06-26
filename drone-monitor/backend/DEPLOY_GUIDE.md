# Guia de Deploy no Render.com - Drone Collector Cloud Relay

## Passo 1: Criar conta no Render

1. Acesse https://render.com
2. Clique em **Sign Up** (canto superior direito)
3. Escolha **Sign up with GitHub** (mais fácil) ou use email
4. Confirme seu email

---

## Passo 2: Criar repositório no GitHub (ou usar upload direto)

### Opção A - GitHub (recomendado):

1. Acesse https://github.com/new
2. **Repository name:** `drone-collector-relay`
3. **Visibility:** Public (gratuito) ou Private
4. Clique **Create repository**

### Opção B - Upload direto no Render (sem GitHub):

Pule para o Passo 3 - o Render permite upload de código diretamente.

---

## Passo 3: Preparar os arquivos

Crie uma pasta no seu PC com ESTES 2 arquivos EXATOS:

```
drone-relay/
├── server.js
└── package.json
```

Os arquivos estão em:
- `C:\Users\Home\.verdent\verdent-projects\quero-que-voc-desenvolva\drone-monitor\backend\server.js`
- `C:\Users\Home\.verdent\verdent-projects\quero-que-voc-desenvolva\drone-monitor\backend\package.json`

Copie os 2 arquivos para uma pasta nova chamada `drone-relay`.

---

## Passo 4: Fazer upload para o Render

### Se usar GitHub:

1. Na pasta `drone-relay`, crie um arquivo `README.md` (pode estar vazio)
2. Abra PowerShell na pasta:
   ```powershell
   cd C:\Users\Home\Desktop\drone-relay
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/drone-collector-relay.git
   git push -u origin main
   ```
3. No Render, clique **New +** → **Web Service**
4. Conecte sua conta GitHub
5. Selecione o repositório `drone-collector-relay`

### Se usar upload direto (sem GitHub):

1. No Render, clique **New +** → **Web Service**
2. Role até o final e clique em **Deploy from a Git repository** (ou similar)
3. Ou use **Blueprint** para upload manual

---

## Passo 5: Configurar o serviço no Render

Preencha os campos:

| Campo | Valor |
|-------|-------|
| **Name** | `drone-relay` (ou qualquer nome) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | `Free` |

Clique em **Create Web Service**.

### Variáveis de ambiente recomendadas

Após criar o serviço, abra **Environment** no Render e configure:

| Variável | Obrigatória | Uso |
|----------|-------------|-----|
| `JWT_SECRET` | Sim | Assinatura dos tokens do app |
| `GOOGLE_MAPS_API_KEY` | Sim para Google Hybrid | Ativa as camadas `Google Hybrid` e `Google Satellite` |
| `VITE_GOOGLE_MAPS_API_KEY` | Sim no web-dashboard React | Ativa Google Hybrid no dashboard React |

Se o `GOOGLE_MAPS_API_KEY` não estiver configurado, o mapa usará `Esri World Imagery` como fallback.

---

## Passo 6: Aguardar o deploy

O Render vai:
1. Instalar dependências (`npm install`)
2. Iniciar o servidor (`npm start`)
3. Gerar uma URL pública

Aguarde 2-3 minutos até ver **"Your service is live"**.

---

## Passo 7: Anotar a URL do serviço

A URL será algo como:
```
https://drone-relay.onrender.com
```

Ou:
```
https://drone-collector-relay.onrender.com
```

**Anote esta URL** - ela será usada no app e no dashboard.

---

## Passo 8: Testar o serviço

No navegador, acesse:
```
https://SUA-URL.onrender.com/health
```

Deve retornar:
```json
{"status":"ok","drones":0,"uptime":123}
```

---

## Passo 9: Atualizar o Drone Collector

No arquivo `CloudRelayManager.kt`, atualize a URL:

```kotlin
const val DEFAULT_RELAY_URL = "wss://SUA-URL.onrender.com/drone"
```

Exemplo real:
```kotlin
const val DEFAULT_RELAY_URL = "wss://drone-relay-abc123.onrender.com/drone"
```

Recompile o APK.

---

## Passo 10: Atualizar o Dashboard

No arquivo `index.html`, atualize a URL:

```javascript
const CLOUD_RELAY_URL = 'wss://SUA-URL.onrender.com/dashboard';
```

---

## URLs finais após deploy

| Função | URL |
|--------|-----|
| Health check | `https://SUA-URL.onrender.com/health` |
| Lista de drones | `https://SUA-URL.onrender.com/drones` |
| RC Plus conecta em | `wss://SUA-URL.onrender.com/drone?droneId=AGRAS001` |
| Dashboard conecta em | `wss://SUA-URL.onrender.com/dashboard?droneId=AGRAS001` |

---

## Troubleshooting

### "Build failed"
- Verifique se `package.json` e `server.js` estão na raiz do repositório
- Verifique se o Build Command está `npm install`

### "Service crashed"
- Verifique os logs no Render (aba Logs)
- Confirme que a porta está sendo lida de `process.env.PORT`

### "Cannot connect from dashboard"
- Render Free tem cold start (demora ~30s para "acordar" após inatividade)
- Aguarde 1 minuto após o primeiro acesso

---

## Limitações do plano Free

- Cold start de ~30 segundos após inatividade
- Conexão WebSocket fecha após 15 minutos de inatividade
- Reconexão automática no app resolve isso

---

## Alternativa: VPS pago (mais estável)

Se precisar de uptime 24/7 sem cold start:
- DigitalOcean Droplet: $4/mês
- AWS Lightsail: $3.50/mês
- Hetzner: €3.29/mês

Instale Node.js e rode:
```bash
npm install
npm start
```

Use PM2 para manter rodando:
```bash
npm install -g pm2
pm2 start server.js
pm2 startup
pm2 save
```
