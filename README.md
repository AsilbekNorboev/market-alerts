# Market alerts

Continuously monitors Coinbase ETH/USD spot trades and sends Discord webhook alerts for moves up or down of at least 0.5% within a rolling 60-second window. No exchange API key or npm dependencies required.

The latest price is compared with every observed price within the window, so moves shorter than a minute and across minute boundaries count. Each direction has a five-minute cooldown after successful delivery.

## Deploy on Render

1. In Render, select **New → Blueprint**, connect this repository, and select `main`.
2. Render reads `render.yaml` and proposes one paid background worker (0.5 CPU, 512 MB). Review its displayed cost.
3. Enter your Discord channel webhook for `ETH_DISCORD_WEBHOOK_URL` when prompted, then deploy.
4. Open Logs and look for `Connected; threshold 0.5% within 60s; Discord enabled`.
5. In the worker's Shell, run `npm run test-alert` to send one test message.

If you already created a worker manually, use this repository with runtime Node, build command `npm ci && npm test`, start command `npm start`, and one instance. Set `NODE_VERSION=24.14.1` and the variables from `.env.example` in Render's Environment settings. Do not create a second worker for the same alerts.

Keep your webhook in Render's environment settings or a local ignored `.env` file. Never commit it. Configuration uses percentages and seconds: `ETH_ALERT_PERCENT=0.5`, `ETH_ALERT_WINDOW_SECONDS=60`, `ETH_ALERT_COOLDOWN_SECONDS=300`.

## Local usage

Requires Node.js 22 or newer. Copy `.env.example` to `.env.eth-alert.local` and fill in the webhook.

```sh
npm ci
npm test
npm run dry-run
node --env-file=.env.eth-alert.local eth-discord-alert.mjs --test-alert
node --env-file=.env.eth-alert.local eth-discord-alert.mjs
```

Dry-run prints qualifying alerts without sending Discord messages. Stop with Ctrl+C.

## Operational details

The monitor reconnects automatically and clears price history on disconnection or a trade gap longer than 15 seconds. Stale ticks are ignored. Failed Discord requests back off and retry only on fresh qualifying ticks; failures do not consume the normal alert cooldown. Network timeouts can occasionally cause duplicate delivery.

Restarting clears history and cooldowns. Downtime can miss moves. Run only one instance. Coinbase spot prices can differ from perpetuals prices. Discord push notifications depend on your channel and device settings.
