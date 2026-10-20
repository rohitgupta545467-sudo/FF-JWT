process.env.NTBA_FIX_350 = 1; 
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const tls = require('tls');
const net = require('net');
const express = require('express');
const fs = require('fs');
const https = require('https');
const pdf = require('pdf-parse');
const PDFDocument = require('pdfkit');

// --- TERA TOKEN ADD HO GAYA HAI ---
const BOT_TOKEN = "8536183162:AAEoma9MwcJZA0o4UAW4LCuL-auvPcYZ1f0";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const API_KEY = "2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3";
const HOST = "ffmconnect.live.gop.garenanow.com";
const PATH = "/api/v2/oauth/guest/token:grant";
const COOKIE = "datadome=oYpIhVco_RFvLHe_T9KFd5wuY0gcQuNfrlt4rHJY5QOkwv4TGt8gPMK32MbHuBdzJyfXnXlfzNZT_2tHr2kys8AMYT2~T71QP1S78_7Pdx4JLOXdSrflPT6cOX2vsyJh";

let proxies = [];

// --- 1. FREE PROXY SCRAPER ---
async function fetchProxies() {
    return new Promise((resolve) => {
        https.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                proxies = data.split('\r\n').filter(p => p.trim() !== '');
                console.log(`[+] Fetched ${proxies.length} proxies.`);
                resolve();
            });
        }).on('error', () => resolve());
    });
}

function sign(payload) {
    const hmac = crypto.createHmac('sha256', API_KEY).update(payload).digest('base64');
    return hmac + "\n" + payload;
}

// --- 2. RAW TLS WITH PROXY SUPPORT ---
function createProxySocket(proxy, targetHost, targetPort) {
    return new Promise((resolve, reject) => {
        const [proxyHost, proxyPort] = proxy.split(':');
        const socket = net.connect(parseInt(proxyPort), proxyHost, () => {
            socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
        });
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('HTTP/1.1 200')) {
                socket.removeAllListeners('data');
                resolve(socket);
            }
        });
        socket.on('error', reject);
        setTimeout(() => { socket.destroy(); reject(new Error('Proxy Timeout')); }, 4000);
    });
}

function rawPost(headers, body) {
    return new Promise(async (resolve, reject) => {
        let socket;
        let usedProxy = false;

        try {
            if (proxies.length > 0 && Math.random() < 0.5) {
                const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                try {
                    socket = await createProxySocket(proxy, HOST, 443);
                    usedProxy = true;
                } catch(e) {
                    socket = net.connect(443, HOST);
                }
            } else {
                socket = net.connect(443, HOST);
            }

            const tlsSocket = tls.connect({ socket, servername: HOST, rejectUnauthorized: false }, () => {
                let req = `POST ${PATH} HTTP/1.1\r\n`;
                for (const [key, value] of Object.entries(headers)) {
                    req += `${key}: ${value}\r\n`;
                }
                req += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
                req += `Connection: close\r\n\r\n`;
                req += body;
                tlsSocket.write(req);
            });

            let responseData = '';
            tlsSocket.on('data', (chunk) => { responseData += chunk.toString('utf8'); });
            tlsSocket.on('end', () => {
                const parts = responseData.split('\r\n\r\n');
                resolve({ resp: parts[1] || '', usedProxy });
            });
            tlsSocket.on('error', (err) => reject(err));
            setTimeout(() => { tlsSocket.destroy(); reject(new Error('Timeout')); }, 5000);

        } catch (err) {
            reject(err);
        }
    });
}

// --- 3. JWT GENERATOR ---
async function getJWT(uid, pwd, retries = 2) {
    const did = `02-${crypto.randomUUID()}`;
    const ts = Date.now().toString();
    const bodyObj = {
        "client_id": 100067, "client_secret": API_KEY, "client_type": 2,
        "device_id": did, "password": pwd, "response_type": "token", "uid": parseInt(uid)
    };
    const bodyStr = JSON.stringify(bodyObj);
    const headers = {
        "User-Agent": "GarenaMSDK/4.0.44(25028RN03A ;Android 15;hi;IN;app 1.132.1 2019121229;)",
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Signature ${sign(bodyStr)}`,
        "X-Timestamp": ts, "Cookie": COOKIE, "Host": HOST
    };

    for (let i = 0; i < retries; i++) {
        try {
            const { resp } = await rawPost(headers, bodyStr);
            if (resp.includes("error_too_many_requests")) {
                continue; 
            }
            if (resp.includes("access_token")) {
                const data = JSON.parse(resp);
                return { success: true, jwt: data.data.access_token, open_id: data.data.open_id };
            } else {
                return { success: false, error: resp };
            }
        } catch (e) {
            if (i === retries - 1) return { success: false, error: "Timeout/Proxy Fail" };
        }
    }
    return { success: false, error: "429 IP Blocked" };
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Bhai, UID Password bhej ya **PDF file** bhej bulk ke liye!\nBot khud dhoondh lega UID aur Password.");
});

bot.on('message', async (msg) => {
    if (msg.text === '/start' || !msg.text) return;
    const match = msg.text.match(/(?:uid\s*[=:]\s*)?(\d{6,12})[\s\S]*?(?:pass|password)\s*[=:]\s*([a-zA-Z0-9]+)/i) 
               || msg.text.match(/(\d{6,12})[\s:|,=-]+([^\s\r\n]+)/);
    if (!match) return bot.sendMessage(msg.chat.id, "❌ Format: `123456789 Password123`");

    const uid = match[1].trim(), pwd = match[2].trim();
    bot.sendMessage(msg.chat.id, `⏳ Token nikal raha hoon UID: ${uid}...`);

    const result = await getJWT(uid, pwd);
    if (result.success) {
        bot.sendMessage(msg.chat.id, `✅ **JWT Mil Gaya!**\n\n👤 UID: \`${uid}\`\n🔑 **Token:**\n\`${result.jwt}\``, { parse_mode: "Markdown" });
    } else {
        bot.sendMessage(msg.chat.id, `❌ Error:\n\`${result.error}\``, { parse_mode: "Markdown" });
    }
});

// --- 4. FAST BATCH PDF PROCESSING ---
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;
    bot.sendMessage(chatId, "⏳ PDF read kar raha hoon...");

    try {
        const fileLink = await bot.getFileLink(fileId);
        const filePath = `/tmp/${fileId}.pdf`;
        const file = fs.createWriteStream(filePath);
        
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', async () => {
                file.close();
                const pdfData = await pdf(fs.readFileSync(filePath));
                
                let accounts = [];
                let match;
                const regex1 = /uid\s*[=:]\s*(\d{6,12})[\s\S]*?(?:pass|password)\s*[=:]\s*([a-zA-Z0-9!@#$%^&*]+)/gi;
                const regex2 = /(?:pass|password)\s*[=:]\s*([a-zA-Z0-9!@#$%^&*]+)[\s\S]*?uid\s*[=:]\s*(\d{6,12})/gi;
                const regex3 = /(\d{6,12})[\s:|,=-]+([^\s\r\n]+)/g;

                let matched = false;
                while ((match = regex1.exec(pdfData.text)) !== null) {
                    accounts.push({ uid: match[1], pwd: match[2] }); matched = true;
                }
                if (!matched) {
                    while ((match = regex2.exec(pdfData.text)) !== null) {
                        accounts.push({ uid: match[2], pwd: match[1] }); matched = true;
                    }
                }
                if (!matched) {
                    while ((match = regex3.exec(pdfData.text)) !== null) {
                        accounts.push({ uid: match[1], pwd: match[2] }); 
                    }
                }

                accounts = accounts.filter((v,i,a)=>a.findIndex(v2=>(v2.uid===v.uid))===i);

                if (accounts.length === 0) return bot.sendMessage(chatId, "❌ PDF mein koi valid UID/Password nahi mila.");

                bot.sendMessage(chatId, `✅ ${accounts.length} accounts mile. Super Fast Process shuru...`);

                const doc = new PDFDocument();
                const outputPath = `/tmp/JWT_Results_${fileId}.pdf`;
                doc.pipe(fs.createWriteStream(outputPath));
                doc.fontSize(16).text('FF Accounts JWT Tokens', { align: 'center' }).moveDown();

                const BATCH_SIZE = 20; 
                let processed = 0;

                for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
                    const batch = accounts.slice(i, i + BATCH_SIZE);
                    
                    const promises = batch.map(acc => getJWT(acc.uid, acc.pwd));
                    const results = await Promise.all(promises);

                    for (let j = 0; j < batch.length; j++) {
                        const acc = batch[j];
                        const res = results[j];
                        
                        doc.fontSize(10).fillColor('black').text(`UID: ${acc.uid} | Pass: ${acc.pwd}`);
                        if (res.success) {
                            doc.fillColor('green').text(`JWT: ${res.jwt}`);
                        } else {
                            doc.fillColor('red').text(`Error: ${res.error}`);
                        }
                        doc.moveDown();
                    }

                    processed += batch.length;
                    bot.sendMessage(chatId, `⏳ Progress: ${processed} / ${accounts.length} accounts done...`);

                    await new Promise(r => setTimeout(r, 1000));
                }

                doc.end();
                setTimeout(() => {
                    bot.sendDocument(chatId, outputPath, { caption: `✅ Bulk JWT Ready!` })
                       .then(() => { fs.unlinkSync(filePath); fs.unlinkSync(outputPath); });
                }, 3000);
            });
        });
    } catch (err) { bot.sendMessage(chatId, `❌ PDF Error: ${err.message}`); }
});

const app = express();
app.get('/', (req, res) => { res.send("FF JWT Bot is Alive!"); });
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { 
    console.log(`Server running on port ${PORT}`);
    fetchProxies(); 
});
