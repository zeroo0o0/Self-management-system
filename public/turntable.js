const { createApp, ref, computed, onMounted, nextTick } = Vue

createApp({
  setup() {
    const data = ref({ spins: 0, rewards: [] })
    const wheelRotation = ref(0)
    const spinning = ref(false)
    const lastResult = ref(null)
    const showConfetti = ref(false)

    // 可配置的奖励槽位（从服务器加载）
    const rewardSlots = ref([])
    const loaded = ref(false)

    // 从百分比计算角度
    const segments = computed(() => {
      const slots = rewardSlots.value
      if (!slots.length) return []
      const totalPct = slots.reduce((s, sl) => s + (sl.pct || 0), 0) || 100
      return slots.map(sl => ({
        icon: sl.icon,
        label: sl.label,
        desc: sl.desc || '',
        color: sl.color,
        angle: (sl.pct / totalPct) * 360
      }))
    })

    // 计算每个扇区的起始角度
    const segmentsWithOffset = computed(() => {
      let start = 0
      return segments.value.map(seg => {
        const s = { ...seg, startAngle: start }
        start += seg.angle
        return s
      })
    })

    // 是否可以抽奖（已加载且有次数）
    const canSpin = computed(() => {
      return !spinning.value && (data.value.spins ?? 0) > 0 && segments.value.length > 0
    })

    // 为转盘生成 conic-gradient（含扇区分隔白线）
    const wheelBg = computed(() => {
      if (segmentsWithOffset.value.length === 0) return '#e0e0e0'
      let stops = []
      const DIV = 0.6  // 白线半宽（deg）
      segmentsWithOffset.value.forEach(seg => {
        const from = seg.startAngle
        const to = seg.startAngle + seg.angle
        // 每个扇区：左白线 → 主色 → 右白线
        stops.push('#fff ' + Math.max(0, from - DIV) + 'deg')
        stops.push('#fff ' + (from + DIV) + 'deg')
        stops.push(seg.color + ' ' + (from + DIV) + 'deg')
        stops.push(seg.color + ' ' + (to - DIV) + 'deg')
        stops.push('#fff ' + (to - DIV) + 'deg')
        stops.push('#fff ' + (to + DIV) + 'deg')
      })
      return 'conic-gradient(' + stops.join(', ') + ')'
    })

    // 最近奖励历史 (取最近 20 条)
    const rewards = computed(() => {
      return (data.value.rewards ?? []).slice().reverse().slice(0, 20)
    })

    // ========== 加权随机选择 ==========
    function pickWeightedSlot() {
      const slots = rewardSlots.value
      if (!slots.length) return 0
      const totalPct = slots.reduce((s, sl) => s + (sl.pct || 0), 0)
      let r = Math.random() * totalPct
      for (let i = 0; i < slots.length; i++) {
        r -= (slots[i].pct || 0)
        if (r <= 0) return i
      }
      return slots.length - 1
    }

    function spin() {
      if (spinning.value || (data.value.spins ?? 0) <= 0) return

      spinning.value = true
      data.value.spins--

      // 加权随机选择
      const segArr = segmentsWithOffset.value
      const targetIdx = pickWeightedSlot()
      const seg = segArr[targetIdx]
      const randomOffset = (Math.random() - 0.5) * seg.angle * 0.6
      const targetWheelAngle = seg.startAngle + seg.angle / 2 + randomOffset
      const spinAngle = (360 - (targetWheelAngle % 360)) % 360
      const fullSpins = 360 * (5 + Math.floor(Math.random() * 4))
      const totalRotation = fullSpins + spinAngle

      wheelRotation.value = totalRotation

      setTimeout(() => {
        const reward = segments.value[targetIdx]
        applyReward(reward)
        spinning.value = false
      }, 4200)
    }

    function applyReward(reward) {
      const history = data.value.rewards ?? []
      history.push({
        icon: reward.icon,
        label: reward.label,
        time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      })
      data.value.rewards = history

      lastResult.value = reward

      // 中奖撒花（"再接再厉"不触发）
      if (reward.label !== '再接再厉') {
        showConfetti.value = true
        setTimeout(() => { showConfetti.value = false }, 2500)
      }

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

    // ========== 加载奖励配置 ==========
    async function loadRewardSlots() {
      const res = await fetch('/api/reward-slots')
      const d = await res.json()
      rewardSlots.value = (d.slots || []).map(s => ({ ...s }))
      loaded.value = true
    }

    // ========== 设置弹窗 ==========
    const showSettings = ref(false)

    // 编辑中的副本
    const editSlots = ref([])

    function openSettings() {
      // 深拷贝当前配置到编辑区
      editSlots.value = rewardSlots.value.map(s => ({ ...s }))
      showSettings.value = true
    }

    function closeSettings() {
      showSettings.value = false
    }

    function addSlot() {
      if (editSlots.value.length >= 12) return
      editSlots.value.push({
        icon: '🎁',
        label: '新奖励',
        desc: '新奖励描述',
        color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
        pct: 10
      })
    }

    function removeSlot(idx) {
      if (editSlots.value.length <= 2) return
      editSlots.value.splice(idx, 1)
    }

    async function saveRewardSlots() {
      // 校验百分比：允许用户自己控制，不强制总和为100
      const slots = editSlots.value.map(s => ({
        icon: s.icon || '🎁',
        label: s.label || '未命名',
        desc: s.desc || '',
        color: s.color || '#999',
        pct: Math.max(0.1, Math.min(100, s.pct || 10))
      }))
      const res = await fetch('/api/reward-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots })
      })
      const d = await res.json()
      if (d.ok) {
        rewardSlots.value = slots
        // 重置转盘旋转（避免旧角度残留）
        wheelRotation.value = 0
        closeSettings()
      } else {
        alert('保存失败: ' + (d.error || '未知错误'))
      }
    }

    // ========== 标签位置计算 ==========
    function labelStyle(seg) {
      const midAngle = seg.startAngle + seg.angle / 2
      const rad = midAngle * Math.PI / 180
      const r = 38
      const x = 50 + Math.sin(rad) * r
      const y = 50 - Math.cos(rad) * r
      const rotation = (midAngle > 90 && midAngle < 270) ? midAngle - 180 : midAngle
      return {
        left: x + '%',
        top: y + '%',
        transform: 'translate(-50%, -50%) rotate(' + rotation + 'deg)',
      }
    }

    // ========== 撒花粒子样式 ==========
    const CONFETTI_COLORS = ['#ff6b6b','#feca57','#48dbfb','#ff9ff3','#54a0ff','#5f27cd','#01a3a4','#f368e0']
    function confettiStyle(i) {
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
      const left = 30 + Math.random() * 40  // 30%–70%
      const delay = Math.random() * 0.5
      const dur = 1.5 + Math.random() * 1
      const size = 6 + Math.random() * 8
      const rot = Math.random() * 360
      return {
        '--c': color,
        '--l': left + '%',
        '--d': delay + 's',
        '--dur': dur + 's',
        '--s': size + 'px',
        '--r': rot + 'deg',
      }
    }

    onMounted(() => {
      loadData()
      loadRewardSlots()
    })

    return {
      data, segments, segmentsWithOffset, wheelBg, wheelRotation,
      spinning, lastResult, rewards, canSpin, showConfetti,
      labelStyle,
      spin,
      // settings
      showSettings, editSlots, confettiStyle,
      openSettings, closeSettings, addSlot, removeSlot, saveRewardSlots
    }
  }
}).mount('#app')
