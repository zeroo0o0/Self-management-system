const { createApp, ref, computed, onMounted } = Vue

createApp({
  setup() {
    const data = ref({
      todos: [],
      xp: 0,
      level: 1,
      attributePoints: 0,
      totalXPEarned: 0,
      attributes: { strength: 0, intelligence: 0, endurance: 0, spirit: 0 }
    })

    const stats = [
      { key: 'strength',     label: '力量', icon: '💪', color: '#e53e3e' },
      { key: 'intelligence', label: '智力', icon: '🧠', color: '#3182ce' },
      { key: 'endurance',    label: '耐力', icon: '🛡️', color: '#38a169' },
      { key: 'spirit',       label: '精神', icon: '✨', color: '#805ad5' },
    ]

    const title = computed(() => {
      const lv = data.value.level ?? 1
      if (lv >= 50) return '👑 传说勇者'
      if (lv >= 30) return '⚡ 英雄'
      if (lv >= 15) return '🔥 冒险家'
      if (lv >= 5)  return '🌱 见习勇者'
      return '⚔️ 初心者'
    })

    const className = computed(() => {
      const { strength: s, intelligence: i, endurance: e, spirit: p } = data.value.attributes
      const total = s + i + e + p
      if (total === 0) return '未分配'
      const max = Math.max(s, i, e, p)
      if (max === s) return '战士'
      if (max === i) return '法师'
      if (max === e) return '骑士'
      return '牧师'
    })

    const flavorText = computed(() => {
      const lv = data.value.level ?? 1
      if (lv >= 50) return '你已是传说级别的存在，距离巅峰只差一步之遥。'
      if (lv >= 30) return '历经无数战斗，你的名字已响彻大陆。'
      if (lv >= 15) return '你在这片大陆上已经小有名气，继续前进吧！'
      if (lv >= 5)  return '慢慢找到了自己的节奏，前方的路还很长。'
      return '每一个伟大的冒险者都是从第一步开始的。'
    })

    const xpPercent = computed(() => {
      const lv = data.value.level ?? 1
      const xp = data.value.xp ?? 0
      return Math.min(100, (xp / (lv * 100)) * 100)
    })

    function statPercent(key) {
      const val = data.value.attributes[key] ?? 0
      return Math.min(100, (val / 50) * 100)
    }

    function addAttr(key) {
      if ((data.value.attributePoints ?? 0) <= 0) return
      data.value.attributePoints--
      data.value.attributes[key] = (data.value.attributes[key] ?? 0) + 1
      saveData()
    }

    async function loadData() {
      const res = await fetch('/api/load')
      const d = await res.json()
      // 保持完整数据结构，避免覆盖其他页面写入的字段
      data.value = d
      // 确保 RPG 字段存在
      if (!data.value.attributes) data.value.attributes = { strength: 0, intelligence: 0, endurance: 0, spirit: 0 }
      if (data.value.attributePoints === undefined) data.value.attributePoints = 0
      if (data.value.totalXPEarned === undefined) data.value.totalXPEarned = 0
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
      data, stats, title, className, flavorText, xpPercent,
      statPercent, addAttr
    }
  }
}).mount('#app')
