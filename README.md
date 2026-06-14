# Lingo — AI Conversation Translator

Talk with someone who speaks a different language. Lingo uses GPT to automatically detect which language was spoken, translate it naturally, and speak the result aloud — no manual prompts needed.

**Default language pair: English ↔ Spanish** (change anytime — 50+ languages including Thai)

## Features

- **Auto language detection** — speak in either language; GPT figures out which one
- **One microphone** — tap to start, tap again when done; no need to pick a side
- **Whisper transcription** — works with Thai, Arabic, Chinese, and many more
- **Natural translation** — casual tone, grammar fixes, conversational phrasing
- **Voice output** — hear translations spoken aloud (toggle on/off)
- **Text input** — type instead of speaking if you prefer

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your OpenAI API key

```bash
cp .env.example .env
```

Edit `.env` and set your key:

```
OPENAI_API_KEY=sk-your-actual-key-here
```

Get a key at [platform.openai.com](https://platform.openai.com/api-keys).

### 3. Run the app

```bash
npm run dev
```

Open **http://localhost:5180** in Chrome or Edge (best speech recognition support).

## How to use

1. Select your two languages at the top (e.g. English + Thai)
2. Tap the **big microphone** and speak in **either** language
3. Tap again when you're done speaking
4. Lingo transcribes, detects the language, improves your message, and translates
5. The translation is shown and spoken aloud (disable in footer if needed)

You can also type a message in either language and press Send.

## Production

```bash
npm run build
npm start
```

Serves the built app at http://localhost:3001

## Tech stack

- **Frontend**: Vite, vanilla JS, Web Speech API (STT + TTS)
- **Backend**: Express + OpenAI GPT-4o-mini
- **Translation**: Structured JSON responses with auto language detection

## Cost note

Each message uses one GPT API call (~few hundred tokens). GPT-4o-mini is very affordable for casual conversation use.
