# Telegram Sotuv Manager Bot

Ushbu bot ko'chmas mulk (xonadonlar va kvartiralar) sotuvi bo'yicha mijozlarga xizmat ko'rsatish, narxlarni ko'rsatish va buyurtmalarni qabul qilish uchun mo'ljallangan. Barcha ma'lumotlar `data.json` faylida saqlanadi.

## Xususiyatlari:
- **Xizmatlarimiz:** Xizmatlar turlari va ular haqida ma'lumot beradi.
- **Narxlar:** Admin tomonidan kiritilgan rasm/video va izohli narxlar ro'yxati.
- **Buyurtma berish:** Bosqichma-bosqich ism, raqam va xizmat turini so'rab buyurtma oluvchi aqlli tizim.
- **Bog'lanish:** Adminning qabul vaqti va kontaktlari.
- **Admin panel:** (`/admin` orqali ishlaydi)
  - Statistika ko'rish
  - Narx qo'shish (rasm/video bilan)
  - Sozlamalarni (@username va telefon) o'zgartirish
  - Yangi admin qo'shish

## Qanday ishga tushiriladi?

### 1-qadam. Kutubxonalarni o'rnatish
Agar npm o'rnatilmagan bo'lsa:
```bash
npm install
```

### 2-qadam. Sozlamalar (`.env`)
Loyihaga `.env` fayl yarating (yoki mavjud `.env` faylni tahrirlang) va quyidagilarni kiriting:
```ini
BOT_TOKEN=123456789:ABCDE_fgh...
ADMIN_CHAT_ID=1234567890
```
- `BOT_TOKEN`: @BotFather orqali olgan tokeningiz.
- `ADMIN_CHAT_ID`: O'zingizning Telegram ID raqamingiz. Bot shunga asosan sizga `/admin` huquqini beradi.

### 3-qadam. Botni yoqish
```bash
node bot.js
```
Konsolda `Bot muvaffaqiyatli ishga tushdi` yozuvi chiqqach bemalol telergamga o'tib `/start` ni bosishingiz mumkin.
