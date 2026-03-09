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
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');
const { Pool } = require('pg');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = process.env.CALENDAR_ID;

/* ---------------- POSTGRESQL ---------------- */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT,
      event_name TEXT,
      event_time TIMESTAMPTZ,
      reminder_sent INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signups (
      message_id TEXT,
      user_id TEXT,
      status TEXT CHECK(status IN ('yes','no')),
      PRIMARY KEY (message_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminder_events (
      id SERIAL PRIMARY KEY,
      channel_id TEXT,
      role_id TEXT,
      event_name TEXT,
      event_time TIMESTAMPTZ,
      reminder_minutes INTEGER,
      reminder_sent INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_event_messages (
      id SERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE
    )
  `);
  console.log('✅ PostgreSQL tables ready.');
}

/* ===== LIVE EVENTS SYSTEM ===== */

let liveEventMessages = [];

async function buildLiveEventsEmbed() {

  const now = new Date();
  const todayUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  const day = todayUTC.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  // Current week: Mon to Sun
  const startOfCurrentWeek = new Date(todayUTC);
  startOfCurrentWeek.setUTCDate(todayUTC.getUTCDate() + diffToMonday);

  const endOfCurrentWeek = new Date(startOfCurrentWeek);
  endOfCurrentWeek.setUTCDate(startOfCurrentWeek.getUTCDate() + 7);

  // Next week: Mon to Sun
  const startOfNextWeek = new Date(endOfCurrentWeek);
  const endOfNextWeek = new Date(startOfNextWeek);
  endOfNextWeek.setUTCDate(startOfNextWeek.getUTCDate() + 7);

  // Single API call fetching both weeks
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`
    + `?key=${API_KEY}`
    + `&timeMin=${startOfCurrentWeek.toISOString()}`
    + `&timeMax=${endOfNextWeek.toISOString()}`
    + `&singleEvents=true&orderBy=startTime`;

  const response = await axios.get(url);
  const allEvents = response.data.items;

  const headerFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC"
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", timeZone: "UTC"
  });

  const embed = new EmbedBuilder()
    .setColor("#7B2CBF")
    .setTitle("📅  Kingdom 3558 — Events")
    .setDescription("🟣 Upcoming  ·  🟢 Today  ·  🔵 In Progress")
    .setFooter({ text: "Kingdom 3558  •  UTC  •  Auto-updates every hour" })
    .setTimestamp();

  function addEventFields(events) {
    let added = 0;
    events.forEach(event => {
      let start = new Date(event.start.dateTime || event.start.date);
      let end   = new Date(event.end.dateTime   || event.end.date);

      if (event.start.date && event.end.date) {
        end.setUTCDate(end.getUTCDate() - 1);
      }

      const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const endUTC   = new Date(Date.UTC(end.getUTCFullYear(),   end.getUTCMonth(),   end.getUTCDate()));

      if (endUTC < todayUTC) return;

      let durationDays = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;
      if (durationDays <= 0) durationDays = 1;

      const diffDays = Math.round((startUTC - todayUTC) / (1000 * 60 * 60 * 24));

      const relativeText = diffDays > 0
        ? `Arrives in ${diffDays} day${diffDays > 1 ? "s" : ""}`
        : diffDays === 0 ? "Starts today" : "Already started";

      const statusBadge = diffDays > 0 ? "🟣 **UPCOMING**" : diffDays === 0 ? "🟢 **TODAY**" : "🔵 **IN PROGRESS**";
      const emoji = getEventEmoji(event.summary);

      embed.addFields({
        name: `${emoji}  ${event.summary}`,
        value: `${statusBadge}  ·  ➤ ${relativeText}
┣ 📆  ${dateFormatter.format(startUTC)}  →  ${dateFormatter.format(endUTC)}
┗ ⏳  ${durationDays} day${durationDays > 1 ? "s" : ""}
`,
        inline: false
      });
      added++;
    });
    return added;
  }

  const currentWeekEvents = allEvents.filter(ev => {
    const start = new Date(ev.start.dateTime || ev.start.date);
    return start < endOfCurrentWeek;
  });

  const nextWeekEvents = allEvents.filter(ev => {
    const start = new Date(ev.start.dateTime || ev.start.date);
    return start >= startOfNextWeek;
  });

  const cwEnd = new Date(endOfCurrentWeek.getTime() - 1);
  const nwEnd = new Date(endOfNextWeek.getTime() - 1);

  embed.addFields({
    name: `📆  Current Week  —  ${headerFormatter.format(startOfCurrentWeek)} – ${headerFormatter.format(cwEnd)}`,
    value: "\u200b",
    inline: false
  });

  const currentAdded = addEventFields(currentWeekEvents);
  if (currentAdded === 0) {
    embed.addFields({ name: "\u200b", value: "*No events remaining this week.*\n\u200b", inline: false });
  }

  embed.addFields({
    name: "━━━━━━━━━━━━━━━━━━━━━━━━",
    value: "\u200b",
    inline: false
  });

  embed.addFields({
    name: `📆  Next Week  —  ${headerFormatter.format(startOfNextWeek)} – ${headerFormatter.format(nwEnd)}`,
    value: "\u200b",
    inline: false
  });

  const nextAdded = addEventFields(nextWeekEvents);
  if (nextAdded === 0) {
    embed.addFields({ name: "\u200b", value: "*No events scheduled for next week.*\n\u200b", inline: false });
  }

  return embed;
}

/* ===== END LIVE EVENTS SYSTEM ===== */

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

client.once('clientReady', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  await initDB();

  // Restore live event messages from DB so auto-updates survive restarts
  try {
    const { rows } = await pool.query(`SELECT channel_id, message_id FROM live_event_messages`);
    liveEventMessages = rows.map(r => ({ channelId: r.channel_id, messageId: r.message_id }));
    console.log(`🔄 Restored ${liveEventMessages.length} live event message(s) from DB.`);
  } catch (err) {
    console.error('Failed to restore live event messages:', err.message);
  }

  startReminderChecker();
  scheduleDailyAnnouncement();
});

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('events')
    .setDescription('Show this week\'s or next week\'s kingdom events from the calendar'),

  new SlashCommandBuilder()
    .setName('timeline')
    .setDescription('Update the KvK registration dates and pass times in a spreadsheet'),

  new SlashCommandBuilder()
    .setName('create_event')
    .setDescription('Create a standard or reminder event'),

  new SlashCommandBuilder()
    .setName('delete_event')
    .setDescription('Delete a standard event or reminder (admins only)'),
  
  new SlashCommandBuilder()
    .setName('live_events')
    .setDescription('Post a live embed that auto-updates every hour with the weekly calendar'),

  new SlashCommandBuilder()
    .setName('my_events')
    .setDescription('View all active sign-up events and pending reminders'),

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

/* ---------------- REMINDER CHECKER ---------------- */

function startReminderChecker() {
  setInterval(async () => {
    const now = new Date();

    // ── Standard events: 15-min thread reminder ──
    try {
      const { rows } = await pool.query(`SELECT * FROM events WHERE reminder_sent = 0`);

      for (const ev of rows) {
        const eventTime = new Date(ev.event_time);
        const reminderTime = new Date(eventTime.getTime() - 15 * 60 * 1000);

        if (now >= reminderTime && now < eventTime) {
          try {
            const channel = await client.channels.fetch(ev.channel_id);
            const msg = await channel.messages.fetch(ev.message_id);
            const thread = await msg.startThread({ name: `Event: ${ev.event_name}` }).catch(() => null);
            if (thread) {
              await thread.send(`@everyone **Reminder!** The event **${ev.event_name}** starts in 15 minutes!`).catch(console.error);
            }
            await pool.query(`UPDATE events SET reminder_sent = 1 WHERE message_id = $1`, [ev.message_id]);
          } catch (e) {
            console.error('Standard reminder error:', e.message);
          }
        }
      }
    } catch (err) {
      console.error('Standard reminder query error:', err.message);
    }

    // ── Reminder events: role mention + embed ──
    try {
      const { rows } = await pool.query(`SELECT * FROM reminder_events WHERE reminder_sent = 0`);

      for (const ev of rows) {
        const eventTime = new Date(ev.event_time);
        const reminderTime = new Date(eventTime.getTime() - ev.reminder_minutes * 60 * 1000);

        if (now >= reminderTime && now < eventTime) {
          try {
            const channel = await client.channels.fetch(ev.channel_id);

            const embed = new EmbedBuilder()
              .setColor('#7B2CBF')
              .setTitle(ev.event_name)
              .setDescription(`📅 <t:${Math.floor(eventTime.getTime() / 1000)}:F>\n⏰ Starting <t:${Math.floor(eventTime.getTime() / 1000)}:R>\n\u200b`)
              .setFooter({ text: 'Kingdom 3558 • UTC' })
              .setImage('https://media.discordapp.net/attachments/1388282858723999914/1435074927240810597/ChatGPT_Image_3_nov_2025_22_05_09.png?format=webp&quality=lossless');

            const advanceText = ev.reminder_minutes >= 60
              ? `${Math.floor(ev.reminder_minutes / 60)}h ${ev.reminder_minutes % 60 > 0 ? `${ev.reminder_minutes % 60}m` : ''}`.trim()
              : `${ev.reminder_minutes} minute${ev.reminder_minutes !== 1 ? 's' : ''}`;

            await channel.send({
              content: `<@&${ev.role_id}> 🔔 **Reminder!** The event **${ev.event_name}** starts in **${advanceText}**!`,
              embeds: [embed]
            });

            await pool.query(`UPDATE reminder_events SET reminder_sent = 1 WHERE id = $1`, [ev.id]);
          } catch (e) {
            console.error('Role reminder error:', e.message);
          }
        }
      }
    } catch (err) {
      console.error('Role reminder query error:', err.message);
    }

  }, 30000);
}

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {

  /* ===== LIVE EVENTS COMMAND ===== */

  if (interaction.isChatInputCommand() && interaction.commandName === 'live_events') {

    await interaction.deferReply();

    try {

      const embed = await buildLiveEventsEmbed();

      const msg = await interaction.editReply({
        embeds: [embed]
      });

      liveEventMessages.push({
        channelId: msg.channel.id,
        messageId: msg.id
      });

      // Persist to DB so auto-updates survive restarts
      await pool.query(
        `INSERT INTO live_event_messages (channel_id, message_id) VALUES ($1, $2) ON CONFLICT (message_id) DO NOTHING`,
        [msg.channel.id, msg.id]
      ).catch(err => console.error('Failed to persist live event message:', err.message));

    } catch (err) {
      console.error(err);
      interaction.editReply("❌ Error creating live events embed.");
    }

    return;
  }

  /* ===== END LIVE EVENTS COMMAND ===== */

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

      const titleText = selected === "current"
        ? "📅  Kingdom 3558 — Current Week"
        : "📅  Kingdom 3558 — Next Week";

      const weekHeaderFormatter = new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", timeZone: "UTC"
      });

      const embed = new EmbedBuilder()
        .setColor("#7B2CBF")
        .setTitle(titleText)
        .setDescription(`**${weekHeaderFormatter.format(filterStart)} – ${weekHeaderFormatter.format(filterEnd)}**\n━━━━━━━━━━━━━━━━━━━━━━━━\n🟣 Upcoming  ·  🟢 Today  ·  🔵 In Progress`)
        .setFooter({ text: "Kingdom 3558  •  UTC" })
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

        let statusBadge = "";
        if (diffDays > 0) statusBadge = "🟣 **UPCOMING**";
        else if (diffDays === 0) statusBadge = "🟢 **TODAY**";
        else statusBadge = "🔵 **IN PROGRESS**";

        embed.addFields({
          name: `${emoji}  ${event.summary}`,
          value:
`${statusBadge}  ·  ➤ ${relativeText}
┣ 📆  ${startDate}  →  ${endDate}
┗ ⏳  ${durationDays} day${durationDays > 1 ? "s" : ""}
\u200b`,
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
  //               CUSTOM EVENT FEATURES
  // ────────────────────────────────────────────────

  if (interaction.isChatInputCommand() && interaction.commandName === 'create_event') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('create_event_type_select')
        .setPlaceholder('Select event type')
        .addOptions([
          {
            label: '📋 Standard Event',
            description: 'Create an event with sign-up buttons',
            value: 'standard'
          },
          {
            label: '🔔 Reminder Event',
            description: 'Schedule a role mention reminder with event embed',
            value: 'reminder'
          }
        ])
    );

    return interaction.reply({
      content: '**Create Event** — Choose the type of event you want to create:',
      components: [row],
      flags: 64
    });
  }

  // ── Handler: event type selector ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'create_event_type_select') {
    const type = interaction.values[0];

    if (type === 'standard') {
      const modal = new ModalBuilder()
        .setCustomId('create_event_modal')
        .setTitle('Create Standard Event');

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

      return interaction.showModal(modal);
    }

    if (type === 'reminder') {
      const modal = new ModalBuilder()
        .setCustomId('create_reminder_modal')
        .setTitle('Create Reminder Event');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reminder_role')
            .setLabel('Role to mention (exact name)')
            .setPlaceholder('e.g. Warriors')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reminder_event_name')
            .setLabel('Event Title')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reminder_date')
            .setLabel('Event Date (DD-MM-YYYY)')
            .setPlaceholder('25-12-2025')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reminder_time')
            .setLabel('Event Time (HH:MM) UTC')
            .setPlaceholder('18:00')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reminder_advance')
            .setLabel('Send reminder X minutes before (e.g. 30)')
            .setPlaceholder('15')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }
  }

  // ── Standard event modal submit ──
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
      return interaction.editReply('❌ Invalid date or time format. Please use DD-MM-YYYY and HH:MM (UTC).');
    }

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
      await pool.query(
        `INSERT INTO events (message_id, channel_id, event_name, event_time) VALUES ($1, $2, $3, $4)`,
        [msg.id, msg.channel.id, eventName, eventDate.toISOString()]
      ).catch(err => console.error('DB insert error:', err));
    }
  }

  // ── Reminder modal submit ──
  if (interaction.isModalSubmit() && interaction.customId === 'create_reminder_modal') {
    const roleName     = interaction.fields.getTextInputValue('reminder_role').trim();
    const eventName    = interaction.fields.getTextInputValue('reminder_event_name').trim();
    const dateStr      = interaction.fields.getTextInputValue('reminder_date').trim();
    const timeStr      = interaction.fields.getTextInputValue('reminder_time').trim();
    const advanceStr   = interaction.fields.getTextInputValue('reminder_advance').trim();

    let eventDate;
    try {
      const [dd, mm, yyyy] = dateStr.split('-').map(Number);
      const [hh, min] = timeStr.split(':').map(Number);
      eventDate = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, 0));
      if (isNaN(eventDate.getTime())) throw new Error();
    } catch {
      return interaction.reply({ content: '❌ Invalid date or time format. Please use DD-MM-YYYY and HH:MM (UTC).', flags: 64 });
    }

    const reminderMinutes = parseInt(advanceStr, 10);
    if (isNaN(reminderMinutes) || reminderMinutes <= 0) {
      return interaction.reply({ content: '❌ Please enter a valid positive number of minutes for the advance reminder.', flags: 64 });
    }

    await interaction.guild.roles.fetch();
    const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      return interaction.reply({ content: `❌ Role **${roleName}** not found. Please enter the exact role name.`, flags: 64 });
    }

    await pool.query(
      `INSERT INTO reminder_events (channel_id, role_id, event_name, event_time, reminder_minutes) VALUES ($1, $2, $3, $4, $5)`,
      [interaction.channelId, role.id, eventName, eventDate.toISOString(), reminderMinutes]
    ).catch(err => console.error('Reminder DB insert error:', err));

    const advanceText = reminderMinutes >= 60
      ? `${Math.floor(reminderMinutes / 60)}h ${reminderMinutes % 60 > 0 ? `${reminderMinutes % 60}m` : ''}`.trim()
      : `${reminderMinutes} minute${reminderMinutes !== 1 ? 's' : ''}`;

    return interaction.reply({
      content: `✅ **Event reminder saved!**\n📌 **${eventName}** — <t:${Math.floor(eventDate.getTime() / 1000)}:F>\n🔔 Reminder will be sent **${advanceText} before** to <@&${role.id}>`,
      flags: 64
    });
  }

  // ── Button handler ──
  if (interaction.isButton()) {
    const customId = interaction.customId;
    let status;
    if (customId === 'attend_yes') status = 'yes';
    if (customId === 'attend_no') status = 'no';
    if (!status) return;

    await interaction.deferUpdate().catch(console.error);

    try {
      await pool.query(
        `INSERT INTO signups (message_id, user_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET status = $3`,
        [interaction.message.id, interaction.user.id, status]
      );

      const { rows } = await pool.query(
        `SELECT status, COUNT(*) as count, STRING_AGG(user_id, ',') as users
         FROM signups WHERE message_id = $1 GROUP BY status`,
        [interaction.message.id]
      );

      const yes = rows.find(r => r.status === 'yes') || { count: 0, users: '' };
      const no  = rows.find(r => r.status === 'no')  || { count: 0, users: '' };

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .spliceFields(0, 2,
          { name: `✅ Attending (${yes.count})`, value: yes.users ? yes.users.split(',').map(id => `<@${id}>`).join('\n') || '\u200b' : '\u200b', inline: true },
          { name: `❌ Not Attending (${no.count})`, value: no.users ? no.users.split(',').map(id => `<@${id}>`).join('\n') || '\u200b' : '\u200b', inline: true }
        );

      await interaction.editReply({ embeds: [embed] }).catch(console.error);
    } catch (err) {
      console.error('Button handler error:', err.message);
    }
  }

  // ── my_events command ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'my_events') {
    await interaction.deferReply({ flags: 64 });

    try {
      const now = new Date();

      // Fetch active standard events (event hasn't started yet)
      const { rows: standardEvents } = await pool.query(
        `SELECT * FROM events WHERE event_time > $1 ORDER BY event_time ASC`,
        [now.toISOString()]
      );

      // Fetch pending reminders (event hasn't started yet)
      const { rows: reminderEvents } = await pool.query(
        `SELECT * FROM reminder_events WHERE event_time > $1 AND reminder_sent = 0 ORDER BY event_time ASC`,
        [now.toISOString()]
      );

      const embed = new EmbedBuilder()
        .setColor('#7B2CBF')
        .setTitle('📋 Active Events & Reminders')
        .setFooter({ text: 'Kingdom 3558 • UTC' })
        .setTimestamp();

      // ── Standard Events section ──
      if (standardEvents.length === 0) {
        embed.addFields({ name: '📋 Standard Events', value: '*No active standard events.*', inline: false });
      } else {
        const lines = standardEvents.map((ev, i) => {
          const ts = Math.floor(new Date(ev.event_time).getTime() / 1000);
          const status = ev.reminder_sent ? '🔔 Reminder sent' : '⏳ Waiting';
          return `**${i + 1}.** ${ev.event_name}\n> 📅 <t:${ts}:F> — <t:${ts}:R>\n> 🆔 \`${ev.message_id}\` • ${status}`;
        }).join('\n\n');
        embed.addFields({ name: `📋 Standard Events (${standardEvents.length})`, value: lines, inline: false });
      }

      embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━', inline: false });

      // ── Reminder Events section ──
      if (reminderEvents.length === 0) {
        embed.addFields({ name: '🔔 Reminder Events', value: '*No pending reminders.*', inline: false });
      } else {
        const lines = reminderEvents.map((ev, i) => {
          const ts = Math.floor(new Date(ev.event_time).getTime() / 1000);
          const reminderTs = Math.floor((new Date(ev.event_time).getTime() - ev.reminder_minutes * 60 * 1000) / 1000);
          const advanceText = ev.reminder_minutes >= 60
            ? `${Math.floor(ev.reminder_minutes / 60)}h${ev.reminder_minutes % 60 > 0 ? ` ${ev.reminder_minutes % 60}m` : ''}`
            : `${ev.reminder_minutes}m`;
          return `**${i + 1}.** ${ev.event_name}\n> 📅 <t:${ts}:F> — <t:${ts}:R>\n> 🔔 Reminder <t:${reminderTs}:R> (${advanceText} before) • <@&${ev.role_id}>`;
        }).join('\n\n');
        embed.addFields({ name: `🔔 Reminder Events (${reminderEvents.length})`, value: lines, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('my_events error:', err.message);
      await interaction.editReply({ content: '❌ Error fetching events.' });
    }
  }

  // ── delete_event command ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'delete_event') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ Only administrators can use this command.', ephemeral: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('delete_event_type_select')
        .setPlaceholder('What do you want to delete?')
        .addOptions([
          { label: '📋 Standard Event', description: 'Delete an event with sign-up buttons', value: 'standard' },
          { label: '🔔 Reminder Event', description: 'Delete a scheduled reminder', value: 'reminder' }
        ])
    );

    return interaction.reply({ content: '**Delete Event** — Choose the type:', components: [row], ephemeral: true });
  }

  // ── delete_event type selector ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'delete_event_type_select') {
    const type = interaction.values[0];
    const now = new Date();

    if (type === 'standard') {
      const { rows } = await pool.query(
        `SELECT message_id, event_name, event_time FROM events WHERE event_time > $1 ORDER BY event_time ASC`,
        [now.toISOString()]
      ).catch(() => ({ rows: [] }));

      if (!rows.length) {
        return interaction.update({ content: '📋 No active standard events to delete.', components: [] });
      }

      const options = rows.slice(0, 25).map(ev => {
        const ts = new Date(ev.event_time);
        const label = ev.event_name.slice(0, 80);
        const desc = `📅 ${ts.toUTCString().replace(' GMT', ' UTC')}`;
        return { label, description: desc.slice(0, 100), value: ev.message_id };
      });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('delete_standard_select')
          .setPlaceholder('Select event to delete...')
          .addOptions(options)
      );

      return interaction.update({ content: '📋 **Select the standard event to delete:**', components: [row] });
    }

    if (type === 'reminder') {
      const { rows } = await pool.query(
        `SELECT id, event_name, event_time, reminder_minutes FROM reminder_events WHERE reminder_sent = 0 AND event_time > $1 ORDER BY event_time ASC`,
        [now.toISOString()]
      ).catch(() => ({ rows: [] }));

      if (!rows.length) {
        return interaction.update({ content: '🔔 No pending reminders to delete.', components: [] });
      }

      const options = rows.slice(0, 25).map(ev => {
        const ts = new Date(ev.event_time);
        const label = ev.event_name.slice(0, 80);
        const desc = `📅 ${ts.toUTCString().replace(' GMT', ' UTC')} — ${ev.reminder_minutes}m before`;
        return { label, description: desc.slice(0, 100), value: String(ev.id) };
      });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('delete_reminder_select')
          .setPlaceholder('Select reminder to delete...')
          .addOptions(options)
      );

      return interaction.update({ content: '🔔 **Select the reminder to delete:**', components: [row] });
    }
  }

  // ── delete standard event confirm ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'delete_standard_select') {
    const messageId = interaction.values[0];

    try {
      const { rows } = await pool.query(`SELECT channel_id, event_name FROM events WHERE message_id = $1`, [messageId]);

        return interaction.update({ content: '❌ Event not found or already deleted.', components: [] });
      try {
        const channel = await client.channels.fetch(rows[0].channel_id);
        const message = await channel.messages.fetch(messageId);
        await message.delete();
      } catch { /* message may already be deleted */ }

      await pool.query(`DELETE FROM events WHERE message_id = $1`, [messageId]);
      await pool.query(`DELETE FROM signups WHERE message_id = $1`, [messageId]);

      return interaction.update({
        content: `✅ Standard event **${rows[0].event_name}** deleted successfully.`,
        components: []
      });
    } catch (err) {
      console.error('Delete standard event error:', err.message);
      return interaction.update({ content: '❌ Failed to delete the event.', components: [] });
    }
  }

  // ── delete reminder confirm ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'delete_reminder_select') {
    const reminderId = interaction.values[0];

    try {
      const { rows } = await pool.query(`SELECT event_name FROM reminder_events WHERE id = $1`, [reminderId]);

      if (!rows.length) {
        return interaction.update({ content: '❌ Reminder not found or already deleted.', components: [] });
      }

      await pool.query(`DELETE FROM reminder_events WHERE id = $1`, [reminderId]);

      return interaction.update({
        content: `✅ Reminder **${rows[0].event_name}** deleted successfully.`,
        components: []
      });
    } catch (err) {
      console.error('Delete reminder error:', err.message);
      return interaction.update({ content: '❌ Failed to delete the reminder.', components: [] });
    }
  }

});

/* ===== LIVE EVENTS AUTO UPDATE ===== */

setInterval(async () => {

  if (liveEventMessages.length === 0) return;

  console.log("🔄 Updating live event embeds...");

  for (const item of liveEventMessages) {

    try {

      const channel = await client.channels.fetch(item.channelId);
      const message = await channel.messages.fetch(item.messageId);

      const embed = await buildLiveEventsEmbed();

      await message.edit({ embeds: [embed] });

    } catch (err) {
      console.error("Live events update failed:", err.message);
    }

  }

}, 3600000);

/* ===== END LIVE EVENTS AUTO UPDATE ===== */

/* ===== DAILY EVENT ANNOUNCER ===== */

const ANNOUNCE_ROLE_ID = '1323254900997619751';

async function fetchTomorrowEvents() {
  const now = new Date();
  const tomorrowStart = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const tomorrowEnd = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, 0, 0, 0
  ));

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`
    + `?key=${API_KEY}`
    + `&timeMin=${tomorrowStart.toISOString()}`
    + `&timeMax=${tomorrowEnd.toISOString()}`
    + `&singleEvents=true&orderBy=startTime`;

  const response = await axios.get(url);
  return response.data.items || [];
}

async function runDailyAnnouncement() {
  try {
    console.log('📅 Running daily event announcement check...');

    const tomorrowEvents = await fetchTomorrowEvents();
    if (tomorrowEvents.length === 0) {
      console.log('📅 No events tomorrow, skipping announcement.');
      return;
    }

    const newEvents = [];
    for (const event of tomorrowEvents) {
      const { rows } = await pool.query(
        `SELECT event_id FROM announced_events WHERE event_id = $1`, [event.id]
      );
      if (rows.length === 0) newEvents.push(event);
    }

    if (newEvents.length === 0) {
      console.log('📅 No new events to announce.');
      return;
    }

    const count = newEvents.length;

    const embed = new EmbedBuilder()
      .setColor('#7B2CBF')
      .setDescription('📅 **Upcoming Tomorrow**')
      .setFooter({ text: 'Kingdom 3558  ·  UTC  ·  Checked daily at 00:01' })
      .setTimestamp();

    if (count === 1) {
      const event = newEvents[0];
      const start = new Date(event.start.dateTime || event.start.date);
      const unix = Math.floor(start.getTime() / 1000);
      const emoji = getEventEmoji(event.summary);
      embed.setTitle(`${emoji}  ${event.summary}`);
      embed.addFields({ name: 'Starts', value: `<t:${unix}:D>\n⏰ <t:${unix}:R>`, inline: false });
    } else {
      embed.setTitle(`📅  ${count} Events Starting Tomorrow`);
      for (const event of newEvents) {
        const start = new Date(event.start.dateTime || event.start.date);
        const unix = Math.floor(start.getTime() / 1000);
        const emoji = getEventEmoji(event.summary);
        embed.addFields({
          name: `${emoji}  ${event.summary}`,
          value: `<t:${unix}:D>  ·  ⏰ <t:${unix}:R>`,
          inline: false
        });
      }
    }

    const { rows: channels } = await pool.query(
      `SELECT DISTINCT channel_id FROM live_event_messages`
    );

    for (const row of channels) {
      try {
        const channel = await client.channels.fetch(row.channel_id);
        await channel.send({
          content: `<@&${ANNOUNCE_ROLE_ID}> — ${count === 1 ? 'New event' : `${count} new events`} starting tomorrow!`,
          embeds: [embed]
        });
      } catch (err) {
        console.error(`Failed to send announcement to channel ${row.channel_id}:`, err.message);
      }
    }

    for (const event of newEvents) {
      await pool.query(
        `INSERT INTO announced_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [event.id]
      );
    }

    console.log(`📅 Announced ${newEvents.length} event(s).`);

  } catch (err) {
    console.error('Daily announcement error:', err.message);
  }
}

function scheduleDailyAnnouncement() {
  const now = new Date();

  // If it's already past 00:01 UTC today, run immediately on startup
  // so late restarts don't miss the daily check
  const todayAnnouncement = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 1, 0
  ));

  if (now > todayAnnouncement) {
    console.log('📅 Past 00:01 UTC — running announcement check now (catch-up).');
    runDailyAnnouncement();
  }

  // Schedule next run at 00:01 UTC tomorrow, then repeat every 24h
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1, 0
  ));
  const msUntilNext = next.getTime() - now.getTime();

  console.log(`📅 Next daily announcement scheduled in ${Math.round(msUntilNext / 1000 / 60)} minutes.`);

  setTimeout(async () => {
    await runDailyAnnouncement();
    setInterval(runDailyAnnouncement, 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

/* ===== END DAILY EVENT ANNOUNCER ===== */

client.login(TOKEN);
