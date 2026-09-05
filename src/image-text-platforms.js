export const IMAGE_TEXT_PLATFORM_KEYS = Object.freeze(["douyin", "xiaohongshu", "channels"]);

export const IMAGE_TEXT_TITLE_LIMITS = Object.freeze({
  douyin: 30,
  xiaohongshu: 20,
  channels: 100
});

export const IMAGE_TEXT_PLATFORMS = Object.freeze({
  douyin: {
    key: "douyin",
    name: "抖音",
    url: "https://creator.douyin.com/creator-micro/content/upload",
    modeSelectors: [
      'div[class*="tab-item"]:text-is("发布图文")',
      '[role="tab"]:has-text("发布图文")',
      '[role="tab"]:has-text("图文")',
      'button:has-text("发布图文")',
      'div[class*="tab"]:has-text("发布图文")'
    ],
    activeModeSelectors: [
      'div[class*="tab-item"][class*="active"]:text-is("发布图文")',
      '[role="tab"][aria-selected="true"]:has-text("发布图文")'
    ],
    modeTexts: ["发布图文", "图文"],
    imageInputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"][accept*=".jpg"]',
      'input[type="file"][accept*=".jpeg"]',
      'input[type="file"][multiple][accept*=".jpg"]',
      'input[type="file"][multiple][accept*=".png"]'
    ],
    uploadReadySelectors: [
      'button:has-text("继续添加")',
      'text=/已添加\\s*\\d+\\s*张图片/'
    ],
    titles: [".container-sGoJ9f", 'input[placeholder*="标题"]'],
    contents: ["div.zone-container.editor-kit-container", 'div[contenteditable="true"]'],
    titleRequired: true
  },
  xiaohongshu: {
    key: "xiaohongshu",
    name: "小红书",
    url: "https://creator.xiaohongshu.com/publish/publish?source=official",
    modeSelectors: [
      '[role="tab"]:has-text("上传图文")',
      'button:has-text("上传图文")',
      'div[class*="tab"]:has-text("上传图文")',
      'div[class*="tab"]:has-text("图文")'
    ],
    modeTexts: ["上传图文", "图文笔记", "图文"],
    imageInputs: [
      'input.upload-input[type="file"][accept*="image"]',
      'input.upload-input[type="file"][accept*=".jpg"]',
      'input[type="file"][accept*=".jpg"]',
      'input[type="file"][accept*=".jpeg"]',
      'div[class*="upload"] input[type="file"][accept*="image"]',
      'input[type="file"][accept*="image"]'
    ],
    titles: ['div.plugin.title-container input.d-text', ".input.titleInput", 'input[placeholder*="标题"]'],
    contents: [".ql-editor", 'div[contenteditable="true"]'],
    titleRequired: true
  },
  channels: {
    key: "channels",
    name: "视频号",
    url: "https://channels.weixin.qq.com/platform/post/create",
    modeSelectors: [
      'a.finder-ui-desktop-menu__link:has(.finder-ui-desktop-menu__name span:text-is("图文"))',
      'li.finder-ui-desktop-sub-menu__item:has(.finder-ui-desktop-menu__name span:text-is("图文")) > a',
      'button:has-text("发表图文")',
      'text="发表图文"'
    ],
    modeTexts: ["发表图文", "图文"],
    activeModeSelectors: [
      'a.finder-ui-desktop-menu__link_current:has(.finder-ui-desktop-menu__name span:text-is("图文"))'
    ],
    imageInputs: [
      "div.ant-upload.ant-upload-drag input[type='file']",
      'input[type="file"][accept*="image"]',
      'input[type="file"][accept*=".jpg"]',
      'input[type="file"][accept*=".jpeg"]',
      'div[class*="upload"] input[type="file"][multiple]',
      'input[type="file"]'
    ],
    uploadReadySelectors: [
      'text="所选图片"',
      'text=/已选择\\s*\\d+\\s*张图片/'
    ],
    titles: [
      'input[placeholder*="填写标题"][placeholder*="22"]',
      'input[placeholder*="图文标题"]',
      'input[placeholder*="标题"]:not([placeholder*="短标题"])'
    ],
    shortTitles: ['input[placeholder="填写短标题有机会获得更多流量"]', ".post-short-title-wrap input", 'input[placeholder*="短标题"]'],
    contents: ["div.post-desc-box div.input-editor", 'div[contenteditable="true"]'],
    titleRequired: true
  }
});

export function isImageTextPlatform(key) {
  return IMAGE_TEXT_PLATFORM_KEYS.includes(String(key ?? ""));
}

export function channelsImageTextContent(content, rawTopics = []) {
  const values = Array.isArray(rawTopics) ? rawTopics : [rawTopics];
  const topicLine = [...new Set(values
    .map(topic => String(topic ?? "").replace(/^#+/, "").trim())
    .filter(Boolean))]
    .map(topic => `#${topic}`)
    .join(" ");
  return [String(content ?? "").trim(), topicLine].filter(Boolean).join("\n");
}
