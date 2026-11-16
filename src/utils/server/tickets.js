// Tickets (the tickets.bot features, built in steps): staff roles, the blacklist, panels, opening / closing / claiming a ticket, transcripts.
// Built: channel and thread tickets, forms, close requests, tags, feedback ratings, auto-close, stats, reopen. Not built: knowledge base, notes.
// Commands: commands/general/ticket.js (members and staff in a ticket), commands/admin/ticket-config.js (setup, panels, staff, blacklist); buttons: components/tickets.js.
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits: P, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getStore } = require('../../storage');
const { BRAND_COLOR } = require('../../config');
const { shortId } = require('../random');
const { exportChannel } = require('./chatExport');
const { privateReply, replyEmbed } = require('../embeds');

const OPEN_ID = 'ticket_open'; // ticket_open:<panel id>
const CLOSE_ID = 'ticket_close'; // ticket_close:<channel id>
const CLAIM_ID = 'ticket_claim'; // ticket_claim:<channel id>
const FORM_ID = 'ticket_form'; // the form pop-up: ticket_form:<panel id>
const TAGSET_ID = 'ticket_tagset'; // a tag's text pop-up: ticket_tagset:<tag id>
const FEEDBACK_ID = 'ticket_fb'; // a star button in the opener's DM: ticket_fb:<server id>:<ticket number>:<1-5>
const FEEDBACKC_ID = 'ticket_fbc'; // the optional comment pop-up: ticket_fbc:<server id>:<ticket number>
const FORMSET_ID = 'ticket_formset'; // staff typing a panel's questions: ticket_formset:<panel id>
const CREQ_ID = 'ticket_creq'; // a close request's buttons: ticket_creq:<channel id>:a (accept) or :d (deny)
const MAX_QUESTIONS = 5; // Discord: 5 inputs in a pop-up
const MAX_DELAY_HOURS = 168;
const MAX_PER_PANEL = 1; // open tickets one member can have from one panel
const MAX_CATEGORY = 50; // Discord: channels in one category

const settingsStore = () => getStore('ticketSettings'); // server id -> { adminRoles, supportRoles, blacklist, transcriptChannelId, categoryId, counter }
const panelsStore = () => getStore('ticketPanels'); // panel id -> panel (carries its guildId)
const ticketsStore = () => getStore('tickets'); // channel id -> ticket (carries its guildId)

const WHY_NOT = {
  blacklisted: 'You are not allowed to open tickets here.',
  gone: 'That panel no longer exists.',
  limit: 'You already have a ticket open from this panel.',
  full: 'The ticket category is full. Tell the staff.',
  notTicket: 'This is not a ticket channel.',
  staff: 'Only ticket staff can do that.',
  claimed: 'This ticket is already claimed.',
  notClaimed: 'This ticket is not claimed.',
  notYours: 'Only the staff member who claimed this ticket can do that.',
  rename: 'The name needs 1 to 90 characters.',
  noQuestions: `Write 1 to ${MAX_QUESTIONS} questions, one per line, each up to 45 characters.`,
  pending: 'There is already a close request open on this ticket.',
  noRequest: 'That close request is no longer open.',
  notOpener: 'Only the person who opened the ticket can answer this.',
  tagId: 'A tag id has 1 to 32 characters: letters, digits, `-` and `_`.',
  tagText: 'A tag needs 1 to 2,000 characters of text.',
  tagFull: 'This server has the most tags allowed (100). Delete one first.',
  noClosed: 'No closed thread ticket has that number.',
  channelOnly: 'That only works in channel mode tickets.',
  threadOnly: 'That only works in thread mode tickets.',
  noFeedback:'This rating is not yours, or it has expired.',
};

// ---------- settings and staff ----------

const DEFAULTS = () => ({ adminRoles: [], supportRoles: [], blacklist: [], feedback: true, onCall: [], autoclose: { inactiveHours: 0, noResponseHours: 0, onLeave: false } });
const getSettings = async (guildId) => ({ ...DEFAULTS(), ...(await settingsStore().get(guildId)) });
const saveSettings = (guildId, fn) => settingsStore().update(guildId, (cur) => fn({ ...DEFAULTS(), ...cur }));

// Adds or removes `id` from a list setting (adminRoles, supportRoles, blacklist). Returns the new list.
async function toggleIn(guildId, key, id, on) {
  const next = await saveSettings(guildId, (s) => ({ ...s, [key]: [...s[key].filter((x) => x !== id), ...(on ? [id] : [])] }));
  return next[key];
}

const hasRole = (member, ids) => ids.some((id) => member?.roles?.cache?.has(id));
const isAdmin = (settings, member, perms) => perms?.has(P.ManageGuild) || hasRole(member, settings.adminRoles);
const isStaff = (settings, member, perms, panel) => isAdmin(settings, member, perms) || hasRole(member, panel?.supportRoles?.length ? panel.supportRoles : settings.supportRoles);
// A blacklisted member, or one holding a blacklisted role.
const isBlacklisted = (settings, member) => settings.blacklist.includes(member.id) || hasRole(member, settings.blacklist);

// ---------- panels ----------

async function createPanel(guildId, input) {
  const panel = { id: shortId(), guildId, name: input.name, channelId: input.channelId, categoryId: input.categoryId ?? null, supportRoles: input.supportRoles ?? [],
    form: [], thread: Boolean(input.thread), welcome: input.welcome ?? null, label: input.label ?? 'Open A Ticket', messageId: null };
  await panelsStore().set(panel.id, panel);
  return panel;
}
const getPanel = (id) => panelsStore().get(id);
const guildPanels = async (guildId) => Object.values(await panelsStore().all()).filter((p) => p.guildId === guildId);

// The embed with the button members press.
const panelMessage = (panel) => ({
  embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(panel.name).setDescription(panel.welcome ?? 'Press the button to open a ticket. Staff will answer you there.')],
  components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${OPEN_ID}:${panel.id}`).setLabel(panel.label).setStyle(ButtonStyle.Primary))],
});

// Posts the panel and remembers its message. Throws if the bot can't post there.
async function postPanel(guild, panel) {
  const channel = await guild.channels.fetch(panel.channelId);
  const message = await channel.send(panelMessage(panel));
  await panelsStore().update(panel.id, (p) => ({ ...p, messageId: message.id }));
  return message;
}

async function deletePanel(guild, panelId) {
  const panel = await getPanel(panelId);
  if (!panel) return false;
  await guild.channels.fetch(panel.channelId).then((c) => c.messages.delete(panel.messageId)).catch(() => null);
  await panelsStore().delete(panelId);
  return true;
}

// ---------- a ticket ----------

const channelName = (number) => `ticket-${String(number).padStart(4, '0')}`;
const getTicket = (channelId) => ticketsStore().get(channelId);
const openTickets = async (guildId) => Object.values(await ticketsStore().all()).filter((t) => t.guildId === guildId && !t.closed); // a closed thread ticket is kept for /ticket reopen

const SEE = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

// The channel's permission overwrites: hidden from everyone, open to the opener, added users, staff and the bot.
// A claimed ticket: other staff roles can read but not write (the claimer can).
function overwrites({ guildId, botId, openerId, userIds = [], roleIds = [], claimedBy = null, claimerRoleIds = [] }) {
  const write = (id) => ({ id, allow: SEE });
  const staffRead = (id) => (claimedBy ? { id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] } : write(id));
  const list = [{ id: guildId, deny: [P.ViewChannel] }, { id: botId, allow: [...SEE, P.ManageChannels, P.ManageRoles] }, write(openerId)];
  for (const id of roleIds) if (!claimerRoleIds.includes(id)) list.push(staffRead(id));
  for (const id of userIds) if (id !== openerId) list.push(write(id));
  if (claimedBy) list.push(write(claimedBy));
  return list;
}

// A ticket's welcome message buttons. A thread ticket has no Claim button (claiming is for channel tickets, like tickets.bot).
const ticketButtons = (channelId, claimed, thread = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${CLOSE_ID}:${channelId}`).setLabel('Close').setStyle(ButtonStyle.Danger),
  ...(thread ? [] : [new ButtonBuilder().setCustomId(`${CLAIM_ID}:${channelId}`).setLabel('Claim').setStyle(ButtonStyle.Secondary).setDisabled(claimed)]),
);

// Why `member` can't open a ticket from `panel` (a key of WHY_NOT), or null.
async function whyNotOpen(guild, member, panel) {
  if (!panel || panel.guildId !== guild.id) return 'gone';
  const settings = await getSettings(guild.id);
  if (isBlacklisted(settings, member)) return 'blacklisted';
  const mine = (await openTickets(guild.id)).filter((t) => t.openerId === member.id && t.panelId === panel.id);
  if (mine.length >= MAX_PER_PANEL) return 'limit';
  const parentId = panel.categoryId ?? settings.categoryId ?? null;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;
  return !panel.thread && parent && parent.children.cache.size >= MAX_CATEGORY ? 'full' : null;
}

// ---------- forms ----------

// Saves a panel's questions (one per line). Returns the list, or null when there are none or one is too long.
async function setForm(panelId, text) {
  const questions = text.split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
  if (!questions.length || questions.length > MAX_QUESTIONS || questions.some((q) => q.length > 45)) return null;
  await panelsStore().update(panelId, (p) => (p ? { ...p, form: questions } : p));
  return questions;
}
const setPanelMode = (panelId, thread) => panelsStore().update(panelId, (p) => (p ? { ...p, thread: Boolean(thread) } : p));
const clearForm =(panelId) => panelsStore().update(panelId, (p) => (p ? { ...p, form: [] } : p));

// The pop-up a member fills in before the ticket is made.
const formModal = (panel) => new ModalBuilder().setCustomId(`${FORM_ID}:${panel.id}`).setTitle(panel.name.slice(0, 45)).addComponents(
  ...panel.form.map((q, i) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${i}`).setLabel(q).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true))),
);
const answersOf = (panel, fields) => panel.form.map((q, i) => ({ q, a: fields.getTextInputValue(`q${i}`) }));

// Opens a ticket for `member` from `panel` (`answers` = the form's { q, a } list). Returns { ok, channel } or { ok: false, reason } (a key of WHY_NOT).
async function openTicket(guild, member, panel, answers = []) {
  const reason = await whyNotOpen(guild, member, panel);
  if (reason) return { ok: false, reason };
  const settings = await getSettings(guild.id);
  const parentId = panel.categoryId ?? settings.categoryId ?? null;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;
  const number = (await saveSettings(guild.id, (s) => ({ ...s, counter: (s.counter ?? 0) + 1 }))).counter;
  const roleIds = panel.supportRoles.length ? panel.supportRoles : settings.supportRoles;
  let channel;
  const pings = [];
  if (panel.thread) {
    // A private thread in the panel's channel. Staff with Manage Threads see it; the on-call staff are added and pinged.
    const parentChannel = await guild.channels.fetch(panel.channelId);
    channel = await parentChannel.threads.create({ name: channelName(number), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 10080, reason: `Ticket opened by ${member.user.username}` });
    await channel.members.add(member.id);
    for (const id of settings.onCall) if (await channel.members.add(id).then(() => true, () => false)) pings.push(`<@${id}>`);
  } else {
    channel = await guild.channels.create({
      name: channelName(number), type: ChannelType.GuildText, parent: parent?.id ?? undefined,
      permissionOverwrites: overwrites({ guildId: guild.id, botId: guild.client.user.id, openerId: member.id, roleIds: [...roleIds, ...settings.adminRoles] }),
      reason: `Ticket opened by ${member.user.username}`,
    });
  }
  const ticket = { id: channel.id, guildId: guild.id, number, panelId: panel.id, openerId: member.id, claimedBy: null, users: [], thread: Boolean(panel.thread), createdAt: Date.now(), lastMessageAt: Date.now(), firstResponseAt: null };
  await ticketsStore().set(channel.id, ticket);
  const welcome = panel.welcome ? `${panel.welcome}\n\n` : '';
  await channel.send({ content: [`${member}`, ...pings].join(' '), embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(panel.name).setDescription(`${welcome}Staff will be with you soon. Tell them what you need.`)], components: [ticketButtons(channel.id, false, ticket.thread)] });
  if (answers.length) await channel.send({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Form').addFields(answers.map(({ q, a }) => ({ name: q, value: a.slice(0, 1024) })))] });
  return { ok: true, channel };
}

// What a member's Open button or `/ticket open` does: refuse, show the panel's form, or open the ticket now.
async function startOpen(interaction, panel) {
  const why = await whyNotOpen(interaction.guild, interaction.member, panel);
  if (why) return privateReply(interaction, WHY_NOT[why]);
  if (panel.form?.length) return interaction.showModal(formModal(panel));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await openTicket(interaction.guild, interaction.member, panel);
  return interaction.editReply({ embeds: [replyEmbed(result.ok ? `Your ticket is open: ${result.channel}` : WHY_NOT[result.reason])] });
}

// Recomputes who can see a ticket from its record (after an add, remove, claim or unclaim).
async function applyAccess(guild, channel, ticket) {
  const settings = await getSettings(guild.id);
  const panel = await getPanel(ticket.panelId);
  const roleIds = [...(panel?.supportRoles?.length ? panel.supportRoles : settings.supportRoles), ...settings.adminRoles];
  const claimer = ticket.claimedBy ? await guild.members.fetch(ticket.claimedBy).catch(() => null) : null;
  const claimerRoleIds = claimer ? roleIds.filter((id) => claimer.roles.cache.has(id)) : [];
  await channel.permissionOverwrites.set(overwrites({ guildId: guild.id, botId: guild.client.user.id, openerId: ticket.openerId, userIds: ticket.users, roleIds, claimedBy: ticket.claimedBy, claimerRoleIds }));
}

const changeTicket = (channelId, fn) => ticketsStore().update(channelId, (t) => (t ? fn(t) : t));

// Closes a ticket: saves the transcript to the transcript channel (and DMs it to the opener when they allow it), then deletes the channel.
async function closeTicket(guild, channel, ticket, by, reason) {
  const { html, count } = await exportChannel(channel, by.username);
  const file = () => new AttachmentBuilder(Buffer.from(html), { name: `${channelName(ticket.number)}.html` });
  const settings = await getSettings(guild.id);
  const summary = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Ticket ${ticket.number} Closed`).addFields(
    { name: 'Opened By', value: `<@${ticket.openerId}>`, inline: true },
    { name: 'Closed By', value: `${by}`, inline: true },
    { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody', inline: true },
    { name: 'Messages', value: String(count), inline: true },
    { name: 'Reason', value: (reason ?? 'None given').slice(0, 1024) },
  );
  const log = settings.transcriptChannelId ? await guild.channels.fetch(settings.transcriptChannelId).catch(() => null) : null;
  if (log) await log.send({ embeds: [summary], files: [file()] }).catch((e) => console.error('[tickets] Transcript post failed:', e));
  const opener = await guild.client.users.fetch(ticket.openerId).catch(() => null);
  if (opener) await opener.send({ embeds: [summary], files: [file()] }).catch(() => null);
  if (opener && settings.feedback) await askFeedback(guild, opener, ticket).catch(() => null);
  await historyStore().set(feedbackKey(guild.id, ticket.number), {
    guildId: guild.id, number: ticket.number, panelId: ticket.panelId, openerId: ticket.openerId, claimedBy: ticket.claimedBy, closedBy: by.id,
    createdAt: ticket.createdAt, firstResponseAt: ticket.firstResponseAt ?? null, firstResponseBy: ticket.firstResponseBy ?? null, closedAt: Date.now(),
  });
  if (ticket.thread) {
    // A thread ticket stays, locked and archived, so /ticket reopen can open it again.
    await ticketsStore().update(channel.id, (t) => (t ? { ...t, closed: true, closeRequest: null } : t));
    await channel.edit({ locked: true, archived: true, reason: `Ticket closed by ${by.username}` });
    return;
  }
  await ticketsStore().delete(channel.id);
  await channel.delete(`Ticket closed by ${by.username}`);
}

// Opens a closed thread ticket again by its number. Returns { ok, thread } or { ok: false, reason }.
async function reopenTicket(guild, number) {
  const ticket = Object.values(await ticketsStore().all()).find((t) => t.guildId === guild.id && t.number === number && t.thread && t.closed);
  if (!ticket) return { ok: false, reason: 'noClosed' };
  const thread = await guild.channels.fetch(ticket.id, { force: true }).catch(() => null);
  if (!thread) { await ticketsStore().delete(ticket.id); return { ok: false, reason: 'noClosed' }; } // the thread was deleted
  await thread.edit({ locked: false, archived: false, reason: 'Ticket reopened' });
  await ticketsStore().update(ticket.id, (t) => (t ? { ...t, closed: false, closeRequest: null, lastMessageAt: Date.now() } : t));
  await historyStore().delete(feedbackKey(guild.id, number)); // it counts again when it closes
  await thread.send({ embeds: [replyEmbed('This ticket was reopened.')], content: `<@${ticket.openerId}>`, components: [ticketButtons(thread.id, false, true)] });
  return { ok: true, thread };
}

// Adds or removes a staff member from the on-call list. Returns true when they are on it now.
async function toggleOnCall(guildId, userId) {
  const next = await saveSettings(guildId, (s) => ({ ...s, onCall: s.onCall.includes(userId) ? s.onCall.filter((x) => x !== userId) : [...s.onCall, userId] }));
  return next.onCall.includes(userId);
}

// ---------- feedback ----------

const historyStore = () => getStore('ticketHistory'); // `<server id>:<ticket number>` -> a closed ticket: who, when, who answered first (for /stats)
const feedbackStore = () => getStore('ticketFeedback'); // `<server id>:<ticket number>` -> { guildId, number, openerId, claimedBy, rating, comment, at }
const feedbackKey = (guildId, number) => `${guildId}:${number}`;

const ratingButtons = (guildId, number) => new ActionRowBuilder().addComponents(
  [1, 2, 3, 4, 5].map((n) => new ButtonBuilder().setCustomId(`${FEEDBACK_ID}:${guildId}:${number}:${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)),
);

// DMs the opener the star buttons (1 to 5) for a closed ticket and keeps an empty record only they can fill in.
async function askFeedback(guild, opener, ticket) {
  await feedbackStore().set(feedbackKey(guild.id, ticket.number), { guildId: guild.id, number: ticket.number, openerId: ticket.openerId, claimedBy: ticket.claimedBy, rating: null, comment: null, at: null });
  await opener.send({
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('How Was Your Ticket?').setDescription(`Rate the support you got in **${guild.name}** from **1** to **5** stars.`)],
    components: [ratingButtons(guild.id, ticket.number)],
  });
}

// Saves a rating or comment from the opener. Returns the record, or null when it isn't theirs or doesn't exist.
async function saveFeedback(guildId, number, userId, patch) {
  let saved = null;
  await feedbackStore().update(feedbackKey(guildId, number), (f) => {
    if (!f || f.openerId !== userId) return f;
    saved = { ...f, ...patch, at: Date.now() };
    return saved;
  });
  return saved;
}

// Posts a rating or comment in the transcript channel, so staff see it.
async function tellFeedback(client, feedback, text) {
  const guild = client.guilds.cache.get(feedback.guildId);
  const id = guild && (await getSettings(guild.id)).transcriptChannelId;
  const channel = id && (await guild.channels.fetch(id).catch(() => null));
  if (channel) await channel.send({ content: `<@${feedback.openerId}> ${text}`, allowedMentions: { parse: [] } }).catch(() => null);
}

const commentModal = (guildId, number) => new ModalBuilder().setCustomId(`${FEEDBACKC_ID}:${guildId}:${number}`).setTitle('Your Feedback').addComponents(
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comment').setLabel('Anything else? (Optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)),
);

// ---------- tags ----------

const tagsStore = () => getStore('ticketTags'); // `<server id>:<tag id>` -> { guildId, id, content }
const MAX_TAGS = 100;
const TAG_ID = /^[a-z0-9_-]{1,32}$/;

const tagKey = (guildId, id) => `${guildId}:${id}`;
const normalTag = (id) => id.trim().toLowerCase();
const getTag = (guildId, id) => tagsStore().get(tagKey(guildId, normalTag(id)));
const guildTags = async (guildId) => Object.values(await tagsStore().all()).filter((t) => t.guildId === guildId).sort((a, b) => a.id.localeCompare(b.id));

// Saves (or replaces) a tag. Returns { ok, tag } or { ok: false, reason } (a key of WHY_NOT).
async function saveTag(guildId, rawId, content) {
  const id = normalTag(rawId);
  if (!TAG_ID.test(id)) return { ok: false, reason: 'tagId' };
  const text = content.trim();
  if (!text || text.length > 2000) return { ok: false, reason: 'tagText' };
  if (!(await getTag(guildId, id)) && (await guildTags(guildId)).length >= MAX_TAGS) return { ok: false, reason: 'tagFull' };
  const tag = { guildId, id, content: text };
  await tagsStore().set(tagKey(guildId, id), tag);
  return { ok: true, tag };
}
async function deleteTag(guildId, id) {
  if (!(await getTag(guildId, id))) return false;
  await tagsStore().delete(tagKey(guildId, normalTag(id)));
  return true;
}

// ---------- stats ----------

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// "2 h 5 min", "45 s", or "None" for no data.
function duration(ms) {
  if (ms == null) return 'None';
  const s = Math.round(ms / 1000);
  if (s < 60) return `**${s}** s`;
  const m = Math.round(s / 60);
  if (m < 60) return `**${m}** min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `**${h}** h **${m % 60}** min` : `**${Math.floor(h / 24)}** d **${h % 24}** h`;
}
const stars = (ratings) => (ratings.length ? `**${avg(ratings).toFixed(1)}** out of **5** (**${ratings.length}** ratings)` : 'None');

// A server's numbers from its closed tickets (`history`), their ratings and the tickets open now.
function serverStats(history, feedback, open) {
  const claims = {};
  for (const h of history) if (h.claimedBy) claims[h.claimedBy] = (claims[h.claimedBy] ?? 0) + 1;
  return {
    opened: history.length + open.length, open: open.length, closed: history.length,
    response: avg(history.filter((h) => h.firstResponseAt).map((h) => h.firstResponseAt - h.createdAt)),
    length: avg(history.map((h) => h.closedAt - h.createdAt)),
    ratings: feedback.filter((f) => f.rating).map((f) => f.rating),
    top: Object.entries(claims).sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

// One member's numbers: tickets they opened, tickets they claimed, how fast they answered first, and the ratings of the tickets they claimed.
function userStats(userId, history, feedback, open) {
  const all = [...history, ...open];
  return {
    opened: all.filter((t) => t.openerId === userId).length,
    claimed: all.filter((t) => t.claimedBy === userId).length,
    response: avg(history.filter((h) => h.firstResponseBy === userId && h.firstResponseAt).map((h) => h.firstResponseAt - h.createdAt)),
    ratings: feedback.filter((f) => f.claimedBy === userId && f.rating).map((f) => f.rating),
  };
}

async function statsData(guildId) {
  const mine = (store) => store.all().then((all) => Object.values(all).filter((x) => x.guildId === guildId));
  return { history: await mine(historyStore()), feedback: await mine(feedbackStore()), open: await openTickets(guildId) };
}

// ---------- auto-close ----------

const AUTOCLOSE_OFF = { inactiveHours: 0, noResponseHours: 0, onLeave: false };

// Why a ticket should close by itself now (a sentence for the transcript), or null. `rules` = the server's autoclose settings.
function autocloseWhy(rules, ticket, now = Date.now()) {
  if (!rules || ticket.noAutoclose) return null;
  const hours = (since) => (now - since) / 3_600_000;
  if (rules.inactiveHours && hours(ticket.lastMessageAt ?? ticket.createdAt) >= rules.inactiveHours) return `Nobody wrote for ${rules.inactiveHours} hours.`;
  if (rules.noResponseHours && !ticket.firstResponseAt && hours(ticket.createdAt) >= rules.noResponseHours) return `No staff answer in ${rules.noResponseHours} hours.`;
  return null;
}

// A message in a ticket: remembers when it was written, and the first one from someone who isn't the opener (the staff answer). Written within 5 s, not at once.
async function noteActivity(message) {
  if (!(await ticketsStore().get(message.channelId))) return;
  const now = Date.now();
  const staffAnswer = !message.author.bot && message.author.id !== (await ticketsStore().get(message.channelId)).openerId;
  await ticketsStore().update(message.channelId, (t) => {
    if (!t) return t;
    const first = !t.firstResponseAt && staffAnswer;
    return { ...t, lastMessageAt: now, firstResponseAt: first ? now : t.firstResponseAt ?? null, firstResponseBy: first ? message.author.id : t.firstResponseBy ?? null };
  }, { defer: true });
}

// The opener left the server: closes their open tickets when the server asked for it.
async function closeForLeaver(guild, userId) {
  if (!(await getSettings(guild.id)).autoclose.onLeave) return;
  for (const t of (await openTickets(guild.id)).filter((x) => x.openerId === userId && !x.noAutoclose)) {
    const channel = await guild.channels.fetch(t.id).catch(() => null);
    if (channel) await closeTicket(guild, channel, t, guild.client.user, 'The member left the server.').catch((e) => console.error('[tickets] Close for leaver failed:', e));
    else await ticketsStore().delete(t.id);
  }
}

// ---------- close requests ----------

const creqButtons = (channelId) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${CREQ_ID}:${channelId}:a`).setLabel('Accept').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${CREQ_ID}:${channelId}:d`).setLabel('Deny').setStyle(ButtonStyle.Danger),
);

// Asks the opener to confirm the ticket can close. `delayHours` (optional): it closes by itself if nobody answers. Returns { ok } or { ok: false, reason }.
async function requestClose(channel, ticket, by, { delayHours = null, reason = null } = {}) {
  if (ticket.closeRequest) return { ok: false, reason: 'pending' };
  const closeAt = delayHours ? Date.now() + delayHours * 3_600_000 : null;
  const when = closeAt ? `

If nobody answers, this ticket closes <t:${Math.floor(closeAt / 1000)}:R>.` : '';
  await channel.send({
    content: `<@${ticket.openerId}>`,
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Close Request').setDescription(`${by} asks to close this ticket. Is your issue resolved?${reason ? `

**Reason**
${reason.slice(0, 1000)}` : ''}${when}`)],
    components: [creqButtons(channel.id)],
  });
  await changeTicket(channel.id, (t) => ({ ...t, closeRequest: { by: by.id, reason, closeAt } }));
  return { ok: true };
}

const clearRequest = (channelId) => changeTicket(channelId, (t) => ({ ...t, closeRequest: null }));

// Closes every ticket whose close request ran out of time, and every one the server's auto-close rules say is done. Run every minute by events/ticketsReady.js.
async function sweep(client, now = Date.now()) {
  const rules = new Map(); // server id -> its autoclose settings
  for (const t of Object.values(await ticketsStore().all())) {
    const requestDue = t.closeRequest?.closeAt && t.closeRequest.closeAt <= now;
    if (t.closed) continue;
    if (!rules.has(t.guildId)) rules.set(t.guildId, (await getSettings(t.guildId)).autoclose);
    const why = requestDue ? `Close request not answered. ${t.closeRequest.reason ?? ''}`.trim() : autocloseWhy(rules.get(t.guildId), t, now);
    if (!why) continue;
    const guild = client.guilds.cache.get(t.guildId);
    const channel = guild && (await guild.channels.fetch(t.id).catch(() => null));
    if (!channel) { await ticketsStore().delete(t.id); continue; } // the channel is gone
    await closeTicket(guild, channel, t, client.user, why).catch((e) => console.error('[tickets] Auto-close failed:', e));
  }
}

module.exports = {
  startOpen, reopenTicket, toggleOnCall, setPanelMode,
  FORM_ID, FORMSET_ID, CREQ_ID, MAX_DELAY_HOURS, whyNotOpen, setForm, clearForm, formModal, answersOf, requestClose, clearRequest, sweep,
  TAGSET_ID, TAG_ID, getTag, guildTags, saveTag, deleteTag, duration, stars, serverStats, userStats, statsData,
  FEEDBACK_ID, FEEDBACKC_ID, saveFeedback, tellFeedback, commentModal, autocloseWhy, noteActivity, closeForLeaver,
  OPEN_ID, CLOSE_ID, CLAIM_ID, WHY_NOT,
  getSettings, saveSettings, toggleIn, isAdmin, isStaff, isBlacklisted,
  createPanel, getPanel, guildPanels, panelMessage, postPanel, deletePanel,
  channelName, getTicket, openTickets, overwrites, ticketButtons, openTicket, applyAccess, changeTicket, closeTicket,
};
