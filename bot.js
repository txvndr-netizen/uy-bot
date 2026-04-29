require("dotenv").config();
const { Telegraf, session, Scenes, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const VOLUME_PATH = "/app/database";
let DATA_FILE = path.join(__dirname, "data.json");
let UPLOADS_DIR = path.join(__dirname, "public", "uploads");

if (fs.existsSync(VOLUME_PATH)) {
    DATA_FILE = path.join(VOLUME_PATH, "data.json");
    UPLOADS_DIR = path.join(VOLUME_PATH, "uploads");
}

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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

function isUserAdmin(userId, data) {
    if (!userId) return false;
    const superAdmins = ["8473181677"];
    if (superAdmins.includes(String(userId))) return true;
    const adminEnv = process.env.ADMIN_CHAT_ID;
    if (adminEnv && String(userId) === String(adminEnv)) return true;
    return !!(data.admins && data.admins.some(a => String(a) === String(userId)));
}

// -------------------------------------------------------------
// MENUS
// -------------------------------------------------------------

function getMainMenu(userId = "") {
    let url = WEB_APP_URL + "?v=" + Date.now();
    if (userId) url += "&uid=" + userId;
    return Markup.keyboard([
        [Markup.button.webApp("🌟 Mini Appni Ochish", url)]
    ]).resize();
}

function getAdminMenu() {
    return Markup.keyboard([
        ["📊 Statistika"],
        ["🔙 Asosiy"]
    ]).resize();
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
    ctx.reply("Assalomu alaykum! platformamga xush kelibsiz. Arxiv va postlarni o'qish uchun Mini App ga kiring.", getMainMenu(ctx.from.id));
});

bot.command("admin", (ctx) => {
    const data = loadData();
    if (isUserAdmin(ctx.from.id, data)) {
        ctx.reply("Admin paneliga xush kelibsiz!\nHozir barcha postlar bevosita Mini App ichidan qo'shiladi va boshqariladi.", getAdminMenu());
    } else {
        ctx.reply("Siz admin emassiz.");
    }
});

bot.hears("🔙 Asosiy", (ctx) => {
    ctx.reply("Asosiy menyuga qaytdik", getMainMenu(ctx.from.id));
});

bot.hears("📊 Statistika", (ctx) => {
    const data = loadData();
    if (!isUserAdmin(ctx.from.id, data)) return;
    ctx.reply(`📊 Statistika:\n\n👥 Foydalanuvchilar: ${data.users.length}\n📝 Jami postlar: ${(data.posts || []).length}`);
});


bot.launch().then(() => {
    console.log("Bot is running!");
}).catch(err => console.error(err));

// -------------------------------------------------------------
// EXPRESS SERVER (Mini App API with Native Multer)
// -------------------------------------------------------------
const app = express();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, "public")));
// Ommaviy papka (Uploads) ni static qilish
app.use('/uploads', express.static(UPLOADS_DIR));

app.post("/api/check-admin", (req, res) => {
    try {
        const { userId } = req.body;
        const data = loadData();
        res.json({ isAdmin: isUserAdmin(userId, data) });
    } catch (err) {
        res.json({ isAdmin: false });
    }
});

app.get("/api/posts", (req, res) => {
    const data = loadData();
    res.json({ posts: data.posts || [] });
});

// Post Qo'shish Form-Data orqali (Media fayllar)
app.post("/api/posts", upload.single('media'), (req, res) => {
    const { userId, text } = req.body;
    const data = loadData();
    
    if (!isUserAdmin(userId, data)) {
        return res.status(403).json({ error: "Siz admin emassiz!" });
    }

    let mediaUrl = "";
    if (req.file) {
        mediaUrl = "/uploads/" + req.file.filename;
    }

    const newObj = {
        id: "post_" + Date.now(),
        text: text || "",
        mediaUrl: mediaUrl,
        created_at: new Date().toISOString()
    };
    
    try {
        if (!data.posts) data.posts = [];
        data.posts.unshift(newObj);
        saveData(data);
        res.json({ success: true, item: newObj });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Post O'chirish
app.delete("/api/posts/:id", (req, res) => {
    try {
        const data = loadData();
        const post = data.posts.find(p => String(p.id) === String(req.params.id));
        
        if (post && post.mediaUrl) {
            // Faylni o'chirib tashlash (joy eklash)
            const filePath = path.join(UPLOADS_DIR, path.basename(post.mediaUrl));
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        data.posts = data.posts.filter(p => String(p.id) !== String(req.params.id));
        saveData(data);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reaksiya (Stiker) bosish
app.post("/api/posts/:id/react", (req, res) => {
    try {
        const { type } = req.body;
        const data = loadData();
        const post = data.posts.find(p => String(p.id) === String(req.params.id));
        
        if (post) {
            if (!post.reactions) post.reactions = { like: 0, dove: 0, banana: 0 };
            if (['like', 'dove', 'banana'].includes(type)) {
                post.reactions[type] = (post.reactions[type] || 0) + 1;
            }
            saveData(data);
            res.json({ success: true, reactions: post.reactions });
        } else {
            res.status(404).json({ error: "Post topilmadi" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Mini App server port: ${PORT}`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));