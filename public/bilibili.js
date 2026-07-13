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

    // ====== 已看状态（localStorage） ======
    function getWatchedKey(id) { return '_bili_w_' + id }
    function getWatched(id) {
      try { return JSON.parse(localStorage.getItem(getWatchedKey(id))) || [] } catch { return [] }
    }
    function saveWatched(id, arr) {
      localStorage.setItem(getWatchedKey(id), JSON.stringify(arr))
    }

    const currentWatched = ref([])

    function getVideoId(v) {
      return v.uid || v.bvid
    }

    function isWatched(id) {
      return currentWatched.value.indexOf(id) !== -1
    }

    function toggleWatched(id) {
      const idx = currentWatched.value.indexOf(id)
      if (idx === -1) currentWatched.value.push(id)
      else currentWatched.value.splice(idx, 1)
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
          currentWatched.value = getWatched(existing.id)
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

        // 获取现有待办
        const todosRes = await fetch('/api/todos/' + date)
        const { todos } = await todosRes.json()

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
          body: JSON.stringify({ todos, deepWork: [] })
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
      currentWatched.value = getWatched(course.id)
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
          currentWatched.value = getWatched(courses.value[0].id)
        }
      } catch (e) {
        console.error('加载课程历史失败:', e)
      }
    })

    return {
      url, loading, error, courses, currentCourse,
      sortAsc, sortedVideos, watchedCount, totalTime, videoCount,
      totalSeconds, watchedSeconds, watchedTimeStr, timeProgressPct,
      isWatched, toggleWatched, getVideoId,
      fetchSeries, toggleSort, addToTodo, todoMsg, selectCourse, deleteCourse,
      formatDate
    }
  }
})

app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info)
}

app.mount('#app')
