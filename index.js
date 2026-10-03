require("dotenv").config();

const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

const wordToPdf = require("./services/wordToPdf");
const pdfToWord = require("./services/pdfToWord");

const bot = new Telegraf(process.env.BOT_TOKEN);

const TEMP_DIR = path.join(__dirname, "temp");
const OUTPUT_DIR = path.join(__dirname, "output");

// ================================
// HELPER FUNCTIONS
// ================================

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function cleanFolder(folder) {
    if (!fs.existsSync(folder)) {
        return;
    }

    const files = fs.readdirSync(folder);
    for (const file of files) {
        const filePath = path.join(folder, file);
        try {
            fs.rmSync(filePath, {
                recursive: true,
                force: true,
            });
            console.log("🗑️ Cleanup:", filePath);
        } catch (error) {
            console.error("Gagal menghapus:", filePath, error.message);
        }
    }
}

async function downloadFile(url, destinationPath, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            const arrayBuffer = await res.arrayBuffer();
            fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
            return;
        } catch (error) {
            console.warn(`⚠️ Percobaan unduh ke-${attempt} gagal:`, error.message);
            if (attempt === retries) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }
}

// Inisialisasi folder kerja & bersihkan sisa file
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
cleanFolder(TEMP_DIR);
cleanFolder(OUTPUT_DIR);

// ================================
// MESSAGE TRACKER (UNTUK RESET CHAT)
// ================================

const chatMessages = new Map();

function trackMessage(chatId, messageId) {
    if (!chatId || !messageId) return;
    if (!chatMessages.has(chatId)) {
        chatMessages.set(chatId, new Set());
    }
    const set = chatMessages.get(chatId);
    set.add(messageId);
    // Batasi 100 pesan terakhir per chat agar memori hemat
    if (set.size > 100) {
        const firstKey = set.values().next().value;
        set.delete(firstKey);
    }
}

// Middleware Telegraf untuk otomatis mencatat pesan user
bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.message?.message_id) {
        trackMessage(ctx.chat.id, ctx.message.message_id);
    }
    await next();
});

// ================================
// DASHBOARD & MENU UI
// ================================

function getMainDashboard(firstName = "Teman") {
    const text =
        `👋 <b>Halo, ${escapeHtml(firstName)}!</b>\n\n` +
        `Selamat datang di <b>Word ⇄ PDF Converter Bot</b>.\n` +
        `Solusi cepat, rapi, dan mudah untuk mengubah format dokumen kamu langsung di Telegram! 🚀\n\n` +
        `⚡ <b>Fitur Unggulan:</b>\n` +
        `├ 📄 <b>Word ➔ PDF</b> (<code>.doc</code>, <code>.docx</code>)\n` +
        `├ 📕 <b>PDF ➔ Word</b> (<code>.pdf ➔ .docx</code>)\n` +
        `├ ⚡ <b>Cepat & Presisi:</b> Mempertahankan tata letak dokumen\n` +
        `├ 🧹 <b>Reset Chat:</b> Bersihkan riwayat chat kapan saja\n` +
        `├ 🔒 <b>Privasi Terjaga:</b> File otomatis dihapus setelah konversi\n` +
        `└ 📦 <b>Kapasitas:</b> Maksimal hingga 20 MB per file\n\n` +
        `<i>Silakan pilih menu di bawah atau langsung kirimkan file kamu:</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "📄 Word ➔ PDF", callback_data: "menu_word_to_pdf" },
                { text: "📕 PDF ➔ Word", callback_data: "menu_pdf_to_word" },
            ],
            [
                { text: "📖 Panduan", callback_data: "menu_help" },
                { text: "ℹ️ Tentang Bot", callback_data: "menu_about" },
            ],
            [
                { text: "🧹 Bersihkan Chat / Reset", callback_data: "action_reset_chat" },
            ],
        ],
    };

    return { text, keyboard };
}

// ================================
// FITUR RESET CHAT
// ================================

async function clearChatHistory(ctx) {
    const chatId = ctx.chat.id;
    const currentMsgId = ctx.message ? ctx.message.message_id : ctx.callbackQuery?.message?.message_id;

    // Kumpulkan ID pesan yang pernah tercatat
    const idsToDelete = new Set(chatMessages.get(chatId) || []);

    // Hapus juga hingga 60 pesan ke belakang dari pesan saat ini
    if (currentMsgId) {
        for (let i = 0; i <= 60; i++) {
            const id = currentMsgId - i;
            if (id > 0) idsToDelete.add(id);
        }
    }

    const idsArray = Array.from(idsToDelete).filter((id) => Boolean(id));

    // Hapus pesan menggunakan bulk delete atau per pesan
    if (idsArray.length > 0) {
        for (let i = 0; i < idsArray.length; i += 100) {
            const chunk = idsArray.slice(i, i + 100);
            try {
                await ctx.telegram.deleteMessages(chatId, chunk);
            } catch {
                await Promise.allSettled(
                    chunk.map((id) => ctx.telegram.deleteMessage(chatId, id).catch(() => {}))
                );
            }
        }
    }

    // Reset tracker memori
    chatMessages.set(chatId, new Set());

    // Kirim pesan dashboard baru yang bersih
    const { text, keyboard } = getMainDashboard(ctx.from?.first_name || "Teman");
    const cleanNotice =
        `🧹 <b>Ruang Chat Berhasil Dibersihkan!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Semua pesan riwayat obrolan sebelumnya telah dihapus agar chat kembali bersih dan rapi. ✨\n\n` +
        text;

    try {
        const sent = await ctx.reply(cleanNotice, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
        trackMessage(chatId, sent.message_id);
    } catch (e) {
        console.error("Gagal mengirim notifikasi reset chat:", e.message);
    }
}

// ================================
// COMMANDS
// ================================

bot.start(async (ctx) => {
    const { text, keyboard } = getMainDashboard(ctx.from.first_name);
    const sent = await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
    });
    trackMessage(ctx.chat.id, sent.message_id);
});

bot.command("reset", clearChatHistory);
bot.command("clear", clearChatHistory);
bot.command("clearchat", clearChatHistory);

bot.help((ctx) => {
    const helpText =
        `📖 <b>PANDUAN PENGGUNAAN BOT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `1️⃣ <b>Kirimkan Dokumen</b>\n` +
        `Langsung kirimkan file Word (<code>.doc</code> / <code>.docx</code>) atau PDF (<code>.pdf</code>) ke chat ini.\n\n` +
        `2️⃣ <b>Proses Otomatis</b>\n` +
        `Bot akan otomatis mendeteksi format file dan melakukan konversi:\n` +
        `• Kirim <b>Word</b> ➔ Diubah menjadi <b>PDF</b>\n` +
        `• Kirim <b>PDF</b> ➔ Diubah menjadi <b>Word (.docx)</b>\n\n` +
        `3️⃣ <b>Unduh Hasil</b>\n` +
        `File hasil konversi yang rapi akan langsung dikirimkan kembali ke kamu dalam hitungan detik!\n\n` +
        `📌 <b>Ketentuan:</b>\n` +
        `• Batas ukuran file maksimal <b>20 MB</b>.\n` +
        `• Pastikan file tidak terenkripsi kata sandi (password).\n` +
        `• File sementara langsung dihapus otomatis demi privasi kamu.`;

    ctx.reply(helpText, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔄 Mulai Konversi", callback_data: "new_conversion" }],
            ],
        },
    });
});

bot.command("cancel", async (ctx) => {
    await ctx.reply(
        "❌ <b>Proses dibatalkan.</b>\n\nKirim file kapan saja atau gunakan /start untuk membuka menu.",
        { parse_mode: "HTML" }
    );
});

// ================================
// ACTIONS (INLINE BUTTONS)
// ================================

bot.action("menu_home", async (ctx) => {
    await ctx.answerCbQuery();
    const { text, keyboard } = getMainDashboard(ctx.from.first_name);
    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    }
});

bot.action("menu_word_to_pdf", async (ctx) => {
    await ctx.answerCbQuery();
    const text =
        `📄 <b>MODE: WORD ➔ PDF</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Silakan kirimkan dokumen Word kamu:\n` +
        `• Format didukung: <code>.docx</code>, <code>.doc</code>\n` +
        `• Ukuran maksimal: <b>20 MB</b>\n\n` +
        `💡 <i>Kirimkan file Word langsung sebagai dokumen ke chat ini.</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔙 Kembali ke Menu Utama", callback_data: "menu_home" }],
        ],
    };

    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    }
});

bot.action("menu_pdf_to_word", async (ctx) => {
    await ctx.answerCbQuery();
    const text =
        `📕 <b>MODE: PDF ➔ WORD</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Silakan kirimkan file PDF kamu:\n` +
        `• Format didukung: <code>.pdf</code>\n` +
        `• Ukuran maksimal: <b>20 MB</b>\n\n` +
        `💡 <i>Teks, tabel, dan tata letak dokumen akan diekspor menjadi file Microsoft Word (.docx) yang dapat langsung kamu edit.</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔙 Kembali ke Menu Utama", callback_data: "menu_home" }],
        ],
    };

    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    }
});

bot.action("menu_help", async (ctx) => {
    await ctx.answerCbQuery();
    const text =
        `📖 <b>PANDUAN & BANTUAN</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔹 <b>Cara Mengonversi Dokumen:</b>\n` +
        `1. Tekan tombol lampiran 📎 di Telegram.\n` +
        `2. Pilih file Word (<code>.docx</code>/<code>.doc</code>) atau <code>.pdf</code>.\n` +
        `3. Kirimkan file tersebut ke bot.\n` +
        `4. Tunggu beberapa detik, bot akan mengirimkan file hasil konversinya!\n\n` +
        `🔹 <b>Catatan Penting:</b>\n` +
        `• Batas ukuran per file adalah <b>20 MB</b>.\n` +
        `• Jika file PDF hasil scan/foto, teks mungkin berupa gambar (bukan teks ketik).\n` +
        `• Dokumen yang diproteksi password perlu dibuka kuncinya terlebih dahulu.`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔙 Kembali ke Menu Utama", callback_data: "menu_home" }],
        ],
    };

    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    }
});

bot.action("menu_about", async (ctx) => {
    await ctx.answerCbQuery();
    const text =
        `ℹ️ <b>TENTANG BOT INI</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🤖 <b>Aplikasi:</b> Word ⇄ PDF Converter Bot\n` +
        `⚙️ <b>Engine:</b> LibreOffice Enterprise Core\n` +
        `⚡ <b>Platform:</b> Node.js & Telegraf Framework\n` +
        `🔒 <b>Keamanan & Privasi:</b> Seluruh file sementara langsung dihapus otomatis dari server setelah proses selesai.\n\n` +
        `<i>Dibuat untuk memberikan pengalaman konversi dokumen terbaik langsung di genggamanmu!</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔙 Kembali ke Menu Utama", callback_data: "menu_home" }],
        ],
    };

    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    }
});

bot.action("new_conversion", async (ctx) => {
    await ctx.answerCbQuery();
    const sent = await ctx.reply(
        `📂 <b>Silakan kirimkan dokumen kamu!</b>\n\n` +
        `Kirimkan file <b>Word (.docx, .doc)</b> atau <b>PDF (.pdf)</b> langsung ke chat ini.`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🏠 Menu Utama", callback_data: "menu_home" }],
                ],
            },
        }
    );
    trackMessage(ctx.chat.id, sent.message_id);
});

bot.action("action_reset_chat", async (ctx) => {
    try {
        await ctx.answerCbQuery("Membersihkan chat... 🧹");
    } catch {}
    await clearChatHistory(ctx);
});

// ================================
// MENERIMA DOKUMEN
// ================================

bot.on("document", async (ctx) => {
    let inputPath = null;
    let outputPath = null;
    let statusMsg = null;
    const startTime = Date.now();

    try {
        const document = ctx.message.document;
        const fileName = document.file_name || "dokumen";
        const fileId = document.file_id;
        const fileSize = document.file_size || 0;
        const extension = path.extname(fileName).toLowerCase();

        // 1. Validasi Ukuran File (Maksimal 20 MB)
        const MAX_FILE_SIZE = 20 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
            await ctx.reply(
                `❌ <b>Ukuran File Terlalu Besar!</b>\n\n` +
                `Ukuran file kamu: <b>${formatBytes(fileSize)}</b>\n` +
                `Batas maksimal Telegram Bot: <b>20 MB</b>\n\n` +
                `<i>Silakan kompres atau pilih file yang lebih kecil.</i>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Coba File Lain", callback_data: "new_conversion" }],
                        ],
                    },
                }
            );
            return;
        }

        // 2. Validasi Format
        const isWord = extension === ".doc" || extension === ".docx";
        const isPdf = extension === ".pdf";

        if (!isWord && !isPdf) {
            await ctx.reply(
                `⚠️ <b>Format File Tidak Didukung!</b>\n\n` +
                `File diterima: <code>${escapeHtml(fileName)}</code>\n\n` +
                `Format yang didukung:\n` +
                `├ 📄 <b>Word:</b> <code>.docx</code>, <code>.doc</code>\n` +
                `└ 📕 <b>PDF:</b> <code>.pdf</code>\n\n` +
                `<i>Silakan kirimkan dokumen dengan salah satu format di atas.</i>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Coba Lagi", callback_data: "new_conversion" }],
                        ],
                    },
                }
            );
            return;
        }

        const modeText = isWord ? "📄 Word ➔ 📕 PDF" : "📕 PDF ➔ 📄 Word (.docx)";
        const targetExt = isWord ? "pdf" : "docx";

        // Kirim status card awal (dinamis, akan di-update)
        statusMsg = await ctx.reply(
            `📥 <b>Dokumen Diterima!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📄 <b>Nama:</b> <code>${escapeHtml(fileName)}</code>\n` +
            `📦 <b>Ukuran:</b> <code>${formatBytes(fileSize)}</code>\n` +
            `🔄 <b>Konversi:</b> <b>${modeText}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⏳ <b>Status:</b> <i>Sedang mengunduh file... [1/3]</i>`,
            { parse_mode: "HTML" }
        );

        // Download File
        const fileInfo = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

        inputPath = path.join(TEMP_DIR, `${Date.now()}-${safeFileName}`);
        await downloadFile(fileUrl, inputPath);

        console.log("================================");
        console.log("📥 FILE BERHASIL DIUNDUH");
        console.log("Nama     :", fileName);
        console.log("Ukuran   :", formatBytes(fileSize));
        console.log("Format   :", extension);
        console.log("User     :", ctx.from.first_name, `(@${ctx.from.username || "-"})`);
        console.log("================================");

        // Update status ke proses konversi
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `📥 <b>Dokumen Diterima!</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📄 <b>Nama:</b> <code>${escapeHtml(fileName)}</code>\n` +
                `📦 <b>Ukuran:</b> <code>${formatBytes(fileSize)}</code>\n` +
                `🔄 <b>Konversi:</b> <b>${modeText}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `⚙️ <b>Status:</b> <i>Sedang mengonversi dokumen... [2/3]</i>`,
                { parse_mode: "HTML" }
            );
        } catch {}

        await ctx.sendChatAction("upload_document");

        // Eksekusi Konversi
        if (isWord) {
            outputPath = await wordToPdf(inputPath, OUTPUT_DIR);
        } else {
            outputPath = await pdfToWord(inputPath, OUTPUT_DIR);
        }

        const cleanName = path.basename(fileName, extension);
        const finalOutputPath = path.join(OUTPUT_DIR, `${cleanName}_converted.${targetExt}`);

        if (fs.existsSync(finalOutputPath)) {
            fs.unlinkSync(finalOutputPath);
        }
        fs.renameSync(outputPath, finalOutputPath);
        outputPath = finalOutputPath;

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const outSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;

        console.log(`✅ ${targetExt.toUpperCase()} berhasil dibuat: ${outputPath} (${duration}s)`);

        // Update status sebelum upload
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `📥 <b>Dokumen Diproses!</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📄 <b>Nama:</b> <code>${escapeHtml(fileName)}</code>\n` +
                `📦 <b>Ukuran:</b> <code>${formatBytes(fileSize)}</code>\n` +
                `🔄 <b>Konversi:</b> <b>${modeText}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🚀 <b>Status:</b> <i>Mengirim file hasil... [3/3]</i>`,
                { parse_mode: "HTML" }
            );
        } catch {}

        await ctx.sendChatAction("upload_document");

        // Kirim file hasil dengan caption rapi & tombol interaktif
        const sentDoc = await ctx.replyWithDocument(
            {
                source: outputPath,
                filename: `${cleanName}_converted.${targetExt}`,
            },
            {
                caption:
                    `🎉 <b>Konversi Berhasil!</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📄 <b>Nama:</b> <code>${escapeHtml(cleanName)}_converted.${targetExt}</code>\n` +
                    `📦 <b>Ukuran:</b> <code>${formatBytes(outSize)}</code>\n` +
                    `⏱️ <b>Waktu Proses:</b> <code>${duration} detik</code>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `✨ <i>File kamu siap diunduh dan digunakan!</i>`,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔄 Konversi File Lain", callback_data: "new_conversion" },
                            { text: "🏠 Menu Utama", callback_data: "menu_home" },
                        ],
                        [
                            { text: "🧹 Bersihkan Chat", callback_data: "action_reset_chat" },
                        ],
                    ],
                },
            }
        );
        if (sentDoc) trackMessage(ctx.chat.id, sentDoc.message_id);

        // Hapus pesan status sementara agar chat tetap bersih dan rapi
        if (statusMsg) {
            try {
                await ctx.deleteMessage(statusMsg.message_id);
            } catch {}
        }

        // Hapus file sementara dari disk
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log("🗑️ File sementara dibersihkan.");

    } catch (error) {
        console.error("❌ Error saat konversi:", error);

        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        // Hapus pesan status jika ada
        if (statusMsg) {
            try {
                await ctx.deleteMessage(statusMsg.message_id);
            } catch {}
        }

        const sentErr = await ctx.reply(
            `❌ <b>Gagal Mengonversi Dokumen</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Maaf, terjadi kendala saat memproses dokumen kamu.\n\n` +
            `💡 <b>Tips & Kemungkinan Penyebab:</b>\n` +
            `• Pastikan file tidak rusak (*corrupted*).\n` +
            `• Pastikan file tidak dikunci dengan kata sandi (*password*).\n` +
            `• Periksa kembali format dokumen kamu.\n\n` +
            `<i>Silakan coba kirim ulang dokumen kamu.</i>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔄 Coba Lagi", callback_data: "new_conversion" },
                            { text: "🏠 Menu Utama", callback_data: "menu_home" },
                        ],
                        [
                            { text: "🧹 Bersihkan Chat", callback_data: "action_reset_chat" },
                        ],
                    ],
                },
            }
        );
        if (sentErr) trackMessage(ctx.chat.id, sentErr.message_id);
    }
});

// ================================
// MENERIMA TEKS BIASA
// ================================

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const sent = await ctx.reply(
        `👋 <b>Halo, ${escapeHtml(ctx.from.first_name)}!</b>\n\n` +
        `Saya siap membantu mengonversi dokumen kamu.\n` +
        `Silakan langsung kirimkan file:\n` +
        `• 📄 <b>Word</b> (<code>.doc</code>, <code>.docx</code>)\n` +
        `• 📕 <b>PDF</b> (<code>.pdf</code>)\n\n` +
        `Atau gunakan tombol di bawah:`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Buka Menu Utama", callback_data: "menu_home" }],
                    [{ text: "🧹 Bersihkan Chat", callback_data: "action_reset_chat" }],
                ],
            },
        }
    );
    trackMessage(ctx.chat.id, sent.message_id);
});

// ================================
// ERROR HANDLER
// ================================

bot.catch((error, ctx) => {
    console.error(`Bot error [${ctx.updateType}]:`, error);
});

// ================================
// JALANKAN BOT DENGAN RETRY
// ================================

let isRunning = false;

async function startBot() {
    try {
        const me = await bot.telegram.getMe();
        console.log(`🤖 Bot Telegram @${me.username} berhasil terhubung dan siap melayani!`);
        isRunning = true;
        await bot.launch();
    } catch (error) {
        isRunning = false;
        console.error("⚠️ Gagal terhubung ke Telegram API:", error.message);
        console.log("🔄 Mencoba menghubungkan kembali dalam 5 detik...");
        setTimeout(startBot, 5000);
    }
}

startBot();

// Graceful shutdown
process.once("SIGINT", () => {
    console.log("🛑 Menghentikan bot...");
    if (isRunning) {
        bot.stop("SIGINT");
    }
    process.exit(0);
});

process.once("SIGTERM", () => {
    console.log("🛑 Menghentikan bot...");
    if (isRunning) {
        bot.stop("SIGTERM");
    }
    process.exit(0);
});