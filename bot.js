const ethers = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const telegramToken = "7844459795:AAHuoulmyO3O5uaSD4s7pct8dM5ToPbqkCA";
const bscScanApiKey = "2TA38R92B13FPMH2INMBYDF4XC4P2PFVTZ";
const bot = new TelegramBot(telegramToken, { polling: false });

const provider = new ethers.providers.WebSocketProvider("wss://bsc-ws-node.nariox.org:443");
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

// Đọc chat_ids từ file (nếu có)
const chatIdsFile = "chat_ids.json";
if (fs.existsSync(chatIdsFile)) {
  const savedChatIds = JSON.parse(fs.readFileSync(chatIdsFile, "utf8"));
  chatIds = new Set(savedChatIds);
}

// Hàm lưu chat_ids vào file
function saveChatIds() {
  fs.writeFileSync(chatIdsFile, JSON.stringify([...chatIds]));
}

// Thu thập chat_ids từ getUpdates
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

// Hàm lấy URL ảnh từ four.meme
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

// Lắng nghe sự kiện LiquidityAdded
contract.on("LiquidityAdded", async (base, offers, quote, funds, event) => {
  try {
    const tokenContract = new ethers.Contract(base, tokenABI, provider);
    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    const totalSupply = await tokenContract.totalSupply();

    const holdersRes = await axios.get(
      `https://api.bscscan.com/api?module=token&action=tokenholderlist&contractaddress=${base}&page=1&offset=10&apikey=${bscScanApiKey}`
    );
    const holders = holdersRes.data.result;
    let totalTop10Percent = 0;
    let holdersText = "";
    let devAddress = await tokenContract.owner().catch(() => "Không xác định");
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
    console.error("Lỗi:", error);
  }
});

collectChatIds();