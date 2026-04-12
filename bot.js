require("dotenv").config();
const { Telegraf, session, Scenes, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

// Ma'lumotlarni saqlash manzili (Railway Volume uchun)
const VOLUME_PATH = "/app/database";
let DATA_FILE = path.join(__dirname, "data.json");

if (fs.existsSync(VOLUME_PATH)) {
    DATA_FILE = path.join(VOLUME_PATH, "data.json");
} else {
    // Agar lokalda ishlayotgan bo'lsak va data.json yo'q bo'lsa, yaratib qo'yamiz
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            users: [], orders: [], admins: [], settings: {}, prices: [], services: [], customButtons: []
        }, null, 2));
    }
}

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
const WEB_APP_URL = "https://uy-bot-production.up.railway.app";

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
            ctx.reply("Hozircha xizmatlar qo'shilmagan. Admin bilan bog'laning.", getMainMenu(ctx.from.id));
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
            getMainMenu(ctx.from.id)
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
                ["🖼 App Rasmi", "🔘 App Tugmasi"],
                ["🤖 Bot Username", "📞 Tel Raqam"],
                ["🎛 Bot T- Xizmatlar", "🎛 Bot T- E'lonlar"],
                ["🎛 Bot T- Buyurtma", "🎛 Bot T- Bog'lanish"],
                ["📍 Manzil", "❌ Bekor qilish"]
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

        const text = ctx.message.text;

        if (text === "🤖 Bot Username") {
            ctx.wizard.state.editType = "telegram";
            ctx.reply("Yangi username kiriting (masalan @admin). O'chirish (yashirish) uchun '0' deb yozing:", Markup.removeKeyboard());
        } else if (text === "📞 Tel Raqam") {
            ctx.wizard.state.editType = "phone";
            ctx.reply("Yangi telefon raqam kiriting. O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
        } else if (text === "🖼 App Rasmi") {
            ctx.wizard.state.editType = "app_image";
            ctx.reply("Mini App dagi uy rasmining URL manzilini kiriting (https://...jpg). O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
        } else if (text === "🔘 App Tugmasi") {
            ctx.wizard.state.editType = "app_button_text";
            ctx.reply("Mini App dagi tugmacha yozuvini kiriting. O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
        } else if (text === "📍 Manzil") {
            ctx.wizard.state.editType = "app_address";
            ctx.reply("Mini App pastida chiqadigan manzilni kiriting. O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
        } else if (text === "🎛 Bot T- Xizmatlar") {
            ctx.wizard.state.editType = "btnServicesTitle";
            ctx.reply("Botdagi 'Xizmatlar' tugmasi uchun yangi nom yozing (Masalan: 📋 Barcha xizmatlar). Bu tugmani butunlay O'CHIRISH (yashirish) uchun '0' ni yuboring:", Markup.removeKeyboard());
        } else if (text === "🎛 Bot T- E'lonlar") {
            ctx.wizard.state.editType = "btnPricesTitle";
            ctx.reply("Botdagi 'E'lonlar' tugmasi uchun yangi nom yozing (Masalan: 🏡 Uylar). Butunlay O'CHIRISH uchun '0' ni yuboring:", Markup.removeKeyboard());
        } else if (text === "🎛 Bot T- Buyurtma") {
            ctx.wizard.state.editType = "btnOrderTitle";
            ctx.reply("Botdagi 'Buyurtma' tugmasiga yangi nom yozing. Butunlay O'CHIRISH uchun '0' ni yuboring:", Markup.removeKeyboard());
        } else if (text === "🎛 Bot T- Bog'lanish") {
            ctx.wizard.state.editType = "btnContactTitle";
            ctx.reply("Botdagi 'Bog'lanish' tugmasiga yangi nom yozing. Butunlay O'CHIRISH uchun '0' ni yuboring:", Markup.removeKeyboard());
        } else {
            ctx.reply("Iltimos, tugmalardan birini tanlang.");
            return;
        }
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        let val = ctx.message.text === "0" ? "hide" : ctx.message.text;

        const data = loadData();
        if (!data.settings) data.settings = {};
        data.settings[ctx.wizard.state.editType] = val;
        saveData(data);

        ctx.reply("Muvaqqiyatli o'zgartirildi/saqlandi! Asosiy menyudagi o'zgarishni ko'rish uchun /start ni bosing.", getAdminMenu());
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

const addCustomBtnWizard = new Scenes.WizardScene(
    "ADD_CUSTOM_BTN_WIZARD",
    (ctx) => {
        ctx.reply("Yangi tugma uchun qisqa nom kiriting (masalan: 💳 Karta raqam)\nYoki '❌ Bekor qilish' ni bosing:", Markup.keyboard([["❌ Bekor qilish"]]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;
        ctx.wizard.state.btnTitle = ctx.message.text;
        
        ctx.reply("Zo'r! Endi qo'shmoqchi bo'lganotingiz maxsus ma'lumotni shu botga yuboring.\nMasalan: Matn yozishingiz mumkin, yoki Rasm yuborib tagiga matn (karta raqam, manzil hkz) yozishingiz mumkin:");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        
        let mediaId = null;
        let text = ctx.message.text || ctx.message.caption || "";

        if (ctx.message && ctx.message.photo) {
            // Eng katta / sifatli rasmni olish
            mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        }

        if (!text && !mediaId) {
            ctx.reply("Iltimos, rasm yoki matn kiriting.");
            return;
        }
        
        const data = loadData();
        if (!data.customButtons) data.customButtons = [];
        data.customButtons.push({
            id: "btn_" + Date.now(),
            title: ctx.wizard.state.btnTitle,
            text: text,
            mediaId: mediaId
        });
        saveData(data);
        
        ctx.reply(`"${ctx.wizard.state.btnTitle}" maxsus tugmasi muvaffaqiyatli qo'shildi! Asosiy menyuda ko'rinadi.`, getAdminMenu());
        return ctx.scene.leave();
    }
);

const rmCustomBtnWizard = new Scenes.WizardScene(
    "RM_CUSTOM_BTN_WIZARD",
    (ctx) => {
        const data = loadData();
        if (!data.customButtons || data.customButtons.length === 0) {
            ctx.reply("Hozircha hech qanday maxsus tugma yo'q.", getAdminMenu());
            return ctx.scene.leave();
        }
        const btns = data.customButtons.map(b => [Markup.button.callback(b.title, `delbtn_${b.id}`)]);
        ctx.reply("O'chirish uchun quyidagilardan birini tanlang:", Markup.inlineKeyboard(btns));
        return ctx.scene.leave();
    }
);

const rmAdminWizard = new Scenes.WizardScene(
    "RM_ADMIN_WIZARD",
    (ctx) => {
        const data = loadData();
        if (!data.admins || data.admins.length === 0) {
            ctx.reply("Hech qanday qo'shimcha admin yo'q.", getAdminMenu());
            return ctx.scene.leave();
        }
        let txt = "Botdagi qo'shimcha adminlar ID si:\n";
        data.admins.forEach(a => { txt += `- ${a}\n`; });
        ctx.reply(txt + "\nO'chirmoqchi bo'lganingizni ID sini yozib yuboring (Yoki '❌ Bekor qilish' bosing):", Markup.keyboard([["❌ Bekor qilish"]]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;

        const toRm = parseInt(ctx.message.text, 10);
        const data = loadData();
        const initialLen = data.admins.length;
        data.admins = data.admins.filter(a => a !== toRm);
        if (data.admins.length < initialLen) {
            saveData(data);
            ctx.reply("Admin muvaffaqiyatli o'chirildi!", getAdminMenu());
        } else {
            ctx.reply("Bunday ID topilmadi.", getAdminMenu());
        }
        return ctx.scene.leave();
    }
);


const stage = new Scenes.Stage([
    orderWizard,
    addPriceWizard,
    editSettingsWizard,
    addAdminWizard,
    addServiceWizard,
    addCustomBtnWizard,
    rmCustomBtnWizard,
    rmAdminWizard
]);

bot.use(session());
bot.use(stage.middleware());

// -------------------------------------------------------------
// MENUS (Menyular)
// -------------------------------------------------------------

function getMainMenu(userId = "") {
    let url = WEB_APP_URL;
    if (userId) url += "?uid=" + userId;
    
    const data = loadData();
    const sets = data.settings || {};
    
    const btnSrv = sets.btnServicesTitle || "hide";
    const btnPrc = sets.btnPricesTitle || "hide";
    const btnOrd = sets.btnOrderTitle || "hide";
    const btnCnt = sets.btnContactTitle || "📞 Bog'lanish";

    let defaultRow1 = [];
    if (btnSrv !== "hide" && btnSrv !== "") defaultRow1.push(btnSrv);
    if (btnPrc !== "hide" && btnPrc !== "") defaultRow1.push(btnPrc);

    let defaultRow2 = [];
    if (btnOrd !== "hide" && btnOrd !== "") defaultRow2.push(btnOrd);
    if (btnCnt !== "hide" && btnCnt !== "") defaultRow2.push(btnCnt);

    let keyboard = [];
    if (defaultRow1.length > 0) keyboard.push(defaultRow1);
    if (defaultRow2.length > 0) keyboard.push(defaultRow2);

    if (data.customButtons && data.customButtons.length > 0) {
        let row = [];
        data.customButtons.forEach(b => {
            row.push(b.title);
            if (row.length === 2) {
                keyboard.push(row);
                row = [];
            }
        });
        if (row.length > 0) keyboard.push(row);
    }
    
    keyboard.push([Markup.button.webApp("🏠 Mini App", url)]);
    return Markup.keyboard(keyboard).resize();
}

function getAdminMenu() {
    return Markup.keyboard([
        ["📊 Statistika", "⚙️ Sozlamalari"],
        ["👮 Admin +", "👮 Admin -"],
        ["⌨️ Tugma +", "⌨️ Tugma -"],
        ["➕ E'lon (Bot)", "🔙 Asosiy"]
    ]).resize();
}

function isAdmin(ctx) {
    const superAdmins = ["8473181677"]; // Hardcoded Super Admin
    if (superAdmins.includes(String(ctx.from.id))) return true;
    
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    return String(ctx.from.id) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(ctx.from.id)));
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
        getMainMenu(ctx.from.id)
    );
});

bot.command("admin", (ctx) => {
    if (isAdmin(ctx)) {
        ctx.reply("Admin paneliga xush kelibsiz!", getAdminMenu());
    } else {
        ctx.reply("Kechirasiz, siz admin emassiz.");
    }
});

// Asosiy menyu amallari endi bot.on('text') ichiga kochirildi.


bot.hears("🏠 Mini App", (ctx) => {
    ctx.reply(
        "Mini App ni ochish uchun pastdagi klaviaturadagi (qatorlardagi) 🏠 Mini App tugmasini bosing!",
        Markup.inlineKeyboard([
            [Markup.button.webApp("Ochish", WEB_APP_URL + "?uid=" + ctx.from.id)]
        ])
    );
});

// Admin menyusi ichidagi tugmalar
bot.hears("🔙 Asosiy", (ctx) => {
    ctx.reply("Asosiy menyuga qaytdik", getMainMenu(ctx.from.id));
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

bot.hears("➕ E'lon (Bot)", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_PRICE_WIZARD");
});

bot.hears("⚙️ Sozlamalari", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("EDIT_SETTINGS_WIZARD");
});

bot.hears("👮 Admin +", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_ADMIN_WIZARD");
});

bot.hears("👮 Admin -", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("RM_ADMIN_WIZARD");
});

bot.hears("⌨️ Tugma +", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("ADD_CUSTOM_BTN_WIZARD");
});

bot.hears("⌨️ Tugma -", (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.scene.enter("RM_CUSTOM_BTN_WIZARD");
});

// Inline tugmalar bosilishi
bot.action(/delbtn_(.+)/, async (ctx) => {
    const btnId = ctx.match[1];
    const data = loadData();
    if (data.customButtons) {
        data.customButtons = data.customButtons.filter(b => b.id !== btnId);
        saveData(data);
        await ctx.answerCbQuery("O'chirildi!");
        await ctx.editMessageText("Tugma muvaffaqiyatli o'chirildi. Asosiy menyu ro'yxati yangilandi.");
    }
});

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

bot.on("web_app_data", async (ctx) => {
    try {
        const rawData = ctx.message.web_app_data.data;
        const parsed = JSON.parse(rawData);

        if (parsed.type === "webapp_order") {
            const data = loadData();
            
            const order = {
                id: Date.now(),
                name: parsed.clientName || "",
                phone: parsed.clientPhone || "",
                service: `${parsed.item} (${parsed.price})`,
                user_id: ctx.from.id,
                created_at: new Date().toISOString()
            };

            data.orders.push(order);
            saveData(data);

            await ctx.reply(
                "🎉 Tabriklaymiz! Buyurtmangiz qabul qilindi. Tez orada mutaxassislarimiz tashkil qilish uchun aloqaga chiqishadi.",
                getMainMenu(ctx.from.id)
            );

            // Adminga xabar yuborish
            const adminMsg = 
                `🔥 <b>Mini-App dan Yangi Buyurtma!</b>\n\n` +
                `👤 Mijoz: ${order.name}\n` +
                `📞 Raqam: ${order.phone}\n` +
                `🛠 Tanladi: ${order.service}\n` +
                `🆔 Litsenziya(User): <a href="tg://user?id=${order.user_id}">${ctx.from.first_name || "Foydalanuvchi"}</a>`;
            
            if (process.env.ADMIN_CHAT_ID) {
                try {
                    await bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, adminMsg, { parse_mode: "HTML" });
                } catch (e) {}
            }

            for (const adminId of data.admins) {
                if (String(adminId) !== String(process.env.ADMIN_CHAT_ID)) {
                    try {
                        await bot.telegram.sendMessage(adminId, adminMsg, { parse_mode: "HTML" });
                    } catch (e) {}
                }
            }
        } else if (parsed.type === "order") {
             // Eski versiya orqaga qarab yozilgan funksiya qolishi uchun... 
        }
    } catch(e) {
        console.error("Web app data parse error: ", e);
    }
});

bot.on("text", (ctx) => {
    const msgTextOriginal = ctx.message.text;
    const msg = msgTextOriginal.toLowerCase();
    
    // Asosiy menyu tugmalari emasligini tekshiramiz
    if (msg.startsWith("/")) return;

    // Dinamik maxsus tugmalar
    const data = loadData();
    if (data.customButtons) {
        const customBtn = data.customButtons.find(b => b.title === msgTextOriginal);
        if (customBtn) {
            if (customBtn.mediaId) {
                return ctx.replyWithPhoto(customBtn.mediaId, { caption: customBtn.text, ...getMainMenu(ctx.from.id) }).catch(()=>{});
            } else {
                return ctx.reply(customBtn.text, getMainMenu(ctx.from.id));
            }
        }
    }

    // Dinamik asosiy menyu tugmalari
    const sets = data.settings || {};
    const btnSrv = sets.btnServicesTitle || "📋 Xizmatlar";
    const btnPrc = sets.btnPricesTitle || "💰 E'lonlar";
    const btnOrd = sets.btnOrderTitle || "🛒 Buyurtma";
    const btnCnt = sets.btnContactTitle || "📞 Bog'lanish";

    if (msgTextOriginal === btnSrv && btnSrv !== "hide") {
        if (!data.services || !data.services.length) return ctx.reply("Hali xizmatlar qo'shilmagan.");
        const btns = data.services.map((s) => [Markup.button.callback(s.name, `service_${s.id}`)]);
        return ctx.reply("Quyidagi xizmatlarimiz mavjud. Batafsil ma'lumot olish uchun ustini bosing:", Markup.inlineKeyboard(btns));
    }
    
    if (msgTextOriginal === btnPrc && btnPrc !== "hide") {
        if (!data.prices || data.prices.length === 0) return ctx.reply("Hali narxlar qo'shilmagan.");
        for (const price of data.prices) {
            const inlineKbd = Markup.inlineKeyboard([[Markup.button.callback("🛒 Buyurtma berish", "start_order")]]);
            if (price.type === "photo" && price.mediaId) {
                ctx.replyWithPhoto(price.mediaId, { caption: price.text, ...inlineKbd }).catch(()=>{});
            } else if (price.type === "video" && price.mediaId) {
                ctx.replyWithVideo(price.mediaId, { caption: price.text, ...inlineKbd }).catch(()=>{});
            } else {
                ctx.reply(price.text, inlineKbd).catch(()=>{});
            }
        }
        return;
    }
    
    if (msgTextOriginal === btnOrd && btnOrd !== "hide") {
        return ctx.scene.enter("ORDER_WIZARD");
    }
    
    if (msgTextOriginal === btnCnt && btnCnt !== "hide") {
        const tg = sets.telegram || "@admin";
        const phone = sets.phone || "+998901234567";
        return ctx.reply(`📞 Biz bilan bog'lanish:\n\n📱 Telegram: ${tg}\n📞 Telefon: ${phone}\n🕒 Ish vaqti: 09:00 — 24:00`);
    }

    if (msg.includes("uy") || msg.includes("kvartira") || msg.includes("narx") || msg.includes("sotaman") || msg.includes("olaman") || msg.includes("ijara") || msg.includes("hovli") || msg.includes("uchastka") || msg.includes("dom") || msg.includes("sotib")) {
        
        if (msg.includes("sotaman") || msg.includes("ijaraga beraman")) {
            return ctx.reply("Siz uyingizni sotmoqchi yoki ijaraga bermoqchimisiz? Unda 📞 Bog'lanish menyusiga o'tib, to'g'ridan-to'g'ri menedjer bilan aloqaga chiqing va obyektingiz rasmlarini yuboring.", getMainMenu(ctx.from.id));
        }
        
        return ctx.reply("Sizga mos uylarni topish yoki ijaraga olish bo'yicha eng zo'r takliflarni ko'rish uchun 🏠 Mini Appni oching!", getMainMenu(ctx.from.id));
    }

    // Tushunilmagan boshqa matnlar uchrashsa
    ctx.reply("Sizga qanday yordam bera olaman? Biz bilan ishonchli uy oling yoki soting! Menga uylar haqida nima so'ramoqchi bo'lsangiz yozing yoki tugmalardan foydalaning.", getMainMenu(ctx.from.id));
});

bot.launch().then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi / Bot is running!");
}).catch(err => {
    console.error("Botni ishga tushirishda xato yuz berdi:", err);
});

// -------------------------------------------------------------
// EXPRESS SERVER (Mini App HTML uchun)
// -------------------------------------------------------------
const express = require("express");
const app = express();

app.use(express.json({ limit: '10mb' })); // POST tana(body) o'qish uchun limitni oshirish (rasmlar uchun)

// "public" papkasidagi html fayllarni serverga yuklash
app.use(express.static(path.join(__dirname, "public")));

// Mini App dasturiga ma'lumot jo'natish uchun API
app.get("/api/data", (req, res) => {
    const data = loadData();
    res.json({
        prices: data.prices || [],
        services: data.services || [],
        settings: data.settings || {}
    });
});

// Adminni tekshirish API
app.post("/api/check-admin", (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.json({ isAdmin: false });
    
    const data = loadData();
    const superAdmins = ["8473181677"];
    const adminEnv = process.env.ADMIN_CHAT_ID;
    const isAdm = superAdmins.includes(String(userId)) || String(userId) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(userId)));
    res.json({ isAdmin: isAdm });
});

// E'lon qo'shish (App ichidan)
app.post("/api/prices", (req, res) => {
    const { userId, text, type, customImgUrl, category } = req.body;
    const data = loadData();
    const superAdmins = ["8473181677"];
    const isAdm = superAdmins.includes(String(userId)) || String(userId) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(userId)));
    
    if (!isAdm) return res.status(403).json({ error: "Unauthorized" });

    // Hozirgi kunda WebApp asosan 'url' formatidan foydalanadi
    const newObj = {
        id: "prc_" + Date.now(),
        text: text,
        type: type, // "url" yoki "photo"
        mediaId: customImgUrl,
        category: category || "Barchasi",
        isSold: false
    };
    
    if (!data.prices) data.prices = [];
    data.prices.unshift(newObj);
    saveData(data);
    res.json({ success: true, item: newObj });
});

// E'lonni o'chirish (App ichidan)
app.delete("/api/prices/:id", (req, res) => {
    const data = loadData();
    data.prices = data.prices.filter(p => String(p.id) !== String(req.params.id));
    saveData(data);
    res.json({ success: true });
});

// E'lonni yangilash (asosan Sotildi maqomini berish uchun)
app.put("/api/prices/:id", (req, res) => {
    const { isSold } = req.body;
    const data = loadData();
    const item = data.prices.find(p => String(p.id) === String(req.params.id));
    if (item) {
        item.isSold = isSold;
        saveData(data);
    }
    res.json({ success: true });
});

// Barcha statistika va sozlamalarni APP orqali berish
app.post("/api/stats", (req, res) => {
    const { userId } = req.body;
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    const isAdm = String(userId) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(userId)));
    
    if (!isAdm) return res.status(403).json({ error: "Unauthorized" });

    res.json({
        success: true,
        usersCount: data.users ? data.users.length : 0,
        orders: data.orders || []
    });
});

app.post("/api/settings", (req, res) => {
    const { userId, phone, address } = req.body;
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    const isAdm = String(userId) === String(adminEnv) || (data.admins && data.admins.some(a => String(a) === String(userId)));
    
    if (!isAdm) return res.status(403).json({ error: "Unauthorized" });

    if (!data.settings) data.settings = {};
    if (phone !== undefined) data.settings.app_phone = phone;
    if (address !== undefined) data.settings.app_address = address;
    saveData(data);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Mini app serveri ${PORT} portida (0.0.0.0) ishlamoqda.`);
});

// Enable graceful stop
process.once("SIGINT", () => {
    bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
});