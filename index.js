const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = process.env.CALENDAR_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

const commands = [
  new SlashCommandBuilder()
    .setName('events')
    .setDescription('Shows upcoming kingdom events')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Slash command registered.');
  } catch (error) {
    console.error(error);
  }
})();

client.on('interactionCreate', async interaction => {

  // When slash command is used
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'events') {

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('week_select')
          .setPlaceholder('Select which week to display')
          .addOptions([
            {
              label: 'Current Week',
              value: 'current',
            },
            {
              label: 'Next Week',
              value: 'next',
            }
          ])
      );

      return interaction.reply({
        content: 'Choose which week you want to view:',
        components: [row],
        ephemeral: true
      });
    }
  }

  // When user selects option
  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === 'week_select') {

      await interaction.deferUpdate();

      const selected = interaction.values[0];

      const now = new Date();
      const currentDay = now.getUTCDay();
      const startOfWeek = new Date(now);
      startOfWeek.setUTCDate(now.getUTCDate() - currentDay);
      startOfWeek.setUTCHours(0,0,0,0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 7);

      let filterStart = startOfWeek;
      let filterEnd = endOfWeek;

      if (selected === 'next') {
        filterStart = new Date(endOfWeek);
        filterEnd = new Date(filterStart);
        filterEnd.setUTCDate(filterStart.getUTCDate() + 7);
      }

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?key=${API_KEY}&timeMin=${filterStart.toISOString()}&timeMax=${filterEnd.toISOString()}&singleEvents=true&orderBy=startTime`;

      try {
        const response = await axios.get(url);
        const events = response.data.items;

        if (!events || events.length === 0) {
          return interaction.editReply({
            content: "No events found for that week.",
            components: []
          });
        }

        const embed = new EmbedBuilder()
          .setColor("#7B2CBF")
          .setTitle(`📅 ${selected === 'current' ? 'Current Week' : 'Next Week'} Events`)
          .setFooter({ text: "Kingdom 3558 • Dates shown in UTC" })
          .setTimestamp();

        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        });

        events.forEach(event => {

          const startRaw = event.start.dateTime || event.start.date;
          const endRaw = event.end?.dateTime || event.end?.date;

          const start = new Date(startRaw);
          const end = endRaw ? new Date(endRaw) : start;

          const startDate = dateFormatter.format(start);
          const endDate = dateFormatter.format(end);

          const durationMs = end - start;
          const durationDays = Math.max(
            1,
            Math.ceil(durationMs / (1000 * 60 * 60 * 24))
          );

          embed.addFields({
            name: `🟣 ${event.summary}`,
            value:
`📆 ${startDate} → ${endDate}
⏳ ${durationDays} Day${durationDays > 1 ? "s" : ""}`,
            inline: false,
          });

        });

        interaction.editReply({
          content: '',
          embeds: [embed],
          components: []
        });

      } catch (error) {
        console.error(error.response?.data || error.message);
        interaction.editReply({
          content: "Error fetching events.",
          components: []
        });
      }
    }
  }
});

client.login(TOKEN);