const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ======================================================
// FILES / DEFAULTS
// ======================================================

const DATA_FILE = path.join(__dirname, "bot-data.json");
const SERVER_CONFIG_FILE = path.join(__dirname, "server-config.json");

const PURCHASE_EMOJI = "1533159560490123484";
const SUPPORT_EMOJI = "1533160286201184328";

// No cooldowns.
// Support never auto-deletes.
// Everything else auto-deletes after 14 hours.
const DEFAULT_TYPE_SETTINGS = {
    purchase: { autoDeleteMinutes: 840 },
    support: { autoDeleteMinutes: null },
    configs: { autoDeleteMinutes: 840 },
    edit: { autoDeleteMinutes: 840 },
    appeal: { autoDeleteMinutes: 840 }
};

// Queue moves down by 1 every 5 hours.
const QUEUE_MOVE_INTERVAL_MS = 5 * 60 * 60 * 1000;

// DM reminder every 3 hours.
const DM_REMINDER_INTERVAL_MS = 3 * 60 * 60 * 1000;

// ======================================================
// PERSISTENT DATA
// ======================================================

function loadJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.error(`Failed to read ${path.basename(file)}:`, error);
        return fallback;
    }
}

function saveJson(file, value) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(value, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error(`Failed to save ${path.basename(file)}:`, error);
    }
}

let botData = loadJson(DATA_FILE, {
    claims: {},
    reminders: {},
    queue: {}
});

if (!botData.claims) botData.claims = {};
if (!botData.reminders) botData.reminders = {};
if (!botData.queue) botData.queue = {};

let serverConfig = loadJson(SERVER_CONFIG_FILE, {});

// ======================================================
// OWNER / PERMISSIONS
// ======================================================

function isOwner(userId) {
    return Boolean(process.env.OWNER_ID) &&
        userId === process.env.OWNER_ID;
}

function parseIds(value = "") {
    return value
        .split(",")
        .map(id => id.trim())
        .filter(id => /^\d+$/.test(id));
}

function getEnvSupportRoleIds() {
    return parseIds(
        process.env.SUPPORT_ROLE_IDS ||
        process.env.SUPPORT_ROLE_ID ||
        ""
    );
}

function getGuildSettings(guild) {
    const custom = serverConfig[guild.id] || {};

    return {
        logChannelId:
            custom.logChannelId ||
            process.env.TICKET_LOG_CHANNEL_ID ||
            null,

        errorChannelId:
            custom.errorChannelId ||
            process.env.ERROR_LOG_CHANNEL_ID ||
            null,

        typeRoles: {
            purchase:
                custom.typeRoles?.purchase ||
                parseIds(process.env.PURCHASE_ROLE_IDS || "")
                    .concat(getEnvSupportRoleIds()),

            support:
                custom.typeRoles?.support ||
                parseIds(process.env.SUPPORT_ROLE_IDS || process.env.SUPPORT_ROLE_ID || ""),

            configs:
                custom.typeRoles?.configs ||
                parseIds(process.env.CONFIG_ROLE_IDS || "")
                    .concat(getEnvSupportRoleIds()),

            edit:
                custom.typeRoles?.edit ||
                parseIds(process.env.EDIT_ROLE_IDS || "")
                    .concat(getEnvSupportRoleIds()),

            appeal:
                custom.typeRoles?.appeal ||
                parseIds(process.env.APPEAL_ROLE_IDS || "")
                    .concat(getEnvSupportRoleIds())
        },

        typeSettings: {
            purchase: {
                ...DEFAULT_TYPE_SETTINGS.purchase,
                ...(custom.typeSettings?.purchase || {})
            },
            support: {
                ...DEFAULT_TYPE_SETTINGS.support,
                ...(custom.typeSettings?.support || {})
            },
            configs: {
                ...DEFAULT_TYPE_SETTINGS.configs,
                ...(custom.typeSettings?.configs || {})
            },
            edit: {
                ...DEFAULT_TYPE_SETTINGS.edit,
                ...(custom.typeSettings?.edit || {})
            },
            appeal: {
                ...DEFAULT_TYPE_SETTINGS.appeal,
                ...(custom.typeSettings?.appeal || {})
            }
        }
    };
}

function getValidRoleIds(guild, type) {
    const settings = getGuildSettings(guild);

    return [...new Set(settings.typeRoles[type] || [])]
        .filter(roleId => guild.roles.cache.has(roleId));
}

function isSupportMember(member, type = null) {
    if (!member) return false;
    if (isOwner(member.id)) return true;

    if (
        member.permissions.has(
            PermissionFlagsBits.ManageChannels
        )
    ) {
        return true;
    }

    const guild = member.guild;

    const roleIds = type
        ? getValidRoleIds(guild, type)
        : Object.keys(DEFAULT_TYPE_SETTINGS)
            .flatMap(ticketType =>
                getValidRoleIds(guild, ticketType)
            );

    return [...new Set(roleIds)]
        .some(roleId => member.roles.cache.has(roleId));
}

// ======================================================
// HELPERS
// ======================================================

function safeChannelName(text) {
    const cleaned = text
        .toLowerCase()
        .replace(/\+/g, "-")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 90);

    return cleaned || "ticket";
}

function isTicketChannel(channel) {
    return Boolean(
        channel &&
        channel.topic &&
        channel.topic.includes("ticket-owner:")
    );
}

function getTopicValue(channel, key) {
    if (!channel?.topic) return null;

    const match = channel.topic.match(
        new RegExp(`${key}:([^|]+)`)
    );

    return match ? match[1] : null;
}

function getTicketOwner(channel) {
    return getTopicValue(channel, "ticket-owner");
}

function getTicketType(channel) {
    return getTopicValue(channel, "ticket-type");
}

function getTicketCreatedAt(channel) {
    const raw = getTopicValue(channel, "created-at");
    return raw ? Number(raw) : null;
}

function getDeleteAt(channel) {
    const raw = getTopicValue(channel, "delete-at");
    return raw ? Number(raw) : null;
}

function getTicketMentions(user, guild, type) {
    const roleMentions = getValidRoleIds(guild, type)
        .map(id => `<@&${id}>`)
        .join(" ");

    return roleMentions
        ? `<@${user.id}> ${roleMentions}`
        : `<@${user.id}>`;
}

function typeDisplayName(type) {
    return {
        purchase: "Purchase",
        support: "Support",
        configs: "Purchase Config",
        edit: "Edit / Edit Pack",
        appeal: "Blacklist Appeal"
    }[type] || type;
}

function formatDuration(ms) {
    const totalMinutes = Math.max(
        0,
        Math.ceil(ms / 60000)
    );

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
}

function ticketLink(guildId, channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
}

// ======================================================
// MANUAL QUEUE SYSTEM
// ======================================================

function setQueuePosition(userId, position) {
    botData.queue[userId] = {
        startingPosition: position,
        setAt: Date.now()
    };

    saveJson(DATA_FILE, botData);
}

function getCurrentQueuePosition(userId) {
    const entry = botData.queue[userId];

    if (!entry) {
        return null;
    }

    const timePassed =
        Date.now() - entry.setAt;

    const positionsMoved =
        Math.floor(
            timePassed /
            QUEUE_MOVE_INTERVAL_MS
        );

    return Math.max(
        1,
        entry.startingPosition -
        positionsMoved
    );
}

function removeFromQueue(userId) {
    if (botData.queue[userId]) {
        delete botData.queue[userId];
        saveJson(DATA_FILE, botData);
    }
}

// ======================================================
// LOGGING / ERRORS
// ======================================================

async function resolveTextChannel(guild, channelId) {
    if (!channelId) return null;

    try {
        const channel =
            guild.channels.cache.get(channelId) ||
            await guild.channels.fetch(channelId);

        return channel?.isTextBased()
            ? channel
            : null;
    } catch {
        return null;
    }
}

async function logError(guild, context, error) {
    console.error(context, error);

    if (!guild) return;

    const settings = getGuildSettings(guild);
    const channel = await resolveTextChannel(
        guild,
        settings.errorChannelId
    );

    if (!channel) return;

    const text =
        String(error?.stack || error || "Unknown error")
            .slice(0, 3800);

    try {
        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Bot Error")
                    .setDescription(
                        `**Context:** ${context}\n\n\`\`\`\n${text}\n\`\`\``
                    )
                    .setTimestamp()
            ]
        });
    } catch {}
}

async function sendTicketLog(guild, embed, attachment = null) {
    const settings = getGuildSettings(guild);
    const logChannel = await resolveTextChannel(
        guild,
        settings.logChannelId
    );

    if (!logChannel) return;

    const payload = {
        embeds: [embed]
    };

    if (attachment) {
        payload.files = [attachment];
    }

    try {
        await logChannel.send(payload);
    } catch (error) {
        await logError(
            guild,
            "Failed to send ticket log",
            error
        );
    }
}

// ======================================================
// DM TICKET REMINDERS
// ======================================================

async function sendTicketCreatedDm(user, channel, type, deleteAt) {
    const link = ticketLink(
        channel.guild.id,
        channel.id
    );

    const queuePosition =
        getCurrentQueuePosition(user.id);

    let content =
`Your **${typeDisplayName(type)}** ticket has been created.

**Ticket:** [#${channel.name}](${link})`;

    if (queuePosition !== null) {
        content +=
`\n\n**Current Queue Position:** **#${queuePosition}**`;
    }

    if (deleteAt) {
        content +=
`\n\nThis ticket will automatically delete in **${formatDuration(deleteAt - Date.now())}**.

I'll remind you about it every **3 hours** until it closes.`;
    } else {
        content +=
`\n\nThis ticket does **not** automatically delete.`;
    }

    try {
        await user.send({
            content
        });
    } catch {}
}

async function sendTicketReminderDm(user, channel, deleteAt) {
    const remaining =
        deleteAt - Date.now();

    if (remaining <= 0) return;

    const link = ticketLink(
        channel.guild.id,
        channel.id
    );

    const queuePosition =
        getCurrentQueuePosition(user.id);

    let content =
`⏰ **Ticket Reminder**

Your ticket is still open:

**Ticket:** [#${channel.name}](${link})`;

    if (queuePosition !== null) {
        content +=
`\n\n**Current Queue Position:** **#${queuePosition}**`;
    }

    content +=
`\n\nIt will automatically delete in approximately **${formatDuration(remaining)}**.`;

    try {
        await user.send({
            content
        });
    } catch {}
}

function registerTicketReminder(channel, ownerId, deleteAt) {
    if (!deleteAt) {
        delete botData.reminders[channel.id];
        saveJson(DATA_FILE, botData);
        return;
    }

    botData.reminders[channel.id] = {
        guildId: channel.guild.id,
        ownerId,
        deleteAt,
        nextReminderAt:
            Date.now() + DM_REMINDER_INTERVAL_MS
    };

    saveJson(DATA_FILE, botData);
}

function cleanupTicketReminder(channelId) {
    if (botData.reminders[channelId]) {
        delete botData.reminders[channelId];
        saveJson(DATA_FILE, botData);
    }
}

async function rebuildReminderRecords() {
    let changed = false;

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.channels.fetch();

            for (const channel of guild.channels.cache.values()) {
                if (!isTicketChannel(channel)) continue;

                const deleteAt = getDeleteAt(channel);
                if (!deleteAt) continue;

                if (!botData.reminders[channel.id]) {
                    const ownerId =
                        getTicketOwner(channel);

                    if (!ownerId) continue;

                    const createdAt =
                        getTicketCreatedAt(channel) ||
                        Date.now();

                    let nextReminderAt =
                        createdAt +
                        DM_REMINDER_INTERVAL_MS;

                    while (
                        nextReminderAt <= Date.now() &&
                        nextReminderAt < deleteAt
                    ) {
                        nextReminderAt +=
                            DM_REMINDER_INTERVAL_MS;
                    }

                    botData.reminders[channel.id] = {
                        guildId: guild.id,
                        ownerId,
                        deleteAt,
                        nextReminderAt
                    };

                    changed = true;
                }
            }
        } catch (error) {
            console.error(
                `Failed to rebuild reminders for ${guild.id}:`,
                error
            );
        }
    }

    for (const channelId of Object.keys(botData.reminders)) {
        let found = false;

        for (const guild of client.guilds.cache.values()) {
            if (guild.channels.cache.has(channelId)) {
                found = true;
                break;
            }
        }

        if (!found) {
            delete botData.reminders[channelId];
            changed = true;
        }
    }

    if (changed) {
        saveJson(DATA_FILE, botData);
    }
}

async function processDmReminders() {
    const now = Date.now();
    let changed = false;

    for (
        const [channelId, reminder]
        of Object.entries(botData.reminders)
    ) {
        if (!reminder?.deleteAt) {
            delete botData.reminders[channelId];
            changed = true;
            continue;
        }

        if (now >= reminder.deleteAt) {
            continue;
        }

        if (now < reminder.nextReminderAt) {
            continue;
        }

        const guild =
            client.guilds.cache.get(
                reminder.guildId
            );

        if (!guild) continue;

        let channel;

        try {
            channel =
                guild.channels.cache.get(channelId) ||
                await guild.channels.fetch(channelId);
        } catch {
            delete botData.reminders[channelId];
            changed = true;
            continue;
        }

        if (!channel || !isTicketChannel(channel)) {
            delete botData.reminders[channelId];
            changed = true;
            continue;
        }

        let user;

        try {
            user = await client.users.fetch(
                reminder.ownerId
            );
        } catch {
            user = null;
        }

        if (user) {
            await sendTicketReminderDm(
                user,
                channel,
                reminder.deleteAt
            );
        }

        let next =
            reminder.nextReminderAt;

        while (
            next <= now &&
            next < reminder.deleteAt
        ) {
            next +=
                DM_REMINDER_INTERVAL_MS;
        }

        reminder.nextReminderAt = next;
        botData.reminders[channelId] = reminder;
        changed = true;
    }

    if (changed) {
        saveJson(DATA_FILE, botData);
    }
}

// ======================================================
// TRANSCRIPTS
// ======================================================

async function fetchAllMessages(channel, maxMessages = 1000) {
    const all = [];
    let before;

    while (all.length < maxMessages) {
        const batch = await channel.messages.fetch({
            limit: Math.min(100, maxMessages - all.length),
            before
        });

        if (!batch.size) break;

        all.push(...batch.values());
        before = batch.last().id;

        if (batch.size < 100) break;
    }

    return all.sort(
        (a, b) =>
            a.createdTimestamp - b.createdTimestamp
    );
}

function buildTranscript(channel, messages) {
    const lines = [
        `Transcript for #${channel.name}`,
        `Channel ID: ${channel.id}`,
        `Generated: ${new Date().toISOString()}`,
        "============================================================",
        ""
    ];

    for (const message of messages) {
        const timestamp =
            new Date(message.createdTimestamp)
                .toISOString();

        const author =
            `${message.author?.tag || "Unknown"} (${message.author?.id || "?"})`;

        lines.push(`[${timestamp}] ${author}`);
        lines.push(message.content || "[no text]");

        for (const attachment of message.attachments.values()) {
            lines.push(`[attachment] ${attachment.url}`);
        }

        for (const embed of message.embeds) {
            if (embed.title) {
                lines.push(`[embed title] ${embed.title}`);
            }

            if (embed.description) {
                lines.push(`[embed description] ${embed.description}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}

async function makeTranscriptAttachment(channel) {
    try {
        const messages =
            await fetchAllMessages(channel);

        const transcript =
            buildTranscript(channel, messages);

        return new AttachmentBuilder(
            Buffer.from(transcript, "utf8"),
            {
                name:
                    `transcript-${channel.name}-${Date.now()}.txt`
            }
        );
    } catch (error) {
        await logError(
            channel.guild,
            `Transcript generation failed for #${channel.name}`,
            error
        );

        return null;
    }
}

// ======================================================
// TICKET CLOSING
// ======================================================

async function closeTicketChannel(
    channel,
    closedBy,
    reason = "Ticket closed"
) {
    if (!isTicketChannel(channel)) return;

    const guild = channel.guild;
    const ownerId = getTicketOwner(channel);
    const type = getTicketType(channel);
    const createdAt = getTicketCreatedAt(channel);

    const attachment =
        await makeTranscriptAttachment(channel);

    const logEmbed =
        new EmbedBuilder()
            .setTitle("Ticket Closed")
            .addFields(
                {
                    name: "Ticket",
                    value: `#${channel.name}`,
                    inline: true
                },
                {
                    name: "Type",
                    value: typeDisplayName(type),
                    inline: true
                },
                {
                    name: "Owner",
                    value: ownerId
                        ? `<@${ownerId}>`
                        : "Unknown",
                    inline: true
                },
                {
                    name: "Closed By",
                    value: closedBy
                        ? `<@${closedBy.id}>`
                        : "Automatic",
                    inline: true
                },
                {
                    name: "Reason",
                    value: reason,
                    inline: false
                }
            )
            .setTimestamp();

    if (createdAt) {
        logEmbed.addFields({
            name: "Open For",
            value: formatDuration(
                Date.now() - createdAt
            ),
            inline: true
        });
    }

    await sendTicketLog(
        guild,
        logEmbed,
        attachment
    );

    if (ownerId) {
        try {
            const owner =
                await client.users.fetch(ownerId);

            await owner.send({
                content:
`Your **${typeDisplayName(type)}** ticket **#${channel.name}** has been closed.

**Reason:** ${reason}`
            });
        } catch {}
    }

    delete botData.claims[channel.id];
    cleanupTicketReminder(channel.id);
    saveJson(DATA_FILE, botData);

    await channel.delete(reason);
}

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(
    interaction,
    type,
    extraData = {}
) {
    const guild = interaction.guild;
    const user = interaction.user;

    await guild.channels.fetch();
    await guild.roles.fetch();

    const guildSettings =
        getGuildSettings(guild);

    const typeSettings =
        guildSettings.typeSettings[type];

    const existingTicket =
        guild.channels.cache.find(channel =>
            channel.topic &&
            channel.topic.includes(
                `ticket-owner:${user.id}`
            ) &&
            channel.topic.includes(
                `ticket-type:${type}`
            )
        );

    if (existingTicket) {
        return interaction.editReply({
            content:
                `You already have a **${typeDisplayName(type)}** ticket open: ${existingTicket}`
        });
    }

    let baseName;

    if (
        type === "purchase" &&
        extraData.product
    ) {
        baseName =
            safeChannelName(extraData.product);
    } else if (
        type === "configs" &&
        extraData.configType
    ) {
        baseName =
            safeChannelName(extraData.configType);
    } else if (
        type === "edit" &&
        extraData.editType
    ) {
        baseName =
            safeChannelName(extraData.editType);
    } else {
        baseName =
            safeChannelName(
                `${type}-${user.username}`
            );
    }

    let ticketName = baseName;

    const sameName =
        guild.channels.cache.find(
            channel =>
                channel.name === ticketName
        );

    if (sameName) {
        ticketName =
            `${baseName}-${user.id.slice(-4)}`;
    }

    const createdAt = Date.now();

    let topic =
        `ticket-owner:${user.id}|ticket-type:${type}|created-at:${createdAt}`;

    let deleteAt = null;

    if (
        typeSettings?.autoDeleteMinutes !== null &&
        typeSettings?.autoDeleteMinutes !== undefined
    ) {
        deleteAt =
            createdAt +
            typeSettings.autoDeleteMinutes *
            60 *
            1000;

        topic += `|delete-at:${deleteAt}`;
    }

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles
            ]
        }
    ];

    const validStaffRoles =
        getValidRoleIds(guild, type);

    for (const roleId of validStaffRoles) {
        permissionOverwrites.push({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        });
    }

    const ticketChannel =
        await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            topic,
            permissionOverwrites
        });

    registerTicketReminder(
        ticketChannel,
        user.id,
        deleteAt
    );

    const claimButton =
        new ButtonBuilder()
            .setCustomId("claim_ticket")
            .setLabel("Claim Ticket")
            .setStyle(ButtonStyle.Secondary);

    const closeButton =
        new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("Close Ticket")
            .setStyle(ButtonStyle.Danger);

    const ticketButtons =
        new ActionRowBuilder()
            .addComponents(
                claimButton,
                closeButton
            );

    let ticketEmbed;

    if (type === "purchase") {
        const product =
            extraData.product || "Not provided";

        const payment =
            extraData.payment || "Not provided";

        const orderNumber =
            Math.floor(
                1000 +
                Math.random() * 9000
            );

        ticketEmbed =
            new EmbedBuilder()
                .setTitle(
                    `Order · #${orderNumber}`
                )
                .setDescription(
                    "**Vurpin Purchase**"
                )
                .addFields(
                    {
                        name: "Product",
                        value: product,
                        inline: true
                    },
                    {
                        name: "Payment",
                        value: payment,
                        inline: true
                    },
                    {
                        name: "Checkout",
                        value:
`Please wait for Vurpin staff to assist you.

Confirm your selected account and payment method before sending payment.`
                    }
                );
    }

    if (type === "support") {
        ticketEmbed =
            new EmbedBuilder()
                .setTitle(
                    "Vurpin Support"
                )
                .setDescription(
`Welcome <@${user.id}>!

Please explain what you need help with below.

A member of Vurpin support will assist you as soon as possible.

**This support ticket does not auto-delete.**`
                );
    }

    if (type === "configs") {
        ticketEmbed =
            new EmbedBuilder()
                .setTitle(
                    "Vurpin Config Purchase"
                )
                .addFields(
                    {
                        name: "Config",
                        value:
                            extraData.configType ||
                            "Not provided"
                    },
                    {
                        name: "Details",
                        value:
                            extraData.details ||
                            "Not provided"
                    }
                );
    }

    if (type === "edit") {
        ticketEmbed =
            new EmbedBuilder()
                .setTitle(
                    "Vurpin Edit Order"
                )
                .addFields(
                    {
                        name: "Edit / Pack",
                        value:
                            extraData.editType ||
                            "Not provided"
                    },
                    {
                        name: "Details",
                        value:
                            extraData.details ||
                            "Not provided"
                    }
                );
    }

    if (type === "appeal") {
        ticketEmbed =
            new EmbedBuilder()
                .setTitle(
                    "Vurpin Blacklist Appeal"
                )
                .setDescription(
`<@${user.id}> has submitted a blacklist appeal.

**Appeal Reason**

${extraData.reason || "No reason provided."}

Please wait for Vurpin staff to review your appeal.`
                );
    }

    ticketEmbed
        .setFooter({
            text:
                typeSettings?.autoDeleteMinutes == null
                    ? "Vurpin • No automatic deletion"
                    : "Vurpin • Auto deletes after 14 hours"
        })
        .setTimestamp();

    await ticketChannel.send({
        content:
            getTicketMentions(
                user,
                guild,
                type
            ),
        embeds: [ticketEmbed],
        components: [ticketButtons]
    });

    const openLog =
        new EmbedBuilder()
            .setTitle("Ticket Opened")
            .addFields(
                {
                    name: "Ticket",
                    value: `${ticketChannel}`,
                    inline: true
                },
                {
                    name: "Type",
                    value: typeDisplayName(type),
                    inline: true
                },
                {
                    name: "Owner",
                    value: `<@${user.id}>`,
                    inline: true
                }
            )
            .setTimestamp();

    await sendTicketLog(
        guild,
        openLog
    );

    await sendTicketCreatedDm(
        user,
        ticketChannel,
        type,
        deleteAt
    );

    await interaction.editReply({
        content:
            `✅ Your ticket has been created: ${ticketChannel}`
    });
}

// ======================================================
// READY / TIMERS
// ======================================================

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log("Bot is ready.");
    console.log("Support tickets: no automatic deletion");
    console.log("All other ticket types: auto-delete after 14 hours");
    console.log("Ticket DM reminders: every 3 hours");
    console.log("Manual queue: owner sets position, drops by 1 every 5 hours");

    await rebuildReminderRecords();

    setInterval(async () => {
        for (
            const guild
            of client.guilds.cache.values()
        ) {
            try {
                await guild.channels.fetch();

                for (
                    const channel
                    of guild.channels.cache.values()
                ) {
                    if (!isTicketChannel(channel)) {
                        continue;
                    }

                    const deleteAt =
                        getDeleteAt(channel);

                    if (!deleteAt) continue;

                    if (Date.now() >= deleteAt) {
                        try {
                            await closeTicketChannel(
                                channel,
                                null,
                                "Automatic ticket expiration"
                            );
                        } catch (error) {
                            await logError(
                                guild,
                                `Auto-delete failed for #${channel.name}`,
                                error
                            );
                        }
                    }
                }
            } catch (error) {
                await logError(
                    guild,
                    "Ticket expiration scan failed",
                    error
                );
            }
        }
    }, 60 * 1000);

    setInterval(async () => {
        try {
            await processDmReminders();
        } catch (error) {
            console.error(
                "DM reminder scan failed:",
                error
            );
        }
    }, 60 * 1000);
});

// ======================================================
// PREFIX COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (message.author.bot) return;
            if (!message.guild) return;

            if (
                message.content
                    .toLowerCase()
                    .startsWith("!check")
            ) {
                if (!isOwner(message.author.id)) {
                    return;
                }

                const user =
                    message.mentions.users.first();

                if (!user) {
                    return message.reply(
                        "Use `!check @user`"
                    );
                }

                const position =
                    getCurrentQueuePosition(
                        user.id
                    );

                try {
                    await message.delete();
                } catch {}

                if (position === null) {
                    await message.channel.send({
                        content:
                            `${user} is not currently in the queue.`
                    });

                    return;
                }

                await message.channel.send({
                    content:
                        `${user} is currently **#${position}** in the queue.`
                });

                return;
            }

            if (
                message.content
                    .toLowerCase()
                    .trim() === "$close"
            ) {
                if (!isOwner(message.author.id)) {
                    return;
                }

                if (!isTicketChannel(message.channel)) {
                    return message.reply(
                        "This isn't a ticket channel."
                    );
                }

                await message.channel.send(
                    "Ticket closing in 3 seconds..."
                );

                setTimeout(async () => {
                    try {
                        await closeTicketChannel(
                            message.channel,
                            message.author,
                            "Closed with $close"
                        );
                    } catch (error) {
                        await logError(
                            message.guild,
                            "$close failed",
                            error
                        );
                    }
                }, 3000);

                return;
            }
        } catch (error) {
            await logError(
                message.guild,
                "Prefix command error",
                error
            );
        }
    }
);

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                interaction.isChatInputCommand()
            ) {
                const command =
                    interaction.commandName;

                const ownerOnly = [
                    "message",
                    "preview",
                    "embed",
                    "ticketpanel",
                    "check",
                    "queue",
                    "removequeue"
                ];

                if (
                    ownerOnly.includes(command) &&
                    !isOwner(interaction.user.id)
                ) {
                    return interaction.reply({
                        content:
                            "You can't use this command.",
                        ephemeral: true
                    });
                }

                const managementCommands = [
                    "close",
                    "claim",
                    "add",
                    "remove",
                    "rename"
                ];

                if (
                    managementCommands.includes(command)
                ) {
                    if (
                        !isTicketChannel(
                            interaction.channel
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "This command can only be used inside a ticket.",
                            ephemeral: true
                        });
                    }

                    const ticketType =
                        getTicketType(
                            interaction.channel
                        );

                    if (
                        !isOwner(interaction.user.id) &&
                        !isSupportMember(
                            interaction.member,
                            ticketType
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "You don't have permission to use this command.",
                            ephemeral: true
                        });
                    }
                }

                // /queue user position
                if (command === "queue") {
                    const user =
                        interaction.options
                            .getUser("user");

                    const position =
                        interaction.options
                            .getInteger("position");

                    setQueuePosition(
                        user.id,
                        position
                    );

                    try {
                        await user.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Vurpin Queue Update"
                                    )
                                    .setDescription(
`Your order has been added to the queue.

**Current Queue Position**
#${position}

Your position automatically moves forward over time.`
                                    )
                                    .setTimestamp()
                            ]
                        });
                    } catch {}

                    return interaction.reply({
                        content:
                            `${user} has been placed at **#${position}** in the queue.`,
                        ephemeral: true
                    });
                }

                // /removequeue user
                if (command === "removequeue") {
                    const user =
                        interaction.options
                            .getUser("user");

                    removeFromQueue(user.id);

                    return interaction.reply({
                        content:
                            `${user} has been removed from the queue.`,
                        ephemeral: true
                    });
                }

                // /check user
                if (command === "check") {
                    const user =
                        interaction.options
                            .getUser("user");

                    const position =
                        getCurrentQueuePosition(
                            user.id
                        );

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    if (position === null) {
                        await interaction.channel.send({
                            content:
                                `${user} is not currently in the queue.`
                        });

                        await interaction.deleteReply();
                        return;
                    }

                    await interaction.channel.send({
                        content:
                            `${user} is currently **#${position}** in the queue.`
                    });

                    await interaction.deleteReply();
                    return;
                }

                if (command === "message") {
                    const text =
                        interaction.options
                            .getString("text");

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    await interaction.channel.send({
                        content: text
                    });

                    await interaction.deleteReply();
                    return;
                }

                if (command === "preview") {
                    const file =
                        interaction.options
                            .getAttachment("file");

                    const message =
                        interaction.options
                            .getString("message");

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    const sendOptions = {
                        files: [file.url]
                    };

                    if (message) {
                        sendOptions.content =
                            message;
                    }

                    await interaction.channel.send(
                        sendOptions
                    );

                    await interaction.deleteReply();
                    return;
                }

                if (command === "embed") {
                    const title =
                        interaction.options
                            .getString("title");

                    let description =
                        interaction.options
                            .getString("description");

                    const image =
                        interaction.options
                            .getAttachment("image");

                    const thumbnail =
                        interaction.options
                            .getAttachment("thumbnail");

                    const color =
                        interaction.options
                            .getString("color");

                    const footer =
                        interaction.options
                            .getString("footer");

                    const url =
                        interaction.options
                            .getString("url");

                    const buttonLabel =
                        interaction.options
                            .getString("button_label");

                    const buttonUrl =
                        interaction.options
                            .getString("button_url");

                    description =
                        description.replace(
                            /\\n/g,
                            "\n"
                        );

                    const embed =
                        new EmbedBuilder()
                            .setTitle(title)
                            .setDescription(description);

                    if (url) {
                        embed.setURL(url);
                    }

                    if (footer) {
                        embed.setFooter({
                            text: footer
                        });
                    }

                    if (color) {
                        const cleaned =
                            color.replace("#", "");

                        if (
                            /^[0-9a-fA-F]{6}$/.test(
                                cleaned
                            )
                        ) {
                            embed.setColor(
                                parseInt(
                                    cleaned,
                                    16
                                )
                            );
                        }
                    }

                    if (image) {
                        if (
                            image.contentType?.startsWith(
                                "image/"
                            )
                        ) {
                            embed.setImage(
                                image.url
                            );
                        } else {
                            return interaction.reply({
                                content:
                                    "The image attachment has to be an image file.",
                                ephemeral: true
                            });
                        }
                    }

                    if (thumbnail) {
                        if (
                            thumbnail.contentType?.startsWith(
                                "image/"
                            )
                        ) {
                            embed.setThumbnail(
                                thumbnail.url
                            );
                        } else {
                            return interaction.reply({
                                content:
                                    "The thumbnail attachment has to be an image file.",
                                ephemeral: true
                            });
                        }
                    }

                    const rows = [];

                    if (
                        buttonLabel &&
                        buttonUrl
                    ) {
                        rows.push(
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setLabel(
                                            buttonLabel
                                        )
                                        .setURL(
                                            buttonUrl
                                        )
                                        .setStyle(
                                            ButtonStyle.Link
                                        )
                                )
                        );
                    }

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    await interaction.channel.send({
                        embeds: [embed],
                        components: rows
                    });

                    await interaction.deleteReply();
                    return;
                }

                if (command === "ticketpanel") {
                    await interaction.deferReply({
                        ephemeral: true
                    });

                    const menu =
                        new StringSelectMenuBuilder()
                            .setCustomId(
                                "ticket_menu"
                            )
                            .setPlaceholder(
                                "Ticket Information"
                            )
                            .addOptions([
                                {
                                    label: "Purchase",
                                    description:
                                        "Purchase a Roblox account",
                                    value: "purchase",
                                    emoji: {
                                        id:
                                            PURCHASE_EMOJI
                                    }
                                },
                                {
                                    label: "Support",
                                    description:
                                        "Get help from Vurpin support",
                                    value: "support",
                                    emoji: {
                                        id:
                                            SUPPORT_EMOJI
                                    }
                                },
                                {
                                    label:
                                        "Purchase Config",
                                    description:
                                        "Purchase a Vurpin config",
                                    value: "configs",
                                    emoji: "⚙️"
                                },
                                {
                                    label:
                                        "Buy Edit / Edit Pack",
                                    description:
                                        "Purchase an edit or edit pack",
                                    value: "edit",
                                    emoji: "🎬"
                                },
                                {
                                    label:
                                        "Blacklist Appeal",
                                    description:
                                        "Submit a blacklist appeal",
                                    value: "appeal",
                                    emoji: "📄"
                                }
                            ]);

                    const row =
                        new ActionRowBuilder()
                            .addComponents(menu);

                    await interaction.channel.send({
                        content:
                            "> **To create a ticket, select an option below**",
                        components: [row]
                    });

                    await interaction.deleteReply();
                    return;
                }

                if (command === "claim") {
                    const channel =
                        interaction.channel;

                    const existing =
                        botData.claims[channel.id];

                    if (existing) {
                        return interaction.reply({
                            content:
                                `This ticket is already claimed by <@${existing}>.`,
                            ephemeral: true
                        });
                    }

                    botData.claims[channel.id] =
                        interaction.user.id;

                    saveJson(
                        DATA_FILE,
                        botData
                    );

                    await interaction.reply({
                        content:
                            `✅ Ticket claimed by ${interaction.user}.`
                    });

                    await sendTicketLog(
                        interaction.guild,
                        new EmbedBuilder()
                            .setTitle(
                                "Ticket Claimed"
                            )
                            .setDescription(
                                `${channel} was claimed by ${interaction.user}.`
                            )
                            .setTimestamp()
                    );

                    return;
                }

                if (command === "add") {
                    const user =
                        interaction.options
                            .getUser("user");

                    await interaction.channel
                        .permissionOverwrites
                        .edit(user.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            AttachFiles: true,
                            EmbedLinks: true
                        });

                    await interaction.reply({
                        content:
                            `✅ Added ${user} to this ticket.`
                    });

                    return;
                }

                if (command === "remove") {
                    const user =
                        interaction.options
                            .getUser("user");

                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    if (
                        user.id === ownerId
                    ) {
                        return interaction.reply({
                            content:
                                "You can't remove the ticket owner.",
                            ephemeral: true
                        });
                    }

                    await interaction.channel
                        .permissionOverwrites
                        .delete(user.id)
                        .catch(() => {});

                    await interaction.reply({
                        content:
                            `✅ Removed ${user} from this ticket.`
                    });

                    return;
                }

                if (command === "rename") {
                    const name =
                        interaction.options
                            .getString("name");

                    const safe =
                        safeChannelName(name);

                    await interaction.channel
                        .setName(safe);

                    await interaction.reply({
                        content:
                            `✅ Ticket renamed to **${safe}**.`
                    });

                    return;
                }

                if (command === "close") {
                    const confirm =
                        new ButtonBuilder()
                            .setCustomId(
                                `confirm_close:${interaction.channel.id}`
                            )
                            .setLabel(
                                "Confirm Close"
                            )
                            .setStyle(
                                ButtonStyle.Danger
                            );

                    const cancel =
                        new ButtonBuilder()
                            .setCustomId(
                                `cancel_close:${interaction.channel.id}`
                            )
                            .setLabel("Cancel")
                            .setStyle(
                                ButtonStyle.Secondary
                            );

                    await interaction.reply({
                        content:
                            "Are you sure you want to close this ticket?",
                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    confirm,
                                    cancel
                                )
                        ],
                        ephemeral: true
                    });

                    return;
                }
            }

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                "ticket_menu"
            ) {
                const selected =
                    interaction.values[0];

                if (selected === "purchase") {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "purchase_modal"
                            )
                            .setTitle(
                                "Purchase"
                            );

                    const product =
                        new TextInputBuilder()
                            .setCustomId("product")
                            .setLabel("Product")
                            .setPlaceholder(
                                "Headless | Korblox | Headless + Korblox"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true);

                    const payment =
                        new TextInputBuilder()
                            .setCustomId("payment")
                            .setLabel(
                                "Payment Method"
                            )
                            .setPlaceholder(
                                "PayPal | Cash App | Crypto | Venmo | Zelle"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(product),
                        new ActionRowBuilder()
                            .addComponents(payment)
                    );

                    await interaction.showModal(
                        modal
                    );
                    return;
                }

                if (selected === "support") {
                    await interaction.deferReply({
                        ephemeral: true
                    });

                    await createTicket(
                        interaction,
                        "support"
                    );
                    return;
                }

                if (selected === "configs") {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "configs_modal"
                            )
                            .setTitle(
                                "Purchase Config"
                            );

                    const configType =
                        new TextInputBuilder()
                            .setCustomId(
                                "config_type"
                            )
                            .setLabel(
                                "What config do you want?"
                            )
                            .setPlaceholder(
                                "Enter the config you want"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true);

                    const details =
                        new TextInputBuilder()
                            .setCustomId(
                                "config_details"
                            )
                            .setLabel(
                                "Additional Details"
                            )
                            .setPlaceholder(
                                "Tell us what you're looking for..."
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                configType
                            ),
                        new ActionRowBuilder()
                            .addComponents(
                                details
                            )
                    );

                    await interaction.showModal(
                        modal
                    );
                    return;
                }

                if (selected === "edit") {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "edit_modal"
                            )
                            .setTitle(
                                "Buy Edit / Edit Pack"
                            );

                    const editType =
                        new TextInputBuilder()
                            .setCustomId(
                                "edit_type"
                            )
                            .setLabel(
                                "What do you want?"
                            )
                            .setPlaceholder(
                                "Edit | Edit Pack | Montage"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true);

                    const details =
                        new TextInputBuilder()
                            .setCustomId(
                                "edit_details"
                            )
                            .setLabel(
                                "Edit Details"
                            )
                            .setPlaceholder(
                                "Style, song, clips, effects, etc."
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                editType
                            ),
                        new ActionRowBuilder()
                            .addComponents(
                                details
                            )
                    );

                    await interaction.showModal(
                        modal
                    );
                    return;
                }

                if (selected === "appeal") {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "appeal_modal"
                            )
                            .setTitle(
                                "Blacklist Appeal"
                            );

                    const reason =
                        new TextInputBuilder()
                            .setCustomId(
                                "appeal_reason"
                            )
                            .setLabel(
                                "Why should your blacklist be removed?"
                            )
                            .setPlaceholder(
                                "Explain your appeal..."
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(reason)
                    );

                    await interaction.showModal(
                        modal
                    );
                    return;
                }
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "purchase_modal"
            ) {
                await interaction.deferReply({
                    ephemeral: true
                });

                await createTicket(
                    interaction,
                    "purchase",
                    {
                        product:
                            interaction.fields
                                .getTextInputValue(
                                    "product"
                                ),
                        payment:
                            interaction.fields
                                .getTextInputValue(
                                    "payment"
                                )
                    }
                );

                return;
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "configs_modal"
            ) {
                await interaction.deferReply({
                    ephemeral: true
                });

                await createTicket(
                    interaction,
                    "configs",
                    {
                        configType:
                            interaction.fields
                                .getTextInputValue(
                                    "config_type"
                                ),
                        details:
                            interaction.fields
                                .getTextInputValue(
                                    "config_details"
                                )
                    }
                );

                return;
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "edit_modal"
            ) {
                await interaction.deferReply({
                    ephemeral: true
                });

                await createTicket(
                    interaction,
                    "edit",
                    {
                        editType:
                            interaction.fields
                                .getTextInputValue(
                                    "edit_type"
                                ),
                        details:
                            interaction.fields
                                .getTextInputValue(
                                    "edit_details"
                                )
                    }
                );

                return;
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "appeal_modal"
            ) {
                await interaction.deferReply({
                    ephemeral: true
                });

                await createTicket(
                    interaction,
                    "appeal",
                    {
                        reason:
                            interaction.fields
                                .getTextInputValue(
                                    "appeal_reason"
                                )
                    }
                );

                return;
            }

            if (interaction.isButton()) {
                if (
                    interaction.customId ===
                    "claim_ticket"
                ) {
                    const channel =
                        interaction.channel;

                    const type =
                        getTicketType(channel);

                    if (
                        !isOwner(interaction.user.id) &&
                        !isSupportMember(
                            interaction.member,
                            type
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "Only staff can claim tickets.",
                            ephemeral: true
                        });
                    }

                    const existing =
                        botData.claims[channel.id];

                    if (existing) {
                        return interaction.reply({
                            content:
                                `This ticket is already claimed by <@${existing}>.`,
                            ephemeral: true
                        });
                    }

                    botData.claims[channel.id] =
                        interaction.user.id;

                    saveJson(
                        DATA_FILE,
                        botData
                    );

                    await interaction.reply({
                        content:
                            `✅ Ticket claimed by ${interaction.user}.`
                    });

                    await sendTicketLog(
                        interaction.guild,
                        new EmbedBuilder()
                            .setTitle(
                                "Ticket Claimed"
                            )
                            .setDescription(
                                `${channel} was claimed by ${interaction.user}.`
                            )
                            .setTimestamp()
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "close_ticket"
                ) {
                    const channel =
                        interaction.channel;

                    if (!isTicketChannel(channel)) {
                        return interaction.reply({
                            content:
                                "This isn't a ticket channel.",
                            ephemeral: true
                        });
                    }

                    const ownerId =
                        getTicketOwner(channel);

                    const type =
                        getTicketType(channel);

                    const canClose =
                        interaction.user.id ===
                            ownerId ||
                        isOwner(
                            interaction.user.id
                        ) ||
                        isSupportMember(
                            interaction.member,
                            type
                        );

                    if (!canClose) {
                        return interaction.reply({
                            content:
                                "You don't have permission to close this ticket.",
                            ephemeral: true
                        });
                    }

                    const confirm =
                        new ButtonBuilder()
                            .setCustomId(
                                `confirm_close:${channel.id}`
                            )
                            .setLabel(
                                "Confirm Close"
                            )
                            .setStyle(
                                ButtonStyle.Danger
                            );

                    const cancel =
                        new ButtonBuilder()
                            .setCustomId(
                                `cancel_close:${channel.id}`
                            )
                            .setLabel(
                                "Cancel"
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            );

                    await interaction.reply({
                        content:
                            "Are you sure you want to close this ticket?",
                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    confirm,
                                    cancel
                                )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId
                        .startsWith(
                            "confirm_close:"
                        )
                ) {
                    const channelId =
                        interaction.customId
                            .split(":")[1];

                    if (
                        interaction.channel.id !==
                        channelId
                    ) {
                        return interaction.reply({
                            content:
                                "This confirmation is no longer valid.",
                            ephemeral: true
                        });
                    }

                    await interaction.update({
                        content:
                            "Closing ticket...",
                        components: []
                    });

                    await closeTicketChannel(
                        interaction.channel,
                        interaction.user,
                        "Ticket manually closed"
                    );

                    return;
                }

                if (
                    interaction.customId
                        .startsWith(
                            "cancel_close:"
                        )
                ) {
                    await interaction.update({
                        content:
                            "Ticket close cancelled.",
                        components: []
                    });

                    return;
                }
            }
        } catch (error) {
            await logError(
                interaction.guild,
                "Interaction error",
                error
            );

            try {
                if (
                    interaction.deferred ||
                    interaction.replied
                ) {
                    await interaction.editReply({
                        content:
                            "❌ Something went wrong. Check the bot logs."
                    });
                } else {
                    await interaction.reply({
                        content:
                            "❌ Something went wrong. Check the bot logs.",
                        ephemeral: true
                    });
                }
            } catch {}
        }
    }
);

client.login(process.env.TOKEN);
