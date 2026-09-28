const { buildGreetingCommand, executeGreetingCommand } = require('../../utils/greetings');

module.exports = {
  data: buildGreetingCommand('welcome'),
  async execute(interaction) {
    await executeGreetingCommand(interaction, 'welcome');
  },
};
