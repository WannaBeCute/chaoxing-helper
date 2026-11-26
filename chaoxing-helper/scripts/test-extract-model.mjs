#!/usr/bin/env node
/**
 * 检测“文件识别模型”是否可处理图片/文档（Node 18+，无需安装 npm 包）。
 *
 * 用法：
 *   node scripts/test-extract-model.mjs --endpoint https://api.openai.com/v1 --key sk-xxx --model gpt-4o-mini
 *   node scripts/test-extract-model.mjs --endpoint https://api.deepseek.com/v1 --key sk-xxx --model deepseek-flash --mode chat
 *   node scripts/test-extract-model.mjs --endpoint https://ark.cn-beijing.volces.com/api/v3 --key xxx --model doubao-seed-2-1-pro-260915 --mode responses
 *   node scripts/test-extract-model.mjs --endpoint ... --key ... --model ... --file ./sample.pdf
 *
 * 说明：
 * - Chat Completions 使用 image_url；Responses API 使用 input_image / input_text。
 * - DeepSeek Endpoint 会上传临时 txt（user_data，不计费）验证文档能力。
 * - 其他 Responses API Endpoint 会用 input_file 内联一个小文本文件测试。
 * - Chat Completions 的非 DeepSeek 接口没有标准文档上传方式，会跳过文档检测。
 * - 传入 --file 时会上传该文件并按页解析，可能产生解析费用。
 */
import { readFile } from 'node:fs/promises';

const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsCvlw/5Z7GEE38JgBZbpei0CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApcFJeExPOuMXn0AAAAASUVORK5CYII=';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const endpoint = arg('endpoint', process.env.CXH_ENDPOINT || 'https://api.openai.com/v1');
const apiKey = arg('key', process.env.CXH_API_KEY || '');
const model = arg('model', process.env.CXH_EXTRACT_MODEL || '');
const modeArg = arg('mode', process.env.CXH_API_MODE || 'auto');
const filePath = arg('file', '');

if (!apiKey) {
  console.error('缺少 API Key：请传 --key，或设置环境变量 CXH_API_KEY。');
  process.exit(2);
}
if (!model) {
  console.error('缺少模型名：请传 --model，或设置环境变量 CXH_EXTRACT_MODEL。');
  process.exit(2);
}

function resolveTarget() {
  const url = new URL(endpoint);
  let path = url.pathname.replace(/\/+$/, '');
  const requested = modeArg === 'chat' || modeArg === 'responses' ? modeArg : '';
  let detected = '';
  if (/\/responses$/i.test(path)) detected = 'responses';
  else if (/\/chat\/completions$/i.test(path)) detected = 'chat';
  const mode = requested || detected || 'chat';
  path = path.replace(/\/chat\/completions$/i, '').replace(/\/responses$/i, '');
  path += mode === 'responses' ? '/responses' : '/chat/completions';
  url.pathname = path || (mode === 'responses' ? '/responses' : '/chat/completions');
  return { url: url.toString(), mode };
}

const target = resolveTarget();

function isDeepSeek() {
  return /api\.deepseek\.com/i.test(endpoint);
}

function replyText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string') return data.output_text.trim();
  const parts = [];
  if (Array.isArray(data.output)) {
    data.output.forEach((item) => {
      if (!item || !Array.isArray(item.content)) return;
      item.content.forEach((part) => {
        if (!part) return;
        if (typeof part.text === 'string') parts.push(part.text);
        else if (typeof part.output_text === 'string') parts.push(part.output_text);
      });
    });
  }
  if (parts.length) return parts.join('').trim();
  const content = data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content;
  return typeof content === 'string' ? content.trim() : '';
}

async function request(body) {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${raw.slice(0, 300)}`);
  return replyText(JSON.parse(raw));
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
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${raw.slice(0, 300)}`);
  const data = JSON.parse(raw);
  if (!data || !data.id) throw new Error('文件上传未返回 file_id');
  return data.id;
}

function imageContent(type) {
  if (target.mode === 'responses') {
    return [
      { type: 'input_text', text: '这张纯色图片的主色是什么？只回复颜色名称。' },
      { type: 'input_image', image_url: TEST_IMAGE },
    ];
  }
  return [
    { type: 'text', text: '这张纯色图片的主色是什么？只回复颜色名称。' },
    { type: 'image_url', image_url: { url: TEST_IMAGE } },
  ];
}

async function testImage() {
  process.stdout.write('图片检测… ');
  try {
    const content = imageContent();
    const body = target.mode === 'responses'
      ? { model, input: [{ role: 'user', content }] }
      : { model, messages: [{ role: 'user', content }], stream: false, temperature: 0 };
    const reply = await request(body);
    console.log(`支持（模型回复：${reply.slice(0, 60) || '空'}）`);
    return true;
  } catch (error) {
    console.log(`不支持（${error.message}）`);
    return false;
  }
}

async function testDocument() {
  const deepSeek = isDeepSeek();
  if (!deepSeek && target.mode !== 'responses') {
    console.log('文档检测… 跳过（Chat Completions 没有标准文档上传方式）');
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

    let body;
    if (deepSeek) {
      const fileId = await upload(blob, filename, purpose);
      if (target.mode === 'responses') {
        body = {
          model,
          input: [{
            role: 'user',
            content: [
              { type: 'input_file', file_id: fileId },
              { type: 'input_text', text: prompt },
            ],
          }],
        };
      } else {
        body = {
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'file', file_id: fileId },
              { type: 'text', text: prompt },
            ],
          }],
          stream: false,
          temperature: 0,
        };
      }
    } else {
      const buffer = Buffer.from(await blob.arrayBuffer());
      const dataUrl = `data:${blob.type};base64,${buffer.toString('base64')}`;
      body = {
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_file', filename, file_data: dataUrl },
            { type: 'input_text', text: prompt },
          ],
        }],
      };
    }
    const reply = await request(body);
    console.log(`支持（模型回复：${reply.slice(0, 80) || '空'}）`);
    return true;
  } catch (error) {
    console.log(`不支持（${error.message}）`);
    return false;
  }
}

console.log(`模型：${model}`);
console.log(`Endpoint：${target.url}`);
console.log(`接口类型：${target.mode === 'responses' ? 'Responses API' : 'Chat Completions'}`);
console.log('注意：检测会发起少量 API 调用，可能产生费用。');
const vision = await testImage();
const document = await testDocument();
if (!vision && !document) process.exit(1);
