const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const dotenv = require('dotenv');
const getAllFiles = require('./src/getAllFiles');

dotenv.config();
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const commands = [];
const commandFiles = getAllFiles('./commands', '.js');

for (const file of commandFiles) {
    const commandPath = path.resolve(file[0]);
    const command = require(commandPath);
    const commandData = command.data.toJSON();

    if (commandData.default_member_permissions === '0') {
        delete commandData.default_member_permissions;
    }

    commands.push(commandData);
}
const rest = new REST({ version: '10' }).setToken(token);
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        const existingCommands = await rest.get(Routes.applicationCommands(clientId));
        const duplicates = existingCommands.filter(existingCmd =>
            commands.some(newCmd => newCmd.name === existingCmd.name && newCmd.id !== existingCmd.id)
        );
        for (const duplicate of duplicates) {
            await rest.delete(Routes.applicationCommand(clientId, duplicate.id));
            console.log(`Deleted duplicate command: ${duplicate.name}`);
        }
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
        console.table(commands.map(cmd => ({
            name: cmd.name,
            description: cmd.description,
            permissions: cmd.default_member_permissions || 'Everyone'
        })));

    } catch (error) {
        console.error(error);
    }
})();