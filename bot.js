require("dotenv").config();
const { Telegraf, session, Scenes, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (e) {
        return {
            users: [],
            orders: [],
            admins: [],
            settings: {},
            prices: [],
            services: []
        };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Test uchun localhost.
// Telegram qoidasi: Mini App URL manzili faqat `https://` bilan boshlanishi MUSTAHKAM talab qilinadi.
// Hozir bot xato bermasligi uchun vaqtinchalik namuna link qo'yib turamiz:
https://github.com/txvndr-netizen/uy-bot.git

// -------------------------------------------------------------
// SCENES (Sahnapar)
// -------------------------------------------------------------

// 1. Order Scene
const orderWizard = new Scenes.WizardScene(
    "ORDER_WIZARD",
    (ctx) => {
        ctx.wizard.state.order = {};
        ctx.reply("Ismingiz nima?", Markup.removeKeyboard());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        if (!ctx.wizard.state.order) {
            ctx.wizard.state.order = {};
        }

        ctx.wizard.state.order.name = ctx.message.text;

        ctx.reply(
            "Telefon raqamingizni kiriting:",
            Markup.keyboard([
                [Markup.button.contactRequest("📱 Raqamni yuborish")]
            ])
                .resize()
                .oneTime()
        );

        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.wizard.state.order) {
            ctx.wizard.state.order = {};
        }

        if (ctx.message && ctx.message.contact) {
            ctx.wizard.state.order.phone = ctx.message.contact.phone_number;
        } else if (ctx.message && ctx.message.text) {
            ctx.wizard.state.order.phone = ctx.message.text;
        } else {
            ctx.reply("Iltimos, telefon raqamingizni yuboring.");
            return;
        }

        const data = loadData();
        const services = data.services.map((s) => [s.name]);

        if (services.length === 0) {
            ctx.reply("Hozircha xizmatlar qo'shilmagan. Admin bilan bog'laning.", getMainMenu());
            return ctx.scene.leave();
        }

        ctx.reply("Qaysi xizmat kerak?", Markup.keyboard(services).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        if (!ctx.wizard.state.order) {
            ctx.wizard.state.order = {};
        }

        ctx.wizard.state.order.service = ctx.message.text;

        const data = loadData();
        const order = {
            id: Date.now(),
            name: ctx.wizard.state.order.name || "",
            phone: ctx.wizard.state.order.phone || "",
            service: ctx.wizard.state.order.service || "",
            user_id: ctx.from.id,
            created_at: new Date().toISOString()
        };

        data.orders.push(order);
        saveData(data);

        await ctx.reply(
            "Yaxshi! Buyurtmangiz qabul qilindi! Tez orada aloqaga chiqamiz.",
            getMainMenu()
        );

        const adminMsg =
            `🆕 Yangi buyurtma!\n\n` +
            `👤 Ism: ${order.name}\n` +
            `📞 Raqam: ${order.phone}\n` +
            `🛠 Xizmat: ${order.service}\n` +
            `🆔 User: <a href="tg://user?id=${order.user_id}">${ctx.from.first_name || "Foydalanuvchi"}</a>`;

        if (process.env.ADMIN_CHAT_ID) {
            try {
                await bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, adminMsg, {
                    parse_mode: "HTML"
                });
            } catch (e) { }
        }

        for (const adminId of data.admins) {
            if (String(adminId) !== String(process.env.ADMIN_CHAT_ID)) {
                try {
                    await bot.telegram.sendMessage(adminId, adminMsg, {
                        parse_mode: "HTML"
                    });
                } catch (e) { }
            }
        }

        return ctx.scene.leave();
    }
);

// 2. Admin: Narx qo'shish sahnasi
const addPriceWizard = new Scenes.WizardScene(
    "ADD_PRICE_WIZARD",
    (ctx) => {
        ctx.reply(
            "Rasm yoki videoni yuboring (Yoki '❌ Bekor qilish' tugmasini bosing):",
            Markup.keyboard([["❌ Bekor qilish"]]).resize()
        );
        ctx.wizard.state.priceObj = {};
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (ctx.message && ctx.message.photo) {
            ctx.wizard.state.priceObj.type = "photo";
            ctx.wizard.state.priceObj.mediaId =
                ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (ctx.message && ctx.message.video) {
            ctx.wizard.state.priceObj.type = "video";
            ctx.wizard.state.priceObj.mediaId = ctx.message.video.file_id;
        } else {
            ctx.reply("Iltimos, faqat rasm yoki video yuboring.");
            return;
        }

        ctx.reply(
            "Endi ma'lumotni kiriting (Masalan:\nNarxi: 50.000 so'm\nManzil: Toshkent\nTel: +99890...):"
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;

        ctx.wizard.state.priceObj.text = ctx.message.text;
        ctx.wizard.state.priceObj.id = Date.now();

        const data = loadData();
        data.prices.push(ctx.wizard.state.priceObj);
        saveData(data);

        ctx.reply("Narx muvaffaqiyatli saqlandi!", getAdminMenu());
        return ctx.scene.leave();
    }
);

// 3. Admin: Sozlamalarni o'zgartirish
const editSettingsWizard = new Scenes.WizardScene(
    "EDIT_SETTINGS_WIZARD",
    (ctx) => {
        ctx.reply(
            "Nimani o'zgartirmoqchisiz?",
            Markup.keyboard([
                ["Telergam Username", "Telefon raqam"],
                ["❌ Bekor qilish"]
            ]).resize()
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (!ctx.message || !ctx.message.text) return;

        if (ctx.message.text === "Telergam Username") {
            ctx.wizard.state.editType = "telegram";
            ctx.reply("Yangi username kiriting (masalan @admin):", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else if (ctx.message.text === "Telefon raqam") {
            ctx.wizard.state.editType = "phone";
            ctx.reply(
                "Yangi telefon raqam kiriting (masalan +998901234567):",
                Markup.removeKeyboard()
            );
            return ctx.wizard.next();
        } else {
            ctx.reply("Iltimos, tugmalardan birini tanlang.");
            return;
        }
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        const data = loadData();
        data.settings[ctx.wizard.state.editType] = ctx.message.text;
        saveData(data);

        ctx.reply("Muvaqqiyatli o'zgartirildi!", getAdminMenu());
        return ctx.scene.leave();
    }
);

// 4. Admin: Admin qo'shish
const addAdminWizard = new Scenes.WizardScene(
    "ADD_ADMIN_WIZARD",
    (ctx) => {
        ctx.reply(
            "Yangi adminning Telegram ID raqamini yuboring (Masalan, 123456789):",
            Markup.keyboard([["❌ Bekor qilish"]]).resize()
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }

        if (!ctx.message || !ctx.message.text) return;

        const targetId = parseInt(ctx.message.text, 10);
        if (isNaN(targetId)) {
            ctx.reply("Iltimos faqat ID raqam kiriting.");
            return;
        }

        const data = loadData();
        if (!data.admins.includes(targetId)) {
            data.admins.push(targetId);
            saveData(data);
            ctx.reply("Admin muvaffaqiyatli qo'shildi!", getAdminMenu());
        } else {
            ctx.reply("Bu admin avval qo'shilgan.", getAdminMenu());
        }

        return ctx.scene.leave();
    }
);

// 5. Admin: Xizmat qo'shish
const addServiceWizard = new Scenes.WizardScene(
    "ADD_SERVICE_WIZARD",
    (ctx) => {
        ctx.reply(
            "Yangi xizmat nomini kiriting (Masalan: 'Ijaraga uy') yoki '❌ Bekor qilish' tugmasini bosing:",
            Markup.keyboard([["❌ Bekor qilish"]]).resize()
        );
        ctx.wizard.state.serviceObj = {};
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;

        ctx.wizard.state.serviceObj.name = ctx.message.text;
        ctx.wizard.state.serviceObj.id = "service_" + Date.now();

        ctx.reply(
            `Endi "${ctx.message.text}" uchun batafsil ma'lumot kiriting (Masalan, qanday uylar, imkoniyatlari):`
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Amal bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;

        ctx.wizard.state.serviceObj.desc = ctx.message.text;

        const data = loadData();
        data.services.push(ctx.wizard.state.serviceObj);
        saveData(data);

        ctx.reply("Yangi xizmat muvaffaqiyatli qo'shildi!", getAdminMenu());
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([
    orderWizard,
    addPriceWizard,
    editSettingsWizard,
    addAdminWizard,
    addServiceWizard
]);

bot.use(session());
bot.use(stage.middleware());

// -------------------------------------------------------------
// MENUS (Menyular)
// -------------------------------------------------------------

function getMainMenu() {
    return Markup.keyboard([
        ["📋 Xizmatlarimiz", "💰 Narxlar"],
        ["🛒 Buyurtma berish"],
        ["📞 Bog'lanish", "🏠 Mini App ochish"]
    ]).resize();
}

function getAdminMenu() {
    return Markup.keyboard([
        ["📊 Statistika", "➕ Narx qo'shish"],
        ["⚙️ Sozlamalar", "👮 Admin qo'shish"],
        ["➕ Xizmat qo'shish", "🔙 Asosiy Menyu"]
    ]).resize();
}

function isAdmin(ctx) {
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    return String(ctx.from.id) === String(adminEnv) || data.admins.includes(ctx.from.id);
}

// -------------------------------------------------------------
// COMMANDS & ACTIONS
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

    ctx.reply(
        "Assalomu alaykum! Botimizga xush kelibsiz. Quyidagi menyudan kerakli bo'limni tanlang:",
        getMainMenu()
    );
});

bot.command("admin", (ctx) => {
    if (isAdmin(ctx)) {
        ctx.reply("Admin paneliga xush kelibsiz!", getAdminMenu());
    } else {
        ctx.reply("Kechirasiz, siz admin emassiz.");
    }
});

// Tugmalar ishlashi
bot.hears("📋 Xizmatlarimiz", (ctx) => {
    const data = loadData();

    if (!data.services.length) {
        return ctx.reply("Hali xizmatlar qo'shilmagan.");
    }

    const btns = data.services.map((s) => [
        Markup.button.callback(s.name, `service_${s.id}`)
    ]);

    ctx.reply(
        "Quyidagi xizmatlarimiz mavjud. Batafsil ma'lumot olish uchun ustini bosing:",
        Markup.inlineKeyboard(btns)
    );
});

bot.hears("💰 Narxlar", async (ctx) => {
    const data = loadData();

    if (data.prices.length === 0) {
        return ctx.reply("Hali narxlar qo'shilmagan.");
    }

    for (const price of data.prices) {
        const inlineKbd = Markup.inlineKeyboard([
            [Markup.button.callback("🛒 Buyurtma berish", "start_order")]
        ]);

        if (price.type === "photo") {
            await ctx.replyWithPhoto(price.mediaId, {
                caption: price.text,
                ...inlineKbd
            });
        } else if (price.type === "video") {
            await ctx.replyWithVideo(price.mediaId, {
                caption: price.text,
                ...inlineKbd
            });
        }
    }
});

bot.hears("🛒 Buyurtma berish", (ctx) => {
    ctx.scene.enter("ORDER_WIZARD");
});

bot.hears("📞 Bog'lanish", (ctx) => {
    const data = loadData();
    const tg = data.settings.telegram || "@admin";
    const phone = data.settings.phone || "+998901234567";

    ctx.reply(
        `📞 Biz bilan bog'lanish:\n\n` +
        `📱 Telegram: ${tg}\n` +
        `📞 Telefon: ${phone}\n` +
        `🕒 Ish vaqti: 09:00 — 24:00`
    );
});

bot.hears("🏠 Mini App ochish", (ctx) => {
    ctx.reply(
        "Mini app ochish uchun tugmani bosing:",
        Markup.inlineKeyboard([
            [Markup.button.webApp("Ochish", WEB_APP_URL)]
        ])
    );
});

// Admin menyusi ichidagi tugmalar
bot.hears("🔙 Asosiy Menyu", (ctx) => {
    ctx.reply("Asosiy menyuga qaytdik", getMainMenu());
});

bot.hears("📊 Statistika", (ctx) => {
    if (!isAdmin(ctx)) return;

    const data = loadData();
    ctx.reply(
        `📊 Statistika:\n\n` +
        `👥 Foydalanuvchilar: ${data.users.length}\n` +
        `🛒 Jami buyurtmalar: ${data.orders.length}`
    );
});

bot.hears("➕ Narx qo'shish", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_PRICE_WIZARD");
});

bot.hears("⚙️ Sozlamalar", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("EDIT_SETTINGS_WIZARD");
});

bot.hears("👮 Admin qo'shish", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_ADMIN_WIZARD");
});

bot.hears("➕ Xizmat qo'shish", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_SERVICE_WIZARD");
});

// Inline tugmalar bosilishi
bot.action(/service_(.+)/, async (ctx) => {
    const serviceId = ctx.match[1];
    const data = loadData();
    const service = data.services.find((s) => String(s.id) === String(serviceId));

    if (service) {
        await ctx.reply(
            `🔹 ${service.name}\n\n${service.desc}`,
            Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Buyurtma berish", "start_order")]
            ])
        );
    }

    await ctx.answerCbQuery();
});

bot.action("start_order", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.scene.enter("ORDER_WIZARD");
});

bot.launch();
console.log("Bot muvaffaqiyatli ishga tushdi / Bot is running!");

// -------------------------------------------------------------
// EXPRESS SERVER (Mini App HTML uchun)
// -------------------------------------------------------------
const express = require("express");
const app = express();

// "public" papkasidagi html fayllarni serverga yuklash
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mini app serveri http://localhost:${PORT} da ishlamoqda.`);
});

// Enable graceful stop
process.once("SIGINT", () => {
    bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
});