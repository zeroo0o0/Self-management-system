const { createApp, ref, computed, onMounted, nextTick } = Vue

createApp({
  setup() {
    // ====== 状态 ======
    const data = ref({ todos: [] })
    const globalData = ref({})
    const dailies = ref({ tasks: [] })
    const selectedDate = ref('')
    const today = ref('')
    const newTodo = ref('')
    const newPriority = ref(5)
    const newDailyText = ref('')
    const newDailyPriority = ref(5)
    const editingKey = ref(null)
    const editText = ref('')
    const toasts = ref([])
    const importedDailies = ref(false)
    const dailiesOpen = ref(false)
    let toastId = 0

    const isToday = computed(() => selectedDate.value === today.value)
    const canCarryOver = computed(() => {
      return isToday.value
    })

    const doneCount = computed(() => data.value.todos.filter(t => t.done).length)

    // ====== 工具函数 ======
    function formatDate(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr + 'T00:00:00')
      const weekdays = ['日', '一', '二', '三', '四', '五', '六']
      return `${dateStr} 周${weekdays[d.getDay()]}`
    }

    function sortTodos() {
      data.value.todos.sort((a, b) => {
        return (b.priority ?? 0) - (a.priority ?? 0)
      })
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

    async function loadDailies() {
      const res = await fetch('/api/dailies')
      dailies.value = await res.json()
    }

    async function loadTodos(dateStr) {
      const res = await fetch(`/api/todos/${dateStr}`)
      const d = await res.json()
      data.value.todos = d.todos || []
      importedDailies.value = d.importedFromDailies || false
      // 如果导入了日常任务，展开日常任务区
      if (d.importedFromDailies) {
        dailiesOpen.value = false
      }
      sortTodos()
    }

    async function saveTodos() {
      sortTodos()
      await fetch(`/api/todos/${selectedDate.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: data.value.todos })
      })
    }

    async function saveDailies() {
      await fetch('/api/dailies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: dailies.value.tasks })
      })
    }

    // ====== 日期切换 ======
    function onDateChange() {
      if (selectedDate.value) {
        loadTodos(selectedDate.value)
      }
    }

    // ====== 待办 CRUD ======
    function addTodo() {
      const text = newTodo.value.trim()
      if (!text) return
      const p = Math.max(0, Math.min(10, newPriority.value ?? 5))
      data.value.todos.push({
        _key: Date.now() + '_' + Math.random(),
        text,
        done: false,
        priority: p
      })
      newTodo.value = ''
      newPriority.value = 5
      saveTodos()
    }

    function startEdit(todo) {
      editingKey.value = todo._key
      editText.value = todo.text
      nextTick(() => {
        const el = document.querySelector('.edit-input')
        if (el) { el.focus(); el.select() }
      })
    }

    function saveEdit(todo) {
      if (editingKey.value !== todo._key) return
      const t = editText.value.trim()
      if (t) todo.text = t
      editingKey.value = null
      editText.value = ''
      saveTodos()
    }

    function cancelEdit() {
      editingKey.value = null
      editText.value = ''
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

    // ====== 日常任务 CRUD ======
    function addDailyTask() {
      const text = newDailyText.value.trim()
      if (!text) return
      const p = Math.max(0, Math.min(10, newDailyPriority.value ?? 5))
      dailies.value.tasks.push({ text, priority: p })
      newDailyText.value = ''
      newDailyPriority.value = 5
      saveDailies()
    }

    function deleteDailyTask(index) {
      dailies.value.tasks.splice(index, 1)
      saveDailies()
    }

    function importDailiesNow() {
      const tasks = dailies.value.tasks.map(t => ({
        _key: Date.now() + '_' + Math.random(),
        text: t.text,
        done: false,
        priority: t.priority ?? 5
      }))
      data.value.todos.push(...tasks)
      saveTodos()
      addToast('📋 已导入 ' + tasks.length + ' 项日常任务')
    }

    // ====== 从昨天继承 ======
    async function carryOver() {
      const res = await fetch('/api/carry-over', { method: 'POST' })
      const d = await res.json()
      data.value.todos = d.todos || []
      sortTodos()
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
        const oldLevel = globalData.value.level ?? 1

        // 调用 XP 接口
        const res = await fetch('/api/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ earned })
        })
        const result = await res.json()

        if (result.ok) {
          // 更新本地 globalData
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
      data, globalData, dailies,
      selectedDate, today, isToday, canCarryOver, importedDailies, dailiesOpen,
      newTodo, newPriority,
      newDailyText, newDailyPriority,
      editingKey, editText, toasts,
      doneCount,
      formatDate,
      addTodo, startEdit, saveEdit, cancelEdit,
      changePriority, onPrioChange,
      deleteTodo,
      onDateChange,
      addDailyTask, deleteDailyTask, importDailiesNow,
      carryOver,
      onTodoToggle
    }
  }
}).mount('#app')
