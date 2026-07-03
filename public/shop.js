const { createApp, ref, computed, onMounted } = Vue

// 奖励池
const REWARD_POOL = [
  { icon: '🎮', name: '游戏时间', desc: '奖励自己30分钟游戏', cost: 3 },
  { icon: '📺', name: '追剧1h', desc: '看一集喜欢的剧', cost: 5 },
  { icon: '🍕', name: '外卖自由', desc: '点一顿想吃的外卖', cost: 8 },
  { icon: '☕', name: '咖啡奖励', desc: '去喝杯好咖啡', cost: 2 },
  { icon: '🍰', name: '甜品时间', desc: '吃块小蛋糕犒劳自己', cost: 3 },
  { icon: '🛏️', name: '赖床券', desc: '明天多睡30分钟', cost: 4 },
  { icon: '📚', name: '沉浸阅读', desc: '沉浸式阅读1小时', cost: 2 },
  { icon: '🎵', name: '音乐时光', desc: '听一整张喜欢的专辑', cost: 1 },
  { icon: '🚶', name: '散步放空', desc: '出门散步不思考工作', cost: 1 },
  { icon: '🎬', name: '电影之夜', desc: '看一部收藏的电影', cost: 10 },
  { icon: '🛀', name: '泡澡放松', desc: '好好泡个澡放空', cost: 4 },
  { icon: '🧘', name: '冥想15min', desc: '放空大脑静下心来', cost: 1 },
  { icon: '🎂', name: '蛋糕自由', desc: '买一块喜欢的蛋糕', cost: 6 },
  { icon: '🎨', name: '创作时光', desc: '做点手工或画画', cost: 3 },
  { icon: '🌿', name: '公园散步', desc: '去公园呼吸新鲜空气', cost: 2 },
  { icon: '🎪', name: '特别活动', desc: '安排一次特别的小活动', cost: 15 },
  { icon: '📱', name: '刷手机30min', desc: '毫无负罪感地刷手机', cost: 2 },
  { icon: '🎲', name: '桌游时间', desc: '和家人朋友玩桌游', cost: 5 },
]

createApp({
  setup() {
    const globalData = ref({})
    const shopItems = ref([])
    const purchasedHistory = ref([])
    const loading = ref(true)
    const toastMsg = ref('')

    // 当前积分
    const points = computed(() => Math.round((globalData.value.points ?? 0) * 10) / 10)
    const totalEarned = computed(() => Math.round((globalData.value.totalPointsEarned ?? 0) * 10) / 10)

    // 随机选取 6 个商品（每次打开刷新）
    function refreshItems() {
      const shuffled = [...REWARD_POOL].sort(() => Math.random() - 0.5)
      shopItems.value = shuffled.slice(0, 6)
    }

    // 加载数据
    async function loadData() {
      loading.value = true
      try {
        const res = await fetch('/api/global')
        globalData.value = await res.json()
        refreshItems()

        // 从 localStorage 加载购买记录
        const saved = localStorage.getItem('_shop_purchased')
        purchasedHistory.value = saved ? JSON.parse(saved) : []
      } catch (e) {
        console.error('加载数据失败:', e)
      }
      loading.value = false
    }

    async function buyItem(item) {
      if (points.value < item.cost) {
        showToast('❌ 积分不足！')
        return
      }
      const res = await fetch('/api/points/spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: item.cost })
      })
      const result = await res.json()
      if (result.ok) {
        globalData.value.points = result.points
        // 记录购买
        const record = {
          ...item,
          boughtAt: new Date().toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        }
        purchasedHistory.value.unshift(record)
        localStorage.setItem('_shop_purchased', JSON.stringify(purchasedHistory.value))
        showToast('🎉 兑换成功！' + item.icon + ' ' + item.name)
        // 从货架移除
        const idx = shopItems.value.findIndex(si => si.name === item.name && si.cost === item.cost)
        if (idx !== -1) shopItems.value.splice(idx, 1)
        // 如果货架空了，刷新
        if (shopItems.value.length === 0) {
          setTimeout(() => refreshItems(), 500)
        }
      } else {
        showToast('❌ ' + (result.error || '兑换失败'))
      }
    }

    // 刷新商品
    function onRefresh() {
      refreshItems()
      showToast('🔄 商品已刷新')
    }

    let toastTimer = null
    function showToast(msg) {
      toastMsg.value = msg
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
    }

    onMounted(loadData)

    return {
      globalData, shopItems, purchasedHistory, loading,
      points, totalEarned, toastMsg,
      buyItem, onRefresh, refreshItems
    }
  }
}).mount('#app')
