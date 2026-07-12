const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// =====================
// 1. DATABASE SETUP
// =====================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  cart: [{ type: String }]
});

const User = mongoose.model('User', userSchema);

// =====================
// 2. BOT SETUP
// =====================
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const username = ctx.message.from.username || 'No username';

    await User.findOneAndUpdate(
      { telegramId: userId },
      { telegramId: userId, username: username },
      { upsert: true, new: true }
    );

    ctx.reply(
      `👋 Welcome! You have been saved to our database.\nUse /shop to browse!`,
      Markup.keyboard(['/shop', '/cart', '/help']).resize()
    );
  } catch (error) {
    console.error('Start command error:', error);
    ctx.reply('❌ Error starting bot. Please try again.');
  }
});

bot.command('shop', (ctx) => {
  ctx.reply(
    `🛍️ *Our Products:*\n\n` +
    `1. Premium Headphones - $50\n` +
    `2. Smart Watch - $120\n\n` +
    `Type /add Headphones to add to cart!`,
    { parse_mode: 'Markdown' }
  );
});

// =====================
// IMPROVED /add COMMAND
// =====================
bot.command('add', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    
    // Get the text after /add
    const text = ctx.message.text.trim();
    const item = text.substring(5).trim(); // Remove '/add ' from the text
    
    console.log(`User ${userId} trying to add: "${item}"`);
    
    if (!item || item.length === 0) {
      return ctx.reply('❌ Please specify an item.\n\nExample: `/add Headphones`', { parse_mode: 'Markdown' });
    }

    // Find or create user, then add to cart
    let user = await User.findOne({ telegramId: userId });
    
    if (!user) {
      // Create new user if doesn't exist
      user = new User({
        telegramId: userId,
        username: ctx.message.from.username || 'unknown',
        cart: [item]
      });
      await user.save();
    } else {
      // Add item to existing cart
      user.cart.push(item);
      await user.save();
    }

    ctx.reply(`✅ Added "${item}" to your cart!\n\nTotal items: ${user.cart.length}`);
    
  } catch (error) {
    console.error('Add command error:', error);
    ctx.reply('❌ Error adding item. Please try again.');
  }
});

// =====================
// /cart COMMAND
// =====================
bot.command('cart', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || !user.cart || user.cart.length === 0) {
      return ctx.reply('🛒 Your cart is empty.\n\nUse `/add [item]` to add something!', { parse_mode: 'Markdown' });
    }

    const cartItems = user.cart.map((item, index) => `${index + 1}. ${item}`).join('\n');
    
    ctx.reply(`🛒 *Your Cart (${user.cart.length} items):*\n\n${cartItems}`, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Cart command error:', error);
    ctx.reply('❌ Error viewing cart. Please try again.');
  }
});

bot.help((ctx) => {
  ctx.reply(
    `📌 *Commands:*\n` +
    `/start - Start bot & save to DB\n` +
    `/shop - View products\n` +
    `/add [item] - Add to cart (Saves to DB)\n` +
    `/cart - View your saved cart`,
    { parse_mode: 'Markdown' }
  );
});

bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
});

bot.launch();
console.log('✅ Bot is running...');

// =====================
// 3. EXPRESS SERVER
// =====================
app.use(express.json());

app.get('/', (req, res) => res.send('✅ TG Shop Backend is running!'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  bot: 'running',
  uptime: process.uptime()
}));

app.listen(port, '0.0.0.0', () => console.log(` Server running on port ${port}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));