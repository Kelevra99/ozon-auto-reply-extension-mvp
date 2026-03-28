# OZON Auto Reply Extension MVP

MVP-расширение Chrome Manifest V3 для страницы отзывов OZON Seller.

## Что умеет

- хранит `backendBaseUrl`, `apiKey`, `mode` в `chrome.storage.local`
- проверяет соединение через `POST /v1/extension/auth/check`
- находит карточки отзывов на странице OZON
- извлекает данные одного отзыва
- отправляет их в `POST /v1/replies/generate`
- показывает сгенерированный ответ во встроенном preview-блоке
- вставляет ответ в поле OZON
- логирует результат через `POST /v1/replies/result`

## Структура

- `manifest.json`
- `src/background.ts`
- `src/content.ts`
- `src/popup.html`
- `src/popup.ts`
- `src/storage.ts`
- `src/api.ts`
- `src/dom.ts`
- `src/types.ts`

## Установка

```bash
npm install
npm run build
```

После сборки откройте Chrome:

1. `chrome://extensions`
2. включите **Developer mode**
3. нажмите **Load unpacked**
4. выберите папку `dist`

## Как тестировать

1. Убедитесь, что backend работает на `http://localhost:3001`
2. Откройте popup расширения
3. Укажите `backendBaseUrl`, `apiKey`, `mode`
4. Нажмите **Проверить соединение**
5. Откройте страницу отзывов OZON Seller
6. На найденных карточках нажмите **Сгенерировать ответ**
7. Проверьте preview
8. Нажмите **Вставить ответ**

## Важные замечания

- Селекторы и эвристики вынесены в `src/dom.ts`
- OZON может менять DOM, поэтому именно `src/dom.ts` — главный файл для адаптации под реальную верстку
- На MVP нет массовой обработки, очередей и автопубликации
- Если у карточки уже найден ответ продавца, она помечается как пропущенная и повторная генерация не выполняется

## Что, скорее всего, придется донастроить после первой проверки на живой странице OZON

- селекторы карточки отзыва
- селекторы продукта, автора, даты, текста
- селектор поля ответа
- эвристику определения уже существующего ответа продавца



## Что изменено в one-click версии
- Кнопка одна: **Сгенерировать ChatGPT**.
- После нажатия расширение само делает весь цикл: извлечение → generate → вставка → log inserted/failed.
- Для проверки того, что реально ушло на backend, откройте `chrome://extensions` → у расширения `Service worker` → `Inspect views`, затем смотрите Console. Там логируются `request`, `response:ok`, `response:error`.
- На локальном backend это также можно видеть в его собственных логах или через вкладку Network в DevTools service worker.
