(() => {
  'use strict';

  const DATA_BASE = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/old';
  const TODAY = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const main = $('#mainContent');
  const modalRoot = $('#modalRoot');
  const toastEl = $('#toast');
  const SEED = Array.isArray(window.LANGUAGE_BUDDY_SEED) ? window.LANGUAGE_BUDDY_SEED : [];

  const defaultState = () => ({
    dailyTarget: 12,
    startDate: TODAY(),
    batchDate: '',
    batchStart: 0,
    batchEnd: 0,
    nextIndex: 0,
    review: {},
    phrases: {},
    streak: 0,
    lastStudyDate: '',
    activeTab: 'today',
    fullListLoaded: false
  });

  let state = loadState();
  let words = SEED.slice();
  let fullDataReady = false;
  let activeLevel = 0;
  let searchTerm = '';
  let reviewIndex = 0;
  let quiz = null;
  let toastTimer = null;
  let modalWord = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem('languagebuddy-state') || '{}');
      return { ...defaultState(), ...saved, review: saved.review || {}, phrases: saved.phrases || {} };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem('languagebuddy-state', JSON.stringify(state)); } catch (_) { showToast('Could not save progress on this device.'); }
    updateHeader();
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }

  function normalizeEntry(entry, level) {
    const forms = Array.isArray(entry.f) ? entry.f : (Array.isArray(entry.forms) ? entry.forms : []);
    const usable = forms.filter(form => form && (form.i?.y || form.transcriptions?.pinyin));
    const chosen = usable.find(form => (form.m || form.meanings || []).some(text => !/^\s*(variant of|see also)\b/i.test(text))) || usable[0] || {};
    const info = chosen.i || chosen.transcriptions || {};
    const rawMeanings = chosen.m || chosen.meanings || [];
    const meanings = rawMeanings.filter(text => !/^\s*(variant of|see also)\b/i.test(text));
    const word = entry.s || entry.simplified || '';
    if (!word) return null;
    return {
      id: `${level}-${word}`,
      word,
      traditional: chosen.t || chosen.traditional || word,
      pinyin: String(info.y || info.pinyin || '').replace(/\s+/g, ' ').trim(),
      meaning: meanings.slice(0, 4).join('; ') || 'Meaning not available',
      pos: entry.p || entry.pos || [],
      level,
      frequency: Number(entry.q || entry.frequency || 999999),
      classifiers: chosen.c || chosen.classifiers || []
    };
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const request = indexedDB.open('LanguageBuddyDB', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database open failed'));
    });
  }

  async function readCache() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('cache', 'readonly').objectStore('cache').get('hsk2-level-1-to-5');
      request.onsuccess = () => { db.close(); resolve(request.result || null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async function writeCache(data) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('cache', 'readwrite');
      transaction.objectStore('cache').put(data, 'hsk2-level-1-to-5');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  }

  async function fetchLevel(level) {
    const response = await fetch(`${DATA_BASE}/${level}.min.json`, { cache:'no-cache' });
    if (!response.ok) throw new Error(`HSK ${level} list returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error(`HSK ${level} list has an unexpected format`);
    return data.map(entry => normalizeEntry(entry, level)).filter(Boolean);
  }

  function activateFullList(data) {
    words = data;
    fullDataReady = true;
    if (!state.fullListLoaded) {
      state.nextIndex = 0;
      state.batchStart = 0;
      state.batchEnd = 0;
      state.batchDate = '';
      state.fullListLoaded = true;
      saveState();
    }
  }

  async function loadVocabulary() {
    try {
      const cached = await readCache();
      if (Array.isArray(cached) && cached.length >= 2400) {
        activateFullList(cached);
        return;
      }
    } catch (_) { /* A missing cache is normal on first launch. */ }

    try {
      const levels = await Promise.all([1, 2, 3, 4, 5].map(fetchLevel));
      const combined = levels.flat();
      const unique = new Map();
      combined.forEach(word => { if (!unique.has(word.word)) unique.set(word.word, word); });
      const complete = [...unique.values()].sort((a, b) => a.level - b.level || a.frequency - b.frequency || a.word.localeCompare(b.word, 'zh-CN'));
      if (complete.length < 2400) throw new Error(`Only ${complete.length} words were received`);
      activateFullList(complete);
      try { await writeCache(complete); } catch (_) { /* The current session still works without caching. */ }
    } catch (error) {
      console.warn('HSK list download failed; using starter list.', error);
      fullDataReady = false;
    }
  }

  function todayBatch() {
    if (state.batchDate !== TODAY()) {
      state.batchStart = Math.min(state.nextIndex, words.length);
      state.batchEnd = Math.min(state.batchStart + Number(state.dailyTarget || 12), words.length);
      state.nextIndex = state.batchEnd;
      state.batchDate = TODAY();
      saveState();
    }
    return words.slice(state.batchStart, state.batchEnd);
  }

  function getWord(id) { return words.find(word => word.id === id) || null; }
  function isLearned(id) { return Boolean(state.review[id]); }
  function meaningShort(word) { return (word.meaning || '').split(';')[0].trim(); }
  function safeMeaning(word) { return escapeHTML(meaningShort(word)); }
  function isDue(record) { return record && record.due && record.due <= TODAY(); }

  function markActivity() {
    const today = TODAY();
    if (state.lastStudyDate !== today) {
      const yesterday = addDays(today, -1);
      state.streak = state.lastStudyDate === yesterday ? (state.streak || 0) + 1 : 1;
      state.lastStudyDate = today;
    }
    saveState();
  }

  function markLearned(word) {
    if (!word) return;
    if (!state.review[word.id]) {
      state.review[word.id] = { stage:0, due:addDays(TODAY(), 1), last: TODAY() };
    }
    markActivity();
    render();
    showToast('Added to your review plan. Nice work!');
  }

  function addDays(dateString, days) {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function reviewWords() {
    return words.filter(word => isDue(state.review[word.id]));
  }

  function updateHeader() {
    const count = $('#streakCount');
    if (count) count.textContent = String(state.streak || 0);
    const dot = $('#reviewDot');
    if (dot) dot.classList.toggle('hidden', reviewWords().length === 0);
  }

  function formatDate() {
    return new Intl.DateTimeFormat(undefined, { weekday:'long', month:'long', day:'numeric' }).format(new Date());
  }

  const CONVERSATIONS = [
    { title:'Meeting someone', lines:[['A','你好！','Nǐ hǎo!','Hello!'],['B','你好！你叫什么名字？','Nǐ hǎo! Nǐ jiào shénme míngzi?','Hi! What is your name?'],['A','我叫安娜。','Wǒ jiào Ānnà.','My name is Anna.'],['B','很高兴认识你。','Hěn gāoxìng rènshi nǐ.','Nice to meet you.']] },
    { title:'At a café', lines:[['A','你想喝什么？','Nǐ xiǎng hē shénme?','What would you like to drink?'],['B','我想喝一杯茶。','Wǒ xiǎng hē yì bēi chá.','I would like a cup of tea.'],['A','好的，请等一下。','Hǎo de, qǐng děng yíxià.','All right, please wait a moment.']] },
    { title:'At school', lines:[['A','你今天有课吗？','Nǐ jīntiān yǒu kè ma?','Do you have class today?'],['B','有，九点开始。','Yǒu, jiǔ diǎn kāishǐ.','Yes, it starts at nine.'],['A','我们一起去吧。','Wǒmen yìqǐ qù ba.','Let us go together.']] },
    { title:'Making plans', lines:[['A','你明天有时间吗？','Nǐ míngtiān yǒu shíjiān ma?','Are you free tomorrow?'],['B','下午有时间。','Xiàwǔ yǒu shíjiān.','I am free in the afternoon.'],['A','我们去看电影吧。','Wǒmen qù kàn diànyǐng ba.','Let us go see a movie.']] },
    { title:'Asking the way', lines:[['A','请问，学校在哪儿？','Qǐngwèn, xuéxiào zài nǎr?','Excuse me, where is the school?'],['B','在前面。','Zài qiánmiàn.','It is up ahead.'],['A','谢谢你！','Xièxie nǐ!','Thank you!']] },
    { title:'Shopping', lines:[['A','这个多少钱？','Zhège duōshao qián?','How much is this?'],['B','三十块。','Sānshí kuài.','Thirty yuan.'],['A','好，我买一个。','Hǎo, wǒ mǎi yí ge.','Okay, I will buy one.']] },
    { title:'Talking about family', lines:[['A','你家有几个人？','Nǐ jiā yǒu jǐ ge rén?','How many people are in your family?'],['B','我家有四个人。','Wǒ jiā yǒu sì ge rén.','There are four people in my family.'],['A','你有兄弟姐妹吗？','Nǐ yǒu xiōngdì jiěmèi ma?','Do you have brothers or sisters?']] }
  ];

  const CUSTOM_EXAMPLES = {
    '我':[['我是学生。','Wǒ shì xuésheng.','I am a student.']],
    '你':[['你好吗？','Nǐ hǎo ma?','How are you?']],
    '他':[['他是我的朋友。','Tā shì wǒ de péngyou.','He is my friend.']],
    '她':[['她是我的老师。','Tā shì wǒ de lǎoshī.','She is my teacher.']],
    '是':[['我是学生。','Wǒ shì xuésheng.','I am a student.']],
    '不':[['我不喝咖啡。','Wǒ bù hē kāfēi.','I do not drink coffee.']],
    '有':[['我有一本书。','Wǒ yǒu yì běn shū.','I have a book.']],
    '在':[['我在家。','Wǒ zài jiā.','I am at home.']],
    '这':[['这是我的书。','Zhè shì wǒ de shū.','This is my book.']],
    '那':[['那是学校。','Nà shì xuéxiào.','That is the school.']],
    '好':[['今天很好。','Jīntiān hěn hǎo.','Today is very good.']],
    '人':[['那个人是我的老师。','Nà ge rén shì wǒ de lǎoshī.','That person is my teacher.']],
    '学生':[['我是学生。','Wǒ shì xuésheng.','I am a student.']],
    '老师':[['老师在教室。','Lǎoshī zài jiàoshì.','The teacher is in the classroom.']],
    '学校':[['我每天去学校。','Wǒ měitiān qù xuéxiào.','I go to school every day.']],
    '学习':[['我每天学习中文。','Wǒ měitiān xuéxí Zhōngwén.','I study Chinese every day.']],
    '中国':[['我想去中国。','Wǒ xiǎng qù Zhōngguó.','I want to go to China.']],
    '中文':[['我喜欢学习中文。','Wǒ xǐhuan xuéxí Zhōngwén.','I like studying Chinese.']],
    '喜欢':[['我喜欢喝茶。','Wǒ xǐhuan hē chá.','I like drinking tea.']],
    '吃':[['我们一起吃饭。','Wǒmen yìqǐ chīfàn.','Let us eat together.']],
    '喝':[['我每天喝水。','Wǒ měitiān hē shuǐ.','I drink water every day.']],
    '看':[['我晚上看书。','Wǒ wǎnshang kàn shū.','I read books in the evening.']],
    '去':[['我明天去学校。','Wǒ míngtiān qù xuéxiào.','I am going to school tomorrow.']],
    '来':[['你什么时候来？','Nǐ shénme shíhou lái?','When are you coming?']],
    '水':[['请给我一杯水。','Qǐng gěi wǒ yì bēi shuǐ.','Please give me a glass of water.']],
    '茶':[['我想喝一杯茶。','Wǒ xiǎng hē yì bēi chá.','I would like a cup of tea.']],
    '家':[['我家在这里。','Wǒ jiā zài zhèlǐ.','My home is here.']],
    '朋友':[['他是我的好朋友。','Tā shì wǒ de hǎo péngyou.','He is my good friend.']],
    '今天':[['今天天气很好。','Jīntiān tiānqì hěn hǎo.','The weather is very nice today.']],
    '明天':[['明天我们一起学习。','Míngtiān wǒmen yìqǐ xuéxí.','Tomorrow we will study together.']]
  };

  function generatedExample(word) {
    const pos = word.pos || [];
    const pinyin = word.pinyin || '...';
    const meaning = meaningShort(word);
    if (pos.some(tag => ['n','ns','nr','nz','nt'].includes(tag))) {
      return [`我喜欢${word.word}。`, `Wǒ xǐhuan ${pinyin}.`, `I like ${meaning}.`];
    }
    if (pos.includes('a') || pos.includes('an')) {
      return [`这个地方很${word.word}。`, `Zhège dìfang hěn ${pinyin}.`, `This place is very ${meaning}.`];
    }
    if (pos.includes('v') || pos.includes('vn')) {
      const action = meaning.replace(/^to\s+/i, '').split(';')[0];
      return [`我会${word.word}。`, `Wǒ huì ${pinyin}.`, `I can ${action}.`];
    }
    if (pos.some(tag => ['t','tg','qt'].includes(tag))) {
      return [`我${word.word}去学校。`, `Wǒ ${pinyin} qù xuéxiào.`, `I go to school ${meaning}.`];
    }
    return [`我知道“${word.word}”这个词。`, `Wǒ zhīdào “${pinyin}” zhège cí.`, `I know this word: “${meaning}”.`];
  }

  function examplesFor(word) {
    const examples = CUSTOM_EXAMPLES[word.word] || [generatedExample(word)];
    return examples.slice(0, 4).map(example => ({ cn:example[0], py:example[1], en:example[2] }));
  }

  function renderToday() {
    const batch = todayBatch();
    const learnedToday = batch.filter(word => isLearned(word.id)).length;
    const pct = batch.length ? Math.round(learnedToday / batch.length * 100) : 100;
    const conversation = CONVERSATIONS[(Math.floor((Date.now() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000) % CONVERSATIONS.length + CONVERSATIONS.length) % CONVERSATIONS.length];
    const cards = batch.map(word => `
      <article class="word-card ${isLearned(word.id) ? 'learned' : ''}">
        <div class="word-main" role="button" tabindex="0" data-open-word="${escapeHTML(word.id)}">
          <div class="word-hanzi">${escapeHTML(word.word)}</div>
          <div class="word-pinyin">${escapeHTML(word.pinyin)}</div>
          <div class="word-meaning">${safeMeaning(word)}</div>
        </div>
        <div class="word-actions">
          <span class="word-level">HSK ${word.level}</span>
          <button class="mini-button purple" data-open-word="${escapeHTML(word.id)}">Examples</button>
          ${isLearned(word.id) ? '<span class="mini-button">✓ Learned</span>' : `<button class="mini-button primary" data-learn="${escapeHTML(word.id)}">Learned</button>`}
        </div>
      </article>`).join('');

    main.innerHTML = `
      <section class="hero">
        <p class="eyebrow">${escapeHTML(formatDate())} · YOUR CHINESE ROUTINE</p>
        <h1>Small steps.<br>Real progress.</h1>
        <p>Learn useful Chinese every day with vocabulary, examples, mini conversations and quick reviews.</p>
        <div class="hero-meta"><span class="pill">HSK 2.0 · Levels 1–5</span><span class="pill">${state.dailyTarget} new words / day</span><span class="pill">${fullDataReady ? 'Offline-ready' : 'Starter mode'}</span></div>
      </section>

      ${!fullDataReady ? `<div class="notice">You are seeing the starter vocabulary for now. Connect to the internet once to load the complete 2,500-word HSK 1–5 list. It will then be saved on this device for offline study. <button class="text-button" data-retry="true">Try again</button></div>` : ''}

      <div class="grid-two">
        <section class="panel goal-panel">
          <div class="progress-ring" style="--progress:${pct * 3.6}deg"><strong>${pct}%</strong></div>
          <div class="goal-copy"><strong>Today's learning goal</strong><p>${learnedToday} of ${batch.length} words marked as learned.<br>${batch.length ? 'Keep going — you are building a habit.' : 'You have reached the end of this word list.'}</p></div>
        </section>
        <section class="panel stat-panel"><div><p class="eyebrow">YOUR WORD BANK</p><div class="stat-big">${fullDataReady ? words.length.toLocaleString() : '32+'}</div><p>${fullDataReady ? 'HSK words ready to study' : 'starter words available'}</p></div><p>${fullDataReady ? `About ${Math.ceil(words.length / state.dailyTarget)} study days at your current pace.` : 'The complete list loads on first connection.'}</p></section>
      </div>

      <div class="section-heading"><div><h2>Today's new words</h2><p>Tap a word to see examples and write your own sentence.</p></div><span class="pill">${batch.length} words</span></div>
      <div class="word-list">${cards || '<div class="empty-state"><strong>Word list completed 🎉</strong>Keep reviewing your saved vocabulary.</div>'}</div>

      <div class="section-heading"><div><h2>Mini conversation</h2><p>A little Chinese in context.</p></div><button class="text-button" data-tab-link="practice">More practice →</button></div>
      <section class="panel">
        <p class="eyebrow">TODAY'S SITUATION</p><h3 style="font-size:16px;margin-bottom:15px">${escapeHTML(conversation.title)}</h3>
        <div class="conversation">${conversation.lines.map((line,index)=>`<div class="dialogue-line"><span class="speaker">${line[0]}</span><div><div class="hanzi">${escapeHTML(line[1])}</div><div class="pinyin">${escapeHTML(line[2])}</div><div class="translation">${escapeHTML(line[3])}</div></div></div>`).join('')}</div>
      </section>`;
    updateHeader();
  }

  function renderWords() {
    const filtered = words.filter(word => {
      const matchLevel = activeLevel === 0 || word.level === activeLevel;
      const haystack = `${word.word} ${word.traditional} ${word.pinyin} ${word.meaning}`.toLowerCase();
      return matchLevel && haystack.includes(searchTerm.toLowerCase());
    }).slice(0, 160);
    main.innerHTML = `
      <section class="section-heading" style="margin-top:3px"><div><p class="eyebrow">VOCABULARY LIBRARY</p><h2>Explore your HSK words</h2><p>${fullDataReady ? `${words.length.toLocaleString()} words · HSK 2.0 Levels 1–5` : 'Starter list · full list loads on first connection'}</p></div></section>
      <div class="search-row"><input id="wordSearch" class="search-input" value="${escapeHTML(searchTerm)}" placeholder="Search characters, pinyin or meaning…" autocomplete="off"><button class="secondary-button" data-clear-search="true">Clear</button></div>
      <div class="level-filters">${[0,1,2,3,4,5].map(level=>`<button class="filter-chip ${activeLevel===level?'active':''}" data-level="${level}">${level===0?'All levels':`HSK ${level}`}</button>`).join('')}</div>
      <p class="list-note">Showing ${filtered.length} matching words. Tap any row for examples and writing practice.</p>
      <div class="word-list">${filtered.map(word=>`<button class="word-row" data-open-word="${escapeHTML(word.id)}"><span class="hanzi">${escapeHTML(word.word)}</span><span><span class="pinyin">${escapeHTML(word.pinyin)}</span><span class="meaning">${safeMeaning(word)}</span></span><span class="level">HSK ${word.level} →</span></button>`).join('') || '<div class="empty-state"><strong>No matching words</strong>Try another search or HSK level.</div>'}</div>
      ${filtered.length===160?'<p class="list-note">For speed, the library shows the first 160 matches. Narrow your search to find a specific word.</p>':''}`;
    const input = $('#wordSearch');
    input?.addEventListener('input', event => { searchTerm = event.target.value; const pos = input.selectionStart; renderWords(); const next = $('#wordSearch'); next?.focus(); next?.setSelectionRange(pos,pos); });
  }

  function renderReview() {
    const due = reviewWords();
    if (!due.length) {
      main.innerHTML = `<section class="hero"><p class="eyebrow">SMART REVIEW</p><h1>Your review queue is clear.</h1><p>Words you mark as learned will return at spaced intervals, so you can remember them for longer.</p></section><div class="panel" style="margin-top:15px;text-align:center;padding:30px"><div style="font-size:35px">🌿</div><h2 style="font-size:18px;margin:12px 0 7px">Nothing due right now</h2><p style="color:var(--muted);font-size:12px">Learn today's words or come back when your next review is due.</p><button class="primary-button" data-tab-link="today">Go to today's words</button></div>`;
      updateHeader();
      return;
    }
    reviewIndex = Math.min(reviewIndex, due.length - 1);
    const word = due[reviewIndex];
    main.innerHTML = `
      <section class="section-heading" style="margin-top:4px"><div><p class="eyebrow">SPACED REPETITION</p><h2>Review your words</h2><p>${due.length} word${due.length===1?'':'s'} due today</p></div><span class="pill">${reviewIndex+1} / ${due.length}</span></section>
      <section class="panel review-card">
        <p class="eyebrow">WHAT DOES THIS MEAN?</p><div class="review-word">${escapeHTML(word.word)}</div><div class="review-hint">Try to remember the meaning before revealing it.</div>
        <button class="secondary-button" id="revealReview">Reveal answer</button>
        <div id="reviewAnswer" class="review-answer hidden"><div class="answer-pinyin">${escapeHTML(word.pinyin)}</div><div class="answer-meaning">${safeMeaning(word)}</div></div>
        <div class="review-buttons hidden" id="reviewButtons"><button class="secondary-button" data-review-result="again" data-word="${escapeHTML(word.id)}">Again</button><button class="primary-button" data-review-result="good" data-word="${escapeHTML(word.id)}">Got it</button></div>
      </section>
      <p class="list-note">Again: review tomorrow. Got it: the next review moves further into the future.</p>`;
    $('#revealReview')?.addEventListener('click', () => { $('#reviewAnswer').classList.remove('hidden'); $('#reviewButtons').classList.remove('hidden'); $('#revealReview').classList.add('hidden'); });
  }

  function renderPractice() {
    const conversation = CONVERSATIONS[(Math.floor((Date.now() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000) % CONVERSATIONS.length + CONVERSATIONS.length) % CONVERSATIONS.length];
    const batch = todayBatch();
    main.innerHTML = `
      <section class="hero"><p class="eyebrow">USE WHAT YOU LEARN</p><h1>Practice makes it stick.</h1><p>Read a short conversation, test your memory, then write a sentence using one of today's words.</p></section>
      <div class="section-heading"><div><h2>Mini conversation</h2><p>${escapeHTML(conversation.title)}</p></div><span class="pill">3–4 lines</span></div>
      <section class="panel"><div class="conversation">${conversation.lines.map(line=>`<div class="dialogue-line"><span class="speaker">${line[0]}</span><div><div class="hanzi">${escapeHTML(line[1])}</div><div class="pinyin">${escapeHTML(line[2])}</div><div class="translation">${escapeHTML(line[3])}</div></div></div>`).join('')}</div></section>
      <div class="section-heading"><div><h2>Quick quiz</h2><p>Choose the correct meaning.</p></div></div>
      <section class="panel conversation-card"><div><strong>Test today's vocabulary</strong><p>10 questions · instant feedback</p></div><span class="big-mark">✓?</span><button class="primary-button" id="startQuiz">Start quiz</button></section>
      <div class="section-heading"><div><h2>Write your own sentence</h2><p>Use one of today's new words.</p></div></div>
      <section class="panel"><label for="practiceWord" class="list-note">Choose a word</label><select id="practiceWord" class="select-input" style="width:100%;margin-bottom:10px">${batch.map(word=>`<option value="${escapeHTML(word.id)}">${escapeHTML(word.word)} · ${escapeHTML(word.pinyin)}</option>`).join('')}</select><textarea id="practiceText" class="phrase-input" placeholder="Write a sentence in Chinese…"></textarea><button class="primary-button" id="savePractice" style="width:100%;margin-top:10px">Save my sentence</button><p class="list-note">Your sentence is saved on this device. The app checks that it includes the selected word; it does not use an online AI correction service.</p></section>`;
    $('#startQuiz')?.addEventListener('click', startQuiz);
    $('#savePractice')?.addEventListener('click', () => {
      const word = getWord($('#practiceWord')?.value);
      const text = ($('#practiceText')?.value || '').trim();
      if (!word || !text) return showToast('Choose a word and write a sentence first.');
      state.phrases[word.id] = { text, date:TODAY() };
      markActivity();
      showToast(text.includes(word.word) ? 'Sentence saved — it includes your word!' : 'Sentence saved. Try to include the chosen word next time.');
    });
  }

  function renderProgress() {
    const learned = Object.keys(state.review).length;
    const due = reviewWords().length;
    const introduced = Math.min(state.nextIndex, words.length);
    const pct = Math.round(learned / Math.max(words.length,1) * 100);
    const phrases = Object.keys(state.phrases).length;
    main.innerHTML = `
      <section class="hero"><p class="eyebrow">YOUR LEARNING JOURNEY</p><h1>Progress you can see.</h1><p>Consistency matters more than speed. Keep learning a little every day.</p><div class="hero-meta"><span class="pill">🔥 ${state.streak} day streak</span><span class="pill">${state.dailyTarget} words / day</span></div></section>
      <div class="section-heading"><div><h2>Your statistics</h2><p>Saved locally on this device.</p></div></div>
      <div class="stat-grid"><div class="stat-box"><span>Words marked learned</span><strong>${learned}</strong></div><div class="stat-box"><span>Words introduced</span><strong>${introduced}</strong></div><div class="stat-box"><span>Reviews due</span><strong>${due}</strong></div><div class="stat-box"><span>Sentences saved</span><strong>${phrases}</strong></div></div>
      <div class="section-heading"><div><h2>Overall HSK 1–5 progress</h2><p>${learned} of ${words.length} words marked learned</p></div><span class="pill">${pct}%</span></div>
      <section class="panel"><div style="height:10px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--purple),var(--mint));border-radius:99px"></div></div><p class="list-note">At ${state.dailyTarget} new words per day, the full list takes about ${Math.ceil(words.length/state.dailyTarget)} study days. This is a pace estimate, not a guarantee that every word is mastered.</p></section>
      <div class="section-heading"><div><h2>Daily target</h2><p>Choose how many new words to study each day.</p></div></div>
      <section class="panel"><div class="level-filters">${[10,11,12,13,14].map(count=>`<button class="filter-chip ${state.dailyTarget===count?'active':''}" data-target="${count}">${count} words</button>`).join('')}</div><p class="list-note">Your current lesson will stay the same. The new target starts with tomorrow's lesson.</p></section>
      <div class="section-heading"><div><h2>Data source</h2><p>Vocabulary reference information.</p></div></div>
      <section class="panel"><p style="font-size:12px;line-height:1.6;color:var(--muted);margin:0">This app uses the classic HSK 2.0 vocabulary list for Levels 1–5. Vocabulary and pinyin are loaded from the open-source Complete HSK Vocabulary project. This is not the newer HSK 3.0 syllabus.</p></section>`;
  }

  function render() {
    const tab = state.activeTab || 'today';
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    if (tab === 'today') renderToday();
    else if (tab === 'words') renderWords();
    else if (tab === 'review') renderReview();
    else if (tab === 'practice') renderPractice();
    else renderProgress();
    updateHeader();
  }

  function setTab(tab) {
    if (!['today','words','review','practice','progress'].includes(tab)) return;
    state.activeTab = tab;
    saveState();
    render();
  }

  function openWord(id) {
    const word = getWord(id);
    if (!word) return;
    modalWord = word;
    const examples = examplesFor(word);
    const savedPhrase = state.phrases[word.id]?.text || '';
    modalRoot.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="wordModalTitle"><div class="modal-head"><h2 id="wordModalTitle">Word details · HSK ${word.level}</h2><button class="close-button" id="closeModal" aria-label="Close">✕</button></div><div class="review-word" style="font-size:42px;text-align:left;margin:7px 0 3px">${escapeHTML(word.word)}</div><div class="word-pinyin">${escapeHTML(word.pinyin)}</div><p style="font-size:13px;line-height:1.5;margin:10px 0 0">${escapeHTML(word.meaning)}</p>${word.traditional!==word.word?`<p class="list-note">Traditional: ${escapeHTML(word.traditional)}</p>`:''}<div class="section-heading" style="margin-top:20px"><div><h2 style="font-size:15px">Example sentence</h2><p>Characters, pinyin and translation.</p></div></div>${examples.map(example=>`<div class="example-block"><div class="example-cn">${escapeHTML(example.cn)}</div><div class="example-py">${escapeHTML(example.py)}</div><div class="example-en">${escapeHTML(example.en)}</div></div>`).join('')}<div class="section-heading" style="margin-top:20px"><div><h2 style="font-size:15px">Your turn</h2><p>Write your own sentence using ${escapeHTML(word.word)}.</p></div></div><textarea id="wordPhrase" class="phrase-input" placeholder="Write a sentence in Chinese…">${escapeHTML(savedPhrase)}</textarea><div class="action-row"><button class="secondary-button" id="saveWordPhrase">Save sentence</button>${isLearned(word.id)?'<button class="primary-button" disabled>✓ In review plan</button>':`<button class="primary-button" id="markWordLearned">I learned this</button>`}</div></section></div>`;
    $('#closeModal')?.addEventListener('click', closeModal);
    $('#modalBackdrop')?.addEventListener('click', event => { if(event.target.id==='modalBackdrop') closeModal(); });
    $('#saveWordPhrase')?.addEventListener('click', () => {
      const text = ($('#wordPhrase')?.value || '').trim();
      if (!text) return showToast('Write a sentence first.');
      state.phrases[word.id] = { text, date:TODAY() };
      markActivity();
      showToast(text.includes(word.word) ? 'Your sentence has been saved!' : 'Saved. Try to include the target word.');
    });
    $('#markWordLearned')?.addEventListener('click', () => { closeModal(); markLearned(word); });
  }

  function closeModal() { modalRoot.innerHTML = ''; modalWord = null; }

  function startQuiz() {
    const batch = todayBatch();
    const pool = batch.length ? batch : words.slice(0, 12);
    const shuffled = pool.slice().sort(() => Math.random() - .5).slice(0, Math.min(10,pool.length));
    if (shuffled.length < 2) return showToast('Load the full word list to start a quiz.');
    quiz = { questions:shuffled, index:0, score:0, answered:false };
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const question = quiz.questions[quiz.index];
    const distractors = words.filter(word => word.id !== question.id && word.level <= question.level).sort(() => Math.random() - .5).slice(0,3);
    const options = [question, ...distractors].sort(() => Math.random() - .5);
    quiz.currentOptions = options;
    main.innerHTML = `<section class="section-heading" style="margin-top:4px"><div><p class="eyebrow">QUICK QUIZ</p><h2>Choose the meaning</h2><p>Question ${quiz.index+1} of ${quiz.questions.length}</p></div><span class="pill">Score ${quiz.score}</span></section><section class="panel quiz-box"><div class="quiz-progress">${Math.round(quiz.index/quiz.questions.length*100)}% completed</div><div class="review-word" style="font-size:43px;text-align:left">${escapeHTML(question.word)}</div><div class="quiz-question">What does it mean?</div><div class="quiz-sub">${escapeHTML(question.pinyin)}</div><div class="quiz-options">${options.map((option,index)=>`<button class="quiz-option" data-quiz-option="${index}">${escapeHTML(meaningShort(option))}</button>`).join('')}</div><div id="quizFeedback" class="quiz-feedback"></div><button class="primary-button hidden" id="quizNext" style="width:100%;margin-top:10px">${quiz.index+1===quiz.questions.length?'See result':'Next question'}</button></section>`;
    $$('[data-quiz-option]').forEach(button => button.addEventListener('click', () => answerQuiz(Number(button.dataset.quizOption))));
    $('#quizNext')?.addEventListener('click', nextQuizQuestion);
  }

  function answerQuiz(index) {
    if (!quiz || quiz.answered) return;
    quiz.answered = true;
    const question = quiz.questions[quiz.index];
    const selected = quiz.currentOptions[index];
    if (selected.id === question.id) { quiz.score++; $('#quizFeedback').textContent = 'Correct — well done!'; }
    else { $('#quizFeedback').textContent = `Not quite. ${question.word} means: ${meaningShort(question)}.`; }
    $$('[data-quiz-option]').forEach(button => {
      button.disabled = true;
      const option = quiz.currentOptions[Number(button.dataset.quizOption)];
      if (option.id === question.id) button.classList.add('correct');
      else if (option.id === selected.id) button.classList.add('wrong');
    });
    $('#quizNext')?.classList.remove('hidden');
  }

  function nextQuizQuestion() {
    if (!quiz) return;
    if (quiz.index + 1 >= quiz.questions.length) {
      const score = quiz.score;
      const total = quiz.questions.length;
      quiz = null;
      markActivity();
      main.innerHTML = `<section class="hero"><p class="eyebrow">QUIZ COMPLETE</p><h1>${score}/${total} correct.</h1><p>${score===total?'Perfect score! Keep that momentum.':score>=Math.ceil(total*.7)?'Good work. Review the words you missed and try again.':'Every quiz is practice. Review the words and give it another try.'}</p></section><section class="panel" style="margin-top:15px;text-align:center"><div class="progress-ring" style="--progress:${score/total*360}deg;margin:10px auto 18px"><strong>${Math.round(score/total*100)}%</strong></div><button class="primary-button" id="quizAgain">Try again</button><button class="secondary-button" id="quizDone" style="margin-left:8px">Back to practice</button></section>`;
      $('#quizAgain')?.addEventListener('click', startQuiz);
      $('#quizDone')?.addEventListener('click', () => setTab('practice'));
      return;
    }
    quiz.index++;
    quiz.answered = false;
    renderQuizQuestion();
  }

  function applyReviewResult(id, result) {
    const record = state.review[id];
    if (!record) return;
    if (result === 'again') {
      record.stage = 0;
      record.due = addDays(TODAY(),1);
    } else {
      const intervals = [1,3,7,14,30];
      const interval = intervals[Math.min(record.stage || 0, intervals.length-1)];
      record.stage = Math.min((record.stage || 0) + 1, intervals.length-1);
      record.due = addDays(TODAY(), interval);
    }
    record.last = TODAY();
    state.review[id] = record;
    markActivity();
    reviewIndex = 0;
    render();
    showToast(result === 'good' ? 'Great — next review scheduled.' : 'No problem — we will review it again tomorrow.');
  }

  function openSettings() {
    modalRoot.innerHTML = `<div class="modal-backdrop" id="settingsBackdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Settings</h2><button class="close-button" id="closeSettings">✕</button></div><div class="settings-row"><div><strong>Daily new words</strong><p>Choose a target from 10 to 14.</p></div><select id="settingsTarget" class="select-input">${[10,11,12,13,14].map(n=>`<option value="${n}" ${state.dailyTarget===n?'selected':''}>${n} words</option>`).join('')}</select></div><div class="settings-row"><div><strong>Vocabulary version</strong><p>Classic HSK 2.0 · Levels 1–5.</p></div><span class="pill">2,500 words</span></div><div class="settings-row"><div><strong>Learning data</strong><p>Saved on this device, no account needed.</p></div><span class="pill">Local</span></div><button class="primary-button" id="saveSettings" style="width:100%;margin-top:17px">Save settings</button><button class="secondary-button" id="retryData" style="width:100%;margin-top:8px">Reload vocabulary list</button></section></div>`;
    $('#closeSettings')?.addEventListener('click', closeModal);
    $('#settingsBackdrop')?.addEventListener('click', event=>{if(event.target.id==='settingsBackdrop')closeModal();});
    $('#saveSettings')?.addEventListener('click', () => {
      state.dailyTarget = Number($('#settingsTarget').value) || 12;
      saveState(); closeModal(); render(); showToast('Settings saved.');
    });
    $('#retryData')?.addEventListener('click', async () => { closeModal(); await reloadVocabulary(); });
  }

  async function reloadVocabulary() {
    showToast('Loading the full HSK vocabulary…');
    const previousWords = words;
    const previouslyFull = fullDataReady;
    try {
      const levels = await Promise.all([1,2,3,4,5].map(fetchLevel));
      const combined = levels.flat();
      const unique = new Map();
      combined.forEach(word => { if (!unique.has(word.word)) unique.set(word.word,word); });
      const complete = [...unique.values()].sort((a,b)=>a.level-b.level || a.frequency-b.frequency || a.word.localeCompare(b.word,'zh-CN'));
      if (complete.length < 2400) throw new Error(`Received ${complete.length} words`);
      activateFullList(complete);
      try { await writeCache(complete); } catch (_) { /* continue */ }
      render(); showToast(`${words.length.toLocaleString()} HSK words loaded and saved.`);
    } catch (error) {
      console.warn(error);
      words = previouslyFull ? previousWords : SEED.slice();
      fullDataReady = previouslyFull;
      render();
      showToast('Could not download the full list. Check your connection.');
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button,[data-open-word]');
    if (!target) return;
    if (target.dataset.tab) return setTab(target.dataset.tab);
    if (target.dataset.tabLink) return setTab(target.dataset.tabLink);
    if (target.dataset.openWord) return openWord(target.dataset.openWord);
    if (target.dataset.learn) return markLearned(getWord(target.dataset.learn));
    if (target.dataset.reviewResult) return applyReviewResult(target.dataset.word, target.dataset.reviewResult);
    if (target.dataset.level !== undefined) { activeLevel = Number(target.dataset.level); renderWords(); return; }
    if (target.dataset.target) { state.dailyTarget = Number(target.dataset.target); saveState(); renderProgress(); showToast('Daily target updated.'); return; }
    if (target.dataset.clearSearch) { searchTerm=''; renderWords(); return; }
    if (target.dataset.retry) return reloadVocabulary();
  });

  $('#settingsButton')?.addEventListener('click', openSettings);

  async function init() {
    await loadVocabulary();
    if (!fullDataReady) words = SEED.slice();
    todayBatch();
    render();
    if (!fullDataReady) {
      // Keep the starter lesson usable while the user can retry the full download.
    }
  }

  init().catch(error => {
    console.error(error);
    main.innerHTML = '<section class="empty-state"><strong>LanguageBuddy could not start.</strong>Please refresh the app. Your saved progress should remain on this device.</section>';
  });
})();
