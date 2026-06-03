const AI_SETTINGS_KEY = 'xhs_ai_settings';
const MAX_AI_SUMMARY_ROWS = 50;

const DEFAULT_AI_SETTINGS = Object.freeze({
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  enableAiSummary: true
});

const STOP_WORDS = [
  '搜索', '找出', '所有', '帮我', '整理', '电话号', '电话号码', '号码',
  '用过的', '相关', '里面', '包含', '一下', '给我', '的', '有', '带有',
  '含有', '字样', '资料', '数据', '记录'
];

const SYNONYMS = {
  douyin: ['抖音', 'douyin', 'tiktok', '短视频', '直播', '投流'],
  xhs: ['小红书', 'xhs', 'rednote', 'red'],
  wechat: ['微信', 'wechat', 'wx'],
  disabled: ['注销', '废号', '停用', '不可用', '失效', '作废'],
  enterprise: ['企业号', '企业', '公司', '营业厅'],
  photo: ['摄影', '拍摄', '摄影师', '拍照'],
  zhuhai: ['珠海', 'zhuhai'],
  hongkong: ['香港', 'hk', 'hong kong'],
  live: ['直播', 'live'],
  ads: ['投流', '广告', '投放']
};

let lastQueryState = {
  query: '',
  keywords: [],
  type: 'search',
  intent: null,
  rows: [],
  results: [],
  renderedText: ''
};

let pendingWritePlan = null;

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function phoneDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function getPlatformTerms() {
  return [
    { id: 'douyin', label: '抖音', terms: ['抖音', 'douyin'] },
    { id: 'tiktok', label: 'TikTok', terms: ['tiktok', 'tik tok'] },
    { id: 'threads', label: 'Threads', terms: ['threads'] },
    { id: 'instagram', label: 'Instagram', terms: ['instagram', 'ins', 'ig'] }
  ];
}

function readAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    return normalizeAiSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

function normalizeAiSettings(settings = {}) {
  const merged = { ...DEFAULT_AI_SETTINGS, ...settings };
  return {
    provider: String(merged.provider || DEFAULT_AI_SETTINGS.provider),
    baseUrl: String(merged.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(merged.apiKey || ''),
    model: String(merged.model || '').trim(),
    enableAiSummary: Boolean(merged.enableAiSummary)
  };
}

function saveAiSettings(settings, options = {}) {
  const normalized = normalizeAiSettings(settings);
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(normalized));
  if (options.updateForm) {
    hydrateSettingsForm();
  }
  return normalized;
}

async function saveAiSettingsToCloud() {
  const settings = saveAiSettings(collectSettingsForm());
  setStatus('保存中...');
  if (typeof window.cloudSave !== 'function') {
    setStatus('已保存本机', 'warning');
    showInlineStatus('AI 设置已保存到本机，云端同步未就绪', 'warning');
    return settings;
  }
  const result = await window.cloudSave({ source: 'manual', reason: 'ai-settings-save' });
  if (result?.status === 'saved' || result?.status === 'no_change') {
    setStatus('已保存', 'success');
    showInlineStatus('AI 设置已保存并同步云端', 'success');
  } else if (result?.status === 'cloud_newer') {
    setStatus('待同步', 'warning');
    showInlineStatus('检测到云端更新，请先云端加载后再保存 AI 设置', 'warning');
  } else {
    setStatus('本机已保存', 'warning');
    showInlineStatus('AI 设置已保存到本机，云端同步失败', 'warning');
  }
  return settings;
}

function setStatus(message, type = 'info') {
  const status = $('#aiSettingsStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `ai-status-pill ${type}`;
}

function showInlineStatus(message, type = 'info') {
  if (window.showSaveStatus) {
    window.showSaveStatus(message, type, 2200);
    return;
  }
  setStatus(message, type);
}

function hydrateSettingsForm() {
  const settings = readAiSettings();
  $('#aiProvider').value = settings.provider;
  $('#aiBaseUrl').value = settings.baseUrl;
  $('#aiApiKey').value = settings.apiKey;
  $('#aiModel').value = settings.model;
  $('#aiEnableSummary').checked = Boolean(settings.enableAiSummary);
  setStatus(localStorage.getItem(AI_SETTINGS_KEY) ? '已保存' : '未保存');
}

function collectSettingsForm() {
  return {
    provider: $('#aiProvider').value || DEFAULT_AI_SETTINGS.provider,
    baseUrl: ($('#aiBaseUrl').value || '').trim().replace(/\/+$/, ''),
    apiKey: $('#aiApiKey').value || '',
    model: ($('#aiModel').value || '').trim(),
    enableAiSummary: $('#aiEnableSummary').checked
  };
}

window.getXhsAiSettingsSnapshot = function getXhsAiSettingsSnapshot() {
  const raw = localStorage.getItem(AI_SETTINGS_KEY);
  if (!raw) return null;
  return readAiSettings();
};

window.applyXhsAiSettingsSnapshot = function applyXhsAiSettingsSnapshot(settings) {
  if (!settings || typeof settings !== 'object') return;
  saveAiSettings(settings, { updateForm: true });
  setStatus('已同步', 'success');
};

function classifyQuery(query) {
  const q = normalizeText(query);
  if (/重复|重复电话|重复手机号|重复号码/.test(q)) return 'duplicates';
  if (/所属人统计|每个人|按所属人|owner/.test(q)) return 'ownerStats';
  if (/分类统计|每个分类|按分类|分类有多少/.test(q)) return 'categoryStats';
  return 'search';
}

function detectPlatformIntent(query) {
  const q = normalizeText(query);
  const platformGroups = getPlatformTerms().concat([{ id: 'xhs', label: '小红书', terms: ['小红书', 'xhs', 'rednote'] }]);
  const wantsPhone = /手机|手机号|电话|号码|phone/.test(q);
  const wantsExistingValue = /有|存在|填写|填了|不为空|非空|有字符|有内容|账号|资料|选项/.test(q);
  const matched = platformGroups.find((platform) => platform.terms.some((term) => q.includes(normalizeText(term))));
  if (!matched) return null;
  if (!wantsPhone && !wantsExistingValue) return null;
  return {
    type: 'platformValuePresent',
    platformId: matched.id,
    platformLabel: matched.label,
    wantsPhone
  };
}

function detectWritePlan(query, rows = []) {
  const text = String(query || '').trim();
  if (!/(写进|写入|填入|填写|设置|改成|更新)/.test(text)) return null;

  const platform = getPlatformTerms().find((item) => {
    const normalizedText = normalizeText(text);
    return item.terms.some((term) => normalizedText.includes(normalizeText(term)));
  });
  if (!platform) return null;

  const phoneSet = new Set(rows.map((row) => String(row.phone || '').trim()).filter(Boolean));
  const phoneMatches = Array.from(text.matchAll(/\b\d{7,15}\b/g)).map((match) => ({
    phone: match[0],
    index: match.index || 0
  }));
  if (!phoneMatches.length) return null;

  const tasks = phoneMatches.map((match, index) => {
    const next = phoneMatches[index + 1]?.index ?? text.length;
    const segment = text.slice(match.index, next);
    let value = '';
    const valuePatterns = [
      /(?:数据|内容|资料|名称|账号|值)\s*(?:是|为|=|：|:)?\s*([^\n，。；;、]+)/,
      /(?:是|为|=|：|:)\s*([^\n，。；;、]+)/
    ];
    for (const pattern of valuePatterns) {
      const found = segment.match(pattern);
      if (found?.[1]) {
        value = found[1].trim();
        break;
      }
    }
    return {
      phone: match.phone,
      platformId: platform.id,
      platformLabel: platform.label,
      value,
      exists: phoneSet.has(match.phone)
    };
  }).filter((task) => task.value);

  if (!tasks.length) return null;
  return {
    type: 'writePlatformProfiles',
    query: text,
    platform,
    tasks
  };
}

function renderWritePlan(plan) {
  pendingWritePlan = plan;
  updateCount(plan.tasks.length);
  $('#aiKeywordSummary').textContent = `待写入：${plan.platform.label}`;
  const root = $('#aiResults');
  root.className = 'ai-results-list';
  root.innerHTML = plan.tasks.map((task) => `
    <article class="ai-result-item ${task.exists ? '' : 'ai-result-warning'}">
      <div class="ai-result-main">
        <strong>${escapeHtml(task.phone)}</strong>
        <span>${escapeHtml(task.platformLabel)}：${escapeHtml(task.value)}</span>
      </div>
      <div class="ai-result-reasons">
        <span>${task.exists ? '等待确认写入平台资料' : '未找到这个电话号码，确认后也会跳过'}</span>
      </div>
    </article>
  `).join('');
  const summary = $('#aiSummary');
  summary.hidden = false;
  summary.innerHTML = `
    <h3>AI 写入计划</h3>
    <pre>${escapeHtml(`我理解你要批量写入 ${plan.tasks.length} 条 ${plan.platform.label} 平台资料。确认后才会写入本地数据库并触发云端同步。`)}</pre>
    <div class="ai-confirm-actions">
      <button type="button" class="primary" id="btnAiConfirmWrite">确认写入数据库</button>
      <button type="button" class="ghost" id="btnAiCancelWrite">取消</button>
    </div>
  `;
  $('#btnAiConfirmWrite')?.addEventListener('click', confirmWritePlan);
  $('#btnAiCancelWrite')?.addEventListener('click', () => {
    pendingWritePlan = null;
    summary.hidden = true;
    showInlineStatus('已取消 AI 写入计划', 'info');
  });
  lastQueryState = {
    query: plan.query,
    keywords: [plan.platform.label, '写入'],
    type: 'writePlan',
    intent: plan,
    rows: [],
    results: plan.tasks.map((task) => ({ row: { phone: task.phone, xhs_name: task.value }, reasons: [`写入 ${task.platformLabel}`] })),
    renderedText: plan.tasks.map((task) => `${task.phone} ${task.platformLabel} ${task.value}`).join('\n')
  };
}

async function confirmWritePlan() {
  if (!pendingWritePlan?.tasks?.length) return;
  if (typeof window.applyXhsAiWritePlan !== 'function') {
    showInlineStatus('AI 写入接口未就绪', 'error');
    return;
  }
  const button = $('#btnAiConfirmWrite');
  if (button) button.disabled = true;
  try {
    const result = await window.applyXhsAiWritePlan(pendingWritePlan.tasks);
    const summary = $('#aiSummary');
    summary.hidden = false;
    summary.innerHTML = `<h3>写入完成</h3><pre>${escapeHtml(`已写入 ${result.changed} 条，跳过 ${result.skipped} 条。数据已进入现有自动同步流程。`)}</pre>`;
    showInlineStatus(`AI 已写入 ${result.changed} 条`, result.changed ? 'success' : 'warning');
    pendingWritePlan = null;
  } catch (error) {
    showInlineStatus(`AI 写入失败：${error.message || error}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function expandSynonyms(tokens) {
  const expanded = new Set(tokens);
  const lowered = tokens.map(normalizeText);
  Object.values(SYNONYMS).forEach((group) => {
    const normalizedGroup = group.map(normalizeText);
    if (normalizedGroup.some((term) => lowered.includes(term) || lowered.some((token) => token.includes(term)))) {
      group.forEach((term) => expanded.add(term));
    }
  });
  return Array.from(expanded).filter(Boolean);
}

function extractKeywords(query) {
  const original = String(query || '');
  const normalizedOriginal = normalizeText(original);
  const detectedTerms = [];
  Object.values(SYNONYMS).forEach((group) => {
    group.forEach((term) => {
      const normalizedTerm = normalizeText(term);
      if (normalizedTerm && normalizedOriginal.includes(normalizedTerm)) {
        detectedTerms.push(term);
      }
    });
  });

  let cleaned = original;
  STOP_WORDS.forEach((word) => {
    cleaned = cleaned.replaceAll(word, ' ');
  });
  cleaned = cleaned.replace(/[，。！？、,.!?|/\\()[\]{}:：;；"“”'‘’]+/g, ' ');
  let tokens = cleaned.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  tokens = tokens.concat(detectedTerms);
  if (!tokens.length && original.trim()) tokens = [original.trim()];
  return expandSynonyms(tokens);
}

function fieldSpecs(row) {
  const platformText = Object.values(row.platformProfiles || {})
    .map((item) => item.value || '')
    .join(' ');
  return [
    ['电话号码', row.phone],
    ['所属人', row.owner],
    ['微信实名人', row.wx_real],
    ['对应微信名', row.wx_name],
    ['小红书名称', row.xhs_name],
    ['分类', row.categoryName],
    ['备注', row.note1],
    ['平台资料', platformText]
  ];
}

function platformEntry(row, platformId) {
  const profiles = row.platformProfiles || {};
  if (profiles[platformId]) return profiles[platformId];
  const target = normalizeText(platformId);
  return Object.values(profiles).find((item) => {
    const name = normalizeText(item?.name);
    return name === target || name.includes(target);
  }) || null;
}

function platformValue(row, platformId) {
  const entry = platformEntry(row, platformId);
  return String(entry?.value || '').trim();
}

function findPlatformValueMatches(rows, intent) {
  return rows
    .filter((row) => platformValue(row, intent.platformId))
    .map((row) => ({
      row,
      reasons: [`${intent.platformLabel}资料有内容：${platformValue(row, intent.platformId)}`],
      answerValue: platformValue(row, intent.platformId)
    }));
}

function matchRow(row, keywords) {
  const reasons = [];
  const normalizedKeywords = keywords.map(normalizeText).filter(Boolean);
  const digitKeywords = keywords.map(phoneDigits).filter(Boolean);

  fieldSpecs(row).forEach(([label, value]) => {
    const normalizedValue = normalizeText(value);
    const digitValue = label === '电话号码' ? phoneDigits(value) : '';
    normalizedKeywords.forEach((keyword) => {
      if (normalizedValue && normalizedValue.includes(keyword)) {
        reasons.push(`${label}匹配：${keyword}`);
      }
    });
    digitKeywords.forEach((keyword) => {
      if (digitValue && digitValue.includes(keyword)) {
        reasons.push(`电话号码匹配：${keyword}`);
      }
    });
  });

  return Array.from(new Set(reasons));
}

function reasonRank(reasons) {
  const text = reasons.join(' ');
  if (text.includes('电话号码匹配')) return 1;
  if (text.includes('分类匹配')) return 2;
  if (text.includes('备注匹配')) return 3;
  if (text.includes('小红书名称匹配') || text.includes('对应微信名匹配') || text.includes('微信实名人匹配')) return 4;
  if (text.includes('所属人匹配')) return 5;
  return 6;
}

async function getRowsForAi() {
  if (typeof window.getXhsRowsForAi !== 'function') {
    throw new Error('AI 只读数据接口未就绪');
  }
  const rows = await window.getXhsRowsForAi();
  return Array.isArray(rows) ? rows : [];
}

function findMatches(rows, keywords) {
  return rows
    .map((row) => ({ row, reasons: matchRow(row, keywords) }))
    .filter((item) => item.reasons.length)
    .sort((a, b) => reasonRank(a.reasons) - reasonRank(b.reasons));
}

function ownerStats(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const owner = row.owner || '未填写';
    if (!map.has(owner)) map.set(owner, []);
    map.get(owner).push(row);
  });
  return Array.from(map.entries())
    .map(([label, group]) => ({ label, count: group.length, phones: group.map((row) => row.phone).filter(Boolean), rows: group }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

function categoryStats(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const category = row.categoryName || '未分类';
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(row);
  });
  return Array.from(map.entries())
    .map(([label, group]) => ({ label, count: group.length, phones: group.map((row) => row.phone).filter(Boolean), rows: group }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

function duplicatePhones(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const digits = phoneDigits(row.phone);
    if (!digits) return;
    if (!map.has(digits)) map.set(digits, []);
    map.get(digits).push(row);
  });
  return Array.from(map.entries())
    .filter(([, group]) => group.length > 1)
    .map(([phone, group]) => ({ phone, count: group.length, rows: group }))
    .sort((a, b) => b.count - a.count || a.phone.localeCompare(b.phone));
}

function rowToResultText(item) {
  const row = item.row || item;
  const reasons = item.reasons ? item.reasons.join('；') : '';
  return `| ${row.phone || ''} | ${row.owner || ''} | ${row.wx_real || ''} | ${row.wx_name || ''} | ${row.xhs_name || ''} | ${row.categoryName || ''} | ${(row.note1 || '').replace(/\n/g, ' ')} | ${reasons} |`;
}

function buildMarkdown(results) {
  return [
    '| 电话号码 | 所属人 | 微信实名人 | 对应微信名 | 小红书名称 | 分类 | 备注 | 匹配原因 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(rowToResultText)
  ].join('\n');
}

function buildAssistantAnswer(state) {
  if (!state.results.length) {
    return '我没有在本地号码数据里找到符合条件的记录。';
  }
  if (state.intent?.type === 'platformValuePresent') {
    const phones = state.results.map((item) => item.row.phone).filter(Boolean);
    const lines = state.results.map((item, index) => {
      const row = item.row;
      return `${index + 1}. ${row.phone || '-'}，所属人：${row.owner || '-'}，${state.intent.platformLabel}：${item.answerValue || '-'}`;
    });
    return [
      `我理解你的问题是：找出“${state.intent.platformLabel}”资料里已经填写内容的手机号。`,
      `本地匹配到 ${state.results.length} 条。`,
      '',
      ...lines,
      '',
      `手机号清单：${phones.join('、') || '-'}`
    ].join('\n');
  }
  if (state.type === 'ownerStats') {
    return [
      '我按所属人统计了当前本地号码数据：',
      '',
      ...state.results.map((group) => `- ${group.label}：${group.count} 条，${group.phones.join('、') || '无手机号'}`)
    ].join('\n');
  }
  if (state.type === 'categoryStats') {
    return [
      '我按分类统计了当前本地号码数据：',
      '',
      ...state.results.map((group) => `- ${group.label}：${group.count} 条，${group.phones.join('、') || '无手机号'}`)
    ].join('\n');
  }
  if (state.type === 'duplicates') {
    return state.results.length
      ? ['我找到了这些重复电话号码：', '', ...state.results.map((group) => `- ${group.phone}：出现 ${group.count} 次`)].join('\n')
      : '我没有发现重复电话号码。';
  }
  return [
    `我在本地数据里找到 ${state.results.length} 条相关记录：`,
    '',
    ...state.results.slice(0, 20).map((item, index) => {
      const row = item.row;
      return `${index + 1}. ${row.phone || '-'}，所属人：${row.owner || '-'}，小红书：${row.xhs_name || '-'}，原因：${item.reasons.join('；')}`;
    })
  ].join('\n');
}

function renderAssistantMessage(state) {
  const summary = $('#aiSummary');
  summary.hidden = false;
  summary.innerHTML = `
    <h3>AI 助手回答</h3>
    <pre>${escapeHtml(buildAssistantAnswer(state))}</pre>
  `;
}

function renderSearchResults(results, keywords) {
  const root = $('#aiResults');
  if (!results.length) {
    root.className = 'ai-results-empty';
    root.textContent = '没有找到匹配结果。';
    return;
  }
  root.className = 'ai-results-list';
  root.innerHTML = results.map(({ row, reasons }) => `
    <article class="ai-result-item">
      <div class="ai-result-main">
        <strong>${escapeHtml(row.phone || '-')}</strong>
        <span>${escapeHtml(row.xhs_name || row.wx_name || '未填写名称')}</span>
      </div>
      <div class="ai-result-fields">
        <span>所属人：${escapeHtml(row.owner || '-')}</span>
        <span>微信实名人：${escapeHtml(row.wx_real || '-')}</span>
        <span>对应微信名：${escapeHtml(row.wx_name || '-')}</span>
        <span>分类：${escapeHtml(row.categoryName || '未分类')}</span>
      </div>
      ${row.note1 ? `<p class="ai-result-note">${escapeHtml(row.note1)}</p>` : ''}
      <div class="ai-result-reasons">${reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
    </article>
  `).join('');
  lastQueryState.renderedText = buildMarkdown(results);
  $('#aiKeywordSummary').textContent = `关键词：${keywords.join(' / ') || '-'}`;
}

function renderStatsResults(groups, type) {
  const root = $('#aiResults');
  if (!groups.length) {
    root.className = 'ai-results-empty';
    root.textContent = '没有可统计的数据。';
    return;
  }
  root.className = 'ai-results-list';
  root.innerHTML = groups.map((group) => `
    <article class="ai-result-item ai-stat-item">
      <div class="ai-result-main">
        <strong>${escapeHtml(group.label || group.phone)}</strong>
        <span>${group.count} 条</span>
      </div>
      <p class="ai-result-note">${escapeHtml(group.phones.join('、') || group.rows.map((row) => row.phone).join('、'))}</p>
    </article>
  `).join('');
  const title = type === 'ownerStats' ? '所属人统计' : '分类统计';
  lastQueryState.renderedText = groups.map((group) => `- ${group.label}: ${group.count} 条\n  ${group.phones.join(', ')}`).join('\n');
  $('#aiKeywordSummary').textContent = `关键词：${title}`;
}

function renderDuplicateResults(groups) {
  const root = $('#aiResults');
  if (!groups.length) {
    root.className = 'ai-results-empty';
    root.textContent = '没有发现重复电话号码。';
    return;
  }
  root.className = 'ai-results-list';
  root.innerHTML = groups.map((group) => `
    <article class="ai-result-item ai-stat-item">
      <div class="ai-result-main">
        <strong>${escapeHtml(group.phone)}</strong>
        <span>出现 ${group.count} 次</span>
      </div>
      <div class="ai-result-fields">
        ${group.rows.map((row) => `<span>${escapeHtml(row.owner || '-')} / ${escapeHtml(row.xhs_name || row.wx_name || '-')}</span>`).join('')}
      </div>
    </article>
  `).join('');
  lastQueryState.renderedText = groups.map((group) => `- ${group.phone}: ${group.count} 次`).join('\n');
  $('#aiKeywordSummary').textContent = '关键词：重复电话';
}

function updateCount(count) {
  $('#aiMatchCount').textContent = `共匹配 ${count} 条`;
}

async function runLocalQuery() {
  const query = $('#aiUserInput').value.trim();
  const rows = await getRowsForAi();
  const writePlan = detectWritePlan(query, rows);
  if (writePlan) {
    renderWritePlan(writePlan);
    return lastQueryState;
  }
  const type = classifyQuery(query);
  const keywords = extractKeywords(query);
  const intent = detectPlatformIntent(query);
  $('#aiSummary').hidden = true;
  $('#aiSummary').innerHTML = '';

  lastQueryState = { query, keywords, type, intent, rows, results: [], renderedText: '' };

  if (intent?.type === 'platformValuePresent') {
    const results = findPlatformValueMatches(rows, intent);
    lastQueryState.results = results;
    renderSearchResults(results, [intent.platformLabel, '资料有内容']);
    updateCount(results.length);
    renderAssistantMessage(lastQueryState);
    return lastQueryState;
  }

  if (type === 'ownerStats') {
    const groups = ownerStats(rows);
    lastQueryState.results = groups;
    renderStatsResults(groups, type);
    updateCount(groups.length);
    renderAssistantMessage(lastQueryState);
    return lastQueryState;
  }
  if (type === 'categoryStats') {
    const groups = categoryStats(rows);
    lastQueryState.results = groups;
    renderStatsResults(groups, type);
    updateCount(groups.length);
    renderAssistantMessage(lastQueryState);
    return lastQueryState;
  }
  if (type === 'duplicates') {
    const groups = duplicatePhones(rows);
    lastQueryState.results = groups;
    renderDuplicateResults(groups);
    updateCount(groups.length);
    renderAssistantMessage(lastQueryState);
    return lastQueryState;
  }

  const results = findMatches(rows, keywords);
  lastQueryState.results = results;
  renderSearchResults(results, keywords);
  updateCount(results.length);
  renderAssistantMessage(lastQueryState);
  return lastQueryState;
}

async function copyText(text, successMessage) {
  if (!text) {
    showInlineStatus('没有可复制的内容', 'warning');
    return;
  }
  await navigator.clipboard.writeText(text);
  showInlineStatus(successMessage, 'success');
}

function phonesFromState() {
  if (lastQueryState.type === 'search') {
    return lastQueryState.results.map((item) => item.row.phone).filter(Boolean);
  }
  if (lastQueryState.type === 'duplicates') {
    return lastQueryState.results.flatMap((group) => group.rows.map((row) => row.phone)).filter(Boolean);
  }
  return lastQueryState.results.flatMap((group) => group.phones || []).filter(Boolean);
}

async function testConnection() {
  const settings = collectSettingsForm();
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    setStatus('缺少配置', 'warning');
    return;
  }
  setStatus('测试中...');
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: 'Reply OK only.' }],
        temperature: 0
      }),
      signal: controller.signal
    });
    window.clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus('连接成功', 'success');
  } catch (error) {
    setStatus(`连接失败：${error.message || error}`, 'error');
  }
}

function buildSummaryPrompt(state) {
  const payload = state.type === 'search'
    ? state.results.slice(0, MAX_AI_SUMMARY_ROWS).map(({ row, reasons }) => ({ row, reasons }))
    : state.results.slice(0, MAX_AI_SUMMARY_ROWS);
  const intentText = state.intent?.type === 'platformValuePresent'
    ? `用户意图：找出 ${state.intent.platformLabel} 资料字段已经填写内容的手机号。不要把平台名称本身当成匹配条件，只有该平台字段 value 非空才算匹配。`
    : `用户意图：${state.type}`;
  return [
    `用户问题：${state.query || '整理当前匹配结果'}`,
    intentText,
    `匹配数量：${state.results.length}`,
    `以下是最多 ${MAX_AI_SUMMARY_ROWS} 条匹配结果 JSON：`,
    JSON.stringify(payload, null, 2),
    '请像对话助手一样直接回答用户问题，先说明你理解的筛选条件，再给出号码清单和必要说明。不要编造，不要建议删除或修改数据。'
  ].join('\n');
}

async function summarizeResults() {
  const settings = readAiSettings();
  if (!settings.enableAiSummary) {
    setStatus('AI 总结未启用', 'warning');
    return;
  }
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    setStatus('请先配置 API', 'warning');
    return;
  }
  const state = await runLocalQuery();
  if (!state.results.length) {
    setStatus('无匹配结果', 'warning');
    return;
  }
  const summary = $('#aiSummary');
  summary.hidden = false;
  summary.textContent = `将发送 ${Math.min(state.results.length, MAX_AI_SUMMARY_ROWS)} 条匹配结果给 AI 总结...`;
  try {
    const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: 'system',
            content: '你是号码数据整理助手。只能基于用户提供的数据总结，不要编造，不要建议删除或修改数据。'
          },
          { role: 'user', content: buildSummaryPrompt(state) }
        ],
        temperature: 0.2
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('返回格式异常');
    summary.innerHTML = `<h3>AI 总结</h3><pre>${escapeHtml(content)}</pre>`;
  } catch (error) {
    summary.textContent = `AI 总结失败：${error.message || error}`;
    setStatus('总结失败', 'error');
  }
}

function setNumbersVisible(visible) {
  ['.controls-panel', '#panelCategories', '.data-panel'].forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    if (selector === '#panelCategories') {
      el.style.setProperty('display', 'none', 'important');
      return;
    }
    if (visible) {
      el.hidden = false;
      el.style.removeProperty('display');
    } else {
      el.hidden = true;
      el.style.setProperty('display', 'none', 'important');
    }
  });
}

function showAiAssistantPanel() {
  setNumbersVisible(false);
  const panel = $('#aiAssistantPanel');
  if (panel) panel.hidden = false;
  document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.sidebarAction === 'aiAssistant');
  });
  panel?.scrollIntoView({ block: 'start' });
}

function showNumbersPanel() {
  setNumbersVisible(true);
  const panel = $('#aiAssistantPanel');
  if (panel) panel.hidden = true;
  document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.sidebarAction === 'home');
  });
}

function bindAiAssistant() {
  if (!$('#aiAssistantPanel')) return;
  hydrateSettingsForm();

  $('#btnAiSaveSettings')?.addEventListener('click', async () => {
    const button = $('#btnAiSaveSettings');
    if (button) button.disabled = true;
    try {
      await saveAiSettingsToCloud();
    } catch (error) {
      setStatus('本机已保存', 'warning');
      showInlineStatus(`AI 设置同步失败：${error.message || error}`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  });
  $('#btnAiTestConnection')?.addEventListener('click', testConnection);
  $('#btnAiSearch')?.addEventListener('click', () => {
    runLocalQuery().catch((error) => {
      $('#aiResults').className = 'ai-results-empty';
      $('#aiResults').textContent = `查询失败：${error.message || error}`;
    });
  });
  $('#btnAiSummarize')?.addEventListener('click', summarizeResults);
  $('#btnAiClear')?.addEventListener('click', () => {
    $('#aiUserInput').value = '';
    $('#aiResults').className = 'ai-results-empty';
    $('#aiResults').textContent = '输入问题后点击“理解并回答”。';
    $('#aiSummary').hidden = true;
    updateCount(0);
    $('#aiKeywordSummary').textContent = '关键词：-';
    lastQueryState = { query: '', keywords: [], type: 'search', rows: [], results: [], renderedText: '' };
  });
  $('#btnAiBackToNumbers')?.addEventListener('click', showNumbersPanel);
  $('#btnAiCopyPhones')?.addEventListener('click', () => copyText(phonesFromState().join('\n'), '电话号码已复制'));
  $('#btnAiCopyFull')?.addEventListener('click', () => copyText(lastQueryState.renderedText, '完整结果已复制'));
  document.querySelectorAll('[data-ai-example]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#aiUserInput').value = button.dataset.aiExample || '';
      runLocalQuery().catch((error) => {
        $('#aiResults').className = 'ai-results-empty';
        $('#aiResults').textContent = `查询失败：${error.message || error}`;
      });
    });
  });
}

window.showXhsAiAssistant = showAiAssistantPanel;
window.showXhsNumbersPanel = showNumbersPanel;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindAiAssistant);
} else {
  bindAiAssistant();
}
