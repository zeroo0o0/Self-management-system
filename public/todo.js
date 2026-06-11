const { createApp, ref, computed, onMounted, nextTick } = Vue

const CATEGORIES = [
  { id: 'daily',      label: '日课',     icon: '📆', color: '#4CAF50', bg: '#E8F5E9', border: '#A5D6A7' },
  { id: 'temporary',  label: '临时任务', icon: '⚡',  color: '#FF9800', bg: '#FFF3E0', border: '#FFCC80' },
  { id: 'longterm',   label: '长期任务', icon: '🌳',  color: '#2196F3', bg: '#E3F2FD', border: '#90CAF9' },
  { id: 'deadline',   label: '近期DDL',  icon: '🔥',  color: '#F44336', bg: '#FFEBEE', border: '#EF9A9A' },
]

createApp({
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

    // ====== 计算属性 ======
    const isToday = computed(() => selectedDate.value === today.value)

    const doneCount = computed(() => data.value.todos.filter(t => t.done).length)

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

    function formatDueDate(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr + 'T00:00:00')
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${m}-${day}`
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
      data.value.todos = (d.todos || []).map(t => ({
        ...t,
        category: t.category || 'temporary',
        dueDate: t.dueDate || ''
      }))
      if (d.importedFromDailies) {
        importInfo.value = '📋 已自动导入日常任务到「日课」'
        setTimeout(() => { importInfo.value = '' }, 3000)
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
      if (selectedDate.value) loadTodos(selectedDate.value)
    }

    // ====== 待办 CRUD ======
    function addTodo() {
      const text = newTodo.value.trim()
      if (!text) return
      const p = Math.max(0, Math.min(10, newPriority.value ?? 5))
      const todo = {
        _key: Date.now() + '_' + Math.random(),
        text,
        done: false,
        priority: p,
        category: newCategory.value,
        dueDate: newCategory.value === 'deadline' ? newDueDate.value : ''
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
      let v = (todo.priority ?? 5) + delta
      todo.priority = Math.round(Math.max(0, Math.min(10, v)) * 10) / 10
      saveTodos()
    }

    function onPrioChange(todo) {
      if (todo.priority === '' || todo.priority === null) todo.priority = 0
      todo.priority = Math.round(Math.max(0, Math.min(10, Number(todo.priority))) * 10) / 10
      saveTodos()
    }

    function deleteTodo(todo) {
      const i = data.value.todos.findIndex(t => t._key === todo._key)
      if (i === -1) return
      data.value.todos.splice(i, 1)
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

    // ====== 让编辑中的任务可见 ======
    function isEditing(todo) {
      return editingKey.value === todo._key
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

    function onDrop(catId, targetTodo) {
      if (!isToday.value || !dragKey.value) return
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

    function clearDrag() {
      dragKey.value = null
      dragOverKey.value = null
    }

    // ====== 从昨天继承 ======
    async function carryOver() {
      const res = await fetch('/api/carry-over', { method: 'POST' })
      const d = await res.json()
      data.value.todos = (d.todos || []).map(t => ({
        ...t,
        category: t.category || 'temporary',
        dueDate: t.dueDate || ''
      }))
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
        const res = await fetch('/api/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ earned })
        })
        const result = await res.json()
        if (result.ok) {
          globalData.value.xp = result.xp
          globalData.value.level = result.level
          globalData.value.attributePoints = result.attributePoints
          globalData.value.spins = result.spins
          addToast('✨ +' + earned + ' XP')
          if (result.leveledUp) {
            addToast('🎉 升级！Lv.' + result.level + ' (+3 属性点)')
          }
        }
      }
      saveTodos()
    }

    // ====== 初始化 ======
    onMounted(async () => {
      await loadTodayInfo()
      await Promise.all([
        loadTodos(selectedDate.value),
        loadGlobal(),
        loadDailies()
      ])
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
      grouped, doneCount,
      formatDate, formatDueDate,
      addTodo, startEdit, saveEdit, cancelEdit,
      changePriority, onPrioChange,
      deleteTodo, onDateChange,
      toggleCat, isEditing,
      onDragStart, onDragOver, onDragLeave, onModuleDragOver,
      onDrop, onDropToEnd, onDragEnd,
      addDailyTask, deleteDailyTask,
      carryOver, onTodoToggle
    }
  }
}).mount('#app')
