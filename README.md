# Advanced WA Controller (Baileys + Heroku + Postgres)

A stylish WhatsApp controller using Baileys with:
- QR login + pairing code login
- Send message by target JID
- Auto-message to linked account: `Successfully CONNECTED 📈`
- Heroku-ready deployment
- Heroku Postgres persistence for sessions + logs

## 1) Local run

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## 2) Deploy to Heroku

1. Create Heroku app and attach Postgres add-on.
2. Set config vars:
   - `NODE_ENV=production`
   - `BASE_URL=https://<your-app>.herokuapp.com`
3. Push code to Heroku remote.

The app is fully web-based; after deploy, open the app URL and start linking.

## Notes
- Keep your usage compliant with WhatsApp policies and local laws.
- This project sends plain text payload to JIDs; any JS-like text is sent as text.
