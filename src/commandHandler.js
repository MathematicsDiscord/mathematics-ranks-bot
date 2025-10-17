const getAllFiles = require('./getAllFiles');
const path = require('path');

module.exports = (client, Collection, options = {}) => {
    const { commandsDir } = options;

    if (!commandsDir || typeof commandsDir !== 'string') {
        console.error('Invalid commandsDir:', commandsDir);
        return;
    }

    console.log('Command directory:', commandsDir);

    const commands = new Collection();
    const commandFiles = getAllFiles(commandsDir, '.js');

    if (commandFiles.length === 0) {
        console.warn('No command files found in the specified directory.');
        return;
    }

    for (const file of commandFiles) {
        const command = require(file[0]);
        if ('data' in command && 'execute' in command) {
            commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${file[0]} is missing a required "data" or "execute" property.`);
        }
    }

    client.commands = commands;

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        const command = commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    });
}