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

/* ---------------- SLASH COMMANDS REGISTRATION ---------------- */

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
    console.log('Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
})();

/* ---------------- EMOJI KEYWORD DETECTION (ORIGINAL) ---------------- */

function getEventEmoji(eventName) {

  const name = eventName.toLowerCase();

  if (name.includes("wheel"))
    return "<:WheelOfFortune:1476403078696534026>";

  if (name.includes("gems"))
    return "<:MorethanGems:1476403357387198677>";

  if (name.includes("olympia"))
    return "<:ChampionsofOlympia:1476403668172537928>";

  if (name.includes("ceroli"))
    return "<:CeroliCrisis:1476402719496474636>";

  if (name.includes("armament"))
    return "<:ArmamentRevealThyself:1476403752880570449>";

  if (name.includes("aoo registration") || name.includes("ark"))
    return "<:AOORegistration:1476403633657479319>";

  if (name.includes("egg") || name.includes("hammer"))
    return "<:EggHammerEvent:1476405511460229162>";

  if (name.includes("governor"))
    return "<:TheMightiestGovernor:1476403439356481596>";

  if (name.includes("strategic"))
    return "<:StrategicReserves:1476403214852161596>";

  if (name.includes("silk"))
    return "<:SilkRoad:1476402527548342453>";

  if (name.includes("karuak"))
    return "<:KaruakCeremony:1476402847615549645>";

  if (name.includes("holy"))
    return "<:HolyKnightsTreasureEggEvent:1476403313368105081>";

  if (name.includes("shadow"))
    return "<:ShadowLegion:1476402579339612293>";

  if (name.includes("ian"))
    return "<:IansBallads:1476403492049522760>";

  if (name.includes("mobilization"))
    return "<:AllianceMobilization:1476402816263389326>";

  return "🟣";
}

/* ---------------- GOOGLE SHEETS LOGIC (NEW) ---------------- */

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

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {

  /* ----- Slash Command Handling ----- */

  if (interaction.isChatInputCommand()) {
    
    // ORIGINAL EVENTS COMMAND
    if (interaction.commandName === 'events') {
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
        ephemeral: true
      });
    }

    // NEW TIMELINE COMMAND
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
  }

  /* ----- Select Menu Handling (ORIGINAL LOGIC) ----- */

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'week_select') {
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

        const titleText = selected === "current" ? "📅 Current Week Events" : "📅 Next Week Events";

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

          const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
          const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

          if (endUTC < todayUTC) return;

          const dateFormatter = new Intl.DateTimeFormat("en-US", {
            month: "long", day: "numeric", timeZone: "UTC",
          });

          const startDate = dateFormatter.format(startUTC);
          const endDate = dateFormatter.format(endUTC);

          let durationDays = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;
          if (durationDays <= 0) durationDays = 1;

          const diffDays = Math.round((startUTC - todayUTC) / (1000 * 60 * 60 * 24));

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
            value: `➤ ${relativeText}\n📆 ${startDate} → ${endDate}\n⏳ Event Duration: ${durationDays} day${durationDays > 1 ? "s" : ""}\n\n━━━━━━━━━━━━━━━━━━`,
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
  }
});

client.login(TOKEN);
