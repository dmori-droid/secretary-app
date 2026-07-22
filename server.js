const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- データ読み書き ----------------------------------------------------

// 保存ファイルを読み込む。無ければ初期データを返す。
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      memos: Array.isArray(data.memos) ? data.memos : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      reflections: Array.isArray(data.reflections) ? data.reflections : [],
    };
  } catch (e) {
    return { memos: [], tasks: [], reflections: [] };
  }
}

// データをファイルに書き込む（永続化）。
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 一意なIDを作る（時刻 + 乱数）。
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- リクエストのJSONボディを読む --------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // 過大な入力を遮断
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('不正なJSONです'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---- 静的ファイル配信 --------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  urlPath = urlPath.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));

  // ディレクトリ外へのアクセスを防ぐ
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---- APIハンドラ -------------------------------------------------------

async function handleApi(req, res) {
  const url = req.url.split('?')[0];
  const method = req.method;

  // 一覧取得（ダッシュボード用の集計も返す）
  if (url === '/api/state' && method === 'GET') {
    const data = loadData();
    const uncompleted = data.tasks.filter((t) => !t.done).length;
    // 週の新しい順に並べ、先頭を「最新の振り返り」とする
    const reflections = [...data.reflections].sort((a, b) =>
      b.week.localeCompare(a.week)
    );
    return sendJson(res, 200, {
      memos: data.memos,
      tasks: data.tasks,
      reflections,
      stats: {
        memoCount: data.memos.length,
        taskCount: data.tasks.length,
        uncompletedTaskCount: uncompleted,
        latestReflection: reflections[0] || null,
      },
    });
  }

  // メモ追加
  if (url === '/api/memos' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    if (!title && !content) {
      return sendJson(res, 400, { error: 'タイトルか本文を入力してください' });
    }
    const data = loadData();
    data.memos.unshift({
      id: newId(),
      title,
      content,
      createdAt: new Date().toISOString(),
    });
    saveData(data);
    return sendJson(res, 201, { ok: true });
  }

  // メモ削除
  const memoDelete = url.match(/^\/api\/memos\/([^/]+)$/);
  if (memoDelete && method === 'DELETE') {
    const data = loadData();
    data.memos = data.memos.filter((m) => m.id !== memoDelete[1]);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // タスク追加
  if (url === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').trim();
    if (!title) {
      return sendJson(res, 400, { error: 'タスク内容を入力してください' });
    }
    const data = loadData();
    data.tasks.unshift({
      id: newId(),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    });
    saveData(data);
    return sendJson(res, 201, { ok: true });
  }

  // タスク完了状態の切り替え
  const taskToggle = url.match(/^\/api\/tasks\/([^/]+)\/toggle$/);
  if (taskToggle && method === 'POST') {
    const data = loadData();
    const task = data.tasks.find((t) => t.id === taskToggle[1]);
    if (task) task.done = !task.done;
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // タスク削除
  const taskDelete = url.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskDelete && method === 'DELETE') {
    const data = loadData();
    data.tasks = data.tasks.filter((t) => t.id !== taskDelete[1]);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  // 週次の振り返りを追加（同じ週があれば上書き更新）
  if (url === '/api/reflections' && method === 'POST') {
    const body = await readBody(req);
    const week = (body.week || '').trim();
    const comment = (body.comment || '').trim();
    if (!week) {
      return sendJson(res, 400, { error: '対象の週を選んでください' });
    }
    if (!comment) {
      return sendJson(res, 400, { error: '振り返りコメントを入力してください' });
    }
    const data = loadData();
    const existing = data.reflections.find((r) => r.week === week);
    if (existing) {
      existing.comment = comment;
      existing.createdAt = new Date().toISOString();
    } else {
      data.reflections.unshift({
        id: newId(),
        week,
        comment,
        createdAt: new Date().toISOString(),
      });
    }
    saveData(data);
    return sendJson(res, 201, { ok: true });
  }

  // 振り返り削除
  const reflectionDelete = url.match(/^\/api\/reflections\/([^/]+)$/);
  if (reflectionDelete && method === 'DELETE') {
    const data = loadData();
    data.reflections = data.reflections.filter((r) => r.id !== reflectionDelete[1]);
    saveData(data);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not found' });
}

// ---- サーバー起動 ------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'エラーが発生しました' });
  }
});

server.listen(PORT, () => {
  console.log(`秘書アプリが起動しました → http://localhost:${PORT}`);
});
