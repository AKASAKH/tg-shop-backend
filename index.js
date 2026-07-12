const { Telegraf } = require('telegraf');

// Replace with your actual Bot Token from @BotFather
const BOT_TOKEN = '8853776174:AAGoRVbmtP0rYZa9DmzMthYOAOd_osBbpQM'; 
const bot = new Telegraf(BOT_TOKEN);

// 1. The /start command (Shows the Mini App button)
bot.start((ctx) => {
    ctx.reply('Welcome to the Telegram Shop! Click the button below to start shopping.', {
        reply_markup: {
            // This links your GitHub Pages frontend to the bot
            inline_keyboard: [[
                { 
                    text: '🛍️ Open Shop', 
                    web_app: { url: 'https://akasakh.github.io/tg-shop-miniapp/' } 
                }
            ]]
        }
    });
});

// 2. Handle the Checkout Data sent from the Mini App
bot.on('web_app_data', async (ctx) => {
    try {
        // Parse the JSON data sent by tg.sendData()
        const data = JSON.parse(ctx.message.web_app_data.data);
        
        if (data.action === 'checkout') {
            const user = data.user;
            const items = data.items;
            const total = data.total;

            // A. Send confirmation to the customer
            let receipt = `✅ <b>Order Confirmed!</b>\n\n`;
            receipt += `Hello ${user.name}!\n`;
            receipt += `Here is your order summary:\n\n`;
            
            items.forEach(item => {
                receipt += `• ${item.name} (x${item.qty}) - $${(item.price * item.qty).toFixed(2)}\n`;
            });
            
            receipt += `\n<b>Total: $${total.toFixed(2)}</b>\n\n`;
            receipt += `We will contact you shortly for shipping details.`;

            await ctx.reply(receipt, { parse_mode: 'HTML' });

            // B. Send order notification to YOU (the Admin)
            // Replace 123456789 with your actual Telegram User ID (you can get it from @userinfobot)
            const ADMIN_ID = 123456789; 
            
            let adminAlert = `🚨 <b>NEW ORDER RECEIVED</b>\n\n`;
            adminAlert += ` Customer: @${user.username || user.id}\n`;
            adminAlert += ` Items:\n`;
            
            items.forEach(item => {
                adminAlert += `   - ${item.name} (x${item.qty})\n`;
            });
            
            adminAlert += `\n💰 <b>Total: $${total.toFixed(2)}</b>`;
            
            await bot.telegram.sendMessage(ADMIN_ID, adminAlert, { parse_mode: 'HTML' });
        }
    } catch (error) {
        console.error('Error processing web app data:', error);
        ctx.reply('Sorry, an error occurred while processing your order.');
    }
});

// 3. Start the bot
console.log('Bot is running...');
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));