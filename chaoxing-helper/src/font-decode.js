/**
 * 超星 font-cxsecret 字体解码（阶段 2）
 *
 * 算法参考 Samueli924/chaoxing (GPL-3.0)：
 * - 从页面样式中提取 base64 TTF
 * - 解析 TTF 的 cmap/loca/glyf
 * - 对字形坐标/on-curve 标记做 MD5
 * - 用 font_map_table.json 反查原字符
 *
 * 本文件随扩展以 GPL-3.0 发布。
 */
(() => {
  'use strict';

  const app = window.__CXH_APP__;
  if (!app || window.__CXH_FONT__) return;

  const KX_FROM = '⼀⼁⼂⼃⼄⼅⼆⼇⼈⼉⼊⼋⼌⼍⼎⼏⼐⼑⼒⼓⼔⼕⼖⼗⼘⼙⼚⼛⼜⼝⼞⼟⼠⼡⼢⼣⼤⼥⼦⼧⼨⼩⼪⼫⼬⼭⼮⼯⼰⼱⼲⼳⼴⼵⼶⼷⼸⼹⼺⼻⼼⼽⼾⼿⽀⽁⽂⽃⽄⽅⽆⽇⽈⽉⽊⽋⽌⽍⽎⽏⽐⽑⽒⽓⽔⽕⽖⽗⽘⽙⽚⽛⽜⽝⽞⽟⽠⽡⽢⽣⽤⽥⽦⽧⽨⽩⽪⽫⽬⽭⽮⽯⽰⽱⽲⽳⽴⽵⽶⽷⽸⽹⽺⽻⽼⽽⽾⽿⾀⾁⾂⾃⾄⾅⾆⾇⾈⾉⾊⾋⾌⾍⾎⾏⾐⾑⾒⾓⾔⾕⾖⾗⾘⾙⾚⾛⾜⾝⾞⾟⾠⾡⾢⾣⾤⾥⾦⾧⾨⾩⾪⾫⾬⾭⾮⾯⾰⾱⾲⾳⾴⾵⾶⾷⾸⾹⾺⾻⾼⾽⾾⾿⿀⿁⿂⿃⿄⿅⿆⿇⿈⿉⿊⿋⿌⿍⿎⿏⿐⿑⿒⿓⿔⿕⺠⻬⻩⻢⻜⻅⺟⻓';
  const KX_TO = '一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉采里金長門阜隶隹雨青非面革韋韭音頁風飛食首香馬骨高高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠民齐黄马飞见母长';
  const KX_MAP = new Map();
  for (let i = 0; i < Math.min(KX_FROM.length, KX_TO.length); i += 1) {
    KX_MAP.set(KX_FROM[i], KX_TO[i]);
  }

  let mapPromise = null;
  let decoderCache = { signature: '', fonts: [] };

  function glyphNameToChar(name) {
    if (!name) return '';
    let matched = /^uni([0-9a-fA-F]{4,6})$/.exec(name);
    if (matched) return String.fromCodePoint(parseInt(matched[1], 16));
    matched = /^u([0-9a-fA-F]{4,6})$/.exec(name);
    if (matched) return String.fromCodePoint(parseInt(matched[1], 16));
    if (name.length === 1) return name;
    return '';
  }

  function loadMap() {
    if (!mapPromise) {
      mapPromise = app.bridgeRequest('fontMap', {}, 60000).then((text) => {
        const table = JSON.parse(text);
        const inverse = new Map();
        Object.keys(table).forEach((name) => {
          const hash = table[name];
          const ch = glyphNameToChar(name);
          if (hash && ch) inverse.set(String(hash).toLowerCase(), ch);
        });
        return inverse;
      }).catch((error) => {
        mapPromise = null;
        throw error;
      });
    }
    return mapPromise;
  }

  function readTag(view, offset) {
    let tag = '';
    for (let i = 0; i < 4; i += 1) tag += String.fromCharCode(view.getUint8(offset + i));
    return tag;
  }

  function parseCmap(view, table) {
    if (!table) return null;
    const start = table.offset;
    const count = view.getUint16(start + 2);
    let best = null;
    for (let i = 0; i < count; i += 1) {
      const record = start + 4 + i * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      const offset = start + view.getUint32(record + 4);
      const format = view.getUint16(offset);
      let score = 0;
      if (platform === 3 && encoding === 10) score = 5;
      else if (platform === 3 && encoding === 1) score = 4;
      else if (platform === 0) score = 3;
      if (!best || score > best.score) {
        best = { offset, format, score };
      }
    }
    return best;
  }

  function cmapGlyph(view, cmap, codePoint) {
    if (!cmap) return 0;
    const { offset, format } = cmap;
    if (format === 0) {
      if (codePoint > 255) return 0;
      return view.getUint8(offset + 6 + codePoint);
    }
    if (format === 6) {
      const first = view.getUint16(offset + 6);
      const count = view.getUint16(offset + 8);
      if (codePoint < first || codePoint >= first + count) return 0;
      return view.getUint16(offset + 10 + (codePoint - first) * 2);
    }
    if (format === 4) {
      if (codePoint > 0xffff) return 0;
      const segCount = view.getUint16(offset + 6) / 2;
      const endStart = offset + 14;
      const startStart = endStart + segCount * 2 + 2;
      const deltaStart = startStart + segCount * 2;
      const rangeStart = deltaStart + segCount * 2;
      for (let i = 0; i < segCount; i += 1) {
        const end = view.getUint16(endStart + i * 2);
        if (codePoint > end) continue;
        const begin = view.getUint16(startStart + i * 2);
        if (codePoint < begin) return 0;
        const delta = view.getInt16(deltaStart + i * 2);
        const rangeOffset = view.getUint16(rangeStart + i * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyphAddress = rangeStart + i * 2 + rangeOffset + (codePoint - begin) * 2;
        const glyph = view.getUint16(glyphAddress);
        if (!glyph) return 0;
        return (glyph + delta) & 0xffff;
      }
      return 0;
    }
    if (format === 12) {
      const groups = view.getUint32(offset + 12);
      for (let i = 0; i < groups; i += 1) {
        const p = offset + 16 + i * 12;
        const begin = view.getUint32(p);
        const end = view.getUint32(p + 4);
        if (codePoint < begin) return 0;
        if (codePoint > end) continue;
        return view.getUint32(p + 8) + (codePoint - begin);
      }
    }
    return 0;
  }

  function parsePostNames(view, table, numGlyphs) {
    if (!table) return null;
    const start = table.offset;
    if (view.getUint32(start) !== 0x00020000) return null;
    const count = Math.min(view.getUint16(start + 32), numGlyphs);
    const indices = [];
    for (let i = 0; i < count; i += 1) indices.push(view.getUint16(start + 34 + i * 2));
    let cursor = start + 34 + count * 2;
    let maxCustom = 0;
    indices.forEach((index) => { if (index >= 258) maxCustom = Math.max(maxCustom, index - 257); });
    const names = [];
    for (let i = 0; i < maxCustom; i += 1) {
      const length = view.getUint8(cursor);
      cursor += 1;
      let name = '';
      for (let j = 0; j < length; j += 1) name += String.fromCharCode(view.getUint8(cursor + j));
      cursor += length;
      names.push(name);
    }
    const map = new Map();
    indices.forEach((index, glyph) => {
      if (index < 258) return;
      const name = names[index - 258];
      const ch = glyphNameToChar(name);
      if (ch) map.set(ch.codePointAt(0), glyph);
    });
    return map;
  }

  function md5(bytes) {
    const shift = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const k = new Uint32Array(64);
    for (let i = 0; i < 64; i += 1) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

    const length = bytes.length;
    const paddedLength = (((length + 8) >>> 6) + 1) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[length] = 0x80;
    const bitLength = length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let chunk = 0; chunk < paddedLength; chunk += 64) {
      const words = new Uint32Array(16);
      for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(chunk + i * 4, true);
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let i = 0; i < 64; i += 1) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        const rotated = ((a + f + k[i] + words[g]) >>> 0);
        const shiftBits = shift[i];
        const sum = ((rotated << shiftBits) | (rotated >>> (32 - shiftBits))) >>> 0;
        const next = (b + sum) >>> 0;
        a = d;
        d = c;
        c = b;
        b = next;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    const out = new DataView(new ArrayBuffer(16));
    out.setUint32(0, a0, true);
    out.setUint32(4, b0, true);
    out.setUint32(8, c0, true);
    out.setUint32(12, d0, true);
    let hex = '';
    for (let i = 0; i < 16; i += 1) hex += out.getUint8(i).toString(16).padStart(2, '0');
    return hex;
  }

  function hashGlyphAt(view, offset) {
    const contours = view.getInt16(offset);
    if (contours <= 0) return '';
    const endPoints = [];
    for (let i = 0; i < contours; i += 1) endPoints.push(view.getUint16(offset + 10 + i * 2));
    const pointCount = endPoints[endPoints.length - 1] + 1;
    if (!pointCount) return '';
    const instructionLength = view.getUint16(offset + 10 + contours * 2);
    let cursor = offset + 12 + contours * 2 + instructionLength;

    const flags = [];
    while (flags.length < pointCount) {
      const flag = view.getUint8(cursor);
      cursor += 1;
      flags.push(flag);
      if (flag & 8) {
        const repeat = view.getUint8(cursor);
        cursor += 1;
        for (let i = 0; i < repeat; i += 1) flags.push(flag);
      }
    }

    const xs = [];
    let x = 0;
    flags.forEach((flag) => {
      if (flag & 2) {
        const value = view.getUint8(cursor);
        cursor += 1;
        x += (flag & 16) ? value : -value;
      } else if (!(flag & 16)) {
        x += view.getInt16(cursor);
        cursor += 2;
      }
      xs.push(x);
    });

    const ys = [];
    let y = 0;
    flags.forEach((flag) => {
      if (flag & 4) {
        const value = view.getUint8(cursor);
        cursor += 1;
        y += (flag & 32) ? value : -value;
      } else if (!(flag & 32)) {
        y += view.getInt16(cursor);
        cursor += 2;
      }
      ys.push(y);
    });

    let data = '';
    let point = 0;
    endPoints.forEach((end) => {
      for (; point <= end; point += 1) {
        data += `${xs[point]}${ys[point]}${flags[point] & 1}`;
      }
    });
    return md5(new TextEncoder().encode(data));
  }

  function parseFont(base64) {
    if (!base64 || base64.length < 1000) return null;
    let bytes;
    try {
      const raw = atob(base64.replace(/\s+/g, ''));
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    } catch (error) {
      return null;
    }
    const view = new DataView(bytes.buffer);
    const numTables = view.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i += 1) {
      const p = 12 + i * 16;
      tables[readTag(view, p)] = { offset: view.getUint32(p + 8), length: view.getUint32(p + 12) };
    }
    if (!tables.head || !tables.maxp || !tables.loca || !tables.glyf) return null;
    const indexToLocFormat = view.getInt16(tables.head.offset + 50);
    const numGlyphs = view.getUint16(tables.maxp.offset + 4);
    const loca = [];
    for (let i = 0; i <= numGlyphs; i += 1) {
      if (indexToLocFormat === 0) loca.push(view.getUint16(tables.loca.offset + i * 2) * 2);
      else loca.push(view.getUint32(tables.loca.offset + i * 4));
    }
    const cmap = parseCmap(view, tables.cmap);
    const postMap = parsePostNames(view, tables.post, numGlyphs);
    const hashCache = new Map();

    function glyphForCodePoint(codePoint) {
      let glyph = cmapGlyph(view, cmap, codePoint);
      if (!glyph && postMap) glyph = postMap.get(codePoint) || 0;
      return glyph;
    }

    function hashGlyph(index) {
      if (hashCache.has(index)) return hashCache.get(index);
      const start = loca[index];
      const end = loca[index + 1];
      const hash = start != null && end > start ? hashGlyphAt(view, tables.glyf.offset + start) : '';
      hashCache.set(index, hash);
      return hash;
    }

    return { glyphForCodePoint, hashGlyph };
  }

  function collectDocuments(root) {
    const docs = [];
    const seen = new Set();
    const visit = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
      try {
        doc.querySelectorAll('iframe').forEach((frame) => {
          let child = null;
          try { child = frame.contentDocument; } catch (error) { child = null; }
          if (child) visit(child);
        });
      } catch (error) {
        /* cross-origin iframe */
      }
    };
    visit(root || document);
    return docs;
  }

  function collectFontSources() {
    const sources = new Set();
    const docs = collectDocuments(document);
    docs.forEach((doc) => {
      let styles = [];
      try { styles = Array.from(doc.querySelectorAll('style')); } catch (error) { styles = []; }
      styles.forEach((style) => {
        const css = style.textContent || '';
        if (!/font-cxsecret/i.test(css)) return;
        const regex = /base64,([A-Za-z0-9+/=\s]+)/g;
        let match;
        while ((match = regex.exec(css))) {
          const base64 = match[1].replace(/\s+/g, '');
          if (base64.length > 1000) sources.add(base64);
        }
      });
      let sheets = [];
      try { sheets = Array.from(doc.styleSheets); } catch (error) { sheets = []; }
      sheets.forEach((sheet) => {
        let rules;
        try { rules = sheet.cssRules; } catch (error) { return; }
        Array.from(rules || []).forEach((rule) => {
          const text = rule.cssText || '';
          if (!/font-cxsecret/i.test(text)) return;
          const regex = /base64,([A-Za-z0-9+/=\s]+)/g;
          let match;
          while ((match = regex.exec(text))) {
            const base64 = match[1].replace(/\s+/g, '');
            if (base64.length > 1000) sources.add(base64);
          }
        });
      });
    });
    return Array.from(sources);
  }

  function getFonts() {
    const sources = collectFontSources();
    if (!sources.length) return [];
    const signature = sources.map((source) => source.length).join(',');
    if (decoderCache.signature === signature) return decoderCache.fonts;
    const fonts = [];
    sources.forEach((source) => {
      const font = parseFont(source);
      if (font) fonts.push(font);
    });
    decoderCache = { signature, fonts };
    return fonts;
  }

  async function decode(text) {
    const value = String(text || '');
    if (!value) return value;
    const fonts = getFonts();
    if (!fonts.length) return value;
    let inverse;
    try {
      inverse = await loadMap();
    } catch (error) {
      return value;
    }
    const cache = new Map();
    let output = '';
    for (const ch of value) {
      if (cache.has(ch)) {
        output += cache.get(ch);
        continue;
      }
      let decoded = ch;
      const codePoint = ch.codePointAt(0);
      for (const font of fonts) {
        const glyph = font.glyphForCodePoint(codePoint);
        if (!glyph) continue;
        const hash = font.hashGlyph(glyph);
        if (!hash) continue;
        const original = inverse.get(hash);
        if (original) {
          decoded = original;
          break;
        }
      }
      decoded = KX_MAP.get(decoded) || decoded;
      cache.set(ch, decoded);
      output += decoded;
    }
    return output;
  }

  window.__CXH_FONT__ = { decode };
})();
