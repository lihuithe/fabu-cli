const PLATFORM_NAMES = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  channels: '视频号',
  bilibili: 'B站',
};
let pollTimer = null;
let activeBinding = null;
let missingProfileRefreshStarted = false;
const xhsRiskModal = document.getElementById('xhsRiskModal');
const xhsRiskCancel = document.getElementById('xhsRiskCancel');
const xhsRiskContinue = document.getElementById('xhsRiskContinue');
let xhsRiskResolve = null;
try {
  activeBinding = JSON.parse(localStorage.getItem('activeAccountBinding') || 'null');
} catch (_) {
  activeBinding = null;
}

function platformPanel(key) {
  return document.querySelector(`.account-platform[data-key="${key}"]`);
}

function closeXhsRisk(confirmed) {
  xhsRiskModal.hidden = true;
  document.body.classList.remove('xhs-risk-open');
  const resolve = xhsRiskResolve;
  xhsRiskResolve = null;
  if (resolve) resolve(confirmed);
}

function confirmXhsRisk() {
  if (xhsRiskResolve) return Promise.resolve(false);
  xhsRiskModal.hidden = false;
  document.body.classList.add('xhs-risk-open');
  xhsRiskCancel.focus();
  return new Promise((resolve) => { xhsRiskResolve = resolve; });
}

xhsRiskCancel.addEventListener('click', () => closeXhsRisk(false));
xhsRiskContinue.addEventListener('click', () => closeXhsRisk(true));
xhsRiskModal.addEventListener('click', (event) => { if (event.target === xhsRiskModal) closeXhsRisk(false); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !xhsRiskModal.hidden) closeXhsRisk(false);
});

function accountDisplayName(account, key) {
  const nickname = account.nickname || `${PLATFORM_NAMES[key]}账号`;
  return account.remark ? `${nickname}（${account.remark}）` : nickname;
}

function avatarNode(account, key) {
  const box = document.createElement('span');
  box.className = 'account-avatar';
  const fallback = document.createElement('b');
  fallback.textContent = (account.nickname || PLATFORM_NAMES[key]).slice(0, 1);
  box.appendChild(fallback);
  if (account.avatar) {
    const image = document.createElement('img');
    image.src = account.avatar;
    image.alt = `${account.nickname || PLATFORM_NAMES[key]}头像`;
    image.addEventListener('load', () => box.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    box.appendChild(image);
  }
  return box;
}

function accountCard(account, key) {
  const card = document.createElement('div');
  card.className = 'bound-account';
  card.dataset.accountId = account.id;
  card.appendChild(avatarNode(account, key));

  const identity = document.createElement('div');
  identity.className = 'account-identity';
  const name = document.createElement('strong');
  name.textContent = accountDisplayName(account, key);
  const detail = document.createElement('span');
  detail.textContent = account.bound
    ? (account.bound_at ? `绑定于 ${account.bound_at}` : '已保存独立登录状态')
    : (account.status_message || '登录状态已丢失，请重新登录');
  identity.append(name, detail);

  const state = document.createElement('span');
  state.className = `saved-state${account.bound ? '' : ' invalid'}`;
  state.textContent = account.bound ? '可发布' : (account.login_status === 'invalid' ? '登录失效' : '状态丢失');

  const actions = document.createElement('div');
  actions.className = 'account-item-actions';
  const rebind = document.createElement('button');
  rebind.type = 'button';
  rebind.className = 'rebind-account';
  rebind.textContent = '重新登录';
  rebind.addEventListener('click', () => beginBinding(key, account.remark || '', account.id));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-account';
  remove.textContent = '删除';
  remove.addEventListener('click', () => deleteAccount(key, account));
  actions.append(rebind, remove);
  card.append(identity, state, actions);
  return card;
}

function renderAccounts(accounts) {
  Object.keys(PLATFORM_NAMES).forEach((key) => {
    const panel = platformPanel(key);
    const list = panel.querySelector('.bound-account-list');
    const items = Array.isArray(accounts[key]) ? accounts[key] : [];
    panel.querySelector('[data-count]').textContent = `${items.length} 个账号`;
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-account-list';
      empty.textContent = `尚未绑定${PLATFORM_NAMES[key]}账号`;
      list.appendChild(empty);
      return;
    }
    items.forEach((account) => list.appendChild(accountCard(account, key)));
  });
}

async function loadAccounts() {
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || '读取账号列表失败');
  const accounts = result.accounts || {};
  renderAccounts(accounts);
  if (!missingProfileRefreshStarted) {
    missingProfileRefreshStarted = true;
    void refreshMissingProfiles(accounts);
  }
}

async function refreshMissingProfiles(accounts) {
  const pending = ['xiaohongshu', 'bilibili'].flatMap((key) =>
    (accounts[key] || []).filter((account) => account.bound && account.profile_needs_refresh).map((account) => ({ key, id: account.id }))
  );
  if (!pending.length) return;
  let refreshed = false;
  for (const account of pending) {
    try {
      const response = await fetch(`/api/accounts/${account.key}/${account.id}/refresh-profile`, { method: 'POST', cache: 'no-store' });
      if (response.ok) refreshed = true;
    } catch (_) {}
  }
  if (!refreshed) return;
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  const result = await response.json();
  if (response.ok) renderAccounts(result.accounts || {});
}

function renderBindingStatus(key, status) {
  const panel = platformPanel(key);
  const progress = panel.querySelector('.binding-progress');
  const button = panel.querySelector('.add-account');
  progress.hidden = false;
  progress.querySelector('b').textContent = status.progress >= 85 ? '正在保存账号资料' : '等待扫码登录';
  progress.querySelector('span').textContent = status.message || '登录成功后会自动采集昵称和头像';
  button.disabled = true;
  button.textContent = status.progress >= 85 ? '正在采集账号信息…' : '等待扫码…';
}

function clearBindingUi(key) {
  const panel = platformPanel(key);
  panel.querySelector('.binding-progress').hidden = true;
  const button = panel.querySelector('.add-account');
  button.disabled = false;
  button.textContent = '＋ 绑定新账号';
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling(binding) {
  stopPolling();
  activeBinding = binding;
  localStorage.setItem('activeAccountBinding', JSON.stringify(binding));
  const check = async () => {
    try {
      const response = await fetch(`/api/account-bindings/${binding.binding_id}/status`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '读取绑定状态失败');
      const status = result.status || {};
      if (status.is_running) {
        renderBindingStatus(binding.platform_key, status);
        return;
      }
      stopPolling();
      localStorage.removeItem('activeAccountBinding');
      activeBinding = null;
      clearBindingUi(binding.platform_key);
      if (status.status === 'completed') {
        await loadAccounts();
        platformPanel(binding.platform_key).querySelector('.account-remark').value = '';
        showToast(`已采集“${accountDisplayName(status.account || {}, binding.platform_key)}”的昵称和头像，绑定成功`, 'success');
      } else if (status.status === 'failed') {
        showToast(status.message || '账号绑定失败', 'error');
      }
    } catch (error) {
      stopPolling();
      localStorage.removeItem('activeAccountBinding');
      activeBinding = null;
      clearBindingUi(binding.platform_key);
      showToast(error.message, 'error');
    }
  };
  check();
  pollTimer = setInterval(check, 1000);
}

async function beginBinding(key, presetRemark = '', accountId = '') {
  if (activeBinding) return showToast('请先完成当前账号的扫码绑定', 'error');
  if (key === 'xiaohongshu' && !(await confirmXhsRisk())) return;
  const panel = platformPanel(key);
  const remarkField = panel.querySelector('.account-remark');
  const remark = presetRemark || remarkField.value.trim();
  renderBindingStatus(key, { progress: 20, message: '正在打开较小的扫码登录窗口' });
  try {
    const response = await fetch(`/api/accounts/${key}/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ remark, account_id: accountId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '启动账号绑定失败');
    startPolling({ binding_id: result.binding_id, platform_key: key });
    showToast('请在弹出的小窗口中扫码，登录后会自动完成绑定');
  } catch (error) {
    clearBindingUi(key);
    showToast(error.message, 'error');
  }
}

async function deleteAccount(key, account) {
  if (!confirm(`确定删除“${accountDisplayName(account, key)}”吗？该账号保存的登录状态也会一并删除。`)) return;
  try {
    const response = await fetch(`/api/accounts/${key}/${account.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '删除账号失败');
    await loadAccounts();
    showToast('账号已删除', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

document.querySelectorAll('.account-platform').forEach((panel) => {
  const key = panel.dataset.key;
  panel.querySelector('.add-account').addEventListener('click', () => beginBinding(key));
});

loadAccounts().then(() => {
  if (activeBinding?.binding_id && activeBinding?.platform_key) startPolling(activeBinding);
}).catch((error) => showToast(error.message, 'error'));
