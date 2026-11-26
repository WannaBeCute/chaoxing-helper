#!/usr/bin/env node
/**
 * 检测“文件识别模型”是否可处理图片/文档（无需安装依赖，Node 18+）。
 *
 * 用法：
 *   node scripts/test-extract-model.mjs --endpoint https://api.deepseek.com/v1 --key sk-xxx --model deepseek-flash
 *   node scripts/test-extract-model.mjs --endpoint ... --key ... --model ... --file ./sample.pdf
 *
 * 说明：
 * - 会向模型发送一张 64x64 纯色图片，产生少量图片输入 token。
 * - DeepSeek Endpoint 还会上传一个临时 txt 文件并引用它，验证文档解析能力（user_data 上传不计费）。
 * - 传入 --file 时会上传该文件并按页解析，可能产生解析费用；请确认后再使用。
 */
import { readFile } from 'node:fs/promises';

const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsCvlw/5Z7GEE38JgBZbpei0CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApcFJeExPOuMXn0AAAAASUVORK5CYII=';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const endpoint = arg('endpoint', process.env.CXH_ENDPOINT || 'https://api.deepseek.com/v1');
const apiKey = arg('key', process.env.CXH_API_KEY || '');
const model = arg('model', process.env.CXH_EXTRACT_MODEL || '');
const filePath = arg('file', '');

if (!apiKey) {
  console.error('缺少 API Key：请传 --key，或设置环境变量 CXH_API_KEY。');
  process.exit(2);
}
if (!model) {
  console.error('缺少模型名：请传 --model，或设置环境变量 CXH_EXTRACT_MODEL。');
  process.exit(2);
}

function chatUrl() {
  const url = new URL(endpoint);
  let path = url.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(path)) path += '/chat/completions';
  url.pathname = path;
  return url.toString();
}

function isDeepSeek() {
  return /api\.deepseek\.com/i.test(endpoint);
}

async function chat(content) {
  const response = await fetch(chatUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      stream: false,
      temperature: 0,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  const reply = data && data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content;
  return typeof reply === 'string' ? reply.trim() : '';
}

async function upload(blob, filename, purpose) {
  const origin = new URL(endpoint).origin;
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', blob, filename);
  const response = await fetch(`${origin}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  if (!data || !data.id) throw new Error('文件上传未返回 file_id');
  return data.id;
}

async function testImage() {
  process.stdout.write('图片检测… ');
  try {
    const reply = await chat([
      { type: 'text', text: '这张纯色图片的主色是什么？只回复颜色名称。' },
      { type: 'image_url', image_url: { url: TEST_IMAGE } },
    ]);
    console.log(`支持（模型回复：${reply.slice(0, 60) || '空'}）`);
    return true;
  } catch (error) {
    console.log(`不支持（${error.message}）`);
    return false;
  }
}

async function testDocument() {
  if (!isDeepSeek()) {
    console.log('文档检测… 跳过（当前 Endpoint 不是 DeepSeek，未提供标准文档解析）');
    return null;
  }
  process.stdout.write('文档检测… ');
  try {
    let blob;
    let filename;
    let purpose;
    let prompt;
    if (filePath) {
      const buffer = await readFile(filePath);
      const lower = filePath.toLowerCase();
      const isText = /\.(txt|md|csv|json|log|xml|html?)$/.test(lower);
      const type = /\.pdf$/.test(lower) ? 'application/pdf'
        : /\.docx?$/.test(lower) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : /\.pptx?$/.test(lower) ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            : isText ? 'text/plain' : 'application/octet-stream';
      blob = new Blob([buffer], { type });
      filename = filePath.split(/[\\/]/).pop() || 'attachment';
      purpose = isText ? 'user_data' : 'text_recognition';
      prompt = '请输出这个文档中的第一段文字（最多 200 字），不要总结。';
    } else {
      blob = new Blob(['超星辅助助手文件识别能力检测，文档中的数字是 42。'], { type: 'text/plain' });
      filename = 'cxh-test.txt';
      purpose = 'user_data';
      prompt = '文档中的数字是多少？只回复数字。';
    }
    const fileId = await upload(blob, filename, purpose);
    const reply = await chat([
      { type: 'file', file_id: fileId },
      { type: 'text', text: prompt },
    ]);
    console.log(`支持（模型回复：${reply.slice(0, 80) || '空'}）`);
    return true;
  } catch (error) {
    console.log(`不支持（${error.message}）`);
    return false;
  }
}

console.log(`模型：${model}`);
console.log(`Endpoint：${endpoint}`);
console.log('注意：检测会发起少量 API 调用，可能产生费用。');
const vision = await testImage();
const document = await testDocument();
if (!vision && !document) process.exit(1);
