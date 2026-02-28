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
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = process.env.CALENDAR_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`Bot online as ${client.user.tag}`);
});

/* ---------------- SLASH COMMAND ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('events')
    .setDescription('Shows kingdom events'),
  new SlashCommandBuilder()
    .setName('timeline')
    .setDescription('Update variables and view the schedule from Google Sheets')
    .addStringOption(opt => opt.setName('registration_start').setDescription('Set Registration Start (YYYY-MM-DD)'))
    .addStringOption(opt => opt.setName('kvk_start').setDescription('Set Pre-KvK Start Date (YYYY-MM-DD)'))
    .addStringOption(opt => opt.setName('pass_time').setDescription('Set Fixed Pass Time (HH:MM:SS)')),
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

/* ---------------- EMOJI KEYWORD DETECTION ---------------- */

function getEventEmoji(eventName) {

  const name = eventName.toLowerCase();

  if (name.includes("wheel"))
    return "<:WheelOfFortune:1328456453987504240>";
  if (name.includes("mge") || name.includes("greatest estate"))
    return "<:MGE:1328456451999273062>";
  if (name.includes("hammer") || name.includes("more than gems"))
    return "💎";
  if (name.includes("pass"))
    return "⚔️";
  if (name.includes("ruin") || name.includes("altar"))
    return "🏛️";

  return "📅";
}

/* ---------------- GOOGLE SHEETS LOGIC (TIMELINE) ---------------- */

async function getTimelineFromSheets(interaction) {
    const creds = JSON.parse(process.env.GOOGLE_JSON_CREDS);
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['Save the dates'];

    const regStart = interaction.options.getString('registration_start');
    const kvkStart = interaction.options.getString('kvk_start');
    const passTime = interaction.options.getString('pass_time');

    if (regStart || kvkStart || passTime) {
        await sheet.loadCells('C10:C18'); 
        if (regStart) sheet.getCellByA1('C10').value = regStart;
        if (kvkStart) sheet.getCellByA1('C14').value = kvkStart;
        if (passTime) sheet.getCellByA1('C18').value = passTime;
        await sheet.saveUpdatedCells();
    }

    await sheet.loadCells('A26:C40');
    const schedule = [];
    for (let i = 26; i <= 38; i++) {
        const name = sheet.getCell(i, 0).value;
        const date = sheet.getCell(i, 2).formattedValue;
        if (name && date) schedule.push({ name, date });
    }
    return schedule;
}

/* ---------------- INTERACTION HANDLER ---------------- */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // --- NEW TIMELINE LOGIC ---
  if (interaction.commandName === 'timeline') {
    await interaction.deferReply();
    try {
      const data = await getTimelineFromSheets(interaction);
      const embed = new EmbedBuilder()
        .setTitle('⏳ Kingdom Event Timeline')
        .setColor('#FF9900')
        .setFooter({ text: 'Data synced from Google Sheets' })
        .setTimestamp();

      let description = "";
      data.forEach(item => {
        description += `**${item.name}**\n└ 📅 \`${item.date}\`\n\n`;
      });

      embed.setDescription(description || "No events found.");
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply("❌ Error syncing with Google Sheets.");
    }
  }

  // --- ORIGINAL EVENTS LOGIC (UNTOUCHED) ---
  if (interaction.commandName === 'events') {

    await interaction.deferReply();

    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events?key=${API_KEY}&singleEvents=true&orderBy=startTime`;
      const response = await axios.get(url);
      const events = response.data.items;

      if (!events || events.length === 0) {
        return interaction.editReply('No upcoming events found.');
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Upcoming Kingdom Events')
        .setColor('#0099ff')
        .setTimestamp();

      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);

      events.forEach((event) => {

        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;

        const startUTC = new Date(start);
        const endUTC = new Date(end);

        if (endUTC < todayUTC) return;

        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        });

        const startDate = dateFormatter.format(startUTC);
        const endDate = dateFormatter.format(endUTC);

        let durationDays = Math.round(
          (endUTC - startUTC) / (1000 * 60 * 60 * 24)
        ) + 1;

        if (durationDays <= 0) durationDays = 1;

        const diffDays = Math.round(
          (startUTC - todayUTC) / (1000 * 60 * 60 * 24)
        );

        let relativeText = "";
        if (diffDays > 0) {
          relativeText = `Arrives in ${diffDays} day${diffDays > 1 ? "s" : ""}`;
        } else if (diffDays === 0) {
          relativeText = "Starts today";
        } else {
          relativeText = "Already started";
        }

        const emoji = getEventEmoji(event.summary);

        embed.addFields({
          name: `${emoji} ${event.summary}`,
          value:
`➤ ${relativeText}
📆 ${startDate} → ${endDate}
⏳ Event Duration: ${durationDays} day${durationDays > 1 ? "s" : ""}

━━━━━━━━━━━━━━━━━━`,
          inline: false
        });

      });

      interaction.editReply({
        content: '',
        embeds: [embed],
        components: []
      });

    } catch (error) {
      console.error(error);
      interaction.editReply('Error fetching calendar events.');
    }
  }
});

client.login(TOKEN);
