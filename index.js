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
const { GoogleAuth } = require('google-auth-library');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = process.env.CALENDAR_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

/* ---------------- GOOGLE SERVICE ACCOUNT ---------------- */

let GOOGLE_SERVICE_ACCOUNT;

if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT missing.");
  process.exit(1);
}

try {
  GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ Invalid GOOGLE_SERVICE_ACCOUNT JSON:", err.message);
  process.exit(1);
}

/* ---------------- DISCORD CLIENT ---------------- */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('events')
    .setDescription('Shows kingdom events'),

  new SlashCommandBuilder()
    .setName('timeline')
    .setDescription('Updates timeline dates and returns calculated results')
    .addStringOption(option =>
      option.setName('date1')
        .setDescription('Date for D10 (DD-MM-YYYY)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('date2')
        .setDescription('Date for D14 (DD-MM-YYYY)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time for D19 (HH:MM:SS)')
        .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
})();

/* ---------------- EMOJI DETECTION ---------------- */

function getEventEmoji(eventName) {

  const name = eventName.toLowerCase();

  if (name.includes("wheel")) return "<:WheelOfFortune:1476403078696534026>";
  if (name.includes("gems")) return "<:MorethanGems:1476403357387198677>";
  if (name.includes("olympia")) return "<:ChampionsofOlympia:1476403668172537928>";
  if (name.includes("ceroli")) return "<:CeroliCrisis:1476402719496474636>";
  if (name.includes("armament")) return "<:ArmamentRevealThyself:1476403752880570449>";
  if (name.includes("aoo registration") || name.includes("ark")) return "<:AOORegistration:1476403633657479319>";
  if (name.includes("egg") || name.includes("hammer")) return "<:EggHammerEvent:1476405511460229162>";
  if (name.includes("governor")) return "<:TheMightiestGovernor:1476403439356481596>";
  if (name.includes("strategic")) return "<:StrategicReserves:1476403214852161596>";
  if (name.includes("silk")) return "<:SilkRoad:1476402527548342453>";
  if (name.includes("karuak")) return "<:KaruakCeremony:1476402847615549645>";
  if (name.includes("holy")) return "<:HolyKnightsTreasureEggEvent:1476403313368105081>";
  if (name.includes("shadow")) return "<:ShadowLegion:1476402579339612293>";
  if (name.includes("ian")) return "<:IansBallads:1476403492049522760>";
  if (name.includes("mobilization")) return "<:AllianceMobilization:1476402816263389326>";

  return "🟣";
}

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {

  /* ---------------- TIMELINE ---------------- */

  if (interaction.isChatInputCommand() && interaction.commandName === 'timeline') {

    await interaction.deferReply();

    const date1 = interaction.options.getString('date1');
    const date2 = interaction.options.getString('date2');
    const time = interaction.options.getString('time');

    try {

      const auth = new GoogleAuth({
        credentials: GOOGLE_SERVICE_ACCOUNT,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
      doc.auth = auth;

      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['Save the dates'];

      if (!sheet) {
        return interaction.editReply("❌ Sheet 'Save the dates' not found.");
      }

      await sheet.loadCells('D10:D19');
      await sheet.loadCells('B26:F34');

      sheet.getCellByA1('D10').value = date1;
      sheet.getCellByA1('D14').value = date2;
      sheet.getCellByA1('D19').value = time;

      await sheet.saveUpdatedCells();

      const embed = new EmbedBuilder()
        .setColor("#7B2CBF")
        .setTitle("📅 Timeline Results")
        .setFooter({ text: "Kingdom 3558 • UTC" })
        .setTimestamp();

      for (let row = 25; row <= 33; row++) {

        const label = sheet.getCell(row, 1)?.value; // B
        const dateValue = sheet.getCell(row, 5)?.value; // F

        if (!label || !dateValue) continue;

        embed.addFields({
          name: `🟣 ${label}`,
          value: `📆 ${dateValue}\n\n━━━━━━━━━━━━━━━━━━`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      await interaction.editReply("❌ Error updating timeline.");
    }
  }

  /* ---------------- EVENTS COMMAND ---------------- */

  if (interaction.isChatInputCommand() && interaction.commandName === 'events') {

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('week_select')
        .setPlaceholder('Select week')
        .addOptions([
          { label: 'Current Week', value: 'current' },
          { label: 'Next Week', value: 'next' }
        ])
    );

    return interaction.reply({
      content: 'Select which week to display:',
      components: [row],
      flags: 64
    });
  }

  /* ---------------- SELECT MENU ---------------- */

  if (interaction.isStringSelectMenu()) {

    await interaction.deferUpdate();

    const selected = interaction.values[0];

    const now = new Date();
    const todayUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));

    const day = todayUTC.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const startOfWeek = new Date(todayUTC);
    startOfWeek.setUTCDate(todayUTC.getUTCDate() + diffToMonday);

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

      const titleText =
        selected === "current"
          ? "📅 Current Week Events"
          : "📅 Next Week Events";

      const embed = new EmbedBuilder()
        .setColor("#7B2CBF")
        .setTitle(titleText)
        .setFooter({ text: "Kingdom 3558 • UTC" })
        .setTimestamp();

      events.forEach(event => {

        let start = new Date(event.start.dateTime || event.start.date);
        let end = new Date(event.end.dateTime || event.end.date);

        if (event.start.date && event.end.date) {
          end.setUTCDate(end.getUTCDate() - 1);
        }

        if (end < todayUTC) return;

        const emoji = getEventEmoji(event.summary);

        embed.addFields({
          name: `${emoji} ${event.summary}`,
          value: `📆 ${start.toDateString()} → ${end.toDateString()}\n\n━━━━━━━━━━━━━━━━━━`,
          inline: false
        });

      });

      await interaction.editReply({
        embeds: [embed],
        components: []
      });

    } catch (error) {
      console.error(error.response?.data || error.message);
      await interaction.editReply("Error fetching events.");
    }
  }
});

client.login(TOKEN);
