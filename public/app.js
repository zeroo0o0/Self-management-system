const { createApp, ref, watch, onMounted } = Vue

createApp({
  setup() {
    const data = ref({ todos: [] })
    const newTodo = ref('')
    const editing = ref(false)

    // 加载数据
    async function loadData() {
      const res = await fetch('/api/load')
      data.value = await res.json()
    }

    // 保存数据
    async function saveData() {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.value)
      })
    }

    // 增删改查
    function addTodo() {
      const text = newTodo.value.trim()
      if (!text) return
      data.value.todos.push({ text, done: false })
      newTodo.value = ''
      saveData()
    }

    function deleteTodo(index) {
      data.value.todos.splice(index, 1)
      saveData()
    }

    // 自动保存（状态变化时）
    watch(data, saveData, { deep: true })

    onMounted(loadData)

    return { data, newTodo, editing, loadData, addTodo, deleteTodo }
  }
}).mount('#app')
