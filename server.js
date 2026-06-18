const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3000
const DATA_DIR = path.join(__dirname, 'data')
const TODOS_DIR = path.join(DATA_DIR, 'todos')
const GLOBAL_FILE = path.join(DATA_DIR, 'global.json')
const DAILIES_FILE = path.join(DATA_DIR, 'dailies.json')
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json')
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

function getDefaultGlobal() {
  return {
    xp: 0,
    level: 1,
    attributes: { strength: 0, intelligence: 0, endurance: 0, spirit: 0 },
    totalXPEarned: 0,
    attributePoints: 0,
    spins: 0,
    rewards: [],
    history: [],
    counter: 0
  }
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
if (!fs.existsSync(GLOBAL_FILE)) writeJSON(GLOBAL_FILE, getDefaultGlobal())

// ========== 旧 API (向后兼容) ==========

app.get('/api/load', (req, res) => {
  const global = readJSON(GLOBAL_FILE, getDefaultGlobal())
  const todayTodos = readJSON(path.join(TODOS_DIR, getDateStr() + '.json'), { todos: [] })
  res.json({ ...global, todos: todayTodos.todos })
})

app.post('/api/save', (req, res) => {
  const body = req.body
  const { todos, ...globalData } = body
  writeJSON(GLOBAL_FILE, { ...getDefaultGlobal(), ...globalData })
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
    writeJSON(file, { todos })
    return res.json({ todos, importedFromDailies: true })
  }

  const data = readJSON(file, { todos: [] })
  // 确保所有待办都有 category 字段
  const todos = (data.todos || []).map(t => ({
    ...t,
    category: t.category || 'temporary',
    dueDate: t.dueDate || ''
  }))
  res.json({ todos, importedFromDailies: false })
})

// 保存指定日期的待办
app.post('/api/todos/:date', (req, res) => {
  ensureDirs()
  const date = req.params.date
  const file = path.join(TODOS_DIR, date + '.json')
  writeJSON(file, { todos: req.body.todos || [] })
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
      dueDate: t.dueDate || ''
    }))

  todayData.todos.push(...toAdd)
  writeJSON(todayFile, todayData)
  res.json({ added: toAdd.length, todos: todayData.todos })
})

// ========== XP 联动（待办打勾时调用） ==========
app.post('/api/xp', (req, res) => {
  const { earned, spins: spinsOverride } = req.body
  if (!earned || earned <= 0) return res.json({ ok: false })

  const global = readJSON(GLOBAL_FILE, getDefaultGlobal())
  global.xp = (global.xp ?? 0) + earned
  global.totalXPEarned = (global.totalXPEarned ?? 0) + earned
  global.spins = (global.spins ?? 0) + (spinsOverride ?? 1)

  let leveledUp = false
  const threshold = (global.level ?? 1) * 100
  if (global.xp >= threshold) {
    global.xp -= threshold
    global.level = (global.level ?? 1) + 1
    global.attributePoints = (global.attributePoints ?? 0) + 3
    leveledUp = true
  }

  writeJSON(GLOBAL_FILE, global)
  res.json({ ok: true, xp: global.xp, level: global.level, attributePoints: global.attributePoints, leveledUp, spins: global.spins })
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
  data.quotes.push({ id: maxId + 1, text: text.trim(), author: (author || '').trim() || '匿名' })
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
  if (author !== undefined) quote.author = (author || '').trim() || '匿名'
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
const IMAGES_DIR = path.join(__dirname, 'public', 'images')
app.get('/api/backgrounds', (req, res) => {
  try {
    const files = fs.readdirSync(IMAGES_DIR).filter(f => /^background\d*\.(jpg|jpeg|png|webp)$/i.test(f))
    res.json({ backgrounds: files })
  } catch (e) {
    res.json({ backgrounds: [] })
  }
})

// 获取全局数据（RPG + Turntable）
app.get('/api/global', (req, res) => {
  const global = readJSON(GLOBAL_FILE, getDefaultGlobal())
  res.json(global)
})

// 保存全局数据（如 scareDDL）
app.post('/api/global', (req, res) => {
  const global = readJSON(GLOBAL_FILE, getDefaultGlobal())
  // 浅合并，数组原样覆盖（只有 scareDDL 这类简单对象会被写入）
  const updated = { ...global, ...req.body }
  if (req.body.attributes) {
    updated.attributes = { ...global.attributes, ...req.body.attributes }
  }
  writeJSON(GLOBAL_FILE, updated)
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`🚀 打开 http://localhost:${PORT}`)
})
