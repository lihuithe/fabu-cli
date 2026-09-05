import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { PLATFORMS } from "./platforms.js";
import { findVideoInput } from "./browser-utils.js";
import { applicationDataRoot } from "./runtime-paths.js";
import { AppError } from './errors.js';

const ROOT = applicationDataRoot(import.meta.url, 1);
const ACCOUNT_ROOT = path.join(ROOT, "account_data");
const STATE_ROOT = path.join(ACCOUNT_ROOT, "states");
export const ACCOUNT_ASSET_ROOT = path.join(ACCOUNT_ROOT, "avatars");
export const DEFAULT_ACCOUNT_AVATAR = "/static/default-account-avatar.svg";
export const LOGIN_INVALID_MESSAGE = "该账号登录失效，请到平台账号页面重新登录";
const METADATA_FILE = path.join(ACCOUNT_ROOT, "bindings.json");
const activeBindingBrowsers = new Set();
const closingBindingBrowsers = new WeakSet();
fs.mkdirSync(STATE_ROOT, { recursive: true });
fs.mkdirSync(ACCOUNT_ASSET_ROOT, { recursive: true });

const LOGIN_SELECTORS = {
  douyin: ["div.name-_lSSDc", 'div[class*="userName"]', 'div[class*="nickname"]', "div.unique_id-EuH8eA"],
  xiaohongshu: [
    ".user-info .name-box",
    ".user-info .account-name",
    '[class*="user-info"] [class*="name-box"]',
    '[class*="user-info"] [class*="account-name"]',
    '[class*="user-name"]',
    '[class*="nickname"]'
  ],
  channels: ["div.finder-info-container h2.finder-nickname", "h2.finder-nickname", ".weui-desktop-account__nickname", '[class*="finder-nickname"]', '[class*="nickname"]'],
  bilibili: [
    ".header-avatar-wrap .user-name",
    ".bcc-header .user-name",
    '[class*="header"] [class*="nav-user-name"]',
    '[class*="header"] [class*="header-user-name"]'
  ]
};
const AVATAR_SELECTORS = {
  douyin: ['img[class*="avatar"]', '[class*="avatar"] img', '[class*="avatar"]', 'header img[src*="avatar"]'],
  xiaohongshu: [
    ".user-info img.user_avatar",
    '.user-info img[class*="avatar"]',
    'img.user_avatar',
    '[class*="user-info"] img[class*="avatar"]'
  ],
  channels: ["div.finder-info-container img.avatar", 'img[class*="avatar"]', '[class*="avatar"] img', '[class*="avatar"]', ".weui-desktop-account img"],
  bilibili: [
    ".header-avatar-wrap img",
    "header .bcc-avatar img",
    'header img[src*="/face/"]',
    '[class*="header"] img[src*="/face/"]'
  ]
};
const LOGIN_COOKIES = {
  douyin: new Set(["sessionid", "sessionid_ss", "sid_guard"]),
  xiaohongshu: new Set(["web_session", "access-token-creator.xiaohongshu.com", "customer-sso-sid", "galaxy_creator_session_id"]),
  channels: new Set(["sessionid", "session_id", "finder_biz_login"]),
  bilibili: new Set(["SESSDATA"])
};
const LOGIN_FOCUS_SELECTORS = {
  douyin: ['article:has-text("扫码登录")', 'input[placeholder="请输入手机号"]', 'text="扫码登录"', '[class*="qrcode"]', '[class*="qr-code"]', '[class*="login"] canvas'],
  xiaohongshu: ['input[placeholder="手机号"]', ".login-box-container", ".sso-login-wrapper", '[class*="qrcode"]', '[class*="qr-code"]', '[class*="login"]'],
  channels: ['text="扫码登录"', 'text="微信扫码登录"', '[class*="qrcode"]', '[class*="qr_code"]', ".login-container", "canvas"],
  bilibili: ['img[alt="Scan me!"]', ".login-scan__qrcode", '[class*="qrcode"]', '[class*="qr-code"]', '[class*="login"] canvas']
};
const LOGIN_EXPIRED_SELECTORS = {
  douyin: ['article:has-text("扫码登录")', 'text="扫码登录"', 'input[placeholder="请输入手机号"]', 'input[placeholder*="手机号"]', '[class*="login"] [class*="qrcode"]', '[class*="login"] canvas'],
  xiaohongshu: ['input[placeholder="手机号"]', 'input[placeholder*="手机号"]', ".login-box-container", ".sso-login-wrapper", '[class*="login"] [class*="qrcode"]', '[class*="login"] canvas'],
  channels: ['text="微信扫码登录"', 'text="扫码登录"', ".login-container", '[class*="login"] [class*="qrcode"]', '[class*="login"] canvas'],
  bilibili: ['img[alt="Scan me!"]', ".login-scan__qrcode", 'input[placeholder*="账号"]', 'input[placeholder*="密码"]', '[class*="login"] [class*="qrcode"]']
};
const LOGIN_EXPIRED_URLS = {
  douyin: [/\/login(?:[/?#]|$)/i, /passport\.(?:douyin|bytedance)\.com/i],
  xiaohongshu: [/\/(?:new\/)?login(?:[/?#]|$)/i, /\/sso(?:[/?#]|$)/i],
  channels: [/\/login(?:[./?#]|$)/i],
  bilibili: [/passport\.bilibili\.com/i, /\/login(?:[/?#]|$)/i]
};
const LOGIN_INSTRUCTIONS = Object.freeze({
  douyin: "扫码登录",
  xiaohongshu: "手机号和验证码登录",
  channels: "微信扫码登录",
  bilibili: "扫码或账号登录"
});
export const BINDING_URLS = Object.freeze({
  channels: "https://channels.weixin.qq.com"
});
const PROFILE_URLS = Object.freeze({
  xiaohongshu: "https://creator.xiaohongshu.com/new/home",
  bilibili: "https://member.bilibili.com/platform/home"
});
export const BINDING_WINDOW = Object.freeze({
  width: 1200,
  height: 820,
  viewport: Object.freeze({ width: 1180, height: 740 })
});

async function closeBindingBrowser(browser) {
  if (!browser || closingBindingBrowsers.has(browser)) return;
  closingBindingBrowsers.add(browser);
  activeBindingBrowsers.delete(browser);
  await browser.close().catch(() => {});
}

export function trackBindingBrowser(browser) {
  activeBindingBrowsers.add(browser);
  browser.on("disconnected", () => activeBindingBrowsers.delete(browser));
}

export async function closeActiveBindingBrowsers() {
  await Promise.allSettled([...activeBindingBrowsers].map(browser => closeBindingBrowser(browser)));
}

export function chromeCandidates(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.posix.join(home.replaceAll("\\", "/"), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
    ];
  }
  if (platform === "linux") {
    return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  }
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe")
  ];
}

export function chromePath() {
  const candidates = chromeCandidates();
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error("未找到 Google Chrome，请先安装 Chrome");
  return found;
}

function readJson(filename, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); } catch { return fallback; }
}

function atomicWrite(filename, value) {
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filename);
}

function nowText(includeSeconds = false) {
  return new Date().toLocaleString("sv-SE", { hour12: false }).slice(0, includeSeconds ? 19 : 16);
}

export function storedNickname(record, platformName) {
  const nickname = String(record?.nickname ?? "").trim();
  const remark = String(record?.remark ?? "").trim();
  if (!record?.nickname_captured && remark && nickname === remark) return `${platformName}账号`;
  return nickname || `${platformName}账号`;
}

export function storedAvatar(record) {
  const avatar = String(record?.avatar ?? "").trim();
  if (!avatar) return DEFAULT_ACCOUNT_AVATAR;
  if (!avatar.startsWith("/account-assets/")) return avatar;
  const avatarPath = path.join(ACCOUNT_ASSET_ROOT, path.basename(avatar));
  return fs.existsSync(avatarPath) ? avatar : DEFAULT_ACCOUNT_AVATAR;
}

function emptyRegistry() {
  return { version: 2, accounts: Object.fromEntries(Object.keys(PLATFORMS).map(key => [key, []])) };
}

function normalizedRegistry() {
  const raw = readJson(METADATA_FILE, {});
  if (raw.version === 2 && raw.accounts && typeof raw.accounts === "object") {
    const registry = emptyRegistry();
    for (const key of Object.keys(PLATFORMS)) {
      registry.accounts[key] = Array.isArray(raw.accounts[key]) ? raw.accounts[key].filter(item => item && item.id) : [];
    }
    return registry;
  }
  const registry = emptyRegistry();
  for (const key of Object.keys(PLATFORMS)) {
    const legacy = raw[key];
    const oldState = path.join(STATE_ROOT, `${key}.json`);
    if (!legacy?.bound || !fs.existsSync(oldState)) continue;
    registry.accounts[key].push({
      id: `legacy-${key}`,
      platform_key: key,
      nickname: legacy.account || "默认账号",
      remark: legacy.account || "默认账号",
      avatar: "",
      bound_at: legacy.bound_at || nowText(),
      runtime_saved_at: legacy.runtime_saved_at || "",
      state_file: `${key}.json`
    });
  }
  if (Object.values(registry.accounts).some(items => items.length)) atomicWrite(METADATA_FILE, registry);
  return registry;
}

function hostMatches(platformKey, value) {
  const platformHost = new URL(PLATFORMS[platformKey].url).hostname.toLowerCase();
  const host = String(value ?? "").toLowerCase().replace(/^\./, "");
  return Boolean(host) && (host === platformHost || platformHost.endsWith(`.${host}`));
}

async function visibleText(page, selectors) {
  for (const selector of selectors) {
    try {
      const candidates = page.locator(selector);
      for (let index = 0; index < Math.min(await candidates.count(), 12); index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible({ timeout: 100 }))) continue;
        const text = (await candidate.innerText({ timeout: 200 })).trim().replace(/\s+/g, " ");
        if (text && text.length <= 80 && !/登录|扫码|发布视频|创作中心/.test(text)) return text;
      }
    } catch {}
  }
  return "";
}

export function bilibiliProfileFromPayload(payload) {
  const data = payload?.data;
  if (payload?.code !== 0 || !data?.isLogin) return { nickname: "", avatar_source: "" };
  const nickname = String(data.uname ?? "").trim().replace(/\s+/g, " ");
  const avatarSource = String(data.face ?? "").trim();
  return {
    nickname: nickname.length <= 80 ? nickname : "",
    avatar_source: /^https?:\/\//i.test(avatarSource) && !/\/noface\./i.test(avatarSource) ? avatarSource : ""
  };
}

async function platformApiProfile(context, key) {
  if (key !== "bilibili") return { nickname: "", avatar_source: "" };
  try {
    const response = await context.request.get("https://api.bilibili.com/x/web-interface/nav", { timeout: 10_000 });
    if (!response.ok()) return { nickname: "", avatar_source: "" };
    return bilibiliProfileFromPayload(await response.json());
  } catch {
    return { nickname: "", avatar_source: "" };
  }
}

async function avatarUrl(page, key) {
  for (const selector of AVATAR_SELECTORS[key] ?? []) {
    try {
      const candidates = page.locator(selector);
      for (let index = 0; index < Math.min(await candidates.count(), 16); index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible({ timeout: 100 }))) continue;
        const box = await candidate.boundingBox();
        if (!box || box.width < 20 || box.height < 20 || box.width > 240 || box.height > 240) continue;
        let source = await candidate.getAttribute("src");
        if (!source) {
          const background = await candidate.evaluate(element => getComputedStyle(element).backgroundImage);
          const match = String(background).match(/^url\(["']?(.*?)["']?\)$/);
          source = match?.[1] || "";
        }
        if (!source || /qrcode|qr-code/i.test(source)) continue;
        try { return new URL(source, page.url()).href; } catch { return source; }
      }
    } catch {}
  }
  return "";
}

function avatarExtension(contentType, source) {
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/gif/i.test(contentType)) return ".gif";
  if (/jpe?g/i.test(contentType)) return ".jpg";
  const extension = path.extname(String(source).split(/[?#]/)[0]).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension) ? extension : ".jpg";
}

async function saveAvatar(context, source, platformKey, accountId) {
  if (!source) return "";
  try {
    let body;
    let contentType = "";
    if (source.startsWith("data:image/")) {
      const match = source.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s);
      if (!match) return "";
      contentType = match[1];
      body = source.includes(";base64,") ? Buffer.from(match[2], "base64") : Buffer.from(decodeURIComponent(match[2]));
    } else if (/^https?:/i.test(source)) {
      const response = await context.request.get(source, { timeout: 8_000 });
      if (!response.ok()) return "";
      contentType = response.headers()["content-type"] || "";
      body = await response.body();
    } else return "";
    if (!body?.length || body.length > 5 * 1024 * 1024 || (contentType && !contentType.startsWith("image/"))) return "";
    const filename = `${platformKey}-${accountId}${avatarExtension(contentType, source)}`;
    fs.writeFileSync(path.join(ACCOUNT_ASSET_ROOT, filename), body);
    return `/account-assets/${filename}`;
  } catch { return ""; }
}

async function collectProfile(page, context, key, remark, accountId) {
  const apiProfile = await platformApiProfile(context, key);
  const deadline = Date.now() + 10_000;
  let nickname = apiProfile.nickname;
  let source = apiProfile.avatar_source;
  const apiIdentifiedAccount = Boolean(apiProfile.nickname);
  while (Date.now() < deadline && (!nickname || (!source && !apiIdentifiedAccount))) {
    nickname ||= await visibleText(page, LOGIN_SELECTORS[key]);
    source ||= await avatarUrl(page, key);
    if (nickname && source) break;
    await page.waitForTimeout(400);
  }
  const nicknameCaptured = Boolean(nickname);
  nickname ||= `${PLATFORMS[key].name}账号`;
  const avatar = await saveAvatar(context, source, key, accountId);
  return { nickname, nickname_captured: nicknameCaptured, avatar, avatar_source: source };
}

async function hasLoginMarker(page, key) {
  return Boolean(await visibleText(page, LOGIN_SELECTORS[key]));
}

async function hasPlatformLogin(page, context, key) {
  if (await hasLoginMarker(page, key)) return true;
  try {
    if ((await context.cookies()).some(cookie => LOGIN_COOKIES[key].has(cookie.name))) return true;
  } catch {}
  if (key === "douyin") return false;
  if (key === "xiaohongshu" && page.url().toLowerCase().includes("/new/home")) return true;
  return Boolean(await findVideoInput(page, PLATFORMS[key], 800));
}

export async function hasVisibleLoginPrompt(page, key) {
  if (page.isClosed()) return false;
  let frames;
  try { frames = page.frames(); } catch { return false; }
  for (const frame of frames) {
    const url = frame.url();
    if ((LOGIN_EXPIRED_URLS[key] ?? []).some(pattern => pattern.test(url))) return true;
    for (const selector of LOGIN_EXPIRED_SELECTORS[key] ?? []) {
      try {
        const candidates = frame.locator(selector);
        for (let index = 0; index < Math.min(await candidates.count(), 8); index += 1) {
          if (await candidates.nth(index).isVisible({ timeout: 100 })) return true;
        }
      } catch {}
    }
  }
  return false;
}

export async function focusLoginArea(page, key, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of LOGIN_FOCUS_SELECTORS[key] ?? []) {
      try {
        const candidates = page.locator(selector);
        for (let index = 0; index < Math.min(await candidates.count(), 8); index += 1) {
          const candidate = candidates.nth(index);
          if (await candidate.isVisible({ timeout: 150 })) {
            await candidate.scrollIntoViewIfNeeded({ timeout: 1_500 });
            return true;
          }
        }
      } catch {}
    }
    if (Date.now() < deadline) await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return false;
}

export class AccountBindingManager {
  constructor() {
    this.tasks = new Map();
    this.latestTask = new Map();
    normalizedRegistry();
  }

  accountStatus() {
    const registry = normalizedRegistry();
    return Object.fromEntries(Object.entries(PLATFORMS).map(([key, platform]) => [key, (registry.accounts[key] ?? []).map(record => {
      const stateExists = fs.existsSync(this.statePathForRecord(record));
      const loginInvalid = record.login_status === "invalid";
      return {
        id: record.id,
        platform_key: key,
        platform: platform.name,
        bound: stateExists && !loginInvalid,
        login_status: !stateExists ? "missing" : (loginInvalid ? "invalid" : "valid"),
        status_message: !stateExists ? "登录状态文件已丢失" : (loginInvalid ? LOGIN_INVALID_MESSAGE : ""),
        nickname: storedNickname(record, platform.name),
        remark: record.remark || "",
        avatar: storedAvatar(record),
        bound_at: record.bound_at || "",
        profile_needs_refresh: (key === "xiaohongshu" || key === "bilibili") && !record.profile_checked_at
      };
    })]));
  }

  statePathForRecord(record) {
    return path.join(STATE_ROOT, path.basename(record.state_file || `${record.platform_key}-${record.id}.json`));
  }

  getAccount(key, accountId) {
    if (!PLATFORMS[key]) return null;
    const record = (normalizedRegistry().accounts[key] ?? []).find(item => item.id === accountId);
    if (!record || record.login_status === "invalid" || !fs.existsSync(this.statePathForRecord(record))) return null;
    return { ...record, nickname: storedNickname(record, PLATFORMS[key].name), avatar: storedAvatar(record), platform_key: key, platform: PLATFORMS[key].name, bound: true };
  }

  async refreshAccountProfile(key, accountId) {
    if (!PLATFORMS[key]) throw new Error("平台不存在");
    const registry = normalizedRegistry();
    const record = (registry.accounts[key] ?? []).find(item => item.id === accountId);
    if (!record || !fs.existsSync(this.statePathForRecord(record))) throw new Error("账号不存在或登录状态已丢失");
    const release = this.accountLocks?.acquire(`${key}:${accountId}`, 'refresh-profile');
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: chromePath(),
        headless: true,
        chromiumSandbox: false,
        args: ["--disable-blink-features=AutomationControlled"]
      });
      trackBindingBrowser(browser);
      const context = await browser.newContext({ storageState: this.statePathForRecord(record), viewport: BINDING_WINDOW.viewport });
      const page = await context.newPage();
      await page.goto(PROFILE_URLS[key] || BINDING_URLS[key] || PLATFORMS[key].url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(1_200);
      const profile = await collectProfile(page, context, key, record.remark || "", accountId);
      const previousAvatar = record.avatar;
      record.nickname = profile.nickname;
      record.nickname_captured = profile.nickname_captured;
      record.avatar = profile.avatar || "";
      record.avatar_source = profile.avatar_source || "";
      record.profile_checked_at = nowText(true);
      atomicWrite(METADATA_FILE, registry);
      if (previousAvatar?.startsWith("/account-assets/") && previousAvatar !== record.avatar) {
        const previousPath = path.join(ACCOUNT_ASSET_ROOT, path.basename(previousAvatar));
        if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
      }
      return {
        ...record,
        nickname: storedNickname(record, PLATFORMS[key].name),
        avatar: storedAvatar(record),
        platform_key: key,
        platform: PLATFORMS[key].name,
        bound: true
      };
    } finally {
      await closeBindingBrowser(browser);
      release?.();
    }
  }

  bindingStatus(bindingIdOrKey) {
    const bindingId = this.tasks.has(bindingIdOrKey) ? bindingIdOrKey : this.latestTask.get(bindingIdOrKey);
    if (!bindingId || !this.tasks.has(bindingId)) return { is_running: false, status: "idle", message: "", progress: 0 };
    return { ...this.tasks.get(bindingId) };
  }

  startBinding(key, remark = "", replaceAccountId = "") {
    if (!PLATFORMS[key]) throw new Error("平台不存在");
    if ([...this.tasks.values()].some(task => task.is_running)) throw new AppError('ACCOUNT_BUSY', "已有账号正在绑定，请完成后再绑定下一个账号", { status: 409, retryable: true });
    if (replaceAccountId && !(normalizedRegistry().accounts[key] ?? []).some(record => record.id === replaceAccountId)) throw new Error("需要重新绑定的账号不存在");
    const bindingId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const release = replaceAccountId ? this.accountLocks?.acquire(`${key}:${replaceAccountId}`, `binding:${bindingId}`) : null;
    const task = { binding_id: bindingId, platform_key: key, is_running: true, status: "running", message: `正在打开 ${PLATFORMS[key].name} 登录页面`, progress: 20 };
    this.tasks.set(bindingId, task);
    this.latestTask.set(key, bindingId);
    void this.#runBinding(bindingId, key, String(remark).trim(), replaceAccountId).finally(() => release?.());
    return bindingId;
  }

  async #runBinding(bindingId, key, remark, replaceAccountId) {
    const platform = PLATFORMS[key];
    const task = this.tasks.get(bindingId);
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: chromePath(),
        headless: false,
        chromiumSandbox: false,
        args: ["--disable-blink-features=AutomationControlled", `--window-size=${BINDING_WINDOW.width},${BINDING_WINDOW.height}`, "--window-position=80,80"]
      });
      trackBindingBrowser(browser);
      const context = await browser.newContext({ viewport: BINDING_WINDOW.viewport });
      const page = await context.newPage();
      await page.goto(BINDING_URLS[key] || platform.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.bringToFront();
      await page.waitForTimeout(600);
      Object.assign(task, { message: `正在定位 ${platform.name} 的扫码登录区域`, progress: 45 });
      const focused = await focusLoginArea(page, key, 15_000);
      Object.assign(task, {
        message: focused
          ? `已定位登录区域，请完成 ${platform.name}${LOGIN_INSTRUCTIONS[key]}，系统会自动检测昵称和头像`
          : `${platform.name} 登录区域加载较慢，请在页面中找到登录入口后完成登录`,
        progress: 55
      });
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const loggedIn = await hasPlatformLogin(page, context, key);
        if (loggedIn) {
          Object.assign(task, { message: "已检测到登录成功，正在采集账号昵称和头像", progress: 88 });
          await page.waitForTimeout(900);
          if (await hasPlatformLogin(page, context, key)) {
            const accountId = replaceAccountId || crypto.randomUUID().replaceAll("-", "").slice(0, 16);
            const stateFile = `${key}-${accountId}.json`;
            await context.storageState({ path: path.join(STATE_ROOT, stateFile) });
            const profile = await collectProfile(page, context, key, remark, accountId);
            const registry = normalizedRegistry();
            const previous = replaceAccountId ? registry.accounts[key].find(item => item.id === replaceAccountId) : null;
            const record = {
              id: accountId,
              platform_key: key,
              nickname: profile.nickname,
              nickname_captured: profile.nickname_captured,
              remark: remark || previous?.remark || "",
              avatar: profile.avatar || previous?.avatar || "",
              avatar_source: profile.avatar_source || previous?.avatar_source || "",
              profile_checked_at: nowText(true),
              login_status: "valid",
              login_checked_at: nowText(true),
              bound_at: nowText(),
              state_file: stateFile
            };
            if (previous) registry.accounts[key] = registry.accounts[key].map(item => item.id === accountId ? record : item);
            else registry.accounts[key].push(record);
            atomicWrite(METADATA_FILE, registry);
            Object.assign(task, { is_running: false, status: "completed", message: `${platform.name}账号“${profile.nickname}”绑定成功`, progress: 100, account_id: accountId, account: record });
            return;
          }
        } else await focusLoginArea(page, key, 1_000);
        await page.waitForTimeout(750);
      }
      Object.assign(task, { is_running: false, status: "failed", message: "登录等待超时，请重新绑定", progress: 0 });
    } catch (error) {
      Object.assign(task, { is_running: false, status: "failed", message: `绑定失败：${error.message}`, progress: 0 });
    } finally {
      await closeBindingBrowser(browser);
    }
  }

  removeAccount(key, accountId) {
    const release = this.accountLocks?.acquire(`${key}:${accountId}`, 'remove-account');
    try {
    const registry = normalizedRegistry();
    const record = (registry.accounts[key] ?? []).find(item => item.id === accountId);
    if (!record) throw new Error("账号不存在");
    registry.accounts[key] = registry.accounts[key].filter(item => item.id !== accountId);
    atomicWrite(METADATA_FILE, registry);
    const statePath = this.statePathForRecord(record);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    if (record.avatar?.startsWith("/account-assets/")) {
      const avatarPath = path.join(ACCOUNT_ASSET_ROOT, path.basename(record.avatar));
      if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
    }
    } finally { release?.(); }
  }

  ensureTargets(targets) {
    return targets.filter(target => !this.getAccount(target.platform_key, target.account_id));
  }

  markLoginInvalid(key, accountId, reason = LOGIN_INVALID_MESSAGE) {
    const registry = normalizedRegistry();
    const record = (registry.accounts[key] ?? []).find(item => item.id === accountId);
    if (!record) return false;
    record.login_status = "invalid";
    record.login_invalid_reason = String(reason || LOGIN_INVALID_MESSAGE);
    record.login_checked_at = nowText(true);
    atomicWrite(METADATA_FILE, registry);
    return true;
  }

  storageState(key, accountId) {
    const account = this.getAccount(key, accountId);
    if (!account) throw new Error(`${PLATFORMS[key]?.name || key}账号不存在或登录状态已丢失`);
    return readJson(this.statePathForRecord(account));
  }

  async saveRuntimeState(context, key, accountId) {
    const registry = normalizedRegistry();
    const record = (registry.accounts[key] ?? []).find(item => item.id === accountId);
    if (!record) throw new Error("账号不存在");
    const state = await context.storageState();
    const filtered = {
      cookies: (state.cookies ?? []).filter(cookie => hostMatches(key, cookie.domain)),
      origins: (state.origins ?? []).filter(origin => { try { return hostMatches(key, new URL(origin.origin).hostname); } catch { return false; } })
    };
    if (!filtered.cookies.length && !filtered.origins.length) throw new Error(`没有检测到 ${PLATFORMS[key].name} 登录数据`);
    atomicWrite(this.statePathForRecord(record), filtered);
    record.runtime_saved_at = nowText(true);
    record.login_status = "valid";
    record.login_checked_at = nowText(true);
    delete record.login_invalid_reason;
    atomicWrite(METADATA_FILE, registry);
    return this.statePathForRecord(record);
  }
}

export const bindingManager = new AccountBindingManager();
