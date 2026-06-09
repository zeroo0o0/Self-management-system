const { createApp, ref, computed, onMounted, nextTick } = Vue

createApp({
  setup() {
    const data = ref({ todos: [] })
    const newTodo = ref('')
    const newPriority = ref(5)
    const editingKey = ref(null)
    const editText = ref('')
    const toasts = ref([])
    let toastId = 0

    const doneCount = computed(() => data.value.todos.filter(t => t.done).length)

    function sortTodos() {
      data.value.todos.sort((a, b) => {
        const pa = a.priority ?? 0
        const pb = b.priority ?? 0
        return pb - pa
      })
    }

    async function loadData() {
      const res = await fetch('/api/load')
      data.value = await res.json()
      data.value.todos.forEach(t => { if (!t._key) t._key = Date.now() + '_' + Math.random() })
      sortTodos()
    }

    async function saveData() {
      sortTodos()
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.value)
      })
    }

    function addTodo() {
      const text = newTodo.value.trim()
      if (!text) return
      const p = Math.max(0, Math.min(10, newPriority.value ?? 5))
      data.value.todos.push({ _key: Date.now() + '_' + Math.random(), text, done: false, priority: p })
      newTodo.value = ''
      newPriority.value = 5
      saveData()
    }

    // 文字编辑
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
      saveData()
    }

    function cancelEdit() {
      editingKey.value = null
      editText.value = ''
    }

    // 优先级调整
    function changePriority(todo, delta) {
      let v = (todo.priority ?? 5) + delta
      todo.priority = Math.round(Math.max(0, Math.min(10, v)) * 10) / 10
      saveData()
    }

    function onPrioChange(todo) {
      if (todo.priority === '' || todo.priority === null) todo.priority = 0
      todo.priority = Math.round(Math.max(0, Math.min(10, Number(todo.priority))) * 10) / 10
      saveData()
    }

    function deleteTodo(todo) {
      const i = data.value.todos.findIndex(t => t._key === todo._key)
      if (i === -1) return
      data.value.todos.splice(i, 1)
      saveData()
    }

    function clearDone() {
      data.value.todos = data.value.todos.filter(t => !t.done)
      saveData()
    }

    function addToast(text) {
      const id = ++toastId
      toasts.value.push({ id, text })
      setTimeout(() => {
        const i = toasts.value.findIndex(t => t.id === id)
        if (i !== -1) toasts.value.splice(i, 1)
      }, 1600)
    }

    // ========== RPG 经验值联动 ==========
    function gainXP(amount) {
      data.value.xp = (data.value.xp ?? 0) + amount
      data.value.totalXPEarned = (data.value.totalXPEarned ?? 0) + amount
      const threshold = (data.value.level ?? 1) * 100
      if (data.value.xp >= threshold) {
        data.value.xp -= threshold
        data.value.level = (data.value.level ?? 1) + 1
        data.value.attributePoints = (data.value.attributePoints ?? 0) + 3
      }
    }

    function onTodoToggle(todo) {
      if (todo.done) {
        const earned = Math.round((todo.priority ?? 5) * 10)
        const oldLevel = data.value.level ?? 1
        gainXP(earned)
        data.value.spins = (data.value.spins ?? 0) + 1
        addToast('✨ +' + earned + ' XP')
        if ((data.value.level ?? 1) > oldLevel) {
          addToast('🎉 升级！Lv.' + data.value.level + ' (+3 属性点)')
        }
      }
      saveData()
    }

    onMounted(loadData)

    return {
      data, newTodo, newPriority,
      editingKey, editText, toasts,
      doneCount,
      addTodo, startEdit, saveEdit, cancelEdit,
      changePriority, onPrioChange,
      deleteTodo, clearDone, onTodoToggle
    }
  }
}).mount('#app')
