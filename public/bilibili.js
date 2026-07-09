const { createApp, ref, computed, onMounted } = Vue

const app = createApp({
  setup() {
    const url = ref('')
    const loading = ref(false)
    const error = ref('')
    const courses = ref([])
    const currentCourse = ref(null)
    const sortAsc = ref(true)

    // ====== 已看状态（localStorage） ======
    function getWatchedKey(id) { return '_bili_w_' + id }
    function getWatched(id) {
      try { return JSON.parse(localStorage.getItem(getWatchedKey(id))) || [] } catch { return [] }
    }
    function saveWatched(id, arr) {
      localStorage.setItem(getWatchedKey(id), JSON.stringify(arr))
    }

    const currentWatched = ref([])

    function isWatched(bvid) {
      return currentWatched.value.indexOf(bvid) !== -1
    }

    function toggleWatched(bvid) {
      const idx = currentWatched.value.indexOf(bvid)
      if (idx === -1) currentWatched.value.push(bvid)
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
        .filter(v => currentWatched.value.indexOf(v.bvid) !== -1)
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

    // ====== 获取合集 ======
    async function fetchSeries() {
      const u = url.value.trim()
      if (!u) return
      error.value = ''
      loading.value = true
      currentCourse.value = null
      try {
        const res = await fetch('/api/bilibili/series?url=' + encodeURIComponent(u))
        const data = await res.json()
        if (!data.ok) {
          error.value = data.error
          return
        }

        // 检查是否已导入
        const existing = courses.value.find(c => c.url === u || c.seriesId === data.seriesId)
        if (existing) {
          currentCourse.value = existing
          currentWatched.value = getWatched(existing.id)
          return
        }

        // 创建新课程
        const course = {
          id: 'bili_' + data.seriesId + '_' + Date.now(),
          seriesId: data.seriesId,
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
    }

    // ====== 选择历史课程 ======
    function selectCourse(course) {
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
      isWatched, toggleWatched,
      fetchSeries, toggleSort, selectCourse, deleteCourse,
      formatDate
    }
  }
})

app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info)
}

app.mount('#app')
