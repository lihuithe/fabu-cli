import { z } from 'zod';
import { DateTime } from 'luxon';
import { AppError } from './errors.js';
import { PLATFORMS, DECLARATION_OPTIONS, channelsShortTitleStatus, mergeTopics, normalizeDeclaration, scheduleMaxDays, channelsCoverRatios, coverSetStatus } from './platforms.js';

const platform = z.enum(['douyin', 'kuaishou', 'channels', 'bilibili']);
const action = z.enum(['prepare', 'submit']);
const text = z.string().trim();
const targetSchema = z.object({
  platform, account_id: text.min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), action: action.optional(), title: text.optional(),
  short_title: text.optional(), declaration: text.optional(), original: z.boolean().optional(),
  hide_location: z.boolean().optional(), location: text.max(100).optional(), scheduled_at: text.optional()
}).strict();
export const taskSchema = z.object({
  schema_version: z.literal(1).default(1), idempotency_key: text.min(1).max(200).optional(),
  type: z.enum(['video', 'image_text']), action: action.default('prepare'),
  media: z.object({
    video: text.min(1).optional(), images: z.array(text.min(1)).min(1).max(18).optional(),
    covers: z.object({ '3:4': text.min(1).optional(), '4:3': text.min(1).optional(), '16:9': text.min(1).optional() }).strict().default({})
  }).strict(),
  content: z.object({ title: text.max(100).default(''), description: text.max(1000).default(''), topics: z.array(text.min(1)).max(100).default([]), fixed_topic: text.default('') }).strict().prefault({}),
  schedule: z.object({ at: text.min(1) }).strict().optional(),
  targets: z.array(targetSchema).min(1).max(100),
  close_after_submit: z.boolean().default(true)
}).strict();

export function parseTask(value) {
  const result = taskSchema.safeParse(value);
  if (!result.success) throw new AppError('INVALID_INPUT', '任务参数无效', { details: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  const input = result.data;
  if (input.type === 'video' && (!input.media.video || input.media.images)) throw new AppError('INVALID_MEDIA', '视频任务必须提供 video，不能提供 images');
  if (input.type === 'image_text' && (!input.media.images?.length || input.media.video || Object.keys(input.media.covers).length)) throw new AppError('INVALID_MEDIA', '图文任务必须提供 images，不能提供 video 或 covers');
  const keys = input.targets.map(t => `${t.platform}:${t.account_id}`);
  if (new Set(keys).size !== keys.length) throw new AppError('DUPLICATE_TARGET', '同一个账号不能在任务中重复出现');
  return input;
}

export const CAPABILITIES = Object.fromEntries(Object.keys(PLATFORMS).map(key => [key, {
  name: PLATFORMS[key].name,
  video: { prepare: true, submit: true, submission_verification: 'visible_platform_receipt' },
  image_text: { prepare: key !== 'bilibili', submit: false },
  title_limit: { douyin: 30, kuaishou: 30, channels: 100, bilibili: 80 }[key],
  title_required: key !== 'kuaishou',
  short_title_limit: key === 'channels' ? 16 : null,
  original: key === 'channels',
  hide_location: key === 'channels',
  video_location: key !== 'bilibili',
  video_cover_ratios: { portrait: key === 'channels' ? ['3:4'] : PLATFORMS[key].coverRatios, landscape: key === 'channels' ? ['3:4', '4:3'] : PLATFORMS[key].coverRatios, policy: '整套自定义封面或全部使用平台默认封面' },
  media_limits: { video_bytes: 20 * 1024 ** 3, image_bytes: 30 * 1024 ** 2, image_count: 18 },
  declaration_options: DECLARATION_OPTIONS[key],
  schedule: { timezone: 'Asia/Shanghai', minimum_lead_minutes: key === 'douyin' ? 120 : 5, maximum_days: scheduleMaxDays(key), minute_step: key === 'bilibili' ? 5 : 1 }
}]));

export function normalizeSchedule(raw, key, now = Date.now(), common = false) {
  if (!raw) return '';
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) throw new AppError('INVALID_SCHEDULE', '预约时间必须包含时区，例如 2026-09-06T12:00:00+08:00');
  const value = DateTime.fromISO(raw, { setZone: true });
  if (!value.isValid || value.second || value.millisecond) throw new AppError('INVALID_SCHEDULE', '预约时间无效，精度必须为整分钟');
  const rules = common ? { minimum_lead_minutes: 120, maximum_days: 14, minute_step: 5 } : CAPABILITIES[key].schedule;
  const distance = value.toMillis() - now;
  if (distance < rules.minimum_lead_minutes * 60_000 || distance > rules.maximum_days * 86_400_000 || value.minute % rules.minute_step) {
    throw new AppError('INVALID_SCHEDULE', `${common ? '通用' : PLATFORMS[key].name}预约时间需要在 ${rules.minimum_lead_minutes} 分钟后至 ${rules.maximum_days} 天内，分钟步长为 ${rules.minute_step}`, { details: rules });
  }
  return value.setZone('Asia/Shanghai').toFormat("yyyy-MM-dd'T'HH:mm");
}

export function normalizeTargets(input, accounts, dimensions = { width: 0, height: 0 }, now = Date.now()) {
  if (input.schedule) normalizeSchedule(input.schedule.at, 'douyin', now, true);
  return input.targets.map(target => {
    const key = target.platform;
    const mode = target.action ?? input.action;
    if (!CAPABILITIES[key][input.type][mode]) throw new AppError('UNSUPPORTED_CAPABILITY', input.type === 'image_text' && key === 'bilibili' ? '图文发布仅支持抖音、快手和视频号' : `${PLATFORMS[key].name}的${input.type}暂不支持 ${mode}`, { details: { platform: key, type: input.type, action: mode } });
    const account = accounts.getAccount(key, target.account_id);
    if (!account) throw new AppError('LOGIN_EXPIRED', `${PLATFORMS[key].name}账号不存在或登录状态已丢失`, { nextAction: { command: 'accounts login', platform: key, account_id: target.account_id } });
    const title = target.title || input.content.title;
    // 快手作品没有独立标题，仅以简介发布，标题可为空。
    if (key === 'kuaishou' ? title.length > CAPABILITIES[key].title_limit : (!title || title.length > CAPABILITIES[key].title_limit)) throw new AppError('INVALID_TITLE', `${PLATFORMS[key].name}标题不能为空且不能超过 ${CAPABILITIES[key].title_limit} 字`);
    const short = channelsShortTitleStatus(target.short_title);
    if (key === 'channels' && !short.valid) throw new AppError('INVALID_TITLE', short.message);
    // 快手默认不添加作者声明（空字符串），旧别名会归一化为官方选项。
    const declaration = key === 'kuaishou' ? normalizeDeclaration(key, target.declaration) : target.declaration ?? DECLARATION_OPTIONS[key][0];
    if (!(key === 'kuaishou' && !declaration) && !DECLARATION_OPTIONS[key].includes(declaration)) throw new AppError('INVALID_DECLARATION', `${PLATFORMS[key].name}声明选项无效`);
    if (target.short_title && key !== 'channels' || target.hide_location && key !== 'channels' || target.original && key !== 'channels' || target.location && (key === 'bilibili' || input.type === 'image_text')) throw new AppError('UNSUPPORTED_CAPABILITY', `${PLATFORMS[key].name}不支持本次提交的短标题、原创或位置选项`);
    const scheduledAt = normalizeSchedule(target.scheduled_at || input.schedule?.at, key, now);
    const ratios = key === 'channels' ? channelsCoverRatios(dimensions.width, dimensions.height) : PLATFORMS[key].coverRatios;
    const cover = coverSetStatus(ratios, Object.keys(input.media.covers));
    if (input.type === 'video' && cover.mode === 'incomplete') throw new AppError('INCOMPLETE_COVERS', `${PLATFORMS[key].name}还缺少 ${cover.missing.join('、')} 封面，请整套上传或使用平台默认封面`);
    const nickname = account.nickname || `${PLATFORMS[key].name}账号`;
    return {
      platformKey: key, accountId: target.account_id, account: account.remark ? `${nickname}（${account.remark}）` : nickname, avatar: account.avatar || '',
      title, shortTitle: key === 'channels' ? short.value : '', content: input.content.description,
      topics: mergeTopics(input.content.fixed_topic, input.content.topics), declaration, original: false,
      channelsOriginal: key === 'channels' && Boolean(target.original), channelsHideLocation: key === 'channels' && Boolean(target.hide_location),
      location: target.location || '', scheduledAt, action: mode, directPublish: mode === 'submit', closeAfterSubmit: input.close_after_submit,
      videoWidth: dimensions.width, videoHeight: dimensions.height, coverRatio: '', useCustomCover: cover.mode === 'custom'
    };
  });
}

export function taskJSONSchema() { return z.toJSONSchema(taskSchema, { io: 'input' }); }

// Existing Web forms use local wall-clock values in the platforms' China timezone.
export function legacyInput(body = {}, files = {}, type) {
  if (type === 'video' && !files.video?.length) throw new AppError('INVALID_MEDIA', '请选择视频文件');
  if (type === 'image_text' && !files.images?.length) throw new AppError('INVALID_MEDIA', '请至少选择一张图文图片');
  let targets;
  try { targets = JSON.parse(body.targets); } catch { throw new AppError('INVALID_INPUT', '账号选择参数格式错误'); }
  if (!Array.isArray(targets) || !targets.length) throw new AppError('INVALID_INPUT', '请至少选择一个发布账号');
  const iso = value => {
    if (!value) return undefined;
    const parsed = DateTime.fromISO(value, { zone: body.schedule_timezone || 'Asia/Shanghai' });
    if (!parsed.isValid) throw new AppError('INVALID_SCHEDULE', '预约时间或时区无效');
    return parsed.toISO({ suppressMilliseconds: true });
  };
  const schedule = body.schedule_enabled === 'true';
  if (schedule && !body.scheduled_at && targets.some(t => !body[`scheduled_at_${t.platform_key}`])) throw new AppError('INVALID_SCHEDULE', '请选择完整的定时发布日期和时间');
  return {
    schema_version: 1, type, action: 'prepare', close_after_submit: false,
    media: type === 'video' ? { video: 'video:0', covers: Object.fromEntries(['3:4', '4:3', '16:9'].filter(r => files[`cover_${r.replace(':', '_')}`]?.length).map(r => [r, `cover_${r.replace(':', '_')}:0`])) } : { images: files.images.map((_, i) => `images:${i}`) },
    content: { title: String(body.title || ''), description: String(body.content || ''), topics: mergeTopics('', body.topics), fixed_topic: String(body.fixed_topic || '') },
    ...(schedule && body.scheduled_at ? { schedule: { at: iso(body.scheduled_at) } } : {}),
    targets: [...new Map(targets.map(t => [`${t.platform_key}:${t.account_id}`, t])).values()].map(t => ({
      platform: t.platform_key, account_id: t.account_id, title: body[`title_${t.platform_key}`] || undefined,
      short_title: t.platform_key === 'channels' ? body.short_title_channels || undefined : undefined,
      declaration: body[`declaration_${t.platform_key}`],
      original: t.platform_key === 'channels' && body.channels_original === 'true',
      hide_location: t.platform_key === 'channels' && body.channels_hide_location === 'true',
      location: type === 'video' && t.platform_key !== 'bilibili' ? body.location || undefined : undefined,
      action: type === 'video' && body[`direct_publish_${t.platform_key}`] === 'true' ? 'submit' : 'prepare',
      scheduled_at: schedule ? iso(body[`scheduled_at_${t.platform_key}`]) : undefined
    }))
  };
}
