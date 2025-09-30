/// <reference lib="WebWorker" />
export {}

type Cfg = {
  repoOwner: string; repoName: string; branch: string;
  dataPaths: { tasks: string; stats: string };
  adminKey: string; githubPAT: string;
}
let cfg: Cfg | null = null

self.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type === 'CONFIG') cfg = e.data as Cfg
})

const GHP = 'https://api.github.com'
async function ghGetFile(path: string) {
  const url = `${GHP}/repos/${cfg!.repoOwner}/${cfg!.repoName}/contents/${path}?ref=${cfg!.branch}`
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg!.githubPAT}` }})
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`)
  const j = await r.json()
  const content = atob(j.content.replace(/\n/g, ''))
  return { text: content, sha: j.sha }
}
async function ghPutFile(path: string, text: string, sha?: string, msg='update data') {
  const url = `${GHP}/repos/${cfg!.repoOwner}/${cfg!.repoName}/contents/${path}`
  const body = {
    message: msg,
    content: btoa(unescape(encodeURIComponent(text))),
    branch: cfg!.branch,
    ...(sha ? { sha } : {})
  }
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg!.githubPAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`PUT ${path} ${r.status}`)
  return r.json()
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith('/api/')) return
  event.respondWith(handleApi(event.request))
})

function json(body: any, status=200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function bcPost(msg: any) {
  try {
    const bc = (self as any).BroadcastChannel ? new (self as any).BroadcastChannel('tasks') : null
    bc?.postMessage(msg)
  } catch {}
}

function ulid() {
  const t = Date.now().toString(36).toUpperCase().padStart(8,'0')
  const r = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => (b % 36).toString(36).toUpperCase()).join('')
  return t + r.slice(0, 18)
}

async function handleApi(req: Request): Promise<Response> {
  if (!cfg) return json({ error: 'Not configured' }, 500)

  const { pathname } = new URL(req.url)
  const isWrite = req.method !== 'GET'
  const auth = req.headers.get('X-Admin-Key') || ''
  if (isWrite && auth !== cfg.adminKey) return json({ error: 'Forbidden' }, 403)

  try {
    if (req.method === 'GET' && pathname === '/api/task') {
      const { text } = await ghGetFile(cfg.dataPaths.tasks)
      return json(JSON.parse(text))
    }
    if (req.method === 'GET' && pathname === '/api/stats') {
      const { text } = await ghGetFile(cfg.dataPaths.stats)
      return json(JSON.parse(text))
    }

    // Mutations update tasks.json and stats.json (v2) including task records
    if (req.method === 'POST' && pathname === '/api/task') {
      const payload = await req.json() // { title, tag?, project? }
      const now = new Date().toISOString()

      const { text: tText, sha: tSha } = await ghGetFile(cfg.dataPaths.tasks)
      const tasks = JSON.parse(tText)
      const id = ulid()
      const task = { id, title: payload.title, tag: payload.tag ?? null, project: payload.project ?? null, createdAt: now }
      tasks.tasks = [task, ...(tasks.tasks || [])]
      tasks.updatedAt = now

      const { text: sText, sha: sSha } = await ghGetFile(cfg.dataPaths.stats)
      const stats = JSON.parse(sText)
      stats.counters.created++
      stats.timeline.push({ t: now, event: 'create', id })
      stats.tasks[id] = { id, title: task.title, tag: task.tag, project: task.project, createdAt: now, updatedAt: null, completedAt: null, deletedAt: null, state: 'active' }
      stats.updatedAt = now

      await ghPutFile(cfg.dataPaths.tasks, JSON.stringify(tasks, null, 2), tSha, 'task: create')
      await ghPutFile(cfg.dataPaths.stats,  JSON.stringify(stats,  null, 2), sSha, 'stats: create')
      bcPost({ type: 'tasks-updated' })
      return json({ ok: True, id })
    }

    if (req.method === 'PATCH' && pathname.startsWith('/api/task/')) {
      const id = pathname.split('/').pop()!
      const patch = await req.json()
      const now = new Date().toISOString()

      const { text: tText, sha: tSha } = await ghGetFile(cfg.dataPaths.tasks)
      const tasks = JSON.parse(tText)
      const idx = (tasks.tasks || []).findIndex((x: any) => x.id === id)
      if (idx < 0) return json({ error: 'Not found' }, 404)
      const t = tasks.tasks[idx]
      Object.assign(t, patch)
      if (patch.completed === true) t.completedAt = now
      t.updatedAt = now
      tasks.updatedAt = now

      const { text: sText, sha: sSha } = await ghGetFile(cfg.dataPaths.stats)
      const stats = JSON.parse(sText)
      const rec = stats.tasks[id] || { id, title: t.title, tag: t.tag ?? null, project: t.project ?? null, createdAt: t.createdAt, updatedAt: null, completedAt: null, deletedAt: null, state: 'active' }
      // Update record
      rec.title = t.title
      rec.tag = t.tag ?? null
      rec.project = t.project ?? null
      rec.updatedAt = now
      if (patch.completed === true) {
        rec.completedAt = now
        rec.state = 'completed'
      } else if (patch.completed === false) {
        rec.completedAt = null
        rec.state = 'active'
      }
      stats.tasks[id] = rec
      stats.counters[patch.completed ? 'completed' : 'edited']++
      stats.timeline.push({ t: now, event: patch.completed ? 'complete' : 'edit', id })
      stats.updatedAt = now

      await ghPutFile(cfg.dataPaths.tasks, JSON.stringify(tasks, null, 2), tSha, 'task: update')
      await ghPutFile(cfg.dataPaths.stats,  JSON.stringify(stats,  null, 2), sSha, 'stats: update')
      bcPost({ type: 'tasks-updated' })
      return json({ ok: True })
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/task/')) {
      const id = pathname.split('/').pop()!
      const now = new Date().toISOString()

      const { text: tText, sha: tSha } = await ghGetFile(cfg.dataPaths.tasks)
      const tasks = JSON.parse(tText)
      const idx = (tasks.tasks || []).findIndex((x: any) => x.id === id)
      if (idx < 0) return json({ error: 'Not found' }, 404)
      tasks.tasks.splice(idx, 1)
      tasks.updatedAt = now

      const { text: sText, sha: sSha } = await ghGetFile(cfg.dataPaths.stats)
      const stats = JSON.parse(sText)
      const rec = stats.tasks[id] || { id, title: '(unknown)', createdAt: now }
      stats.tasks[id] = {
        id,
        title: rec.title,
        tag: rec.tag ?? null,
        project: rec.project ?? null,
        createdAt: rec.createdAt ?? now,
        updatedAt: now,
        completedAt: rec.completedAt ?? null,
        deletedAt: now,
        state: 'deleted'
      }
      stats.counters.deleted++
      stats.timeline.push({ t: now, event: 'delete', id })
      stats.updatedAt = now

      await ghPutFile(cfg.dataPaths.tasks, JSON.stringify(tasks, null, 2), tSha, 'task: delete')
      await ghPutFile(cfg.dataPaths.stats,  JSON.stringify(stats,  null, 2), sSha, 'stats: delete')
      bcPost({ type: 'tasks-updated' })
      return json({ ok: True })
    }

    return json({ error: 'Not found' }, 404)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
}
