const { createApp, ref, computed, onMounted, nextTick } = Vue

const CATEGORIES = [
  { id: 'daily',      label: '日常任务',               icon: '📆', color: '#4CAF50', bg: '#E8F5E9', border: '#A5D6A7' },
  { id: 'temporary',  label: '紧急不重要/无成长：抽空做', icon: '⚡',  color: '#FF9800', bg: '#FFF3E0', border: '#FFCC80' },
  { id: 'deadline',   label: '近期DDL',                icon: '🔥',  color: '#F44336', bg: '#FFEBEE', border: '#EF9A9A' },
  { id: 'longterm',   label: '长期任务/目标/想发展的点', icon: '🌳',  color: '#2196F3', bg: '#E3F2FD', border: '#90CAF9' },
]

const app = createApp({
  setup() {
    // ====== 状态 ======
    const data = ref({ todos: [] })
    const globalData = ref({})
    const selectedDate = ref('')
    const today = ref('')
    const newTodo = ref('')
    const newPriority = ref(5)
    const newCategory = ref('temporary')
    const newDueDate = ref('')
    const editingKey = ref(null)
    const editText = ref('')
    const editDueDate = ref('')
    const toasts = ref([])
    const expanded = ref({ daily: true, temporary: true, longterm: true, deadline: true })
    const dragKey = ref(null)      // 正在拖拽的任务 key
    const dragOverKey = ref(null)  // 鼠标悬停的目标任务 key
    const importInfo = ref('')
    let toastId = 0

    // ====== 工具函数 ======
    function genKey() {
      return Date.now() + '_' + Math.random()
    }
    function normalizeTodo(t) {
      return { ...t, category: t.category || 'temporary', dueDate: t.dueDate || '', subtasks: t.subtasks || [] }
    }
    function getPrevDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00')
      d.setDate(d.getDate() - 1)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    // ====== 子任务 modal ======
    const showSubtaskModal = ref(false)
    const subtaskTodo = ref(null)
    const subtaskEditIdx = ref(null)
    const subtaskEditText = ref('')
    const subtaskEditInput = ref(null)

    // ====== 恐吓DDL ======
    const scareDDLKey = ref(null)

    const scareDDL = computed(() => {
      if (!scareDDLKey.value) return null
      return data.value.todos.find(t => t._key === scareDDLKey.value) || null
    })

    async function initScareDDL() {
      const existing = globalData.value.scareDDL
      if (existing && existing.date === today.value) {
        // 验证该任务仍然存在
        const found = data.value.todos.find(t => t._key === existing.key)
        if (found) {
          scareDDLKey.value = existing.key
          return
        }
      }
      await pickScareDDL()
    }

    async function pickScareDDL() {
      const candidates = data.value.todos.filter(
        t => t.category === 'deadline' && !t.done && t.dueDate
      )
      if (candidates.length === 0) {
        scareDDLKey.value = null
        return
      }
      const picked = candidates[Math.floor(Math.random() * candidates.length)]
      scareDDLKey.value = picked._key
      const scareObj = { key: picked._key, date: today.value }
      await fetch('/api/global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scareDDL: scareObj })
      })
      globalData.value.scareDDL = scareObj
    }

    // ====== 撤销/重做 ======
    const undoStack = ref([])
    const redoStack = ref([])
    const MAX_UNDO = 50

    function saveSnapshot() {
      if (!isToday.value) return
      undoStack.value.push(JSON.parse(JSON.stringify(data.value.todos)))
      if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
      redoStack.value = []
    }

    function undo() {
      if (undoStack.value.length === 0) return
      redoStack.value.push(JSON.parse(JSON.stringify(data.value.todos)))
      data.value.todos = undoStack.value.pop()
      saveTodos()
      addToast('↩ 撤销')
    }

    function redo() {
      if (redoStack.value.length === 0) return
      undoStack.value.push(JSON.parse(JSON.stringify(data.value.todos)))
      data.value.todos = redoStack.value.pop()
      saveTodos()
      addToast('↪ 重做')
    }

    // ====== 计算属性 ======
    const isToday = computed(() => selectedDate.value === today.value)

    const doneCount = computed(() => data.value.todos.filter(t => t.done).length)

    const todayProgress = computed(() => {
      const todayCats = data.value.todos.filter(t => t.category === 'daily' || t.category === 'temporary')
      return {
        done: todayCats.filter(t => t.done).length,
        total: todayCats.length
      }
    })

    // 按分类分组并排序
    const grouped = computed(() => {
      const groups = {}
      CATEGORIES.forEach(c => { groups[c.id] = [] })
      data.value.todos.forEach(t => {
        const cat = t.category || 'temporary'
        if (groups[cat]) groups[cat].push(t)
        else groups.temporary.push(t)
      })
      Object.values(groups).forEach(arr => {
        arr.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      })
      // deadline 分类：优先级相同则按截止日期从近到远排序
      if (groups.deadline) {
        groups.deadline.sort((a, b) => {
          const pa = a.priority ?? 0
          const pb = b.priority ?? 0
          if (pb !== pa) return pb - pa
          // 优先级相同 → 按剩余天数升序（截止越近越靠前）
          const da = a.dueDate ? daysUntil(a.dueDate) : 999
          const db = b.dueDate ? daysUntil(b.dueDate) : 999
          return da - db
        })
      }
      return groups
    })

    const isDeadlineCategory = computed(() => newCategory.value === 'deadline')

    // ====== 工具函数 ======
    function formatDate(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr + 'T00:00:00')
      const weekdays = ['日', '一', '二', '三', '四', '五', '六']
      return `${dateStr} 周${weekdays[d.getDay()]}`
    }

    function daysUntil(dateStr) {
      if (!dateStr) return 999
      const now = new Date(selectedDate.value + 'T00:00:00')
      const target = new Date(dateStr + 'T00:00:00')
      return Math.round((target - now) / (1000 * 60 * 60 * 24))
    }

    function daysLabel(dateStr) {
      const d = daysUntil(dateStr)
      if (d === 999) return ''
      if (d < 0) return `（已逾期${Math.abs(d)}天）`
      if (d === 0) return '（今天截止）'
      return `（剩${d}天）`
    }

    function urgencyClass(dateStr) {
      if (!dateStr) return ''
      const d = daysUntil(dateStr)
      if (d < 0) return 'overdue'
      if (d === 0) return 'due-today'
      if (d <= 3) return 'due-soon'
      return ''
    }

    function addToast(text) {
      const id = ++toastId
      toasts.value.push({ id, text })
      setTimeout(() => {
        const i = toasts.value.findIndex(t => t.id === id)
        if (i !== -1) toasts.value.splice(i, 1)
      }, 2000)
    }

    // ====== 数据加载 ======
    async function loadTodayInfo() {
      const res = await fetch('/api/today')
      const d = await res.json()
      today.value = d.date
      selectedDate.value = d.date
    }

    async function loadGlobal() {
      const res = await fetch('/api/global')
      globalData.value = await res.json()
    }

    async function loadTodos(dateStr) {
      const res = await fetch(`/api/todos/${dateStr}`)
      const d = await res.json()
      data.value.todos = (d.todos || []).map(t => normalizeTodo(t))
      if (d.importedFromDailies) {
        importInfo.value = '📋 已自动导入日常任务到「日课」'
        setTimeout(() => { importInfo.value = '' }, 3000)
      }
      // 自动从昨天继承日常任务（✓ 状态清零）
      if (dateStr === today.value) {
        await autoCarryDaily()
      }
      // 加载完成后重置撤销栈并保存初始快照
      undoStack.value = []
      redoStack.value = []
      saveSnapshot()
    }

    async function autoCarryDaily() {
      const yesterday = getPrevDate(today.value)
      const res = await fetch(`/api/todos/${yesterday}`)
      const d = await res.json()
      const yesterdayDailies = (d.todos || []).filter(t => t.category === 'daily')
      if (yesterdayDailies.length === 0) return
      const existingTexts = new Set(data.value.todos.map(t => t.text))
      let added = 0
      yesterdayDailies.forEach(t => {
        if (!existingTexts.has(t.text)) {
          data.value.todos.push({
            _key: genKey(),
            text: t.text,
            done: false,
            priority: t.priority ?? 5,
            category: 'daily',
            dueDate: '',
            subtasks: []
          })
          added++
        }
      })
      if (added > 0) {
        await saveTodos()
        addToast(`📆 自动继承 ${added} 项日常任务`)
      }
    }

    async function saveTodos() {
      await fetch(`/api/todos/${selectedDate.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: data.value.todos })
      })
    }

    // ====== 日期切换 ======
    function onDateChange() {
      if (selectedDate.value) {
        undoStack.value = []
        redoStack.value = []
        loadTodos(selectedDate.value)
      }
    }

    // ====== 待办 CRUD ======
    function addTodo() {
      saveSnapshot()
      const text = newTodo.value.trim()
      if (!text) return
      const p = Math.max(0, Math.min(10, newPriority.value ?? 5))
      const todo = {
        _key: genKey(),
        text,
        done: false,
        priority: p,
        category: newCategory.value,
        dueDate: newCategory.value === 'deadline' ? newDueDate.value : '',
        subtasks: []
      }
      data.value.todos.push(todo)
      newTodo.value = ''
      newPriority.value = 5
      newDueDate.value = ''
      saveTodos()
    }

    function startEdit(todo) {
      editingKey.value = todo._key
      editText.value = todo.text
      editDueDate.value = todo.dueDate || ''
      nextTick(() => {
        const el = document.querySelector('.edit-input')
        if (el) { el.focus(); el.select() }
      })
    }

    function saveEdit(todo) {
      if (editingKey.value !== todo._key) return
      saveSnapshot()
      const t = editText.value.trim()
      if (t) todo.text = t
      todo.dueDate = editDueDate.value
      editingKey.value = null
      editText.value = ''
      editDueDate.value = ''
      saveTodos()
    }

    function cancelEdit() {
      editingKey.value = null
      editText.value = ''
      editDueDate.value = ''
    }

    function changePriority(todo, delta) {
      saveSnapshot()
      let v = (todo.priority ?? 5) + delta
      todo.priority = Math.round(Math.max(0, Math.min(10, v)) * 10) / 10
      saveTodos()
    }

    function onPrioChange(todo) {
      saveSnapshot()
      if (todo.priority === '' || todo.priority === null) todo.priority = 0
      todo.priority = Math.round(Math.max(0, Math.min(10, Number(todo.priority))) * 10) / 10
      saveTodos()
    }

    function deleteTodo(todo) {
      saveSnapshot()
      const i = data.value.todos.findIndex(t => t._key === todo._key)
      if (i === -1) return
      data.value.todos.splice(i, 1)
      saveTodos()
    }

    function onDueDateChange(todo, val) {
      saveSnapshot()
      todo.dueDate = val
      saveTodos()
    }

    // ====== 日常任务模板（轻量管理） ======
    const dailies = ref({ tasks: [] })
    const showDailiesEditor = ref(false)
    const newDailyText = ref('')
    const newDailyPriority = ref(5)

    async function loadDailies() {
      const res = await fetch('/api/dailies')
      dailies.value = await res.json()
    }

    async function saveDailies() {
      await fetch('/api/dailies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: dailies.value.tasks })
      })
    }

    function addDailyTask() {
      const text = newDailyText.value.trim()
      if (!text) return
      dailies.value.tasks.push({
        text,
        priority: Math.max(0, Math.min(10, newDailyPriority.value ?? 5))
      })
      newDailyText.value = ''
      newDailyPriority.value = 5
      saveDailies()
    }

    function deleteDailyTask(i) {
      dailies.value.tasks.splice(i, 1)
      saveDailies()
    }

    // ====== 折叠切换 ======
    function toggleCat(id) {
      expanded.value[id] = !expanded.value[id]
    }

    // ====== 每个模块的快速添加 ======
    function addQuickTodo(catId) {
      if (!isToday.value) return
      saveSnapshot()
      const todo = {
        _key: genKey(),
        text: '新建待办',
        done: false,
        priority: 5,
        category: catId,
        dueDate: '',
        subtasks: []
      }
      data.value.todos.push(todo)
      saveTodos()
      // 自动进入编辑模式
      editingKey.value = todo._key
      editText.value = todo.text
      editDueDate.value = ''
      nextTick(() => {
        const el = document.querySelector('.edit-input')
        if (el) { el.focus(); el.select() }
      })
    }

    // ====== 让编辑中的任务可见 ======
    function isEditing(todo) {
      return editingKey.value === todo._key
    }

    // ====== 子任务 ======
    let clickTimer = null

    function onTodoClick(todo) {
      if (clickTimer) {
        clearTimeout(clickTimer)
        clickTimer = null
        return  // 双击时跳过，让 dblclick 处理
      }
      clickTimer = setTimeout(() => {
        clickTimer = null
        openSubtaskView(todo)
      }, 220)
    }

    function onTodoDblClick(todo) {
      if (clickTimer) {
        clearTimeout(clickTimer)
        clickTimer = null
      }
      if (isToday.value) startEdit(todo)
    }

    function subtaskCount(todo) {
      return (todo.subtasks || []).length
    }

    function subtaskDoneCount(todo) {
      return (todo.subtasks || []).filter(s => s.done).length
    }

    function openSubtaskView(todo) {
      subtaskTodo.value = todo
      subtaskEditIdx.value = null
      subtaskEditText.value = ''
      showSubtaskModal.value = true
      document.body.style.overflow = 'hidden'
    }

    function closeSubtaskModal() {
      showSubtaskModal.value = false
      subtaskTodo.value = null
      subtaskEditIdx.value = null
      subtaskEditText.value = ''
      document.body.style.overflow = ''
    }

    function addSubtaskInline() {
      if (!subtaskTodo.value || !isToday.value) return
      saveSnapshot()
      if (!subtaskTodo.value.subtasks) subtaskTodo.value.subtasks = []
      const idx = subtaskTodo.value.subtasks.length
      subtaskTodo.value.subtasks.push({ text: '', done: false })
      subtaskEditIdx.value = idx
      subtaskEditText.value = ''
      saveTodos()
      nextTick(() => {
        subtaskEditInput.value?.focus()
      })
    }

    function startSubtaskEdit(index) {
      if (!isToday.value) return
      const st = subtaskTodo.value?.subtasks[index]
      if (!st) return
      subtaskEditIdx.value = index
      subtaskEditText.value = st.text
      nextTick(() => {
        subtaskEditInput.value?.focus()
        subtaskEditInput.value?.select()
      })
    }

    function saveSubtaskEdit(index) {
      if (subtaskEditIdx.value !== index) return
      const st = subtaskTodo.value?.subtasks[index]
      if (!st) return
      const text = subtaskEditText.value.trim()
      if (text) {
        st.text = text
        saveTodos()
      } else {
        subtaskTodo.value.subtasks.splice(index, 1)
        saveTodos()
      }
      subtaskEditIdx.value = null
      subtaskEditText.value = ''
    }

    function cancelSubtaskEdit() {
      const idx = subtaskEditIdx.value
      if (idx === null) return
      const st = subtaskTodo.value?.subtasks[idx]
      if (st && !st.text.trim()) {
        subtaskTodo.value.subtasks.splice(idx, 1)
        saveTodos()
      }
      subtaskEditIdx.value = null
      subtaskEditText.value = ''
    }

    function removeSubtask(index) {
      if (!subtaskTodo.value || !isToday.value) return
      saveSnapshot()
      subtaskTodo.value.subtasks.splice(index, 1)
      if (subtaskEditIdx.value === index) {
        subtaskEditIdx.value = null
        subtaskEditText.value = ''
      }
      saveTodos()
    }

    function onSubtaskToggle() {
      if (!subtaskTodo.value) return
      saveSnapshot()
      saveTodos()
      // 子任务全部完成 → 自动勾选父任务
      const allDone = subtaskTodo.value.subtasks.length > 0 &&
        subtaskTodo.value.subtasks.every(s => s.done)
      if (allDone && !subtaskTodo.value.done) {
        subtaskTodo.value.done = true
        onTodoToggle(subtaskTodo.value)
      } else if (!allDone && subtaskTodo.value.done) {
        // 有子任务未完成 → 取消父任务勾选
        subtaskTodo.value.done = false
        saveTodos()
      }
    }

    // ====== 拖拽 ======
    function onDragStart(todo) {
      if (!isToday.value) return
      dragKey.value = todo._key
    }

    function onDragOver(e, todo) {
      if (!isToday.value) return
      e.preventDefault()
      if (todo._key !== dragKey.value) {
        dragOverKey.value = todo._key
      }
    }

    function onDragLeave() {
      dragOverKey.value = null
    }

    function onModuleDragOver(e) {
      if (!isToday.value) return
      e.preventDefault()
    }

    function onDrop(e, catId, targetTodo) {
      if (!isToday.value || !dragKey.value) return
      e.stopPropagation()
      saveSnapshot()
      const sourceTodo = data.value.todos.find(t => t._key === dragKey.value)
      if (!sourceTodo) { clearDrag(); return }

      // 获取目标分类的排序列表
      const targets = grouped.value[catId] || []
      const targetKey = targetTodo ? targetTodo._key : null

      if (targetKey && targetKey !== sourceTodo._key) {
        // 拖到某个任务上方 → 优先级 = 目标优先级 + 0.1
        const target = targets.find(t => t._key === targetKey)
        if (target) {
          sourceTodo.priority = Math.min(10, Math.round(((target.priority ?? 0) + 0.1) * 10) / 10)
        }
      } else if (!targetKey && targets.length > 0) {
        // 拖到分类末尾 → 优先级 = 最低优先级 - 0.1
        const last = targets[targets.length - 1]
        sourceTodo.priority = Math.max(0, Math.round(((last.priority ?? 0) - 0.1) * 10) / 10)
      }
      // 如果目标分类为空，保持原优先级

      sourceTodo.category = catId
      if (catId !== 'deadline') {
        sourceTodo.dueDate = ''
      }

      clearDrag()
      saveTodos()
    }

    function onDropToEnd(catId) {
      if (!isToday.value || !dragKey.value) return
      saveSnapshot()
      const sourceTodo = data.value.todos.find(t => t._key === dragKey.value)
      if (!sourceTodo) { clearDrag(); return }

      const targets = grouped.value[catId] || []
      if (targets.length > 0) {
        const last = targets[targets.length - 1]
        sourceTodo.priority = Math.max(0, Math.round(((last.priority ?? 0) - 0.1) * 10) / 10)
      }

      sourceTodo.category = catId
      if (catId !== 'deadline') sourceTodo.dueDate = ''

      clearDrag()
      saveTodos()
    }

    function onDragEnd() {
      clearDrag()
    }

    // ====== 底部拖拽放置区 ======
    function onDropZoneDragOver(e) {
      if (!isToday.value) return
      e.preventDefault()
    }

    function onDropZoneDrop(catId) {
      if (!isToday.value) return
      onDropToEnd(catId)
    }

    function clearDrag() {
      dragKey.value = null
      dragOverKey.value = null
    }

    // ====== 从昨天继承 ======
    async function carryOver() {
      saveSnapshot()
      const res = await fetch('/api/carry-over', { method: 'POST' })
      const d = await res.json()
      data.value.todos = (d.todos || []).map(t => normalizeTodo(t))
      if (d.added > 0) {
        addToast('↻ 已继承 ' + d.added + ' 项未完成任务')
      } else {
        addToast('✅ 昨天没有未完成的任务')
      }
    }

    // ====== RPG 联动 ======
    async function onTodoToggle(todo) {
      if (todo.done) {
        const earned = Math.round((todo.priority ?? 5) * 10)
        let spinsToAward = 1
        let isScare = false
        if (scareDDL.value && todo._key === scareDDL.value._key) {
          spinsToAward = 3
          isScare = true
        }
        const res = await fetch('/api/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ earned, spins: spinsToAward })
        })
        const result = await res.json()
        if (result.ok) {
          globalData.value.xp = result.xp
          globalData.value.level = result.level
          globalData.value.attributePoints = result.attributePoints
          globalData.value.spins = result.spins
          addToast('✨ +' + earned + ' XP')
          if (isScare) {
            addToast('🎰 恐吓DDL奖励！+3 抽奖次数！')
          }
          if (result.leveledUp) {
            addToast('🎉 升级！Lv.' + result.level + ' (+3 属性点)')
          }
        }
      }
      saveTodos()
    }

    function onScareCheckboxClick(e) {
      if (!isToday.value) return
      const t = scareDDL.value
      if (!t) return
      saveSnapshot()
      t.done = e.target.checked
      onTodoToggle(t)
    }

    // ====== 键盘快捷键 ======
    function onKeydown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo()
      }
      if (e.ctrlKey && (e.key === 'y' || (e.key === 'Y' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }

    // ====== 初始化 ======
    onMounted(async () => {
      await loadTodayInfo()
      await Promise.all([
        loadTodos(selectedDate.value),
        loadGlobal(),
        loadDailies()
      ])
      initScareDDL()
      window.addEventListener('keydown', onKeydown)
    })

    return {
      CATEGORIES, data, globalData, dailies,
      selectedDate, today, isToday,
      newTodo, newPriority, newCategory, newDueDate,
      isDeadlineCategory,
      editingKey, editText, editDueDate,
      toasts, expanded, importInfo,
      dragKey, dragOverKey,
      showDailiesEditor, newDailyText, newDailyPriority,
      showSubtaskModal, subtaskTodo, subtaskEditIdx, subtaskEditText,
      scareDDL,
      grouped, doneCount, todayProgress,
      formatDate, daysUntil, daysLabel, urgencyClass,
      addTodo, startEdit, saveEdit, cancelEdit,
      changePriority, onPrioChange,
      deleteTodo, onDueDateChange, onDateChange,
      toggleCat, isEditing, addQuickTodo,
      subtaskCount, subtaskDoneCount,
      openSubtaskView, closeSubtaskModal,
      addSubtaskInline, startSubtaskEdit, saveSubtaskEdit, cancelSubtaskEdit, removeSubtask, onSubtaskToggle,
      onTodoClick, onTodoDblClick,
      onDragStart, onDragOver, onDragLeave, onModuleDragOver,
      onDrop, onDropToEnd, onDragEnd,
      onDropZoneDragOver, onDropZoneDrop,
      addDailyTask, deleteDailyTask,
      carryOver, onTodoToggle, onScareCheckboxClick,
      undo, redo, saveSnapshot,
      undoStack, redoStack
    }
  }
})

app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info)
  const div = document.createElement('div')
  div.style.cssText = 'background:#fcc;padding:16px;margin:16px;border-radius:8px;font-size:14px;white-space:pre-wrap;border:2px solid #c00'
  div.textContent = `❌ Vue Error: ${err.message}${info ? '\nInfo: ' + info : ''}`
  document.body.prepend(div)
}

app.mount('#app')
