// mc-bot/modules/web-learner.js — 联网学习模块
const fs = require('fs');
const path = require('path');

const searchDir = path.join(__dirname, '..', 'data', 'search-requests');
if (!fs.existsSync(searchDir)) {
  fs.mkdirSync(searchDir, { recursive: true });
}

// 缓存搜索不可用状态
let searchAvailable = true;
let lastFailTime = 0;
const FAIL_COOLDOWN = 60_000;

/**
 * 从 Bing HTML 搜索结果中提取摘要
 */
function extractBingResults(html) {
  const results = [];
  // Bing 的搜索结果在 <li class="b_algo"> 中
  const algoRegex = /<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi;
  const matches = html.match(algoRegex) || [];

  for (const block of matches.slice(0, 5)) {
    // 提取标题
    const titleMatch = block.match(/<h2[^>]*><a[^>]*>([\s\S]*?)<\/a><\/h2>/i);
    // 提取摘要
    const snippetMatch = block.match(/<p[^>]*class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<div[^>]*class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    // 提取链接
    const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);

    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const url = urlMatch ? urlMatch[1] : '';

    if (title || snippet) {
      results.push({ title, snippet, url });
    }
  }

  return results;
}

/**
 * 搜索网络并返回结果
 * @param {string} query - 搜索关键词
 * @returns {Promise<string>} 搜索结果摘要
 */
async function searchWeb(query) {
  console.log(`[Web] 搜索: ${query}`);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 冷却检查
  if (!searchAvailable && (Date.now() - lastFailTime) < FAIL_COOLDOWN) {
    const remain = Math.round((FAIL_COOLDOWN - (Date.now() - lastFailTime)) / 1000);
    console.log(`[Web] 搜索冷却中，${remain}秒后再试`);
    return `搜索暂时不可用，${remain}秒后再试`;
  }

  // 保存搜索记录
  fs.writeFileSync(
    path.join(searchDir, `search-${timestamp}.json`),
    JSON.stringify({ query, timestamp: new Date().toISOString() }, null, 2)
  );

  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    clearTimeout(timeoutId);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();
    const bingResults = extractBingResults(html);

    let summary;
    if (bingResults.length > 0) {
      summary = bingResults.map((r, i) => {
        let line = `${i + 1}. ${r.title}`;
        if (r.snippet) line += `\n   ${r.snippet}`;
        return line;
      }).join('\n\n');
      // 清理 HTML 实体
      summary = summary
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&ensp;/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#0?183;/g, '·')
        .replace(/&#\d{4};/g, '')
        .replace(/<[^>]+>/g, '');
    } else {
      summary = `未找到 "${query}" 的搜索结果`;
    }

    searchAvailable = true;

    // 保存结果
    fs.writeFileSync(
      path.join(searchDir, `result-${timestamp}.md`),
      `# 搜索: ${query}\n\n${summary}`
    );

    console.log(`[Web] 搜索成功，${bingResults.length} 条结果`);
    return summary;
  } catch (err) {
    searchAvailable = false;
    lastFailTime = Date.now();

    let reason = err.message;
    if (err.name === 'AbortError') reason = '连接超时';
    else if (err.cause?.code === 'ENOTFOUND') reason = 'DNS 解析失败';
    else if (err.message?.includes('fetch failed')) reason = '网络不可达';

    console.error(`[Web] 搜索失败: ${reason}`);

    fs.writeFileSync(
      path.join(searchDir, `result-${timestamp}.md`),
      `# 搜索: ${query}\n\n搜索失败: ${reason}`
    );

    return `搜索 "${query}" 失败: ${reason}。用已有知识回答。`;
  }
}

module.exports = { searchWeb };
