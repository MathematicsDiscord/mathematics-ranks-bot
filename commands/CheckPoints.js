const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../database');
const { RANK_THRESHOLDS } = require('../rankSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkpoints')
        .setDescription('Check your points and rank')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check points for (Manager or Staff only)')
                .setRequired(false)),

    async execute(interaction) {
        let targetUser = interaction.options.getUser('user') || interaction.user;
        const allowedRoles = ['775784618955505685', '829078414404354131', '819616364188139550', '1283689826742440016'];

        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId));

        if (targetUser.id !== interaction.user.id && !hasPermission) {
            return interaction.reply({ content: 'You do not have permission to check other users\' points.', ephemeral: true });
        }

        const isAdminCheckingOthers = hasPermission && targetUser.id !== interaction.user.id;

        try {
            const points = await database.getPoints(targetUser.id);
            const rank = await getCurrentRank(points, interaction.guild);
            const isEasterEgg = Math.random() < 0.2;
            const isVerified = await database.getVerificationStatus(targetUser.id);
            const isNextRankVerifiedHelper = rank.nextRank && rank.nextRank.points === 814;
            let embedColor = '#222323';
            let verificationReminder = null;
            if (!isAdminCheckingOthers && !isVerified && (points >= 814 || isNextRankVerifiedHelper)) {
                embedColor = '#FF0000';
                verificationReminder = {
                    name: '<:verified:1299334119288733786>| Verification Required',
                    value: points >= 814
                        ? 'You have reached the points for Verified Helper. Please complete the verification process to rank up.'
                        : 'You will need to complete the verification process to rank up when you reach 814 points.',
                    inline: false
                };
            }
            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(isEasterEgg ? `<:nerd2:1093541504208879656> Nerd Check for ${targetUser.username}` : `Point Check for ${targetUser.username}`)
                .addFields(
                    { name: isEasterEgg ? 'Nerdy Points' : 'Points', value: points.toString(), inline: true },
                    { name: isEasterEgg ? 'Nerdy Ranks' : 'Current Rank', value: rank.name, inline: true },
                )
                .setTimestamp();

            if (rank.nextRank) {
                embed.addFields(
                    { name: isEasterEgg ? 'Next Nerdy Rank' : 'Next Rank', value: rank.nextRank.name, inline: true }
                );
                if (isAdminCheckingOthers) {
                    embed.addFields(
                        { name: isEasterEgg ? 'The amount of nerdiness required to rank up' : 'Points to Next Rank', value: (rank.nextRank.points - points).toString(), inline: true }
                    );
                }
            } else {
                embed.addFields(
                    { name: isEasterEgg ? 'Next Nerdy Rank' : 'Next Rank', value: 'Maximum Rank Achieved!', inline: true }
                );
            }

            if (verificationReminder) {
                embed.addFields(verificationReminder);
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error in checkpoints command:', error);
            await interaction.reply({ content: 'An error occurred while checking points.', ephemeral: true });
        }
    },
};

async function getCurrentRank(points, guild) {
    let currentRank = { name: 'Unranked', points: 0 };
    let nextRank = null;

    for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
        if (points >= RANK_THRESHOLDS[i].points) {
            const role = await guild.roles.fetch(RANK_THRESHOLDS[i].roleId);
            currentRank = {
                name: role ? role.name : `Rank ${i + 1}`,
                points: RANK_THRESHOLDS[i].points
            };
            if (i < RANK_THRESHOLDS.length - 1) {
                const nextRole = await guild.roles.fetch(RANK_THRESHOLDS[i + 1].roleId);
                nextRank = {
                    name: nextRole ? nextRole.name : `Rank ${i + 2}`,
                    points: RANK_THRESHOLDS[i + 1].points
                };
            }
        } else {
            if (i === 0) {
                const firstRole = await guild.roles.fetch(RANK_THRESHOLDS[0].roleId);
                nextRank = {
                    name: firstRole ? firstRole.name : `Rank 1`,
                    points: RANK_THRESHOLDS[0].points
                };
            }
            break;
        }
    }

    return { ...currentRank, nextRank };
}