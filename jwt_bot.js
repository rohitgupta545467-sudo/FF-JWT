const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const tls = require('tls');
const express = require('express');
const fs = require('fs');
const https = require('https');
const pdf = require('pdf-parse');
const PDFDocument = require('pdfkit');

// --- Yahan apna NAYA Token daal ---
const BOT_TOKEN = "8536183162:AAEoma9MwcJZA0o4UAW4LCuL-auvPcYZ1f0";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const API_KEY = "2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3";
const HOST = "ffmconnect.live.gop.garenanow.com";
const PATH = "/api/v2/oauth/guest/token:grant";
const COOKIE = "datadome=oYpIhVco_RFvLHe_T9KFd5wuY0gcQuNfrlt4rHJY5QOkwv4TGt8gPMK32MbHuBdzJyfXnXlfzNZT_2tHr2kys8AMYT2~T71QP1S78_7Pdx4JLOXdSrflPT6cOX2vsyJh";

function sign(payload) {
    const hmac = crypto.createHmac('sha256', API_KEY).update(payload).digest('base64');
    return hmac + "\n" + payload;
}

function rawPost(headers, body) {
    return new Promise((resolve, reject) => {
        const options = { host: HOST, port: 443, rejectUnauthorized: false };
        const socket = tls.connect(options, () => {
            let req = `POST ${PATH} HTTP/1.1\r\n`;
            for (const [key, value] of Object.entries(headers)) {
                req += `${key}: ${value}\r\n`;
            }
            req += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
            req += `Connection: close\r\n\r\n`;
            req += body;
            socket.write(req);
        });

        let responseData = '';
        socket.on('data', (chunk) => { responseData += chunk.toString('utf8'); });
        socket.on('end', () => {
            const parts = responseData.split('\r\n\r\n');
            resolve(parts[1] || ''); 
        });
        socket.on('error', (err) => reject(err));
    });
}

async function getJWT(uid, pwd) {
    const did = `02-${crypto.randomUUID()}`;
    const ts = Date.now().toString();
    
    const bodyObj = {
        "client_id": 100067,
        "client_secret": API_KEY,
        "client_type": 2,
        "device_id": did,
        "password": pwd,
        "response_type": "token",
        "uid": parseInt(uid)
    };
    
    const bodyStr = JSON.stringify(bodyObj);
    const headers = {
        "User-Agent": "GarenaMSDK/4.0.44(25028RN03A ;Android 15;hi;IN;app 1.132.1 2019121229;)",
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Signature ${sign(bodyStr)}`,
        "X-Timestamp": ts,
        "Cookie": COOKIE,
        "Host": HOST
    };

    try {
        const resp = await rawPost(headers, bodyStr);
        if (resp.includes("access_token")) {
            const data = JSON.parse(resp);
            return { success: true, jwt: data.data.access_token, open_id: data.data.open_id };
        } else {
            return { success: false, error: resp };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Bhai, apna UID aur Password bhej (koi bhi format chalega jaise `UID Password` ya `UID:Password`).\n\nYa phir seedha ek **PDF file** bhej jisme line-by-line accounts hain!");
});

// Text message handler
bot.on('message', async (msg) => {
    if (msg.text === '/start' || !msg.text) return;

    const match = msg.text.match(/([a-zA-Z0-9]+)[\s:|,-]+(.+)/);
    if (!match) {
        bot.sendMessage(msg.chat.id, "❌ UID aur Password samajh nahi aaya. Aise bhej: `123456789 Password123`");
        return;
    }

    const uid = match[1].trim();
    const pwd = match[2].trim();

    bot.sendMessage(msg.chat.id, `⏳ Token nikal raha hoon UID: ${uid} ke liye...`);

    const result = await getJWT(uid, pwd);
    if (result.success) {
        const reply = `✅ **JWT Token Mil Gaya!**\n\n👤 UID: \`${uid}\`\n🆔 Open ID: \`${result.open_id}\`\n\n🔑 **Token:**\n\`${result.jwt}\``;
        bot.sendMessage(msg.chat.id, reply, { parse_mode: "Markdown" });
    } else {
        bot.sendMessage(msg.chat.id, `❌ Error aaya:\n\`${result.error}\``, { parse_mode: "Markdown" });
    }
});

// PDF handler
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;

    bot.sendMessage(chatId, "⏳ PDF read kar raha hoon, thoda wait kar...");

    try {
        const fileLink = await bot.getFileLink(fileId);
        const filePath = `/tmp/${fileId}.pdf`;
        
        const file = fs.createWriteStream(filePath);
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', async () => {
                file.close();
                
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdf(dataBuffer);
                const text = pdfData.text;

                const regex = /([a-zA-Z0-9]+)[\s:|,-]+([^\s]+)/g;
                let match;
                let accounts = [];

                while ((match = regex.exec(text)) !== null) {
                    accounts.push({ uid: match[1].trim(), pwd: match[2].trim() });
                }

                if (accounts.length === 0) {
                    bot.sendMessage(chatId, "❌ PDF mein koi valid UID/Password nahi mila.");
                    return;
                }

                bot.sendMessage(chatId, `✅ ${accounts.length} accounts mile. Ab JWT nikal raha hoon, thoda time lagega...`);

                const doc = new PDFDocument();
                const outputPath = `/tmp/JWT_Results_${fileId}.pdf`;
                doc.pipe(fs.createWriteStream(outputPath));

                doc.fontSize(16).text('FF Accounts JWT Tokens', { align: 'center' });
                doc.moveDown();

                for (let i = 0; i < accounts.length; i++) {
                    const acc = accounts[i];
                    const res = await getJWT(acc.uid, acc.pwd);
                    
                    doc.fontSize(10).fillColor('black');
                    doc.text(`UID: ${acc.uid} | Password: ${acc.pwd}`);
                    
                    if (res.success) {
                        doc.fillColor('green').text(`JWT: ${res.jwt}`);
                    } else {
                        doc.fillColor('red').text(`Error: ${res.error}`);
                    }
                    doc.moveDown();

                    await new Promise(r => setTimeout(r, 1500));
                }

                doc.end();

                setTimeout(() => {
                    bot.sendDocument(chatId, outputPath, {
                        caption: `✅ Sabhi accounts ka JWT nikal liya gaya!`
                    }).then(() => {
                        fs.unlinkSync(filePath);
                        fs.unlinkSync(outputPath);
                    });
                }, 3000);
            });
        });
    } catch (err) {
        bot.sendMessage(chatId, `❌ PDF Process Error: ${err.message}`);
    }
});

const app = express();
app.get('/', (req, res) => { res.send("FF JWT Bot is Alive!"); });
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
