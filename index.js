require('dotenv').config();
const { handleMessage } = require('./services/messageHandler');
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, Events } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { 
	migrate,
} = require('./config/database');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
	console.error('Who is the dumb fuck that forgot to set DISCORD_TOKEN or DISCORD_CLIENT_ID in the environment?');
	process.exit(1);
}

const client = new Client({
	intents: [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	],
	partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.commands = new Collection();

function loadCommands() {
	const commandsDir = path.join(__dirname, 'commands');
	if (!fs.existsSync(commandsDir)) return [];
	const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
	const slashDefinitions = [];
	for (const file of commandFiles) {
		const command = require(path.join(commandsDir, file));
		if (command && command.data && command.execute) {
			client.commands.set(command.data.name, command);
			slashDefinitions.push(command.data.toJSON());
		}
	}
	return slashDefinitions;
}

async function registerSlashCommands(definitions) {
	const rest = new REST({ version: '10' }).setToken(TOKEN);
	if (!definitions || definitions.length === 0) {
		console.log('No slash commands to register.');
		return;
	}
	if (DEV_GUILD_ID) {
		console.log(`Registering ${definitions.length} commands for guild ${DEV_GUILD_ID} (fast)`);
		await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body: definitions });
	} else {
		console.log(`Registering ${definitions.length} global commands (may take up to 1 hour to appear)`);
		await rest.put(Routes.applicationCommands(CLIENT_ID), { body: definitions });
	}
}


client.once(Events.ClientReady, async () => {
	console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
	try {
		await handleMessage(message);
	} catch (error) {
		console.error("An error occurred within the message handler:", error);
	}
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = client.commands.get(interaction.commandName);
	if (!command) return;
	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({ content: 'There was an error executing this command.' });
		} else {
			await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
		}
	}
});


(async () => {
	try {
		await migrate();
		console.log('Database migration complete.');
		
		const slashDefs = loadCommands();
		await registerSlashCommands(slashDefs);
		await client.login(TOKEN);
	} catch (err) {
		console.error('Startup error:', err);
		process.exit(1);
	}
})();
