// /shop-config (staff): which Shop sections are on, what each thing costs, the Hideout's level, and where Color Roles
// are made. Saved per server. A slash command: `data` is what Discord shows, `execute` runs when someone uses it.
// What the Shop does with these: utils/shop/shop.js. The settings: utils/shop/shopSettings.js.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { ITEMS, SECTION_NAMES, shopConfig, updateShopConfig } = require('../../utils/shop/shopSettings');
const { boldSouls } = require('../../utils/format');
const { MAX_LEVEL } = require('../../utils/economy/xp');

const choices = (obj, name) => Object.entries(obj).map(([value, v]) => ({ name: name(v), value }));

// The private summary: each section on or off, every price (default marked), the level and the Color Role spot.
async function summary(guild) {
  const cfg = await shopConfig(guild.id);
  const sections = Object.entries(SECTION_NAMES).map(([key, label]) => `${cfg.on(key) ? 'On' : 'Off'}: **${label}**`);
  const prices = Object.entries(ITEMS).map(([key, item]) => `${item.label}: ${boldSouls(cfg.price(key))}${cfg.price(key) === item.price ? '' : ' (changed)'}`);
  const below = cfg.colorBelow && guild.roles.cache.get(cfg.colorBelow);
  return [
    '**Sections**', ...sections, '',
    '**Prices**', ...prices, '',
    `**Hideout Level:** ${cfg.hideoutLevel}`,
    `**Color Roles Go Under:** ${below ? `${below}` : "The Shopkeeper's top role"}`,
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop-config')
    .setDescription('Staff: set up the Shop')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('show').setDescription('Every Shop section and price'))
    .addSubcommand((s) =>
      s
        .setName('section')
        .setDescription('Put a Shop section on the shelf or take it off')
        .addStringOption((o) => o.setName('section').setDescription('Which section').setRequired(true).addChoices(...choices(SECTION_NAMES, (n) => n)))
        .addBooleanOption((o) => o.setName('on').setDescription('On sale?').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('price')
        .setDescription("Set what something costs in this server's Shop")
        .addStringOption((o) => o.setName('item').setDescription('Which item').setRequired(true).addChoices(...choices(ITEMS, (i) => i.label)))
        .addIntegerOption((o) => o.setName('souls').setDescription('Price in Souls (leave empty to go back to the usual price)').setMinValue(1).setMaxValue(1_000_000_000)),
    )
    .addSubcommand((s) =>
      s
        .setName('hideout-level')
        .setDescription('The level a member needs to buy a Hideout')
        .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(0).setMaxValue(MAX_LEVEL)),
    )
    .addSubcommand((s) =>
      s
        .setName('color-below')
        .setDescription('New Color Roles are made just under this role (leave empty for my top role)')
        .addRoleOption((o) => o.setName('role').setDescription('A staff role works well')),
    ),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const { guild, options } = interaction;
    const sub = options.getSubcommand();
    if (sub === 'show') return privateReply(interaction, await summary(guild));

    let line;
    if (sub === 'section') {
      const key = options.getString('section');
      const on = options.getBoolean('on');
      await updateShopConfig(guild.id, (s) => ({ ...s, off: on ? (s.off ?? []).filter((k) => k !== key) : [...new Set([...(s.off ?? []), key])] }));
      line = `**${SECTION_NAMES[key]}** is ${on ? 'on the shelf' : 'off the shelf'}.`;
    } else if (sub === 'price') {
      const key = options.getString('item');
      const souls = options.getInteger('souls');
      await updateShopConfig(guild.id, (s) => {
        const prices = { ...s.prices };
        if (souls === null) delete prices[key];
        else prices[key] = souls;
        return { ...s, prices };
      });
      line = souls === null ? `**${ITEMS[key].label}** is back to ${boldSouls(ITEMS[key].price)}.` : `**${ITEMS[key].label}** now costs ${boldSouls(souls)}.`;
    } else if (sub === 'hideout-level') {
      const level = options.getInteger('level');
      await updateShopConfig(guild.id, (s) => ({ ...s, hideoutLevel: level }));
      line = `A Hideout needs **Level ${level}** now.`;
    } else {
      const role = options.getRole('role');
      await updateShopConfig(guild.id, (s) => ({ ...s, colorBelow: role?.id ?? null }));
      line = role ? `New Color Roles go just under ${role}.` : "New Color Roles go just under my top role.";
    }
    return privateReply(interaction, line);
  },
};
