const IMAGE_TEXT_PLATFORMS = {
  douyin: { name: '抖音', logo: '抖', className: 'douyin', titleInput: 'imageTextTitleDouyin', titleLimit: 30 },
  xiaohongshu: { name: '小红书', logo: '小', className: 'xhs', titleInput: 'imageTextTitleXiaohongshu', titleLimit: 20 },
  channels: { name: '视频号', logo: '视', className: 'channels', titleInput: 'imageTextTitleChannels', titleLimit: 100 },
};
const MAX_IMAGES = 18;
const FIXED_TOPIC_KEY = 'imageTextFixedTopicV1';
const ACCOUNT_SELECTION_KEY = 'imageTextAccountSelectionsV1';
const ACTIVE_TASK_KEY = 'activeImageTextTaskId';
const IMAGE_TEXT_DRAFT_KEY = 'imageTextFormDraftV1';
const IMAGE_TEXT_IMAGE_DRAFT_KEY = 'imageTextImageDraftMetaV1';
const IMAGE_TEXT_IMAGE_DRAFT_PREFIX = 'image-text-draft-';
const IMAGE_TEXT_DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;
const IMAGE_TEXT_DRAFT_FIELDS = [
  'imageTextTitle',
  'imageTextTopics',
  'imageTextContent',
  'imageTextTitleDouyin',
  'imageTextTitleXiaohongshu',
  'imageTextTitleChannels',
  'imageTextTitleChannelsShort',
  'imageTextDouyinDeclaration',
  'imageTextXhsDeclaration',
  'imageTextChannelsDeclaration',
  'imageTextCommonScheduleTime',
  'imageTextDouyinScheduleTime',
  'imageTextXhsScheduleTime',
  'imageTextChannelsScheduleTime',
];
const CHANNELS_SHORT_TITLE_ALLOWED = /^[\p{L}\p{N}\p{M} 《》“”"'‘’：:+＋?？%％℃]*$/u;

const form = document.getElementById('imageTextForm');
const imagesInput = document.getElementById('images');
const imageDrop = document.getElementById('imageDrop');
const imageEmptyState = document.getElementById('imageEmptyState');
const imagePreviewState = document.getElementById('imagePreviewState');
const imagePreviewGrid = document.getElementById('imagePreviewGrid');
const imageCount = document.getElementById('imageCount');
const imagePreviewSummary = document.getElementById('imagePreviewSummary');
const titleInput = document.getElementById('imageTextTitle');
const contentInput = document.getElementById('imageTextContent');
const fixedTopicInput = document.getElementById('imageTextFixedTopic');
const accountRoot = document.getElementById('imageTextAccountTargetList');
const actionPanel = document.getElementById('imageTextActionPanel');
const startButton = document.getElementById('startButton');
const submitTitle = document.getElementById('submitTitle');
const submitHint = document.getElementById('submitHint');
const platformTitleModal = document.getElementById('imageTextPlatformTitleModal');
const platformTitleSummary = document.getElementById('imageTextPlatformTitleSummary');
const channelsShortTitleInput = document.getElementById('imageTextTitleChannelsShort');
const declarationInputs = {
  douyin: document.getElementById('imageTextDouyinDeclaration'),
  xiaohongshu: document.getElementById('imageTextXhsDeclaration'),
  channels: document.getElementById('imageTextChannelsDeclaration'),
};
const xhsDeclaration = document.getElementById('imageTextXhsDeclaration');
const xhsOriginal = document.getElementById('imageTextXhsOriginal');
const channelsHideLocation = document.getElementById('imageTextChannelsHideLocation');
const channelsOriginal = document.getElementById('imageTextChannelsOriginal');
const scheduleEnabled = document.getElementById('imageTextScheduleEnabled');
const scheduleFields = document.getElementById('imageTextScheduleFields');
const scheduleCard = document.getElementById('imageTextScheduleCard');
const commonScheduleTime = document.getElementById('imageTextCommonScheduleTime');
const commonScheduleControl = {
  input: commonScheduleTime,
  date: document.getElementById('imageTextCommonScheduleDate'),
  hour: document.getElementById('imageTextCommonScheduleHour'),
  minute: document.getElementById('imageTextCommonScheduleMinute'),
};
const platformScheduleTimes = {
  douyin: document.getElementById('imageTextDouyinScheduleTime'),
  xiaohongshu: document.getElementById('imageTextXhsScheduleTime'),
  channels: document.getElementById('imageTextChannelsScheduleTime'),
};
const platformScheduleControls = {
  douyin: {
    input: platformScheduleTimes.douyin,
    date: document.getElementById('imageTextDouyinScheduleDate'),
    hour: document.getElementById('imageTextDouyinScheduleHour'),
    minute: document.getElementById('imageTextDouyinScheduleMinute'),
  },
  xiaohongshu: {
    input: platformScheduleTimes.xiaohongshu,
    date: document.getElementById('imageTextXhsScheduleDate'),
    hour: document.getElementById('imageTextXhsScheduleHour'),
    minute: document.getElementById('imageTextXhsScheduleMinute'),
  },
  channels: {
    input: platformScheduleTimes.channels,
    date: document.getElementById('imageTextChannelsScheduleDate'),
    hour: document.getElementById('imageTextChannelsScheduleHour'),
    minute: document.getElementById('imageTextChannelsScheduleMinute'),
  },
};
const completionModal = document.getElementById('imageTextCompletionModal');
const completionDialog = document.getElementById('imageTextCompletionDialog');
const xhsRiskModal = document.getElementById('imageTextXhsRiskModal');

let selectedImages = [];
let previewUrls = [];
let activeTaskId = localStorage.getItem(ACTIVE_TASK_KEY) || '';
let taskTimer = null;
let scheduleLimitsTimer = null;
let platformTitleSnapshot = {};
let xhsRiskResolver = null;
let draftSaveTimer = null;
let imageDraftOperation = Promise.resolve();
let pendingImageDraftSave = null;
let draftPaused = false;

function notifyToast(message, type = '') {
  if (window.showToast) window.showToast(message, type);
}

function prepareSmallNativeFileDialog() {
  try {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/ui/prepare-file-dialog', false);
    request.send();
  } catch (_) {}
}

function imageKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function supportedImage(file) {
  return /^image\/(?:jpeg|png|webp)$/i.test(file.type) || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function readImageTextDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(IMAGE_TEXT_DRAFT_KEY) || 'null');
    if (!draft || Date.now() - Number(draft.saved_at || 0) > IMAGE_TEXT_DRAFT_MAX_AGE) return null;
    return draft;
  } catch (_) {
    return null;
  }
}

function saveImageTextDraft() {
  if (draftPaused) return;
  clearTimeout(draftSaveTimer);
  const fields = Object.fromEntries(IMAGE_TEXT_DRAFT_FIELDS.map(id => [id, document.getElementById(id)?.value || '']));
  const draft = {
    fields,
    xhs_original: xhsOriginal.checked,
    channels_hide_location: channelsHideLocation.checked,
    channels_original: channelsOriginal.checked,
    schedule_enabled: scheduleEnabled.checked,
    saved_at: Date.now(),
  };
  try { sessionStorage.setItem(IMAGE_TEXT_DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
}

function scheduleImageTextDraftSave() {
  if (draftPaused) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveImageTextDraft, 120);
}

function restoreImageTextDraft() {
  const draft = readImageTextDraft();
  if (!draft) return;
  draftPaused = true;
  Object.entries(draft.fields || {}).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field && field.type !== 'file') field.value = String(value ?? '');
  });
  xhsOriginal.checked = Boolean(draft.xhs_original);
  channelsHideLocation.checked = Boolean(draft.channels_hide_location);
  channelsOriginal.checked = Boolean(draft.channels_original);
  scheduleEnabled.checked = Boolean(draft.schedule_enabled);
  draftPaused = false;
}

function queueImageDraftOperation(operation) {
  const promise = imageDraftOperation.catch(() => {}).then(operation);
  imageDraftOperation = promise;
  pendingImageDraftSave = promise;
  const clearPending = () => {
    if (pendingImageDraftSave === promise) pendingImageDraftSave = null;
  };
  void promise.then(clearPending, clearPending);
  return promise;
}

function saveImagesAsRuntimeDraft() {
  if (draftPaused) return imageDraftOperation;
  const snapshot = [...selectedImages];
  return queueImageDraftOperation(async () => {
    if (!navigator.storage?.getDirectory) return false;
    const root = await navigator.storage.getDirectory();
    const metadata = [];
    for (let index = 0; index < snapshot.length; index += 1) {
      const file = snapshot[index];
      const filename = `${IMAGE_TEXT_IMAGE_DRAFT_PREFIX}${String(index + 1).padStart(2, '0')}`;
      const handle = await root.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      metadata.push({ filename, name: file.name, type: file.type, last_modified: file.lastModified });
    }
    for (let index = snapshot.length; index < MAX_IMAGES; index += 1) {
      const filename = `${IMAGE_TEXT_IMAGE_DRAFT_PREFIX}${String(index + 1).padStart(2, '0')}`;
      await root.removeEntry(filename).catch(() => {});
    }
    if (metadata.length) sessionStorage.setItem(IMAGE_TEXT_IMAGE_DRAFT_KEY, JSON.stringify(metadata));
    else sessionStorage.removeItem(IMAGE_TEXT_IMAGE_DRAFT_KEY);
    return true;
  }).catch(() => false);
}

async function restoreImagesFromRuntimeDraft() {
  let metadata = [];
  try { metadata = JSON.parse(sessionStorage.getItem(IMAGE_TEXT_IMAGE_DRAFT_KEY) || '[]'); } catch (_) {}
  if (!Array.isArray(metadata) || !metadata.length || !navigator.storage?.getDirectory) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const restored = [];
    for (const item of metadata.slice(0, MAX_IMAGES)) {
      const handle = await root.getFileHandle(item.filename);
      const storedFile = await handle.getFile();
      restored.push(new File([storedFile], item.name || storedFile.name, {
        type: item.type || storedFile.type,
        lastModified: Number(item.last_modified) || storedFile.lastModified,
      }));
    }
    selectedImages = restored.filter(supportedImage);
    syncNativeImageInput();
    renderImages();
    updateSubmitHint();
    return selectedImages.length > 0;
  } catch (_) {
    sessionStorage.removeItem(IMAGE_TEXT_IMAGE_DRAFT_KEY);
    return false;
  }
}

function clearImagesRuntimeDraft() {
  return queueImageDraftOperation(async () => {
    sessionStorage.removeItem(IMAGE_TEXT_IMAGE_DRAFT_KEY);
    if (!navigator.storage?.getDirectory) return true;
    const root = await navigator.storage.getDirectory();
    await Promise.all(Array.from({ length: MAX_IMAGES }, (_, index) => {
      const filename = `${IMAGE_TEXT_IMAGE_DRAFT_PREFIX}${String(index + 1).padStart(2, '0')}`;
      return root.removeEntry(filename).catch(() => {});
    }));
    return true;
  });
}

function syncNativeImageInput() {
  const transfer = new DataTransfer();
  selectedImages.forEach(file => transfer.items.add(file));
  imagesInput.files = transfer.files;
}

function clearPreviewUrls() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
}

function renderImages() {
  clearPreviewUrls();
  imagePreviewGrid.replaceChildren();
  selectedImages.forEach((file, index) => {
    const card = document.createElement('article');
    card.className = 'image-preview-card';
    const image = document.createElement('img');
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    image.src = url;
    image.alt = `第 ${index + 1} 张图片：${file.name}`;
    const order = document.createElement('span');
    order.className = 'image-preview-order';
    order.textContent = String(index + 1);
    const remove = document.createElement('button');
    remove.className = 'image-preview-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除第 ${index + 1} 张图片`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      selectedImages.splice(index, 1);
      syncNativeImageInput();
      renderImages();
      void saveImagesAsRuntimeDraft();
      updateSubmitHint();
    });
    card.append(image, order, remove);
    imagePreviewGrid.appendChild(card);
  });

  const hasImages = selectedImages.length > 0;
  imageDrop.classList.toggle('has-images', hasImages);
  imageEmptyState.hidden = hasImages;
  imagePreviewState.hidden = !hasImages;
  imageCount.textContent = `${selectedImages.length} / ${MAX_IMAGES}`;
  imagePreviewSummary.textContent = `已选择 ${selectedImages.length} 张图片，可继续添加或删除`;
}

function addImages(files) {
  const incoming = [...files];
  const unsupported = incoming.filter(file => !supportedImage(file));
  if (unsupported.length) notifyToast('图片仅支持 JPG、PNG 或 WebP 格式', 'error');
  const known = new Set(selectedImages.map(imageKey));
  const valid = incoming.filter(file => supportedImage(file) && !known.has(imageKey(file)));
  const available = Math.max(0, MAX_IMAGES - selectedImages.length);
  if (valid.length > available) notifyToast(`最多只能选择 ${MAX_IMAGES} 张图片`, 'error');
  selectedImages.push(...valid.slice(0, available));
  syncNativeImageInput();
  renderImages();
  void saveImagesAsRuntimeDraft();
  updateSubmitHint();
}

function selectedTargets() {
  return [...document.querySelectorAll('.publish-account-option input:checked')].map(input => ({
    platform_key: input.dataset.platform,
    account_id: input.value,
  }));
}

function saveAccountSelections() {
  sessionStorage.setItem(ACCOUNT_SELECTION_KEY, JSON.stringify(selectedTargets()));
}

function restoreAccountSelections() {
  let selected = [];
  try { selected = JSON.parse(sessionStorage.getItem(ACCOUNT_SELECTION_KEY) || '[]'); } catch (_) {}
  const keys = new Set(selected.map(item => `${item.platform_key}:${item.account_id}`));
  document.querySelectorAll('.publish-account-option input').forEach(input => {
    input.checked = keys.has(`${input.dataset.platform}:${input.value}`) && !input.disabled;
  });
}

function updateAccountSelectionUi() {
  document.querySelectorAll('.publish-account-option').forEach(option => {
    option.classList.toggle('selected', option.querySelector('input').checked);
  });
  const selected = new Set(selectedTargets().map(target => target.platform_key));
  Object.entries(declarationInputs).forEach(([key, input]) => {
    const active = selected.has(key);
    input.disabled = !active;
    input.closest('.declaration-card').classList.toggle('inactive', !active);
    input.closest('.declaration-card').classList.toggle('active', active);
  });
  [
    [xhsOriginal, 'xiaohongshu'],
    [channelsHideLocation, 'channels'],
    [channelsOriginal, 'channels'],
  ].forEach(([input, key]) => {
    const active = selected.has(key);
    input.disabled = !active;
    input.closest('.original-option').classList.toggle('inactive', !active);
  });
  updateScheduleUi();
  saveAccountSelections();
  scheduleImageTextDraftSave();
  updateSubmitHint();
}

function accountAvatar(account, key) {
  const avatar = document.createElement('span');
  avatar.className = 'publish-account-avatar';
  const fallback = document.createElement('b');
  fallback.textContent = (account.nickname || IMAGE_TEXT_PLATFORMS[key].name).slice(0, 1);
  avatar.appendChild(fallback);
  if (account.avatar) {
    const image = document.createElement('img');
    image.src = account.avatar;
    image.alt = `${account.nickname || IMAGE_TEXT_PLATFORMS[key].name}头像`;
    image.addEventListener('load', () => avatar.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    avatar.appendChild(image);
  }
  return avatar;
}

function confirmXhsRisk() {
  xhsRiskModal.hidden = false;
  document.body.classList.add('xhs-risk-open');
  return new Promise(resolve => { xhsRiskResolver = resolve; });
}

function closeXhsRisk(accepted) {
  xhsRiskModal.hidden = true;
  document.body.classList.remove('xhs-risk-open');
  xhsRiskResolver?.(accepted);
  xhsRiskResolver = null;
}

function renderAccounts(accounts) {
  accountRoot.replaceChildren();
  Object.entries(IMAGE_TEXT_PLATFORMS).forEach(([key, platform]) => {
    const group = document.createElement('section');
    group.className = 'publish-account-group';
    group.dataset.platform = key;
    const heading = document.createElement('header');
    const logo = document.createElement('span');
    logo.className = `platform-logo ${platform.className}`;
    logo.textContent = platform.logo;
    const items = Array.isArray(accounts?.[key]) ? accounts[key] : [];
    const title = document.createElement('strong');
    title.textContent = `${platform.name} · ${items.length} 个账号`;
    heading.append(logo, title);
    const list = document.createElement('div');
    list.className = 'publish-account-list';
    if (!items.length) {
      const empty = document.createElement('a');
      empty.className = 'publish-account-empty';
      empty.href = '/accounts';
      empty.textContent = `尚未绑定${platform.name}账号，点击前往绑定`;
      list.appendChild(empty);
    } else {
      items.forEach(account => {
        const option = document.createElement('label');
        option.className = `publish-account-option${account.bound ? '' : ' disabled'}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = account.id;
        input.dataset.platform = key;
        input.disabled = !account.bound;
        input.addEventListener('change', async () => {
          if (key === 'xiaohongshu' && input.checked && !(await confirmXhsRisk())) input.checked = false;
          updateAccountSelectionUi();
        });
        const identity = document.createElement('span');
        identity.className = 'publish-account-identity';
        const name = document.createElement('strong');
        const nickname = account.nickname || `${platform.name}账号`;
        name.textContent = account.remark ? `${nickname}（${account.remark}）` : nickname;
        const status = document.createElement('small');
        status.textContent = account.bound ? '已保存独立登录状态' : (account.status_message || '登录已失效，请重新登录');
        identity.append(name, status);
        const check = document.createElement('i');
        check.textContent = '✓';
        option.append(input, accountAvatar(account, key), identity, check);
        list.appendChild(option);
      });
    }
    group.append(heading, list);
    accountRoot.appendChild(group);
  });
  restoreAccountSelections();
  updateAccountSelectionUi();
}

async function loadAccounts() {
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || '读取账号列表失败');
  renderAccounts(result.accounts || {});
}

function updateCounts() {
  document.getElementById('imageTextTitleCount').textContent = `${titleInput.value.length} / 100`;
  document.getElementById('imageTextContentCount').textContent = `${contentInput.value.length} / 1000`;
  [
    ['imageTextTitleDouyin', 'imageTextTitleDouyinCount', 30],
    ['imageTextTitleXiaohongshu', 'imageTextTitleXiaohongshuCount', 20],
    ['imageTextTitleChannels', 'imageTextTitleChannelsCount', 100],
    ['imageTextTitleChannelsShort', 'imageTextTitleChannelsShortCount', 16],
  ].forEach(([inputId, countId, limit]) => {
    document.getElementById(countId).textContent = `${document.getElementById(inputId).value.length} / ${limit}`;
  });
  const customCount = Object.values(IMAGE_TEXT_PLATFORMS).filter(platform => document.getElementById(platform.titleInput).value.trim()).length;
  platformTitleSummary.textContent = customCount ? `已自定义 ${customCount} 个平台标题，其余使用通用标题` : '默认使用通用标题';
  platformTitleSummary.classList.toggle('has-custom', customCount > 0);
}

function localDateTimeValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fillTimeSelect(select, placeholder, values) {
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.appendChild(empty);
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function syncScheduleControl(control) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(control.input.value);
  control.date.value = match?.[1] || '';
  control.hour.value = match?.[2] || '';
  control.minute.value = match?.[3] || '';
}

function updateScheduleControlValue(control) {
  const date = control.date.value;
  const hour = control.hour.value;
  const minute = control.minute.value;
  control.input.value = date && hour && minute ? `${date}T${hour}:${minute}` : '';
}

function scheduleLimits(key, now = Date.now()) {
  const minimumLead = key === 'douyin' || key === 'common'
    ? 2 * 60 * 60 * 1000
    : key === 'xiaohongshu'
      ? 60 * 60 * 1000
      : 5 * 60 * 1000;
  const maximumDays = key === 'douyin' || key === 'common' ? 14 : 15;
  const step = key === 'common' ? 5 * 60 * 1000 : 60 * 1000;
  const minimumTimestamp = Math.ceil((now + minimumLead) / step) * step;
  const maximumTimestamp = Math.floor((now + maximumDays * 24 * 60 * 60 * 1000) / step) * step;
  return {
    minimumLead,
    maximumDays,
    min: localDateTimeValue(new Date(minimumTimestamp)),
    max: localDateTimeValue(new Date(maximumTimestamp)),
  };
}

function refreshScheduleControlOptions(key, control, now = Date.now()) {
  const limits = scheduleLimits(key, now);
  const minimumTimestamp = new Date(limits.min).getTime();
  const maximumTimestamp = new Date(limits.max).getTime();
  control.date.min = limits.min.slice(0, 10);
  control.date.max = limits.max.slice(0, 10);
  control.input.dataset.minimum = limits.min;
  control.input.dataset.maximum = limits.max;
  const date = control.date.value;
  const setOptionAvailability = (option, disabled) => {
    option.disabled = disabled;
    option.textContent = option.value;
  };
  [...control.hour.options].forEach(option => {
    if (!option.value || !date) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const hourStart = new Date(`${date}T${option.value}:00`).getTime();
    const hourEnd = new Date(`${date}T${option.value}:59`).getTime();
    setOptionAvailability(option, hourEnd < minimumTimestamp || hourStart > maximumTimestamp);
  });
  if (control.hour.selectedOptions[0]?.disabled) control.hour.value = '';
  const hour = control.hour.value;
  [...control.minute.options].forEach(option => {
    if (!option.value || !date || !hour) {
      if (option.value) setOptionAvailability(option, false);
      return;
    }
    const timestamp = new Date(`${date}T${hour}:${option.value}`).getTime();
    setOptionAvailability(option, timestamp < minimumTimestamp || timestamp > maximumTimestamp);
  });
  if (control.minute.selectedOptions[0]?.disabled) control.minute.value = '';
  updateScheduleControlValue(control);
}

function setScheduleControlDisabled(control, disabled) {
  control.input.disabled = disabled;
  control.date.disabled = disabled;
  control.hour.disabled = disabled;
  control.minute.disabled = disabled;
  control.date.required = false;
  control.hour.required = false;
  control.minute.required = false;
}

function updateScheduleUi() {
  const enabled = scheduleEnabled.checked;
  const selected = new Set(selectedTargets().map(target => target.platform_key));
  scheduleFields.hidden = !enabled;
  scheduleCard.classList.toggle('active', enabled);
  const now = Date.now();
  setScheduleControlDisabled(commonScheduleControl, !enabled);
  refreshScheduleControlOptions('common', commonScheduleControl, now);
  Object.entries(platformScheduleTimes).forEach(([key, input]) => {
    const active = enabled && selected.has(key);
    const limits = scheduleLimits(key, now);
    input.disabled = !active;
    input.closest('.schedule-time-field').classList.toggle('inactive', !active);
    const control = platformScheduleControls[key];
    if (control) {
      setScheduleControlDisabled(control, !active);
      refreshScheduleControlOptions(key, control, now);
      return;
    }
    input.min = limits.min;
    input.max = limits.max;
  });
}

function scheduleValueError(value, key, label) {
  if (!value) return `请选择完整的${label}定时发布日期和时间`;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return `${label}定时发布时间无效，请重新选择`;
  const limits = scheduleLimits(key);
  if (timestamp < Date.now() + limits.minimumLead) {
    return limits.minimumLead >= 60 * 60 * 1000
      ? `${label}定时发布时间至少需要晚于当前时间 ${limits.minimumLead / (60 * 60 * 1000)} 小时`
      : `${label}定时发布时间至少需要晚于当前时间 ${limits.minimumLead / (60 * 1000)} 分钟`;
  }
  if (timestamp > Date.now() + limits.maximumDays * 24 * 60 * 60 * 1000) return `${label}定时发布时间不能超过当前时间 ${limits.maximumDays} 天`;
  return '';
}

function scheduledTimeError() {
  if (!scheduleEnabled.checked) return '';
  if (commonScheduleTime.value) {
    const commonError = scheduleValueError(commonScheduleTime.value, 'common', '通用');
    if (commonError) return commonError;
    if (Number(commonScheduleTime.value.slice(-2)) % 5 !== 0) return '通用发布时间的分钟只能选择 00、05、10…55';
  }
  const selected = new Set(selectedTargets().map(target => target.platform_key));
  for (const key of selected) {
    const value = platformScheduleTimes[key].value || commonScheduleTime.value;
    if (!value) return `请设置通用发布时间，或单独设置${IMAGE_TEXT_PLATFORMS[key].name}发布时间`;
    const error = scheduleValueError(value, key, IMAGE_TEXT_PLATFORMS[key].name);
    if (error) return error;
  }
  return '';
}

function normalizeChannelsShortTitle(value) {
  return String(value ?? '').replace(/[，,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function channelsShortTitleError(value) {
  const normalized = normalizeChannelsShortTitle(value);
  if (normalized.length > 16) return '视频号短标题不能超过16个字';
  if (!CHANNELS_SHORT_TITLE_ALLOWED.test(normalized)) return '视频号短标题包含不支持的特殊字符；逗号会自动替换为空格';
  return '';
}

function updateSubmitHint() {
  if (startButton.dataset.taskRunning === 'true') return;
  const targetCount = selectedTargets().length;
  if (!selectedImages.length) submitHint.textContent = '请先选择需要发布的图片';
  else if (!targetCount) submitHint.textContent = `已选择 ${selectedImages.length} 张图片，请勾选发布账号`;
  else submitHint.textContent = `已选择 ${selectedImages.length} 张图片、${targetCount} 个账号，每个账号会打开一个独立 Chrome 窗口`;
}

function openPlatformTitles() {
  platformTitleSnapshot = Object.fromEntries([
    ...Object.values(IMAGE_TEXT_PLATFORMS).map(platform => platform.titleInput),
    'imageTextTitleChannelsShort',
  ].map(id => [id, document.getElementById(id).value]));
  platformTitleModal.hidden = false;
  document.body.classList.add('platform-title-modal-open');
}

function closePlatformTitles(restore = false) {
  if (restore) Object.entries(platformTitleSnapshot).forEach(([id, value]) => { document.getElementById(id).value = value; });
  platformTitleModal.hidden = true;
  document.body.classList.remove('platform-title-modal-open');
  updateCounts();
  scheduleImageTextDraftSave();
}

function effectiveTitle(key) {
  return document.getElementById(IMAGE_TEXT_PLATFORMS[key].titleInput).value.trim() || titleInput.value.trim();
}

function validateForm() {
  if (!selectedImages.length) throw new Error('请至少选择一张图片');
  const targets = selectedTargets();
  if (!targets.length) throw new Error('请至少选择一个发布账号');
  const selectedPlatforms = [...new Set(targets.map(target => target.platform_key))];
  const missing = selectedPlatforms.filter(key => !effectiveTitle(key));
  if (missing.length) throw new Error(`请填写通用标题或这些平台的独立标题：${missing.map(key => IMAGE_TEXT_PLATFORMS[key].name).join('、')}`);
  if (selectedPlatforms.includes('channels')) {
    const shortTitleError = channelsShortTitleError(channelsShortTitleInput.value);
    if (shortTitleError) throw new Error(shortTitleError);
  }
  const scheduleError = scheduledTimeError();
  if (scheduleError) throw new Error(scheduleError);
  return targets;
}

function resetTaskButton() {
  delete startButton.dataset.taskRunning;
  startButton.disabled = false;
  startButton.innerHTML = '<span>↑</span> 上传图文到所选平台';
}

function showCompletion(task) {
  const failed = Number(task.failed) > 0;
  completionDialog.classList.toggle('has-error', failed);
  completionDialog.querySelector('.completion-icon').textContent = failed ? '!' : '✓';
  document.getElementById('imageTextCompletionTitle').textContent = failed ? '部分图文账号未完成' : '图文资料处理完成';
  document.getElementById('imageTextCompletionMessage').textContent = failed ? '请查看失败原因和保留的平台页面' : '请在各平台窗口检查资料并手动发布';
  const results = document.getElementById('imageTextCompletionResults');
  results.replaceChildren();
  (task.results || []).forEach(result => {
    const row = document.createElement('div');
    row.className = `completion-result${result.success ? '' : ' error'}`;
    const name = document.createElement('strong');
    name.textContent = `${result.platform} · ${result.account}`;
    const status = document.createElement('span');
    status.textContent = result.success ? '填写完成' : (result.message || '处理失败');
    row.append(name, status);
    results.appendChild(row);
  });
  completionModal.hidden = false;
}

function setTaskUi(task) {
  actionPanel.classList.remove('task-running', 'task-completed', 'task-error');
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status)) {
    clearInterval(taskTimer);
    activeTaskId = '';
    localStorage.removeItem(ACTIVE_TASK_KEY);
    resetTaskButton();
    actionPanel.classList.add(task.failed ? 'task-error' : 'task-completed');
    submitTitle.textContent = task.failed ? '本次有图文账号未完成' : '所选平台图文资料填写完成';
    submitHint.textContent = task.message || '请在各 Chrome 窗口检查资料并手动发布';
    showCompletion(task);
    void loadAccounts().catch(() => {});
    return;
  }
  actionPanel.classList.add('task-running');
  startButton.dataset.taskRunning = 'true';
  startButton.disabled = true;
  startButton.innerHTML = '<span>···</span> 正在并行打开并填写图文页面';
  submitTitle.textContent = `正在处理图文任务${task.finished ? `（${task.finished}/${task.total}）` : ''}`;
  submitHint.textContent = task.message || '每个平台会打开一个独立 Chrome 窗口';
}

async function pollTask() {
  if (!activeTaskId) return;
  try {
    const response = await fetch(`/api/image-text/tasks/${activeTaskId}`, { cache: 'no-store' });
    if (response.status === 404) {
      activeTaskId = '';
      localStorage.removeItem(ACTIVE_TASK_KEY);
      clearInterval(taskTimer);
      resetTaskButton();
      updateSubmitHint();
      return;
    }
    const task = await response.json();
    if (!response.ok) throw new Error(task.detail || '读取图文任务状态失败');
    setTaskUi(task);
  } catch (_) {
    submitHint.textContent = '暂时无法读取图文任务状态，稍后将自动重试';
  }
}

function beginPolling() {
  clearInterval(taskTimer);
  void pollTask();
  taskTimer = setInterval(pollTask, 1000);
}

imagesInput.addEventListener('click', prepareSmallNativeFileDialog, { capture: true });
imagesInput.addEventListener('change', event => addImages(event.target.files || []));
document.getElementById('addImagesButton').addEventListener('click', () => imagesInput.click());
let dragDepth = 0;
imageDrop.addEventListener('dragenter', event => { event.preventDefault(); dragDepth += 1; imageDrop.classList.add('is-dragging'); });
imageDrop.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; imageDrop.classList.add('is-dragging'); });
imageDrop.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) imageDrop.classList.remove('is-dragging'); });
imageDrop.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; imageDrop.classList.remove('is-dragging'); addImages(event.dataTransfer?.files || []); });

[titleInput, contentInput, channelsShortTitleInput, ...Object.values(IMAGE_TEXT_PLATFORMS).map(platform => document.getElementById(platform.titleInput))].forEach(input => input.addEventListener('input', updateCounts));
fixedTopicInput.addEventListener('input', () => localStorage.setItem(FIXED_TOPIC_KEY, fixedTopicInput.value));
form.addEventListener('input', scheduleImageTextDraftSave);
form.addEventListener('change', scheduleImageTextDraftSave);
document.getElementById('openImageTextPlatformTitles').addEventListener('click', openPlatformTitles);
document.getElementById('closeImageTextPlatformTitles').addEventListener('click', () => closePlatformTitles(true));
document.getElementById('cancelImageTextPlatformTitles').addEventListener('click', () => closePlatformTitles(true));
document.getElementById('saveImageTextPlatformTitles').addEventListener('click', () => {
  channelsShortTitleInput.value = normalizeChannelsShortTitle(channelsShortTitleInput.value);
  closePlatformTitles(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !platformTitleModal.hidden) closePlatformTitles(true);
});
scheduleEnabled.addEventListener('change', updateScheduleUi);
function openSchedulePicker(input) {
  if (!input || input.disabled) return;
  input.focus();
  if (typeof input.showPicker !== 'function') return;
  try { input.showPicker(); } catch (_) {}
}
[
  ['common', commonScheduleControl],
  ...Object.entries(platformScheduleControls),
].forEach(([key, control]) => {
  control.date.addEventListener('click', () => openSchedulePicker(control.date));
  [control.date, control.hour, control.minute].forEach(field => {
    field.addEventListener('change', () => refreshScheduleControlOptions(key, control));
  });
});
document.getElementById('imageTextXhsRiskCancel').addEventListener('click', () => closeXhsRisk(false));
document.getElementById('imageTextXhsRiskContinue').addEventListener('click', () => closeXhsRisk(true));
document.getElementById('completionClose').addEventListener('click', () => { completionModal.hidden = true; });

document.getElementById('clearImageTextButton').addEventListener('click', async () => {
  const clearButton = document.getElementById('clearImageTextButton');
  const fixedTopic = fixedTopicInput.value;
  const retainedTargetKeys = new Set(selectedTargets().map(target => `${target.platform_key}:${target.account_id}`));
  draftPaused = true;
  clearTimeout(draftSaveTimer);
  clearButton.disabled = true;
  clearButton.textContent = '清空中…';
  selectedImages = [];
  syncNativeImageInput();
  form.reset();
  fixedTopicInput.value = fixedTopic;
  document.querySelectorAll('.publish-account-option input').forEach(input => {
    input.checked = retainedTargetKeys.has(`${input.dataset.platform}:${input.value}`) && !input.disabled;
  });
  renderImages();
  updateCounts();
  updateAccountSelectionUi();
  sessionStorage.removeItem(IMAGE_TEXT_DRAFT_KEY);
  const cleanup = clearImagesRuntimeDraft();
  draftPaused = false;
  await cleanup.catch(() => {});
  clearButton.disabled = false;
  clearButton.textContent = '清空';
  notifyToast('已清空本次图文内容，账号选择和固定标签已保留', 'success');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  let targets;
  try { targets = validateForm(); } catch (error) { notifyToast(error.message, 'error'); return; }
  startButton.disabled = true;
  startButton.dataset.taskRunning = 'true';
  startButton.innerHTML = '<span>···</span> 正在创建图文任务';
  submitTitle.textContent = '正在准备图片和账号资料';
  submitHint.textContent = '请稍候，即将打开各平台 Chrome 窗口';
  try {
    syncNativeImageInput();
    const data = new FormData(form);
    data.set('targets', JSON.stringify(targets));
    data.set('schedule_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    data.set('short_title_channels', normalizeChannelsShortTitle(channelsShortTitleInput.value));
    data.set('original', xhsOriginal.checked ? 'true' : 'false');
    data.set('channels_hide_location', channelsHideLocation.checked ? 'true' : 'false');
    data.set('channels_original', channelsOriginal.checked ? 'true' : 'false');
    data.set('schedule_enabled', scheduleEnabled.checked ? 'true' : 'false');
    const response = await fetch('/api/image-text/tasks', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '创建图文任务失败');
    activeTaskId = result.task_id;
    localStorage.setItem(ACTIVE_TASK_KEY, activeTaskId);
    actionPanel.classList.add('task-running');
    beginPolling();
  } catch (error) {
    resetTaskButton();
    actionPanel.classList.add('task-error');
    submitTitle.textContent = '图文任务创建失败';
    submitHint.textContent = error.message;
    notifyToast(error.message, 'error');
  }
});

fixedTopicInput.value = localStorage.getItem(FIXED_TOPIC_KEY) || '';
restoreImageTextDraft();
const scheduleHours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const everyMinute = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const everyFiveMinutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));
fillTimeSelect(commonScheduleControl.hour, '时', scheduleHours);
fillTimeSelect(commonScheduleControl.minute, '分', everyFiveMinutes);
fillTimeSelect(platformScheduleControls.douyin.hour, '时', scheduleHours);
fillTimeSelect(platformScheduleControls.douyin.minute, '分', everyMinute);
fillTimeSelect(platformScheduleControls.xiaohongshu.hour, '时', scheduleHours);
fillTimeSelect(platformScheduleControls.xiaohongshu.minute, '分', everyMinute);
fillTimeSelect(platformScheduleControls.channels.hour, '时', scheduleHours);
fillTimeSelect(platformScheduleControls.channels.minute, '分', everyMinute);
syncScheduleControl(commonScheduleControl);
Object.values(platformScheduleControls).forEach(syncScheduleControl);
renderImages();
void restoreImagesFromRuntimeDraft();
updateCounts();
loadAccounts().catch(error => {
  accountRoot.innerHTML = `<div class="account-list-loading">${error.message}</div>`;
});
updateScheduleUi();
scheduleLimitsTimer = setInterval(() => {
  if (scheduleEnabled.checked) updateScheduleUi();
}, 30_000);
document.addEventListener('click', async event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
  let destination;
  try { destination = new URL(link.href, window.location.href); } catch (_) { return; }
  if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
  saveImageTextDraft();
  const pendingSave = pendingImageDraftSave;
  if (!pendingSave) return;
  event.preventDefault();
  notifyToast('正在保存图文图片临时草稿，完成后自动切换页面');
  const saved = await pendingSave.then(Boolean).catch(() => false);
  if (saved) window.location.assign(destination.href);
  else notifyToast('图片临时草稿保存失败，已留在图文发布页避免内容丢失', 'error');
});
window.addEventListener('pagehide', () => {
  clearInterval(scheduleLimitsTimer);
  saveImageTextDraft();
});
if (activeTaskId) beginPolling();
