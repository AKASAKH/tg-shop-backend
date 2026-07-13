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

// User Schema (Enhanced with Registration)
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  phone: String,
  address: String,
  cart: [{ type: String }],
  registeredAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Product Schema (Enhanced with Images)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  imageUrl: String // URL to the product image
});
const Product = mongoose.model('Product', productSchema);

// Order Schema (NEW! For Checkout)
const orderSchema = new mongoose.Schema({
  telegramId: String,
  username: String,
  items: [String],
  totalAmount: Number,
  status: { type: String, default: 'Pending' }, // Pending, Paid, Shipped
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// =====================
// 2. BOT SETUP
// =====================
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID || '1053617731';

const isAdmin = (ctx) => ctx.message.from.id.toString() === ADMIN_ID;

// --- PUBLIC COMMANDS ---

bot.start(async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const username = ctx.message.from.username || 'No username';
    const firstName = ctx.message.from.first_name || 'User';

    await User.findOneAndUpdate(
      { telegramId: userId },
      { telegramId: userId, username, firstName },
      { upsert: true, returnDocument: 'after' }
    );

    ctx.reply(
      `👋 Welcome, ${firstName}! to TG Shop Bot.\n\nUse /register to set up your profile, or /shop to browse!`,
      Markup.keyboard(['/shop', '/cart', '/register', '/help']).resize()
    );
  } catch (error) {
    console.error('Start command error:', error);
  }
});

// User Registration
bot.command('register', async (ctx) => {
  const userId = ctx.message.from.id.toString();
  ctx.reply(
    `📝 *Let's set up your profile!*\n\n` +
    `Please reply to this message with your *Phone Number* and *Shipping Address* in this format:\n` +
    `\`Phone: +1234567890\nAddress: 123 Main St, City\``,
    { parse_mode: 'Markdown' }
  );
});

bot.on('text', async (ctx) => {
  // Simple parser for registration
  if (ctx.message.text.includes('Phone:') && ctx.message.text.includes('Address:')) {
    const userId = ctx.message.from.id.toString();
    const lines = ctx.message.text.split('\n');
    const phone = lines.find(l => l.startsWith('Phone:'))?.replace('Phone:', '').trim();
    const address = lines.find(l => l.startsWith('Address:'))?.replace('Address:', '').trim();

    await User.findOneAndUpdate(
      { telegramId: userId },
      { phone, address }
    );
    ctx.reply('✅ Profile updated successfully! You are now registered.', Markup.removeKeyboard());
  }
});

// Shop with Images
bot.command('shop', async (ctx) => {
  try {
    const products = await Product.find();
    if (products.length === 0) return ctx.reply('🛍️ Our shop is currently empty.');

    for (const p of products) {
      const caption = `*${p.name}* - $${p.price}\n_${p.description || 'No description'}_\n\nUse /buy ${p.name} to add to cart!`;
      
      if (p.imageUrl) {
        await ctx.replyWithPhoto({ url: p.imageUrl }, { caption, parse_mode: 'Markdown' });
      } else {
        await ctx.reply(caption, { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    console.error('Shop command error:', error);
  }
});

// Buy Command
bot.command('buy', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const productName = ctx.message.text.substring(5).trim();

    if (!productName) return ctx.reply('❌ Example: `/buy Headphones`', { parse_mode: 'Markdown' });

    const product = await Product.findOne({ name: { $regex: new RegExp(productName, 'i') } });
    if (!product) return ctx.reply(`❌ Product "${productName}" not found.`);

    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({ telegramId: userId, username: ctx.message.from.username || 'unknown', cart: [product.name] });
    } else {
      user.cart.push(product.name);
    }
    await user.save();

    ctx.reply(`✅ Added "${product.name}" ($${product.price}) to your cart!`);
  } catch (error) {
    console.error('Buy command error:', error);
  }
});

// Cart Command
bot.command('cart', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || user.cart.length === 0) {
      return ctx.reply('🛒 Your cart is empty.\n\nUse `/shop` to browse!', { parse_mode: 'Markdown' });
    }

    // Calculate total (basic simulation)
    let total = 0;
    const itemsList = user.cart.map(item => {
      total += 50; // Simplified: assuming $50 per item for this demo. In a real app, you'd query the product price.
      return `• ${item}`;
    }).join('\n');

    ctx.reply(
      `🛒 *Your Cart (${user.cart.length} items):*\n\n${itemsList}\n\n*Estimated Total: $${total}*\n\nUse /checkout to complete your order!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Cart command error:', error);
  }
});

// Checkout Command
bot.command('checkout', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || user.cart.length === 0) {
      return ctx.reply('🛒 Your cart is empty!');
    }

    if (!user.phone || !user.address) {
      return ctx.reply('⚠️ Please complete your registration first!\nUse /register to add your phone and address.');
    }

    // Create Order in Database
    const newOrder = new Order({
      telegramId: userId,
      username: user.username,
      items: [...user.cart],
      totalAmount: user.cart.length * 50, // Simplified total
      status: 'Paid' // Simulating successful payment
    });
    await newOrder.save();

    // Clear the user's cart
    user.cart = [];
    await user.save();

    ctx.reply(
      `🎉 *Order Placed Successfully!*\n\n` +
      `Order ID: \`${newOrder._id}\`\n` +
      `Items: ${newOrder.items.join(', ')}\n` +
      `Total: $${newOrder.totalAmount}\n` +
      `Shipping to: ${user.address}\n\n` +
      `Thank you for your purchase! 🚀`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Checkout command error:', error);
    ctx.reply('❌ Error processing checkout.');
  }
});

bot.help((ctx) => {
  ctx.reply(
    `📌 *Commands:*\n` +
    `/start - Start bot\n` +
    `/register - Set up phone & address\n` +
    `/shop - View all products\n` +
    `/buy [name] - Add to cart\n` +
    `/cart - View cart\n` +
    `/checkout - Complete purchase\n` +
    `/help - Show this menu`,
    { parse_mode: 'Markdown' }
  );
});

// --- ADMIN COMMANDS ---

bot.command('admin_add', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Access Denied: Admins only.');

  try {
    // Format: /admin_add Name Price Description ImageURL
    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
      return ctx.reply('❌ Usage: `/admin_add <Name> <Price> <Description> <ImageURL>`\nExample: `/admin_add Headphones 50 "Great sound" https://example.com/img.jpg`', { parse_mode: 'Markdown' });
    }

    const name = args[1];
    const price = parseFloat(args[2]);
    const description = args[3];
    const imageUrl = args[4] || ''; // Optional

    if (isNaN(price)) return ctx.reply('❌ Price must be a valid number.');

    const newProduct = new Product({ name, price, description, imageUrl });
    await newProduct.save();

    ctx.reply(`✅ Product "${name}" added to shop!`);
  } catch (error) {
    console.error('Admin add error:', error);
    ctx.reply('❌ Error adding product.');
  }
});

bot.command('admin_orders', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Access Denied: Admins only.');
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(5);
    if (orders.length === 0) return ctx.reply('📦 No orders yet.');

    let msg = '📦 *Recent Orders:*\n\n';
    orders.forEach((o, i) => {
      msg += `${i + 1}. ${o.username} | $${o.totalAmount} | ${o.status}\n   Items: ${o.items.join(', ')}\n`;
    });
    ctx.reply(msg, { parse_mode: ' aMarkdown' });
  } catch (error) {
    ctx.reply('❌ Error fetching orders.');
  }
});

bot.catch((err, ctx) => console.error(`Bot error:`, err));

bot.launch({ dropPendingUpdates: true });
console.log('✅ Bot is running...');

// =====================
// 3. EXPRESS SERVER
// =====================
app.use(express.json());
app.get('/', (req, res) => res.send('✅ TG Shop Backend is running!'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', bot: 'running',
  db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  uptime: process.uptime()
}));
app.listen(port, '0.0.0.0', () => console.log(`🚀 Server running on port ${port}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));