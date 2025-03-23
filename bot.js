const ethers = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const telegramToken = process.env.TELEGRAM_TOKEN;
const bscScanApiKey = process.env.BSCSCAN_API_KEY;
const bot = new TelegramBot(telegramToken, { polling: false });

// Dùng WebSocket Provider từ QuickNode
const provider = new ethers.providers.WebSocketProvider("wss://fabled-withered-frost.bsc.quiknode.pro/69d9d850c37e37ac5001dc27c72221c55c6cff25/");

const tokenManager2Address = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";
const tokenManager2ABI = ["event LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)"];
const contract = new ethers.Contract(tokenManager2Address, tokenManager2ABI, provider);

const tokenABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)"
];

// Lưu trữ chat_ids
let chatIds = new Set();
const chatIdsFile = "chat_ids.json";
if (fs.existsSync(chatIdsFile)) {
  const savedChatIds = JSON.parse(fs.readFileSync(chatIdsFile, "utf8"));
  chatIds = new Set(savedChatIds);
}

function saveChatIds() {
  fs.writeFileSync(chatIdsFile, JSON.stringify([...chatIds]));
}

async function collectChatIds() {
  let offset = 0;
  while (true) {
    try {
      const updates = await axios.get(
        `https://api.telegram.org/bot${telegramToken}/getUpdates?offset=${offset}`
      );
      const results = updates.data.result;

      for (const update of results) {
        offset = update.update_id + 1;
        let chatId = null;
        if (update.message?.chat) {
          chatId = update.message.chat.id;
        } else if (update.channel_post?.chat) {
          chatId = update.channel_post.chat.id;
        } else if (update.my_chat_member?.chat) {
          chatId = update.my_chat_member.chat.id;
        }

        if (chatId) {
          chatIds.add(chatId.toString());
          console.log(`Đã thêm chat_id: ${chatId}`);
          saveChatIds();
        }
      }
    } catch (error) {
      console.error("Lỗi thu thập chat_ids:", error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function getTokenImageUrl(contractAddress) {
  try {
    const response = await axios.get(`https://four.meme/token/${contractAddress}`);
    const $ = cheerio.load(response.data);
    const imgSrc = $('img[alt="token image"]').attr("src");
    return imgSrc || "https://static.four.meme/market/f6f6de02-bbe9-459f-91d0-caa32c08c9c89291568614604981580.png";
  } catch (error) {
    console.error("Lỗi lấy ảnh:", error);
    return "https://static.four.meme/market/f6f6de02-bbe9-459f-91d0-caa32c08c9c89291568614604981580.png";
  }
}

async function processLiquidityAddedEvent(base, offers, quote, funds) {
  try {
    const tokenContract = new ethers.Contract(base, tokenABI, provider);
    const [name, symbol, devAddress] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.owner().catch(() => "Không xác định")
    ]);

    const holdersRes = await axios.get(
      `https://api.bscscan.com/api?module=token&action=tokenholderlist&contractaddress=${base}&page=1&offset=10&apikey=${bscScanApiKey}`
    );
    const holders = holdersRes.data.result;
    let holdersText = "";
    holders.forEach((holder) => {
      holdersText += `[Holder](https://bscscan.com/address/${holder.address}) | `;
    });
    holdersText = holdersText.slice(0, -3);

    const devBalance = devAddress !== "Không xác định"
      ? ethers.utils.formatEther(await provider.getBalance(devAddress))
      : "N/A";

    const socials = { website: "https://safemoon.com", twitter: "https://twitter.com/safemoon", telegram: "https://t.me/safemoon" };
    let socialText = "";
    if (socials.website) socialText += `[Website](${socials.website}) | `;
    if (socials.twitter) socialText += `[Twitter](${socials.twitter}) | `;
    if (socials.telegram) socialText += `[Telegram](${socials.telegram})`;
    socialText = socialText.slice(0, -3);

    const message = `
🔔 [FOUR MEME] NEW TOKEN BONDED DETECTED
✅ Token Information:
Name: ${name}
Symbol: ${symbol}
Contract: \`${base}\`
Top 10 holders:
  ${holdersText}
Creator: [${devAddress}](https://bscscan.com/address/${devAddress}) - Balance: ${devBalance} BNB
Social: ${socialText}
Chart: [Dextscreen](https://dexscreener.com/bsc/${base}) | [Mevx](https://mevx.io/bsc/${base}?ref=finalbot) | [Four meme](https://four.meme/token/${base})
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "Maestro", url: `https://t.me/maestro?start=${base}-truong291` },
          { text: "Mevx", url: `https://t.me/Mevx?start=${base}-finalbot` },
          { text: "Signma Bot", url: `https://t.me/SigmaTrading8_bot?start=x1185088918-${base}` }
        ],
        [{ text: "BOOST ME", url: "https://t.me/boost/meme_bonded_alert" }]
      ]
    };

    const imageUrl = await getTokenImageUrl(base);
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(imageResponse.data, "binary");

    for (const chatId of chatIds) {
      try {
        await bot.sendPhoto(chatId, imageBuffer, {
          caption: message,
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
        console.log(`Đã gửi thông báo đến chat ${chatId} cho token ${base}`);
      } catch (error) {
        console.error(`Lỗi gửi đến chat ${chatId}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Lỗi xử lý sự kiện:", error);
  }
}

async function startBot() {
  // Lắng nghe sự kiện LiquidityAdded với WebSocket
  contract.on("LiquidityAdded", async (base, offers, quote, funds, event) => {
    console.log(`Phát hiện sự kiện LiquidityAdded: ${base}`);
    await processLiquidityAddedEvent(base, offers, quote, funds);
  });

  // Xử lý lỗi WebSocket
  provider._websocket.on("error", (error) => {
    console.error("Lỗi WebSocket:", error.message);
  });

  provider._websocket.on("close", () => {
    console.error("Kết nối WebSocket bị đóng, thử kết nối lại...");
    setTimeout(startBot, 5000); // Thử lại sau 5 giây
  });

  // Bắt đầu thu thập chat_ids
  collectChatIds();
}

startBot();