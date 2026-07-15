const express = require('express');
const cors = require('cors'); // Added for Mini App connection
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Stripe (Only if key is provided)
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}

// =====================
// 1. DATABASE SETUP
// =====================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  phone: String,
  address: String,
  cart: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  registeredAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  imageUrl: String
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  telegramId: String,
  username: String,
  items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  itemNames: [String],
  totalAmount: Number,
  status: { type: String, default: 'Pending' },
  stripeSessionId: String,
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
    await User.findOneAndUpdate(
      { telegramId: userId },
      { telegramId: userId, username: ctx.message.from.username, firstName: ctx.message.from.first_name },
      { upsert: true, returnDocument: 'after' }
    );
    
    // Added Web App Button to the start message
    ctx.reply(`👋 Welcome, ${ctx.message.from.first_name}! Use /shop to browse our products!`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍️ Open Visual Shop', web_app: { url: 'https://akasakh.github.io/tg-shop-miniapp/' } }
        ]],
        keyboard: [['/shop', '/cart', '/myorders', '/help']],
        resize_keyboard: true
      }
    });
  } catch (error) { console.error(error); }
});

// Handle Mini App Checkout Data (Saves to MongoDB)
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    
    if (data.action === 'checkout') {
      // 1. Save Order to Database
      const newOrder = new Order({
        telegramId: data.user.id.toString(),
        username: data.user.username,
        items: data.items.map(i => i.id), 
        itemNames: data.items.map(i => i.name),
        totalAmount: data.total,
        status: 'Paid (Mini App)',
        createdAt: new Date()
      });
      await newOrder.save();

      // 2. Notify User
      await ctx.reply(`✅ Order received via Mini App!\nTotal: $${data.total}\nWe will contact you shortly.`);

      // 3. Notify Admin
      await bot.telegram.sendMessage(ADMIN_ID, `🚨 NEW MINI APP ORDER\nUser: @${data.user.username || data.user.id}\nTotal: $${data.total}`);
    }
  } catch (error) {
    console.error('Web app data error:', error);
  }
});

// A. INLINE BUTTON SHOP
bot.command('shop', async (ctx) => {
  try {
    const products = await Product.find();
    if (products.length === 0) return ctx.reply('️ Our shop is currently empty.');

    for (const p of products) {
      const caption = `*${p.name}* - $${p.price}\n_${p.description || 'No description'}_`;
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('🛒 Add to Cart', `buy_${p._id}`)
      ]);

      if (p.imageUrl) {
        await ctx.replyWithPhoto({ url: p.imageUrl }, { caption, parse_mode: 'Markdown', ...keyboard });
      } else {
        await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
      }
    }
  } catch (error) { console.error('Shop error:', error); }
});

bot.action(/^buy_(.+)$/, async (ctx) => {
  try {
    const productId = ctx.match[1];
    const userId = ctx.message.from.id.toString();
    const product = await Product.findById(productId);
    
    if (!product) return ctx.answerCbQuery('❌ Product not found!');

    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({ telegramId: userId, username: ctx.message.from.username, cart: [productId] });
    } else {
      user.cart.push(productId);
    }
    await user.save();

    ctx.answerCbQuery(`✅ Added ${product.name} to cart!`);
    ctx.reply(`🛒 Added *${product.name}* ($${product.price}) to your cart!`, { parse_mode: 'Markdown' });
  } catch (error) { console.error('Action error:', error); }
});

bot.command('cart', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId }).populate('cart');

    if (!user || user.cart.length === 0) return ctx.reply('🛒 Your cart is empty.\n\nUse /shop to browse!', { parse_mode: 'Markdown' });

    let total = 0;
    const itemsList = user.cart.map(item => {
      total += item.price;
      return `• ${item.name} - $${item.price}`;
    }).join('\n');

    ctx.reply(`🛒 *Your Cart:*\n\n${itemsList}\n\n*Total: $${total}*\n\nUse /checkout to pay!`, { parse_mode: 'Markdown' });
  } catch (error) { console.error('Cart error:', error); }
});

bot.command('checkout', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const user = await User.findOne({ telegramId: userId }).populate('cart');

    if (!user || user.cart.length === 0) return ctx.reply('🛒 Your cart is empty!');
    if (!user.phone || !user.address) return ctx.reply('⚠️ Please register first! Use /register.');

    let total = user.cart.reduce((sum, item) => sum + item.price, 0);

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: user.cart.map(item => ({
          price_data: {
            currency: 'usd',
            product_data: { name: item.name },
            unit_amount: item.price * 100,
          },
          quantity: 1,
        })),
        mode: 'payment',
        success_url: `https://t.me/${ctx.message.from.username || 'your_bot_username'}`,
        cancel_url: `https://t.me/${ctx.message.from.username || 'your_bot_username'}`,
      });

      const newOrder = new Order({
        telegramId: userId, username: user.username,
        items: user.cart.map(i => i._id), itemNames: user.cart.map(i => i.name),
        totalAmount: total, status: 'Paid', stripeSessionId: session.id
      });
      await newOrder.save();
      user.cart = []; await user.save();

      return ctx.reply(` *Click below to pay $${total} securely via Stripe:*\n\n[Proceed to Checkout](${session.url})`, { parse_mode: 'Markdown' });
    } else {
      const newOrder = new Order({
        telegramId: userId, username: user.username,
        items: user.cart.map(i => i._id), itemNames: user.cart.map(i => i.name),
        totalAmount: total, status: 'Pending (Manual)'
      });
      await newOrder.save();
      user.cart = []; await user.save();
      return ctx.reply(`🎉 *Order Placed!*\nTotal: $${total}\nStatus: Pending Admin Approval.`, { parse_mode: 'Markdown' });
    }
  } catch (error) { console.error('Checkout error:', error); ctx.reply('❌ Error processing checkout.'); }
});

bot.command('myorders', async (ctx) => {
  try {
    const userId = ctx.message.from.id.toString();
    const orders = await Order.find({ telegramId: userId }).sort({ createdAt: -1 }).limit(5);

    if (orders.length === 0) return ctx.reply('📦 You have no past orders.');

    let msg = '📦 *Your Order History:*\n\n';
    orders.forEach((o, i) => {
      msg += `*#${i + 1} - ${o.status}*\n`;
      msg += `Items: ${o.itemNames.join(', ')}\n`;
      msg += `Total: $${o.totalAmount}\n`;
      msg += `Date: ${o.createdAt.toLocaleDateString()}\n\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) { console.error('Orders error:', error); }
});

bot.command('register', (ctx) => ctx.reply('📝 Reply with:\n`Phone: +123...\nAddress: ...`', { parse_mode: 'Markdown' }));
bot.on('text', async (ctx) => {
  if (ctx.message.text.includes('Phone:') && ctx.message.text.includes('Address:')) {
    const userId = ctx.message.from.id.toString();
    const phone = ctx.message.text.split('\n').find(l => l.startsWith('Phone:'))?.replace('Phone:', '').trim();
    const address = ctx.message.text.split('\n').find(l => l.startsWith('Address:'))?.replace('Address:', '').trim();
    await User.findOneAndUpdate({ telegramId: userId }, { phone, address });
    ctx.reply('✅ Profile updated!', Markup.removeKeyboard());
  }
});

// --- ADMIN COMMANDS ---

bot.command('admin_add', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Admins only.');
  try {
    const args = ctx.message.text.split(' ');
    if (args.length < 4) return ctx.reply('❌ Usage: `/admin_add <Name> <Price> <Description> <ImageURL>`', { parse_mode: 'Markdown' });
    const newProduct = new Product({ name: args[1], price: parseFloat(args[2]), description: args[3], imageUrl: args[4] || '' });
    await newProduct.save();
    ctx.reply(`✅ Added ${args[1]}!`);
  } catch (error) { ctx.reply('❌ Error adding product.'); }
});

bot.command('admin_broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply(' Admins only.');
  
  const message = ctx.message.text.replace('/admin_broadcast ', '');
  if (!message || message === ctx.message.text) return ctx.reply('❌ Usage: `/admin_broadcast <Your message>`', { parse_mode: 'Markdown' });

  ctx.reply(' Broadcasting message to all users...');
  
  try {
    const users = await User.find();
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegramId, ` *Announcement:*\n\n${message}`, { parse_mode: 'Markdown' });
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 50)); 
      } catch (err) {
        failCount++;
      }
    }
    ctx.reply(`✅ Broadcast complete!\nSent: ${successCount}\nFailed: ${failCount}`);
  } catch (error) {
    ctx.reply('❌ Error during broadcast.');
  }
});

bot.command('admin_orders', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('🚫 Admins only.');
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(5);
    if (orders.length === 0) return ctx.reply('📦 No orders yet.');
    let msg = '📦 *Recent Orders:*\n\n';
    orders.forEach((o, i) => { msg += `${i+1}. ${o.username} | $${o.totalAmount} | ${o.status}\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) { ctx.reply('❌ Error fetching orders.'); }
});

bot.help((ctx) => ctx.reply('📌 *Commands:*\n/shop - Browse\n/cart - View cart\n/checkout - Pay\n/myorders - History\n/register - Setup profile', { parse_mode: 'Markdown' }));

bot.catch((err) => console.error(`Bot error:`, err));
bot.launch({ dropPendingUpdates: true });
console.log('✅ Bot is running...');

// =====================
// 3. EXPRESS SERVER & API
// =====================
app.use(cors()); // Allows GitHub Pages to access this API
app.use(express.json());

// NEW: API Endpoint for the Mini App to fetch products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            price: p.price,
            description: p.description,
            imageUrl: p.imageUrl
        })));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/', (req, res) => res.send('✅ TG Shop Backend is running!'));
app.get('/health', (req, res) => res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.listen(port, '0.0.0.0', () => console.log(`🚀 Server running on port ${port}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));