const express = require('express')
const fs = require('fs')
const path = require('path')
const https = require('https')

const app = express()
const PORT = 3000
const DATA_DIR = path.join(__dirname, 'data')
const TODOS_DIR = path.join(DATA_DIR, 'todos')
const GLOBAL_FILE = path.join(DATA_DIR, 'global.json')
const DAILIES_FILE = path.join(DATA_DIR, 'dailies.json')
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json')
const REWARD_SLOTS_FILE = path.join(DATA_DIR, 'reward-slots.json')
const BILI_COURSES_FILE = path.join(DATA_DIR, 'bilibili-courses.json')
const LEGACY_FILE = path.join(DATA_DIR, 'db.json')

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ========== Helpers ==========

function getDateStr(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getYesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return getDateStr(d)
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR)
  if (!fs.existsSync(TODOS_DIR)) fs.mkdirSync(TODOS_DIR)
}

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message)
  }
  return fallback
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

function calcLevel(totalPointsEarned) {
  return Math.floor(Math.sqrt(Math.max(0, totalPointsEarned))) + 1
}

function getDefaultGlobal() {
  return {
    xp: 0,
    level: 1,
    totalXPEarned: 0,
    points: 0,
    totalPointsEarned: 0,
    pointsDetail: { deepwork: 0, taskCompletion: 0 },
    spins: 0,
    rewards: [],
    history: [],
    counter: 0
  }
}

function cleanGlobal(obj) {
  // 迁移：移除旧的 RPG 属性字段
  if (obj.attributes) delete obj.attributes
  if (obj.attributePoints !== undefined) delete obj.attributePoints
  // 确保积分字段存在
  if (obj.points === undefined) obj.points = 0
  if (obj.totalPointsEarned === undefined) obj.totalPointsEarned = 0
  if (!obj.pointsDetail) obj.pointsDetail = { deepwork: 0, taskCompletion: 0 }
  // 等级基于历史总积分计算
  obj.level = calcLevel(obj.totalPointsEarned)
  return obj
}

function getDefaultRewardSlots() {
  return [
    { icon: '🍟', label: '黄金薯条', desc: '香脆黄金粗薯', color: '#ff6b6b', pct: 15 },
    { icon: '🧋', label: '奶茶',     desc: '香浓奶茶',      color: '#d4a574', pct: 15 },
    { icon: '🧀', label: '芝士薯条', desc: '浓郁芝士酱薯条', color: '#feca57', pct: 15 },
    { icon: '🌶️', label: '香辣薯条', desc: '火辣辣脆薯',   color: '#48dbfb', pct: 15 },
    { icon: '🥔', label: '松露薯角', desc: '松露风味三角薯', color: '#ff9ff3', pct: 15 },
    { icon: '🍠', label: '红薯条',   desc: '甜糯蜜薯条',    color: '#54a0ff', pct: 15 },
    { icon: '💪', label: '再接再厉', desc: '下次一定！',    color: '#a55eea', pct: 10 },
  ]
}

// ========== 启动迁移 (旧 db.json → 新结构) ==========

function migrateIfNeeded() {
  if (!fs.existsSync(LEGACY_FILE)) return
  if (!fs.existsSync(GLOBAL_FILE) || !fs.existsSync(DAILIES_FILE)) {
    console.log('📦 检测到旧 db.json，正在迁移到模块化结构...')
    try {
      const oldData = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'))
      const { todos, ...rest } = oldData

      // 全局数据
      writeJSON(GLOBAL_FILE, { ...getDefaultGlobal(), ...rest })

      // 今日待办
      const today = getDateStr()
      writeJSON(path.join(TODOS_DIR, today + '.json'), { todos: todos || [] })

      // 日常任务模板（新建，空的）
      if (!fs.existsSync(DAILIES_FILE)) {
        writeJSON(DAILIES_FILE, { tasks: [] })
      }

      // 备份旧文件
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated')
      console.log('✅ 迁移完成！')
    } catch (e) {
      console.error('❌ 迁移失败:', e.message)
    }
  }
}

// 初始化
ensureDirs()
migrateIfNeeded()
if (!fs.existsSync(DAILIES_FILE)) writeJSON(DAILIES_FILE, { tasks: [] })
if (!fs.existsSync(REWARD_SLOTS_FILE)) writeJSON(REWARD_SLOTS_FILE, { slots: getDefaultRewardSlots() })
if (!fs.existsSync(GLOBAL_FILE)) writeJSON(GLOBAL_FILE, getDefaultGlobal())
else {
  // 迁移旧 global.json：去除 RPG 属性字段，确保积分字段存在
  const g = readJSON(GLOBAL_FILE)
  if (g.attributes || g.attributePoints !== undefined || g.points === undefined) {
    const cleaned = cleanGlobal({ ...getDefaultGlobal(), ...g })
    writeJSON(GLOBAL_FILE, cleaned)
    console.log('🔄 迁移 global.json：去除属性系统，添加积分字段')
  }
}

// ========== 旧 API (向后兼容) ==========

app.get('/api/load', (req, res) => {
  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  const todayTodos = readJSON(path.join(TODOS_DIR, getDateStr() + '.json'), { todos: [] })
  res.json({ ...global, todos: todayTodos.todos })
})

app.post('/api/save', (req, res) => {
  const body = req.body
  const { todos, ...globalData } = body
  writeJSON(GLOBAL_FILE, cleanGlobal({ ...getDefaultGlobal(), ...globalData }))
  if (todos !== undefined) {
    writeJSON(path.join(TODOS_DIR, getDateStr() + '.json'), { todos })
  }
  res.json({ ok: true })
})

// ========== 新增 API ==========

// 获取今日信息
app.get('/api/today', (req, res) => {
  const today = getDateStr()
  const file = path.join(TODOS_DIR, today + '.json')
  res.json({ date: today, isNewDay: !fs.existsSync(file) })
})

// 按日期获取待办（自动导入日常任务）
app.get('/api/todos/:date', (req, res) => {
  ensureDirs()
  const date = req.params.date
  const file = path.join(TODOS_DIR, date + '.json')

  // 请求今天且文件不存在 → 从日常任务导入
  const today = getDateStr()
  if (date === today && !fs.existsSync(file)) {
    const dailies = readJSON(DAILIES_FILE, { tasks: [] })
    const todos = dailies.tasks.map(t => ({
      _key: Date.now() + '_' + Math.random(),
      text: t.text,
      done: false,
      priority: t.priority ?? 5,
      category: 'daily'
    }))
    console.log('[auto-import] writing', todos.length, 'todos with category daily')
    writeJSON(file, { todos, deepWork: [] })
    return res.json({ todos, importedFromDailies: true, deepWork: [] })
  }

  const data = readJSON(file, { todos: [], deepWork: [] })
  // 确保所有待办都有 category 字段
  const todos = (data.todos || []).map(t => ({
    ...t,
    category: t.category || 'temporary',
    dueDate: t.dueDate || ''
  }))
  res.json({ todos, importedFromDailies: false, deepWork: data.deepWork || [] })
})

// 保存指定日期的待办（含深度工作记录）
app.post('/api/todos/:date', (req, res) => {
  ensureDirs()
  const date = req.params.date
  const file = path.join(TODOS_DIR, date + '.json')
  writeJSON(file, {
    todos: req.body.todos || [],
    deepWork: req.body.deepWork || []
  })
  res.json({ ok: true })
})

// 获取日常任务模板
app.get('/api/dailies', (req, res) => {
  ensureDirs()
  const data = readJSON(DAILIES_FILE, { tasks: [] })
  res.json(data)
})

// 保存日常任务模板
app.post('/api/dailies', (req, res) => {
  ensureDirs()
  writeJSON(DAILIES_FILE, { tasks: req.body.tasks || [] })
  res.json({ ok: true })
})

// 从昨天继承未完成任务
app.post('/api/carry-over', (req, res) => {
  ensureDirs()
  const yesterday = getYesterdayStr()
  const today = getDateStr()

  const yesterdayFile = path.join(TODOS_DIR, yesterday + '.json')
  const todayFile = path.join(TODOS_DIR, today + '.json')

  const yesterdayData = readJSON(yesterdayFile, { todos: [] })
  const todayData = readJSON(todayFile, { todos: [] })

  const todayKeys = new Set(todayData.todos.map(t => t.text))
  const toAdd = yesterdayData.todos
    .filter(t => !t.done && !todayKeys.has(t.text))
    .map(t => ({
      _key: Date.now() + '_' + Math.random(),
      text: t.text,
      done: false,
      priority: t.priority ?? 5,
      category: t.category || 'temporary',
      dueDate: t.dueDate || '',
      subtasks: t.subtasks ? t.subtasks.map(s => ({ ...s })) : []
    }))

  todayData.todos.push(...toAdd)
  writeJSON(todayFile, todayData)
  res.json({ added: toAdd.length, todos: todayData.todos })
})

// ========== 转盘奖励配置 API ==========
app.get('/api/reward-slots', (req, res) => {
  ensureDirs()
  const data = readJSON(REWARD_SLOTS_FILE, { slots: getDefaultRewardSlots() })
  res.json(data)
})

app.post('/api/reward-slots', (req, res) => {
  ensureDirs()
  const slots = req.body.slots
  if (!Array.isArray(slots) || slots.length < 2) {
    return res.json({ ok: false, error: '至少需要 2 个奖励项' })
  }
  // 验证每个 slot 有 icon/label/color/pct
  for (const s of slots) {
    if (!s.icon || !s.label || !s.color || typeof s.pct !== 'number') {
      return res.json({ ok: false, error: '奖励项缺少必要字段' })
    }
  }
  writeJSON(REWARD_SLOTS_FILE, { slots })
  res.json({ ok: true })
})

// ========== XP 联动（待办打勾时调用，仅用于追加减抽奖次数，等级由积分决定） ==========
app.post('/api/xp', (req, res) => {
  const { earned, spins: spinsOverride } = req.body
  if (!earned || earned <= 0) return res.json({ ok: false })

  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  global.xp = (global.xp ?? 0) + earned
  global.totalXPEarned = (global.totalXPEarned ?? 0) + earned
  global.spins = (global.spins ?? 0) + (spinsOverride ?? 1)

  writeJSON(GLOBAL_FILE, global)
  res.json({ ok: true, xp: global.xp, level: global.level, spins: global.spins })
})

// 扣除 XP / 抽奖次数（撤销打勾时调用）
app.post('/api/xp/deduct', (req, res) => {
  const { xp, spins } = req.body
  if ((!xp || xp <= 0) && (!spins || spins <= 0)) return res.json({ ok: false })
  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  global.xp = Math.max(0, (global.xp ?? 0) - (xp || 0))
  global.totalXPEarned = Math.max(0, (global.totalXPEarned ?? 0) - (xp || 0))
  global.spins = Math.max(0, (global.spins ?? 0) - (spins || 0))
  writeJSON(GLOBAL_FILE, global)
  res.json({ ok: true, xp: global.xp, level: global.level, spins: global.spins })
})

// ========== 语录 API ==========
app.get('/api/quotes', (req, res) => {
  ensureDirs()
  const data = readJSON(QUOTES_FILE, { quotes: [] })
  res.json(data)
})

app.post('/api/quotes', (req, res) => {
  ensureDirs()
  const data = readJSON(QUOTES_FILE, { quotes: [] })
  const { text, author } = req.body
  if (!text || !text.trim()) return res.json({ ok: false, error: '内容不能为空' })
  const maxId = data.quotes.reduce((m, q) => Math.max(m, q.id), 0)
  data.quotes.push({ id: maxId + 1, text: text.trim(), author: (author || '').trim() })
  writeJSON(QUOTES_FILE, data)
  res.json({ ok: true, quotes: data.quotes })
})

app.put('/api/quotes/:id', (req, res) => {
  ensureDirs()
  const data = readJSON(QUOTES_FILE, { quotes: [] })
  const id = parseInt(req.params.id, 10)
  const { text, author } = req.body
  const quote = data.quotes.find(q => q.id === id)
  if (!quote) return res.json({ ok: false, error: '语录不存在' })
  if (text !== undefined) quote.text = text.trim()
  if (author !== undefined) quote.author = (author || '').trim()
  writeJSON(QUOTES_FILE, data)
  res.json({ ok: true, quotes: data.quotes })
})

app.delete('/api/quotes/:id', (req, res) => {
  ensureDirs()
  const data = readJSON(QUOTES_FILE, { quotes: [] })
  const id = parseInt(req.params.id, 10)
  data.quotes = data.quotes.filter(q => q.id !== id)
  writeJSON(QUOTES_FILE, data)
  res.json({ ok: true, quotes: data.quotes })
})

// ========== 背景图片列表 API ==========
const IMAGES_DIR = path.join(__dirname, 'public', 'images', 'background')
app.get('/api/backgrounds', (req, res) => {
  try {
    const files = fs.readdirSync(IMAGES_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    res.json({ backgrounds: files })
  } catch (e) {
    res.json({ backgrounds: [] })
  }
})

// 获取全局数据（RPG + Turntable + 积分）
app.get('/api/global', (req, res) => {
  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  res.json(global)
})

// 保存全局数据（如 scareDDL）
app.post('/api/global', (req, res) => {
  let global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  const { attributes, attributePoints, ...rest } = req.body // 忽略旧属性字段
  const updated = { ...global, ...rest }
  writeJSON(GLOBAL_FILE, updated)
  res.json({ ok: true })
})

// ========== 积分 API ==========

// 获得积分（来源：deepwork / taskCompletion）
app.post('/api/points', (req, res) => {
  const { amount, source } = req.body
  if (!amount || amount <= 0) return res.json({ ok: false })
  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  const oldLevel = global.level ?? 1
  const rounded = Math.round(amount * 10) / 10
  global.points = Math.round(((global.points ?? 0) + rounded) * 10) / 10
  global.totalPointsEarned = Math.round(((global.totalPointsEarned ?? 0) + rounded) * 10) / 10
  if (!global.pointsDetail) global.pointsDetail = { deepwork: 0, taskCompletion: 0 }
  if (source === 'deepwork' || source === 'taskCompletion') {
    global.pointsDetail[source] = Math.round(((global.pointsDetail[source] ?? 0) + rounded) * 10) / 10
  }
  // 等级基于历史总积分
  global.level = calcLevel(global.totalPointsEarned)
  const leveledUp = global.level > oldLevel
  writeJSON(GLOBAL_FILE, global)
  res.json({ ok: true, points: global.points, totalPointsEarned: global.totalPointsEarned, pointsDetail: global.pointsDetail, level: global.level, leveledUp })
})

// 消费积分
app.post('/api/points/spend', (req, res) => {
  const { amount } = req.body
  if (!amount || amount <= 0) return res.json({ ok: false })
  const global = cleanGlobal(readJSON(GLOBAL_FILE, getDefaultGlobal()))
  if ((global.points ?? 0) < amount) return res.json({ ok: false, error: '积分不足' })
  global.points = Math.round(((global.points ?? 0) - amount) * 10) / 10
  writeJSON(GLOBAL_FILE, global)
  res.json({ ok: true, points: global.points })
})

// ========== Bilibili API 代理 ==========

function biliFetch(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://space.bilibili.com/'
      }
    }
    https.get(opts, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '??:??'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// 获取 Bilibili 合集视频列表
app.get('/api/bilibili/series', async (req, res) => {
  const { url } = req.query
  if (!url) return res.json({ ok: false, error: '请提供 Bilibili 合集链接' })

  const match = url.match(/space\.bilibili\.com\/(\d+)\/lists\/(\d+)/)
  if (!match) return res.json({ ok: false, error: '无法解析合集链接，请检查格式' })

  const mid = match[1]
  const seriesId = match[2]

  try {
    // 分页拉取所有视频
    const allArchives = []
    let page = 1
    let total = 0

    do {
      const data = await biliFetch(`https://api.bilibili.com/x/series/archives?series_id=${seriesId}&mid=${mid}&ps=50&pn=${page}`)
      if (data.code !== 0) {
        return res.json({ ok: false, error: 'Bilibili API: ' + (data.message || '请求失败') })
      }
      const archives = data.data?.archives || []
      allArchives.push(...archives)
      total = data.data?.page?.total || archives.length
      page++
    } while (allArchives.length < total && page <= 20)

    // 获取合集名称
    let seriesName = 'Bilibili 合集'
    try {
      const infoData = await biliFetch(`https://api.bilibili.com/x/series?series_id=${seriesId}`)
      if (infoData.code === 0 && infoData.data?.name) {
        seriesName = infoData.data.name
      }
    } catch (e) { /* 忽略 */ }

    const videos = allArchives.map(a => ({
      uid: a.bvid,
      bvid: a.bvid,
      title: a.title,
      duration: a.duration,
      durationText: formatDuration(a.duration),
      aid: a.aid
    }))

    res.json({ ok: true, videos, seriesName, seriesId, mid, count: videos.length })
  } catch (e) {
    res.json({ ok: false, error: '请求 Bilibili 失败: ' + e.message })
  }
})

// 获取多P视频的分P列表
app.get('/api/bilibili/video', async (req, res) => {
  const { url } = req.query
  if (!url) return res.json({ ok: false, error: '请提供 Bilibili 视频链接' })

  const match = url.match(/bilibili\.com\/video\/(BV\w+)/i)
  if (!match) return res.json({ ok: false, error: '无法解析视频链接，请检查格式' })

  const bvid = match[1]

  try {
    const data = await biliFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    if (data.code !== 0) {
      return res.json({ ok: false, error: 'Bilibili API: ' + (data.message || '请求失败') })
    }

    const viewData = data.data
    const pages = viewData.pages || []

    if (pages.length === 0) {
      return res.json({ ok: false, error: '该视频没有分P内容' })
    }

    const videos = pages.map(p => ({
      uid: bvid + '_p' + p.page,
      bvid: bvid,
      cid: p.cid,
      page: p.page,
      title: p.part || 'P' + p.page,
      duration: p.duration,
      durationText: formatDuration(p.duration),
    }))

    res.json({ ok: true, videos, seriesName: viewData.title, videoId: bvid, count: videos.length })
  } catch (e) {
    res.json({ ok: false, error: '请求 Bilibili 失败: ' + e.message })
  }
})

// ========== Bilibili 课程持久化 ==========

// 获取所有已保存课程
app.get('/api/bilibili/courses', (req, res) => {
  ensureDirs()
  const data = readJSON(BILI_COURSES_FILE, { courses: [] })
  res.json(data)
})

// 保存课程
app.post('/api/bilibili/courses', (req, res) => {
  ensureDirs()
  const data = readJSON(BILI_COURSES_FILE, { courses: [] })
  const course = req.body
  if (!course.id || !course.videos) {
    return res.json({ ok: false, error: '无效的课程数据' })
  }
  const existing = data.courses.findIndex(c => c.id === course.id)
  if (existing !== -1) {
    data.courses[existing] = course
  } else {
    data.courses.push(course)
  }
  writeJSON(BILI_COURSES_FILE, data)
  res.json({ ok: true })
})

// 删除课程
app.delete('/api/bilibili/courses/:id', (req, res) => {
  ensureDirs()
  const data = readJSON(BILI_COURSES_FILE, { courses: [] })
  data.courses = data.courses.filter(c => c.id !== req.params.id)
  writeJSON(BILI_COURSES_FILE, data)
  res.json({ ok: true })
})

// 更新课程 watched 状态（轻量）
app.patch('/api/bilibili/courses/:id/watched', (req, res) => {
  ensureDirs()
  const data = readJSON(BILI_COURSES_FILE, { courses: [] })
  const course = data.courses.find(c => c.id === req.params.id)
  if (!course) return res.json({ ok: false, error: '课程不存在' })
  course.watched = req.body.watched || []
  writeJSON(BILI_COURSES_FILE, data)
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`🚀 打开 http://localhost:${PORT}`)
})
