const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getTopHelpers, getVerificationStatus, getWeeklyPoints, getMonthlyPoints, getChannelHelpStats, getTopHelpersByChannelActivity } = require('../database');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const Chart = require('chart.js/auto');
const { createCanvas, loadImage } = require('canvas');
const fetch = require('node-fetch');

async function fetchImage(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Failed to fetch image: ${response.statusText} from ${url}`);
            return null;
        }
        const buffer = await response.buffer();
        return await loadImage(buffer);
    } catch (error) {
        console.error(`Error fetching or loading image from ${url}:`, error);
        return null;
    }
}

async function processUsers(helpers, interaction) {
    const processedUsers = [];
    for (const helper of helpers) {
        let userTag = `Unknown User (${helper.user_id})`;
        let userId = helper.user_id;
        let isVerified = false;
        let avatarURL = null;

        try {
            let userObject = await interaction.guild.members.fetch(helper.user_id).catch(async () => {
                return await interaction.client.users.fetch(helper.user_id).catch(() => null);
            });

            if (userObject) {
                const user = userObject.user || userObject;
                userTag = user.tag || user.username;
                userId = user.id;
                let baseUrl = user.displayAvatarURL({ dynamic: true, size: 64 });

                if (baseUrl && baseUrl.includes('.webp')) {
                    avatarURL = baseUrl.replace('.webp', '.png');
                } else {
                    avatarURL = baseUrl;
                }
                isVerified = await getVerificationStatus(userId);
            } else {
                isVerified = await getVerificationStatus(helper.user_id);
                const fallbackUser = await interaction.client.users.fetch(helper.user_id).catch(() => null);
                if (fallbackUser) {
                    // Get the base avatar URL
                    let baseUrl = fallbackUser.displayAvatarURL({ dynamic: true, size: 64 });

                    if (baseUrl && baseUrl.includes('.webp')) {
                        avatarURL = baseUrl.replace('.webp', '.png');
                    } else {
                        avatarURL = baseUrl;
                    }
                }
            }
            processedUsers.push({
                id: userId,
                tag: userTag || `User ${userId}`,
                points: helper.points,
                isVerified: isVerified,
                avatarURL: avatarURL
            });

        } catch (error) {
            console.error(`Error processing user ${helper.user_id}:`, error);
            try {
                isVerified = await getVerificationStatus(helper.user_id);
            } catch (dbError) {
                console.error(`Error fetching verification status for ${helper.user_id} after processing error:`, dbError);
            }
            processedUsers.push({
                id: helper.user_id,
                tag: `Error Fetching (${helper.user_id})`,
                points: helper.points,
                isVerified: isVerified,
                avatarURL: null
            });
        }
    }
    return processedUsers;
}


async function createAvatarStrip(users, stripWidth, avatarSize = 48, paddingY = 5) { // Renamed padding to paddingY for clarity
    const canvasHeight = avatarSize + paddingY * 2;
    const canvas = createCanvas(stripWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    const totalUsers = users.length;
    if (totalUsers === 0) return canvas.toBuffer('image/png');
    const avatarImages = await Promise.all(users.map(user => user.avatarURL ? fetchImage(user.avatarURL) : null));
    for (let i = 0; i < totalUsers; i++) {
        const img = avatarImages[i];
        const centerX = stripWidth * ( (2 * i + 1) / (2 * totalUsers) );
        const drawX = centerX - avatarSize / 2;
        const drawY = paddingY;
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, drawY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true); // Center arc at centerX
        ctx.closePath();
        ctx.clip();
        if (img) {
            ctx.drawImage(img, drawX, drawY, avatarSize, avatarSize);
        } else {

            ctx.fillStyle = '#5865F2';
            ctx.beginPath();
            ctx.arc(centerX, drawY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true); // Center arc at centerX
            ctx.fill();
        }
        ctx.restore();
    }

    return canvas.toBuffer('image/png');
}


async function combineChartAndAvatars(chartBuffer, avatarBuffer, chartWidth, chartHeight, avatarStripHeight) {
    const finalHeight = chartHeight + avatarStripHeight;
    const canvas = createCanvas(chartWidth, finalHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#2B2D31';
    ctx.fillRect(0, 0, chartWidth, finalHeight);

    const chartImage = await loadImage(chartBuffer);
    const avatarImage = await loadImage(avatarBuffer);

    ctx.drawImage(chartImage, 0, 0, chartWidth, chartHeight);
    ctx.drawImage(avatarImage, 0, chartHeight, chartWidth, avatarStripHeight);

    return canvas.toBuffer('image/png');
}

async function createPointsGraph(users, timeframe) {
    const width = 800;
    const height = 600;
    const backgroundColour = '#2B2D31';
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour });


    const labels = users.map((_, index) => (index + 1).toString());
    const data = users.map(user => user.points);

    const configuration = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)} Points Earned`,
                data: data,
                backgroundColor: [ 'rgba(54, 162, 235, 0.6)','rgba(255, 99, 132, 0.6)','rgba(75, 192, 192, 0.6)','rgba(255, 206, 86, 0.6)','rgba(153, 102, 255, 0.6)','rgba(255, 159, 64, 0.6)','rgba(199, 199, 199, 0.6)','rgba(83, 102, 255, 0.6)' ],
                borderColor: [ 'rgba(54, 162, 235, 1)','rgba(255, 99, 132, 1)','rgba(75, 192, 192, 1)','rgba(255, 206, 86, 1)','rgba(255, 206, 86, 1)','rgba(153, 102, 255, 1)','rgba(255, 159, 64, 1)','rgba(199, 199, 199, 1)','rgba(83, 102, 255, 1)' ],
                borderWidth: 1
            }]
        },
        options: {
            layout: { padding: { bottom: 10 } },
            scales: {
                y: { beginAtZero: true, ticks: { color: 'rgba(255, 255, 255, 0.8)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, title: { display: true, text: 'Points Earned', color: 'rgba(255, 255, 255, 0.8)'} },
                // X-axis now shows numbers 1-8
                x: { ticks: { color: 'rgba(255, 255, 255, 0.8)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, title: { display: true, text: 'Top Helpers (See Avatars Below)', color: 'rgba(255, 255, 255, 0.8)'} }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: `Top 8 Helpers - ${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)} Points Earned`, color: 'rgba(255, 255, 255, 0.9)', font: { size: 18 } },
                tooltip: {
                    callbacks: {
                        // Show username in tooltip when hovering over bar
                        title: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            return users[index] ? users[index].tag : '';
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) { label += context.parsed.y + ' points earned'; }
                            return label;
                        }
                    }
                }
            }
        }
    };

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    return imageBuffer;
}

async function createChannelActivityGraph(usersWithStats, timeframe) {
    const width = 900;
    const height = 600;
    const backgroundColour = '#2B2D31';
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour });

    // Use numbers 1-8 as labels instead of names
    const labels = usersWithStats.map((_, index) => (index + 1).toString());
    const schoolData = usersWithStats.map(user => user.school_thanks);
    const universityData = usersWithStats.map(user => user.university_thanks);

    const configuration = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [ { label: 'School Thanks', data: schoolData, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }, { label: 'University Thanks', data: universityData, backgroundColor: 'rgba(255, 159, 64, 0.6)', borderColor: 'rgba(255, 159, 64, 1)', borderWidth: 1 } ]
        },
        options: {
            layout: { padding: { bottom: 10 } },
            scales: {
                y: { beginAtZero: true, ticks: { color: 'rgba(255, 255, 255, 0.8)', stepSize: 1 }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, title: { display: true, text: 'Number of Thanks Received', color: 'rgba(255, 255, 255, 0.8)' } },
                // X-axis now shows numbers 1-8
                x: { ticks: { color: 'rgba(255, 255, 255, 0.8)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, title: { display: true, text: 'Top Helpers (See Avatars Below)', color: 'rgba(255, 255, 255, 0.8)'} }
            },
            plugins: {
                legend: { display: true, position: 'top', labels: { color: 'rgba(255, 255, 255, 0.8)' } },
                title: { display: true, text: `Top 8 Helper Channel Activity - ${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}`, color: 'rgba(255, 255, 255, 0.9)', font: { size: 18 } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        // Show username in tooltip when hovering over bar
                        title: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            return usersWithStats[index] ? usersWithStats[index].tag : '';
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) { label += context.parsed.y + ' thanks'; }
                            return label;
                        }
                    }
                }
            }
        }
    };

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    return imageBuffer;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('tophelpers')
        .setDescription('Display the top helpers with the most points or channel activity'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const topHelpers = await getTopHelpers(100);
            const weeklyPoints = await getWeeklyPoints(100);
            const monthlyPoints = await getMonthlyPoints(100);

            const allTimeUsers = await processUsers(topHelpers, interaction);
            const weeklyUsers = await processUsers(weeklyPoints, interaction);
            const monthlyUsers = await processUsers(monthlyPoints, interaction);

            const allTimePages = createPages(allTimeUsers);
            const weeklyPages = createPages(weeklyUsers);
            const monthlyPages = createPages(monthlyUsers);

            const embed = createEmbed(allTimePages[0], 1, 'all', allTimePages.length);

            let currentTimeframe = 'all';
            let currentPages = allTimePages;
            let currentPageIndex = 0;

            const response = await interaction.editReply({
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(createPageSelectMenu(currentPages, currentPageIndex)),
                    new ActionRowBuilder().addComponents(createTimeframeSelectMenu(currentTimeframe)),
                    createGraphButtonsRow(),
                ],
            });

            const collector = response.createMessageComponentCollector({ time: 180000 });


            collector.on('collect', async (i) => {
                try {
                    if (i.customId === 'select_page' || i.customId === 'select_timeframe') {
                        await i.deferUpdate();

                        if (i.customId === 'select_timeframe') {
                            currentTimeframe = i.values[0];
                            switch (currentTimeframe) {
                                case 'all':
                                    currentPages = allTimePages;
                                    break;
                                case 'weekly':
                                    currentPages = weeklyPages;
                                    break;
                                case 'monthly':
                                    currentPages = monthlyPages;
                                    break;
                            }
                            currentPageIndex = 0;
                        } else {
                            const parsedIndex = parseInt(i.values[0], 10);
                            currentPageIndex = Number.isNaN(parsedIndex) ? 0 : parsedIndex;
                        }

                        const maxPageIndex = Math.max(currentPages.length - 1, 0);
                        currentPageIndex = Math.min(Math.max(currentPageIndex, 0), maxPageIndex);

                        const totalPages = currentPages.length || 1;
                        const currentPageUsers = currentPages[currentPageIndex] || [];
                        const pageNumberForEmbed = Math.min(currentPageIndex + 1, totalPages);

                        const newEmbed = createEmbed(currentPageUsers, pageNumberForEmbed, currentTimeframe, totalPages);

                        await i.editReply({
                            embeds: [newEmbed],
                            components: [
                                new ActionRowBuilder().addComponents(createPageSelectMenu(currentPages, currentPageIndex)),
                                new ActionRowBuilder().addComponents(createTimeframeSelectMenu(currentTimeframe)),
                                createGraphButtonsRow(),
                            ],
                        });


                    } else if (i.customId === 'show_points_graph_button') {
                        const graphTimeframeSelect = new StringSelectMenuBuilder().setCustomId('select_points_graph_timeframe').setPlaceholder('Choose points graph timeframe').addOptions( { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' } );
                        const graphPromptRow = new ActionRowBuilder().addComponents(graphTimeframeSelect);
                        const graphPromptMessage = await i.reply({ content: '📊 Please select the timeframe for the Top **Points Earned** graph:', components: [graphPromptRow], ephemeral: true, fetchReply: true });
                        const graphCollector = graphPromptMessage.createMessageComponentCollector({ filter: (intUser) => intUser.user.id === i.user.id, time: 60000, max: 1 });

                        graphCollector.on('collect', async (graphInteraction) => {
                            try {
                                await graphInteraction.deferUpdate();
                                const selectedTimeframe = graphInteraction.values[0];

                                let fullDataRaw = (selectedTimeframe === 'weekly') ? await getWeeklyPoints(100) : await getMonthlyPoints(100);
                                fullDataRaw = fullDataRaw.filter(user => user.points > 0);

                                if (!fullDataRaw || fullDataRaw.length === 0) {
                                    await graphInteraction.editReply({ content: `No points earned data found for the ${selectedTimeframe} timeframe.`, components: [] });
                                    return;
                                }
                                
                                let currentPage = 0;
                                const pageSize = 8;
                                const totalPages = Math.ceil(fullDataRaw.length / pageSize);

                                const initialPageData = await processUsers(fullDataRaw.slice(0, pageSize), graphInteraction);

                                const chartBuffer = await createPointsGraph(initialPageData, selectedTimeframe);
                                const avatarBuffer = await createAvatarStrip(initialPageData, 800, 48, 5);
                                const finalBuffer = await combineChartAndAvatars(chartBuffer, avatarBuffer, 800, 600, 48 + 5 * 2);
                                const attachment = new AttachmentBuilder(finalBuffer, { name: 'points-graph.png' });

                                const buttons = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`graph_page_prev_points_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(true),
                                    new ButtonBuilder().setCustomId(`graph_page_next_points_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(totalPages <= 1)
                                );
                                
                                const timeframeTitle = selectedTimeframe.charAt(0).toUpperCase() + selectedTimeframe.slice(1);
                                
                                const graphMessage = await interaction.followUp({
                                    content: `📊 Top Helpers **Points Earned** graph (${timeframeTitle}) requested by ${interaction.user}. Page ${currentPage + 1} of ${totalPages}`,
                                    files: [attachment],
                                    components: [buttons]
                                });
                                await graphInteraction.editReply({ content: 'Points graph generated!', components: [] });

                                const paginationCollector = graphMessage.createMessageComponentCollector({ time: 300000 });

                                paginationCollector.on('collect', async (buttonInteraction) => {
                                    try {
                                        await buttonInteraction.deferUpdate();
                                        const action = buttonInteraction.customId.split('_')[2];

                                        if (action === 'next') currentPage++;
                                        else if (action === 'prev') currentPage--;

                                        const newPageDataRaw = fullDataRaw.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
                                        const newPageData = await processUsers(newPageDataRaw, buttonInteraction);

                                        const newChartBuffer = await createPointsGraph(newPageData, selectedTimeframe);
                                        const newAvatarBuffer = await createAvatarStrip(newPageData, 800, 48, 5);
                                        const newFinalBuffer = await combineChartAndAvatars(newChartBuffer, newAvatarBuffer, 800, 600, 48 + 5 * 2);
                                        const newAttachment = new AttachmentBuilder(newFinalBuffer, { name: 'points-graph.png' });

                                        const newButtons = new ActionRowBuilder().addComponents(
                                            new ButtonBuilder().setCustomId(`graph_page_prev_points_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(currentPage === 0),
                                            new ButtonBuilder().setCustomId(`graph_page_next_points_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(currentPage >= totalPages - 1)
                                        );
                                        
                                        await graphMessage.edit({
                                            content: `📊 Top Helpers **Points Earned** graph (${timeframeTitle}) requested by ${interaction.user}. Page ${currentPage + 1} of ${totalPages}`,
                                            files: [newAttachment],
                                            components: [newButtons]
                                        });

                                    } catch (pageError) { console.error('Error during graph pagination:', pageError); await buttonInteraction.followUp({ content: 'An error occurred while changing pages.', ephemeral: true }).catch(()=>{}); }
                                });
                                
                                paginationCollector.on('end', async () => {
                                   try {
                                       const finalGraphMessage = await graphMessage.fetch();
                                       const disabledComponents = finalGraphMessage.components.map(row => ActionRowBuilder.from(row).setComponents(row.components.map(c => ButtonBuilder.from(c).setDisabled(true))));
                                       await finalGraphMessage.edit({ components: disabledComponents });
                                   } catch (endError) { if (endError.code !== 10008) console.error('Error disabling graph buttons:', endError); }
                                });

                            } catch (graphError) { console.error(graphError); await interaction.followUp({ content: '❌ Error generating points graph.'}); await graphInteraction.editReply({ content: 'Error.', components: [] }).catch(()=>{}); }
                        });
                        graphCollector.on('end', async (collected, reason) => { if (reason === 'time') { await graphPromptMessage.edit({ content: '⏱️ Points graph timeframe selection timed out.', components: [] }).catch(()=>{}); } });

                    } else if (i.customId === 'show_channel_graph_button') {
                        const channelGraphTimeframeSelect = new StringSelectMenuBuilder().setCustomId('select_channel_graph_timeframe').setPlaceholder('Choose channel activity timeframe').addOptions( { label: 'All Time', value: 'all' }, { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' } );
                        const channelGraphPromptRow = new ActionRowBuilder().addComponents(channelGraphTimeframeSelect);
                        const channelGraphPromptMessage = await i.reply({ content: '🏘️ Please select the timeframe for the Top **Channel Activity** graph:', components: [channelGraphPromptRow], ephemeral: true, fetchReply: true });
                        const channelGraphCollector = channelGraphPromptMessage.createMessageComponentCollector({ filter: (intUser) => intUser.user.id === i.user.id, time: 60000, max: 1 });

                        channelGraphCollector.on('collect', async (channelInteraction) => {
                            try {
                                await channelInteraction.deferUpdate();
                                const selectedTimeframe = channelInteraction.values[0];
                                
                                const fullDataRaw = await getTopHelpersByChannelActivity(selectedTimeframe, 100);

                                if (!fullDataRaw || fullDataRaw.length === 0) {
                                    await channelInteraction.editReply({ content: `No channel activity found for the ${selectedTimeframe} timeframe.`, components: [] });
                                    return;
                                }

                                let currentPage = 0;
                                const pageSize = 8;
                                const totalPages = Math.ceil(fullDataRaw.length / pageSize);

                                async function generateChannelGraphPage(pageDataRaw, interaction) {
                                    const pageUsersProcessed = await processUsers(pageDataRaw, interaction);
                                    const userIds = pageUsersProcessed.map(u => u.id);
                                    const channelStats = await getChannelHelpStats(userIds, selectedTimeframe);
                                    const usersWithStats = pageUsersProcessed.map(user => ({ ...user, ...(channelStats.find(s => s.user_id === user.id) || { school_thanks: 0, university_thanks: 0 }) }));
                                    
                                    const chartBuffer = await createChannelActivityGraph(usersWithStats, selectedTimeframe);
                                    const avatarBuffer = await createAvatarStrip(usersWithStats, 900, 48, 5);
                                    const finalBuffer = await combineChartAndAvatars(chartBuffer, avatarBuffer, 900, 600, 48 + 5 * 2);
                                    return new AttachmentBuilder(finalBuffer, { name: 'channel-activity-graph.png' });
                                }

                                const attachment = await generateChannelGraphPage(fullDataRaw.slice(0, pageSize), channelInteraction);

                                const buttons = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`graph_page_prev_channel_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(true),
                                    new ButtonBuilder().setCustomId(`graph_page_next_channel_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(totalPages <= 1)
                                );
                                
                                const timeframeTitle = selectedTimeframe.charAt(0).toUpperCase() + selectedTimeframe.slice(1);

                                const graphMessage = await interaction.followUp({
                                    content: `🏘️ Top Helper **Channel Activity** graph (${timeframeTitle}) requested by ${interaction.user}. Page ${currentPage + 1} of ${totalPages}`,
                                    files: [attachment],
                                    components: [buttons]
                                });
                                await channelInteraction.editReply({ content: 'Channel activity graph generated!', components: [] });

                                const paginationCollector = graphMessage.createMessageComponentCollector({ time: 300000 });

                                paginationCollector.on('collect', async (buttonInteraction) => {
                                    try {
                                        await buttonInteraction.deferUpdate();
                                        const action = buttonInteraction.customId.split('_')[2];

                                        if (action === 'next') currentPage++;
                                        else if (action === 'prev') currentPage--;

                                        const newPageDataRaw = fullDataRaw.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
                                        const newAttachment = await generateChannelGraphPage(newPageDataRaw, buttonInteraction);

                                        const newButtons = new ActionRowBuilder().addComponents(
                                         new ButtonBuilder().setCustomId(`graph_page_prev_channel_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(currentPage === 0),
                                         new ButtonBuilder().setCustomId(`graph_page_next_channel_${selectedTimeframe}`).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(currentPage >= totalPages - 1)
                                        );
                                        
                                        await graphMessage.edit({
                                            content: `🏘️ Top Helper **Channel Activity** graph (${timeframeTitle}) requested by ${interaction.user}. Page ${currentPage + 1} of ${totalPages}`,
                                            files: [newAttachment],
                                            components: [newButtons]
                                        });
                                    } catch (pageError) { console.error('Error during channel graph pagination:', pageError); await buttonInteraction.followUp({ content: 'An error occurred while changing pages.', ephemeral: true }).catch(() => {}); }
                                });

                                paginationCollector.on('end', async () => {
                                   try {
                                       const finalGraphMessage = await graphMessage.fetch();
                                       const disabledComponents = finalGraphMessage.components.map(row => ActionRowBuilder.from(row).setComponents(row.components.map(c => ButtonBuilder.from(c).setDisabled(true))));
                                       await finalGraphMessage.edit({ components: disabledComponents });
                                   } catch (endError) { if (endError.code !== 10008) console.error('Error disabling graph buttons:', endError); }
                                });

                            } catch (graphError) { console.error('Channel graph error:', graphError); await interaction.followUp({ content: '❌ Error generating channel activity graph.'}); await channelInteraction.editReply({ content: 'Error.', components: [] }).catch(()=>{}); }
                        });
                        channelGraphCollector.on('end', async (_collected, reason) => { if (reason === 'time') { await channelGraphPromptMessage.edit({ content: '⏱️ Channel activity graph timeframe selection timed out.', components: [] }).catch(()=>{}); } });
                    }

                } catch (collectorError) { console.error(collectorError); try { if (!i.replied && !i.deferred) await i.reply({ content: 'Error processing selection.', ephemeral: true }); else await i.followUp({ content: 'Error processing selection.', ephemeral: true }); } catch (e) {} }
            });

            collector.on('end', async (_collected, reason) => {
                if (reason !== 'messageDelete' && reason !== 'channelDelete' && reason !== 'guildDelete') { try { const finalMessage = await interaction.channel.messages.fetch(response.id); if (finalMessage) { const disabledComponents = finalMessage.components.map(row => { const newRow = ActionRowBuilder.from(row); newRow.components.forEach(component => component.setDisabled(true)); return newRow; }); await finalMessage.edit({ components: disabledComponents }); } } catch (editError) { if (editError.code !== 10008 && editError.code !== 50027) { console.error('Error disabling components on collector end:', editError); } } }
            });

        } catch (error) { console.error(error); if (interaction.deferred || interaction.replied) await interaction.editReply('❌ Error fetching top helpers.'); else await interaction.reply({ content: '❌ Error fetching top helpers.', ephemeral: true }); }
    },
};

function createPages(users) {
    const pages = [];
    const pageSize = 10;
    
    if (!users || users.length === 0) {
        return [[]];
    }
    
    for (let i = 0; i < users.length; i += pageSize) {
        pages.push(users.slice(i, i + pageSize));
    }
    
    return pages;
}

function createPageSelectMenu(pages, selectedPage = 0) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_page')
        .setPlaceholder('Select a page');

    const hasResults = Array.isArray(pages) && pages.some(page => page.length > 0);

    if (!hasResults) {
        selectMenu.addOptions({ label: 'Page 1', value: '0' }).setDisabled(true);
        return selectMenu;
    }

    const clampedSelected = Math.min(Math.max(selectedPage, 0), pages.length - 1);

    for (let index = 0; index < pages.length; index++) {
        selectMenu.addOptions({
            label: `Page ${index + 1}`,
            value: `${index}`,
            default: index === clampedSelected,
        });
    }

    return selectMenu;
}

function createTimeframeSelectMenu(selectedTimeframe) {
    return new StringSelectMenuBuilder()
        .setCustomId('select_timeframe')
        .setPlaceholder('Select leaderboard timeframe')
        .addOptions(
            { label: 'All Time', value: 'all', default: selectedTimeframe === 'all' },
            { label: 'Weekly', value: 'weekly', default: selectedTimeframe === 'weekly' },
            { label: 'Monthly', value: 'monthly', default: selectedTimeframe === 'monthly' },
        );
}

function createGraphButtonsRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('show_points_graph_button')
            .setLabel('Points Graph')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📊'),
        new ButtonBuilder()
            .setCustomId('show_channel_graph_button')
            .setLabel('Channel Activity Graph')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🏘️'),
    );
}


function createEmbed(users, pageNumber, timeframe, totalPages) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`:trophy: Top Helpers - ${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)} ${timeframe === 'all' ? 'Points' : 'Points Earned'}`)
        .setTimestamp()
        .setFooter({ text: `Page ${pageNumber} of ${totalPages}` });

    if (users && users.length > 0) {
        const rows = users.map((user, index) =>
            formatUser(user, (pageNumber - 1) * 10 + index + 1, timeframe)
        );
        embed.setDescription(rows.join('\n'));
    } else {
        embed.setDescription('No helpers found for this timeframe.');
        if (totalPages <= 0) {
            embed.setFooter({ text: 'Page 1 of 1' });
        }
    }

    return embed;
}

function formatUser(user, rank, timeframe) {
    const verifiedEmojiId = process.env.VERIFIED_EMOJI_ID;
    const unverifiedEmojiId = process.env.UNVERIFIED_EMOJI_ID;
    const helperPointsEmojiId = process.env.HELPER_POINTS_EMOJI_ID;
    const verifiedText = user.isVerified
        ? `<:verified:${verifiedEmojiId}>`
        : `<:unverified:${unverifiedEmojiId}>`;
    let username = user.tag || `User ${user.id}`;
    username = username.replace(/`/g, "'").replace(/[*_~]/g, '');
    if (username.length > 25) username = username.substring(0, 22) + '...';
    const pointsLabel = timeframe === 'all' ? 'Points' : 'Points Earned';
    return `**${rank}**. ${verifiedText} **${username}**\n<:helper_points:${helperPointsEmojiId}> ${pointsLabel}: **${user.points}**`;
}
