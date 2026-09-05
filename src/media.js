import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './errors.js';

const execute = promisify(execFile);
export const ffprobePath = () => process.env.FFPROBE_PATH || 'ffprobe';

export async function probeMedia(filename) {
  let stdout;
  try {
    ({ stdout } = await execute(ffprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }));
  } catch (error) {
    if (error.code === 'ENOENT') throw new AppError('FFPROBE_NOT_FOUND', '未找到 ffprobe，请安装 FFmpeg 或设置 FFPROBE_PATH', { status: 503 });
    throw new AppError('INVALID_MEDIA', '无法读取媒体文件，请检查文件是否损坏');
  }
  const info = JSON.parse(stdout);
  const stream = info.streams?.find(s => s.codec_type === 'video');
  if (!stream?.width || !stream.height) throw new AppError('INVALID_MEDIA', '媒体文件中没有可读取的图片或视频画面');
  let { width, height } = stream;
  const rotation = Number(stream.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return { width, height, duration: Number(info.format?.duration || stream.duration) || 0, codec: stream.codec_name, format: info.format?.format_name || '' };
}

export function mediaReferences(input) {
  return [
    ...(input.media.video ? [{ ref: input.media.video, kind: 'video' }] : []),
    ...(input.media.images || []).map((ref, index) => ({ ref, kind: 'image', index })),
    ...Object.entries(input.media.covers || {}).map(([ratio, ref]) => ({ ref, kind: 'cover', ratio }))
  ];
}

export async function inspectUploads(input, uploads, probe = probeMedia) {
  const assets = [];
  for (const entry of mediaReferences(input)) {
    const file = uploads[entry.ref];
    if (!file) throw new AppError('MISSING_ASSET', `缺少上传素材：${entry.ref}`);
    const size = fs.statSync(file.path).size;
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowed = entry.kind === 'video' ? ['.mp4', '.mov', '.avi', '.mkv', '.webm'] : ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(extension) || size < 1 || size > (entry.kind === 'video' ? 20 * 1024 ** 3 : 30 * 1024 ** 2)) throw new AppError('INVALID_MEDIA', `素材格式或大小无效：${file.originalname}`);
    const metadata = await probe(file.path);
    if (entry.kind === 'video' && (!/(?:^|,)(?:mov|mp4|avi|matroska|webm)(?:,|$)/.test(metadata.format) || metadata.duration <= 0)) throw new AppError('INVALID_MEDIA', '视频文件必须包含可读取时长的视频流');
    if (entry.kind !== 'video' && !['mjpeg', 'png', 'webp'].includes(metadata.codec)) throw new AppError('INVALID_MEDIA', '图片仅支持 JPG、JPEG、PNG 或 WebP 格式');
    if (entry.kind === 'cover') {
      const [w, h] = entry.ratio.split(':').map(Number);
      if (Math.abs(metadata.width / metadata.height - w / h) / (w / h) > 0.05) throw new AppError('INVALID_COVER_RATIO', `封面实际比例与 ${entry.ratio} 不符`);
    }
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file.path)) hash.update(chunk);
    assets.push({ ...entry, path: file.path, filename: file.originalname, extension, bytes: size, sha256: hash.digest('hex'), ...metadata });
  }
  if (Object.keys(uploads).some(ref => !assets.some(a => a.ref === ref))) throw new AppError('UNEXPECTED_ASSET', '请求包含未在任务中引用的素材');
  return assets;
}

export async function stageAssets(assets, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const staged = [];
  for (const [index, asset] of assets.entries()) {
    const destination = path.join(folder, `${String(index).padStart(3, '0')}_${asset.kind}${asset.extension}`);
    await fs.promises.copyFile(asset.path, destination, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    staged.push({ ...asset, path: destination });
  }
  return staged;
}
