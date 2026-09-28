const { buildGreetingCommand, executeGreetingCommand } = require('../../utils/greetings');

module.exports = {
  data: buildGreetingCommand('goodbye'),
  async execute(interaction) {
    await executeGreetingCommand(interaction, 'goodbye');
  },
};
