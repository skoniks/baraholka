import 'dotenv/config';
import { readFileSync } from 'fs';
import {
  Bot,
  Context,
  InlineKeyboard,
  InputMediaBuilder,
  Keyboard,
  session,
  SessionFlavor,
} from 'grammy';

interface SessionData {
  purpose?: string;
  price?: number;
  name?: string;
  tags: string[];
  imgs: string[];
}

type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(process.env.TOKEN || '');

const initial = (): SessionData => ({ tags: [], imgs: [] });

const tags = readFileSync('./tags-list.txt', { encoding: 'utf8' })
  .split('\n')
  .filter((tag) => tag.trim());

const defaultKeyboard = new Keyboard()
  .text('Новое объявление')
  .text('Опубликовать')
  .resized();

const tagKeyboard = (ctx: MyContext) => {
  const keyboard = new InlineKeyboard();
  for (let i = 1; i <= tags.length; i++) {
    const tag = tags[i - 1];
    const use = ctx.session.tags.includes(tag);
    const text = `${use ? '✅' : '☑️'} ${tag}`;
    keyboard.text(text, `tag:${tag}`);
    if (i % 3 === 0) keyboard.row();
  }
  return keyboard;
};

async function bootstrap() {
  bot.use(session({ initial }));
  bot.command('start', start);
  bot.command('create', create);
  bot.command('publish', publish);
  bot.hears('Новое объявление', create);
  bot.hears('Опубликовать', publish);
  bot.on('message', async (ctx) => {
    if (!ctx.session.purpose) {
      return handle(ctx);
    } else if (!ctx.session.price) {
      const price = parseInt(ctx.message.text ?? '');
      if (isNaN(price) || price < 1)
        return ctx.reply('Необходимо ввести положительное число', {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      ctx.session.price = price;
      return handle(ctx);
    } else {
      const name = ctx.message.text || ctx.message.caption;
      if (name) ctx.session.name = name;
      if (ctx.message.photo) {
        if (ctx.session.imgs.length >= 10)
          return ctx.reply('Вы не можете добавить больше изображений', {
            reply_parameters: { message_id: ctx.message.message_id },
          });
        const file = await ctx.getFile();
        ctx.session.imgs.push(file.file_id);
      }
      return ctx.reply('Информация обновлена', {
        reply_parameters: { message_id: ctx.message.message_id },
        reply_markup: defaultKeyboard,
      });
    }
  });
  bot.callbackQuery(/purpose:(.*)/, async (ctx) => {
    ctx.session.purpose = ctx.match[1];
    const free = ['ОтдамБесплатно', 'ПростоCпросить'];
    if (free.includes(ctx.session.purpose)) ctx.session.price = -1;
    else ctx.session.price = 0;
    await ctx.answerCallbackQuery({});
    return handle(ctx);
  });
  bot.callbackQuery(/tag:(.*)/, async (ctx) => {
    const tag = ctx.match[1];
    if (ctx.session.tags.includes(tag)) {
      const index = ctx.session.tags.indexOf(tag);
      ctx.session.tags.splice(index, 1);
    } else ctx.session.tags.push(tag);
    await ctx.answerCallbackQuery({});
    await ctx.editMessageReplyMarkup({
      reply_markup: tagKeyboard(ctx),
    });
  });
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать диалог' },
    { command: 'create', description: 'Новое объявление' },
    { command: 'publish', description: 'Опубликовать' },
  ]);
  bot.catch(console.error);
  await bot.start();
}

async function start(ctx: MyContext) {
  return ctx.reply(
    'Приветствуем в барахолке Discovery!\nТут можно написать много текста, правила итд...',
    { reply_markup: defaultKeyboard },
  );
}

async function create(ctx: MyContext) {
  ctx.session = initial();
  return handle(ctx);
}

async function handle(ctx: MyContext) {
  if (!ctx.session.purpose) {
    const keyboard = new InlineKeyboard()
      .text('Куплю / Продам', 'purpose:КуплюПродам')
      .text('Отдам бесплатно', 'purpose:ОтдамБесплатно')
      .row()
      .text('Сдам / Сниму', 'purpose:СдамСниму')
      .text('Просто спросить', 'purpose:ПростоCпросить');
    return ctx.reply('Укажите цель объявления', { reply_markup: keyboard });
  } else if (!ctx.session.price) {
    return ctx.reply('Назовите свою цену (число) в рублях');
  } else {
    return ctx.reply(
      'Пришлите описание объявления, приложите изображения (если есть) и укажите теги из списка ниже:',
      { reply_markup: tagKeyboard(ctx) },
    );
  }
}

async function publish(ctx: MyContext) {
  if (!ctx.session.purpose || !ctx.session.price || !ctx.session.name)
    return handle(ctx);
  let text = ctx.session.name;
  const tags = ctx.session.tags.map((tag) => `#${tag}`);
  if (tags.length) text += `\n\n${tags.join(' ')}`;
  text += `\n\n#${ctx.session.purpose}`;
  if (ctx.session.price > 0) {
    const num = new Intl.NumberFormat('ru-RU', { style: 'decimal' }) //
      .format(ctx.session.price);
    text += ` за *${num} ₽*`;
  }
  const user = [
    ctx.message?.from.first_name ?? '',
    ctx.message?.from.last_name ?? '',
  ].join(' ');
  text += `\n\n[${user}](tg://user?id=${ctx.message?.from.id})`;
  const media = ctx.session.imgs.map((id) =>
    InputMediaBuilder.photo(id, { caption: text, parse_mode: 'Markdown' }),
  );
  const channel = process.env.CHANNEL || '';
  if (media.length) await ctx.api.sendMediaGroup(channel, media);
  else await ctx.api.sendMessage(channel, text, { parse_mode: 'Markdown' });
  await ctx.reply('Объявление опубликовано!');
  ctx.session = initial();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(0);
});
