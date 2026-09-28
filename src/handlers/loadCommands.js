const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function loadCommands() {
  const commands = new Map();

  for (const category of fs.readdirSync(COMMANDS_DIR)) {
    const categoryPath = path.join(COMMANDS_DIR, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    for (const file of fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'))) {
      const command = require(path.join(categoryPath, file));
      if (!command?.data || !command?.execute) {
        console.warn(`[commands] Skipping ${file}: missing "data" or "execute"`);
        continue;
      }
      commands.set(command.data.name, command);
    }
  }

  return commands;
}

module.exports = { loadCommands };
