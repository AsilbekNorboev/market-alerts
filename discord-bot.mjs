import { Client, Events, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { PriceAlerts } from './price-alerts.mjs';

export async function startBot() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!/^\d+$/.test(guildId ?? '')) throw new Error('Set DISCORD_GUILD_ID to your server ID');
  if (process.env.RENDER && !process.env.ALERTS_FILE) throw new Error('Set ALERTS_FILE to a file on a persistent disk');
  const store = new PriceAlerts(process.env.ALERTS_FILE || './data/price-alerts.json');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let latest = null, busy = false, stopped = false;
  const retries = new Map();
  const commands = [
    new SlashCommandBuilder().setName('alert').setDescription('Notify you once when ETH reaches a USD price')
      .addNumberOption(o => o.setName('price').setDescription('ETH price in USD, for example 2300').setRequired(true).setMinValue(0.01).setMaxValue(100000000)),
    new SlashCommandBuilder().setName('alerts').setDescription('List your active ETH price alerts'),
    new SlashCommandBuilder().setName('cancel').setDescription('Cancel one of your ETH price alerts')
      .addStringOption(o => o.setName('id').setDescription('Alert ID shown by /alerts').setRequired(true)),
  ].map(c => c.toJSON());
  client.on(Events.Error, () => console.error('Discord bot connection error'));
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== guildId) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.user.id;
      if (interaction.commandName === 'alert') {
        if (!latest || Date.now() - latest.time > 15000) return await interaction.editReply('ETH prices are temporarily unavailable. Try again shortly.');
        const permissions = interaction.appPermissions;
        const sendPermission = interaction.channel?.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
        if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission])) return await interaction.editReply('Give this bot View Channel and Send Messages permission here first.');
        const row = store.create({ user, guild: guildId, channel: interaction.channelId, price: interaction.options.getNumber('price', true), current: latest.price });
        await interaction.editReply(`Saved alert ${row.id}: ETH ${row.direction === 'up' ? 'at or above' : 'at or below'} $${row.price.toFixed(2)}. I’ll mention you in this channel once it triggers. Current ETH: $${latest.price.toFixed(2)}.`);
      } else if (interaction.commandName === 'alerts') {
        const rows = store.list(user, guildId);
        await interaction.editReply(rows.length ? rows.map(a => `${a.id}: $${a.price.toFixed(2)} ${a.direction === 'up' ? '↑' : '↓'} in <#${a.channel}>${a.pending ? ' (triggered; delivery pending)' : ''}`).join('\n') : 'You have no active ETH price alerts. Use /alert price:2300.');
      } else if (interaction.commandName === 'cancel') {
        const removed = store.cancel(interaction.options.getString('id', true).trim(), user, guildId);
        await interaction.editReply(removed ? 'Alert cancelled.' : 'No matching alert found among your alerts.');
      }
    } catch {
      console.error('Discord command failed');
      const content = 'Could not complete that command. Check /alerts before retrying. You can save up to 25 alerts.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
  async function deliver() {
    if (busy || stopped || !client.isReady()) return;
    busy = true;
    try {
      for (const snapshot of store.rows.filter(a => a.pending && a.guild === guildId)) {
        if (stopped || Date.now() < (retries.get(snapshot.id) || 0)) continue;
        try {
          const channel = await client.channels.fetch(snapshot.channel);
          const a = store.rows.find(a => a.id === snapshot.id);
          if (!a) continue;
          if (!channel?.isTextBased() || !channel.send) throw new Error('Channel unavailable');
          await channel.send({ content: `<@${a.user}> ETH reached your $${a.price.toFixed(2)} target!\nObserved: $${a.pending.price.toFixed(2)} on Coinbase at ${new Date(a.pending.time).toISOString()}\nAlert ${a.id} • one-time alert`, allowedMentions: { parse: [], users: [a.user] } });
          store.delivered(a.id);
          retries.delete(a.id);
          console.log(`Price alert delivered: ${a.id}`);
        } catch {
          retries.set(snapshot.id, Date.now() + 60000);
          console.error(`Price alert delivery failed; retrying: ${snapshot.id}`);
        }
      }
    } finally { busy = false; }
  }
  await client.login(process.env.DISCORD_BOT_TOKEN);
  if (!client.isReady()) await new Promise(resolve => client.once(Events.ClientReady, resolve));
  try {
    const guild = await client.guilds.fetch(guildId);
    for (const command of commands) await guild.commands.create(command);
  } catch (error) { client.destroy(); throw error; }
  console.log('Discord price commands ready: /alert /alerts /cancel');
  const timer = setInterval(() => { void deliver(); }, 5000);
  return {
    tick(price, time) {
      latest = { price, time };
      store.observe(price, time);
      void deliver();
    },
    close() { stopped = true; clearInterval(timer); client.destroy(); },
  };
}
