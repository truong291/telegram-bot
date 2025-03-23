const ethers = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const telegramToken = process.env.TELEGRAM_TOKEN;
const bscScanApiKey = process.env.BSCSCAN_API_KEY;
const bot = new TelegramBot(telegramToken, { polling: false });

// Dùng HTTP Provider mới
const provider = new ethers.providers.JsonRpcProvider("https://bsc-dataseed1.defibit.io/");

const tokenManager2Address = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";
const tokenManager2ABI = ["event LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)"];
const contract = new ethers.Contract(tokenManager2Address, tokenManager2ABI, provider);

const tokenABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
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
    const [name, symbol, totalSupply, devAddress] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.totalSupply(),
      tokenContract.owner().catch(() => "Không xác định")
    ]);

    const holdersRes = await axios.get(
      `https://api.bscscan.com/api?module=token&action=tokenholderlist&contractaddress=${base}&page=1&offset=10&apikey=${bscScanApiKey}`
    );
    const holders = holdersRes.data.result;
    let totalTop10Percent = 0;
    let holdersText = "";
    holders.forEach((holder) => {
      const percentage = (holder.value / totalSupply.toString()) * 100;
      totalTop10Percent += percentage;
      const isDev = holder.address.toLowerCase() === devAddress.toLowerCase() ? " (dev)" : "";
      holdersText += `[${percentage.toFixed(2)}%]${isDev}(https://bscscan.com/address/${holder.address}) | `;
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
Top 10 holders: (Tổng: ${totalTop10Percent.toFixed(2)}%)
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
  // Lấy block khởi tạo
  let lastBlock = await provider.getBlockNumber();
  console.log(`Bắt đầu polling từ block ${lastBlock}`);

  let retryDelay = 1000; // Thời gian chờ ban đầu: 1 giây (1000ms)

  // Polling để kiểm tra sự kiện LiquidityAdded
  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastBlock) return; // Không có block mới

      console.log(`Kiểm tra sự kiện từ block ${lastBlock} đến ${currentBlock}`);
      const events = await contract.queryFilter("LiquidityAdded", lastBlock, currentBlock);
      for (const event of events) {
        const { base, offers, quote, funds } = event.args;
        console.log(`Phát hiện sự kiện LiquidityAdded: ${base}`);
        await processLiquidityAddedEvent(base, offers, quote, funds);
      }
      lastBlock = currentBlock + 1;
      retryDelay = 1000; // Reset thời gian chờ nếu thành công
    } catch (error) {
      console.error("Lỗi polling:", error.message);
      if (error.message.includes("limit exceeded")) {
        retryDelay *= 2; // Tăng thời gian chờ nếu gặp lỗi limit exceeded
        console.log(`Gặp lỗi limit exceeded, tăng thời gian chờ lên ${retryDelay}ms`);
        if (retryDelay > 10000) retryDelay = 10000; // Giới hạn tối đa 10 giây
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }, retryDelay); // Thời gian polling sẽ thay đổi động

  // Bắt đầu thu thập chat_ids
  collectChatIds();
}

startBot();