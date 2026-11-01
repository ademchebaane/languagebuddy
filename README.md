# LanguageBuddy

A simple Android language-learning app for daily Chinese vocabulary, pinyin, example sentences, mini conversations, quizzes and spaced review.

## Project layout

All app source files are in the project root. There are no nested source folders. The only nested configuration path is `.github/workflows/build-apk.yml`, which GitHub Actions requires for automatic builds. The `android/` and `dist/` folders are generated during the build and are ignored by Git.

## HSK vocabulary version

LanguageBuddy uses the classic HSK 2.0 vocabulary list for Levels 1–5 (about 2,500 cumulative words). The default daily target is 12 new words and can be changed to 10–14. At 12 per day, the list takes about 209 study days; at 10 per day, about 250 days; at 14 per day, about 179 days.

The app downloads the level-specific word lists on first connection and stores them in IndexedDB. After a successful download, the vocabulary can be used offline. A small starter set is bundled so the app can still open if the first download fails.

## Build the APK with GitHub Actions

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root. Keep `.github/workflows/build-apk.yml` in its exact location.
3. Push to the `main` branch, or open **Actions → Build LanguageBuddy APK → Run workflow**.
4. Open the completed workflow run and download the **LanguageBuddy-debug-apk** artifact.
5. Extract the artifact ZIP to get `app-debug.apk`.

The workflow uses Node 22, Java 21 and Android SDK API 36. It generates the native Android project during CI, so you do not need to upload a generated `android/` folder.

## Build locally (optional)

Requirements: Node.js 22+, Java 21 and Android SDK API 36.

```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Features

- Daily vocabulary goal: 10–14 words (default 12)
- HSK 1–5 word bank with simplified/traditional forms, pinyin and English meanings
- Example sentence with characters, pinyin and translation
- Personal sentence-writing practice saved on the device
- Daily mini conversations
- Multiple-choice quizzes
- Spaced review with growing intervals
- Search and HSK level filters
- Offline vocabulary cache after the first successful download
- Progress and streak tracking stored locally; no account or server needed

## Vocabulary data attribution

The vocabulary dataset is from [Complete HSK Vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) by Dr.Kameleon, used under its MIT License. The English definition data is based on CC-CEDICT/MDBG. This app does not claim to be an official HSK product. The generated example sentence templates are for practice and should be treated as learning aids, not official exam examples.

## Troubleshooting

- If the first screen says **Starter mode**, connect to the internet and tap **Try again**. The app needs one successful download to cache the full HSK list.
- If a GitHub Actions build fails, open the failed workflow run and inspect the first red step. Do not rename the `.github/workflows` path.
- Do not commit `node_modules/`, `dist/` or the generated `android/` directory.
