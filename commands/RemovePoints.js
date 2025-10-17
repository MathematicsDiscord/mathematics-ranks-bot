const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { removePoints, getVerificationStatus } = require('../database');
const { RANK_THRESHOLDS } = require('../rankSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removepoints')
        .setDescription('Remove points from a helper')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove points from')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('points')
                .setDescription('The number of points to remove')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction) {
        const hasPermission = interaction.member.roles.cache.has('829078414404354131') ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        try {
            await interaction.deferReply({ ephemeral: true });
            const user = interaction.options.getUser('user');
            const pointsToRemove = interaction.options.getInteger('points');
            const newPoints = await removePoints(user.id, pointsToRemove);
            const member = await interaction.guild.members.fetch(user.id);
            const wasVerified = await getVerificationStatus(user.id);

            let adminMessage = `Removed ${pointsToRemove} points from ${user.tag}. They now have ${newPoints} points.`;
            let userEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('A Manager has decided to remove some of your points')
                .setDescription(`A manager has chosen to remove ${pointsToRemove} points from your profile; if you believe this decision is unjustified or do not understand why the points were removed, please contact a manager for explanation.`)
                .setTimestamp();
            if (wasVerified && newPoints < 814) {
                adminMessage += "\nUser has been unverified due to point loss.";
                userEmbed.addFields({ name: 'Verification Status', value: 'You have been unverified due to point loss.' });
                await member.roles.remove(RANK_THRESHOLDS[6].roleId);
            }
            let removedRoles = [];
            for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
                if (newPoints < RANK_THRESHOLDS[i].points) {
                    const role = interaction.guild.roles.cache.get(RANK_THRESHOLDS[i].roleId);
                    if (role && member.roles.cache.has(role.id)) {
                        await member.roles.remove(role);
                        removedRoles.push(role.name);
                        adminMessage += `\nRemoved ${role.name} role.`;
                    }
                } else {
                    break;
                }
            }
            if (removedRoles.length > 0) {
                userEmbed.addFields({ name: 'Ranks Removed', value: removedRoles.join(', ') });
                const logChannel = await interaction.guild.channels.fetch(process.env.RANKUP_LOGS_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle(':arrow_down: Derank Log')
                        .setDescription(`${user.tag} has been deranked`)
                        .addFields(
                            { name: 'Points Removed', value: pointsToRemove.toString(), inline: true },
                            { name: 'New Total Points', value: newPoints.toString(), inline: true },
                            { name: 'Ranks Removed', value: removedRoles.join(', ') }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }
            try {
                await user.send({ embeds: [userEmbed] });
                adminMessage += "\nUser has been notified via DM.";
            } catch (dmError) {
                console.error('Error sending DM:', dmError);
                adminMessage += "\nFailed to send DM to the user.";
            }
            await interaction.editReply({ content: adminMessage, ephemeral: true });
        } catch (error) {
            console.error('Error in removepoints command:', error);
            if (interaction.deferred) {
                await interaction.editReply({ content: 'An error occurred while removing points.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'An error occurred while removing points.', ephemeral: true });
            }
        }
    },
};