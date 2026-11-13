// The site owns this player. It never fetches articles or calls an AI service.
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

export function speechSegments(text, limit = 140) {
  const segments = [];
  for (const paragraph of text.matchAll(/[^\n]+/g)) {
    const raw = paragraph[0], left = raw.length - raw.trimStart().length;
    const body = raw.trim(), base = paragraph.index + left;
    let begin = 0;
    const ends = [...body.matchAll(/[。！？!?；;][”’」』）)]*|\.(?=\s|$)/g)].map(match => match.index + match[0].length);
    if (ends.at(-1) !== body.length) ends.push(body.length);
    for (const end of ends) {
      let position = begin;
      for (const chunk of speechChunks(body.slice(begin, end), limit)) {
        position = body.indexOf(chunk, position);
        const item = {text: chunk, start: base + position, end: base + position + chunk.length, pauseAfter: /[。！？.!?][”’」』）)]*$/.test(chunk) ? 120 : /[；;][”’」』）)]*$/.test(chunk) ? 80 : 40};
        const previous = segments.at(-1);
        if (previous && previous.start >= base && item.end - previous.start <= limit) { previous.text = text.slice(previous.start, item.end); previous.end = item.end; previous.pauseAfter = item.pauseAfter; }
        else segments.push(item);
        position += chunk.length;
      }
      begin = end;
    }
    if (segments.length) segments.at(-1).pauseAfter = 320;
  }
  return segments;
}

function safeSpeechOffset(text, value) {
  let position = Math.max(0, Math.min(text.length, Math.floor(value)));
  if (globalThis.Intl?.Segmenter) {
    for (const segment of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)) {
      if (segment.index > position) break;
      if (segment.index + segment.segment.length > position) return segment.index;
    }
  } else if (position > 0 && /[\uDC00-\uDFFF]/.test(text[position])) position--;
  return position;
}

export function createSpeechPlayer({synth, Utterance, onChange = () => {}, schedule = setTimeout, unschedule = clearTimeout} = {}) {
  const supported = !!synth && typeof Utterance === 'function';
  let key = null, text = '', segments = [], index = 0, offset = 0, rate = 1, voiceId = '';
  let phase = 'idle', error = '', token = 0, utterance = null, owned = false, gapTimer = null, startTimer = null;
  const position = () => phase === 'ended' ? text.length : Math.min(text.length, (segments[index]?.start || 0) + offset);
  const snapshot = () => ({kind: 'text', supported, phase, error, rate, voiceId, ready: !!text, position: position(), length: text.length, progress: text.length ? position() / text.length : 0});
  const emit = () => onChange(snapshot());
  function cancel() {
    token++; utterance = null; unschedule(gapTimer); unschedule(startTimer); gapTimer = startTimer = null;
    if (owned) { owned = false; synth.cancel(); }
  }
  function stop() { cancel(); index = offset = 0; phase = 'idle'; error = ''; emit(); }
  function fail(message) { cancel(); phase = 'error'; error = message; emit(); }
  function speak() {
    if (index >= segments.length) { owned = false; utterance = null; phase = 'ended'; emit(); return; }
    const generation = ++token, start = offset;
    const current = utterance = new Utterance(segments[index].text.slice(start));
    current.lang = 'zh-CN'; current.rate = rate;
    const voices = synth.getVoices?.() || [];
    const chinese = voices.filter(voice => /^zh([_-]|$)/i.test(voice.lang));
    const selected = voiceId ? voices.find(voice => voice.voiceURI === voiceId && voice.localService) : null;
    if (voiceId && !selected) { fail('所选设备声音不可用，请重新选择'); return; }
    current.voice = selected || chinese.find(voice => /^zh[_-]CN$/i.test(voice.lang) && voice.localService) || chinese.find(voice => voice.localService) || null;
    current.onstart = () => { if (generation !== token) return; unschedule(startTimer); startTimer = null; phase = 'playing'; emit(); };
    current.onboundary = event => { if (generation !== token || !Number.isFinite(event.charIndex)) return; offset = Math.max(start, Math.min(segments[index].text.length - 1, start + event.charIndex)); emit(); };
    current.onend = () => {
      if (generation !== token || utterance !== current) return;
      unschedule(startTimer); startTimer = null; owned = false; utterance = null;
      const delay = segments[index].pauseAfter / rate; index++; offset = 0;
      if (index >= segments.length) { phase = 'ended'; emit(); return; }
      emit(); gapTimer = schedule(() => { gapTimer = null; if (generation === token) speak(); }, delay);
    };
    current.onerror = event => {
      if (generation !== token) return;
      fail(event.error === 'not-allowed' ? '播放未获允许，请再点一次听全文' : ['voice-unavailable', 'language-unavailable', 'synthesis-unavailable'].includes(event.error) ? '系统语音不可用，请检查设备语音设置' : '朗读中断，请重试');
    };
    phase = 'starting'; owned = true; emit();
    startTimer = schedule(() => { if (generation === token) fail('设备语音未能启动，请重试'); }, 10000);
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
    if (phase !== 'paused') { cancel(); index = offset = 0; }
    error = ''; speak();
  }
  function update(nextKey, nextText) {
    const clean = String(nextText || '').trim();
    if (key !== nextKey || text !== clean) { stop(); key = nextKey; text = clean; segments = speechSegments(text); emit(); }
  }
  function setRate(value) {
    if (![0.75, 1, 1.25, 1.5, 2].includes(Number(value))) return;
    rate = Number(value);
    if (phase === 'playing' || phase === 'starting') { cancel(); speak(); }
    else emit();
  }
  function seek(fraction) {
    if (!text || !Number.isFinite(Number(fraction))) return;
    const resume = ['playing', 'starting'].includes(phase);
    const target = safeSpeechOffset(text, Math.round(Math.max(0, Math.min(1, Number(fraction))) * text.length));
    cancel(); error = '';
    index = segments.findIndex(segment => segment.end > target);
    if (index < 0) { index = segments.length; offset = 0; phase = 'ended'; emit(); return; }
    offset = Math.max(0, target - segments[index].start); phase = 'paused';
    if (resume) speak(); else emit();
  }
  function skip(direction) {
    if (!segments.length) return;
    const next = Math.max(0, Math.min(segments.length - 1, index + Math.sign(direction)));
    seek(segments[next].start / text.length);
  }
  function setVoice(value) {
    if (value && !(synth?.getVoices?.() || []).some(voice => voice.voiceURI === value && voice.localService)) return;
    voiceId = value;
    if (['playing', 'starting'].includes(phase)) { cancel(); speak(); } else emit();
  }
  return {update, toggle, stop, setRate, setVoice, seek, skip, snapshot};
}

export function createArticleAudioPlayer({AudioCtor, request, assetUrl = path => path, prepareAudio = null, voices, onChange = () => {}, schedule = setTimeout, unschedule = clearTimeout}) {
  const audio = new AudioCtor(); audio.preload = 'auto'; audio.crossOrigin = 'anonymous';
  let key = null, text = '', job = null, parts = [], index = 0, rate = 1, voiceId = voices[0].id;
  let phase = 'idle', error = '', generation = 0, shouldPlay = false, timer = null, controller = null, pendingTime = 0, source = '', deadline = 0;
  let originalParts = [];
  const prepared = new Map(), preparing = new Set(); let waitingTimer = null;
  const length = () => parts.reduce((sum, part) => sum + part.duration, 0);
  const position = () => phase === 'ended' ? length() : Math.min(length(), parts.slice(0, index).reduce((sum, part) => sum + part.duration, 0) + (source ? Number(audio.currentTime) || pendingTime : 0));
  const snapshot = () => ({kind: 'audio', supported: true, ready: !!text, phase, error, rate, voiceId, position: position(), length: length(), progress: length() ? position() / length() : 0, complete: !!job?.complete});
  const emit = () => onChange(snapshot());
  function reset() { generation++; unschedule(timer); unschedule(waitingTimer); timer = waitingTimer = null; controller?.abort(); controller = null; shouldPlay = false; audio.pause(); audio.removeAttribute('src'); audio.load(); source = ''; pendingTime = 0; for (const item of prepared.values()) item.dispose?.(); prepared.clear(); preparing.clear(); }
  function warm() {
    if (!prepareAudio || !controller || controller.signal.aborted) return;
    for (const [url, item] of prepared) { const at = parts.findIndex(part => part.url === url); if (at < index - 1 || at > index + 3) { item.dispose?.(); prepared.delete(url); } }
    for (let next = index + 1; next < Math.min(parts.length, index + 4) && preparing.size < 3; next++) {
      const url = parts[next].url; if (prepared.has(url) || preparing.has(url)) continue;
      const token = generation; preparing.add(url);
      void prepareAudio(url, {signal: controller.signal}).then(item => { if (token !== generation || next < index - 1 || next > index + 3) item.dispose?.(); else prepared.set(url, item); }).catch(() => {}).finally(() => { if (token === generation) preparing.delete(url); });
    }
  }
  function stop() { reset(); job = null; parts = []; index = 0; phase = 'idle'; error = ''; emit(); }
  function fail(message) { shouldPlay = false; audio.pause(); phase = 'error'; error = message; emit(); }
  function play() {
    const token = generation, playingSource = source; if (phase !== 'playing') phase = 'starting'; error = ''; emit();
    try { const result = audio.play(); result?.catch?.(problem => { if (token !== generation || source !== playingSource || !shouldPlay) return; shouldPlay = false; phase = problem.name === 'NotAllowedError' ? 'paused' : 'error'; error = problem.name === 'NotAllowedError' ? '音频已就绪，点按播放' : '音频暂时无法播放，请重试'; emit(); }); }
    catch { fail('音频暂时无法播放，请重试'); }
  }
  function loadPart(next, time = 0) {
    if (!parts[next]) { phase = job?.complete ? 'ended' : shouldPlay ? 'buffering' : 'paused'; emit(); return; }
    unschedule(waitingTimer); waitingTimer = null; audio.pause(); index = next; pendingTime = time; source = prepared.get(parts[index].url)?.url || assetUrl(parts[index].url); audio.src = source; audio.playbackRate = rate; audio.load(); warm();
    if (shouldPlay) play(); else { phase = 'paused'; emit(); }
  }
  audio.addEventListener('loadedmetadata', () => {
    if (!source || !parts[index]) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) parts[index].duration = audio.duration;
    if (pendingTime) { try { audio.currentTime = Math.min(pendingTime, parts[index].duration); pendingTime = 0; } catch {} }
    emit();
  });
  audio.addEventListener('playing', () => { unschedule(waitingTimer); waitingTimer = null; if (!source || !shouldPlay) { audio.pause(); return; } phase = 'playing'; error = ''; emit(); });
  audio.addEventListener('timeupdate', () => { if (source) emit(); });
  audio.addEventListener('waiting', () => { unschedule(waitingTimer); if (source && shouldPlay) waitingTimer = schedule(() => { waitingTimer = null; if (source && shouldPlay && audio.readyState < 3) { phase = 'buffering'; emit(); } }, 200); });
  audio.addEventListener('ended', () => {
    if (!source || !shouldPlay || !audio.ended) return;
    if (index + 1 < parts.length) loadPart(index + 1);
    else if (job?.complete) { shouldPlay = false; phase = 'ended'; emit(); }
    else if (job?.status === 'error') fail('后续音频暂时无法生成，请稍后重试');
    else { index = parts.length; source = ''; phase = 'buffering'; emit(); }
  });
  audio.addEventListener('error', () => { if (source && audio.error) { if (parts.length === 1 && parts[0].url.endsWith('/full.mp3') && originalParts.length) { const at = Number(audio.currentTime) || pendingTime || 0; source = ''; parts = originalParts; originalParts = []; index = 0; seek(at / (length() || 1)); } else fail('音频暂时无法播放，请重试'); } });
  function accept(data) {
    if (!data || !/^[a-f0-9]{64}$/.test(data.id) || !Array.isArray(data.segments) || data.segments.length > 1000 || data.segments.some(part => !Number.isFinite(part.duration) || part.duration <= 0 || !new RegExp('^/api/speech/audio/' + data.id + '/\\d{1,4}\\.mp3$').test(part.url))) throw Error('Invalid audio job');
    const whole = data.complete && (!job || parts.length === 1 && parts[0].url.endsWith('/full.mp3'));
    job = data; if (whole) originalParts = data.segments.map(part => ({...part}));
    const incoming = whole ? [{url: '/api/speech/audio/' + data.id + '/full.mp3', duration: data.segments.reduce((n, part) => n + part.duration, 0)}] : data.segments;
    parts = incoming.map((part, i) => ({...part, duration: parts[i]?.url === part.url ? parts[i].duration : part.duration})); warm();
    if (data.status === 'error' && !parts.length) { fail('本机语音暂时无法生成，请稍后重试'); return; }
    if (parts[index] && !source) loadPart(index);
    else if (data.complete && index >= parts.length && parts.length) { index = parts.length - 1; shouldPlay = false; phase = 'ended'; }
    emit();
  }
  function poll(token, delay = 1000) {
    if (token !== generation || job?.complete || job?.status === 'error') return;
    if (Date.now() > deadline) { fail('音频准备时间较长，请稍后重试'); return; }
    timer = schedule(async () => {
      timer = null; if (token !== generation) return;
      try { const data = await request('/jobs/' + job.id, {signal: controller.signal}); if (token !== generation) return; accept(data); poll(token); }
      catch { if (token === generation) poll(token, Math.min(delay * 2, 10000)); }
    }, delay);
  }
  async function start(autoPlay = true) {
    reset(); job = null; parts = []; index = 0; deadline = Date.now() + 31 * 60000;
    const token = generation; controller = new AbortController(); shouldPlay = autoPlay; phase = 'preparing'; error = ''; emit();
    try { const data = await request('/jobs', {method: 'POST', body: JSON.stringify(voiceId === 'wechat-native-v1' ? {articleId: Number(key), voiceId} : {text, voiceId}), signal: controller.signal}); if (token !== generation) return; accept(data); poll(token); }
    catch (problem) { if (token === generation && problem.name !== 'AbortError') fail(problem.status === 429 ? problem.message : '本机语音暂时不可用，请稍后重试'); }
  }
  function toggle() {
    if (!text) return;
    if (shouldPlay) { shouldPlay = false; audio.pause(); phase = 'paused'; emit(); return; }
    if (!job || phase === 'error') { void start(); return; }
    shouldPlay = true; error = '';
    if (phase === 'ended') loadPart(0);
    else if (source) play(); else loadPart(index);
  }
  function seek(fraction) {
    if (!length() || !Number.isFinite(Number(fraction))) return;
    const target = Math.max(0, Math.min(1, Number(fraction))) * length(); let at = 0, next = parts.length - 1;
    if (target >= length() && job?.complete) { shouldPlay = false; audio.pause(); phase = 'ended'; emit(); return; }
    for (let i = 0; i < parts.length; i++) { if (at + parts[i].duration >= target) { next = i; break; } at += parts[i].duration; }
    const time = Math.min(parts[next].duration, Math.max(0, target - at));
    if (next === index && source) { pendingTime = time; try { audio.currentTime = time; pendingTime = 0; } catch {} emit(); }
    else loadPart(next, time);
  }
  function setRate(value) { if (![0.75, 1, 1.25, 1.5, 2].includes(Number(value))) return; rate = Number(value); audio.playbackRate = rate; emit(); }
  function setVoice(value) { if (value === voiceId || !voices.some(voice => voice.id === value)) return; const resume = shouldPlay, hadJob = !!job; stop(); voiceId = value; if (hadJob) void start(resume); else emit(); }
  function update(nextKey, nextText) { const clean = String(nextText || '').trim(); if (key !== nextKey || text !== clean) { stop(); key = nextKey; text = clean; emit(); } }
  return {update, toggle, stop, setRate, setVoice, seek, skip: direction => seek((position() + Math.sign(direction) * 15) / (length() || 1)), snapshot};
}

export function createReaderSpeechUi(doc = globalThis.document, host = globalThis) {
  const title = doc?.getElementById('reader-title');
  if (!title) return null;
  const row = doc.createElement('div'); row.className = 'reader-listen';
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', '文章朗读');
  const headphones = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z"/></svg>';
  row.innerHTML = `<button type="button" class="reader-listen-toggle" disabled aria-label="听全文" aria-expanded="false" aria-controls="reader-speech-panel">${headphones}<span>听全文</span></button><span class="reader-listen-message" role="status" hidden></span>`;
  title.after(row);
  const panel = doc.createElement('section'); panel.id = 'reader-speech-panel'; panel.className = 'reader-speech-panel'; panel.hidden = true;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '文章播放器');
  panel.innerHTML = `<header class="speech-panel-header"><button type="button" class="speech-drag-handle" aria-label="拖动播放器" title="拖动，或用方向键移动"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"/></svg><span>听全文</span></button><button type="button" class="speech-collapse" aria-label="收起到侧边" title="收起到侧边"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><button type="button" class="speech-close" aria-label="关闭并停止朗读" title="关闭并停止朗读"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header><div class="speech-panel-body"><p class="speech-article-title"></p><div class="speech-transport"><button type="button" class="speech-previous" aria-label="上一句" title="上一句"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14m12-14-9 7 9 7Z"/></svg></button><button type="button" class="speech-toggle" aria-label="暂停朗读"><svg class="speech-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg><svg class="speech-pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg></button><button type="button" class="speech-next" aria-label="下一句" title="下一句"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 5l9 7-9 7Z"/></svg></button><label class="speech-rate-field"><span class="speech-sr-only">朗读语速</span><select class="speech-rate" aria-label="朗读语速"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div><div class="speech-position-heading"><label for="reader-speech-position">正文位置</label><output class="speech-position-value">0%</output></div><input id="reader-speech-position" class="speech-position" type="range" min="0" max="1000" value="0" step="1" aria-label="正文位置，按文字跳读"><label class="speech-voice-field"><span>设备声音</span><select class="speech-voice" aria-label="设备声音"><option value="">设备默认</option></select></label><p class="speech-panel-message" role="status" hidden></p></div>`;
  const dock = doc.createElement('button'); dock.type = 'button'; dock.className = 'reader-speech-dock'; dock.hidden = true;
  dock.setAttribute('aria-controls', panel.id); dock.setAttribute('aria-expanded', 'false');
  dock.innerHTML = `${headphones}<span class="speech-dock-indicator" aria-hidden="true"></span>`;
  doc.body.append(panel, dock);
  const entry = row.querySelector('.reader-listen-toggle'), entryLabel = entry.querySelector('span');
  const toggle = panel.querySelector('.speech-toggle'), range = panel.querySelector('.speech-position');
  const message = panel.querySelector('.speech-panel-message'), positionLabel = panel.querySelector('.speech-position-value');
  const voiceSelect = panel.querySelector('.speech-voice'), rateSelect = panel.querySelector('.speech-rate');
  panel.querySelector('.speech-voice-field').remove();
  let heading = '', currentKey = null, currentText = '', readingKey = null, readingText = '', readingHeading = '', checkingService = true, panelPoint = null, dockPoint = null, dockSide = 'right', panelMoved = false, scrubbing = false, suppressDockClick = false;
  const clock = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
  function bounds() {
    const v = host.visualViewport, style = host.getComputedStyle?.(panel);
    const inset = edge => Math.max(0, parseFloat(style?.getPropertyValue('--speech-inset-' + edge)) || 0);
    return {left: (v?.offsetLeft || 0) + inset('left') + 8, top: (v?.offsetTop || 0) + inset('top') + 8, right: (v?.offsetLeft || 0) + (v?.width || host.innerWidth) - inset('right') - 8, bottom: (v?.offsetTop || 0) + (v?.height || host.innerHeight) - inset('bottom') - 8};
  }
  const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
  function placePanel(point = panelMoved ? panelPoint : null) {
    const b = bounds(); panel.style.maxHeight = Math.max(64, b.bottom - b.top) + 'px'; panel.style.width = Math.min(320, b.right - b.left) + 'px';
    const rect = panel.getBoundingClientRect();
    panelPoint = {x: clamp(point?.x ?? b.right - rect.width - 8, b.left, b.right - rect.width), y: clamp(point?.y ?? b.bottom - rect.height - 12, b.top, b.bottom - rect.height)};
    panel.style.left = panelPoint.x + 'px'; panel.style.top = panelPoint.y + 'px';
  }
  function placeDock(point = dockPoint) {
    const b = bounds(), width = 44, height = 60;
    if (point?.x !== undefined) dockSide = point.x + width / 2 < (b.left + b.right) / 2 ? 'left' : 'right';
    dockPoint = {x: dockSide === 'left' ? b.left - 8 : b.right - width + 8, y: clamp(point?.y ?? panelPoint?.y ?? b.bottom - height - 12, b.top, b.bottom - height)};
    dock.dataset.side = dockSide; dock.style.left = dockPoint.x + 'px'; dock.style.top = dockPoint.y + 'px';
  }
  function openPanel({fromDock = false} = {}) {
    panel.hidden = false; dock.hidden = true;
    if (fromDock && dockPoint) {
      panelMoved = true;
      const b = bounds(), width = panel.getBoundingClientRect().width;
      placePanel({x: dockSide === 'left' ? b.left : b.right - width, y: dockPoint.y});
    } else placePanel();
    entry.setAttribute('aria-expanded', 'true'); toggle.focus({preventScroll: true});
  }
  function collapse() {
    const rect = panel.getBoundingClientRect();
    panel.hidden = true; dock.hidden = false;
    placeDock({x: rect.left + rect.width / 2 - 22, y: rect.top});
    entry.setAttribute('aria-expanded', 'false'); dock.focus({preventScroll: true});
  }
  function close({focus = false, clear = false} = {}) {
    panel.hidden = dock.hidden = true; entry.setAttribute('aria-expanded', 'false');
    if (clear) { currentKey = null; currentText = ''; player.update(null, ''); } else player.stop();
    if (focus) entry.focus({preventScroll: true});
  }
  const render = state => {
    const speaking = ['starting', 'playing', 'preparing', 'buffering'].includes(state.phase), isAudio = state.kind === 'audio';
    row.dataset.phase = panel.dataset.phase = dock.dataset.phase = state.phase;
    entry.disabled = !state.supported || !readingText || checkingService;
    toggle.disabled = !state.supported || !state.ready || checkingService;
    const readingActive = readingKey !== null && readingKey === currentKey;
    range.disabled = !state.supported || !state.ready || isAudio && !state.length;
    entryLabel.textContent = !readingActive ? '\u542c\u5168\u6587' : ['preparing', 'buffering'].includes(state.phase) ? '正在准备' : speaking ? '正在朗读' : state.phase === 'paused' ? '继续朗读' : state.phase === 'ended' ? '再听一遍' : '听全文';
    entry.setAttribute('aria-label', readingActive && speaking ? '打开朗读播放器' : entryLabel.textContent);
    entry.title = !state.supported ? '当前浏览器不支持朗读' : !readingText ? '正文就绪后可听全文' : '打开朗读播放器';
    toggle.setAttribute('aria-label', speaking ? '暂停朗读' : state.phase === 'ended' ? '再听一遍' : '继续朗读');
    toggle.title = toggle.getAttribute('aria-label'); toggle.setAttribute('aria-pressed', String(speaking));
    dock.setAttribute('aria-label', `展开朗读播放器，${['preparing', 'buffering'].includes(state.phase) ? '正在准备' : speaking ? '正在朗读' : state.phase === 'ended' ? '朗读结束' : '已暂停'}`); dock.title = dock.getAttribute('aria-label') + '；可拖动';
    if (!scrubbing) { range.value = String(Math.round(state.progress * 1000)); positionLabel.textContent = isAudio ? `${clock(state.position)} / ${clock(state.length)}` : Math.round(state.progress * 100) + '%'; }
    range.setAttribute('aria-label', isAudio ? '音频播放进度' : '正文位置，按文字跳读');
    range.setAttribute('aria-valuetext', `${positionLabel.textContent}，${isAudio ? '真实音频时间' : '按正文文字位置'}`);
    panel.querySelector('.speech-position-heading label').textContent = isAudio ? state.complete ? '播放进度' : '已就绪音频' : '正文位置';
    message.textContent = state.error || (state.phase === 'preparing' ? '正在准备音频…' : state.phase === 'buffering' ? '正在准备后续音频…' : ''); message.hidden = !message.textContent;
    const unsupported = row.querySelector('.reader-listen-message'); unsupported.textContent = !state.supported ? '当前浏览器不支持朗读' : ''; unsupported.hidden = !unsupported.textContent;
    panel.querySelector('.speech-previous').disabled = !state.ready || state.position === 0;
    panel.querySelector('.speech-next').disabled = !state.ready || state.phase === 'ended' || isAudio && !state.length;
    for (const [selector, label] of [['.speech-previous', isAudio ? '后退15秒' : '上一段'], ['.speech-next', isAudio ? '前进15秒' : '下一段']]) { const node = panel.querySelector(selector); node.setAttribute('aria-label', label); node.title = label; }
  };
  // Never silently substitute the phone's synthetic voice for the original audio.
  let player = typeof host.Audio === 'function'
    ? createArticleAudioPlayer({AudioCtor: host.Audio, request: (...args) => speechRequest(...args), assetUrl: path => host.orletBackend?.url(path) || path, voices: [{id: 'wechat-native-v1', name: '微信原声'}], onChange: render})
    : createSpeechPlayer({synth: null, Utterance: null, onChange: render});
  entry.addEventListener('click', () => {
    if (!readingText) return;
    if (currentKey !== readingKey || !currentText) {
      currentKey = readingKey; currentText = readingText; heading = readingHeading;
      panel.querySelector('.speech-article-title').textContent = heading;
      player.update(currentKey, currentText);
    }
    openPanel();
    if (!['playing', 'starting', 'preparing', 'buffering'].includes(player.snapshot().phase)) player.toggle();
  });
  toggle.addEventListener('click', () => player.toggle());
  panel.querySelector('.speech-previous').addEventListener('click', () => player.skip(-1));
  panel.querySelector('.speech-next').addEventListener('click', () => player.skip(1));
  rateSelect.addEventListener('change', event => player.setRate(event.target.value));
  voiceSelect.addEventListener('change', event => player.setVoice(event.target.value));
  range.addEventListener('input', () => { scrubbing = true; const state = player.snapshot(); positionLabel.textContent = state.kind === 'audio' ? `${clock(Number(range.value) / 1000 * state.length)} / ${clock(state.length)}` : Math.round(Number(range.value) / 10) + '%'; range.setAttribute('aria-valuetext', `${positionLabel.textContent}，${state.kind === 'audio' ? '真实音频时间' : '按正文文字位置'}`); });
  range.addEventListener('change', () => { scrubbing = false; player.seek(Number(range.value) / 1000); });
  range.addEventListener('blur', () => { if (scrubbing) { scrubbing = false; player.seek(Number(range.value) / 1000); } });
  panel.querySelector('.speech-collapse').addEventListener('click', collapse);
  panel.querySelector('.speech-close').addEventListener('click', () => close({focus: true}));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(); }
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.target.closest('input,select,.speech-drag-handle')) { event.preventDefault(); event.stopPropagation(); player.skip(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  dock.addEventListener('click', () => { if (suppressDockClick) { suppressDockClick = false; return; } openPanel({fromDock: true}); });
  function draggable(element, handle, isDock = false) {
    let drag;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const r = element.getBoundingClientRect(); drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: r.left, top: r.top, moved: false};
      handle.setPointerCapture?.(event.pointerId); handle.focus({preventScroll: true});
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) < 5 && !drag.moved) return;
      drag.moved = true; event.preventDefault(); const point = {x: drag.left + dx, y: drag.top + dy};
      if (isDock) {
        const b = bounds(); dockPoint = {x: clamp(point.x, b.left - 8, b.right - 36), y: clamp(point.y, b.top, b.bottom - 60)};
        dock.style.left = dockPoint.x + 'px'; dock.style.top = dockPoint.y + 'px';
      } else { panelMoved = true; placePanel(point); }
    });
    const finish = event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (isDock && drag.moved) { suppressDockClick = event.type === 'pointerup'; placeDock(); host.setTimeout?.(() => { suppressDockClick = false; }, 0); }
      drag = null; if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
    handle.addEventListener('keydown', event => {
      const step = {ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16]}[event.key];
      if (!step) return; event.preventDefault(); event.stopPropagation();
      const r = element.getBoundingClientRect(), point = {x: r.left + step[0], y: r.top + step[1]};
      if (isDock) { if (step[0]) point.x = step[0] < 0 ? bounds().left : bounds().right; placeDock(point); } else { panelMoved = true; placePanel(point); }
    });
  }
  draggable(panel, panel.querySelector('.speech-drag-handle')); draggable(dock, dock, true);
  function voicesChanged() {
    if (player.snapshot().kind === 'audio') return;
    const previous = voiceSelect.value, voices = (host.speechSynthesis?.getVoices?.() || []).filter(voice => voice.localService && /^zh([_-]|$)/i.test(voice.lang));
    voiceSelect.replaceChildren(); const defaultOption = doc.createElement('option'); defaultOption.value = ''; defaultOption.textContent = '设备默认'; voiceSelect.append(defaultOption);
    for (const voice of voices) { const option = doc.createElement('option'); option.value = voice.voiceURI; option.textContent = voice.name; voiceSelect.append(option); }
    voiceSelect.value = voices.some(voice => voice.voiceURI === previous) ? previous : '';
  }
  host.speechSynthesis?.addEventListener?.('voiceschanged', voicesChanged); voicesChanged();
  const resized = () => { if (!panel.hidden) placePanel(); if (!dock.hidden) placeDock(); };
  host.addEventListener?.('resize', resized); host.visualViewport?.addEventListener('resize', resized); host.visualViewport?.addEventListener('scroll', resized);
  host.addEventListener?.('pagehide', () => close());
  doc.getElementById('reader-content')?.addEventListener('play', event => { if (event.target?.tagName === 'VIDEO' || event.target?.tagName === 'AUDIO') player.stop(); }, true);
  player.stop();
  const speechRequest = async (path, options = {}) => {
    const response = await (host.orletBackend?.request || host.fetch.bind(host))('/api/speech' + path, {...options, ...(options.method ? {headers: {'Content-Type': 'application/json'}} : {})});
    const data = await response.json(); if (!response.ok) throw Object.assign(Error(data.error || '本机语音暂时不可用'), {status: response.status}); return data;
  };
  void speechRequest('/status', {signal: host.AbortSignal?.timeout?.(3500)}).then(status => {
    if (!status.available || !Array.isArray(status.voices) || !status.voices.length || typeof host.Audio !== 'function') return;
    const preferredVoice = status.engine === 'wechat-native' ? 'wechat-native-v1' : status.voices.some(voice => voice.id === 'kokoro-v11-fp32-zm054-s110-dc-rms012-peak089-v1') ? 'kokoro-v11-fp32-zm054-s110-dc-rms012-peak089-v1' : 'melo-zh';
    const voices = status.voices.filter(voice => voice.id === preferredVoice && typeof voice.name === 'string'); if (!voices.length) return;
    const previousRate = player.snapshot().rate; player.stop();
    player = createArticleAudioPlayer({AudioCtor: host.Audio, request: speechRequest, assetUrl: path => host.orletBackend?.url(path) || path, voices, onChange: render});
    voiceSelect.replaceChildren(); for (const voice of voices) { const option = doc.createElement('option'); option.value = voice.id; option.textContent = voice.name; voiceSelect.append(option); }
    player.setRate(previousRate); player.update(currentKey, currentText);
  }).catch(() => {}).finally(() => { checkingService = false; render(player.snapshot()); });
  return {
    stop() { close({clear: true}); },
    detach() { readingKey = null; readingText = ''; readingHeading = ''; render(player.snapshot()); },
    update({key, title: nextHeading}) {
      readingKey = key; readingHeading = nextHeading || '';
      const body = readerSpeechText(doc.getElementById('reader-content'));
      readingText = body ? readingHeading + '\n' + body : '';
      render(player.snapshot());
    }
  };
}

if (globalThis.document) globalThis.orletReaderSpeech = createReaderSpeechUi();
