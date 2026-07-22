// 秘書アプリ API（Cloudflare Pages Functions + D1）
// /api/* へのすべてのリクエストをこの1ファイルで処理する。

// ---- 共通ユーティリティ ------------------------------------------------

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

// ---- 認証（簡易パスワード + 署名付きCookie） --------------------------

const COOKIE_NAME = 'sess';

// Cookie文字列から指定名の値を取り出す
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// HMAC-SHA256 を16進文字列で返す
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// セッショントークン（パスワードそのものは保存しない）
function signingKey(env) {
  return (env.AUTH_SECRET || env.APP_PASSWORD || 'insecure-default').trim();
}
async function sessionToken(env) {
  return hmacHex(signingKey(env), 'authorized');
}

// 一定時間比較（タイミング攻撃対策）
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// リクエストがログイン済みか判定
async function isAuthenticated(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  return safeEqual(token, await sessionToken(env));
}

// ログイン用Cookieを付与するヘッダ（httpsのときのみSecure）
function sessionCookieHeader(token, url) {
  const secure = url.protocol === 'https:' ? ' Secure;' : '';
  return {
    'Set-Cookie':
      `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=2592000`,
  };
}
function clearCookieHeader(url) {
  const secure = url.protocol === 'https:' ? ' Secure;' : '';
  return { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0` };
}

// ---- ルーティング ------------------------------------------------------

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const method = request.method;
  const segs = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  // segs 例: ['tasks', '<id>', 'toggle']

  if (!env.DB) {
    return json({ error: 'データベース(D1)が設定されていません' }, 500);
  }

  // --- 認証エンドポイント（ログインは未認証でも通す） ---
  if (segs[0] === 'login' && method === 'POST') {
    const body = await readBody(request);
    const password = (body.password || '').toString().trim();
    const expected = (env.APP_PASSWORD || '').trim();
    if (!expected) {
      return json({ error: 'サーバーにパスワードが設定されていません' }, 500);
    }
    if (!safeEqual(password, expected)) {
      return json({ error: 'パスワードが違います' }, 401);
    }
    const token = await sessionToken(env);
    return json({ ok: true }, 200, sessionCookieHeader(token, url));
  }

  if (segs[0] === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, clearCookieHeader(url));
  }

  // --- ここから下は認証必須 ---
  if (!(await isAuthenticated(request, env))) {
    return json({ error: 'ログインが必要です' }, 401);
  }

  const db = env.DB;

  // 一覧取得 + ダッシュボード集計
  if (segs[0] === 'state' && method === 'GET') {
    const [memosRes, tasksRes, reflsRes] = await Promise.all([
      db.prepare('SELECT id, title, content, created_at FROM memos ORDER BY created_at DESC').all(),
      db.prepare('SELECT id, title, done, created_at FROM tasks ORDER BY created_at DESC').all(),
      db.prepare('SELECT id, week, comment, created_at FROM reflections ORDER BY week DESC').all(),
    ]);

    const memos = (memosRes.results || []).map((m) => ({
      id: m.id, title: m.title, content: m.content, createdAt: m.created_at,
    }));
    const tasks = (tasksRes.results || []).map((t) => ({
      id: t.id, title: t.title, done: !!t.done, createdAt: t.created_at,
    }));
    const reflections = (reflsRes.results || []).map((r) => ({
      id: r.id, week: r.week, comment: r.comment, createdAt: r.created_at,
    }));

    return json({
      memos,
      tasks,
      reflections,
      stats: {
        memoCount: memos.length,
        taskCount: tasks.length,
        uncompletedTaskCount: tasks.filter((t) => !t.done).length,
        latestReflection: reflections[0] || null,
      },
    });
  }

  // ---- メモ ----
  if (segs[0] === 'memos') {
    if (segs.length === 1 && method === 'POST') {
      const body = await readBody(request);
      const title = (body.title || '').trim();
      const content = (body.content || '').trim();
      if (!title && !content) {
        return json({ error: 'タイトルか本文を入力してください' }, 400);
      }
      await db.prepare('INSERT INTO memos (id, title, content, created_at) VALUES (?, ?, ?, ?)')
        .bind(newId(), title, content, nowIso()).run();
      return json({ ok: true }, 201);
    }
    if (segs.length === 2 && method === 'DELETE') {
      await db.prepare('DELETE FROM memos WHERE id = ?').bind(segs[1]).run();
      return json({ ok: true });
    }
  }

  // ---- タスク ----
  if (segs[0] === 'tasks') {
    if (segs.length === 1 && method === 'POST') {
      const body = await readBody(request);
      const title = (body.title || '').trim();
      if (!title) return json({ error: 'タスク内容を入力してください' }, 400);
      await db.prepare('INSERT INTO tasks (id, title, done, created_at) VALUES (?, ?, 0, ?)')
        .bind(newId(), title, nowIso()).run();
      return json({ ok: true }, 201);
    }
    // 完了状態の切り替え: /tasks/:id/toggle
    if (segs.length === 3 && segs[2] === 'toggle' && method === 'POST') {
      await db.prepare('UPDATE tasks SET done = 1 - done WHERE id = ?').bind(segs[1]).run();
      return json({ ok: true });
    }
    if (segs.length === 2 && method === 'DELETE') {
      await db.prepare('DELETE FROM tasks WHERE id = ?').bind(segs[1]).run();
      return json({ ok: true });
    }
  }

  // ---- 週次の振り返り ----
  if (segs[0] === 'reflections') {
    if (segs.length === 1 && method === 'POST') {
      const body = await readBody(request);
      const week = (body.week || '').trim();
      const comment = (body.comment || '').trim();
      if (!week) return json({ error: '対象の週を選んでください' }, 400);
      if (!comment) return json({ error: '振り返りコメントを入力してください' }, 400);
      // 同じ週があれば上書き更新（week は UNIQUE）
      await db.prepare(
        `INSERT INTO reflections (id, week, comment, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(week) DO UPDATE SET comment = excluded.comment, created_at = excluded.created_at`
      ).bind(newId(), week, comment, nowIso()).run();
      return json({ ok: true }, 201);
    }
    if (segs.length === 2 && method === 'DELETE') {
      await db.prepare('DELETE FROM reflections WHERE id = ?').bind(segs[1]).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'not found' }, 404);
}
