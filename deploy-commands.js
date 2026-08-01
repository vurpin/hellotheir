const {
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

require("dotenv").config();

const commands = [
    new SlashCommandBuilder()
        .setName("preview")
        .setDescription("Upload an image or video through the bot")
        .addAttachmentOption(option =>
            option.setName("file").setDescription("Upload your image/video").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message").setDescription("Optional message").setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("message")
        .setDescription("Send a message through the bot")
        .addStringOption(option =>
            option.setName("text").setDescription("Message to send").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("embed")
        .setDescription("Send a custom embed through the bot")
        .addStringOption(option =>
            option.setName("title").setDescription("Embed title").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("description").setDescription("Main embed text").setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName("image").setDescription("Optional large image").setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName("thumbnail").setDescription("Optional thumbnail").setRequired(false)
        )
        .addStringOption(option =>
            option.setName("color").setDescription("Optional hex color, example #5865F2").setRequired(false)
        )
        .addStringOption(option =>
            option.setName("footer").setDescription("Optional footer text").setRequired(false)
        )
        .addStringOption(option =>
            option.setName("url").setDescription("Optional clickable title URL").setRequired(false)
        )
        .addStringOption(option =>
            option.setName("button_label").setDescription("Optional link button label").setRequired(false)
        )
        .addStringOption(option =>
            option.setName("button_url").setDescription("Optional link button URL").setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("ticketpanel")
        .setDescription("Send the Vurpin ticket panel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("queue")
        .setDescription("Set a user's queue position")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to put in queue")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("position")
                .setDescription("Starting queue position")
                .setMinValue(1)
                .setMaxValue(1000)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("removequeue")
        .setDescription("Remove a user from the queue")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to remove from queue")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("check")
        .setDescription("Check a user's queue position")
        .addUserOption(option =>
            option.setName("user").setDescription("User to check").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("claim")
        .setDescription("Claim the current ticket")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("add")
        .setDescription("Add a user to the current ticket")
        .addUserOption(option =>
            option.setName("user").setDescription("User to add").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a user from the current ticket")
        .addUserOption(option =>
            option.setName("user").setDescription("User to remove").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("rename")
        .setDescription("Rename the current ticket")
        .addStringOption(option =>
            option.setName("name").setDescription("New ticket channel name").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("close")
        .setDescription("Close the current ticket")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map(command => command.toJSON());

const rest = new REST({
    version: "10"
}).setToken(process.env.TOKEN);

async function start() {
    try {
        console.log("Registering global commands...");

        await rest.put(
            Routes.applicationCommands(
                process.env.CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log("Global commands registered!");
    } catch (error) {
        console.error(
            "Command registration error:",
            error
        );
    }
}

start();
