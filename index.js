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
const GUILD_ID = process.env.GUILD_ID; // For instant slash command registration
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
    .setDescription('Shows upcoming calendar events')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Register command (Guild-based = instant update)
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

      if (events.length === 0) {
        return interaction.editReply("There are no upcoming events.");
      }

      const embed = new EmbedBuilder()
        .setTitle("📅 UPCOMING EVENTS")
        .setColor(0x9b59b6)
        .setImage("https://media.discordapp.net/attachments/1357180816899309692/1435630017358074010/ChatGPT_Image_3_nov_2025_22_05_09.png?ex=699f00a4&is=699daf24&hm=0788ec778daafc1cdc1a10b2f3a993fd00abde6146c204c3a4598eb0d5286c60&=&format=webp&quality=lossless&width=1690&height=1126")
        .setFooter({ text: "Kingdom 3558" })
        .setTimestamp();

      events.forEach(event => {
        const start = event.start.dateTime || event.start.date;

        const formattedDate = new Date(start).toLocaleString("en-GB", {
          timeZone: "UTC",
          dateStyle: "medium",
          timeStyle: "short"
        });

        embed.addFields({
          name: `🗓 ${event.summary}`,
          value: `🕒 ${formattedDate} (UTC)`,
          inline: false
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