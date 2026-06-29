const { createApp, ref, computed, onMounted, nextTick } = Vue

const CATEGORY_META = {
  daily:     { label: '每日任务', icon: '📆', color: '#4CAF50' },
  urgent:    { label: '重要且紧急', icon: '🔔', color: '#9C27B0' },
  temporary: { label: '紧急不重要', icon: '⚡', color: '#FF9800' },
  deadline:  { label: '近期DDL',  icon: '🔥', color: '#F44336' },
  longterm:  { label: '长期任务',  icon: '🌳', color: '#2196F3' },
}

createApp({
  setup() {
    const globalData = ref(null)
    const weekData = ref([])
    const loading = ref(true)
    let chartInstances = []

    // 生成最近 7 天的日期数组
    const weekDates = computed(() => {
      const dates = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        dates.push(`${y}-${m}-${day}`)
      }
      return dates
    })

    // 每日统计
    const dailyStats = computed(() => {
      return weekData.value.map(day => {
        const total = day.todos.length
        const done = day.todos.filter(t => t.done).length
        const xpEarned = day.todos
          .filter(t => t.done)
          .reduce((sum, t) => sum + Math.round((t.priority || 0) * 10), 0)
        return {
          date: day.date,
          total,
          done,
          xpEarned,
          rate: total > 0 ? Math.round(done / total * 100) : 0,
        }
      })
    })

    // 汇总
    const totalCompleted = computed(() =>
      dailyStats.value.reduce((s, d) => s + d.done, 0)
    )
    const totalXPWeek = computed(() =>
      dailyStats.value.reduce((s, d) => s + d.xpEarned, 0)
    )
    const avgRate = computed(() => {
      const total = dailyStats.value.reduce((s, d) => s + d.total, 0)
      const done = dailyStats.value.reduce((s, d) => s + d.done, 0)
      return total > 0 ? Math.round(done / total * 100) : 0
    })

    // 深度工作统计
    const deepWorkStats = computed(() => {
      return weekData.value.map(day => {
        const entries = day.deepWork || []
        const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0)
        return {
          date: day.date,
          entries,
          totalMinutes,
          hours: Math.round(totalMinutes / 60 * 10) / 10,
        }
      })
    })
    const totalDeepWorkMinutes = computed(() =>
      deepWorkStats.value.reduce((s, d) => s + d.totalMinutes, 0)
    )

    // 分类统计
    const categoryStats = computed(() => {
      const allTodos = weekData.value.flatMap(d => d.todos)
      const cats = {}
      allTodos.forEach(t => {
        const cat = t.category || 'temporary'
        if (!cats[cat]) cats[cat] = { total: 0, done: 0 }
        cats[cat].total++
        if (t.done) cats[cat].done++
      })
      // 转成数组并补充元信息
      return Object.entries(cats).map(([key, val]) => ({
        key,
        ...val,
        ...(CATEGORY_META[key] || { label: key, icon: '📋', color: '#999' }),
        rate: val.total > 0 ? Math.round(val.done / val.total * 100) : 0,
      }))
    })

    // 可用属性点
    const availablePoints = computed(() => globalData.value?.attributePoints ?? 0)

    // 格式化日期为短标签（如 "06/17"）
    function shortDate(dateStr) {
      const parts = dateStr.split('-')
      return parts[1] + '/' + parts[2]
    }

    // 获取指定日期的深度工作统计
    function getDwForDate(dateStr) {
      return deepWorkStats.value.find(d => d.date === dateStr) || { totalMinutes: 0, hours: 0 }
    }

    // ========== 加载数据 ==========

    async function loadData() {
      loading.value = true
      try {
        const globalRes = await fetch('/api/global')
        globalData.value = await globalRes.json()

        // 并行加载 7 天待办数据
        const dayPromises = weekDates.value.map(async date => {
          const res = await fetch(`/api/todos/${date}`)
          const data = await res.json()
          return { date, todos: data.todos || [], deepWork: data.deepWork || [] }
        })
        weekData.value = await Promise.all(dayPromises)

        await nextTick()
        renderCharts()
      } catch (e) {
        console.error('加载统计数据失败:', e)
      }
      loading.value = false
    }

    // ========== Chart.js 图表 ==========

    function renderCharts() {
      // 销毁旧图表
      chartInstances.forEach(c => c.destroy())
      chartInstances = []

      const days = dailyStats.value.map(d => shortDate(d.date))
      const doneCounts = dailyStats.value.map(d => d.done)
      const xpCounts = dailyStats.value.map(d => d.xpEarned)
      const dwHours = deepWorkStats.value.map(d => d.hours)

      // 任务完成趋势图
      const ctx1 = document.getElementById('chart-tasks')
      if (ctx1) {
        chartInstances.push(new Chart(ctx1, {
          type: 'bar',
          data: {
            labels: days,
            datasets: [{
              label: '完成任务',
              data: doneCounts,
              backgroundColor: doneCounts.map(v =>
                v > 0 ? 'rgba(79, 70, 229, 0.75)' : 'rgba(200, 200, 200, 0.4)'
              ),
              borderColor: 'rgba(79, 70, 229, 1)',
              borderWidth: 1,
              borderRadius: 4,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { stepSize: 1, precision: 0 },
                grid: { color: 'rgba(0,0,0,0.05)' },
              },
              x: {
                grid: { display: false },
              }
            }
          }
        }))
      }

      // XP 趋势图
      const ctx2 = document.getElementById('chart-xp')
      if (ctx2) {
        chartInstances.push(new Chart(ctx2, {
          type: 'bar',
          data: {
            labels: days,
            datasets: [{
              label: '获得 XP',
              data: xpCounts,
              backgroundColor: xpCounts.map(v =>
                v > 0 ? 'rgba(102, 126, 234, 0.75)' : 'rgba(200, 200, 200, 0.4)'
              ),
              borderColor: 'rgba(102, 126, 234, 1)',
              borderWidth: 1,
              borderRadius: 4,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { precision: 0 },
                grid: { color: 'rgba(0,0,0,0.05)' },
              },
              x: {
                grid: { display: false },
              }
            }
          }
        }))
      }

      // 深度工作时间图
      const ctx3 = document.getElementById('chart-deepwork')
      if (ctx3) {
        chartInstances.push(new Chart(ctx3, {
          type: 'bar',
          data: {
            labels: days,
            datasets: [{
              label: '深度学习',
              data: dwHours.map(h => Math.round(h * 10) / 10),
              backgroundColor: dwHours.map(v =>
                v > 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(200, 200, 200, 0.4)'
              ),
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
              borderRadius: 4,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: {
                beginAtZero: true,
                title: { display: true, text: '小时' },
                grid: { color: 'rgba(0,0,0,0.05)' },
              },
              x: {
                grid: { display: false },
              }
            }
          }
        }))
      }
    }

    onMounted(loadData)

    return {
      globalData, loading,
      weekDates, dailyStats, totalCompleted, totalXPWeek, avgRate,
      categoryStats, availablePoints,
      deepWorkStats, totalDeepWorkMinutes,
      shortDate, getDwForDate, CATEGORY_META,
    }
  }
}).mount('#app')
