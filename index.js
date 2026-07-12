const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Your Telegram Bot Code
// =====================
const { Telegraf } = require('telegraf');

// Replace with your actual bot token
const bot = new Telegraf(process.env.BOT_TOKEN);

// Your bot handlers
bot.start((ctx) => ctx.reply('Welcome! Bot is running.'));
bot.help((ctx) => ctx.reply('Help command'));

// Start the bot
bot.launch();
console.log('Bot is running...');

// =====================
// HTTP Server for Render
// =====================

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.send('✅ Telegram Bot is running!');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bot: 'running',
    uptime: process.uptime()
  });
});

// Webhook endpoint (if using webhooks)
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));