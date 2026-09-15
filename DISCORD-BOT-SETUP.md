# Enable Discord price commands

The existing rapid-move webhook alerts keep working without a bot token. The bot adds:

- `/alert price:2300`: save a one-time ETH/USD target in this channel. If ETH is currently above the target, wait for at-or-below; if below, wait for at-or-above.
- `/alerts`: privately list your active alerts and their IDs.
- `/cancel id:xxxxxxxx`: cancel your own alert.

When triggered, the bot mentions you in the original channel. Each member can save 25 alerts. Commands are restricted to the configured server. A fresh Coinbase trade is required to create an alert.

## 1. Create and invite the bot

1. Visit https://discord.com/developers/applications and select **New Application**. Name it **Market Alerts**.
2. Open **Bot**, create the bot if prompted, and use **Reset Token** to obtain its token. Keep this token private; enter it directly in Render, not GitHub or chat. No privileged gateway intents are needed.
3. Under **OAuth2 → URL Generator**, select scopes **bot** and **applications.commands**.
4. Select bot permissions **View Channels**, **Send Messages**, and **Send Messages in Threads** if you use threads. Administrator permission is unnecessary.
5. Open the generated URL, choose your server, and authorize it. Check that the bot has access to your alert channel, including any private-channel overrides.
6. In Discord's **User Settings → Advanced**, enable **Developer Mode**. Right-click your server icon → **Copy Server ID**.

## 2. Add persistent storage to the existing Render worker

In Render, open **market-alerts → Disks → Add Disk**:

- Name: `price-alerts`
- Mount path: `/var/data`
- Size: `1 GB`

Review Render's additional disk charge before saving. Only files on this mount survive restarts and deployments. Keep one worker instance. This disk is configured manually, so the repository update does not automatically purchase storage.

## 3. Enable the bot

Under the worker's **Environment**, add these variables and choose **Save and deploy**:

| Key | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | Token from the Bot page |
| `DISCORD_GUILD_ID` | Your copied server ID |
| `ALERTS_FILE` | `/var/data/price-alerts.json` |

Keep the existing webhook and rapid-move settings. The process registers commands automatically after login; no application ID or interactions endpoint is required. The log should include `Discord price commands ready: /alert /alerts /cancel` and the Coinbase connection message.

## 4. Try it

In your Discord alert channel, type `/alert`, choose the command from **Market Alerts**, and enter `2300` for price. You should receive a private confirmation. Run `/alerts` to see the saved entry. To remove it, run `/cancel` and enter its ID.

## Behavior and limits

Targets and triggered-but-unsent notifications are saved to disk. Failed sends retry approximately once a minute. A crash after Discord accepts a message but before its removal is saved can duplicate a notification. Cancelling cannot recall a notification already being sent.

The first fresh price after a restart can trigger an alert if it is already beyond the target. Moves that cross and reverse entirely during downtime can be missed. This uses Coinbase spot ETH/USD. Each target fires once; create another alert to watch it again. Rapid-move cooldowns do not apply to these price targets.

References: https://discordjs.guide/legacy/app-creation/deploying-commands and https://render.com/docs/disks
