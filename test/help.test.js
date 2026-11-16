// /help (utils/help.js): every command has a page, every page fits Discord's limits, and members don't see what they can't use.
const test = require('./group')(__filename);
const assert = require('node:assert');
const { PermissionsBitField } = require('discord.js');
const { loadCommands } = require('../src/handlers/loadCommands');
const { book, helpView } = require('../src/utils/help');

const commands = loadCommands();
const staff = { guild: null, home: true, perms: new PermissionsBitField(PermissionsBitField.All), commands };
const member = { guild: null, home: false, perms: new PermissionsBitField(), commands };

const embedSize = (e) => (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

test('every command has a help page, and every page names a real command', () => {
  const named = book(staff).flatMap((c) => c.pages).map((p) => p.command).filter(Boolean);
  for (const name of commands.keys()) assert.ok(named.includes(name), `/${name} has no help page`);
  for (const name of named) assert.ok(commands.has(name), `help names /${name}, which doesn't exist`);
});

test("every page fits Discord's limits, for staff and members", () => {
  for (const ctx of [staff, member]) {
    const categories = book(ctx);
    assert.ok(categories.length <= 25);
    for (const cat of categories) {
      assert.ok(cat.pages.length <= 25, `${cat.label} has ${cat.pages.length} pages`);
      assert.ok(cat.about.length <= 100);
      cat.pages.forEach((page, i) => {
        const view = helpView(ctx, '123456789012345678', cat.key, i);
        const embed = view.embeds[0].toJSON();
        assert.strictEqual(embed.title, page.title);
        assert.ok(embed.description.length <= 4096, page.title);
        assert.ok((embed.fields ?? []).length <= 25, page.title);
        for (const f of embed.fields ?? []) assert.ok(f.value.length <= 1024 && f.name.length <= 256, `${page.title}: ${f.name}`);
        assert.ok(embedSize(embed) <= 6000, `${page.title} is ${embedSize(embed)} characters`);
        assert.ok(!/undefined|NaN/.test(JSON.stringify(embed)), `${page.title} has a missing number`);
        for (const row of view.components) for (const c of row.toJSON().components) assert.ok(c.custom_id.length <= 100);
      });
    }
  }
});

test("members don't see staff commands", () => {
  const named = book(member).flatMap((c) => c.pages).map((p) => p.command).filter(Boolean);
  for (const name of ['xp', 'xp-config', 'lfg-config', 'audit-log-config', 'farm-config', 'reaction-roles']) assert.ok(!named.includes(name), name);
  assert.ok(!book(member).some((c) => c.key === 'staff'));
  assert.ok(book(member).flatMap((c) => c.pages).some((p) => p.title.includes('Hideout')), 'Hideouts are in every server');
  const index = book(member).find((c) => c.key === 'xp').pages.findIndex((p) => p.command === 'souls');
  const fields = helpView(member, '1', 'xp', index).embeds[0].toJSON().fields;
  assert.ok(fields.some((f) => f.value.includes('/souls balance')));
  assert.ok(!fields.some((f) => f.value.includes('reset-all')), 'staff subcommands hidden from members');
});
