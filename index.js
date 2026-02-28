const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = process.env.CALENDAR_ID;

/* ---------------- SPREADSHEETS CONFIG ---------------- */

const SPREADSHEETS = {
  HA: {
    id: "1ETPuRl5QPvjAwx4wLPgMHUxoeveauXECW_v7gVRSW84",
    startRow: 25,
    endRow: 33,
    labelCol: 1,
    dateCol: 3
  },
  Tides: {
    id: "1RGWGVNzcP5Q9br9K95dpKbnMuVKdJ41KdYkhX407WbY",
    startRow: 25,
    endRow: 30,
    labelCol: 1,
    dateCol: 3
  }
};

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
    .setDescription('Select sheet and update timeline')
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

  /* -------- TIMELINE -------- */

  if (interaction.isChatInputCommand() && interaction.commandName === 'timeline') {

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('timeline_sheet_select')
        .setPlaceholder('Select Spreadsheet')
        .addOptions([
          { label: 'HA', value: 'HA' },
          { label: 'Tides', value: 'Tides' }
        ])
    );

    return interaction.reply({
      content: "Select which spreadsheet to update:",
      components: [row],
      flags: 64
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'timeline_sheet_select') {

    const selectedSheet = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`timeline_modal_${selectedSheet}`)
      .setTitle(`Update Timeline (${selectedSheet})`);

    const dateInput = new TextInputBuilder()
      .setCustomId('date1')
      .setLabel('Registration start date (DD-MM-YYYY)')
      .setPlaceholder('Example: 25-12-2026')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId('time')
      .setLabel('Pass opening time (HH:MM:SS)')
      .setPlaceholder('Example: 18:00:00')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(timeInput)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("timeline_modal_")) {

    await interaction.deferReply();

    const selectedSheetKey = interaction.customId.split("_")[2];
    const config = SPREADSHEETS[selectedSheetKey];

    const date1 = interaction.fields.getTextInputValue("date1");
    const time = interaction.fields.getTextInputValue("time");

    try {

      const auth = new GoogleAuth({
        credentials: GOOGLE_SERVICE_ACCOUNT,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const doc = new GoogleSpreadsheet(config.id);
      doc.auth = auth;

      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['Save the dates'];

      await sheet.loadCells(['D10', 'D19']);
      await sheet.loadCells(`B${config.startRow}:F${config.endRow}`);

      sheet.getCellByA1('D10').value = date1;
      sheet.getCellByA1('D19').value = time;

      await sheet.saveUpdatedCells();

      const embed = new EmbedBuilder()
        .setColor("#7B2CBF")
        .setTitle(`📅 Timeline Results (${selectedSheetKey})`)
        .setFooter({ text: "Kingdom 3558 • UTC" })
        .setTimestamp();

      for (let row = config.startRow - 1; row <= config.endRow - 1; row++) {

        const label = sheet.getCell(row, config.labelCol)?.formattedValue;
        const dateValue = sheet.getCell(row, config.dateCol)?.formattedValue;

        if (!label || !dateValue) continue;

        embed.addFields({
          name: `${getEventEmoji(label)} ${label}`,
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

  /* -------- EVENTS -------- */

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

  if (interaction.isStringSelectMenu() && interaction.customId === 'week_select') {

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

        const startUTC = new Date(Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate()
        ));

        const endUTC = new Date(Date.UTC(
          end.getUTCFullYear(),
          end.getUTCMonth(),
          end.getUTCDate()
        ));

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
      console.error(error.response?.data || error.message);
      interaction.editReply({
        content: "Error fetching events.",
        components: []
      });
    }
  }
});

client.login(TOKEN);
