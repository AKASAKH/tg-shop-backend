const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// =====================
// 1. Basic Commands
// =====================
bot.start((ctx) => {
  const name = ctx.message.from.first_name || 'User';
  ctx.reply(
    `👋 Welcome, ${name}! to TG Shop Bot.\n\nUse /help to see what I can do!`,
    Markup.keyboard(['/shop', '/cart', '/help', '/contact']).resize()
  );
});

bot.help((ctx) => {
  ctx.reply(
    `📌 *Available Commands:*\n\n` +
    `/shop - View our products\n` +
    `/cart - View your cart\n` +
    `/contact - Contact support\n` +
    `/help - Show this help menu`,
    { parse_mode: 'Markdown' }
  );
});

// =====================
// 2. Shop Features
// =====================
bot.command('shop', (ctx) => {
  ctx.reply(
    `🛍️ *Welcome to our Shop!*\n\n` +
    `1. Premium Headphones - $50\n` +
    `2. Smart Watch - $120\n` +
    `3. Wireless Mouse - $25\n\n` +
    `Reply with /cart to see your items!`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('cart', (ctx) => {
  ctx.reply(
    `🛒 *Your Cart is currently empty.*\n\nGo to /shop to add items!`,
    { parse_mode: 'Markdown' }
  );
});

// =====================
// 3. Contact & Support (Inline Buttons)
// =====================
bot.command('contact', (ctx) => {
  ctx.reply(
    `Need help? Click the button below to contact our support team!`,
    Markup.inlineKeyboard([
      Markup.button.url('💬 Contact Support', 'https://t.me/your_support_username'),
      Markup.button.url('🌐 Visit Website', 'https://example.com')
    ])
  );
});

// =====================
// 4. Catch Unknown Commands
// =====================
bot.on('text', (ctx) => {
  ctx.reply(`I didn't understand that. Type /help to see available commands.`);
});

// =====================
// 5. Error Handling
// =====================
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// Start the Bot
bot.launch();
console.log('✅ Bot is running...');

// =====================
// 6. Express Server for Render
// =====================
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ TG Shop Backend is running!');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bot: 'running',
    uptime: process.uptime()
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${port}`);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));