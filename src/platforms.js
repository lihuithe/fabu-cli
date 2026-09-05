export const FINAL_ACTION = /^\s*(?:(?:立即|确认|一键)?(?:发布|发表|提交|投递|投稿)(?:作品|视频|内容)?|publish)\s*$/i;

export const DECLARATION_OPTIONS = Object.freeze({
  douyin: ["无需添加自主声明", "内容由AI生成", "内容为个人观点或见解", "内容为转载信息", "内容含营销推广信息", "虚构演绎，仅供娱乐"],
  xiaohongshu: ["无需内容标注", "虚构演绎，仅供娱乐", "笔记含AI合成内容", "内容包含营销广告", "内容来源声明"],
  channels: ["无需标注", "含AI生成内容", "内容为虚构剧情，仅供娱乐", "个人观点，仅供参考", "内容包含营销广告", "内容为自行拍摄"],
  bilibili: ["内容无需标注", "含AI生成内容", "含虚构演绎内容", "内容含营销信息", "个人观点，仅供参考", "内容为转载"]
});

export const DECLARATION_TRIGGERS = Object.freeze({
  douyin: ['section:has-text("自主声明") [class*="selectBox"]', 'text="请选择自主声明"'],
  xiaohongshu: ['[class*="declaration"] [class*="select-main"]', 'text="添加内容类型声明"'],
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
  xiaohongshu: {
    key: "xiaohongshu", name: "小红书", url: "https://creator.xiaohongshu.com/publish/publish",
    videoInputs: ['div[class^="upload-content"] input.upload-input', 'div[class^="drag-over"] input', 'input[type="file"]'],
    titles: ['div.plugin.title-container input.d-text', '.input.titleInput', 'input[placeholder*="标题"]'],
    contents: [".ql-editor", 'div[contenteditable="true"]'], coverRatios: ["3:4"]
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

export function originalForPlatform(platformKey, original) {
  return platformKey === "xiaohongshu" && original === true;
}

export function xiaohongshuCoverRatio(videoWidth, videoHeight) {
  const width = Number(videoWidth);
  const height = Number(videoHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > height ? "4:3" : "3:4";
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

export function scheduledTimeStatus(rawValue, now = Date.now()) {
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
  if (timestamp < Number(now) + 5 * 60 * 1000) return { valid: false, message: "定时发布时间至少需要晚于当前时间 5 分钟" };
  if (timestamp > Number(now) + 15 * 24 * 60 * 60 * 1000) return { valid: false, message: "定时发布时间不能超过当前时间 15 天" };
  return { valid: true, value, timestamp, date };
}
