const { ChannelType } = require('discord.js');
const { isAllowedGuild } = require('../utils/guild');
const { replyEmbed } = require('../utils/embeds');
const { pickRandom } = require('../utils/random');
const { isUnlocked } = require('../utils/memberRoles');

// The Shopkeeper walks a new member through the gate: #welcome -> (react in) #rules -> (pick a Patron in) #roles -> the whole server.
// {rules} / {roles} become channel links.
const WELCOME_LINES = [
  "Well, look what the cat dragged in! Pull up a crate and make yourself at home. First stop is {rules}, I run a tight shop. Read it over, then react to it so I know you did.",
  "Hey, hey, a new face! Welcome to the Cursed Apple, pal. Head over to {rules} and give it a read. When you're done, react to it and I'll point you to the next stop.",
  "Don't just stand in the doorway, you're lettin' the draft in! Come in, come in. {rules} is your first stop. Read it, react to it, and we'll get you sorted.",
  "A new customer! Business is lookin' up. Welcome to the Cursed Apple. Walk over to {rules}, read it through, and react when you're good with it.",
];
const RULES_LINES = [
  "Smart move, you read the fine print. Not many do. Next stop is {roles}. Pick your Patron there, and that's what opens up the rest of the shop.",
  "Good, a customer who reads. I like you already. Now go to {roles} and pick a Patron. Do that and I'll unlock the whole place for you.",
  "Rules, done. Easy, right? Next, {roles}. Choose your Patron, plus your region, rank and heroes if you're feelin' fancy.",
];
const SERVER_LINES = [
  "That's it, you're in! The whole Cursed Apple is yours to browse. Chat, play, hunt for a lobby, spend some souls. Just don't touch the merchandise unless you're buyin'.",
  "Look at that, a full-fledged Citizen! Every door in the shop is open to you now. Make yourself at home, and tell your friends the Shopkeeper sent ya.",
  "Welcome to the shop for real, pal! Everything's unlocked. Say hi in chat, grab a lobby, try your luck at the tables. First one's on the house. Okay, not really.",
];

const channelNamed = (guild, name) => guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText);
const fill = (guild, line) =>
  line.replace('{rules}', channelNamed(guild, 'rules') ?? '#rules').replace('{roles}', channelNamed(guild, 'roles') ?? '#roles');

// The #rules and #roles pointers clean themselves up (a reaction can't get a real private reply); the #welcome one stays.
const POINTER_LIFETIME_MS = 60_000;

// Pings the member in `channelName` with one of `lines` in an embed. Failures are logged, never thrown.
async function greet(member, channelName, title, lines, lifetimeMs) {
  const channel = channelNamed(member.guild, channelName);
  if (!channel) return;
  const message = await channel
    .send({
      content: `${member}`,
      embeds: [replyEmbed(fill(member.guild, pickRandom(lines))).setTitle(title)],
      allowedMentions: { users: [member.id] },
    })
    .catch((e) => console.error(`[welcome] post in #${channelName} failed:`, e.message));
  if (message && lifetimeMs) setTimeout(() => message.delete().catch(() => {}), lifetimeMs);
}

const rulesSent = new Set(); // ponytail: in memory, so a restart lets a member trigger it once more; harmless

module.exports = [
  {
    name: 'guildMemberAdd',
    async execute(member) {
      if (member.user.bot || !isAllowedGuild(member.guild.id)) return;
      await greet(member, 'welcome', 'Welcome To The Cursed Apple', WELCOME_LINES);
    },
  },
  {
    // Reacting with :souls: in #rules sends them on to #roles. Only members who aren't unlocked yet, once each.
    name: 'messageReactionAdd',
    async execute(reaction, user) {
      const channel = reaction.message.channel;
      if (user.bot || !channel.guild || !isAllowedGuild(channel.guild.id) || channel.name !== 'rules' || reaction.emoji.name !== 'souls' || rulesSent.has(user.id)) return;
      const member = await channel.guild.members.fetch(user.id).catch(() => null);
      if (!member || isUnlocked(member) || member.roles.cache.some((r) => r.name === 'Citizen of the Cursed Apple')) return;
      rulesSent.add(user.id);
      await greet(member, 'rules', "Next Stop, Readin' the Rules!", RULES_LINES, POINTER_LIFETIME_MS);
    },
  },
  {
    // Gaining Citizen (by picking a Patron in #roles) welcomes them to the whole server.
    name: 'guildMemberUpdate',
    async execute(old, member) {
      if (old.partial || !isAllowedGuild(member.guild.id)) return;
      const citizen = member.guild.roles.cache.find((r) => r.name === 'Citizen of the Cursed Apple');
      if (!citizen || old.roles.cache.has(citizen.id) || !member.roles.cache.has(citizen.id)) return;
      await greet(member, 'roles', "You're In, Citizen! Welcome To The Cursed Apple", SERVER_LINES, POINTER_LIFETIME_MS);
    },
  },
];
