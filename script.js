/**********************************************************************
 * 1. 接口配置区 —— 后期你只需要改这里
 **********************************************************************/
const API_ENDPOINT = 'https://api.bugpk.com/api/short_videos';

// 【必须替换】视频链接对应的真实参数名。
// PHP 示例里是 ['key' => 'value']，这里先用占位名 'key'。
// 如果接口文档要求参数名为 url，则改成：const VIDEO_URL_PARAM_NAME = 'url';
// 如果要求参数名为 link，则改成：const VIDEO_URL_PARAM_NAME = 'link';
const VIDEO_URL_PARAM_NAME = 'url';

// 【可选】如果接口还需要 token、type、format 等参数，请在这里补充。
// 例如：const EXTRA_API_PARAMS = { token: '你的Token', format: 'json' };
const EXTRA_API_PARAMS = {
  // token: '请在这里填写你的接口 Token（如需要）',
  // type: 'json'
};

/**********************************************************************
 * 2. DOM 获取
 **********************************************************************/
const shareUrlEl = document.querySelector('#shareUrl');
const pasteBtn = document.querySelector('#pasteBtn');
const downloadBtn = document.querySelector('#downloadBtn');
const transcribeBtn = document.querySelector('#transcribeBtn');
const clearDownloadBtn = document.querySelector('#clearDownloadBtn');
const clearTranscriptBtn = document.querySelector('#clearTranscriptBtn');
const transcriptPasteBtn = document.querySelector('#transcriptPasteBtn');
const downloadStatus = document.querySelector('#downloadStatus');
const transcribeStatus = document.querySelector('#transcribeStatus');
const downloadBox = document.querySelector('#downloadBox');
const transcript = document.querySelector('#transcript');
const progressBar = document.querySelector('#progressBar');
const progressText = document.querySelector('#progressText');
const progressPercent = document.querySelector('#progressPercent');

/**********************************************************************
 * 3. 通用 UI 工具函数
 **********************************************************************/
function setLoading(target, message) {
  target.className = 'status';
  target.innerHTML = `<span class="spinner"></span><span>${message}</span>`;
}

function setStatus(target, message, type = '') {
  target.className = `status ${type}`.trim();
  target.textContent = message;
}

function setProgress(percent, text) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  progressBar.style.width = `${safePercent}%`;
  progressPercent.textContent = `${safePercent}%`;
  progressText.textContent = text;
}

function appendTranscriptLine(text, interim = false) {
  const empty = transcript.querySelector('.empty');
  if (empty) transcript.innerHTML = '';

  const line = document.createElement('p');
  line.className = interim ? 'line interim' : 'line';
  line.textContent = text;
  transcript.appendChild(line);
  transcript.scrollTop = transcript.scrollHeight;
  return line;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '未知';
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${restSeconds}`;
}

function getUserInputUrl() {
  const value = shareUrlEl.value.trim();
  if (!value) throw new Error('请先粘贴短视频分享链接。');
  return value;
}

function resetParsedResultForNextLink() {
  downloadBox.innerHTML = '';
  setStatus(downloadStatus, '已填入剪贴板链接，可以点击下载或音频转文字。');
  transcript.innerHTML = '<span class="empty">识别出的文字会显示在这里。</span>';
  setProgress(0, '准备中');
  setStatus(transcribeStatus, '等待点击“音频转文字”。');
}

async function handlePasteFromClipboard() {
  try {
    pasteBtn.disabled = true;
    pasteBtn.textContent = '读取中...';

    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error('当前浏览器不支持一键读取剪贴板，请使用 Ctrl + V 粘贴。');
    }

    const clipboardText = (await navigator.clipboard.readText()).trim();
    if (!clipboardText) throw new Error('剪贴板是空的，请先复制短视频分享链接。');

    // 一键粘贴模式：每次点击都直接覆盖旧链接，方便连续解析下一个视频。
    shareUrlEl.value = clipboardText;
    shareUrlEl.focus();
    resetParsedResultForNextLink();

    pasteBtn.textContent = '已粘贴';
    pasteBtn.classList.add('is-done');
    setTimeout(() => {
      pasteBtn.textContent = '粘贴';
      pasteBtn.classList.remove('is-done');
    }, 900);
  } catch (error) {
    // 如果浏览器拒绝剪贴板权限，给出明确兜底提示。
    setStatus(downloadStatus, `${error.message || String(error)} 如果浏览器反复弹权限，请用 http://localhost 打开网页并在网站设置里允许剪贴板权限。`, 'error');
    shareUrlEl.value = '';
    shareUrlEl.focus();
    pasteBtn.textContent = '粘贴';
  } finally {
    pasteBtn.disabled = false;
  }
}

function handleNativePaste() {
  // 手动 Ctrl + V 时也会自动清空上一次解析结果。
  setTimeout(() => {
    if (!shareUrlEl.value.trim()) return;
    resetParsedResultForNextLink();
    pasteBtn.textContent = '已粘贴';
    pasteBtn.classList.add('is-done');
    setTimeout(() => {
      pasteBtn.textContent = '粘贴';
      pasteBtn.classList.remove('is-done');
    }, 900);
  }, 0);
}

/**********************************************************************
 * 4. 解析接口调用
 **********************************************************************/
async function callShortVideoApi(shareUrl) {
  // 用 URLSearchParams 组装 GET 参数，等价于：
  // https://api.bugpk.com/api/short_videos?key=用户输入的链接
  // 其中 key 是占位参数名，请把上方 VIDEO_URL_PARAM_NAME 替换为接口真实参数名。
  const params = new URLSearchParams({
    [VIDEO_URL_PARAM_NAME]: shareUrl,
    ...EXTRA_API_PARAMS
  });

  const requestUrl = `${API_ENDPOINT}?${params.toString()}`;
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`接口请求失败：HTTP ${response.status}`);
  }

  const json = await response.json();
  return json;
}

/**********************************************************************
 * 5. 从接口 JSON 中提取“无水印 + 最高清晰度”视频直链
 *
 * 不同解析接口字段名可能不一致，所以这里做了多种兼容：
 * - 常见字段：url、video_url、play_url、download_url、nwm_url、nowatermark、hd_url
 * - 常见数组：videos、video、data.urls、data.video
 * - 质量字段：quality、resolution、width、height、size、bitrate
 *
 * 如果你拿到接口真实 JSON 后，建议把这里改成精确字段，例如：
 * return json.data.video.nowatermark_url;
 **********************************************************************/
function extractBestVideoUrl(json) {
  const candidates = [];
  const visited = new WeakSet();
  const urlKeyPattern = /(url|play|download|video|hd|nwm|nowater|watermark|src)/i;
  const videoExtPattern = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

  function scoreCandidate(url, container = {}, key = '') {
    let score = 0;
    const lowerKey = String(key).toLowerCase();
    const joined = `${lowerKey} ${JSON.stringify(container).toLowerCase()}`;

    if (/nowater|no_water|nwm|without|无水印/.test(joined)) score += 1000;
    if (/watermark|wm|水印/.test(joined) && !/nowater|no_water|nwm|无水印/.test(joined)) score -= 600;
    if (/hd|最高|原画|1080|2k|4k|best|origin|source/.test(joined)) score += 360;
    if (/720/.test(joined)) score += 160;
    if (/480|360/.test(joined)) score += 60;
    if (videoExtPattern.test(url)) score += 260;
    if (/https?:\/\//.test(url)) score += 80;

    const width = Number(container.width || container.w || 0);
    const height = Number(container.height || container.h || 0);
    const bitrate = Number(container.bitrate || container.bit_rate || 0);
    const size = Number(container.size || container.filesize || 0);
    score += Math.min(width * height / 1000, 900);
    score += Math.min(bitrate / 10, 400);
    score += Math.min(size / 100000, 300);

    candidates.push({ url, score, key, container });
  }

  function walk(node, parent = {}, key = '') {
    if (!node) return;

    if (typeof node === 'string') {
      const looksLikeVideoUrl = /^https?:\/\//i.test(node) && (urlKeyPattern.test(key) || videoExtPattern.test(node));
      if (looksLikeVideoUrl) scoreCandidate(node, parent, key);
      return;
    }

    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, parent, `${key}[${index}]`));
      return;
    }

    for (const [childKey, childValue] of Object.entries(node)) {
      if (typeof childValue === 'string' && /^https?:\/\//i.test(childValue) && urlKeyPattern.test(childKey)) {
        scoreCandidate(childValue, node, childKey);
      }
      walk(childValue, node, childKey);
    }
  }

  walk(json);
  candidates.sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    console.info('接口返回 JSON：', json);
    throw new Error('未能从接口返回中提取视频直链。请打开控制台查看 JSON，并在 extractBestVideoUrl() 中改成真实字段。');
  }

  console.table(candidates.map(({ url, score, key }) => ({ score, key, url })));
  return candidates[0].url;
}

async function resolveBestVideoUrl(statusTarget) {
  const shareUrl = getUserInputUrl();
  setLoading(statusTarget, '正在调用解析接口，请稍候...');
  const json = await callShortVideoApi(shareUrl);
  const videoUrl = extractBestVideoUrl(json);
  return { videoUrl, json };
}

function normalizeMediaUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&');
}

async function downloadVideoDirectly(videoUrl, fileName = `short-video-${Date.now()}.mp4`) {
  const safeVideoUrl = normalizeMediaUrl(videoUrl);

  try {
    // 优先用 fetch 把视频读取为 Blob，再创建本地 blob: 链接触发下载。
    // 这样点击按钮时不会跳转到视频直链网站。
    const response = await fetch(safeVideoUrl, {
      mode: 'cors',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, fileName);

    // 延迟释放，避免浏览器还没开始下载就撤销了 blob 链接。
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    setStatus(downloadStatus, '已开始下载视频。', 'success');
  } catch (error) {
    console.warn('Blob 下载失败：', error);

    // 不再兜底点击跨域直链：大多数浏览器会忽略 download 属性并跳转到视频页面，
    // 这正是用户反馈的问题。这里改为停留在当前页面并提示复制直链/右键另存。
    throw new Error('浏览器无法直接读取该跨域视频文件，已阻止跳转。请用“复制视频直链”，或在预览视频上右键选择“视频另存为”。');
  }
}

function triggerBrowserDownload(url, fileName) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**********************************************************************
 * 6. 下载视频逻辑
 **********************************************************************/
async function handleDownload() {
  try {
    downloadBtn.disabled = true;
    downloadBox.innerHTML = '';

    const { videoUrl } = await resolveBestVideoUrl(downloadStatus);
    const safeVideoUrl = normalizeMediaUrl(videoUrl);
    setStatus(downloadStatus, '已获取无水印视频，下面可直接预览或下载。', 'success');

    const video = document.createElement('video');
    video.className = 'video-preview';
    video.src = safeVideoUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const previewHint = document.createElement('div');
    previewHint.className = 'preview-hint';
    previewHint.textContent = '正在加载视频预览...';

    video.addEventListener('loadedmetadata', () => {
      previewHint.textContent = `视频预览已加载，可在线播放。时长：${formatDuration(video.duration)}`;
    });

    video.addEventListener('error', () => {
      previewHint.textContent = '当前视频直链不允许网页内嵌预览，已保留复制直链和打开预览按钮。';
      setStatus(downloadStatus, '已解析到视频直链，但该视频源禁止当前网页直接播放。请复制直链或点击“打开预览”。', 'warn');
    });

    const downloadAction = document.createElement('button');
    downloadAction.className = 'download-link';
    downloadAction.type = 'button';
    downloadAction.textContent = '下载视频';
    downloadAction.addEventListener('click', async () => {
      downloadAction.disabled = true;
      downloadAction.textContent = '正在准备下载...';
      await downloadVideoDirectly(safeVideoUrl);
      downloadAction.disabled = false;
      downloadAction.textContent = '下载视频';
    });

    const copyAction = document.createElement('button');
    copyAction.className = 'btn-soft';
    copyAction.type = 'button';
    copyAction.textContent = '复制视频直链';
    copyAction.addEventListener('click', async () => {
      await navigator.clipboard.writeText(safeVideoUrl);
      copyAction.textContent = '已复制';
      setTimeout(() => (copyAction.textContent = '复制视频直链'), 1200);
    });

    const openAction = document.createElement('a');
    openAction.className = 'btn-soft';
    openAction.href = safeVideoUrl;
    openAction.target = '_blank';
    openAction.rel = 'noopener noreferrer';
    openAction.textContent = '打开预览';

    const actions = document.createElement('div');
    actions.className = 'download-actions';
    actions.append(downloadAction, copyAction, openAction);

    downloadBox.append(video, previewHint, actions);
  } catch (error) {
    setStatus(downloadStatus, error.message || String(error), 'error');
  } finally {
    downloadBtn.disabled = false;
  }
}

/**********************************************************************
 * 7. 从接口 JSON 中提取文字内容
 *
 * 说明：浏览器前端无法凭空把视频声音转成文字，必须依赖解析接口或后端 ASR
 * 返回的字幕/文案/识别文本。这里会尽量兼容常见字段名，并把找到的文字展示出来。
 **********************************************************************/
function extractTranscriptText(json) {
  const candidates = [];
  const visited = new WeakSet();
  const textKeyPattern = /(text|transcript|subtitle|caption|captions|asr|speech|recognition|content|desc|description|title|文案|字幕|台词|文本|文字|识别)/i;
  const ignoredKeyPattern = /(url|uri|href|avatar|cover|image|thumb|video|music|audio|id|uid|sec_uid|token|cookie|signature)/i;

  function normalizeText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join('\n');
    if (typeof value === 'object') {
      const orderedKeys = ['text', 'content', 'sentence', 'caption', 'subtitle', 'transcript', 'words', 'word', 'line'];
      for (const key of orderedKeys) {
        if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
      }
      return '';
    }
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function scoreText(text, key, parent) {
    if (!text || text.length < 2) return;
    if (/^https?:\/\//i.test(text)) return;
    if (/^[\d\s:.,_-]+$/.test(text)) return;

    const joined = `${key} ${JSON.stringify(parent || {})}`.toLowerCase();
    let score = Math.min(text.length, 500);
    if (/transcript|subtitle|caption|asr|speech|recognition|字幕|台词|文本|文字|识别/.test(joined)) score += 1200;
    if (/desc|description|title|文案|标题/.test(joined)) score += 450;
    if (/content|text/.test(joined)) score += 300;
    if (/[一-龥]/.test(text)) score += 120;
    if (/[。！？；.!?;]/.test(text)) score += 80;
    candidates.push({ text, score, key });
  }

  function walk(node, parent = {}, key = '') {
    if (node == null) return;

    if (typeof node === 'string' || typeof node === 'number') {
      if (textKeyPattern.test(key) && !ignoredKeyPattern.test(key)) {
        scoreText(normalizeText(node), key, parent);
      }
      return;
    }

    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      if (textKeyPattern.test(key)) {
        const joined = normalizeText(node);
        scoreText(joined, key, parent);
      }
      node.forEach((item, index) => walk(item, parent, `${key}[${index}]`));
      return;
    }

    for (const [childKey, childValue] of Object.entries(node)) {
      if (textKeyPattern.test(childKey) && !ignoredKeyPattern.test(childKey)) {
        scoreText(normalizeText(childValue), childKey, node);
      }
      walk(childValue, node, childKey);
    }
  }

  walk(json);

  const unique = [];
  const seen = new Set();
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const key = item.text.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  console.table(unique.map(({ score, key, text }) => ({ score, key, text })));
  return unique;
}

function renderTranscriptText(text) {
  transcript.innerHTML = '';
  const lines = text
    .split(/\n+|(?<=[。！？!?；;])\s*/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    transcript.innerHTML = '<span class="empty">接口没有返回可展示的文字。</span>';
    return;
  }

  lines.forEach((line) => appendTranscriptLine(line));
}

async function handleTranscribePaste() {
  try {
    transcriptPasteBtn.disabled = true;
    transcriptPasteBtn.textContent = '读取中...';

    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error('当前浏览器不支持一键读取剪贴板，请使用 Ctrl + V 粘贴到上方链接框。');
    }

    const clipboardText = (await navigator.clipboard.readText()).trim();
    if (!clipboardText) throw new Error('剪贴板是空的，请先复制短视频分享链接。');

    shareUrlEl.value = clipboardText;
    resetParsedResultForNextLink();
    setStatus(transcribeStatus, '已粘贴链接，可以点击“音频转文字”。', 'success');

    transcriptPasteBtn.textContent = '已粘贴';
    transcriptPasteBtn.classList.add('is-done');
    setTimeout(() => {
      transcriptPasteBtn.textContent = '粘贴';
      transcriptPasteBtn.classList.remove('is-done');
    }, 900);
  } catch (error) {
    setStatus(transcribeStatus, error.message || String(error), 'error');
    transcriptPasteBtn.textContent = '粘贴';
  } finally {
    transcriptPasteBtn.disabled = false;
  }
}

async function handleTranscribe() {
  try {
    transcribeBtn.disabled = true;
    transcript.innerHTML = '<span class="empty">正在读取接口返回的文字...</span>';
    setProgress(12, '开始调用解析接口');
    setLoading(transcribeStatus, '正在调用解析接口并查找文字字段...');

    const shareUrl = getUserInputUrl();
    const json = await callShortVideoApi(shareUrl);
    setProgress(68, '接口返回成功，正在提取文字');

    const candidates = extractTranscriptText(json);
    if (!candidates.length) {
      console.info('接口返回 JSON：', json);
      transcript.innerHTML = '<span class="empty">接口没有返回文案、字幕或 ASR 文字。请打开控制台查看 JSON，确认接口是否支持视频转文字。</span>';
      setStatus(transcribeStatus, '没有找到可展示的文字字段。当前前端已取消音频提取，若接口本身不返回字幕/识别文本，需要更换支持 ASR 的接口或添加后端转写服务。', 'warn');
      setProgress(100, '未找到文字');
      return;
    }

    renderTranscriptText(candidates[0].text);
    setStatus(transcribeStatus, `已提取文字：来源字段 ${candidates[0].key}。`, 'success');
    setProgress(100, '文字提取完成');
  } catch (error) {
    setStatus(transcribeStatus, error.message || String(error), 'error');
    transcript.innerHTML = '<span class="empty">文字提取失败，请检查链接或接口返回。</span>';
    setProgress(0, '流程中断');
  } finally {
    transcribeBtn.disabled = false;
  }
}

/**********************************************************************
 * 9. 事件绑定
 **********************************************************************/
pasteBtn.addEventListener('click', handlePasteFromClipboard);
shareUrlEl.addEventListener('paste', handleNativePaste);
downloadBtn.addEventListener('click', handleDownload);
transcribeBtn.addEventListener('click', handleTranscribe);
transcriptPasteBtn.addEventListener('click', handleTranscribePaste);

clearDownloadBtn.addEventListener('click', () => {
  downloadBox.innerHTML = '';
  setStatus(downloadStatus, '等待输入链接并点击下载按钮。');
});

clearTranscriptBtn.addEventListener('click', () => {
  transcript.innerHTML = '<span class="empty">识别出的文字会显示在这里。</span>';
  setProgress(0, '准备中');
  setStatus(transcribeStatus, '等待点击“音频转文字”。');
});
