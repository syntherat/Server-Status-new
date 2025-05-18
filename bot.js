import Discord from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import express from 'express'; // Added for health check endpoint
dotenv.config();

// Create Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// Basic health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    bot: client?.user?.tag || 'not logged in',
    serverMonitoring: checkInterval ? 'active' : 'inactive',
    lastCheck: new Date().toISOString()
  });
});

// Configuration
const CHECK_INTERVAL = 10000; // 10 seconds
const SERVER_TIMEOUT = 5000; // 5 seconds timeout
const OFFLINE_THRESHOLD = 2; // Failed checks before declaring offline

// Server state tracking
let consecutiveFails = 0;
let lastStatusMessageId = null;
let maintenanceMode = false;
let isServerOnline = null;
let checkInterval = null;

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent
  ]
});

// Start the health check server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Health check server running on port ${PORT}`);
});

// Enhanced server check with timeout
async function checkServerStatus() {
  if (maintenanceMode) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_TIMEOUT);

    const response = await fetch(`http://${process.env.SERVER_IP}:${process.env.SERVER_PORT}/info.json`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      consecutiveFails = 0;
      if (isServerOnline === false) {
        await sendStatusUpdate('✅ **SERVER BACK ONLINE**\nThe server has recovered and is now accessible!');
      }
      isServerOnline = true;
    } else {
      await handlePotentialDowntime();
    }
  } catch (error) {
    await handlePotentialDowntime();
  }
}

async function handlePotentialDowntime() {
  consecutiveFails++;
  
  if (consecutiveFails >= OFFLINE_THRESHOLD && isServerOnline !== false) {
    await sendStatusUpdate('⚠️ **SERVER OFFLINE**\nThe server is not responding. This may be an automatic restart or unexpected downtime.');
    isServerOnline = false;
  }
}

client.on('ready', () => {
  console.log(`[${new Date().toISOString()}] Bot ready and logged in as ${client.user.tag}`);
  startServerMonitoring();
});

function startServerMonitoring() {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkServerStatus, CHECK_INTERVAL);
  console.log(`[${new Date().toISOString()}] Starting monitoring with ${CHECK_INTERVAL/1000}s intervals`);
  checkServerStatus(); // Initial check
}

client.on('messageCreate', async message => {
    if (!message.content.startsWith(process.env.COMMAND_PREFIX || '!') || message.author.bot) return;

    const args = message.content.slice((process.env.COMMAND_PREFIX || '!').length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Maintenance commands
    if (command === 'maintenance') {
        if (!message.member?.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
            return message.reply('You do not have permission to use this command.');
        }

        const action = args[0]?.toLowerCase();
        
        if (action === 'on') {
            maintenanceMode = true;
            await sendStatusUpdate('🛠️ **SERVER MAINTENANCE**\nThe server is now undergoing maintenance.');
            await message.reply('Maintenance mode activated.');
        } 
        else if (action === 'off') {
            maintenanceMode = false;
            await sendStatusUpdate('✅ **MAINTENANCE COMPLETE**\nThe server is back online!');
            await message.reply('Maintenance mode deactivated.');
        } 
        else {
            await message.reply('Usage: `!maintenance on|off`');
        }
    }
    
    // Restart command
    else if (command === 'restart') {
        if (!message.member?.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
            return message.reply('You do not have permission to use this command.');
        }

        const time = args[0] || 'a short while';
        await sendStatusUpdate(`🔄 **SERVER RESTART**\nThe server will restart in ${time}.`);
        await message.reply('Restart announced.');
    }
    
    // Status command
    else if (command === 'status') {
        const status = args.join(' ') || 'Server status update';
        await sendStatusUpdate(`ℹ️ **SERVER STATUS**\n${status}`);
        await message.reply('Status updated.');
    }
});

async function sendStatusUpdate(messageContent) {
  const channel = client.channels.cache.get(process.env.STATUS_CHANNEL_ID);
  if (!channel) return console.error('Status channel not found!');

  try {
    if (lastStatusMessageId) {
      try {
        const oldMessage = await channel.messages.fetch(lastStatusMessageId);
        await oldMessage.delete();
      } catch (error) {
        console.log('Could not delete previous message:', error.message);
      }
    }

    const sentMessage = await channel.send({
      content: messageContent,
      allowedMentions: { parse: [] }
    });
    lastStatusMessageId = sentMessage.id;
    console.log(`[${new Date().toISOString()}] Status update sent: ${messageContent}`);
  } catch (error) {
    console.error('Failed to send status update:', error);
  }
}

client.login(process.env.DISCORD_BOT_TOKEN).catch(console.error);