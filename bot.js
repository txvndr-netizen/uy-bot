require("dotenv").config();
const { Telegraf, session, Scenes, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

const VOLUME_PATH = "/app/database";
let DATA_FILE = path.join(__dirname, "data.json");
if (fs.existsSync(VOLUME_PATH)) {
    DATA_FILE = path.join(VOLUME_PATH, "data.json");
}

if (!fs.existsSync(DATA_FILE)) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            users: [], admins: [], settings: {}, posts: []
        }, null, 2));
    } catch (err) {}
}

function loadData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } 
    catch (e) { return { users: [], admins: [], settings: {}, posts: [] }; }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = "https://uy-bot-production.up.railway.app";

// -------------------------------------------------------------
// SCENES
// -------------------------------------------------------------

// 1. Post qo'shish
const addPostWizard = new Scenes.WizardScene(
    "ADD_POST_WIZARD",
    (ctx) => {
        ctx.reply("Yangi tarix/post qo'shish:\nRasm, Video, Audio yuboring yoki faqat Matn yozing.\n(Bekor qilish uchun '❌ Bekor qilish' bosing)", Markup.keyboard([["❌ Bekor qilish"]]).resize());
        ctx.wizard.state.post = {};
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (ctx.message) {
            if (ctx.message.photo) {
                ctx.wizard.state.post.type = "photo";
                ctx.wizard.state.post.mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            } else if (ctx.message.video) {
                ctx.wizard.state.post.type = "video";
                ctx.wizard.state.post.mediaId = ctx.message.video.file_id;
            } else if (ctx.message.audio || ctx.message.voice) {
                ctx.wizard.state.post.type = "audio";
                ctx.wizard.state.post.mediaId = (ctx.message.audio || ctx.message.voice).file_id;
            } else if (ctx.message.text) {
                ctx.wizard.state.post.type = "text";
                ctx.wizard.state.post.text = ctx.message.text;
                savePostInfo(ctx);
                ctx.reply("Matnli post muvaffaqiyatli saqlandi!", getAdminMenu());
                return ctx.scene.leave();
            } else {
                ctx.reply("Faqat Rasm, Video, Audio yoki Matn yuboring!");
                return;
            }
        }
        
        ctx.reply("Endi ushbu fayl uchun izoh(matn) kiriting (o'tib ketish uchun '-' yuboring):");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (ctx.message && ctx.message.text) {
            const txt = ctx.message.text;
            if (txt !== "-") {
                ctx.wizard.state.post.text = txt;
            }
        }

        savePostInfo(ctx);
        ctx.reply("Post saqlandi!", getAdminMenu());
        return ctx.scene.leave();
    }
);

function savePostInfo(ctx) {
    const data = loadData();
    if (!data.posts) data.posts = [];
    const newPost = {
        id: "post_" + Date.now(),
        type: ctx.wizard.state.post.type,
        mediaId: ctx.wizard.state.post.mediaId || null,
        text: ctx.wizard.state.post.text || "",
        created_at: new Date().toISOString()
    };
    data.posts.push(newPost);
    saveData(data);
}

// 2. Post tahrirlash (EDIT)
const editPostWizard = new Scenes.WizardScene(
    "EDIT_POST_WIZARD",
    (ctx) => {
        ctx.reply("Tahrirlash uchun yangi Matn, Rasm, Video yoki Audio yuboring.\n(Bekor qilish uchun '❌ Bekor qilish' bosing):", Markup.keyboard([["❌ Bekor qilish"]]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        const data = loadData();
        const postIdx = data.posts.findIndex(p => p.id === ctx.session.editPostId);
        if (postIdx === -1) {
            ctx.reply("Xatolik: Post topilmadi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (ctx.message.photo) {
            data.posts[postIdx].type = "photo";
            data.posts[postIdx].mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            data.posts[postIdx].text = ctx.message.caption || "";
        } else if (ctx.message.video) {
            data.posts[postIdx].type = "video";
            data.posts[postIdx].mediaId = ctx.message.video.file_id;
            data.posts[postIdx].text = ctx.message.caption || "";
        } else if (ctx.message.audio || ctx.message.voice) {
            data.posts[postIdx].type = "audio";
            data.posts[postIdx].mediaId = (ctx.message.audio || ctx.message.voice).file_id;
            data.posts[postIdx].text = ctx.message.caption || "";
        } else if (ctx.message.text) {
            // Agar faqat matn yuborilsa, va eski post media bo'lsa - faqat komment (text) o'zgaradi!
            data.posts[postIdx].text = ctx.message.text;
        }

        saveData(data);
        ctx.reply("Muvaffaqiyatli tahrirlandi!", getAdminMenu());
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([ addPostWizard, editPostWizard ]);

bot.use(session());
bot.use(stage.middleware());

// -------------------------------------------------------------
// MENUS
// -------------------------------------------------------------

function getMainMenu(userId = "") {
    let url = WEB_APP_URL + (userId ? "?uid=" + userId : "");
    return Markup.keyboard([
        ["📚 Mening Tarixim / V19"],
        [Markup.button.webApp("🌟 V19 Mini App", url)]
    ]).resize();
}

function getAdminMenu() {
    return Markup.keyboard([
        ["➕ Post qo'shish", "🗑 Post o'chirish"],
        ["✏️ Tahrirlash", "📉 Statistika"],
        ["🔙 Asosiy"]
    ]).resize();
}

function isAdmin(ctx) {
    const superAdmins = ["8473181677"]; 
    if (superAdmins.includes(String(ctx.from.id))) return true;
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    return String(ctx.from.id) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(ctx.from.id)));
}

// -------------------------------------------------------------
// COMMANDS
// -------------------------------------------------------------

bot.start((ctx) => {
    const data = loadData();
    const userExists = data.users.find((u) => u.id === ctx.from.id);
    if (!userExists) {
        data.users.push({
            id: ctx.from.id,
            first_name: ctx.from.first_name || "",
            username: ctx.from.username || "",
            joined_at: new Date().toISOString()
        });
        saveData(data);
    }
    ctx.reply("Assalomu alaykum! V19 Biography Botiga xush kelibsiz. Mening tarixim bilan tanishing yoki Mini App orqali chiroyli dizaynda o'qing.", getMainMenu(ctx.from.id));
});

bot.command("admin", (ctx) => {
    if (isAdmin(ctx)) {
        ctx.reply("Admin paneliga xush kelibsiz (V19)!", getAdminMenu());
    } else {
        ctx.reply("Siz admin emassiz.");
    }
});

bot.hears("🔙 Asosiy", (ctx) => {
    ctx.reply("Asosiy menyuga qaytdik", getMainMenu(ctx.from.id));
});

bot.hears("➕ Post qo'shish", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_POST_WIZARD");
});

bot.hears("📉 Statistika", (ctx) => {
    if (!isAdmin(ctx)) return;
    const data = loadData();
    ctx.reply(`📉 Statistika (V19):\n\n👥 Foydalanuvchilar: ${data.users.length}\n📝 Jami postlar (tarix): ${(data.posts || []).length}`);
});

bot.hears("🗑 Post o'chirish", (ctx) => {
    if (!isAdmin(ctx)) return;
    const data = loadData();
    if (!data.posts || data.posts.length === 0) return ctx.reply("Hozircha postlar yo'q.", getAdminMenu());
    
    let msg = "O'chirish uchun postni tanlang:\n\n";
    const btns = [];
    data.posts.forEach((p, idx) => {
        const title = (p.text || "Fayl").substring(0, 15) + "...";
        msg += `${idx + 1}. [${p.type}] ${title}\n`;
        btns.push(Markup.button.callback(`❌ ${idx + 1}`, `delp_${p.id}`));
    });
    
    ctx.reply(msg, Markup.inlineKeyboard(btns, { columns: 4 }));
});

bot.hears("✏️ Tahrirlash", (ctx) => {
    if (!isAdmin(ctx)) return;
    const data = loadData();
    if (!data.posts || data.posts.length === 0) return ctx.reply("Hozircha postlar yo'q.", getAdminMenu());
    
    let msg = "Tahrirlash uchun postni tanlang:\n\n";
    const btns = [];
    data.posts.forEach((p, idx) => {
        const title = (p.text || "Fayl").substring(0, 15) + "...";
        msg += `${idx + 1}. [${p.type}] ${title}\n`;
        btns.push(Markup.button.callback(`✏️ ${idx + 1}`, `editp_${p.id}`));
    });
    
    ctx.reply(msg, Markup.inlineKeyboard(btns, { columns: 4 }));
});

bot.hears("📚 Mening Tarixim / V19", async (ctx) => {
    const data = loadData();
    if (!data.posts || data.posts.length === 0) return ctx.reply("Hozircha ma'lumotlar kiritilmagan.");
    
    for (const post of data.posts) {
        try {
            if (post.type === "photo" && post.mediaId) {
                await ctx.replyWithPhoto(post.mediaId, { caption: post.text });
            } else if (post.type === "video" && post.mediaId) {
                await ctx.replyWithVideo(post.mediaId, { caption: post.text });
            } else if (post.type === "audio" && post.mediaId) {
                await ctx.replyWithAudio(post.mediaId, { caption: post.text });
            } else {
                await ctx.reply(post.text);
            }
        } catch (e) { console.error("Media jo'natishda xato: ", e); }
    }
});

// Callback Queries
bot.action(/delp_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const postId = ctx.match[1];
    const data = loadData();
    if (data.posts) {
        data.posts = data.posts.filter(p => p.id !== postId);
        saveData(data);
        await ctx.editMessageText("Muvaffaqiyatli o'chirildi! Qolganlar ro'yxati yangilandi.");
    }
});

bot.action(/editp_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session ??= {};
    ctx.session.editPostId = ctx.match[1];
    ctx.scene.enter("EDIT_POST_WIZARD");
});

bot.launch().then(() => {
    console.log("V19 Biography Bot is running!");
}).catch(err => console.error(err));

// -------------------------------------------------------------
// EXPRESS SERVER (Mini App API)
// -------------------------------------------------------------
const express = require("express");
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/posts", (req, res) => {
    const data = loadData();
    res.json({ posts: data.posts || [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`V19 Mini App server port: ${PORT}`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));