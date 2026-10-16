// Soul Bag: every counted chat message (the chat XP rules, chatCounts in xp.js) has a small chance to drop a bag of
// souls in that channel; the first member to press Grab keeps it. One bag per cooldown for the whole server.
// Chance and cooldown: /xp-config soul-bag. Decisions: server-plan.md ("Soul Bag").
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { SCALE } = require('./economy');
const { REPLY_COLOR } = require('../config');
const { ASSETS } = require('./art');
const { boldSouls, soulsIcon } = require('./format');
const { pickRandom } = require('./random');
const { grabBag } = require('./xp');

const GRAB_ID = 'soulbag';
const BAG_MIN = 50 * SCALE; // a bag holds a random amount between these, rolled when it's grabbed
const BAG_MAX = 150 * SCALE;
const GRABBED_COLOR = 0x4f545c;
// Art in assets/soulbag: the bag (his picture, background cut out) as thumbnail, the game's minimap icon by the name.
const art = () => ['bag.png', 'map.png'].map((file) => new AttachmentBuilder(path.join(ASSETS, 'soulbag', file), { name: `soulbag_${file}` }));

// The Shopkeeper's lines (original, in his voice). {member} and {souls} are filled in.
const DROP_LINES = [
  'Somebody left a bag of Souls on my floor. First hand on it keeps it, no questions asked.',
  "Would ya look at that, a Soul Bag, just sittin' there. I ain't bendin' down for it. First one to grab it, it's yours.",
  "Bag of Souls fell off the back of a truck. I didn't see nothin'. Quick hands win.",
];
const GRAB_LINE = '{member} retrieved the soul bag worth {souls}!';
const GRAB_FOOTER = 'Rest of ya, better luck next bag!';
const TOO_LATE = "Too slow, pal. That bag's gone.";

// ponytail: the cooldown and the grabbed bags live in memory. A restart lets a bag drop right away and forgets which
// bags were grabbed (a grabbed bag has no button left to press anyway). Keep them in data/ if that ever matters.
let lastDropAt = 0;
const grabbed = new Set(); // message ids

// Does this counted message drop a bag? `s` = the XP settings. Claims the cooldown when it does.
function shouldDrop(s, now = Date.now(), roll = Math.random()) {
  if (now - lastDropAt < s.bagCooldownMinutes * 60 * 1000 || roll * 100 >= s.bagChance) return false;
  lastDropAt = now;
  return true;
}

const rollSouls = () => BAG_MIN + Math.floor(Math.random() * (BAG_MAX - BAG_MIN + 1));

// The pictures are uploaded with the drop; the edit after a grab points at the same attachments.
const bagEmbed = (text, color) =>
  new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'Soul Bag', iconURL: 'attachment://soulbag_map.png' })
    .setThumbnail('attachment://soulbag_bag.png')
    .setDescription(text);

async function dropBag(channel) {
  const button = new ButtonBuilder().setCustomId(GRAB_ID).setLabel('Grab').setStyle(ButtonStyle.Success);
  if (soulsIcon()) button.setEmoji(soulsIcon().trim());
  await channel
    .send({ embeds: [bagEmbed(pickRandom(DROP_LINES), REPLY_COLOR)], components: [new ActionRowBuilder().addComponents(button)], files: art() })
    .catch((error) => console.error('[soul-bag] Failed to drop a bag:', error.message));
}

// The Grab button: the first press takes the bag, everyone after gets a private "too slow".
async function onGrab(interaction) {
  const id = interaction.message.id;
  if (grabbed.has(id)) return interaction.reply({ content: TOO_LATE, flags: MessageFlags.Ephemeral });
  grabbed.add(id); // before anything is awaited, so two presses at once can't both pay
  const { souls } = await grabBag(interaction.user.id, rollSouls());
  const text = GRAB_LINE.replace('{member}', `${interaction.user}`).replace('{souls}', boldSouls(souls));
  return interaction.update({ embeds: [bagEmbed(text, GRABBED_COLOR).setFooter({ text: GRAB_FOOTER })], components: [], allowedMentions: { parse: [] } });
}

module.exports = { GRAB_ID, BAG_MIN, BAG_MAX, shouldDrop, rollSouls, dropBag, onGrab };
