const config = {
    nomor: "+1 (289) 712-2221",
    prefix: ["."]
};

import { makeWASocket, DisconnectReason, useMultiFileAuthState, getContentType, delay } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import pino from "pino";

const js = data => console.log(JSON.stringify(data, null, 2));

async function connectToWhatsApp() {
    console.log(`- Menghubungkan ---------`);
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve("./.sess"));
    const sock = makeWASocket({
        auth: state,
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "chrome", "121.0.6167.159"]
    });

    if (!sock.authState.creds.registered) {
        console.log(`- Nomor WA : ${config.nomor}`);
        await delay(3000);
        const code = await sock.requestPairingCode(config.nomor.replace(/\D/g, ""));
        console.log(`- Kode Pairing : ${code}`);
    }

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async update => {
        try {
            const { connection, lastDisconnect } = update;
            if (connection) {
                console.log(`- Status Koneksi : ${connection}`);
            }
            if (connection === "close") {
                const e = new Boom(lastDisconnect?.error)?.output?.payload.message;
                console.log(`- Koneksi Terputus : ${e}`);
                connectToWhatsApp();
            }
            if (connection == "open") {
                console.log(`- Terkoneksi`);
            }
        } catch (err) {
            console.log(err);
            connectToWhatsApp();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        const [m] = messages;
        let serialized = {
            ...m,
            group: m?.key?.remoteJid.endsWith("@g.us")
                ? {
                      id: m?.key?.remoteJid,
                      name: (await sock.groupMetadata(m?.key?.remoteJid))?.subject || false
                  }
                : false,
            id: m?.key?.remoteJid,
            number: m?.key?.remoteJid.endsWith("@g.us") ? m?.key?.participant : m?.key?.remoteJid,
            name: m?.pushName,
            text: m?.message?.extendedTextMessage?.text || m?.message?.conversation || m?.message?.imageMessage?.caption || m?.message?.videoMessage?.caption || ""
        };
        if (!serialized.key.fromMe) return;
        if (serialized.id == "status@broadcast") return;
        await handlerMessage(sock, serialized, type);
    });
}

async function getListGroup(sock, sender) {
    const list_group = await sock.groupFetchAllParticipating();
    let message = `*Daftar Grup:*\n\n`;
    Object.values(list_group).forEach((item, index) => {
        message += `*${index + 1}. ${item.subject}*\nID: ${item.id}\nJumlah Member: ${item.size}\n\n`;
    });
    await sock.sendMessage(sender, { text: message });
}

async function getGroupMember(sock, sender, groupId) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        const membersList = metadata.participants.map((p, index) => `${p.id.replace("@s.whatsapp.net", "")}`).join("\n");
        const message = `
*Nama Grup:* ${metadata.subject}
*ID:* ${metadata.id}
*Pembuat:* ${metadata.owner ? metadata.owner.replace("@s.whatsapp.net", "") : "Tidak diketahui"}
*Jumlah Member:* ${metadata.size}

*Daftar Member:*
${membersList}
`.trim();

        await sock.sendMessage(sender, { text: message });
    } catch (err) {
        await sock.sendMessage(sender, { text: "❌ Gagal mendapatkan anggota grup. Pastikan ID grup benar." });
    }
}

async function inspectGroup(sock, sender, link) {
    try {
        const regex = /chat\.whatsapp\.com\/([a-zA-Z0-9]+)/;
        const match = link.match(regex);
        if (!match) {
            await sock.sendMessage(sender, { text: "❌ Link undangan tidak valid." });
            return;
        }
        const inviteCode = match[1];
        const groupInfo = await sock.groupGetInviteInfo(inviteCode);
        const message = `
*Nama Grup:* ${groupInfo.subject}
*ID:* ${groupInfo.id}
*Pembuat:* ${groupInfo.creator ? groupInfo.creator.replace("@s.whatsapp.net", "") : "Tidak diketahui"}
*Jumlah Member:* ${groupInfo.size}
*Tipe Grup:* ${groupInfo.announce ? "Hanya Admin" : "Semua Bisa Chat"}

*Deskripsi:* 
${groupInfo.desc || "Tidak ada deskripsi"}
`.trim();

        await sock.sendMessage(sender, { text: message });
    } catch (err) {
        await sock.sendMessage(sender, { text: "❌ Gagal mendapatkan info grup. Pastikan link valid dan bot tidak diblokir." });
    }
}

async function handlerMessage(sock, serialized, type) {
    const { text, id } = serialized;
    if (!text.startsWith(config.prefix[0])) return;
    const args = text.slice(1).trim().split(" ");
    const command = args.shift().toLowerCase();
    switch (command) {
        case "help":
            let teks = ".gruplist\n.getmember <id>\n.inspect <link>\n\n> @andy.jees";
            sock.sendMessage(id, { text: teks });
            break;
        case "gruplist":
            await getListGroup(sock, id);
            break;

        case "getmember":
            if (args.length === 0) {
                await sock.sendMessage(id, { text: "❌ Gunakan format: *.getmember <group_id>*" });
                return;
            }
            await getGroupMember(sock, id, args[0]);
            break;

        case "inspect":
            if (args.length === 0) {
                await sock.sendMessage(id, { text: "❌ Gunakan format: *.inspect <link grup>*" });
                return;
            }
            await inspectGroup(sock, id, args[0]);
            break;
    }
}

connectToWhatsApp();
