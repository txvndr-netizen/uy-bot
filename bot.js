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
                ["🖼 App Rasmi(URL)", "🔘 App Tugma Yozuvi"],
                ["🤖 Bot Username", "📞 Telefon Raqam"],
                ["📍 App Manzili", "❌ Bekor qilish"]
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
            ctx.reply("Yangi username kiriting (masalan @admin). O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else if (text === "📞 Telefon Raqam") {
            ctx.wizard.state.editType = "phone";
            ctx.reply("Yangi telefon raqam kiriting (masalan +998901234567). O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else if (text === "🖼 App Rasmi(URL)") {
            ctx.wizard.state.editType = "app_image";
            ctx.reply("Mini App dagi uy rasmining URL manzilini kiriting (https://...jpg). O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else if (text === "🔘 App Tugma Yozuvi") {
            ctx.wizard.state.editType = "app_button_text";
            ctx.reply("Mini App dagi tugmacha yozuvini kiriting. O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else if (text === "📍 App Manzili") {
            ctx.wizard.state.editType = "app_address";
            ctx.reply("Mini App pastida chiqadigan manzilni kiriting. O'chirish uchun '0' deb yozing:", Markup.removeKeyboard());
            return ctx.wizard.next();
        } else {
            ctx.reply("Iltimos, tugmalardan birini tanlang.");
            return;
        }
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        let val = ctx.message.text;
        if (val === '0') val = ""; // o'chirish uchun

        const data = loadData();
        if (!data.settings) data.settings = {};
        data.settings[ctx.wizard.state.editType] = val;
        saveData(data);

        ctx.reply("Muvaqqiyatli o'zgartirildi/saqlandi!", getAdminMenu());
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
        
        ctx.reply("Zo'r! Endi shu tugma bosilganda qanday matn (javob) qaytarishini yozing (karta raqami, manzil, karta egasi hkz):");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === "❌ Bekor qilish") {
            ctx.reply("Bekor qilindi.", getAdminMenu());
            return ctx.scene.leave();
        }
        if (!ctx.message || !ctx.message.text) return;
        
        const data = loadData();
        if (!data.customButtons) data.customButtons = [];
        data.customButtons.push({
            id: "btn_" + Date.now(),
            title: ctx.wizard.state.btnTitle,
            text: ctx.message.text
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
    
    let keyboard = [
        ["📋 Xizmatlar", "💰 E'lonlar"],
        ["🛒 Buyurtma", "📞 Bog'lanish"]
    ];

    const data = loadData();
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

// Tugmalar ishlashi
bot.hears("📋 Xizmatlar", (ctx) => {
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

bot.hears("💰 E'lonlar", async (ctx) => {
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

bot.hears("🛒 Buyurtma", (ctx) => {
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
            return ctx.reply(customBtn.text, getMainMenu(ctx.from.id));
        }
    }

    if (msg.includes("uy") || msg.includes("kvartira") || msg.includes("narx") || msg.includes("sotaman") || msg.includes("olaman") || msg.includes("ijara") || msg.includes("hovli") || msg.includes("uchastka") || msg.includes("dom") || msg.includes("sotib")) {
        
        if (msg.includes("sotaman") || msg.includes("ijaraga beraman")) {
            return ctx.reply("Siz uyingizni sotmoqchi yoki ijaraga bermoqchimisiz? Unda 📞 Bog'lanish menyusiga o'tib, to'g'ridan-to'g'ri menedjer bilan aloqaga chiqing va obyektingiz rasmlarini yuboring.", getMainMenu(ctx.from.id));
        }
        
        return ctx.reply("Sizga mos uylarni topish yoki ijaraga olish bo'yicha eng zo'r takliflarni ko'rish uchun 🏠 Mini Appni oching yoki 💰 E'lonlar tugmasini bosing!", getMainMenu(ctx.from.id));
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
    const adminEnv = process.env.ADMIN_CHAT_ID;
    const isAdm = String(userId) === String(adminEnv) || (data.admins && data.admins.includes(parseInt(userId, 10)));
    res.json({ isAdmin: isAdm });
});

// E'lon qo'shish (App ichidan)
app.post("/api/prices", (req, res) => {
    const { userId, text, type, customImgUrl } = req.body;
    const data = loadData();
    const adminEnv = process.env.ADMIN_CHAT_ID;
    const isAdm = String(userId) === String(adminEnv) || (data.admins && data.admins.includes(parseInt(userId, 10)));
    
    if (!isAdm) return res.status(403).json({ error: "Unauthorized" });

    const newObj = {
        id: Date.now(),
        type: type || "photo",
        text: text || "",
        mediaId: "", // Appdan yuklanganda asosan link ishlatamiz
        customImgUrl: customImgUrl || "" 
    };

    data.prices.unshift(newObj); // Yangisini eng boshiga qo'shish
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