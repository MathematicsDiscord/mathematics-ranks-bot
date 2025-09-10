const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const database = require('./database');


const RANK_THRESHOLDS = [
    { points: 28, roleId: process.env.RANK_1_ROLE_ID },
    { points: 86, roleId: process.env.RANK_2_ROLE_ID },
    { points: 174, roleId: process.env.RANK_3_ROLE_ID },
    { points: 290, roleId: process.env.RANK_4_ROLE_ID },
    { points: 434, roleId: process.env.RANK_5_ROLE_ID },
    { points: 609, roleId: process.env.RANK_6_ROLE_ID },
    { points: 814, roleId: process.env.RANK_7_ROLE_ID },
    { points: 1054, roleId: process.env.RANK_8_ROLE_ID },
    { points: 1332, roleId: process.env.RANK_9_ROLE_ID },
    { points: 1652, roleId: process.env.RANK_10_ROLE_ID },
    { points: 2019, roleId: process.env.RANK_11_ROLE_ID },
    { points: 2440, roleId: process.env.RANK_12_ROLE_ID },
    { points: 2920, roleId: process.env.RANK_13_ROLE_ID },
];

async function checkRankUp(client, userId, guildId) {
    try {
        const points = await database.getPoints(userId);
        console.log(`Checking rank up for user ${userId} with ${points} points`);
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        let highestEligibleRank = null;

        for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
            const rank = RANK_THRESHOLDS[i];
            if (points >= rank.points) {
                highestEligibleRank = rank;
                console.log(`Highest eligible rank found: ${JSON.stringify(highestEligibleRank)}`);
                break;
            }
        }
        if (!highestEligibleRank) {
            console.log('No eligible rank found');
            return null;
        }
        const rankIndex = RANK_THRESHOLDS.indexOf(highestEligibleRank);
        console.log(`Rank index: ${rankIndex}`);
        const isVerified = await database.getVerificationStatus(userId);
        console.log(`User verification status: ${isVerified}`);

        if (rankIndex >= 6 && isVerified) {
            if (!member.roles.cache.has(highestEligibleRank.roleId)) {
                console.log(`Assigning role ${highestEligibleRank.roleId} to user ${userId}`);
                await assignRole(member, highestEligibleRank.roleId);
                return highestEligibleRank.roleId;
            }
        } else if (rankIndex === 6 && !isVerified) {
            if (!member.roles.cache.has(highestEligibleRank.roleId)) {
                const hasBeenPrompted = await database.getVerificationPromptStatus(userId);
                if (!hasBeenPrompted) {
                    await triggerApplicationProcess(client, member, rankIndex + 1);
                    await database.setVerificationPromptStatus(userId, true);
                }
            }
        } else if (rankIndex < 6) {
            if (!member.roles.cache.has(highestEligibleRank.roleId)) {
                console.log(`Assigning role ${highestEligibleRank.roleId} to user ${userId}`);
                await assignRole(member, highestEligibleRank.roleId);
                return highestEligibleRank.roleId;
            }
        }
        console.log('No role assigned');
        return null;
    } catch (error) {
        console.error('Error in checkRankUp:', error);
        return null;
    }
}

async function assignRole(member, roleId) {
    try {
        console.log(`Attempting to assign role ${roleId} to user ${member.id}`);
        const role = await member.guild.roles.fetch(roleId);
        if (role) {
            await member.roles.add(role);
            console.log(`Successfully assigned role ${role.name} to user ${member.id}`);

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setDescription(`🎉 Congratulations! You've been promoted to ${role.name}!`)
                .setFooter({ text: 'Keep up the great work!' })
                .setTimestamp();

            try {
                await member.send({ embeds: [embed] });
                console.log(`Sent congratulatory DM to user ${member.id}`);
            } catch (dmError) {
                console.error(`Failed to send DM to user ${member.id}:`, dmError);
            }

            const logChannel = await member.guild.channels.fetch(process.env.RANKUP_LOGS_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle(':arrow_up: Rank Up Log')
                    .setDescription(`${member.user.tag} has been promoted to ${role.name}`)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
                console.log(`Sent rank-up log for user ${member.id}`);
            } else {
                console.error('Rank-up logs channel not found');
            }
        } else {
            console.error(`Role with ID ${roleId} not found`);
        }
    } catch (error) {
        console.error(`Error assigning role ${roleId} to user ${member.id}:`, error);
    }
}

async function triggerApplicationProcess(client, member, rank) {
    try {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Verification')
            .setDescription('🎉 Congratulations on being qualified to get Verified Helper! Let\'s complete your verification.')
            .addFields(
                { name: 'How to verify?', value: 'Please click the "Verify" button below to open the Verification form.' },
            )
            .setFooter({ text: 'Your dedication to helping others is appreciated!' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`rank_application_${rank}`)
                    .setLabel('Verify')
                    .setStyle(ButtonStyle.Primary)
            );

        try {
            await member.send({
                embeds: [embed],
                components: [row]
            });
        } catch (dmError) {
            console.log(`Unable to send DM to ${member.user.tag} (ID: ${member.id}) for verification application. Their DMs may be closed.`);
        }
    } catch (error) {
        console.error('Error in triggerApplicationProcess:', error);
    }
}

function createRankApplicationModal(rank) {
    return new ModalBuilder()
        .setCustomId(`rank_application_modal_${rank}`)
        .setTitle(`Verification`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('math_experience')
                    .setLabel('Describe your experience in mathematics.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('math_subjects')
                    .setLabel('What math subjects are you good at?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('answer_screenshot')
                    .setLabel('Link to a recent post you answered.')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('activity_and_plans')
                    .setLabel('Weekly activity & Your long-term plans?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('feedback')
                    .setLabel('Any feedback for us?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
            )
        );
}

function createFeedbackModal(userId, rank) {
    return new ModalBuilder()
        .setCustomId(`feedback_modal_${userId}_${rank}`)
        .setTitle('Give Feedback!')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('feedback_text')
                    .setLabel('Your feedback')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            )
        );
}

async function handleApplicationSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const rank = parseInt(interaction.customId.split('_')[3]);
    const mathExperience = interaction.fields.getTextInputValue('math_experience');
    const mathSubjects = interaction.fields.getTextInputValue('math_subjects');
    const answerScreenshot = interaction.fields.getTextInputValue('answer_screenshot');
    const activityAndPlans = interaction.fields.getTextInputValue('activity_and_plans');
    const feedback = interaction.fields.getTextInputValue('feedback') || 'No feedback provided';

    const applicationEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Verification App`)
        .setDescription(`Verify app from ${interaction.user.tag}`)
        .addFields(
            { name: 'Math Experience', value: mathExperience },
            { name: 'Math Subjects', value: mathSubjects },
            { name: 'Answer Screenshot', value: answerScreenshot },
            { name: 'Activity and Plans', value: activityAndPlans },
            { name: 'Feedback', value: feedback }
        )
        .setTimestamp();
    const applicationChannel = await interaction.client.channels.fetch(process.env.APPLICATION_CHANNEL_ID);
    await applicationChannel.send({
        embeds: [applicationEmbed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${interaction.user.id}_${rank}`)
                    .setLabel('Accept')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`decline_${interaction.user.id}_${rank}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
            )
        ]
    });
    try {
        const dmChannel = await interaction.user.createDM();
        const messages = await dmChannel.messages.fetch({ limit: 10 });
        for (const message of messages.values()) {
            if (message.author.id === interaction.client.user.id && message.components.length > 0) {
                const updatedComponents = message.components.map(row => {
                    const newRow = new ActionRowBuilder();
                    row.components.forEach(component => {
                        if (component.data.custom_id &&
                            (component.data.custom_id.startsWith('rank_application_') ||
                                component.data.custom_id.startsWith('reapply_rank_application_'))) {
                            newRow.addComponents(
                                ButtonBuilder.from(component).setDisabled(true)
                            );
                        } else {
                            newRow.addComponents(ButtonBuilder.from(component));
                        }
                    });
                    return newRow;
                });

                await message.edit({ components: updatedComponents });
            }
        }
    } catch (error) {
        console.error('Error disabling buttons:', error);
    }

    await interaction.editReply({ content: 'Verification has been forwarded to Helper Moderators. Please do not leave the server so that the bot may contact you; you will be notified if you have been accepted or declined here.', ephemeral: true });
}

async function handleFeedbackSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const [_, __, userId, rank] = interaction.customId.split('_');
    const feedbackText = interaction.fields.getTextInputValue('feedback_text');

    try {
        const member = await interaction.guild.members.fetch(userId);

        const feedbackEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Feedback from Helper Moderators.')
            .setDescription(feedbackText)
            .setTimestamp();

        await member.send({ embeds: [feedbackEmbed] });
        await interaction.editReply({ content: 'Feedback sent successfully to the applicant.', ephemeral: true });
    } catch (error) {
        console.error('Error in handleFeedbackSubmit:', error);
        await interaction.editReply({ content: 'Error sending feedback. Please ensure the user is still in the server.', ephemeral: true });
    }
}

async function handleApplicationDecision(interaction) {
    try {
        await interaction.deferUpdate();

        const [action, userId, rank] = interaction.customId.split('_');

        const member = await interaction.guild.members.fetch(userId);

        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        if (action === 'accept') {
            const verifiedHelperRole = RANK_THRESHOLDS[6].roleId;
            await assignRole(member, verifiedHelperRole);

            await database.setVerificationStatus(userId, true);

            updatedEmbed
                .setColor('#45ff00')
                .addFields({ name: 'Status', value: '✅ Accepted', inline: false });

            const acceptEmbed = new EmbedBuilder()
                .setColor('#45ff00')
                .setTitle('Application Accepted')
                .setDescription('🎉 Congratulations! You are now a Verified Helper!')
                .setFooter({ text: 'Keep up the great work!' })
                .setTimestamp();

            try {
                await member.send({ embeds: [acceptEmbed] });
            } catch (dmError) {
                console.error('Error sending DM to accepted member:', dmError);
            }
            await interaction.followUp({ content: `Application for Verified Helper has been accepted for ${member.user.tag}. They have been assigned the Verified Helper role.`, ephemeral: true });
        } else if (action === 'decline') {
            updatedEmbed
                .setColor('#FF0000')
                .addFields({ name: 'Status', value: '❌ Declined', inline: false });

            const declineEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Application Declined')
                .setDescription("We're sorry, but your application for Verified Helper has been declined.")
                .addFields({ name: '**Why?**', value: 'Your verification application has been rejected for certain reason(s). Please await feedback from the Helper Moderators. If you have already received feedback, please review it to improve your chances of success in the future. You may re-verify at a later date.' })
                .setTimestamp();

            const reapplyButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`reapply_rank_application_${rank}`)
                        .setLabel('Re-verify')
                        .setStyle(ButtonStyle.Primary)
                );

            try {
                await member.send({ embeds: [declineEmbed], components: [reapplyButton] });
            } catch (dmError) {
                console.error('Error sending DM to declined member:', dmError);
            }
            await interaction.followUp({ content: `Application for Verified Helper has been declined for ${member.user.tag}.`, ephemeral: true });
        }

        const feedbackButton = new ButtonBuilder()
            .setCustomId(`feedback_${userId}_${rank}`)
            .setLabel('Give Feedback')
            .setStyle(ButtonStyle.Primary);

        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${userId}_${rank}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`decline_${userId}_${rank}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true),
            feedbackButton
        );

        await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] });
    } catch (error) {
        console.error('Error in handleApplicationDecision:', error);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'An error occurred while processing the application.', ephemeral: true });
        } else {
            await interaction.followUp({ content: 'An error occurred while processing the application.', ephemeral: true });
        }
    }
}

module.exports = {
    RANK_THRESHOLDS,
    checkRankUp,
    handleApplicationSubmit,
    handleApplicationDecision,
    createRankApplicationModal,
    createFeedbackModal,
    handleFeedbackSubmit
};