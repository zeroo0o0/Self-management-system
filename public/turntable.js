const { createApp, ref, computed, onMounted } = Vue

createApp({
  setup() {
    const data = ref({ spins: 0, rewards: [] })
    const wheelRotation = ref(0)
    const spinning = ref(false)
    const lastResult = ref(null)

    const segments = [
      { icon: '🍟', label: '黄金薯条', desc: '香脆黄金粗薯', color: '#ff6b6b', angle: 55 },
      { icon: '🧋', label: '奶茶',     desc: '香浓奶茶',      color: '#d4a574', angle: 55 },
      { icon: '🧀', label: '芝士薯条', desc: '浓郁芝士酱薯条', color: '#feca57', angle: 55 },
      { icon: '🌶️', label: '香辣薯条', desc: '火辣辣脆薯',   color: '#48dbfb', angle: 55 },
      { icon: '🥔', label: '松露薯角', desc: '松露风味三角薯', color: '#ff9ff3', angle: 55 },
      { icon: '🍠', label: '红薯条',   desc: '甜糯蜜薯条',    color: '#54a0ff', angle: 55 },
      { icon: '💪', label: '再接再厉', desc: '下次一定！',    color: '#a55eea', angle: 30 },
    ]

    // 计算每个扇区的起始角度（支持不等宽扇区）
    const segmentsWithOffset = computed(() => {
      let start = 0
      return segments.map(seg => {
        const s = { ...seg, startAngle: start }
        start += seg.angle
        return s
      })
    })

    // 为转盘生成 conic-gradient
    const wheelBg = computed(() => {
      let stops = []
      segmentsWithOffset.value.forEach(seg => {
        const from = seg.startAngle
        const to = seg.startAngle + seg.angle
        stops.push(seg.color + ' ' + from + 'deg ' + to + 'deg')
      })
      return 'conic-gradient(' + stops.join(', ') + ')'
    })

    // 最近奖励历史 (取最近 20 条)
    const rewards = computed(() => {
      return (data.value.rewards ?? []).slice().reverse().slice(0, 20)
    })

    function spin() {
      if (spinning.value || (data.value.spins ?? 0) <= 0) return

      spinning.value = true
      data.value.spins--

      // 随机目标（支持不等宽扇区）
      const segArr = segmentsWithOffset.value
      const targetSeg = Math.floor(Math.random() * segments.length)
      const seg = segArr[targetSeg]
      const randomOffset = (Math.random() - 0.5) * seg.angle * 0.6  // 段内随机偏移
      const targetWheelAngle = seg.startAngle + seg.angle / 2 + randomOffset
      const spinAngle = (360 - (targetWheelAngle % 360)) % 360
      const fullSpins = 360 * (5 + Math.floor(Math.random() * 4))
      const totalRotation = fullSpins + spinAngle

      wheelRotation.value = totalRotation

      // 等待动画结束后处理结果
      setTimeout(() => {
        const reward = segments[targetSeg]
        applyReward(reward)
        spinning.value = false
      }, 4200)
    }

    function applyReward(reward) {
      // 记录抽奖历史
      const history = data.value.rewards ?? []
      history.push({
        icon: reward.icon,
        label: reward.label,
        time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      })
      data.value.rewards = history

      // 显示结果
      lastResult.value = reward
      saveData()
    }

    async function loadData() {
      const res = await fetch('/api/load')
      const d = await res.json()
      data.value = d
      if (data.value.spins === undefined) data.value.spins = 0
      if (!data.value.rewards) data.value.rewards = []
    }

    async function saveData() {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.value)
      })
    }

    // 计算每个扇区上标签的位置（径向排列，避免重叠）
    function labelStyle(seg) {
      const midAngle = seg.startAngle + seg.angle / 2
      const rad = midAngle * Math.PI / 180
      const r = 38 // 距中心百分比（靠近中心一些，文字沿径向向外延伸）
      const x = 50 + Math.sin(rad) * r
      const y = 50 - Math.cos(rad) * r
      // 沿径向旋转，下半部分翻转避免倒置
      const rotation = (midAngle > 90 && midAngle < 270) ? midAngle - 180 : midAngle
      return {
        left: x + '%',
        top: y + '%',
        transform: 'translate(-50%, -50%) rotate(' + rotation + 'deg)',
      }
    }

    onMounted(loadData)

    return {
      data, segments, segmentsWithOffset, wheelBg, wheelRotation,
      spinning, lastResult, rewards,
      labelStyle,
      spin
    }
  }
}).mount('#app')
