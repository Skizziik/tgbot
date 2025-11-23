import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const userStates = new Map();

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
  if (msg.photo) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    await bot.sendMessage(
      chatId,
      'Привет! 👋\n\n' +
      'Я бот для работы с изображениями.\n\n' +
      'Просто отправьте мне любое изображение, и я предложу вам:\n' +
      '🇬🇧 Перевести текст на английский\n' +
      '🇷🇺 Перевести текст на русский\n' +
      '📝 Транскрибировать текст с изображения\n\n' +
      'Давайте начнем! Отправьте мне изображение.'
    );
  } else if (!msg.photo) {
    await bot.sendMessage(chatId, 'Пожалуйста, отправьте мне изображение для обработки.');
  }
});

process.on('SIGINT', () => {
  console.log('Остановка бота...');
  bot.stopPolling();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Необработанная ошибка:', error);
});
