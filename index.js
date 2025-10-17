const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType, WebhookClient, ChannelType, escapeMarkdown } = require('discord.js');
const commandHandler = require('./src/commandHandler');
const dotenv = require('dotenv');
const path = require('path');
const { exec } = require('child_process');
const database = require('./database');
const fs = require('fs');
const closedThreads = new Set();
const rankSystem = require('./rankSystem');
const { createRankApplicationModal, handleApplicationSubmit, handleApplicationDecision, createFeedbackModal, handleFeedbackSubmit } = require('./rankSystem');
const cron = require('node-cron');

function parseIdList(envVar) {
    return (envVar || '')
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
}


async function reportError(client, error, context = '') {
    const errorChannel = client.channels.cache.get(process.env.ERROR_CHANNEL_ID);
    if (!errorChannel) {
        console.error('Error reporting channel not found. Check your ERROR_CHANNEL_ID in .env');
        return;
    }

    const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Bot Error')
        .setDescription(`An error occurred in the bot:\n\`\`\`${error.stack || error}\`\`\``)
        .addFields({ name: 'Context', value: context || 'No context provided' })
        .setTimestamp();

    await errorChannel.send({ embeds: [errorEmbed] });
}
async function startBot() {
    dotenv.config();
    const token = process.env.TOKEN;
    const STAFF_OR_ADMIN_ROLE_IDS = parseIdList(process.env.STAFF_OR_ADMIN_ROLE_IDS);
    if (!process.env.VOLUNTEER_HELPER_ROLE_ID) {
        console.warn('[Config] VOLUNTEER_HELPER_ROLE_ID not set. Volunteer helper related features may not work correctly.');
    }
    if (STAFF_OR_ADMIN_ROLE_IDS.length === 0) {
        console.warn('[Config] STAFF_OR_ADMIN_ROLE_IDS not set. Only Administrator permission will count as staff/admin.');
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildScheduledEvents,
        ]
    });
    process.on('unhandledRejection', async (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        await reportError(client, reason, 'Unhandled Promise Rejection');
    });

    process.on('uncaughtException', async (error) => {
        console.error('Uncaught Exception:', error);
        await reportError(client, error, 'Uncaught Exception');
        process.exit(1);
    });

    client.on('error', async (error) => {
        console.error('Discord.js Error:', error);
        await reportError(client, error, 'Discord.js Client Error');
    });

    function runDeployCommands() {
        return new Promise((resolve, reject) => {
            exec('node deploy-commands.js', (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error executing deploy-commands.js: ${error}`);
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                    }
                    reject(error);
                    return;
                }
                console.log(`deploy-commands.js output: ${stdout}`);
                resolve();
            });
        });
    }

    await database.initDatabase();
    await runDeployCommands();

    const commandsDir = path.join(__dirname, 'commands');

    if (!fs.existsSync(commandsDir)) {
        console.error('Commands directory does not exist:', commandsDir);
        process.exit(1);
    }

    commandHandler(client, Collection, {
        commandsDir: commandsDir,
    });
    function cleanupClosedThreads() {
        for (const threadId of closedThreads) {
            const thread = client.channels.cache.get(threadId);
            if (!thread || thread.archived) {
                closedThreads.delete(threadId);
            }
        }
    }

    cron.schedule('0 * * * *', () => {
        checkOpenThreadsAndSendReminders(client).catch(error => {
            console.error('Error in checkOpenThreadsAndSendReminders:', error);
            reportError(client, error, 'Scheduled thread reminder check');
        });
    });

    client.on('messageCreate', async (message) => {
        try {
            
            if (message.author.bot) return;

            if (message.channel.isThread() && 
                (message.channel.parentId === process.env.HELP_SCHOOL_FORUM_ID || 
                 message.channel.parentId === process.env.HELP_UNIVERSITY_FORUM_ID)) {
                
                const starterMessage = await message.channel.fetchStarterMessage();
                const isPostCreator = message.author.id === starterMessage.author.id;
                
                const hasVolunteerHelperRole = process.env.VOLUNTEER_HELPER_ROLE_ID ?
                    message.member?.roles.cache.has(process.env.VOLUNTEER_HELPER_ROLE_ID) : false;
                
                if (!isPostCreator && !hasVolunteerHelperRole) {
                    // Store the message content before deleting it
                    const deletedMessageContent = message.content || '*(No text content)*';
                    const deletedMessageAttachments = message.attachments.size > 0 ? 
                        Array.from(message.attachments.values()).map(att => att.url).join('\n') : null;
                    
                    await message.delete();
                    
                    const helpEmbed = new EmbedBuilder()
                        .setColor('#FF6B6B')
                        .setTitle('🚫 Message Removed')
                        .setDescription('Your message was removed because you need the **Volunteer Helper** role to assist in help threads.')
                        .addFields(
                            { name: 'Your Deleted Message:', value: deletedMessageContent.length > 1024 ? deletedMessageContent.substring(0, 1021) + '...' : deletedMessageContent },
                            { name: 'How to become a **Volunteer Helper**?', value: 'You can become a Volunteer Helper by clicking the button below; however, you must first agree to a list of regulations before the role is provided to you.' }
                        )
                        .setFooter({ text: 'Thank you for your interest in helping others!' })
                        .setTimestamp();

                    // Add attachments field if there were any
                    if (deletedMessageAttachments) {
                        helpEmbed.addFields({ name: 'Attachments in Deleted Message:', value: deletedMessageAttachments.length > 1024 ? deletedMessageAttachments.substring(0, 1021) + '...' : deletedMessageAttachments });
                    }

                    const becomeHelperButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('become_volunteer_helper')
                                .setLabel('Become Volunteer Helper')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('🤝')
                        );

                    try {
                        await message.author.send({
                            embeds: [helpEmbed],
                            components: [becomeHelperButton]
                        });
                    } catch (dmError) {
                        console.error(`Could not send DM to ${message.author.tag}:`, dmError);
                            
                        const tempMessage = await message.channel.send({
                            content: `${message.author}, your message was removed. Please check your DMs for more information about becoming a Volunteer Helper.`,
                            embeds: [helpEmbed],
                            components: [becomeHelperButton]
                        });
                        
                        setTimeout(async () => {
                            try {
                                await tempMessage.delete();
                            } catch (deleteError) {
                                console.error('Error deleting temporary message:', deleteError);
                            }
                        }, 30000);
                    }
                    
                    return;
                }
            }

            if (message.content.toLowerCase() === '+close') {
                if (message.channel.isThread()) {
                    if (message.channel.parentId === process.env.HELP_SCHOOL_FORUM_ID ||
                        message.channel.parentId === process.env.HELP_UNIVERSITY_FORUM_ID) {
                        const isThreadCreator = message.author.id === message.channel.ownerId;
                        const isStaffOrAdmin = (
                            STAFF_OR_ADMIN_ROLE_IDS.some(id => message.member.roles.cache.has(id)) ||
                            message.member.permissions.has('Administrator')
                        );

                        if (isThreadCreator) {
                            if (closedThreads.has(message.channel.id)) {
                                await message.reply("You have already executed this command; please press \"Close Post\" to close your help query.");
                                return;
                            }
                            await handleCloseCommand(message);
                            closedThreads.add(message.channel.id);
                        } else if (isStaffOrAdmin) {
                            await closeThreadDirectly(message);
                            closedThreads.delete(message.channel.id);
                        } else {
                            await message.reply("You are not authorised to close this help request!");
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in messageCreate event:', error);
            await reportError(client, error, `messageCreate event: ${message.content}`);
            try {
                await message.reply("An error occurred while processing your command. Managers have been notified.");
            } catch (replyError) {
                console.error('Failed to send error message to user:', replyError);
            }
        }
    });

    client.on('messageDelete', async (message) => {
        try {
            if (!message.channel.isThread()) return;

            if (message.channel.parentId !== process.env.HELP_SCHOOL_FORUM_ID &&
                message.channel.parentId !== process.env.HELP_UNIVERSITY_FORUM_ID) return;

            const thread = message.channel;
            try {
                const starterMessage = await thread.fetchStarterMessage();
                if (!starterMessage) {
                    await closeThreadAutomatically(thread);
                }
            } catch (error) {
                if (error.code === 10008) {
                    await closeThreadAutomatically(thread);
                } else {
                    console.error('Error fetching starter message:', error);
                    await reportError(client, error, `Fetch starter message: ${thread.id}`);
                }
            }
        } catch (error) {
            console.error('Error in messageDelete event:', error);
            await reportError(client, error, `messageDelete event: ${message.id}`);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton() && !interaction.isModalSubmit()) return;

            if (interaction.isButton()) {
                if (interaction.customId.startsWith('rank_application_') || interaction.customId.startsWith('reapply_rank_application_')) {
                    const rank = interaction.customId.split('_').pop();
                    const modal = createRankApplicationModal(rank);
                    await interaction.showModal(modal);
                } else if (interaction.customId.startsWith('thank_')) {
                    await handleThankButton(interaction);
                } else if (interaction.customId === 'close_post') {
                    await handleClosePost(interaction);
                } else if (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('decline_')) {
                    await handleApplicationDecision(interaction);
                } else if (interaction.customId.startsWith('feedback_')) {
                    const [_, userId, rank] = interaction.customId.split('_');
                    await interaction.showModal(createFeedbackModal(userId, rank));
                } else if (interaction.customId.startsWith('still_need_help_')) {
                    await handleStillNeedHelpButton(interaction);
                } else if (interaction.customId === 'become_volunteer_helper') {
                    await handleBecomeVolunteerHelper(interaction);
                } else if (interaction.customId === 'agree_helper_guidelines') {
                    await handleAgreeHelperGuidelines(interaction);
                } else if (interaction.customId === 'disagree_helper_guidelines') {
                    await handleDisagreeHelperGuidelines(interaction);
                }
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('rank_application_modal_')) {
                    await handleApplicationSubmit(interaction);
                } else if (interaction.customId.startsWith('feedback_modal_')) {
                    await handleFeedbackSubmit(interaction);
                }
            }
        } catch (error) {
            console.error('Error in interactionCreate event:', error);
            await reportError(client, error, `interactionCreate event: ${interaction.customId}`);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: "An error occurred while processing your interaction. Our Dev admin has been notified.", ephemeral: true });
                } else {
                    await interaction.reply({ content: "An error occurred while processing your interaction. Our Dev admin has been notified.", ephemeral: true });
                }
            } catch (replyError) {
                console.error('Failed to send error message to user:', replyError);
            }
        }
    });

    client.on('guildMemberRemove', async (member) => {
        try {
            await closeThreadsForLeavingMember(member);
        } catch (error) {
            console.error('Error in guildMemberRemove event:', error);
            await reportError(client, error, `guildMemberRemove event: ${member.id}`);
        }
    });

    client.on('threadCreate', async (thread) => {
        try {
            if (thread.parentId === process.env.HELP_SCHOOL_FORUM_ID || 
                thread.parentId === process.env.HELP_UNIVERSITY_FORUM_ID) {
                
                const ownerId = thread.ownerId;
                if (!ownerId) {
                    console.log(`Thread ${thread.id} in ${thread.parent.name} was created without an owner.`);
                    return;
                }
    
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('👋 Welcome to your Help Thread!')
                    .setDescription(`Hey <@${ownerId}>,  Thanks for sharing your math problem with us.  While you wait for a Helper to help you, we want to share some vital information with you.`)
                    .addFields(
                        { name: '●', value: 'Please take a moment to read the [helpee guidelines](https://discord.com/channels/624314920158232616/1378764024094920856). This will make sure that your post follows the helpee rules of our community. ', inline: true },
                        { name: '●', value: 'Please don\'t ping <@&775784618955505685>, <@&1283689826742440016>, <@&819616364188139550>, or <@&624327278137966593> for help because their job is to take care of the server\'s administrative tasks, not to answer queries directly. However, if you have a problem with how a Helper is acting, you can ping a Helper Moderator.  ', inline: true },
                        { name: '●', value: 'It\'s always very useful if you can show us the work you\'ve done so far. This makes it easier for our Helpers to find mistakes and help you get to the right answer.  ', inline: true },
                    )
                    .setFooter({ text: 'Once you\'ve got your answer and you\'re all set, you can close this thread by typing +close, and then you can click the Thank buttons to show your Helper some appreciation.' })
                    .setTimestamp();

                const PatreonLink = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Support us on Patreon')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://www.patreon.com/mathsdiscord')
                );

                const welcomeMessage = await thread.send({
                    embeds: [welcomeEmbed],
                    components: [PatreonLink],
                });
    
                await welcomeMessage.pin();
            }
        } catch (error) {
            console.error('Error in threadCreate event:', error);
            await reportError(client, error, `threadCreate event for thread: ${thread.id}`);
        }
    });

    await client.login(token);
    console.log('Bot is now online!');
    client.user.setActivity('Mathematics', { type: ActivityType.Playing });
    setInterval(cleanupClosedThreads, 3600000);
}

async function handleCloseCommand(message) {
    console.log('Handling close command');
    if (closedThreads.has(message.channel.id)) {
        await message.reply("This thread has already been closed.");
        return;
    }
    const helperRole = message.guild.roles.cache.get(process.env.VOLUNTEER_HELPER_ROLE_ID);

    if (!helperRole) {
        console.error('Helper role not found. Role ID:', process.env.VOLUNTEER_HELPER_ROLE_ID);
        await message.reply("Error: Helper role not found. Please contact an administrator.");
        return;
    }
    console.log('Helper role found:', helperRole.name);

    const helpers = new Set();
    let lastId;
    let messageCount = 0;
    const fetchLimit = 100;
    const totalMessagesToFetch = 200;

    let loadingMessage = await message.reply("<a:loading:1304440347979419729>| Loading, please wait...");

    while (messageCount < totalMessagesToFetch) {
        const options = { limit: fetchLimit };
        if (lastId) options.before = lastId;

        if (messageCount > 0 && messageCount % 100 === 0) {
            await loadingMessage.edit(`<a:loading:1304440347979419729>| Just a little longer...`);
        }
        const messages = await message.channel.messages.fetch(options);
        if (messages.size === 0) break;
        messages.forEach(msg => {
            if (msg.member &&
                msg.member.roles.cache.has(helperRole.id) &&
                msg.author.id !== message.author.id &&
                msg.author.id !== message.client.user.id) {
                helpers.add(msg.member);
            }
        });
        messageCount += messages.size;
        lastId = messages.last().id;
        if (messages.size < fetchLimit) break;
    }
    console.log(`Processed ${messageCount} messages. Eligible helpers:`, helpers.size);
    await loadingMessage.delete();
    if (helpers.size === 0) {
        const embed = new EmbedBuilder()
            .setColor('#1e1f22')
            .setTitle('Do you still want to close your help request?')
            .setDescription("No eligible helpers were found in this thread. You can still close this post if you don't require helper any longer.");

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_post')
                    .setLabel('Close Post')
                    .setStyle(ButtonStyle.Danger)
            );

        await message.reply({ embeds: [embed], components: [row] });
        closedThreads.add(message.channel.id);
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#1e1f22')
        .setTitle('Please thank your Helpers before closing!')
        .setDescription('Please thank the helpers who assisted you by clicking the buttons below. You can thank each helper only once. Once you\'re done, click "Close Post" to close this thread.');

    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;

    helpers.forEach(helper => {
        if (buttonCount === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
        }
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`thank_${helper.id}`)
                .setLabel(`Thank ${helper.displayName}`)
                .setStyle(ButtonStyle.Primary)
        );
        buttonCount++;
    });
    if (buttonCount > 0) {
        rows.push(currentRow);
    }
    const closeButtonRow = rows[rows.length - 1].components.length < 5 ? rows[rows.length - 1] : new ActionRowBuilder();
    closeButtonRow.addComponents(
        new ButtonBuilder()
            .setCustomId('close_post')
            .setLabel('Close Post')
            .setStyle(ButtonStyle.Danger)
    );

    if (closeButtonRow !== rows[rows.length - 1]) {
        rows.push(closeButtonRow);
    }

    await message.reply({ embeds: [embed], components: rows });
    closedThreads.add(message.channel.id);
}
async function closeThreadDirectly(message) {
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('<:closed:1306624376028004362> | Help Request Closed.')
        .setDescription('Your thread has been closed by a staff member. If you believe that this action is unjustified or that abuse was involved, please contact the Managers.')
        .setTimestamp();
    await message.reply({ embeds: [embed] });
    await message.channel.setLocked(true);
    await message.channel.setArchived(true);
}

async function closeThreadAutomatically(thread) {
    try {
        const closeEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('<:closed:1306624376028004362> | Help Request Closed')
            .setDescription('This thread is being closed automatically as the starter message was deleted.')
            .setTimestamp();

        await thread.send({ embeds: [closeEmbed] });
        await thread.setLocked(true);
        await thread.setArchived(true);
        closedThreads.add(thread.id);
    } catch (error) {
        console.error('Error closing thread automatically:', error);
        await reportError(client, error, `Automatic thread closure: ${thread.id}`);
    }
}

async function closeThreadsForLeavingMember(member) {
    const helpForums = [
        process.env.HELP_SCHOOL_FORUM_ID,
        process.env.HELP_UNIVERSITY_FORUM_ID
    ];
    for (const forumId of helpForums) {
        const forum = await member.guild.channels.fetch(forumId);
        if (!forum) continue;
        const threads = await forum.threads.fetchActive();
        for (const thread of threads.threads.values()) {
            if (thread.ownerId === member.id) {
                try {
                    const closeEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('<:closed:1306624376028004362> | Help Request Closed')
                        .setDescription('This thread is being closed automatically as the thread creator has left the server.')
                        .setTimestamp();
                    await thread.send({ embeds: [closeEmbed] });
                    await thread.setLocked(true);
                    await thread.setArchived(true);
                    closedThreads.add(thread.id);
                } catch (error) {
                    console.error(`Error closing thread ${thread.id} for leaving member:`, error);
                    await reportError(client, error, `Automatic thread closure for leaving member: ${member.id}, thread: ${thread.id}`);
                }
            }
        }
    }
}
async function handleThankButton(interaction) {
    try {
        const threadStarterMessage = await interaction.channel.fetchStarterMessage();
        if (interaction.user.id !== threadStarterMessage.author.id) {
            await interaction.reply({ content: 'Only the user who created this thread can thank helpers.', ephemeral: true });
            return;
        }
        const helperId = interaction.customId.split('_')[1];
        const helper = await interaction.guild.members.fetch(helperId);

        if (!helper) {
            await interaction.reply({ content: 'Helper not found.', ephemeral: true });
            return;
        }
        const safeDisplayName = escapeMarkdown(helper.displayName.replace(/@/g, '@\u200b'));
        const message = await interaction.message.fetch();
        const rows = message.components.map(row => ActionRowBuilder.from(row));
        let buttonFound = false;
        for (const row of rows) {
            const buttonIndex = row.components.findIndex(c => c.data.custom_id === interaction.customId);
            if (buttonIndex !== -1) {
                row.components[buttonIndex] = ButtonBuilder.from(row.components[buttonIndex]).setDisabled(true);
                buttonFound = true;
                break;
            }
        }
        if (!buttonFound) {
            await interaction.reply({ content: 'Button not found.', ephemeral: true });
            return;
        }
        const parentForumId = interaction.channel.parentId;
        console.log(`Thank button clicked in thread with parent forum ID: ${parentForumId}`);
        const pointAddResult = await database.addPoint(helperId, parentForumId);
        if (!pointAddResult.success) {
            let replyMessage;
            if (pointAddResult.reason === 'max_points') {
                replyMessage = `Thank you for your feedback, but ${safeDisplayName} has already reached the maximum amount of <:helper_points:1299339613713989674> they can gain.`;
            } else if (pointAddResult.reason === 'daily_limit') {
                replyMessage = `${safeDisplayName} Thank you for helping our users, however our Mathematics Team cares about the health of its members, so you can no longer receive <:helper_points:1299339613713989674> since you surpassed your daily limit, but don't worry, it will be reset tomorrow.`;
            } else {
                replyMessage = 'An unexpected error occurred. Please try again later.';
            }
            await interaction.reply(replyMessage);
        } else {
            const { updatedPoints, remainingDailyPoints } = pointAddResult;
            await interaction.reply(`Thank you for your feedback! ${safeDisplayName} has been awarded 1 <:helper_points:1299339613713989674>. They now have ${updatedPoints} <:helper_points:1299339613713989674>. They have ${remainingDailyPoints} <:helper_points:1299339613713989674> daily left for today.`);
            await rankSystem.checkRankUp(interaction.client, helperId, interaction.guild.id);
        }
        await interaction.message.edit({ components: rows });
        const logChannelId = process.env.THANK_LOG_CHANNEL_ID;
        if (logChannelId) {
            const logChannel = await interaction.client.channels.fetch(logChannelId);
            if (logChannel && logChannel.type === ChannelType.GuildText) {
                const threadLink = interaction.channel.isThread() ? `<#${interaction.channel.id}>` : 'a non-thread channel';
                let forumType = 'Unknown Forum';
                if (interaction.channel.parentId === process.env.HELP_SCHOOL_FORUM_ID) {
                    forumType = 'School Help Forum';
                } else if (interaction.channel.parentId === process.env.HELP_UNIVERSITY_FORUM_ID) {
                    forumType = 'University Help Forum';
                }
                await logChannel.send(
                    `${helper} has been thanked in ${threadLink} (${interaction.channel.name}) in the ${forumType}.`
                );
            } else {
                console.error('Thank-you log channel not found or is not a text channel.');
            }
        } else {
            console.error('THANK_LOG_CHANNEL_ID not set in .env file.');
        }

    } catch (error) {
        console.error('Error updating points:', error);
        await interaction.reply({ content: 'An error occurred while updating <:helper_points:1299339613713989674>. Please try again later or contact an administrator.', ephemeral: true });
    }
}

async function handleClosePost(interaction) {
    try {
        const threadStartMessage = await interaction.channel.fetchStarterMessage();
        if (interaction.user.id !== threadStartMessage.author.id) {
            await interaction.reply({ content: 'Only the user who created this post can close it.', ephemeral: true });
            return;
        }
        if (interaction.channel.archived) {
            await interaction.user.send('This post is already closed and archived.');
            await interaction.deferUpdate();
            return;
        }
        const closeEmbed = new EmbedBuilder()
            .setColor('#c90505')
            .setTitle('<:closed:1306624376028004362> | Help Request Closed')
            .setDescription('This post has been closed and archived. Thank you for using our help system!')
            .setTimestamp();
        await interaction.reply({ embeds: [closeEmbed] });
        await interaction.channel.setLocked(true);
        await interaction.channel.setArchived(true);

    } catch (error) {
        console.error('Error closing post:', error);
        if (error.code === 50083) {
            try {
                await interaction.user.send('This post is already closed and archived.');
                await interaction.deferUpdate();
            } catch (dmError) {
                console.error('Failed to send DM to user:', dmError);
                await interaction.reply({ content: 'This post is already closed and archived.', ephemeral: true });
            }
        } else if (error.code === 10062) {
            console.error('Interaction expired or not found. Unable to respond to the user.');
        } else {
            try {
                await interaction.reply({ content: 'An error occurred while closing the post. Please try again later or contact an administrator.', ephemeral: true });
            } catch (replyError) {
                console.error('Failed to send error message to user:', replyError);
            }
        }
    }
}

async function checkOpenThreadsAndSendReminders(client) {
    try {
        const helpSchoolForum = await client.channels.fetch(process.env.HELP_SCHOOL_FORUM_ID);
        const helpUniversityForum = await client.channels.fetch(process.env.HELP_UNIVERSITY_FORUM_ID);
        const forums = [helpSchoolForum, helpUniversityForum];
        for (const forum of forums) {
            try {
                const threads = await forum.threads.fetchActive();
                for (const thread of threads.threads.values()) {
                    try {
                        const updatedThread = await thread.fetch();
                        if (updatedThread.pinned) {
                            continue;
                        }
                        if (!updatedThread.archived && !updatedThread.locked) {
                            let lastMessage;
                            try {
                                lastMessage = await fetchWithRetry(() => updatedThread.messages.fetch({ limit: 1 }), 3)
                                    .then(messages => messages.first());
                            } catch (fetchError) {
                                console.error(`Error fetching last message for thread ${updatedThread.id}:`, fetchError);
                                await reportError(client, fetchError, `Fetching last message in checkOpenThreadsAndSendReminders: ${updatedThread.id}`);
                                continue;
                            }
                            const lastActivityTime = lastMessage ? lastMessage.createdTimestamp : updatedThread.createdTimestamp;
                            const inactiveTime = Date.now() - lastActivityTime;
                            let reminderMessage;
                            try {
                                reminderMessage = await fetchWithRetry(() => updatedThread.messages.fetch({ limit: 100 }), 3)
                                    .then(messages => messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title.includes('Help Reminder')));
                            } catch (fetchError) {
                                console.error(`Error fetching reminder message for thread ${updatedThread.id}:`, fetchError);
                                await reportError(client, fetchError, `Fetching reminder message in checkOpenThreadsAndSendReminders: ${updatedThread.id}`);
                                continue;
                            }
                            if (reminderMessage) {
                                const reminderTime = reminderMessage.createdTimestamp;
                                const timeSinceReminder = Date.now() - reminderTime;
                                if (timeSinceReminder > 3 * 24 * 60 * 60 * 1000) {
                                    const closingEmbed = new EmbedBuilder()
                                        .setColor('#c90505')
                                        .setTitle('<:closed:1306624376028004362>| Help Request Closed')
                                        .setDescription('This help request has been automatically closed due to inactivity after a reminder was sent.');
                                    await updatedThread.send({ embeds: [closingEmbed] });
                                    await updatedThread.setLocked(true);
                                    await updatedThread.setArchived(true);
                                }
                            } else if (inactiveTime > 24 * 60 * 60 * 1000) {
                                const threadOwner = await client.users.fetch(thread.ownerId);
                                const reminderEmbed = new EmbedBuilder()
                                    .setColor('#fdeb00')
                                    .setTitle('<:HelpIcon:1304095958283321385>| Help Reminder')
                                    .setDescription(`Hello ${threadOwner.username}, this is a friendly reminder that your help request has been inactive for more than 24 hours. If you no longer need assistance, please consider closing the thread using the \`+close\` command. This thread will be automatically closed in 3 days if it remains inactive.`);
                                const stillNeedHelpButton = new ButtonBuilder()
                                    .setCustomId(`still_need_help_${updatedThread.id}`)
                                    .setLabel('I still need help')
                                    .setStyle(ButtonStyle.Primary);
                                const row = new ActionRowBuilder().addComponents(stillNeedHelpButton);
                                await updatedThread.send({
                                    content: `<@${threadOwner.id}>`,
                                    embeds: [reminderEmbed],
                                    components: [row]
                                });
                            }
                        }
                    } catch (threadError) {
                        console.error(`Error processing thread ${thread.id}:`, threadError);
                        await reportError(client, threadError, `Thread processing in checkOpenThreadsAndSendReminders: ${thread.id}`);
                    }
                }
            } catch (forumError) {
                console.error(`Error processing forum ${forum.id}:`, forumError);
                await reportError(client, forumError, `Forum processing in checkOpenThreadsAndSendReminders: ${forum.id}`);
            }
        }
    } catch (error) {
        console.error('Error in checkOpenThreadsAndSendReminders:', error);
        await reportError(client, error, 'checkOpenThreadsAndSendReminders function');
    }
}

async function handleStillNeedHelpButton(interaction) {
    console.log('Interaction customId:', interaction.customId);
    const [action, need, help, threadId] = interaction.customId.split('_');
    console.log('Parsed values:', { action, need, help, threadId });
    if (!threadId) {
        await interaction.reply({ content: 'Error: Invalid thread ID. Please contact an administrator.', ephemeral: true });
        return;
    }
    let thread;
    try {
        console.log('Attempting to fetch thread with ID:', threadId);
        thread = await interaction.client.channels.fetch(threadId);
        console.log('Successfully fetched thread:', thread.id);
    } catch (error) {
        console.error(`Error fetching thread ${threadId}:`, error);
        await interaction.reply({ content: 'Sorry, this thread no longer exists or is inaccessible.', ephemeral: true });
        return;
    }
    if (!thread || !thread.isThread()) {
        await interaction.reply({ content: 'Sorry, this thread no longer exists or is invalid.', ephemeral: true });
        return;
    }
    const threadStarterMessage = await thread.fetchStarterMessage();
    if (interaction.user.id !== threadStarterMessage.author.id) {
        await interaction.reply({ content: 'Only the user who created this thread can use this button.', ephemeral: true });
        return;
    }
    const message = await interaction.message.fetch();
    const disabledRow = ActionRowBuilder.from(message.components[0]).setComponents(
        ButtonBuilder.from(message.components[0].components[0]).setDisabled(true)
    );
    await interaction.message.edit({ components: [disabledRow] });
    const helperRole = interaction.guild.roles.cache.get(process.env.VOLUNTEER_HELPER_ROLE_ID);
    if (!helperRole) {
        await interaction.reply({ content: 'Error: Helper role not found. Please contact a manager/dev admin.', ephemeral: true });
        return;
    }
    const helpers = new Set();
    let lastId;
    const fetchLimit = 100;
    while (true) {
        const options = { limit: fetchLimit };
        if (lastId) options.before = lastId;
        const messages = await thread.messages.fetch(options);
        if (messages.size === 0) break;
        messages.forEach(msg => {
            if (msg.member &&
                msg.member.roles.cache.has(helperRole.id) &&
                msg.author.id !== interaction.user.id &&
                msg.author.id !== interaction.client.user.id) {
                helpers.add(msg.member);
            }
        });
        if (messages.size < fetchLimit) break;
        lastId = messages.last().id;
    }
    if (helpers.size > 0) {
        const helperMentions = Array.from(helpers).map(helper => `<@${helper.id}>`).join(' ');
        await thread.send(`${helperMentions} The user still needs help with this help request.`);
        await interaction.deferUpdate();
    } else {
        const closeButton = new ButtonBuilder()
            .setCustomId('close_post')
            .setLabel('Close Post')
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(closeButton);
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('Wait for Helpers')
            .setDescription('Please wait for any potential Helpers to respond or you can close the thread.')
            .setTimestamp();
        await thread.send({
            embeds: [embed],
            components: [row]
        });
        await interaction.deferUpdate();
    }
}
async function fetchWithRetry(fetchFunction, maxRetries, initialDelay = 1000) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await fetchFunction();
        } catch (error) {
           
            const isServerError = error.name === 'DiscordAPIError' && error.code === 500;
            const isAbortError = error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('aborted'));
            const isHttp500 = error.response && error.response.status === 500;
            const shouldRetry = isServerError || isAbortError || isHttp500;

            if (shouldRetry && retries < maxRetries - 1) {
                retries++;
                
                await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, retries)));
            } else {
                throw error;
            }
        }
    }
}

async function handleBecomeVolunteerHelper(interaction) {
    try {
        let member = interaction.member;
        let guild = interaction.guild;

        
        if (!guild) {
            guild = interaction.client.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) {
                await interaction.reply({
                    content: 'Error: Unable to find the server. Please contact an administrator.',
                    ephemeral: true
                });
                return;
            }

            try {
                member = await guild.members.fetch(interaction.user.id);
            } catch (error) {
                await interaction.reply({
                    content: 'Error: You must be a member of the server to become a Volunteer Helper.',
                    ephemeral: true
                });
                return;
            }
        }

        
    if (process.env.VOLUNTEER_HELPER_ROLE_ID && member.roles.cache.has(process.env.VOLUNTEER_HELPER_ROLE_ID)) {
            await interaction.reply({
                content: 'You already have the Volunteer Helper role!',
                ephemeral: true
            });
            return;
        }

        const guidelinesEmbed = new EmbedBuilder()
            .setColor('#4A90E2')
            .setTitle('📋 Helper Guidelines')
            .setDescription('# __Helper Guidelines__\n> ## Do not ping the Moderators and Helper Moderators unless moderating action is necessary. Pinging the moderators for helping with a math question results in a temporary time out and may lead to a ban.\n\nIf you are looking to help someone out in these threads, here are a few good-to-know tips, tricks, and guidelines to follow:')
            .addFields(
                {
                    name: '🎯 Goals',
                    value: 'Helpers should give tips and **help people find solutions** to problems. It entails that you:\n• **Should not post full solutions** or **copy online solutions**. The person is copying to you to learn, not to copy a solution. Prioritize hints over direct solution elements.\n• **Do not try to answer** if you are **unsure of the topic**. It may cause confusion.\n• Do not help in tests. This is not helping, it is called **cheating** or **outsourcing** which is **against the rules**. If you see something that resembles a test, please contact a moderator so that action can be taken.\n• Using LLM outputs to provide help is strictly prohibited. As a precaution, the analysis of LLM outputs, regardless of its correctness, is also prohibited.\n• Advertising paid help services in help channels is strictly prohibited.\n• While it is allowed, avoid private communication to provide help. Discussions should be as transparent as possible, and we cannot moderate what happens outside of help threads.',
                    inline: false
                }
            )
            .setFooter({ text: 'By clicking the "Agree" button, you agree to comply by the following regulations and accept that any infractions may result in penalty imposed against you.' })
            .setTimestamp();

        const guidelinesButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('agree_helper_guidelines')
                    .setLabel('Agree')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('disagree_helper_guidelines')
                    .setLabel('Disagree')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

        await interaction.reply({
            embeds: [guidelinesEmbed],
            components: [guidelinesButtons],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error in handleBecomeVolunteerHelper:', error);
        await reportError(interaction.client, error, 'handleBecomeVolunteerHelper');
        await interaction.reply({
            content: 'An error occurred while processing your request. Please try again later.',
            ephemeral: true
        });
    }
}

async function handleAgreeHelperGuidelines(interaction) {
    try {
        let member = interaction.member;
        let guild = interaction.guild;

        
        if (!guild) {
            guild = interaction.client.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) {
                await interaction.reply({
                    content: 'Error: Unable to find the server. Please contact an administrator.',
                    ephemeral: true
                });
                return;
            }

            try {
                member = await guild.members.fetch(interaction.user.id);
            } catch (error) {
                await interaction.reply({
                    content: 'Error: You must be a member of the server to become a Volunteer Helper.',
                    ephemeral: true
                });
                return;
            }
        }

        
    if (process.env.VOLUNTEER_HELPER_ROLE_ID && member.roles.cache.has(process.env.VOLUNTEER_HELPER_ROLE_ID)) {
            await interaction.reply({
                content: 'You already have the Volunteer Helper role!',
                ephemeral: true
            });
            return;
        }

        
    const volunteerHelperRole = process.env.VOLUNTEER_HELPER_ROLE_ID ? guild.roles.cache.get(process.env.VOLUNTEER_HELPER_ROLE_ID) : null;
        if (!volunteerHelperRole) {
            await interaction.reply({
                content: 'Error: Volunteer Helper role not found. Please contact an administrator.',
                ephemeral: true
            });
            return;
        }

        await member.roles.add(volunteerHelperRole);

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎉 Welcome to the Team!')
            .setDescription(`Congratulations! You have been granted the **${volunteerHelperRole.name}** role.`)
            .addFields(
                { name: 'What\'s Next?', value: 'You can now help students in the Help School and Help University forums. Remember to follow the guidelines you just agreed to!' },
                { name: 'Thank You!', value: 'Thank you for volunteering to help students with their academic questions. Your contribution makes a real difference!' }
            )
            .setFooter({ text: 'Welcome aboard!' })
            .setTimestamp();

            
        const disabledButtons = ActionRowBuilder.from(interaction.message.components[0])
            .setComponents(
                ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
                ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
            );

        await interaction.update({
            embeds: [successEmbed],
            components: [disabledButtons]
        });

    } catch (error) {
        console.error('Error in handleAgreeHelperGuidelines:', error);
        await reportError(interaction.client, error, 'handleAgreeHelperGuidelines');
        await interaction.reply({
            content: 'An error occurred while granting the role. Please contact an administrator.',
            ephemeral: true
        });
    }
}

async function handleDisagreeHelperGuidelines(interaction) {
    try {
        const disagreeEmbed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('Guidelines Not Accepted')
            .setDescription('You have chosen not to accept the Helper Guidelines. No role has been granted.')
            .addFields(
                { name: 'Changed Your Mind?', value: 'If you change your mind later, you can always try to become a Volunteer Helper again by attempting to send a message in a help thread.' }
            )
            .setFooter({ text: 'Thank you for your consideration!' })
            .setTimestamp();

                
        let disabledButtons;
        if (interaction.message.components && interaction.message.components[0]) {
            disabledButtons = ActionRowBuilder.from(interaction.message.components[0])
                .setComponents(
                    ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
                    ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
                );
        }

        await interaction.update({
            embeds: [disagreeEmbed],
            components: disabledButtons ? [disabledButtons] : []
        });

    } catch (error) {
        console.error('Error in handleDisagreeHelperGuidelines:', error);
        await reportError(interaction.client, error, 'handleDisagreeHelperGuidelines');
        await interaction.reply({
            content: 'An error occurred while processing your response.',
            ephemeral: true
        });
    }
}


startBot().catch(async error => {
    console.error('Failed to start the bot:', error);
    const webhookClient = new WebhookClient({ url: process.env.ERROR_WEBHOOK_URL });
    await webhookClient.send('Failed to start the bot: ' + error.message);
    process.exit(1);
});
