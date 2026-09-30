const PLATFORM_NAMES = {
  douyin: '抖音',
  kuaishou: '快手',
  channels: '视频号',
  bilibili: 'B站',
};
const PLATFORM_LOGOS = {
  douyin: { className: 'douyin', text: '抖' },
  kuaishou: { className: 'kuaishou', text: '快' },
  channels: { className: 'channels', text: '视' },
  bilibili: { className: 'bili', text: 'B' },
};
const COVER_REQUIREMENTS = {
  douyin: ['3:4', '4:3'],
  kuaishou: ['3:4'],
  channels: ['3:4'],
  bilibili: ['4:3', '16:9'],
};
const RATIO_VALUES = { '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9 };
const TITLE_FIELDS = {
  douyin: { id: 'titleDouyin', limit: 30 },
  kuaishou: { id: 'titleKuaishou', limit: 30 },
  channels: { id: 'titleChannels', limit: 100 },
  bilibili: { id: 'titleBilibili', limit: 80 },
};
const CHANNELS_SHORT_TITLE_ALLOWED = /^[\p{L}\p{N}\p{M} 《》“”"'‘’：:+＋?？%％℃]*$/u;

function normalizeChannelsShortTitle(value) {
  return String(value ?? '').replace(/[，,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function channelsShortTitleError(value) {
  const normalized = normalizeChannelsShortTitle(value);
  if (normalized.length > 16) return '视频号短标题不能超过16个字';
  if (!CHANNELS_SHORT_TITLE_ALLOWED.test(normalized)) return '视频号短标题包含不支持的特殊字符；仅支持书名号、引号、冒号、加号、问号、百分号和摄氏度，逗号会自动替换为空格';
  return '';
}
const PUBLISH_DRAFT_KEY = 'publishFormDraftV1';
const FIXED_TOPIC_KEY = 'publishFixedTopicV1';
const PUBLISH_VIDEO_DRAFT_KEY = 'publishVideoDraftMetaV1';
const PUBLISH_VIDEO_DRAFT_FILE = 'publish-video-draft';
const PUBLISH_COVER_DRAFT_KEY_PREFIX = 'publishCoverDraftMetaV1:';
const PUBLISH_COVER_DRAFT_FILE_PREFIX = 'publish-cover-draft-';
const PUBLISH_DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;
const PUBLISH_DRAFT_FIELDS = [
  'title',
  'titleDouyin',
  'titleKuaishou',
  'titleChannels',
  'titleChannelsShort',
  'titleBilibili',
  'topics',
  'intro',
  'publishLocation',
  'commonScheduleTime',
  'douyinScheduleTime',
  'kuaishouScheduleTime',
  'channelsScheduleTime',
  'bilibiliScheduleTime',
];

const form = document.getElementById('publishForm');
const button = document.getElementById('startButton');
const actionPanel = document.querySelector('.action-panel');
const submitTitle = document.getElementById('submitTitle');
const submitHint = document.getElementById('submitHint');
const video = document.getElementById('video');
const videoDrop = document.getElementById('videoDrop');
const videoPreview = document.getElementById('videoPreview');
const videoEmptyState = document.getElementById('videoEmptyState');
const videoPreviewState = document.getElementById('videoPreviewState');
const clearPublishButton = document.getElementById('clearPublishButton');
const fixedTopic = document.getElementById('fixedTopic');
const channelsHideLocation = document.getElementById('channelsHideLocation');
const channelsOriginal = document.getElementById('channelsOriginal');
const directPublishDouyin = document.getElementById('directPublishDouyin');
const directPublishKuaishou = document.getElementById('directPublishKuaishou');
const directPublishChannels = document.getElementById('directPublishChannels');
const directPublishBilibili = document.getElementById('directPublishBilibili');
const scheduleEnabled = document.getElementById('scheduleEnabled');
const scheduleFields = document.getElementById('scheduleFields');
const commonScheduleTime = document.getElementById('commonScheduleTime');
const commonScheduleDate = document.getElementById('commonScheduleDate');
const commonScheduleHour = document.getElementById('commonScheduleHour');
const commonScheduleMinute = document.getElementById('commonScheduleMinute');
const douyinScheduleTime = document.getElementById('douyinScheduleTime');
const douyinScheduleDate = document.getElementById('douyinScheduleDate');
const douyinScheduleHour = document.getElementById('douyinScheduleHour');
const douyinScheduleMinute = document.getElementById('douyinScheduleMinute');
const kuaishouScheduleTime = document.getElementById('kuaishouScheduleTime');
const kuaishouScheduleDate = document.getElementById('kuaishouScheduleDate');
const kuaishouScheduleHour = document.getElementById('kuaishouScheduleHour');
const kuaishouScheduleMinute = document.getElementById('kuaishouScheduleMinute');
const channelsScheduleTime = document.getElementById('channelsScheduleTime');
const bilibiliScheduleTime = document.getElementById('bilibiliScheduleTime');
const bilibiliScheduleDate = document.getElementById('bilibiliScheduleDate');
const bilibiliScheduleHour = document.getElementById('bilibiliScheduleHour');
const bilibiliScheduleMinute = document.getElementById('bilibiliScheduleMinute');
const platformScheduleTimes = {
  douyin: douyinScheduleTime,
  kuaishou: kuaishouScheduleTime,
  channels: channelsScheduleTime,
  bilibili: bilibiliScheduleTime,
};
const scheduleCard = document.getElementById('scheduleCard');
const completionModal = document.getElementById('completionModal');
const PLATFORM_TITLE_INPUT_IDS = ['titleDouyin', 'titleKuaishou', 'titleChannels', 'titleChannelsShort', 'titleBilibili'];
const platformTitleModal = document.getElementById('platformTitleModal');
const openPlatformTitles = document.getElementById('openPlatformTitles');
const platformTitleClose = document.getElementById('platformTitleClose');
const cancelPlatformTitles = document.getElementById('cancelPlatformTitles');
const savePlatformTitles = document.getElementById('savePlatformTitles');
const platformTitleSummary = document.getElementById('platformTitleSummary');
let platformTitleSnapshot = null;
const notifiedResults = new Set();
const notifiedLoginExpiredAccounts = new Set();
let videoPreviewUrl = null;
let videoMetadata = { width: 0, height: 0 };
let retainedVideoFile = null;
let accountsByPlatform = {};
let activeTaskId = localStorage.getItem('activePublishTaskId');
let taskMode = activeTaskId ? 'running' : 'idle';
let taskTimer;
let scheduleLimitsTimer;
let publishDraft = readPublishDraft();
let publishDraftTimer;
let draftVideoUploadPromise = null;
let draftVideoRestorePromise = null;
let restoringVideoDraft = false;
const draftCoverSavePromises = new Map();
let draftCoverRestorePromise = null;


function readPublishDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(PUBLISH_DRAFT_KEY) || 'null');
    if (!draft || Date.now() - Number(draft.saved_at || 0) > PUBLISH_DRAFT_MAX_AGE) return null;
    return draft;
  } catch (_) {
    return null;
  }
}

function restoreFixedTopic() {
  try { fixedTopic.value = localStorage.getItem(FIXED_TOPIC_KEY) || ''; } catch (_) {}
}

function saveFixedTopic() {
  try {
    if (fixedTopic.value.trim()) localStorage.setItem(FIXED_TOPIC_KEY, fixedTopic.value);
    else localStorage.removeItem(FIXED_TOPIC_KEY);
  } catch (_) {}
}

function savePublishDraft() {
  clearTimeout(publishDraftTimer);
  const fields = Object.fromEntries(PUBLISH_DRAFT_FIELDS.map((id) => [id, document.getElementById(id)?.value || '']));
  const declarations = Object.fromEntries(
    [...document.querySelectorAll('.declaration-card select')].map((select) => [select.name, select.value])
  );
  publishDraft = {
    fields,
    declarations,
    targets: selectedTargets(),
    channels_hide_location: channelsHideLocation.checked,
    channels_original: channelsOriginal.checked,
    direct_publish_douyin: directPublishDouyin.checked,
    direct_publish_kuaishou: directPublishKuaishou.checked,
    direct_publish_channels: directPublishChannels.checked,
    direct_publish_bilibili: directPublishBilibili.checked,
    schedule_enabled: scheduleEnabled.checked,
    video_metadata: videoMetadata,
    saved_at: Date.now(),
  };
  try { sessionStorage.setItem(PUBLISH_DRAFT_KEY, JSON.stringify(publishDraft)); } catch (_) {}
}

function schedulePublishDraftSave() {
  clearTimeout(publishDraftTimer);
  publishDraftTimer = setTimeout(savePublishDraft, 120);
}

function restorePublishDraftFields() {
  if (!publishDraft) return;
  const savedWidth = Number(publishDraft.video_metadata?.width) || 0;
  const savedHeight = Number(publishDraft.video_metadata?.height) || 0;
  if (savedWidth && savedHeight) videoMetadata = { width: savedWidth, height: savedHeight };
  Object.entries(publishDraft.fields || {}).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field) field.value = String(value ?? '');
  });
  channelsHideLocation.checked = Boolean(publishDraft.channels_hide_location);
  channelsOriginal.checked = Boolean(publishDraft.channels_original);
  directPublishDouyin.checked = Boolean(publishDraft.direct_publish_douyin);
  directPublishKuaishou.checked = Boolean(publishDraft.direct_publish_kuaishou);
  directPublishChannels.checked = Boolean(publishDraft.direct_publish_channels);
  directPublishBilibili.checked = Boolean(publishDraft.direct_publish_bilibili);
  scheduleEnabled.checked = Boolean(publishDraft.schedule_enabled);
  const kuaishouDeclarationAliases = {
    不添加声明: '',
    无需添加内容声明: '',
    请选择内容声明: '',
    为作品添加补充说明: '',
    内容由AI生成: '内容为AI生成',
    内容为虚构演绎: '演绎情节，仅供娱乐',
    内容为个人观点: '个人观点，仅供参考',
    内容含营销推广信息: '',
    素材来源于网络: '',
  };
  Object.entries(publishDraft.declarations || {}).forEach(([name, value]) => {
    const select = document.querySelector(`.declaration-card select[name="${name}"]`);
    if (!select) return;
    let normalized = name === 'declaration_kuaishou' ? (kuaishouDeclarationAliases[value] ?? value) : value;
    if (name === 'declaration_kuaishou' && !normalized) normalized = '为作品添加补充说明';
    const matched = [...select.options].find((option) => option.value === normalized || option.textContent === normalized);
    if (matched) select.value = matched.value;
  });
  [
    ['title', 'titleCount', 100],
    ['titleDouyin', 'titleDouyinCount', 30],
    ['titleKuaishou', 'titleKuaishouCount', 30],
    ['titleChannels', 'titleChannelsCount', 100],
    ['titleChannelsShort', 'titleChannelsShortCount', 16],
    ['titleBilibili', 'titleBilibiliCount', 80],
    ['intro', 'introCount', 1000],
  ].forEach(([id, countId, max]) => {
    document.getElementById(countId).textContent = `${document.getElementById(id).value.length} / ${max}`;
  });
}

function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fillTimeSelect(select, placeholder, values) {
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.appendChild(empty);
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function syncCommonScheduleControls() {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(commonScheduleTime.value);
  commonScheduleDate.value = match?.[1] || '';
  commonScheduleHour.value = match?.[2] || '';
  commonScheduleMinute.value = match?.[3] || '';
}

function updateCommonScheduleValue() {
  const date = commonScheduleDate.value;
  const hour = commonScheduleHour.value;
  const minute = commonScheduleMinute.value;
  commonScheduleTime.value = date && hour && minute ? `${date}T${hour}:${minute}` : '';
}

function refreshCommonScheduleOptions(now = Date.now()) {
  const step = 5 * 60 * 1000;
  const minimumTimestamp = Math.ceil((now + 2 * 60 * 60 * 1000) / step) * step;
  const maximumTimestamp = now + 14 * 24 * 60 * 60 * 1000;
  const minimumValue = localDateTimeValue(new Date(minimumTimestamp));
  const maximumValue = localDateTimeValue(new Date(maximumTimestamp));
  commonScheduleDate.min = minimumValue.slice(0, 10);
  commonScheduleDate.max = maximumValue.slice(0, 10);
  commonScheduleTime.dataset.minimum = minimumValue;
  commonScheduleTime.dataset.maximum = maximumValue;
  const date = commonScheduleDate.value;
  const setOptionAvailability = (option, disabled) => {
    option.disabled = disabled;
    option.textContent = option.value;
  };
  [...commonScheduleHour.options].forEach((option) => {
    if (!option.value || !date) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const hourStart = new Date(`${date}T${option.value}:00`).getTime();
    const hourEnd = new Date(`${date}T${option.value}:59`).getTime();
    setOptionAvailability(option, hourEnd < minimumTimestamp || hourStart > maximumTimestamp);
  });
  if (commonScheduleHour.selectedOptions[0]?.disabled) commonScheduleHour.value = '';
  const hour = commonScheduleHour.value;
  [...commonScheduleMinute.options].forEach((option) => {
    if (!option.value || !date || !hour) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const timestamp = new Date(`${date}T${hour}:${option.value}`).getTime();
    setOptionAvailability(option, timestamp < minimumTimestamp || timestamp > maximumTimestamp);
  });
  if (commonScheduleMinute.selectedOptions[0]?.disabled) commonScheduleMinute.value = '';
  updateCommonScheduleValue();
}

function syncDouyinScheduleControls() {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(douyinScheduleTime.value);
  douyinScheduleDate.value = match?.[1] || '';
  douyinScheduleHour.value = match?.[2] || '';
  douyinScheduleMinute.value = match?.[3] || '';
}

function updateDouyinScheduleValue() {
  const date = douyinScheduleDate.value;
  const hour = douyinScheduleHour.value;
  const minute = douyinScheduleMinute.value;
  douyinScheduleTime.value = date && hour && minute ? `${date}T${hour}:${minute}` : '';
}

function refreshDouyinScheduleOptions(now = Date.now()) {
  const minuteStep = 60 * 1000;
  const minimumTimestamp = Math.ceil((now + 2 * 60 * 60 * 1000) / minuteStep) * minuteStep;
  const maximumTimestamp = now + 14 * 24 * 60 * 60 * 1000;
  const minimumValue = localDateTimeValue(new Date(minimumTimestamp));
  const maximumValue = localDateTimeValue(new Date(maximumTimestamp));
  douyinScheduleDate.min = minimumValue.slice(0, 10);
  douyinScheduleDate.max = maximumValue.slice(0, 10);
  douyinScheduleTime.dataset.minimum = minimumValue;
  douyinScheduleTime.dataset.maximum = maximumValue;
  const date = douyinScheduleDate.value;
  const setOptionAvailability = (option, disabled) => {
    option.disabled = disabled;
    option.textContent = option.value;
  };
  [...douyinScheduleHour.options].forEach((option) => {
    if (!option.value || !date) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const hourStart = new Date(`${date}T${option.value}:00`).getTime();
    const hourEnd = new Date(`${date}T${option.value}:59`).getTime();
    setOptionAvailability(option, hourEnd < minimumTimestamp || hourStart > maximumTimestamp);
  });
  if (douyinScheduleHour.selectedOptions[0]?.disabled) douyinScheduleHour.value = '';
  const hour = douyinScheduleHour.value;
  [...douyinScheduleMinute.options].forEach((option) => {
    if (!option.value || !date || !hour) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const timestamp = new Date(`${date}T${hour}:${option.value}`).getTime();
    setOptionAvailability(option, timestamp < minimumTimestamp || timestamp > maximumTimestamp);
  });
  if (douyinScheduleMinute.selectedOptions[0]?.disabled) douyinScheduleMinute.value = '';
  updateDouyinScheduleValue();
}

function syncKuaishouScheduleControls() {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(kuaishouScheduleTime.value);
  kuaishouScheduleDate.value = match?.[1] || '';
  kuaishouScheduleHour.value = match?.[2] || '';
  kuaishouScheduleMinute.value = match?.[3] || '';
}

function updateKuaishouScheduleValue() {
  const date = kuaishouScheduleDate.value;
  const hour = kuaishouScheduleHour.value;
  const minute = kuaishouScheduleMinute.value;
  kuaishouScheduleTime.value = date && hour && minute ? `${date}T${hour}:${minute}` : '';
}

function refreshKuaishouScheduleOptions(now = Date.now()) {
  const minuteStep = 60 * 1000;
  const minimumTimestamp = Math.ceil((now + 5 * 60 * 1000) / minuteStep) * minuteStep;
  const maximumTimestamp = now + 14 * 24 * 60 * 60 * 1000;
  const minimumValue = localDateTimeValue(new Date(minimumTimestamp));
  const maximumValue = localDateTimeValue(new Date(maximumTimestamp));
  kuaishouScheduleDate.min = minimumValue.slice(0, 10);
  kuaishouScheduleDate.max = maximumValue.slice(0, 10);
  kuaishouScheduleTime.dataset.minimum = minimumValue;
  kuaishouScheduleTime.dataset.maximum = maximumValue;
  const date = kuaishouScheduleDate.value;
  const setOptionAvailability = (option, disabled) => {
    option.disabled = disabled;
    option.textContent = option.value;
  };
  [...kuaishouScheduleHour.options].forEach((option) => {
    if (!option.value || !date) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const hourStart = new Date(`${date}T${option.value}:00`).getTime();
    const hourEnd = new Date(`${date}T${option.value}:59`).getTime();
    setOptionAvailability(option, hourEnd < minimumTimestamp || hourStart > maximumTimestamp);
  });
  if (kuaishouScheduleHour.selectedOptions[0]?.disabled) kuaishouScheduleHour.value = '';
  const hour = kuaishouScheduleHour.value;
  [...kuaishouScheduleMinute.options].forEach((option) => {
    if (!option.value || !date || !hour) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const timestamp = new Date(`${date}T${hour}:${option.value}`).getTime();
    setOptionAvailability(option, timestamp < minimumTimestamp || timestamp > maximumTimestamp);
  });
  if (kuaishouScheduleMinute.selectedOptions[0]?.disabled) kuaishouScheduleMinute.value = '';
  updateKuaishouScheduleValue();
}

function syncBilibiliScheduleControls() {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(bilibiliScheduleTime.value);
  bilibiliScheduleDate.value = match?.[1] || '';
  bilibiliScheduleHour.value = match?.[2] || '';
  bilibiliScheduleMinute.value = match?.[3] || '';
}

function updateBilibiliScheduleValue() {
  const date = bilibiliScheduleDate.value;
  const hour = bilibiliScheduleHour.value;
  const minute = bilibiliScheduleMinute.value;
  bilibiliScheduleTime.value = date && hour && minute ? `${date}T${hour}:${minute}` : '';
}

function updateScheduleUi() {
  const enabled = scheduleEnabled.checked;
  const selected = new Set(selectedPlatforms());
  const minuteStep = 60 * 1000;
  const now = Date.now();
  scheduleFields.hidden = !enabled;
  commonScheduleTime.disabled = !enabled;
  commonScheduleTime.required = false;
  commonScheduleDate.disabled = !enabled;
  commonScheduleHour.disabled = !enabled;
  commonScheduleMinute.disabled = !enabled;
  commonScheduleDate.required = false;
  commonScheduleHour.required = false;
  commonScheduleMinute.required = false;
  refreshCommonScheduleOptions(now);
  document.querySelectorAll('.schedule-time-field[data-platform]').forEach((field) => {
    const key = field.dataset.platform;
    const active = enabled && selected.has(key);
    field.classList.toggle('inactive', !active);
    const input = platformScheduleTimes[key];
    input.disabled = !active;
    if (key === 'bilibili') return;
    const minimumLead = key === 'douyin' ? 2 * 60 * 60 * 1000 : 5 * 60 * 1000;
    const maximumDays = key === 'douyin' || key === 'kuaishou' ? 14 : 15;
    const minimum = new Date(Math.ceil((now + minimumLead) / minuteStep) * minuteStep);
    const maximum = new Date(now + maximumDays * 24 * 60 * 60 * 1000);
    if (key === 'douyin') {
      douyinScheduleDate.disabled = !active;
      douyinScheduleHour.disabled = !active;
      douyinScheduleMinute.disabled = !active;
      douyinScheduleDate.required = false;
      douyinScheduleHour.required = false;
      douyinScheduleMinute.required = false;
      refreshDouyinScheduleOptions(now);
      return;
    }
    if (key === 'kuaishou') {
      kuaishouScheduleDate.disabled = !active;
      kuaishouScheduleHour.disabled = !active;
      kuaishouScheduleMinute.disabled = !active;
      kuaishouScheduleDate.required = false;
      kuaishouScheduleHour.required = false;
      kuaishouScheduleMinute.required = false;
      refreshKuaishouScheduleOptions(now);
      return;
    }
    input.required = false;
    input.min = localDateTimeValue(minimum);
    input.max = localDateTimeValue(maximum);
  });
  const bilibiliActive = enabled && selected.has('bilibili');
  bilibiliScheduleDate.disabled = !bilibiliActive;
  bilibiliScheduleHour.disabled = !bilibiliActive;
  bilibiliScheduleMinute.disabled = !bilibiliActive;
  bilibiliScheduleDate.required = false;
  bilibiliScheduleHour.required = false;
  bilibiliScheduleMinute.required = false;
  const bilibiliMinimum = new Date(Math.ceil((now + 5 * 60 * 1000) / minuteStep) * minuteStep);
  const bilibiliMaximum = new Date(now + 15 * 24 * 60 * 60 * 1000);
  bilibiliScheduleDate.min = localDateTimeValue(bilibiliMinimum).slice(0, 10);
  bilibiliScheduleDate.max = localDateTimeValue(bilibiliMaximum).slice(0, 10);
  scheduleCard.classList.toggle('active', enabled);
}

function timeValueError(input, platformName = '', minimumLead = 5 * 60 * 1000, maximumDays = 15) {
  const prefix = `${platformName}定时发布时间`;
  const value = typeof input === 'string' ? input : input.value;
  if (!value) return `请选择完整的${platformName}定时发布日期和时间`;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return `${prefix}无效，请重新选择`;
  if (timestamp < Date.now() + minimumLead) {
    return minimumLead >= 60 * 60 * 1000
      ? `${prefix}至少需要晚于当前时间 ${minimumLead / (60 * 60 * 1000)} 小时`
      : `${prefix}至少需要晚于当前时间 ${minimumLead / (60 * 1000)} 分钟`;
  }
  if (timestamp > Date.now() + maximumDays * 24 * 60 * 60 * 1000) return `${prefix}不能超过当前时间 ${maximumDays} 天`;
  return '';
}

function scheduledTimeError() {
  if (!scheduleEnabled.checked) return '';
  const selected = new Set(selectedPlatforms());
  if (commonScheduleTime.value) {
    const commonError = timeValueError(commonScheduleTime.value, '通用', 2 * 60 * 60 * 1000, 14);
    if (commonError) return commonError;
    if (Number(commonScheduleTime.value.slice(-2)) % 5 !== 0) return '通用发布时间的分钟只能选择 00、05、10…55';
  }
  for (const key of selected) {
    const input = platformScheduleTimes[key];
    const platformName = PLATFORM_NAMES[key];
    const effectiveValue = input.value || commonScheduleTime.value;
    if (!effectiveValue) return `请设置通用发布时间，或单独设置${platformName}发布时间`;
    const error = key === 'douyin'
      ? timeValueError(effectiveValue, platformName, 2 * 60 * 60 * 1000, 14)
      : key === 'kuaishou'
        ? timeValueError(effectiveValue, platformName, 5 * 60 * 1000, 14)
        : timeValueError(effectiveValue, platformName);
    if (error) return error;
    if (key === 'bilibili' && Number(effectiveValue.slice(-2)) % 5 !== 0) return 'B站发布时间的分钟只能选择 00、05、10…55';
  }
  return '';
}

function restorePublishAccountSelections() {
  const targets = new Set((publishDraft?.targets || []).map((item) => `${item.platform_key}:${item.account_id}`));
  if (!targets.size) return;
  document.querySelectorAll('.publish-account-option input:not(:disabled)').forEach((input) => {
    input.checked = targets.has(`${input.dataset.platform}:${input.value}`);
  });
}

function selectedTargets() {
  return [...document.querySelectorAll('.publish-account-option input:checked:not(:disabled)')]
    .map((item) => ({ platform_key: item.dataset.platform, account_id: item.value }));
}

function selectedPlatforms() {
  return [...new Set(selectedTargets().map((item) => item.platform_key))];
}

function platformCoverRatios(key) {
  if (key === 'channels' && videoMetadata.width > videoMetadata.height) return ['3:4', '4:3'];
  return COVER_REQUIREMENTS[key] || [];
}

function requiredCovers(selected = selectedPlatforms()) {
  return new Set(selected.flatMap(platformCoverRatios));
}

function incompletePlatformCovers(selected = selectedPlatforms()) {
  const uploaded = new Set([...document.querySelectorAll('.cover-card')]
    .filter((card) => card.querySelector('input').files[0])
    .map((card) => card.dataset.ratio));
  return selected.map((key) => {
    const required = platformCoverRatios(key);
    const selectedRatios = required.filter((ratio) => uploaded.has(ratio));
    return { key, missing: required.filter((ratio) => !uploaded.has(ratio)), selectedCount: selectedRatios.length };
  }).filter((item) => item.selectedCount > 0 && item.missing.length > 0);
}

function accountAvatar(account, key) {
  const avatar = document.createElement('span');
  avatar.className = 'publish-account-avatar';
  const fallback = document.createElement('b');
  fallback.textContent = (account.nickname || PLATFORM_NAMES[key]).slice(0, 1);
  avatar.appendChild(fallback);
  if (account.avatar) {
    const image = document.createElement('img');
    image.src = account.avatar;
    image.alt = `${account.nickname || PLATFORM_NAMES[key]}头像`;
    image.addEventListener('load', () => avatar.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    avatar.appendChild(image);
  }
  return avatar;
}

function accountDisplayName(account, key) {
  const nickname = account.nickname || `${PLATFORM_NAMES[key]}账号`;
  return account.remark ? `${nickname}（${account.remark}）` : nickname;
}

function updateAccountSelectionUi() {
  document.querySelectorAll('.publish-account-option').forEach((option) => {
    option.classList.toggle('selected', option.querySelector('input').checked);
  });
  updateCovers();
  updateDeclarations();
  updatePlatformTitleFields();
  updateScheduleUi();
  const count = selectedTargets().length;
  if (taskMode !== 'running') submitHint.textContent = count ? `已选择 ${count} 个账号，提交后每个账号会打开一个独立 Chrome 窗口` : '请在上方勾选本次需要发布的账号';
}

function renderPublishAccounts(accounts) {
  accountsByPlatform = accounts || {};
  const root = document.getElementById('accountTargetList');
  root.replaceChildren();
  Object.keys(PLATFORM_NAMES).forEach((key) => {
    const group = document.createElement('section');
    group.className = 'publish-account-group';
    group.dataset.platform = key;
    const heading = document.createElement('header');
    const logo = document.createElement('span');
    logo.className = `platform-logo ${PLATFORM_LOGOS[key].className}`;
    logo.textContent = PLATFORM_LOGOS[key].text;
    const title = document.createElement('strong');
    const items = Array.isArray(accountsByPlatform[key]) ? accountsByPlatform[key] : [];
    title.textContent = `${PLATFORM_NAMES[key]} · ${items.length} 个账号`;
    heading.append(logo, title);
    const list = document.createElement('div');
    list.className = 'publish-account-list';
    if (!items.length) {
      const empty = document.createElement('a');
      empty.className = 'publish-account-empty';
      empty.href = '/accounts';
      empty.textContent = `尚未绑定${PLATFORM_NAMES[key]}账号，点击前往绑定`;
      list.appendChild(empty);
    } else {
      items.forEach((account) => {
        const option = document.createElement('label');
        option.className = `publish-account-option${account.bound ? '' : ' disabled'}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = account.id;
        input.dataset.platform = key;
        input.disabled = !account.bound;
        input.addEventListener('change', () => {
          updateAccountSelectionUi();
        });
        const identity = document.createElement('span');
        identity.className = 'publish-account-identity';
        const name = document.createElement('strong');
        name.textContent = accountDisplayName(account, key);
        const remark = document.createElement('small');
        remark.textContent = account.bound ? '已保存独立登录状态' : (account.status_message || '登录已失效，请重新登录');
        identity.append(name, remark);
        const check = document.createElement('i');
        check.textContent = '✓';
        option.append(input, accountAvatar(account, key), identity, check);
        list.appendChild(option);
      });
    }
    group.append(heading, list);
    root.appendChild(group);
  });
  restorePublishAccountSelections();
  updateAccountSelectionUi();
}

async function loadPublishAccounts() {
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || '读取账号列表失败');
  renderPublishAccounts(result.accounts || {});
}

function updateDeclarations() {
  const selected = new Set(selectedPlatforms());
  document.querySelectorAll('.declaration-card').forEach((card) => {
    const active = selected.has(card.dataset.platform);
    const select = card.querySelector('select');
    card.classList.toggle('active', active);
    card.classList.toggle('inactive', !active);
    if (select) select.disabled = !active;
  });
}

function updatePlatformTitleFields() {
  document.querySelectorAll('.platform-title-field').forEach((field) => {
    const input = field.querySelector('input');
    field.classList.add('active');
    field.classList.remove('inactive');
    field.removeAttribute('aria-disabled');
    if (!input) return;
    input.disabled = false;
  });
  updatePlatformTitleSummary();
}

function updatePlatformTitleSummary() {
  const customCount = PLATFORM_TITLE_INPUT_IDS.filter((id) => document.getElementById(id).value.trim()).length;
  platformTitleSummary.textContent = customCount
    ? `已自定义 ${customCount} 项，其余使用通用标题`
    : '默认使用通用标题';
  platformTitleSummary.classList.toggle('has-custom', customCount > 0);
}

function updatePlatformTitleCounts() {
  [
    ['titleDouyin', 'titleDouyinCount', 30],
    ['titleKuaishou', 'titleKuaishouCount', 30],
    ['titleChannels', 'titleChannelsCount', 100],
    ['titleChannelsShort', 'titleChannelsShortCount', 16],
    ['titleBilibili', 'titleBilibiliCount', 80],
  ].forEach(([id, countId, max]) => {
    document.getElementById(countId).textContent = `${document.getElementById(id).value.length} / ${max}`;
  });
  updatePlatformTitleSummary();
}

function openPlatformTitleEditor() {
  platformTitleSnapshot = Object.fromEntries(PLATFORM_TITLE_INPUT_IDS.map((id) => [id, document.getElementById(id).value]));
  platformTitleModal.hidden = false;
  document.body.classList.add('platform-title-modal-open');
  requestAnimationFrame(() => document.getElementById('titleDouyin').focus());
}

function closePlatformTitleEditor(restoreSnapshot = false) {
  if (restoreSnapshot && platformTitleSnapshot) {
    PLATFORM_TITLE_INPUT_IDS.forEach((id) => { document.getElementById(id).value = platformTitleSnapshot[id] || ''; });
  }
  platformTitleSnapshot = null;
  platformTitleModal.hidden = true;
  document.body.classList.remove('platform-title-modal-open');
  updatePlatformTitleCounts();
  schedulePublishDraftSave();
  openPlatformTitles.focus();
}

function resetButton() {
  taskMode = 'idle';
  button.dataset.taskRunning = 'false';
  button.disabled = false;
  button.innerHTML = '<span>↑</span> 上传视频到所选平台';
  submitTitle.textContent = '上传到勾选的平台';
  const count = selectedTargets().length;
  submitHint.textContent = count ? `已选择 ${count} 个账号，每个账号会并行打开独立 Chrome 窗口` : '请先选择本次需要发布的账号';
}

function updateCovers() {
  const required = requiredCovers();
  document.querySelectorAll('.cover-card').forEach((card) => {
    const needed = required.has(card.dataset.ratio);
    card.classList.toggle('not-needed', !needed);
    card.classList.toggle('required-cover', needed);
    const requiredText = card.querySelector('.cover-required');
    if (requiredText) requiredText.textContent = needed ? '整套选填' : '本次无需';
  });
  document.querySelectorAll('.cover-map-note span').forEach((item) => {
    if (item.textContent.trim().startsWith('视频号：')) {
      const current = videoMetadata.width && videoMetadata.height
        ? `当前${videoMetadata.width > videoMetadata.height ? '横屏视频使用 3:4 + 4:3' : '竖屏视频使用 3:4'}`
        : '横屏 3:4 + 4:3 / 竖屏 3:4';
      item.textContent = `视频号：${current}`;
    }
  });
}

function inspectCover(input) {
  const card = input.closest('.cover-card');
  const file = input.files[0];
  const preview = card.querySelector('.ratio-preview');
  const choose = card.querySelector('.choose-cover');
  const remove = card.querySelector('.remove-cover');
  if (card.dataset.previewUrl) {
    URL.revokeObjectURL(card.dataset.previewUrl);
    delete card.dataset.previewUrl;
  }
  card.classList.toggle('has-file', Boolean(file));
  if (remove) remove.hidden = !file;
  if (!file) {
    preview.style.backgroundImage = '';
    preview.classList.remove('has-preview');
    choose.textContent = '选择图片';
    return;
  }
  const url = URL.createObjectURL(file);
  card.dataset.previewUrl = url;
  preview.style.backgroundImage = `url(${url})`;
  preview.classList.add('has-preview');
  choose.textContent = `已选择原图：${file.name}`;
}

function showVideoPreview(filename, source, label) {
  if (videoPreviewUrl) {
    URL.revokeObjectURL(videoPreviewUrl);
    videoPreviewUrl = null;
  }
  videoDrop.classList.add('has-file');
  videoPreview.src = source;
  videoPreview.load();
  videoEmptyState.hidden = true;
  videoPreviewState.hidden = false;
  document.getElementById('videoName').textContent = filename;
  document.getElementById('videoPreviewName').textContent = `${filename} · ${label}`;
  videoPreview.play().catch(() => {
    // 浏览器若阻止自动播放，仍保留原生播放控件供用户手动启动。
  });
}

function clearVideoPreview() {
  if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
  videoPreviewUrl = null;
  retainedVideoFile = null;
  videoMetadata = { width: 0, height: 0 };
  videoDrop.classList.remove('has-file');
  videoPreview.pause();
  videoPreview.removeAttribute('src');
  videoPreview.load();
  videoEmptyState.hidden = false;
  videoPreviewState.hidden = true;
  document.getElementById('videoName').textContent = '尚未选择文件';
  updateCovers();
}

async function saveVideoAsRuntimeDraft(file) {
  document.getElementById('videoPreviewName').textContent = `${file.name} · 正在保存临时草稿`;
  try {
    if (!navigator.storage?.getDirectory) throw new Error('当前浏览器不支持本机文件草稿');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(PUBLISH_VIDEO_DRAFT_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    sessionStorage.setItem(PUBLISH_VIDEO_DRAFT_KEY, JSON.stringify({
      name: file.name,
      type: file.type,
      last_modified: file.lastModified
    }));
    document.getElementById('videoPreviewName').textContent = `${file.name} · 已保存到本机临时草稿`;
    savePublishDraft();
    return true;
  } catch (error) {
    showToast(`${error.message}，请不要切换页面或重新选择视频`, 'error');
    return false;
  }
}

function beginVideoDraftUpload(file) {
  const promise = saveVideoAsRuntimeDraft(file);
  draftVideoUploadPromise = promise;
  void promise.finally(() => {
    if (draftVideoUploadPromise === promise) draftVideoUploadPromise = null;
  });
}

function coverDraftNames(input) {
  const ratio = input.closest('.cover-card').dataset.ratio;
  return {
    ratio,
    metadataKey: `${PUBLISH_COVER_DRAFT_KEY_PREFIX}${ratio}`,
    filename: `${PUBLISH_COVER_DRAFT_FILE_PREFIX}${ratio.replace(':', '_')}`
  };
}

async function saveCoverAsRuntimeDraft(input) {
  const file = input.files[0];
  if (!file) return true;
  const names = coverDraftNames(input);
  try {
    if (!navigator.storage?.getDirectory) throw new Error('当前浏览器不支持本机文件草稿');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(names.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    sessionStorage.setItem(names.metadataKey, JSON.stringify({
      name: file.name,
      type: file.type,
      last_modified: file.lastModified
    }));
    return true;
  } catch (error) {
    showToast(`${names.ratio} 封面临时保存失败：${error.message}`, 'error');
    return false;
  }
}

function beginCoverDraftSave(input) {
  const names = coverDraftNames(input);
  const promise = saveCoverAsRuntimeDraft(input);
  draftCoverSavePromises.set(names.ratio, promise);
  void promise.finally(() => {
    if (draftCoverSavePromises.get(names.ratio) === promise) draftCoverSavePromises.delete(names.ratio);
  });
}

async function clearCoverRuntimeDraft(input) {
  const names = coverDraftNames(input);
  const previous = draftCoverSavePromises.get(names.ratio);
  const promise = (async () => {
    if (previous) await previous.catch(() => false);
    sessionStorage.removeItem(names.metadataKey);
    if (!navigator.storage?.getDirectory) return true;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(names.filename).catch(() => {});
    return true;
  })();
  draftCoverSavePromises.set(names.ratio, promise);
  try {
    return await promise;
  } finally {
    if (draftCoverSavePromises.get(names.ratio) === promise) draftCoverSavePromises.delete(names.ratio);
  }
}

async function clearVideoRuntimeDraft() {
  const previous = draftVideoUploadPromise;
  if (previous) await previous.catch(() => false);
  sessionStorage.removeItem(PUBLISH_VIDEO_DRAFT_KEY);
  if (!navigator.storage?.getDirectory) return true;
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(PUBLISH_VIDEO_DRAFT_FILE).catch(() => {});
  return true;
}

async function clearPublishForm() {
  clearPublishButton.disabled = true;
  clearPublishButton.textContent = '清空中…';
  clearTimeout(publishDraftTimer);

  await Promise.allSettled([draftVideoRestorePromise, draftCoverRestorePromise].filter(Boolean));

  PUBLISH_DRAFT_FIELDS.forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
  [
    ['titleCount', 100],
    ['titleDouyinCount', 30],
    ['titleKuaishouCount', 30],
    ['titleChannelsCount', 100],
    ['titleChannelsShortCount', 16],
    ['titleBilibiliCount', 80],
    ['introCount', 1000],
  ].forEach(([id, max]) => {
    document.getElementById(id).textContent = `0 / ${max}`;
  });
  document.querySelectorAll('.declaration-card select').forEach((select) => {
    select.selectedIndex = 0;
  });
  channelsHideLocation.checked = false;
  channelsOriginal.checked = false;
  directPublishDouyin.checked = false;
  directPublishKuaishou.checked = false;
  directPublishChannels.checked = false;
  directPublishBilibili.checked = false;
  scheduleEnabled.checked = false;
  Object.values(platformScheduleTimes).forEach((input) => { input.value = ''; });
  commonScheduleTime.value = '';
  syncCommonScheduleControls();
  syncDouyinScheduleControls();
  syncKuaishouScheduleControls();
  syncBilibiliScheduleControls();
  updateScheduleUi();

  video.value = '';
  clearVideoPreview();
  const coverInputs = [...document.querySelectorAll('.cover-card input[type="file"]')];
  coverInputs.forEach((input) => {
    input.value = '';
    inspectCover(input);
  });
  publishDraft = null;
  sessionStorage.removeItem(PUBLISH_DRAFT_KEY);
  updateAccountSelectionUi();

  const cleanupResults = await Promise.allSettled([
    clearVideoRuntimeDraft(),
    ...coverInputs.map(clearCoverRuntimeDraft),
  ]);
  sessionStorage.removeItem(PUBLISH_DRAFT_KEY);
  clearPublishButton.disabled = false;
  clearPublishButton.textContent = '清空';
  const cleanupFailed = cleanupResults.some((result) => result.status === 'rejected');
  showToast(cleanupFailed ? '本次内容已清空，账号选择和固定标签已保留；部分本机临时文件将在下次进入页面时清理' : '本次发布内容已清空，账号选择和固定标签已保留', cleanupFailed ? 'error' : 'success');
}

async function restoreRuntimeDraftCovers() {
  if (!navigator.storage?.getDirectory) return false;
  try {
    const root = await navigator.storage.getDirectory();
    await Promise.all([...document.querySelectorAll('.cover-card input[type="file"]')].map(async (input) => {
      const names = coverDraftNames(input);
      const rawMetadata = sessionStorage.getItem(names.metadataKey);
      if (!rawMetadata) {
        await root.removeEntry(names.filename).catch(() => {});
        return;
      }
      try {
        const metadata = JSON.parse(rawMetadata);
        const handle = await root.getFileHandle(names.filename);
        const storedFile = await handle.getFile();
        const restoredFile = new File([storedFile], metadata.name || storedFile.name, {
          type: metadata.type || storedFile.type,
          lastModified: Number(metadata.last_modified) || storedFile.lastModified
        });
        const transfer = new DataTransfer();
        transfer.items.add(restoredFile);
        input.files = transfer.files;
        inspectCover(input);
      } catch (_) {
        sessionStorage.removeItem(names.metadataKey);
      }
    }));
    updateCovers();
    return true;
  } catch (_) {
    return false;
  }
}

function pendingFileDraftSaves() {
  return [draftVideoUploadPromise, ...draftCoverSavePromises.values()].filter(Boolean);
}

async function restoreRuntimeDraftVideo() {
  const rawMetadata = sessionStorage.getItem(PUBLISH_VIDEO_DRAFT_KEY);
  if (!navigator.storage?.getDirectory) return false;
  try {
    const root = await navigator.storage.getDirectory();
    if (!rawMetadata) {
      await root.removeEntry(PUBLISH_VIDEO_DRAFT_FILE).catch(() => {});
      return false;
    }
    const metadata = JSON.parse(rawMetadata);
    const handle = await root.getFileHandle(PUBLISH_VIDEO_DRAFT_FILE);
    const storedFile = await handle.getFile();
    const restoredFile = new File([storedFile], metadata.name || storedFile.name, {
      type: metadata.type || storedFile.type,
      lastModified: Number(metadata.last_modified) || storedFile.lastModified
    });
    const transfer = new DataTransfer();
    transfer.items.add(restoredFile);
    restoringVideoDraft = true;
    video.files = transfer.files;
    updateVideoPreview();
    restoringVideoDraft = false;
    return true;
  } catch (_) {
    sessionStorage.removeItem(PUBLISH_VIDEO_DRAFT_KEY);
    restoringVideoDraft = false;
    return false;
  }
}

function updateVideoPreview() {
  const file = video.files[0];
  if (!file) {
    clearVideoPreview();
    return;
  }
  retainedVideoFile = file;
  videoMetadata = { width: 0, height: 0 };
  updateCovers();
  const localPreviewUrl = URL.createObjectURL(file);
  showVideoPreview(file.name, localPreviewUrl, '本地预览');
  videoPreviewUrl = localPreviewUrl;
  if (!restoringVideoDraft) beginVideoDraftUpload(file);
}

function isSupportedVideoFile(file) {
  return Boolean(file && ((file.type || '').startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name)));
}

function assignVideoFile(file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  video.files = transfer.files;
}

function restoreRetainedVideoFile() {
  if (!retainedVideoFile) return false;
  assignVideoFile(retainedVideoFile);
  return true;
}

function selectDroppedVideo(file) {
  if (!isSupportedVideoFile(file)) {
    showToast('请拖入 MP4、MOV、AVI、MKV 或 WebM 视频文件', 'error');
    return false;
  }
  assignVideoFile(file);
  updateVideoPreview();
  return true;
}

function prepareSmallNativeFileDialog() {
  if (document.body.dataset.smallFileDialog !== 'true') return;
  try {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/ui/prepare-file-dialog', false);
    request.send();
  } catch (_) {}
}

function showPlatformNotice(result) {
  const key = `${result.platform_key}:${result.account_id}:${result.success}:${result.message}`;
  if (notifiedResults.has(key)) return;
  notifiedResults.add(key);
  const notice = document.createElement('div');
  notice.className = `platform-notice${result.success ? '' : ' error'}`;
  const icon = document.createElement('b');
  icon.textContent = result.success ? '✓' : '!';
  const copy = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = result.success
    ? `${result.platform} · ${result.account || '账号'}上传成功`
    : `${result.platform} · ${result.account || '账号'}处理未完成`;
  const message = document.createElement('span');
  message.textContent = result.message || (result.success ? '视频与资料已处理完成' : '请检查平台页面');
  copy.append(title, message);
  notice.append(icon, copy);
  document.getElementById('platformNoticeStack').appendChild(notice);
  setTimeout(() => notice.remove(), 5200);
}

function showCompletionModal(task) {
  const dialog = completionModal.querySelector('.completion-dialog');
  const hasError = Boolean(task.failed);
  const loginExpired = (task.results || []).filter((result) => result.error_code === 'LOGIN_EXPIRED');
  dialog.classList.toggle('has-error', hasError);
  document.getElementById('completionTitle').textContent = loginExpired.length
    ? '平台账号登录已过期'
    : hasError
    ? '部分平台处理未完成'
    : task.outcome === 'submitted' ? '平台已确认接受提交' : '所选平台上传成功';
  document.getElementById('completionMessage').textContent = loginExpired.length
    ? '对应平台窗口已自动关闭，账号已设为不可选，请重新登录'
    : hasError
    ? '请根据下方结果检查对应平台页面'
    : task.message || '视频上传与资料填写已完成，请在平台页面检查后发布';
  const results = document.getElementById('completionResults');
  results.replaceChildren();
  (task.results || []).forEach((result) => {
    const row = document.createElement('div');
    row.className = `completion-result${result.success ? '' : ' error'}`;
    const platform = document.createElement('strong');
    platform.textContent = `${result.platform} · ${result.account || '账号'}`;
    const status = document.createElement('span');
    status.textContent = result.outcome === 'submitted' ? '平台已接受提交' : result.success ? '上传与填写完成' : (result.message || '未完成');
    row.append(platform, status);
    results.appendChild(row);
  });
  completionModal.hidden = false;
}

function showLoginExpiredModal(results) {
  const dialog = completionModal.querySelector('.completion-dialog');
  dialog.classList.add('has-error');
  document.getElementById('completionTitle').textContent = '平台账号登录已过期';
  document.getElementById('completionMessage').textContent = '以下平台窗口已自动关闭，账号已设为不可选，请重新登录';
  const rows = document.getElementById('completionResults');
  rows.replaceChildren();
  results.forEach((result) => {
    const row = document.createElement('div');
    row.className = 'completion-result error';
    const platform = document.createElement('strong');
    platform.textContent = `${result.platform} · ${result.account || '账号'}`;
    const status = document.createElement('span');
    status.textContent = '登录已过期';
    row.append(platform, status);
    rows.appendChild(row);
  });
  completionModal.hidden = false;
}

function setTaskUi(status, task = {}) {
  (task.results || []).forEach(showPlatformNotice);
  const expiredResults = (task.results || []).filter((result) => result.error_code === 'LOGIN_EXPIRED');
  const newExpiredResults = expiredResults.filter((result) => {
    const key = `${result.platform_key}:${result.account_id}`;
    if (notifiedLoginExpiredAccounts.has(key)) return false;
    notifiedLoginExpiredAccounts.add(key);
    return true;
  });
  if (newExpiredResults.length) {
    void loadPublishAccounts().catch(() => {});
    if (status !== 'completed' && status !== 'failed') showLoginExpiredModal(expiredResults);
  }
  actionPanel.classList.remove('task-running', 'task-completed', 'task-error');
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
    actionPanel.classList.add(task.failed ? 'task-error' : 'task-completed');
    const issues = (task.issues || [])
      .map((item) => `${item.platform}：${item.message}`)
      .join('；');
    localStorage.removeItem('activePublishTaskId');
    activeTaskId = null;
    clearInterval(taskTimer);
    resetButton();
    if (task.failed) {
      submitTitle.textContent = '本次有平台未完成，可调整后重新上传';
      submitHint.textContent = issues || '请检查各平台页面后重新上传';
    } else {
      submitTitle.textContent = task.outcome === 'submitted' ? '平台已确认接受提交' : '所选平台视频上传与资料填写完成';
      submitHint.textContent = task.message || '请在各 Chrome 窗口检查资料并手动发布';
    }
    showCompletionModal(task);
    void loadPublishAccounts().catch(() => {});
    return;
  }
  taskMode = 'running';
  actionPanel.classList.add('task-running');
  button.dataset.taskRunning = 'true';
  button.disabled = true;
  button.innerHTML = '<span>···</span> 正在并行打开并填写平台页面';
  submitTitle.textContent = `正在并行处理所选平台${task.finished ? `（${task.finished}/${task.total}）` : ''}`;
  submitHint.textContent = task.message || '每个平台会打开一个独立 Chrome 窗口并同时执行';
}

async function pollTask() {
  if (!activeTaskId) return;
  try {
    const response = await fetch(`/api/tasks/${activeTaskId}`, { cache: 'no-store' });
    if (response.status === 404) {
      localStorage.removeItem('activePublishTaskId');
      activeTaskId = null;
      clearInterval(taskTimer);
      resetButton();
      return;
    }
    const task = await response.json();
    if (!response.ok) throw new Error(task.detail || '读取任务状态失败');
    setTaskUi(task.status, task);
  } catch (_) {
    submitHint.textContent = '暂时无法读取任务状态，稍后将自动重试';
  }
}

function beginPolling() {
  clearInterval(taskTimer);
  pollTask();
  taskTimer = setInterval(pollTask, 1000);
}

function effectiveTitle(key) {
  const platformValue = document.getElementById(TITLE_FIELDS[key].id).value.trim();
  return platformValue || document.getElementById('title').value.trim();
}

video.addEventListener('change', () => {
  const file = video.files[0];
  if (!file && restoreRetainedVideoFile()) return;
  if (file && !isSupportedVideoFile(file)) {
    if (!restoreRetainedVideoFile()) {
      video.value = '';
      clearVideoPreview();
    }
    showToast('请选择 MP4、MOV、AVI、MKV 或 WebM 视频文件', 'error');
    return;
  }
  updateVideoPreview();
});
video.addEventListener('click', prepareSmallNativeFileDialog, { capture: true });
video.addEventListener('cancel', () => {
  restoreRetainedVideoFile();
});
let videoDragDepth = 0;
videoDrop.addEventListener('dragenter', (event) => {
  event.preventDefault();
  videoDragDepth += 1;
  videoDrop.classList.add('is-dragging');
});
videoDrop.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  videoDrop.classList.add('is-dragging');
});
videoDrop.addEventListener('dragleave', (event) => {
  event.preventDefault();
  videoDragDepth = Math.max(0, videoDragDepth - 1);
  if (!videoDragDepth) videoDrop.classList.remove('is-dragging');
});
videoDrop.addEventListener('drop', (event) => {
  event.preventDefault();
  videoDragDepth = 0;
  videoDrop.classList.remove('is-dragging');
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length !== 1) {
    showToast(files.length ? '一次只能拖入一个视频文件' : '没有检测到视频文件', 'error');
    return;
  }
  selectDroppedVideo(files[0]);
});
videoPreview.addEventListener('loadedmetadata', () => {
  videoMetadata = { width: videoPreview.videoWidth, height: videoPreview.videoHeight };
  updateCovers();
  schedulePublishDraftSave();
});
document.getElementById('changeVideo').addEventListener('click', () => video.click());
clearPublishButton.addEventListener('click', () => {
  void clearPublishForm();
});
fixedTopic.addEventListener('input', saveFixedTopic);
scheduleEnabled.addEventListener('change', () => {
  updateScheduleUi();
});
function openSchedulePicker(input) {
  if (!input || input.disabled) return;
  input.focus();
  if (typeof input.showPicker !== 'function') return;
  try { input.showPicker(); } catch (_) {}
}
[channelsScheduleTime].forEach((input) => {
  input.addEventListener('click', () => openSchedulePicker(input));
});
commonScheduleDate.addEventListener('click', () => openSchedulePicker(commonScheduleDate));
[commonScheduleDate, commonScheduleHour, commonScheduleMinute].forEach((field) => {
  field.addEventListener('change', () => {
    refreshCommonScheduleOptions();
    updateCommonScheduleValue();
  });
});
douyinScheduleDate.addEventListener('click', () => openSchedulePicker(douyinScheduleDate));
[douyinScheduleDate, douyinScheduleHour, douyinScheduleMinute].forEach((field) => {
  field.addEventListener('change', () => {
    refreshDouyinScheduleOptions();
    updateDouyinScheduleValue();
  });
});
kuaishouScheduleDate.addEventListener('click', () => openSchedulePicker(kuaishouScheduleDate));
[kuaishouScheduleDate, kuaishouScheduleHour, kuaishouScheduleMinute].forEach((field) => {
  field.addEventListener('change', () => {
    refreshKuaishouScheduleOptions();
    updateKuaishouScheduleValue();
  });
});
bilibiliScheduleDate.addEventListener('click', () => openSchedulePicker(bilibiliScheduleDate));
[bilibiliScheduleDate, bilibiliScheduleHour, bilibiliScheduleMinute].forEach((field) => {
  field.addEventListener('change', updateBilibiliScheduleValue);
});
document.querySelectorAll('.cover-card input').forEach((input) => {
  input.addEventListener('change', () => {
    inspectCover(input);
    beginCoverDraftSave(input);
  });
});
document.querySelectorAll('.remove-cover').forEach((remove) => {
  remove.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const card = remove.closest('.cover-card');
    const input = card.querySelector('input[type="file"]');
    const ratio = card.dataset.ratio;
    input.value = '';
    inspectCover(input);
    updateCovers();
    schedulePublishDraftSave();
    try {
      await clearCoverRuntimeDraft(input);
      showToast(`${ratio} 封面已删除；需要双封面的平台可继续补传，或删除另一张后使用平台默认封面`, 'success');
    } catch (error) {
      showToast(`${ratio} 封面已从本页撤回，但清理临时草稿失败：${error.message}`, 'error');
    }
  });
});
form.addEventListener('input', schedulePublishDraftSave);
form.addEventListener('change', schedulePublishDraftSave);
openPlatformTitles.addEventListener('click', openPlatformTitleEditor);
platformTitleClose.addEventListener('click', () => closePlatformTitleEditor(true));
cancelPlatformTitles.addEventListener('click', () => closePlatformTitleEditor(true));
savePlatformTitles.addEventListener('click', () => {
  const shortTitle = document.getElementById('titleChannelsShort');
  shortTitle.value = normalizeChannelsShortTitle(shortTitle.value);
  closePlatformTitleEditor(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !platformTitleModal.hidden) closePlatformTitleEditor(true);
});
document.addEventListener('click', async (event) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link) return;
  let url;
  try { url = new URL(link.href, window.location.href); } catch (_) { return; }
  if (url.origin !== window.location.origin || url.pathname !== '/accounts') return;
  savePublishDraft();
  const pendingSaves = pendingFileDraftSaves();
  if (!pendingSaves.length) return;
  event.preventDefault();
  showToast('正在保存视频和封面临时草稿，完成后自动切换页面');
  const results = await Promise.all(pendingSaves);
  if (results.every(Boolean)) window.location.assign(url.href);
  else showToast('文件临时草稿保存失败，已留在发布页避免内容丢失', 'error');
});

[
  ['title', 'titleCount', 100],
  ['titleDouyin', 'titleDouyinCount', 30],
  ['titleKuaishou', 'titleKuaishouCount', 30],
  ['titleChannels', 'titleChannelsCount', 100],
  ['titleChannelsShort', 'titleChannelsShortCount', 16],
  ['titleBilibili', 'titleBilibiliCount', 80],
  ['intro', 'introCount', 1000],
].forEach(([id, countId, max]) => {
  const field = document.getElementById(id);
  field.addEventListener('input', (event) => {
    if (id === 'titleChannelsShort') event.target.value = event.target.value.replace(/[，,]/g, ' ');
    document.getElementById(countId).textContent = `${event.target.value.length} / ${max}`;
    if (PLATFORM_TITLE_INPUT_IDS.includes(id)) updatePlatformTitleSummary();
  });
});

document.getElementById('completionClose').addEventListener('click', () => {
  completionModal.hidden = true;
});
completionModal.addEventListener('click', (event) => {
  if (event.target === completionModal) completionModal.hidden = true;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (taskMode === 'running') return;
  if (draftVideoRestorePromise) await draftVideoRestorePromise;
  if (draftCoverRestorePromise) await draftCoverRestorePromise;
  if (draftVideoUploadPromise) {
    submitHint.textContent = '正在完成视频临时草稿保存，请稍候';
    await draftVideoUploadPromise;
  }
  const targets = selectedTargets();
  const selected = selectedPlatforms();
  if (!targets.length) return showToast('请至少勾选一个需要发布的账号', 'error');
  if (!video.files[0]) return showToast('请先选择视频文件', 'error');
  if (selected.includes('channels') && (!videoMetadata.width || !videoMetadata.height)) {
    return showToast('正在读取视频方向，请稍后再试', 'error');
  }
  for (const key of selected) {
    const currentTitle = effectiveTitle(key);
    if (!currentTitle) return showToast(`请填写通用标题或${PLATFORM_NAMES[key]}独立标题`, 'error');
    if (currentTitle.length > TITLE_FIELDS[key].limit) {
      return showToast(`${PLATFORM_NAMES[key]}标题最多${TITLE_FIELDS[key].limit}字`, 'error');
    }
  }
  if (selected.includes('channels')) {
    const shortTitleField = document.getElementById('titleChannelsShort');
    shortTitleField.value = normalizeChannelsShortTitle(shortTitleField.value);
    document.getElementById('titleChannelsShortCount').textContent = `${shortTitleField.value.length} / 16`;
    const shortTitleError = channelsShortTitleError(shortTitleField.value);
    if (shortTitleError) return showToast(shortTitleError, 'error');
  }
  const scheduleError = scheduledTimeError();
  if (scheduleError) return showToast(scheduleError, 'error');
  const incompleteCovers = incompletePlatformCovers(selected);
  if (incompleteCovers.length) {
    const details = incompleteCovers.map((item) => `${PLATFORM_NAMES[item.key]}还缺少${item.missing.join('、')}`).join('；');
    return showToast(`${details}。请补齐封面，或点击已选封面上的“删除封面”后使用平台默认封面`, 'error');
  }
  updateCommonScheduleValue();
  updateDouyinScheduleValue();
  updateKuaishouScheduleValue();
  updateBilibiliScheduleValue();
  const data = new FormData(form);
  data.set('schedule_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  data.set('targets', JSON.stringify(targets));
  data.set('schedule_enabled', scheduleEnabled.checked ? 'true' : 'false');
  if (scheduleEnabled.checked) {
    if (commonScheduleTime.value) data.set('scheduled_at', commonScheduleTime.value);
    for (const [key, input] of Object.entries(platformScheduleTimes)) {
      const effectiveValue = input.value || commonScheduleTime.value;
      if (effectiveValue) data.set(`scheduled_at_${key}`, effectiveValue);
    }
  }
  data.set('channels_hide_location', channelsHideLocation.checked ? 'true' : 'false');
  data.set('channels_original', channelsOriginal.checked ? 'true' : 'false');
  data.set('direct_publish_douyin', directPublishDouyin.checked ? 'true' : 'false');
  data.set('direct_publish_kuaishou', directPublishKuaishou.checked ? 'true' : 'false');
  data.set('direct_publish_channels', directPublishChannels.checked ? 'true' : 'false');
  data.set('direct_publish_bilibili', directPublishBilibili.checked ? 'true' : 'false');
  data.set('video_width', String(videoMetadata.width));
  data.set('video_height', String(videoMetadata.height));
  savePublishDraft();
  notifiedResults.clear();
  notifiedLoginExpiredAccounts.clear();
  setTaskUi('running');
  try {
    const response = await fetch('/api/tasks', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) await loadPublishAccounts().catch(() => {});
      throw new Error(result.detail || '创建任务失败');
    }
    activeTaskId = result.task_id;
    localStorage.setItem('activePublishTaskId', result.task_id);
    showToast('视频和原始封面已提交，正在打开 Chrome', 'success');
    beginPolling();
  } catch (error) {
    actionPanel.classList.remove('task-running');
    resetButton();
    showToast(error.message, 'error');
  }
});

window.addEventListener('pagehide', () => {
  savePublishDraft();
  clearInterval(scheduleLimitsTimer);
  if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
});
restoreFixedTopic();
restorePublishDraftFields();
fillTimeSelect(commonScheduleHour, '时', Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(commonScheduleMinute, '分', Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0')));
fillTimeSelect(douyinScheduleHour, '时', Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(douyinScheduleMinute, '分', Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(kuaishouScheduleHour, '时', Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(kuaishouScheduleMinute, '分', Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(bilibiliScheduleHour, '时', Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')));
fillTimeSelect(bilibiliScheduleMinute, '分', Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0')));
syncCommonScheduleControls();
syncDouyinScheduleControls();
syncKuaishouScheduleControls();
syncBilibiliScheduleControls();
updateScheduleUi();
scheduleLimitsTimer = setInterval(() => {
  if (scheduleEnabled.checked) updateScheduleUi();
}, 30_000);
draftVideoRestorePromise = restoreRuntimeDraftVideo();
function beginCoverDraftRestore() {
  if (draftCoverRestorePromise) return;
  draftCoverRestorePromise = restoreRuntimeDraftCovers();
}
if (document.readyState === 'complete') beginCoverDraftRestore();
else window.addEventListener('load', beginCoverDraftRestore, { once: true });
updateCovers();
updateDeclarations();
updatePlatformTitleFields();
loadPublishAccounts().catch((error) => {
  document.getElementById('accountTargetList').textContent = error.message;
  showToast(error.message, 'error');
});
if (activeTaskId) beginPolling();
else resetButton();
