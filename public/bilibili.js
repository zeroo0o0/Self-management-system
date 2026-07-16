const { createApp, ref, computed, onMounted } = Vue

const app = createApp({
  setup() {
    const url = ref('')
    const loading = ref(false)
    const error = ref('')
    const todoMsg = ref('')
    const courses = ref([])
    const currentCourse = ref(null)
    // ====== 排序状态持久化 ======
    const SORT_KEY = '_bili_sort_asc'
    function loadSort() {
      try { return localStorage.getItem(SORT_KEY) !== 'false' } catch { return true }
    }
    function saveSort(v) {
      localStorage.setItem(SORT_KEY, v ? 'true' : 'false')
    }
    const sortAsc = ref(loadSort())

    // ====== 已看状态（localStorage + 服务端持久化） ======
    function getWatchedKey(id) { return '_bili_w_' + id }
    function getWatched(id, serverWatched) {
      // 优先用服务端数据（跨浏览器同步）
      if (serverWatched && Array.isArray(serverWatched) && serverWatched.length > 0) {
        return serverWatched
      }
      // 降级到 localStorage
      try { return JSON.parse(localStorage.getItem(getWatchedKey(id))) || [] } catch { return [] }
    }
    function saveWatched(id, arr) {
      localStorage.setItem(getWatchedKey(id), JSON.stringify(arr))
      // 同步到服务端（fire-and-forget）
      fetch('/api/bilibili/courses/' + encodeURIComponent(id) + '/watched', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watched: arr })
      }).catch(() => {})
    }

    const currentWatched = ref([])
    // ====== 今日完成统计 ======
    const todayCompleted = ref({ videos: [], totalDuration: 0 })

    async function fetchTodayCompleted() {
      try {
        const res = await fetch('/api/bilibili/daily')
        const data = await res.json()
        todayCompleted.value = data
      } catch (e) {
        console.error('获取今日完成统计失败:', e)
      }
    }

    function getVideoId(v) {
      return v.uid || v.bvid
    }

    function isWatched(id) {
      return currentWatched.value.indexOf(id) !== -1
    }

    function toggleWatched(id) {
      const idx = currentWatched.value.indexOf(id)
      const video = currentCourse.value?.videos.find(v => getVideoId(v) === id)
      if (idx === -1) {
        currentWatched.value.push(id)
        // 记录今日完成
        if (video) {
          fetch('/api/bilibili/daily/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bvid: video.bvid,
              duration: video.duration || 0,
              title: video.title,
              courseName: currentCourse.value.seriesName
            })
          }).then(r => r.json()).then(d => {
            if (d.todayCompleted) todayCompleted.value = d.todayCompleted
          }).catch(() => {})
        }
      } else {
        currentWatched.value.splice(idx, 1)
        // 取消今日完成记录
        if (video) {
          fetch('/api/bilibili/daily/complete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bvid: video.bvid })
          }).then(r => r.json()).then(d => {
            if (d.todayCompleted) todayCompleted.value = d.todayCompleted
          }).catch(() => {})
        }
      }
      saveWatched(currentCourse.value.id, currentWatched.value)
    }

    // ====== 排序 ======
    const sortedVideos = computed(() => {
      if (!currentCourse.value) return []
      const videos = [...currentCourse.value.videos]
      if (!sortAsc.value) videos.reverse()
      return videos
    })

    const watchedCount = computed(() => currentWatched.value.length)

    // ====== 总时长 ======
    const totalSeconds = computed(() => {
      if (!currentCourse.value) return 0
      return currentCourse.value.videos.reduce((s, v) => s + (v.duration || 0), 0)
    })
    const totalTime = computed(() => {
      const secs = totalSeconds.value
      if (!secs) return ''
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      return h + 'h ' + m + 'm'
    })

    // ====== 已看时长 & 进度百分比 ======
    const watchedSeconds = computed(() => {
      if (!currentCourse.value) return 0
      return currentCourse.value.videos
        .filter(v => currentWatched.value.indexOf(v.uid || v.bvid) !== -1)
        .reduce((s, v) => s + (v.duration || 0), 0)
    })
    const watchedTimeStr = computed(() => {
      const secs = watchedSeconds.value
      if (!secs) return '0m'
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm'
    })
    const timeProgressPct = computed(() => {
      if (!totalSeconds.value) return 0
      return Math.min(100, Math.round(watchedSeconds.value / totalSeconds.value * 100))
    })

    const videoCount = computed(() => {
      return currentCourse.value ? currentCourse.value.videos.length : 0
    })

    // ====== 今日完成时长格式化 ======
    const todayDurationStr = computed(() => {
      const secs = todayCompleted.value.totalDuration || 0
      if (!secs) return '0m'
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm'
    })
    const todayVideoCount = computed(() => {
      return todayCompleted.value.videos?.length || 0
    })

    // ====== 获取合集 / 多P视频 ======
    async function fetchSeries() {
      const u = url.value.trim()
      if (!u) return
      error.value = ''
      loading.value = true
      currentCourse.value = null

      // 判断链接类型
      let apiPath
      if (u.includes('space.bilibili.com') && u.includes('/lists/')) {
        apiPath = '/api/bilibili/series'
      } else if (u.match(/bilibili\.com\/video\/(BV\w+)/i)) {
        apiPath = '/api/bilibili/video'
      } else {
        error.value = '无法识别的链接，请使用 Bilibili 合集链接或视频链接'
        loading.value = false
        return
      }

      try {
        const res = await fetch(apiPath + '?url=' + encodeURIComponent(u))
        const data = await res.json()
        if (!data.ok) {
          error.value = data.error
          return
        }

        // 检查是否已导入（匹配 url / seriesId / videoId）
        const existing = courses.value.find(c => c.url === u || c.seriesId === data.seriesId || c.videoId === data.videoId)
        if (existing) {
          currentCourse.value = existing
          currentWatched.value = getWatched(existing.id, existing.watched)
          return
        }

        // 创建新课程
        const courseId = 'bili_' + (data.seriesId || data.videoId) + '_' + Date.now()
        const course = {
          id: courseId,
          seriesId: data.seriesId || '',
          videoId: data.videoId || '',
          seriesName: data.seriesName,
          url: u,
          videos: data.videos,
          createdAt: new Date().toISOString()
        }

        const saveRes = await fetch('/api/bilibili/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(course)
        })
        const saveData = await saveRes.json()
        if (saveData.ok) {
          courses.value.push(course)
          currentCourse.value = course
          currentWatched.value = []
        }
      } catch (e) {
        error.value = '请求失败: ' + e.message
      } finally {
        loading.value = false
      }
    }

    function toggleSort() {
      sortAsc.value = !sortAsc.value
      saveSort(sortAsc.value)
    }

    // ====== 添加到待办 ======
    async function addToTodo(video) {
      todoMsg.value = ''
      try {
        // 获取今天日期
        const todayRes = await fetch('/api/today')
        const { date } = await todayRes.json()
        if (!date) throw new Error('获取日期失败')

        // 获取现有待办（含深度工作记录）
        const todosRes = await fetch('/api/todos/' + date)
        const { todos, deepWork } = await todosRes.json()

        // 构造新待办
        const newTodo = {
          _key: Date.now() + '_' + Math.random(),
          text: video.title,
          done: false,
          category: 'important',
          priority: 5,
          dueDate: ''
        }
        todos.push(newTodo)

        // 写回
        await fetch('/api/todos/' + date, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ todos, deepWork: deepWork || [] })
        })

        todoMsg.value = '✅ 已添加到待办'
        setTimeout(() => { todoMsg.value = '' }, 2500)
      } catch (e) {
        todoMsg.value = '❌ 添加失败: ' + e.message
        setTimeout(() => { todoMsg.value = '' }, 3000)
      }
    }

    // ====== 选择历史课程 ======
    function selectCourse(course) {
      // 确保所有视频有 uid（兼容旧数据）
      if (course.videos) {
        course.videos = course.videos.map(v => ({ ...v, uid: v.uid || v.bvid }))
      }
      currentCourse.value = course
      currentWatched.value = getWatched(course.id, course.watched)
      url.value = course.url
    }

    // ====== 删除课程 ======
    async function deleteCourse(course) {
      if (!confirm('确定删除「' + course.seriesName + '」的导入记录？')) return
      try {
        const res = await fetch('/api/bilibili/courses/' + encodeURIComponent(course.id), {
          method: 'DELETE'
        })
        const data = await res.json()
        if (data.ok) {
          const idx = courses.value.indexOf(course)
          if (idx !== -1) courses.value.splice(idx, 1)
          if (currentCourse.value === course) {
            currentCourse.value = null
            currentWatched.value = []
          }
        }
      } catch (e) {
        console.error('删除失败:', e)
      }
    }

    // ====== 日期格式化 ======
    function formatDate(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    }

    // ====== 初始化 ======
    onMounted(async () => {
      try {
        const res = await fetch('/api/bilibili/courses')
        const data = await res.json()
        courses.value = data.courses || []
        // 确保所有历史课程视频都有 uid（兼容旧数据）
        courses.value.forEach(c => {
          if (c.videos) c.videos = c.videos.map(v => ({ ...v, uid: v.uid || v.bvid }))
        })
        // 自动选中第一个课程
        if (courses.value.length > 0) {
          currentCourse.value = courses.value[0]
          currentWatched.value = getWatched(courses.value[0].id, courses.value[0].watched)
        }
        // 获取今日完成统计
        await fetchTodayCompleted()
        // 获取学习历史
        await fetchHistory()
      } catch (e) {
        console.error('加载课程历史失败:', e)
      }
    })

    // ====== 学习历史柱状图 ======
    const historyData = ref([])
    const historyRange = ref('week')

    async function fetchHistory() {
      try {
        const res = await fetch('/api/bilibili/daily/history?range=' + historyRange.value)
        const data = await res.json()
        historyData.value = data
      } catch (e) {
        console.error('获取学习历史失败:', e)
      }
    }

    function switchRange(range) {
      historyRange.value = range
      fetchHistory()
    }

    const maxDailyHours = computed(() => {
      const max = Math.max(...historyData.value.map(d => d.totalDuration), 0)
      return Math.max(Math.ceil(max / 7200), 1)  // 至少 1，向上取 2h 整
    })

    const gridLines = computed(() => {
      const lines = []
      for (let h = 0; h <= maxDailyHours.value * 7200; h += 7200) {
        lines.push(h)
      }
      return lines
    })

    function barStyle(item) {
      const maxSecs = maxDailyHours.value * 7200
      const pct = maxSecs > 0 ? (item.totalDuration / maxSecs) * 100 : 0
      return { height: Math.max(pct, 0.5) + '%' }
    }

    function formatBarDate(item) {
      const parts = item.date.split('-')
      return parts[1] + '/' + parts[2]
    }

    function formatBarLabel(secs) {
      if (!secs) return '0'
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      return h > 0 ? h + 'h' + (m > 0 ? m + 'm' : '') : m + 'm'
    }

    return {
      url, loading, error, courses, currentCourse,
      sortAsc, sortedVideos, watchedCount, totalTime, videoCount,
      totalSeconds, watchedSeconds, watchedTimeStr, timeProgressPct,
      todayCompleted, todayDurationStr, todayVideoCount,
      isWatched, toggleWatched, getVideoId,
      fetchSeries, toggleSort, addToTodo, todoMsg, selectCourse, deleteCourse,
      formatDate,
      // 图表
      historyData, historyRange, gridLines, maxDailyHours,
      fetchHistory, switchRange, barStyle, formatBarDate, formatBarLabel
    }
  }
})

app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info)
}

app.mount('#app')
