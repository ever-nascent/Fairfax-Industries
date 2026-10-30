// /souls reset-all: every member's server balance to 0 (staff, with a Confirm button; Hero Farming's hero souls are separate and stay).
// The prompt is built here; the buttons are components/soulsReset.js. A copy of xp.json and the ledger is saved first in data/resetBackups/<time>/.
const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { DATA_DIR, flushPending } = require('../../storage/jsonAdapter');
const { replyEmbed } = require('../embeds');
const { fmt, boldSouls } = require('../format');
const { totalSouls } = require('./xp');

const RESET_ID = 'soulsreset';

async function prompt(interaction) {
  const { members, souls } = await totalSouls();
  if (!members) return { embeds: [replyEmbed('Nobody has any souls to reset.')], flags: MessageFlags.Ephemeral };
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${RESET_ID}:${interaction.user.id}:yes`).setLabel('Reset Everyone').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${RESET_ID}:${interaction.user.id}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const text = `This sets the server balance of **${fmt(members)} members** (${boldSouls(souls)} in all) to 0. Hero Farming hero souls stay. A copy of the souls files is saved first.`;
  return { embeds: [replyEmbed(text)], components: [row], flags: MessageFlags.Ephemeral };
}

// Copies the souls files to data/resetBackups/<time>/ (so a mistake can be put back by hand). Returns the folder.
function saveCopy(now = new Date()) {
  flushPending(); // chat XP is held in memory for a few seconds
  const dir = path.join(DATA_DIR, 'resetBackups', now.toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['xp.json', 'soulsLedger.jsonl']) if (fs.existsSync(path.join(DATA_DIR, file))) fs.copyFileSync(path.join(DATA_DIR, file), path.join(dir, file));
  return dir;
}

module.exports = { RESET_ID, prompt, saveCopy };
