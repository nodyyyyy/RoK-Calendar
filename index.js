const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder 
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
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'events') {

    await interaction.deferReply();

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?key=${API_KEY}&timeMin=${new Date().toISOString()}&singleEvents=true&orderBy=startTime`;

    try {
      const response = await axios.get(url);
      const events = response.data.items.slice(0, 5);

      if (!events || events.length === 0) {
        return interaction.editReply("There are no upcoming events.");
      }

      const embed = new EmbedBuilder()
        .setColor("#7B2CBF")
        .setTitle("📅 Upcoming Events")
        .setFooter({ text: "Kingdom 3558 • Times shown in UTC" })
        .setTimestamp();

      events.forEach(event => {

        const startRaw = event.start.dateTime || event.start.date;
        const endRaw = event.end?.dateTime || event.end?.date;

        const start = new Date(startRaw);
        const end = endRaw ? new Date(endRaw) : start;

        const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          timeZone: "UTC",
        });

        const startWeekday = weekdayFormatter.format(start);
        const endWeekday = weekdayFormatter.format(end);

        const durationMs = end - start;
        const durationDays = Math.max(
          1,
          Math.ceil(durationMs / (1000 * 60 * 60 * 24))
        );

        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        });

        const startTime = event.start.dateTime
          ? timeFormatter.format(start)
          : "All Day";

        embed.addFields({
          name: `🟣 ${event.summary}`,
          value:
`📆 ${startWeekday} → ${endWeekday}
⏳ ${durationDays} Day${durationDays > 1 ? "s" : ""}
🕒 Starts: ${startTime} UTC`,
          inline: false,
        });

      });

      interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error(error.response?.data || error.message);
      interaction.editReply("Error fetching calendar events.");
    }
  }
});

client.login(TOKEN);
