export const FINAL_ACTION = /^\s*(?:(?:立即|确认|一键)?(?:发布|发表|提交|投递|投稿)(?:作品|视频|内容)?|publish)\s*$/i;

export const KUAISHOU_DECLARATION_PLACEHOLDER = "为作品添加补充说明";

export const KUAISHOU_OFFICIAL_DECLARATIONS = Object.freeze([
  "内容为AI生成",
  "演绎情节，仅供娱乐",
  "个人观点，仅供参考"
]);

export const KUAISHOU_DECLARATION_LEGACY_ALIASES = Object.freeze({
  "不添加声明": "",
  "无需添加内容声明": "",
  "请选择内容声明": "",
  "为作品添加补充说明": "",
  "内容由AI生成": "内容为AI生成",
  "内容为虚构演绎": "演绎情节，仅供娱乐",
  "内容为个人观点": "个人观点，仅供参考",
  "内容含营销推广信息": "",
  "素材来源于网络": ""
});

export function isKuaishouDeclarationSkipped(declaration) {
  const value = normalizeDeclaration("kuaishou", declaration);
  return !value;
}

export function normalizeDeclaration(platformKey, declaration) {
  const value = String(declaration ?? "").trim();
  if (platformKey !== "kuaishou") return value;
  if (!value || value === KUAISHOU_DECLARATION_PLACEHOLDER) return "";
  return KUAISHOU_DECLARATION_LEGACY_ALIASES[value] ?? value;
}

export const DECLARATION_OPTIONS = Object.freeze({
  douyin: ["无需添加自主声明", "内容由AI生成", "内容为个人观点或见解", "内容为转载信息", "内容含营销推广信息", "虚构演绎，仅供娱乐"],
  kuaishou: [...KUAISHOU_OFFICIAL_DECLARATIONS],
  channels: ["无需标注", "含AI生成内容", "内容为虚构剧情，仅供娱乐", "个人观点，仅供参考", "内容包含营销广告", "内容为自行拍摄"],
  bilibili: ["内容无需标注", "含AI生成内容", "含虚构演绎内容", "内容含营销信息", "个人观点，仅供参考", "内容为转载"]
});

export const DECLARATION_TRIGGERS = Object.freeze({
  douyin: ['section:has-text("自主声明") [class*="selectBox"]', 'text="请选择自主声明"'],
  kuaishou: [
    '.ant-select:has(.ant-select-selection-placeholder:has-text("为作品添加补充说明")) .ant-select-selector',
    '.ant-select:has(.ant-select-selection-item) .ant-select-selector',
    'text="作者声明" >> xpath=following::*[contains(@class,"ant-select")][1] .ant-select-selector',
    '[class*="declaration"] .ant-select-selector',
    '.ant-select:has(.ant-select-selection-placeholder:has-text("请选择内容声明")) .ant-select-selector'
  ],
  channels: ['[class*="mark"] [role="combobox"]', '[class*="declaration"] [role="combobox"]', 'input[placeholder*="视频标注"]', 'input[placeholder*="内容标注"]', 'text="选择视频标注"'],
  bilibili: ['.creation-statement-container .bcc-select-input-wrap', 'input[placeholder*="创作声明"]']
});

export const PLATFORMS = Object.freeze({
  douyin: {
    key: "douyin", name: "抖音", url: "https://creator.douyin.com/creator-micro/content/upload",
    videoInputs: ["div[class^='container'] input[type='file']", "input[type='file']"],
    titles: [".container-sGoJ9f", 'input[placeholder*="标题"]'],
    contents: ["div.zone-container.editor-kit-container", 'div[contenteditable="true"]'],
    coverRatios: ["3:4", "4:3"]
  },
  kuaishou: {
    key: "kuaishou", name: "快手", url: "https://cp.kuaishou.com/article/publish/video",
    videoInputs: ['input[type="file"][accept*="video"]', 'input[type="file"][accept*=".mp4"]', 'input[type="file"]'],
    titles: [],
    contents: ["#work-description-edit", 'div[contenteditable="true"]', 'textarea[placeholder*="描述"]', "textarea"],
    coverRatios: ["3:4"]
  },
  channels: {
    key: "channels", name: "视频号", url: "https://channels.weixin.qq.com/platform/post/create",
    videoInputs: ["div.ant-upload.ant-upload-drag input[type='file']", 'input[type="file"]'],
    titles: ["div.post-short-title-wrap", 'input[placeholder*="标题"]'],
    shortTitles: ['input[placeholder="填写短标题有机会获得更多流量"]', ".post-short-title-wrap input", 'input[placeholder*="短标题"]'],
    contents: ["div.post-desc-box div.input-editor", 'div[contenteditable="true"]'], coverRatios: ["3:4"]
  },
  bilibili: {
    key: "bilibili", name: "B站", url: "https://member.bilibili.com/platform/upload/video/frame",
    videoInputs: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    titles: ['input[placeholder*="标题"]', '.video-title input'],
    contents: ['textarea[placeholder*="简介"]', '.desc-text-wrp textarea', 'div[contenteditable="true"]'], coverRatios: ["4:3", "16:9"]
  }
});

export function splitTopics(raw) {
  const values = Array.isArray(raw) ? raw : [raw ?? ""];
  return values.flatMap(value => String(value).split(/[#，,、；;|｜/／\\\s]+/u)).map(item => item.trim()).filter(Boolean);
}

export function mergeTopics(fixedTopic, rawTopics) {
  const fixed = splitTopics(fixedTopic)[0];
  return [...new Set([fixed, ...splitTopics(rawTopics)].filter(Boolean))];
}

export function normalizeChannelsShortTitle(rawValue) {
  return String(rawValue ?? "").replace(/[，,]/g, " ").replace(/\s+/g, " ").trim();
}

export function channelsShortTitleStatus(rawValue) {
  const value = normalizeChannelsShortTitle(rawValue);
  if (value.length > 16) return { valid: false, value, message: "视频号短标题不能超过16个字" };
  if (!/^[\p{L}\p{N}\p{M} 《》“”"'‘’：:+＋?？%％℃]*$/u.test(value)) {
    return { valid: false, value, message: "视频号短标题包含不支持的特殊字符；仅支持书名号、引号、冒号、加号、问号、百分号和摄氏度，逗号会自动替换为空格" };
  }
  return { valid: true, value, message: "" };
}

export function channelsCoverRatios(videoWidth, videoHeight) {
  const width = Number(videoWidth);
  const height = Number(videoHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > height
    ? ["3:4", "4:3"]
    : ["3:4"];
}

export function douyinCoverRatios(videoWidth, videoHeight) {
  const width = Number(videoWidth);
  const height = Number(videoHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > height
    ? ["4:3", "3:4"]
    : ["3:4", "4:3"];
}

export function coverSetStatus(requiredRatios, providedRatios) {
  const required = [...new Set(requiredRatios ?? [])];
  const provided = new Set(providedRatios ?? []);
  const selected = required.filter(ratio => provided.has(ratio));
  if (!selected.length) return { mode: "default", missing: [] };
  const missing = required.filter(ratio => !provided.has(ratio));
  return missing.length ? { mode: "incomplete", missing } : { mode: "custom", missing: [] };
}

export const KUAISHOU_SCHEDULE_MAX_DAYS = 14;

export const SCHEDULE_MAX_DAYS_BY_PLATFORM = Object.freeze({
  douyin: 14,
  kuaishou: KUAISHOU_SCHEDULE_MAX_DAYS,
  channels: 15,
  bilibili: 15
});

export function scheduleMaxDays(platformKey) {
  return SCHEDULE_MAX_DAYS_BY_PLATFORM[platformKey] ?? 15;
}

export function scheduledTimeStatus(rawValue, now = Date.now(), platformKey = null) {
  const value = String(rawValue ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { valid: false, message: "请选择完整的定时发布日期和时间" };
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const [year, month, day, hour, minute] = parts;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const exact = date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute;
  if (!exact) return { valid: false, message: "定时发布时间无效，请重新选择" };
  const timestamp = date.getTime();
  const maxDays = platformKey ? scheduleMaxDays(platformKey) : 15;
  if (timestamp < Number(now) + 5 * 60 * 1000) return { valid: false, message: "定时发布时间至少需要晚于当前时间 5 分钟" };
  if (timestamp > Number(now) + maxDays * 24 * 60 * 60 * 1000) {
    return { valid: false, message: `定时发布时间不能超过当前时间 ${maxDays} 天` };
  }
  return { valid: true, value, timestamp, date };
}
