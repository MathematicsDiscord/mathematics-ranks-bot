const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const database = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('givepoints')
        .setDescription('Give points to a user (Admin or Manager only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give points to')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('points')
                .setDescription('The number of points to give')
                .setRequired(true)),
    async execute(interaction) {
        const hasPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
            interaction.member.roles.cache.has('829078414404354131');
        if (!hasPermission) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        const targetUser = interaction.options.getUser('user');
        const pointsToAdd = interaction.options.getInteger('points');
        if (pointsToAdd <= 0) {
            return interaction.reply({ content: 'Please provide a positive number of points.', ephemeral: true });
        }
        try {
            const initialVerificationStatus = await database.getVerificationStatus(targetUser.id);
            const result = await database.addPointsNoLimit(targetUser.id, pointsToAdd);
            if (result.success) {
                const updatedPoints = await database.getPoints(targetUser.id);
                const rankSystem = require('../rankSystem');
                const newRank = await rankSystem.checkRankUp(interaction.client, targetUser.id, interaction.guild.id);
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('Points Added')
                    .setDescription(`${pointsToAdd} points have been added to ${targetUser.tag}`)
                    .addFields(
                        { name: 'Updated Total', value: `${updatedPoints} points`, inline: true },
                        { name: 'Added By', value: interaction.user.tag, inline: true }
                    )
                    .setTimestamp();

                if (result.automaticallyVerified) {
                    embed.addFields({ name: 'Verification Status', value: 'User has been automatically verified as a helper!', inline: false });
                } else if (initialVerificationStatus) {
                    embed.addFields({ name: 'Verification Status', value: 'User was already verified as a helper.', inline: false });
                }

                if (newRank) {
                    const newRole = interaction.guild.roles.cache.get(newRank);
                    if (newRole) {
                        embed.addFields({ name: 'New Rank', value: `User has been promoted to ${newRole.name}!`, inline: false });
                        console.log(`User ${targetUser.id} ranked up to ${newRole.name}`);
                    } else {
                        embed.addFields({ name: 'New Rank', value: `User has been promoted to a new rank!`, inline: false });
                        console.log(`User ${targetUser.id} ranked up, but role with ID ${newRank} not found`);
                    }
                }
                await interaction.reply({ embeds: [embed] });
                try {
                    const userEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('Points Received')
                        .setDescription(`You have received ${pointsToAdd} points from a Manager`)
                        .addFields(
                            { name: 'Your New Total', value: `${updatedPoints} points`, inline: true },
                            { name: 'Added By', value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp();

                    if (result.automaticallyVerified) {
                        userEmbed.addFields({ name: 'Verification Status', value: 'You have been automatically verified as a helper!', inline: false });
                    } else if (initialVerificationStatus) {
                        userEmbed.addFields({ name: 'Hmm..', value: '\n' +
                                'You have received additional points. Even if you are already a Verified Helper, I trust no one is abusing this command.\n', inline: false });
                    }

                    if (newRank) {
                        userEmbed.addFields({ name: 'New Rank', value: `Congratulations! You have been promoted to ${newRank}!`, inline: false });
                    }

                    await targetUser.send({ embeds: [userEmbed] });
                } catch (dmError) {
                    console.error('Failed to send DM to user:', dmError);
                    await interaction.followUp({ content: 'Points added, but I couldn\'t send a DM to the user. They may have DMs disabled.', ephemeral: true });
                }
            } else {
                return interaction.reply({ content: 'Failed to add points. Please try again later.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error giving points:', error);
            await interaction.reply({ content: 'An error occurred while giving points. Please try again later.', ephemeral: true });
        }
    },
};