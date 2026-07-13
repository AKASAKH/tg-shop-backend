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

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  cart: [{ type: String }]
});
const User = mongoose.model('User', userSchema);

// Product Schema (NEW!)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String
});
const Product = mongoose.model('Product', productSchema);

// =====================
// 2. BOT SETUP
// =====================
const bot = new Telegraf(process.env.BOT_TOKEN);

// Admin ID Check
const ADMIN_ID = process.env.ADMIN_ID || '1053617731'; // Your Telegram ID

const isAdmin = (ctx) => {
  return ctx.message.from.id.toString() === ADMIN_ID;
};

// --- PUBLIC COMMANDS ---

bot.start(async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const username = ctx.message.from.username || 'No username';

    await User.findOneAndUpdate(
      { telegramId: userId },
      { telegramId: userId, username: username },
      { upsert: true, returnDocument: 'after' }
    );

    ctx.reply(
      `👋 Welcome, ${username}! to TG Shop Bot.\nUse /shop to browse our products!`,
      Markup.keyboard(['/shop', '/cart', '/help']).resize()
    );
  } catch (error) {
    console.error('Start command error:', error);
    ctx.reply('❌ Error starting bot. Please try again.');
  }
});

bot.command('shop', async (ctx) => {
  try {
    const products = await Product.find();
    if (products.length === 0) {
      return ctx.reply('🛍️ Our shop is currently empty. Check back soon!');
    }

    let message = '🛍️ *Our Products:*\n\n';
    products.forEach((p, index) => {
      message += `${index + 1}. *${p.name}* - $${p.price}\n   _${p.description || 'No description'}_\n`;
    });
    message += '\n💡 Use `/buy [Product Name]` to add to cart!';

    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Shop command error:', error);
    ctx.reply('❌ Error loading products.');
  }
});

bot.command('buy', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const text = ctx.message.text.trim();
    const productName = text.substring(5).trim(); // Get text after /buy

    if (!productName) {
      return ctx.reply('❌ Please specify a product.\n\nExample: `/buy Headphones`', { parse_mode: 'Markdown' });
    }

    // Check if product exists
    const product = await Product.findOne({ name: { $regex: new RegExp(productName, 'i') } });
    if (!product) {
      return ctx.reply(`❌ Product "${productName}" not found. Use /shop to see available items.`);
    }

    // Add to user's cart
    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({ telegramId: userId, username: ctx.message.from.username || 'unknown', cart: [product.name] });
    } else {
      user.cart.push(product.name);
    }
    await user.save();

    ctx.reply(`✅ Added "${product.name}" ($${product.price}) to your cart!\n\nTotal items: ${user.cart.length}`);
  } catch (error) {
    console.error('Buy command error:', error);
    ctx.reply('❌ Error adding item to cart.');
  }
});

bot.command('cart', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || !user.cart || user.cart.length === 0) {
      return ctx.reply('🛒 Your cart is empty.\n\nUse `/shop` to browse and `/buy [item]` to add!', { parse_mode: 'Markdown' });
    }

    const cartItems = user.cart.map((item, index) => `${index + 1}. ${item}`).join('\n');
    ctx.reply(`🛒 *Your Cart (${user.cart.length} items):*\n\n${cartItems}`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Cart command error:', error);
    ctx.reply('❌ Error viewing cart.');
  }
});

bot.help((ctx) => {
  ctx.reply(
    `📌 *Commands:*\n` +
    `/start - Start bot\n` +
    `/shop - View all products\n` +
    `/buy [name] - Add product to cart\n` +
    `/cart - View your cart\n` +
    `/help - Show this menu`,
    { parse_mode: 'Markdown' }
  );
});

// --- ADMIN COMMANDS (SECURED) ---

bot.command('admin_users', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Access Denied: Admins only.');
  
  try {
    const count = await User.countDocuments();
    const users = await User.find().select('telegramId username cart');
    
    let msg = `👥 *Total Users: ${count}*\n\n`;
    users.forEach(u => {
      msg += `• @${u.username || 'NoUsername'} (ID: ${u.telegramId}) - Cart: ${u.cart.length} items\n`;
    });
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Error fetching users.');
  }
});

bot.command('admin_add', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Access Denied: Admins only.');

  try {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      return ctx.reply('❌ Usage: `/admin_add <ProductName> <Price>`\nExample: `/admin_add Headphones 50`', { parse_mode: 'Markdown' });
    }

    const name = args[1];
    const price = parseFloat(args[2]);

    if (isNaN(price)) {
      return ctx.reply('❌ Price must be a valid number.');
    }

    const newProduct = new Product({ name, price, description: 'Awesome product!' });
    await newProduct.save();

    ctx.reply(`✅ Product "${name}" added to shop for $${price}!`);
  } catch (error) {
    console.error('Admin add error:', error);
    ctx.reply('❌ Error adding product.');
  }
});

bot.command('admin_products', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Access Denied: Admins only.');

  try {
    const products = await Product.find();
    if (products.length === 0) return ctx.reply('📦 No products in database.');

    let msg = '📦 *Database Products:*\n\n';
    products.forEach((p, i) => {
      msg += `${i + 1}. ${p.name} - $${p.price}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Error fetching products.');
  }
});

// Error handler
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
});

// Launch bot with dropPendingUpdates to prevent 409 conflicts
bot.launch({ dropPendingUpdates: true });
console.log('✅ Bot is running...');

// =====================
// 3. EXPRESS SERVER
// =====================
app.use(express.json());

app.get('/', (req, res) => res.send('✅ TG Shop Backend is running!'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  bot: 'running',
  db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  uptime: process.uptime()
}));

app.listen(port, '0.0.0.0', () => console.log(`🚀 Server running on port ${port}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));