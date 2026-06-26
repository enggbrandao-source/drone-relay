# Drone Collector Cloud Relay

Servidor WebSocket relay para conectar RC Plus em campo com dashboards remotos.

## Deploy no Render (Gratuito)

1. Crie conta em https://render.com
2. New > Web Service
3. Connect GitHub repo ou upload manual
4. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Port:** 8080 (ou deixe auto)
5. Deploy!

## URLs apos deploy

- **Health:** `https://seu-app.onrender.com/health`
- **Drones online:** `https://seu-app.onrender.com/drones`
- **WebSocket RC Plus:** `wss://seu-app.onrender.com/drone?droneId=AGRAS001`
- **WebSocket Dashboard:** `wss://seu-app.onrender.com/dashboard?droneId=AGRAS001`

## Como usar

### RC Plus (campo)
Conecta em:
```
wss://seu-app.onrender.com/drone?droneId=AGRAS001
```

### Dashboard (gestor remoto)
Conecta em:
```
wss://seu-app.onrender.com/dashboard?droneId=AGRAS001
```

## Variaveis de ambiente

| Var | Padrao | Descricao |
|-----|--------|-----------|
| PORT | 8080 | Porta do servidor |
| JWT_SECRET | agryon-default-secret | Chave JWT da autenticação |
| GOOGLE_MAPS_API_KEY | vazio | Habilita Google Hybrid e Google Satellite no mapa servido pelo backend |

## Teste local

```bash
npm install
npm start
```

Acesse `http://localhost:8080/health`
