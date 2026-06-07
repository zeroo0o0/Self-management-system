const { createApp, ref, computed, onMounted } = Vue

createApp({
  setup() {
    const data = ref({ spins: 0, rewards: [] })
    const wheelRotation = ref(0)
    const spinning = ref(false)
    const lastResult = ref(null)

    const segments = [
      { icon: '💫', label: '+5 XP',   desc: '获得 5 点经验值', color: '#ff6b6b' },
      { icon: '🌟', label: '+10 XP',  desc: '获得 10 点经验值', color: '#feca57' },
      { icon: '💎', label: '+1 属性', desc: '获得 1 个属性点', color: '#48dbfb' },
      { icon: '✨', label: '+20 XP',  desc: '获得 20 点经验值', color: '#ff9ff3' },
      { icon: '🍀', label: '再转一次', desc: '额外获得一次抽奖', color: '#54a0ff' },
      { icon: '⚡', label: '+15 XP',  desc: '获得 15 点经验值', color: '#26de81' },
      { icon: '🎯', label: '+1 属性', desc: '获得 1 个属性点', color: '#fd9644' },
      { icon: '💫', label: '+5 XP',   desc: '获得 5 点经验值', color: '#a55eea' },
    ]

    const segAngle = 360 / segments.length

    // 为转盘生成 conic-gradient
    const wheelBg = computed(() => {
      let stops = []
      segments.forEach((seg, i) => {
        const from = i * segAngle
        const to = (i + 1) * segAngle
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

      // 随机目标
      const targetSeg = Math.floor(Math.random() * segments.length)
      const randomOffset = (Math.random() - 0.5) * segAngle * 0.6  // 段内随机偏移
      const targetWheelAngle = targetSeg * segAngle + segAngle / 2 + randomOffset
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
      // 应用奖励
      let msg = ''
      if (reward.label === '+5 XP') { gainXP(5); msg = '+5 XP' }
      else if (reward.label === '+10 XP') { gainXP(10); msg = '+10 XP' }
      else if (reward.label === '+15 XP') { gainXP(15); msg = '+15 XP' }
      else if (reward.label === '+20 XP') { gainXP(20); msg = '+20 XP' }
      else if (reward.label === '+1 属性') {
        data.value.attributePoints = (data.value.attributePoints ?? 0) + 1
        msg = '+1 属性点'
      }
      else if (reward.label === '再转一次') {
        data.value.spins = (data.value.spins ?? 0) + 1
        msg = '再转一次'
      }

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

    async function loadData() {
      const res = await fetch('/api/load')
      const d = await res.json()
      data.value = d
      if (data.value.spins === undefined) data.value.spins = 0
      if (!data.value.rewards) data.value.rewards = []
      if (data.value.xp === undefined) data.value.xp = 0
      if (data.value.level === undefined) data.value.level = 1
      if (data.value.attributePoints === undefined) data.value.attributePoints = 0
      if (data.value.totalXPEarned === undefined) data.value.totalXPEarned = 0
      if (!data.value.attributes) data.value.attributes = { strength: 0, intelligence: 0, endurance: 0, spirit: 0 }
    }

    async function saveData() {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.value)
      })
    }

    onMounted(loadData)

    return {
      data, segments, segAngle, wheelBg, wheelRotation,
      spinning, lastResult, rewards,
      spin
    }
  }
}).mount('#app')
