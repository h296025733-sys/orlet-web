// The reader owns this player. It never fetches articles or calls an AI service.
export function speechChunks(text, limit = 140) {
  const chunks = [];
  for (const paragraph of String(text || '').replace(/\r/g, '').split(/\n+/)) {
    let rest = paragraph.trim();
    while (rest) {
      let end = Math.min(limit, rest.length);
      if (rest.length > limit) {
        const stops = [...rest.slice(0, limit).matchAll(/[。！？；.!?;，,、\s]/g)];
        const boundary = stops.at(-1)?.index;
        if (boundary >= limit / 3) end = boundary + 1;
        if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      }
      chunks.push(rest.slice(0, end)); rest = rest.slice(end);
    }
  }
  return chunks;
}

export function readerSpeechText(root) {
  if (!root?.cloneNode) return '';
  const copy = root.cloneNode(true);
  copy.querySelectorAll('figure,video,audio,img,button,input,select,textarea,script,style,[hidden],[aria-hidden="true"],[role="status"],.media-error,.media-pending,.quote-save').forEach(node => node.remove());
  copy.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,td,th,div,br').forEach(node => node.append('\n'));
  return copy.textContent.replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function createSpeechPlayer({synth, Utterance, onChange = () => {}} = {}) {
  const supported = !!synth && typeof Utterance === 'function';
  let key = null, text = '', chunks = [], index = 0, offset = 0, rate = 1;
  let phase = 'idle', error = '', token = 0, utterance = null, owned = false;
  const snapshot = () => ({supported, phase, error, rate, ready: !!text, progress: phase === 'ended' ? 1 : chunks.length ? index / chunks.length : 0});
  const emit = () => onChange(snapshot());
  function cancel() {
    token++; utterance = null;
    if (owned) { owned = false; synth.cancel(); }
  }
  function stop() { cancel(); chunks = []; index = offset = 0; phase = 'idle'; error = ''; emit(); }
  function fail(message) { cancel(); phase = 'error'; error = message; emit(); }
  function speak() {
    if (index >= chunks.length) { owned = false; utterance = null; phase = 'ended'; emit(); return; }
    const generation = ++token, start = offset;
    const current = utterance = new Utterance(chunks[index].slice(start));
    current.lang = 'zh-CN'; current.rate = rate;
    const voices = synth.getVoices?.() || [];
    const chinese = voices.filter(voice => /^zh([_-]|$)/i.test(voice.lang));
    current.voice = chinese.find(voice => /^zh[_-]CN$/i.test(voice.lang) && voice.localService) || chinese.find(voice => /^zh[_-]CN$/i.test(voice.lang)) || chinese[0] || null;
    current.onstart = () => { if (generation !== token) return; phase = 'playing'; emit(); };
    current.onboundary = event => { if (generation === token && Number.isFinite(event.charIndex)) offset = Math.max(start, Math.min(chunks[index].length - 1, start + event.charIndex)); };
    current.onend = () => { if (generation !== token) return; index++; offset = 0; speak(); };
    current.onerror = event => {
      if (generation !== token) return;
      fail(event.error === 'not-allowed' ? '播放未获允许，请再点一次听全文' : ['voice-unavailable', 'language-unavailable', 'synthesis-unavailable'].includes(event.error) ? '系统语音不可用，请检查设备语音设置' : '朗读中断，请重试');
    };
    phase = 'starting'; owned = true; emit();
    try { if (synth.paused) synth.resume(); synth.speak(current); }
    catch { fail('系统语音不可用，请重试'); }
  }
  function toggle() {
    if (!supported || !text) return;
    if (phase === 'playing' || phase === 'starting') {
      // Native pause/resume is uneven on mobile. Keep the last spoken boundary;
      // an engine without boundaries repeats at most this short chunk.
      cancel(); phase = 'paused'; emit(); return;
    }
    if (phase !== 'paused') { cancel(); chunks = speechChunks(text); index = offset = 0; }
    error = ''; speak();
  }
  function update(nextKey, nextText) {
    const clean = String(nextText || '').trim();
    if (key !== nextKey || text !== clean) { stop(); key = nextKey; text = clean; emit(); }
  }
  function setRate(value) {
    if (![0.75, 1, 1.25, 1.5, 2].includes(Number(value))) return;
    rate = Number(value);
    if (phase === 'playing' || phase === 'starting') { cancel(); speak(); }
    else emit();
  }
  return {update, toggle, stop, setRate, snapshot};
}

export function createReaderSpeechUi(doc = globalThis.document, host = globalThis) {
  const title = doc?.getElementById('reader-title');
  if (!title) return null;
  const row = doc.createElement('div'); row.className = 'reader-listen';
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', '文章朗读');
  row.innerHTML = `<button type="button" class="reader-listen-toggle" disabled aria-label="听全文"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="listen-headphones" d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z"/><path class="listen-pause" d="M8 5v14M16 5v14"/></svg><span>听全文</span></button><div class="reader-listen-controls" hidden><select aria-label="朗读语速"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><button type="button" class="reader-listen-stop" aria-label="停止朗读" title="停止朗读"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div><progress class="reader-listen-progress" max="1" value="0" aria-label="朗读进度" hidden></progress><span class="reader-listen-message" role="status" hidden></span>`;
  title.after(row);
  const toggle = row.querySelector('.reader-listen-toggle'), label = toggle.querySelector('span');
  const controls = row.querySelector('.reader-listen-controls'), progress = row.querySelector('progress');
  const message = row.querySelector('.reader-listen-message');
  const player = createSpeechPlayer({synth: host.speechSynthesis, Utterance: host.SpeechSynthesisUtterance, onChange(state) {
    const active = ['starting', 'playing', 'paused'].includes(state.phase), speaking = ['starting', 'playing'].includes(state.phase);
    row.dataset.phase = state.phase; toggle.disabled = !state.supported || !state.ready;
    label.textContent = speaking ? '暂停' : state.phase === 'paused' ? '继续朗读' : state.phase === 'ended' ? '再听一遍' : '听全文';
    toggle.setAttribute('aria-label', speaking ? '暂停朗读' : label.textContent);
    toggle.setAttribute('aria-pressed', String(speaking));
    toggle.title = !state.supported ? '当前浏览器不支持朗读' : !state.ready ? '正文就绪后可听全文' : toggle.getAttribute('aria-label');
    controls.hidden = !active; progress.hidden = !active; progress.value = state.progress;
    message.textContent = state.error || (!state.supported ? '当前浏览器不支持朗读' : ''); message.hidden = !message.textContent;
  }});
  toggle.addEventListener('click', () => player.toggle());
  row.querySelector('.reader-listen-stop').addEventListener('click', () => { player.stop(); toggle.focus(); });
  row.querySelector('select').addEventListener('change', event => player.setRate(event.target.value));
  host.addEventListener?.('pagehide', () => player.stop());
  doc.getElementById('reader-content')?.addEventListener('play', event => { if (event.target?.tagName === 'VIDEO' || event.target?.tagName === 'AUDIO') player.stop(); }, true);
  player.stop();
  return {
    stop() { player.update(null, ''); },
    update({key, title: heading}) {
      const body = readerSpeechText(doc.getElementById('reader-content'));
      player.update(key, body ? `${heading || ''}\n${body}` : '');
    }
  };
}

if (globalThis.document) globalThis.orletReaderSpeech = createReaderSpeechUi();
