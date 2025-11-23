import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const userStates = new Map();

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
  if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
    console.log('Конфликт polling. Переподключение через 5 секунд...');
    setTimeout(() => {
      bot.stopPolling().then(() => {
        bot.startPolling();
      });
    }, 5000);
  }
});

console.log('Бот запущен и готов к работе!');

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1];

  try {
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);

    userStates.set(chatId, {
      imageBuffer: imageBuffer,
      mimeType: 'image/jpeg'
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🇬🇧 Перевести на английский', callback_data: 'translate_en' },
          { text: '🇷🇺 Перевести на русский', callback_data: 'translate_ru' }
        ],
        [
          { text: '📝 Транскрибировать текст', callback_data: 'transcribe' }
        ]
      ]
    };

    await bot.sendMessage(chatId, 'Изображение получено! Что вы хотите сделать?', {
      reply_markup: keyboard
    });

  } catch (error) {
    console.error('Ошибка при обработке изображения:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при обработке изображения. Попробуйте еще раз.');
  }
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;

  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (!imageTypes.includes(document.mime_type)) {
    await bot.sendMessage(chatId, 'Пожалуйста, отправьте изображение (JPG, PNG, GIF или WebP).');
    return;
  }

  try {
    const file = await bot.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);

    userStates.set(chatId, {
      imageBuffer: imageBuffer,
      mimeType: document.mime_type
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🇬🇧 Перевести на английский', callback_data: 'translate_en' },
          { text: '🇷🇺 Перевести на русский', callback_data: 'translate_ru' }
        ],
        [
          { text: '📝 Транскрибировать текст', callback_data: 'transcribe' }
        ]
      ]
    };

    await bot.sendMessage(chatId, 'Изображение получено! Что вы хотите сделать?', {
      reply_markup: keyboard
    });

  } catch (error) {
    console.error('Ошибка при обработке изображения:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при обработке изображения. Попробуйте еще раз.');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  const userState = userStates.get(chatId);

  if (!userState) {
    await bot.answerCallbackQuery(query.id, { text: 'Сначала отправьте изображение!' });
    return;
  }

  try {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'Обрабатываю изображение... ⏳');

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const imagePart = {
      inlineData: {
        data: userState.imageBuffer.toString('base64'),
        mimeType: userState.mimeType
      }
    };

    let prompt = '';

    switch (action) {
      case 'translate_en':
        prompt = 'Translate all text visible in this image to English. If there is no text, just say "No text found in image". Provide only the translation, nothing else.';
        break;

      case 'translate_ru':
        prompt = 'Переведи весь текст, видимый на этом изображении, на русский язык. Если текста нет, просто скажи "Текст на изображении не найден". Предоставь только перевод, ничего больше.';
        break;

      case 'transcribe':
        prompt = 'Extract and transcribe all text visible in this image exactly as it appears. Preserve the original language. If there is no text, say "No text found in image". Provide only the transcribed text.';
        break;

      default:
        await bot.sendMessage(chatId, 'Неизвестное действие.');
        return;
    }

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    await bot.sendMessage(chatId, text);

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🇬🇧 Перевести на английский', callback_data: 'translate_en' },
          { text: '🇷🇺 Перевести на русский', callback_data: 'translate_ru' }
        ],
        [
          { text: '📝 Транскрибировать текст', callback_data: 'transcribe' }
        ]
      ]
    };

    await bot.sendMessage(chatId, 'Хотите выполнить другое действие с этим изображением?', {
      reply_markup: keyboard
    });

  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при обработке запроса. Попробуйте еще раз.');
  }
});

bot.on('message', async (msg) => {
  if (msg.photo || msg.document) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    await bot.sendMessage(
      chatId,
      'Привет! 👋\n\n' +
      'Я бот для работы с изображениями.\n\n' +
      'Просто отправьте мне любое изображение (как фото или файл), и я предложу вам:\n' +
      '🇬🇧 Перевести текст на английский\n' +
      '🇷🇺 Перевести текст на русский\n' +
      '📝 Транскрибировать текст с изображения\n\n' +
      'Давайте начнем! Отправьте мне изображение.'
    );
  } else if (!msg.photo && !msg.document) {
    await bot.sendMessage(chatId, 'Пожалуйста, отправьте мне изображение для обработки (как фото или файл).');
  }
});

// HTTP сервер для Render (чтобы не засыпал)
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'alive',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`HTTP сервер запущен на порту ${PORT}`);
});

// Keep-alive: пингуем сами себя каждые 10 минут
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/health`)
      .then(() => console.log('✓ Keep-alive пинг отправлен'))
      .catch((err) => console.log('✗ Keep-alive пинг не удался:', err.message));
  }, 10 * 60 * 1000); // каждые 10 минут
  console.log('Keep-alive активирован для:', RENDER_URL);
}

process.on('SIGINT', () => {
  console.log('Остановка бота...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Необработанная ошибка:', error);
});
