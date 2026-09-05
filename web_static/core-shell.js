const activePage = document.body.dataset.page;
const navigation = [
  ['publish', '/publish', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v5a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-5"/></svg>', '视频发布'],
  ['image-text-publish', '/image-text-publish', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="8.5" cy="9" r="1.5"/><path d="m5.5 17 4.2-4.2 2.8 2.8 2.4-2.4 3.6 3.8"/></svg>', '图文发布'],
  ['accounts', '/accounts', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"/><path d="M18 5.5c1.7.3 2.5 1.3 2.5 3s-.8 2.7-2.5 3"/></svg>', '平台账号'],
];
const navigationHtml = navigation.map(([key, href, icon, label]) =>
  `<a class="nav-link ${activePage === key ? 'active' : ''}" href="${href}"${activePage === key ? ' aria-current="page"' : ''}><span class="menu-icon">${icon}</span>${label}</a>`
).join('');

document.body.insertAdjacentHTML('afterbegin', `
  <nav class="topbar navbar navbar-dark fixed-top">
    <div class="container-fluid px-4">
      <a class="navbar-brand d-flex align-items-center gap-2" href="/accounts"><span class="brand-mark"><img src="/static/app-icon.png" alt="" style="display:block;width:100%;height:100%;object-fit:cover"></span><span>发布Ready</span></a>
    </div>
  </nav>
  <aside class="sidebar">
    <div class="sidebar-inner"><div class="menu-label">工作台</div>${navigationHtml}</div>
    <div class="sidebar-note"><div class="note-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 5.7v5.1c0 4.3 2.5 7.8 6.5 10.2 4-2.4 6.5-5.9 6.5-10.2V5.7L12 3Z"/><path d="m9 12 2 2 4-4"/></svg></div><div><strong>默认准备资料</strong><small>开启直接发布时会提交到平台</small></div></div>
  </aside>
`);

document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (new URL(link.href).pathname === location.pathname) event.preventDefault();
  });
});

window.showToast = function(message, type = '') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast-box show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { toast.className = 'toast-box'; }, 3200);
};

function enhanceDeclarationSelect(select) {
  if (select.dataset.enhancedSelect === 'true') return;
  select.dataset.enhancedSelect = 'true';
  select.classList.add('ui-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const root = document.createElement('div');
  root.className = 'ui-select';
  const trigger = document.createElement('button');
  trigger.className = 'ui-select-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '选择平台声明');
  trigger.innerHTML = '<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  const menu = document.createElement('div');
  menu.className = 'ui-select-menu';
  menu.id = `uiSelectMenu${document.querySelectorAll('.ui-select').length + 1}`;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);

  select.parentNode.insertBefore(root, select);
  root.append(select, trigger, menu);

  const options = [...select.options].map((option, index) => {
    const item = document.createElement('button');
    item.className = 'ui-select-option';
    item.type = 'button';
    item.dataset.value = option.value;
    item.dataset.index = String(index);
    item.setAttribute('role', 'option');
    item.innerHTML = `<span>${option.textContent}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;
    item.disabled = option.disabled;
    item.addEventListener('click', () => {
      if (item.disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      trigger.focus();
    });
    menu.appendChild(item);
    return item;
  });

  function sync() {
    const selected = select.options[select.selectedIndex];
    trigger.querySelector('span').textContent = selected?.textContent || '请选择';
    trigger.disabled = select.disabled;
    trigger.classList.toggle('placeholder', !select.value);
    options.forEach((item, index) => {
      const active = index === select.selectedIndex;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-selected', String(active));
      item.disabled = select.options[index]?.disabled || false;
    });
    if (select.disabled) close();
  }

  function open() {
    if (trigger.disabled) return;
    document.querySelectorAll('.ui-select.open').forEach(other => {
      if (other !== root) other.querySelector('.ui-select-trigger')?.click();
    });
    root.classList.add('open');
    root.closest('.declaration-card')?.classList.add('select-open');
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const active = options[select.selectedIndex] || options.find(item => !item.disabled);
    active?.focus();
  }

  function close() {
    root.classList.remove('open');
    root.closest('.declaration-card')?.classList.remove('select-open');
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function moveFocus(direction) {
    const enabled = options.filter(item => !item.disabled);
    const current = enabled.indexOf(document.activeElement);
    const next = current < 0 ? 0 : (current + direction + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }

  trigger.addEventListener('click', () => root.classList.contains('open') ? close() : open());
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open();
    moveFocus(event.key === 'ArrowDown' ? 1 : -1);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.key === 'ArrowDown' ? 1 : -1);
    }
  });
  select.addEventListener('change', sync);
  select.form?.addEventListener('reset', () => setTimeout(sync));
  new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('click', event => {
    if (!root.contains(event.target)) close();
  });
  sync();
}

function enhanceDeclarationSelects() {
  document.querySelectorAll('.declaration-card select.form-select').forEach(enhanceDeclarationSelect);
}


if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceDeclarationSelects, { once: true });
else enhanceDeclarationSelects();
