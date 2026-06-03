const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3000
const DATA_FILE = path.join(__dirname, 'data', 'db.json')

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// 读取数据
app.get('/api/load', (req, res) => {
  const data = fs.readFileSync(DATA_FILE, 'utf-8')
  res.json(JSON.parse(data))
})

// 保存数据
app.post('/api/save', (req, res) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), 'utf-8')
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`🚀 打开 http://localhost:${PORT}`)
})
