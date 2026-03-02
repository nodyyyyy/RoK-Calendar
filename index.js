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
    .setDescription('Select sheet and update timeline'),

  new SlashCommandBuilder()
    .setName('create_event')
    .setDescription('Crear un evento personalizado'),

  new SlashCommandBuilder()
    .setName('delete_event')
    .setDescription('Eliminar un evento (solo administradores)')
    .addStringOption(option => 
      option.setName('message_id')
        .setDescription('ID del mensaje del evento a eliminar')
        .setRequired(true)
    )
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

   // ────────────────────────────────────────────────
  //               CUSTOM EVENT FEATURES (ENGLISH)
  // ────────────────────────────────────────────────

  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database('custom_events.db');

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS events (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT,
      event_name TEXT,
      event_time TEXT,
      reminder_sent INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS signups (
      message_id TEXT,
      user_id TEXT,
      status TEXT CHECK(status IN ('yes','no')),
      PRIMARY KEY (message_id, user_id)
    )`);
  });

  if (interaction.isChatInputCommand() && interaction.commandName === 'create_event') {
    const modal = new ModalBuilder()
      .setCustomId('create_event_modal')
      .setTitle('Create Custom Event');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_name')
          .setLabel('Event Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_date')
          .setLabel('Date (DD-MM-YYYY)')
          .setPlaceholder('25-12-2025')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_time')
          .setLabel('Time (HH:MM) UTC')
          .setPlaceholder('18:00')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'create_event_modal') {
    await interaction.deferReply();

    const eventName = interaction.fields.getTextInputValue('event_name');
    const dateStr = interaction.fields.getTextInputValue('event_date');
    const timeStr = interaction.fields.getTextInputValue('event_time');

    let eventDate;
    try {
      const [dd, mm, yyyy] = dateStr.split('-').map(Number);
      const [hh, min] = timeStr.split(':').map(Number);
      eventDate = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, 0));
      if (isNaN(eventDate.getTime())) throw new Error();
    } catch {
      return interaction.editReply('Invalid date/time format. Use DD-MM-YYYY and HH:MM (UTC).');
    }

    const reminderTime = new Date(eventDate);
    reminderTime.setMinutes(reminderTime.getMinutes() - 15);

    const embed = new EmbedBuilder()
      .setColor('#7B2CBF')
      .setTitle(eventName)
      .setDescription(`${eventDate.toUTCString().split(' GMT')[0]}\n\u200b`)
      .setFooter({ text: `Kingdom 3558 • UTC • Event ID: ${interaction.id}` })
      .setImage('https://media.discordapp.net/attachments/1388282858723999914/1435074927240810597/ChatGPT_Image_3_nov_2025_22_05_09.png?format=webp&quality=lossless')
      .addFields(
        { name: '✅ Attending (0)', value: '\u200b', inline: true },
        { name: '❌ Not Attending (0)', value: '\u200b', inline: true }
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('attend_yes')
          .setLabel('✅')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('attend_no')
          .setLabel('❌')
          .setStyle(ButtonStyle.Secondary)
      );

    const msg = await interaction.editReply({ embeds: [embed], components: [row] }).catch(console.error);

    if (msg) {
      db.run(
        `INSERT INTO events (message_id, channel_id, event_name, event_time) VALUES (?, ?, ?, ?)`,
        [msg.id, msg.channel.id, eventName, eventDate.toISOString()],
        (err) => { if (err) console.error('DB insert error:', err); }
      );
    }
  }

  // Button handler
  if (interaction.isButton()) {
    const customId = interaction.customId;
    let status;
    if (customId === 'attend_yes') status = 'yes';
    if (customId === 'attend_no') status = 'no';
    if (!status) return;

    await interaction.deferUpdate().catch(console.error);

    db.run(
      `INSERT OR REPLACE INTO signups (message_id, user_id, status) VALUES (?, ?, ?)`,
      [interaction.message.id, interaction.user.id, status],
      (err) => {
        if (err) return console.error('Signup error:', err);

        db.all(
          `SELECT status, COUNT(*) as count, GROUP_CONCAT(user_id) as users 
           FROM signups WHERE message_id = ? GROUP BY status`,
          [interaction.message.id],
          async (err, rows) => {
            if (err) return console.error('Fetch signups error:', err);

            const yes = rows.find(r => r.status === 'yes') || { count: 0, users: '' };
            const no  = rows.find(r => r.status === 'no')  || { count: 0, users: '' };

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
              .spliceFields(0, 2,
                { name: `✅ Attending (${yes.count})`, value: yes.users ? yes.users.split(',').map(id => `<@${id}>`).join('\n') || '\u200b' : '\u200b', inline: true },
                { name: `❌ Not Attending (${no.count})`, value: no.users ? no.users.split(',').map(id => `<@${id}>`).join('\n') || '\u200b' : '\u200b', inline: true }
              );

            await interaction.editReply({ embeds: [embed] }).catch(console.error);
          }
        );
      }
    );
  }

  // delete_event command
  if (interaction.isChatInputCommand() && interaction.commandName === 'delete_event') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
    }

    const messageId = interaction.options.getString('message_id');

    db.get(`SELECT channel_id FROM events WHERE message_id = ?`, [messageId], async (err, row) => {
      if (err || !row) {
        return interaction.reply({ content: 'Event not found or already deleted.', ephemeral: true });
      }

      try {
        const channel = await client.channels.fetch(row.channel_id);
        const message = await channel.messages.fetch(messageId);
        await message.delete().catch(() => {});

        db.run(`DELETE FROM events WHERE message_id = ?`, [messageId]);
        db.run(`DELETE FROM signups WHERE message_id = ?`, [messageId]);

        await interaction.reply({ content: `Event with ID ${messageId} deleted successfully.`, ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: 'Could not delete the message (maybe already deleted).', ephemeral: true });
      }
    });
  }

  // Reminder checker (every 30 seconds)
  setInterval(() => {
    const now = new Date().toISOString();

    db.all(`SELECT * FROM events WHERE reminder_sent = 0`, (err, rows) => {
      if (err) return console.error('Reminder query error:', err);

      for (const ev of rows) {
        const eventTime = new Date(ev.event_time);
        const reminderTime = new Date(eventTime);
        reminderTime.setMinutes(reminderTime.getMinutes() - 15);

        if (new Date() >= reminderTime && new Date() < eventTime) {
          client.channels.fetch(ev.channel_id)
            .then(channel => channel.messages.fetch(ev.message_id))
            .then(async msg => {
              const thread = await msg.startThread({ name: `Event: ${ev.event_name}` }).catch(() => null);
              if (thread) {
                await thread.send(`@everyone **Reminder!** The event **${ev.event_name}** starts in 15 minutes!`).catch(console.error);
              }
              db.run(`UPDATE events SET reminder_sent = 1 WHERE message_id = ?`, [ev.message_id]);
            })
            .catch(console.error);
        }
      }
    });
  }, 30000);

});

client.login(TOKEN);
